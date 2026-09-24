// functions/index.js
// Cloud Functions de Mercado Pago (Checkout Pro):
//
//  - createPreference: crea la preferencia de pago y devuelve el init_point.
//    Precio, nombre y stock se leen de Firestore con el Admin SDK (el cliente
//    solo envía { id, qty, variantId }), y el total server-side se vuelve a
//    escribir sobre el pedido en Firestore para que quede como única fuente
//    de verdad (ver nota de seguridad más abajo).
//
//    Variantes (talle/color/SKU/stock propio): un producto puede tener
//    `variants: [{ id, size, color, sku, stock, price? }]`. Cuando las
//    tiene, el cliente tiene que mandar `variantId` y buildItems() valida
//    stock/precio contra ESA variante puntual, nunca contra un `stock`
//    global del producto. Un producto sin `variants` sigue funcionando
//    exactamente como antes (stock simple a nivel producto) — ver
//    findVariant/applyStockDeltas más abajo para el resto de la lógica.
//
//  - mercadoPagoWebhook: recibe la notificación de pago de Mercado Pago,
//    vuelve a consultar el pago por su ID contra la API de MP (nunca confía
//    en el cuerpo de la notificación) y, si está aprobado, marca el pedido
//    como pagado y descuenta stock — todo dentro de una transacción de
//    Firestore, para que un reintento del webhook nunca descuente dos veces.
//    Si más tarde Mercado Pago informa un reembolso/contracargo sobre un
//    pedido que ya estaba aprobado, repone el stock automáticamente y deja
//    el pedido marcado con `needsAttention` para que se vea en el panel de
//    admin. Además, manda mails transaccionales vía la API de Resend (ver
//    sendEmail/sendOrderEmails): aviso al dueño (ADMIN_NOTIFICATION_EMAIL)
//    en ventas nuevas y reembolsos, y confirmación de compra al comprador
//    (shipping.email) en ventas nuevas.
//
//    Mail — modo mock mientras el proyecto está en plan Spark (gratis):
//    RESEND_API_KEY se lee de una variable de entorno común (process.env),
//    NO de Firebase Secret Manager (eso requiere plan Blaze, ver más abajo).
//    Sin esa variable seteada, sendEmail() no manda nada de verdad: loguea
//    en las Functions logs (o la consola del emulador) lo que HUBIERA
//    mandado, así se puede seguir probando todo el flujo (checkout → pago →
//    webhook → "mail") sin gastar en Blaze ni tener una key real. Ver el
//    bloque "ACTIVAR RESEND EN PRODUCCIÓN" más abajo para pasar a mails
//    reales el día que se habilite Blaze.
//
// Seguridad:
//  - El Access Token vive como secret de Firebase (MP_ACCESS_TOKEN), nunca en el cliente.
//  - RESEND_API_KEY, mientras no haya Blaze, vive en functions/.env.local
//    (gitignored, solo para el emulador — nunca se sube en un deploy) o
//    directamente no está seteada (modo mock). Nunca hardcodeada en el
//    código ni en un archivo que se commitee.
//  - createPreference exige un ID token de Firebase Auth válido (Authorization:
//    Bearer <token>) y verifica que sea el dueño del pedido antes de tocarlo.
//    Sin esto, cualquiera podría mandar un "orderId" ajeno o inventado.
//  - El total y los items del pedido se pisan con los valores reales leídos
//    de Firestore en createPreference, así el webhook compara el pago contra
//    un monto que el cliente nunca pudo manipular.

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

initializeApp();
const db = getFirestore();

const MP_ACCESS_TOKEN = defineSecret('MP_ACCESS_TOKEN');

// --- ACTIVAR RESEND EN PRODUCCIÓN (cuando se habilite el plan Blaze) ---
// Por ahora RESEND_API_KEY NO se pide como Firebase Secret (eso requiere
// Secret Manager → plan Blaze, y el proyecto se quiere mantener en Spark).
// sendEmail() de abajo lee la key de una variable de entorno común
// (process.env.RESEND_API_KEY) en vez de defineSecret(...).value(). Para
// pasar a mails reales sin rehacer nada de esto:
//   1) firebase functions:secrets:set RESEND_API_KEY   (ya con Blaze activo)
//   2) Descomentar la línea de abajo:
//        const RESEND_API_KEY_SECRET = defineSecret('RESEND_API_KEY');
//   3) Agregar RESEND_API_KEY_SECRET al array `secrets: [...]` de
//      mercadoPagoWebhook (unas líneas más abajo).
//   4) Deploy. No hace falta tocar sendEmail(): Firebase expone el secret
//      como process.env.RESEND_API_KEY en runtime, igual que ahora.
// const RESEND_API_KEY_SECRET = defineSecret('RESEND_API_KEY');

// Configurables vía functions/.env (ver functions/.env.example)
const CURRENCY_ID = process.env.MP_CURRENCY_ID || 'ARS';
const STATEMENT_DESCRIPTOR = process.env.MP_STATEMENT_DESCRIPTOR || 'MI TIENDA';
// Mail del dueño de la tienda para los avisos de "nueva venta" y "reembolso"
// (ver más abajo, sendOrderEmails). Vacío = no se manda nada.
const ADMIN_NOTIFICATION_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || '';
// Remitente con el que salen los mails vía Resend. Para probar sirve el
// dominio de prueba de Resend (onboarding@resend.dev, no requiere
// verificación); para producción hay que verificar un dominio propio en
// Resend y poner algo como "Mi Tienda <pedidos@tudominio.com>" — ver README.
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
// Costo fijo de envío a domicilio (retiro en el local siempre es gratis).
// Es la ÚNICA fuente de verdad para este monto: nunca se confía en lo que
// mande el navegador. Tiene que coincidir con VITE_SHIPPING_COST en el .env
// del frontend — ese valor ahí es solo una estimación visual para el carrito.
const MP_SHIPPING_COST = Number(process.env.MP_SHIPPING_COST || 0);
// URL pública de mercadoPagoWebhook (se completa después del primer deploy,
// ver README — "chicken and egg" igual que VITE_MP_CREATE_PREFERENCE_URL).
const MP_WEBHOOK_URL = process.env.MP_WEBHOOK_URL || undefined;
// Lista separada por comas de orígenes permitidos. Vacío = cualquiera (solo para desarrollo).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Notificaciones de pago que representan un estado ya "cerrado" y que sí
// pueden reemplazar a un pedido previamente aprobado (ej: una devolución).
// Todo lo demás (pending, in_process, rejected...) nunca pisa un pedido que
// ya estaba aprobado — evita que una notificación vieja/duplicada lo "baje".
const REVERSAL_STATUSES = new Set(['refunded', 'charged_back', 'cancelled']);

// Mismo criterio que js/utils.js#getFinalPrice
function getFinalPrice(product) {
  const list = Number(product.listPrice);
  const offer = Number(product.offerPrice);
  const validOffer = product.offerPrice != null && Number.isFinite(offer) && offer > 0 && offer < list;
  return validOffer ? offer : list;
}

/** Busca una variante por id dentro de product.variants (o null si no existe). */
function findVariant(product, variantId) {
  if (!Array.isArray(product.variants)) return null;
  return product.variants.find((v) => v.id === variantId) || null;
}

/** "M / Negra" — mismo formato en frontend, mail y panel admin. */
function formatVariantLabel(variant) {
  if (!variant) return '';
  return [variant.size, variant.color].filter(Boolean).join(' / ');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Manda un mail transaccional vía la API de Resend (resend.com). Si no hay
 * API key configurada en process.env.RESEND_API_KEY (modo mock — ver el
 * bloque "ACTIVAR RESEND EN PRODUCCIÓN" al principio del archivo), no manda
 * nada de verdad: loguea lo que hubiera mandado y sigue — así se puede
 * probar todo el flujo de checkout sin key real y sin que el webhook falle
 * por un mail que no se pudo mandar. Se llama SIEMPRE fuera de la
 * transacción de Firestore (ver mercadoPagoWebhook): una llamada de red
 * dentro de una transacción que Firestore puede reintentar mandaría el
 * mismo mail más de una vez.
 */
async function sendEmail({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY || '';

  if (!apiKey) {
    const preview = text || (html ? `[html, ${html.length} caracteres]` : '');
    console.log(`[Resend MOCK — no se mandó de verdad] "${subject}" → ${to}\n${preview}`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [to],
      subject,
      ...(html ? { html } : { text }),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Resend respondió ${response.status}: ${errorBody}`);
  }
}

function formatOrderItemsText(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `- ${item.qty}x ${item.name}${item.variantLabel ? ` (${item.variantLabel})` : ''} ($${item.price} c/u)`)
    .join('\n');
}

/** Escapa texto antes de insertarlo en el HTML del mail de confirmación. */
function escapeHtmlForEmail(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildBuyerConfirmationEmailHtml(order, shipping, orderId) {
  const itemsRows = (Array.isArray(order.items) ? order.items : [])
    .map(
      (item) => `
        <tr>
          <td style="padding:4px 8px;border-bottom:1px solid #eee">${item.qty}x ${escapeHtmlForEmail(item.name)}${
            item.variantLabel
              ? ` <span style="color:#888">(${escapeHtmlForEmail(item.variantLabel)})</span>`
              : ''
          }</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">$${Number(item.price * item.qty).toLocaleString('es-AR')}</td>
        </tr>`
    )
    .join('');

  const deliveryText =
    shipping.method === 'pickup'
      ? 'Retiro en el local'
      : `Envío a domicilio — ${[shipping.address, shipping.postalCode, shipping.city].filter(Boolean).join(', ')}`;

  return `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">
      <h2 style="margin-bottom:4px">¡Gracias por tu compra${shipping.fullName ? `, ${escapeHtmlForEmail(shipping.fullName)}` : ''}!</h2>
      <p style="color:#555">Confirmamos tu pedido <strong>#${escapeHtmlForEmail(orderId)}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">${itemsRows}</table>
      <p><strong>Entrega:</strong> ${escapeHtmlForEmail(deliveryText)}</p>
      <p><strong>Total:</strong> $${Number(order.total).toLocaleString('es-AR')}</p>
      <p style="color:#888;font-size:13px;margin-top:24px">Te vamos a avisar cuando tu pedido esté preparado y en camino.</p>
    </div>
  `;
}

/**
 * Manda los mails correspondientes a un evento del webhook (venta nueva o
 * reembolso/contracargo), ya con la transacción de Firestore confirmada.
 * Cualquier error de envío queda solo logueado — nunca hace fallar el
 * webhook, porque Mercado Pago reintentaría la notificación indefinidamente.
 */
async function sendOrderEmails(event) {
  if (!event) return;
  const { type, orderId, order, shipping } = event;

  if (type === 'new_sale') {
    if (ADMIN_NOTIFICATION_EMAIL) {
      await sendEmail({
        to: ADMIN_NOTIFICATION_EMAIL,
        subject: `Nueva venta — Pedido #${orderId} — $${order.total}`,
        text:
          `Se aprobó un pago nuevo.\n\n` +
          `Comprador: ${shipping.fullName || 'sin datos'} — ${shipping.phone || ''} — ${shipping.email || ''}\n` +
          `Entrega: ${shipping.method === 'pickup' ? 'Retiro en el local' : 'Envío a domicilio'}\n` +
          (shipping.method === 'pickup'
            ? ''
            : `Dirección: ${[shipping.address, shipping.postalCode, shipping.city].filter(Boolean).join(', ')}\n`) +
          `\nProductos:\n${formatOrderItemsText(order.items)}\n\nTotal: $${order.total}`,
      }).catch((err) => console.error(`No se pudo mandar el mail de aviso al admin (pedido ${orderId}):`, err));
    }

    if (shipping.email) {
      await sendEmail({
        to: shipping.email,
        subject: `Confirmamos tu compra — Pedido #${orderId}`,
        html: buildBuyerConfirmationEmailHtml(order, shipping, orderId),
      }).catch((err) => console.error(`No se pudo mandar la confirmación al comprador (pedido ${orderId}):`, err));
    }
  } else if (type === 'refund') {
    if (ADMIN_NOTIFICATION_EMAIL) {
      await sendEmail({
        to: ADMIN_NOTIFICATION_EMAIL,
        subject: `Reembolso/contracargo — Pedido #${orderId} — se repuso el stock`,
        text:
          `Mercado Pago informó un reembolso/contracargo para un pedido que ya estaba aprobado.\n` +
          `Se repuso automáticamente el stock de estos productos:\n\n${formatOrderItemsText(order.items)}\n\n` +
          `Revisá el pedido en el panel de administración.`,
      }).catch((err) => console.error(`No se pudo mandar el mail de reembolso al admin (pedido ${orderId}):`, err));
    }
  }
}

async function buildItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new HttpError(400, 'El carrito está vacío.');
  }

  return Promise.all(
    rawItems.map(async (raw) => {
      const quantity = parseInt(raw?.qty, 10);
      if (!raw?.id || !Number.isFinite(quantity) || quantity <= 0) {
        throw new HttpError(400, 'Item de carrito inválido.');
      }

      const snap = await db.collection('productos').doc(String(raw.id)).get();
      if (!snap.exists) throw new HttpError(409, 'Un producto del carrito ya no existe.');

      const product = snap.data();
      const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
      let variant = null;

      // Con variantes, el stock y (opcionalmente) el precio son de la
      // variante puntual — nunca del producto en general. Sin variantes,
      // se valida como siempre (stock simple a nivel producto).
      if (hasVariants) {
        if (!raw.variantId) {
          throw new HttpError(400, `"${product.name}" requiere elegir talle/color antes de comprar.`);
        }
        variant = findVariant(product, raw.variantId);
        if (!variant) {
          // El cliente puede haber mandado un variantId que ya no existe
          // (el admin lo borró) o que directamente nunca existió (manipulado).
          throw new HttpError(409, `La variante elegida de "${product.name}" ya no está disponible.`);
        }
        if (Number(variant.stock ?? 0) < quantity) {
          throw new HttpError(
            409,
            `Stock insuficiente para "${product.name}" (${formatVariantLabel(variant)}).`
          );
        }
      } else if (Number(product.stock ?? 0) < quantity) {
        throw new HttpError(409, `Stock insuficiente para "${product.name}".`);
      }

      const variantPrice = variant?.price;
      const hasVariantPrice = variantPrice != null && Number.isFinite(Number(variantPrice)) && Number(variantPrice) > 0;
      const unitPrice = hasVariantPrice ? Number(variantPrice) : getFinalPrice(product);

      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new HttpError(409, `"${product.name}" no tiene un precio válido.`);
      }

      const label = variant ? formatVariantLabel(variant) : '';

      return {
        id: snap.id,
        variantId: variant?.id || null,
        sku: variant?.sku || null,
        variantLabel: label || null,
        // productName: nombre "limpio" del producto, para guardar en el
        // pedido (Firestore) — title lleva la variante pegada porque ese es
        // el que ve el comprador como línea de ítem en el Checkout de
        // Mercado Pago, y ahí sí conviene que sea autoexplicativo.
        productName: String(product.name),
        title: label ? `${product.name} (${label})` : String(product.name),
        quantity,
        unit_price: unitPrice,
        currency_id: CURRENCY_ID,
      };
    })
  );
}

/**
 * Verifica el ID token de Firebase Auth mandado en el header Authorization
 * y devuelve el uid. Lanza HttpError(401) si falta o es inválido.
 */
async function requireAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Falta autenticación.');

  try {
    const decoded = await getAuth().verifyIdToken(token);
    return decoded.uid;
  } catch (err) {
    throw new HttpError(401, 'Sesión inválida o vencida.');
  }
}

/**
 * Revalida que el pedido exista, sea del usuario autenticado y todavía no
 * haya sido procesado, y le pisa items/total con los valores server-side
 * recién calculados en buildItems() + el costo de envío. Así el pedido en
 * Firestore siempre refleja lo que realmente se le va a cobrar en Mercado
 * Pago.
 *
 * El costo de envío NUNCA sale del cliente: se calcula acá a partir del
 * método guardado en el pedido (delivery/pickup — ver firestore.rules,
 * validShipping()) y de MP_SHIPPING_COST. Si el pedido no tiene un método de
 * envío válido, se corta: sin eso no hay forma segura de cobrar el envío.
 *
 * @returns {Promise<{total: number, preferenceItems: Array}>} preferenceItems
 *   es lo que se le manda a Mercado Pago (productos + el envío como line item
 *   aparte, si corresponde); order.items en Firestore solo guarda productos.
 */
async function attachOrderToPreference(orderId, uid, mpItems) {
  const orderRef = db.collection('pedidos').doc(String(orderId));
  const snap = await orderRef.get();

  if (!snap.exists) throw new HttpError(404, 'El pedido no existe.');
  const order = snap.data();

  if (order.userId !== uid) {
    throw new HttpError(403, 'No tenés permiso sobre este pedido.');
  }
  if (order.status !== 'pending') {
    throw new HttpError(409, 'Este pedido ya fue procesado.');
  }

  const shippingMethod = order.shipping?.method;
  if (shippingMethod !== 'delivery' && shippingMethod !== 'pickup') {
    throw new HttpError(400, 'El pedido no tiene datos de envío válidos.');
  }
  const shippingCost = shippingMethod === 'delivery' ? MP_SHIPPING_COST : 0;

  const itemsTotal = mpItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const total = itemsTotal + shippingCost;

  // Objetos "limpios" para la API de Mercado Pago: solo los campos que
  // espera (id/title/quantity/unit_price/currency_id) — mpItems trae además
  // variantId/sku/variantLabel/productName, que son para Firestore, no para
  // mandarle a la API de un tercero.
  const preferenceItems = mpItems.map((item) => ({
    id: item.id,
    title: item.title,
    quantity: item.quantity,
    unit_price: item.unit_price,
    currency_id: item.currency_id,
  }));
  if (shippingCost > 0) {
    preferenceItems.push({
      id: 'shipping',
      title: 'Costo de envío',
      quantity: 1,
      unit_price: shippingCost,
      currency_id: CURRENCY_ID,
    });
  }

  await orderRef.update({
    items: mpItems.map((item) => ({
      id: item.id,
      variantId: item.variantId ?? null,
      sku: item.sku ?? null,
      variantLabel: item.variantLabel ?? null,
      name: item.productName,
      qty: item.quantity,
      price: item.unit_price,
    })),
    total,
    'shipping.cost': shippingCost,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { total, preferenceItems };
}

exports.createPreference = onRequest(
  {
    secrets: [MP_ACCESS_TOKEN],
    region: 'us-central1',
    cors: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método no permitido.' });
      return;
    }

    try {
      const uid = await requireAuth(req);

      const { items, backUrls, orderId } = req.body || {};
      if (!orderId) {
        throw new HttpError(400, 'Falta el pedido a asociar con este pago.');
      }

      const mpItems = await buildItems(items);
      const { preferenceItems } = await attachOrderToPreference(orderId, uid, mpItems);

      const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN.value() });
      const preference = new Preference(client);

      const result = await preference.create({
        body: {
          items: preferenceItems,
          external_reference: String(orderId),
          notification_url: MP_WEBHOOK_URL,
          back_urls: {
            success: backUrls?.success || '',
            failure: backUrls?.failure || '',
            pending: backUrls?.pending || '',
          },
          auto_return: 'approved',
          statement_descriptor: STATEMENT_DESCRIPTOR,
        },
      });

      res.status(200).json({ id: result.id, init_point: result.init_point });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error('Error al crear preferencia de Mercado Pago:', err);
      res.status(status).json({
        error: status === 500 ? 'No se pudo crear la preferencia de pago.' : err.message,
      });
    }
  }
);

/**
 * Aplica un delta de stock a los productos de una lista de items de pedido,
 * DENTRO de una transacción de Firestore ya abierta (tx). sign = -1 al
 * aprobar un pago (descuenta), sign = +1 al revertir uno ya aprobado
 * (repone).
 *
 * Agrupa los items por producto ANTES de escribir porque un mismo pedido
 * puede tener más de una variante del mismo producto (ej: "M/Negra" y
 * "L/Negra" de la misma remera) — llamar tx.update() más de una vez sobre
 * el mismo documento dentro de una transacción no ACUMULA los cambios de
 * un mismo campo (el último update pisa al anterior), así que hay que
 * calcular el resultado final de todos sus items juntos y escribir una
 * sola vez por producto.
 *
 * Con variantes, el delta se aplica al `stock` de la variante puntual
 * dentro de `product.variants` (reescribiendo el array completo — ya lo
 * leímos entero con tx.get) y se recalcula `product.stock` como la suma de
 * todas las variantes, para que ese campo (usado en el admin para
 * ordenar/filtrar) siga siendo coherente. Sin variantes, es el `stock`
 * simple de siempre — mismo comportamiento que antes de este cambio.
 */
async function applyStockDeltas(tx, items, sign) {
  const itemsByProductId = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(item.id);
    if (!itemsByProductId.has(key)) itemsByProductId.set(key, []);
    itemsByProductId.get(key).push(item);
  }

  const productIds = [...itemsByProductId.keys()];
  if (productIds.length === 0) return;

  const productRefs = productIds.map((id) => db.collection('productos').doc(id));
  const productSnaps = await Promise.all(productRefs.map((ref) => tx.get(ref)));

  productSnaps.forEach((snap, i) => {
    if (!snap.exists) return; // producto borrado después de la compra: no rompemos el pedido por eso
    const product = snap.data();
    const productItems = itemsByProductId.get(productIds[i]);
    const variants = Array.isArray(product.variants) ? product.variants.map((v) => ({ ...v })) : null;
    let simpleStock = Number(product.stock ?? 0);

    for (const item of productItems) {
      const delta = Number(item.qty ?? 0) * sign;
      if (item.variantId && variants) {
        const idx = variants.findIndex((v) => v.id === item.variantId);
        if (idx === -1) continue; // la variante ya no existe (el admin la borró): no rompemos el pedido por eso
        variants[idx].stock = Math.max(0, Number(variants[idx].stock ?? 0) + delta);
      } else {
        simpleStock = Math.max(0, simpleStock + delta);
      }
    }

    if (variants) {
      const totalStock = variants.reduce((sum, v) => sum + Number(v.stock ?? 0), 0);
      tx.update(snap.ref, { variants, stock: totalStock });
    } else {
      tx.update(snap.ref, { stock: simpleStock });
    }
  });
}

exports.mercadoPagoWebhook = onRequest(
  {
    // RESEND_API_KEY_SECRET no se incluye acá mientras el proyecto esté en
    // plan Spark — ver "ACTIVAR RESEND EN PRODUCCIÓN" al principio del
    // archivo. Sin Blaze, declarar un secret acá rompe el deploy.
    secrets: [MP_ACCESS_TOKEN],
    region: 'us-central1',
  },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).send('Método no permitido.');
      return;
    }

    try {
      // Mercado Pago manda el id del pago en el body (webhooks nuevos, POST)
      // o en query params (IPN clásico, GET) según la integración.
      const paymentId =
        req.body?.data?.id || req.query['data.id'] || req.query.id || null;
      const topic = req.body?.type || req.query.type || req.query.topic || null;

      if (topic !== 'payment' || !paymentId) {
        // Otro tipo de notificación (merchant_order, etc.): no nos interesa.
        res.status(200).send('ignored');
        return;
      }

      const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN.value() });
      // OJO: nunca confiamos en el status que venga en el body de la
      // notificación (se puede falsificar); siempre volvemos a pedirle el
      // pago a la API de Mercado Pago usando nuestro propio Access Token.
      const payment = await new Payment(client).get({ id: paymentId });

      const orderId = payment.external_reference;
      const mpStatus = payment.status; // approved | rejected | pending | in_process | refunded | charged_back | cancelled
      const amountPaid = Number(payment.transaction_amount);

      if (!orderId) {
        console.warn(`Pago ${paymentId} sin external_reference; no se puede conciliar con un pedido.`);
        res.status(200).send('no-order-reference');
        return;
      }

      const orderRef = db.collection('pedidos').doc(String(orderId));

      // La transacción NUNCA manda mails directamente (ver sendEmail): es una
      // llamada de red, y Firestore puede reintentar el callback de una
      // transacción por contención, lo que mandaría el mismo mail más de una
      // vez. En cambio, arma y devuelve un "evento" describiendo qué pasó, y
      // recién después de que la transacción confirma (con éxito y una sola
      // vez) se dispara sendOrderEmails() con ese evento.
      const emailEvent = await db.runTransaction(async (tx) => {
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists) {
          console.warn(`Pedido ${orderId} no existe (pago ${paymentId}).`);
          return null;
        }
        const order = orderSnap.data();

        // Idempotencia: Mercado Pago puede reenviar la misma notificación
        // varias veces. Si ya procesamos este mismo pago con este mismo
        // estado, no hacemos nada más.
        if (order.mpPaymentId === paymentId && order.status === mpStatus) {
          return null;
        }

        const amountMatches =
          !Number.isFinite(amountPaid) || Math.abs(amountPaid - Number(order.total)) < 1;
        if (!amountMatches) {
          console.error(
            `Monto no coincide para pedido ${orderId}: pagado $${amountPaid}, pedido $${order.total}.`
          );
        }

        const wasAlreadyApproved = order.status === 'approved';
        const stockAlreadyApplied = order.stockApplied === true;
        let event = null;

        if (mpStatus === 'approved' && amountMatches && !stockAlreadyApplied) {
          // Primera vez que este pedido queda aprobado: descontamos stock
          // (por variante si corresponde, ver applyStockDeltas) dentro de la
          // misma transacción que marca stockApplied, para que un reintento
          // del webhook nunca lo descuente dos veces.
          const items = Array.isArray(order.items) ? order.items : [];
          await applyStockDeltas(tx, items, -1);

          tx.update(orderRef, {
            status: 'approved',
            mpPaymentId: paymentId,
            mpStatus,
            stockApplied: true,
            paidAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          event = { type: 'new_sale', orderId, order, shipping: order.shipping || {} };
        } else if (!wasAlreadyApproved || REVERSAL_STATUSES.has(mpStatus)) {
          // Pendiente, rechazado, en proceso, o una reversión (devolución,
          // contracargo, cancelación) después de haber estado aprobado.
          const isReversalOfApproved = wasAlreadyApproved && REVERSAL_STATUSES.has(mpStatus);
          const updates = {
            status: mpStatus,
            mpPaymentId: paymentId,
            mpStatus,
            updatedAt: FieldValue.serverTimestamp(),
            ...(amountMatches ? {} : { amountMismatch: true }),
          };

          // Si el pedido YA estaba aprobado (stock ya descontado) y ahora
          // Mercado Pago informa una reversión (devolución/contracargo), se
          // repone el stock automáticamente. stockRestored evita reponerlo
          // dos veces si el webhook reintenta la misma notificación.
          if (isReversalOfApproved && order.stockApplied === true && order.stockRestored !== true) {
            const items = Array.isArray(order.items) ? order.items : [];
            await applyStockDeltas(tx, items, 1);

            updates.stockRestored = true;
            // Marca visible en el panel de admin (banner + badge en la
            // tabla de Pedidos) para que no pase desapercibido — el admin
            // la saca a mano desde el detalle del pedido ("Marcar como revisado").
            updates.needsAttention = true;
            event = { type: 'refund', orderId, order, shipping: order.shipping || {} };
          }

          tx.update(orderRef, updates);
        }
        // Si wasAlreadyApproved y mpStatus no es una reversión conocida
        // (ej: una notificación vieja de "pending" llega tarde), no tocamos
        // nada: un pedido aprobado no puede "retroceder" a pendiente.

        return event;
      });

      // Recién acá, con la transacción ya confirmada (y una sola vez): los
      // mails correspondientes, si hubo un evento que los amerite.
      await sendOrderEmails(emailEvent);

      res.status(200).send('ok');
    } catch (err) {
      console.error('Error procesando webhook de Mercado Pago:', err);
      // Respondemos 200 igual: si devolvemos error, Mercado Pago reintenta
      // esta notificación indefinidamente, y probablemente vuelva a fallar
      // por lo mismo. Preferimos loguear y revisar a mano.
      res.status(200).send('error-logged');
    }
  }
);
