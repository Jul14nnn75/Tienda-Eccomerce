// cloudflare-worker/src/index.js
// Backend de pagos de Mercado Pago, corriendo en Cloudflare Workers (plan
// gratuito, sin tarjeta) en vez de Firebase Functions (que requiere Blaze).
// Llama directo a la API REST de Mercado Pago con fetch() — nunca al SDK de
// Node, que no es compatible con el runtime de Workers (V8 isolates).
//
// Rutas:
//   POST /                 → crea una preferencia de Checkout Pro (redirige
//                             a Mercado Pago, incluye transferencia bancaria).
//   POST /process-payment  → recibe el token del Card Payment Brick (el
//                             cliente paga sin salir de tu sitio) y crea el
//                             pago contra la API de Orders de Mercado Pago.
//   POST /webhook          → Mercado Pago avisa acá cuando un pago se
//                             confirma de verdad. Marca el pedido como
//                             pagado y descuenta stock en Firestore.
//
// Secrets necesarios (wrangler secret put <NOMBRE>):
//   MP_ACCESS_TOKEN      — Access Token de Mercado Pago (igual que antes)
//   MP_WEBHOOK_SECRET     — la "Clave secreta" de Webhooks (Tus integraciones
//                            → tu app → Webhooks → Configurar notificaciones)
//   FIREBASE_CLIENT_EMAIL — client_email del JSON de la cuenta de servicio
//                            de Firebase (Configuración del proyecto →
//                            Cuentas de servicio → Generar nueva clave privada)
//   FIREBASE_PRIVATE_KEY  — private_key de ese mismo JSON (con los \n tal
//                            cual vienen, entre comillas)
// Variable normal (no secreta) en wrangler.toml:
//   FIREBASE_PROJECT_ID   — el project ID de tu proyecto de Firebase
//   ALLOWED_ORIGIN        — dominio de la tienda (único que puede llamar al Worker)
//
// Nombre en el resumen de la tarjeta y costos de envío por defecto: salen de
// tienda-suplementos/tienda.config.js, el mismo archivo que usa la tienda.
// Las zonas de envío se leen de Firestore (config/envios) y se calculan con
// el mismo código que la tienda (js/shipping.js).

import tienda from '../../tienda-suplementos/tienda.config.js';
import { normalizeShippingSettings, quoteShipping } from '../../tienda-suplementos/js/shipping.js';

// Dominio que puede llamar a este Worker. Se configura con la variable
// ALLOWED_ORIGIN de wrangler.toml (ej: "https://mitienda.com.ar"); "*" deja
// pasar a cualquiera y solo sirve para desarrollo.
let allowedOrigin = '*';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ---------------------------------------------------------------------------
// Pedido verificado: el monto a cobrar NUNCA sale de lo que manda el
// navegador (se puede editar desde DevTools). Se lee el pedido de Firestore y
// se recalcula con los precios reales de "productos".
// ---------------------------------------------------------------------------

/** Error con mensaje apto para mostrarle al comprador. */
class CheckoutError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function fsNumber(field) {
  if (field?.integerValue != null) return Number(field.integerValue);
  if (field?.doubleValue != null) return Number(field.doubleValue);
  return NaN;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Misma regla que calcDiscount() de js/app.js: la oferta vale solo si es
 * menor al precio de lista y el descuento redondeado da al menos 1%.
 */
function effectivePrice(productFields) {
  const list = fsNumber(productFields?.listPrice);
  const offer = fsNumber(productFields?.offerPrice);
  const isOffer =
    Number.isFinite(offer) && offer > 0 && offer < list && Math.round(((list - offer) / list) * 100) > 0;
  return isOffer ? offer : list;
}

/** Convierte un valor de la API REST de Firestore a un valor común de JS. */
function fsDecode(value) {
  if (!value) return null;
  if (value.stringValue != null) return value.stringValue;
  if (value.booleanValue != null) return value.booleanValue;
  if (value.integerValue != null || value.doubleValue != null) return fsNumber(value);
  if (value.arrayValue) return (value.arrayValue.values || []).map(fsDecode);
  if (value.mapValue) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, inner]) => [key, fsDecode(inner)])
    );
  }
  return null;
}

/**
 * Costo de envío con la misma cuenta que la tienda (js/shipping.js) y la
 * misma configuración (config/envios, editada desde el panel).
 */
async function shippingCostFor(env, accessToken, shippingFields, subtotal) {
  const settingsDoc = await firestoreGetDoc(env, accessToken, 'config/envios');
  const settings = normalizeShippingSettings(
    settingsDoc ? fsDecode({ mapValue: { fields: settingsDoc.fields } }) : null,
    tienda.shipping
  );

  const quote = quoteShipping(settings, {
    method: shippingFields?.method?.stringValue,
    zip: shippingFields?.address?.mapValue?.fields?.zip?.stringValue,
    subtotal,
  });
  if (!quote.available) {
    throw new CheckoutError('Por ahora no hacemos envíos a ese código postal.', 409);
  }
  return quote.cost;
}

/**
 * Lee el pedido y devuelve items, envío y total con precios de Firestore.
 * Además deja guardado ese total en el pedido (verifiedTotal) para que el
 * webhook pueda comprobar que lo pagado coincide.
 */
async function loadVerifiedOrder(env, orderId) {
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) {
    throw new CheckoutError('No se pudo identificar el pedido. Recargá la página y volvé a intentar.');
  }

  const accessToken = await getGoogleAccessToken(env);
  const orderDoc = await firestoreGetDoc(env, accessToken, `pedidos/${orderId}`);
  if (!orderDoc) {
    throw new CheckoutError('No se encontró el pedido. Recargá la página y volvé a intentar.');
  }
  if (orderDoc.fields?.status?.stringValue !== 'pending') {
    throw new CheckoutError('Este pedido ya fue procesado.');
  }

  const rawItems = orderDoc.fields?.items?.arrayValue?.values || [];
  if (rawItems.length === 0) {
    throw new CheckoutError('El carrito está vacío.');
  }

  const items = await Promise.all(
    rawItems.map(async (entry) => {
      const fields = entry.mapValue?.fields || {};
      const id = fields.id?.stringValue;
      const qty = fsNumber(fields.qty);
      if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || !Number.isInteger(qty) || qty <= 0) {
        throw new CheckoutError('El pedido tiene un producto inválido.');
      }

      const productDoc = await firestoreGetDoc(env, accessToken, `productos/${id}`);
      const name = productDoc?.fields?.name?.stringValue || fields.name?.stringValue || 'Producto';
      if (!productDoc || productDoc.fields?.active?.booleanValue === false) {
        throw new CheckoutError(`"${name}" ya no está disponible.`, 409);
      }

      const price = effectivePrice(productDoc.fields);
      if (!Number.isFinite(price) || price <= 0) {
        throw new CheckoutError(`"${name}" no tiene un precio válido.`, 409);
      }
      if (qty > fsNumber(productDoc.fields?.stock)) {
        throw new CheckoutError(`No hay stock suficiente de "${name}".`, 409);
      }

      return { id, name, qty, price };
    })
  );

  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const shippingFields = orderDoc.fields?.shipping?.mapValue?.fields;
  const shippingCost = await shippingCostFor(env, accessToken, shippingFields, subtotal);
  const total = roundMoney(subtotal + shippingCost);

  // El total que vio el comprador tiene que ser el mismo que se va a cobrar.
  const shownTotal = fsNumber(orderDoc.fields?.total);
  if (!(Math.abs(shownTotal - total) <= 0.01)) {
    throw new CheckoutError(
      'El precio de algún producto cambió. Recargá la página y revisá el carrito antes de pagar.',
      409
    );
  }

  await firestorePatchFields(env, accessToken, `pedidos/${orderId}`, {
    verifiedTotal: { doubleValue: total },
  });

  return { items, shippingCost, total };
}

function checkoutErrorResponse(err, fallback) {
  if (err instanceof CheckoutError) {
    return jsonResponse({ error: err.message }, err.status);
  }
  console.error(fallback, err.message);
  return jsonResponse({ error: fallback }, 500);
}

// ---------------------------------------------------------------------------
// POST / — Checkout Pro: crea la preferencia y devuelve el link de pago
// ---------------------------------------------------------------------------
async function handleCreatePreference(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido.' }, 400);
  }

  const { backUrls, orderId } = body || {};

  try {
    const order = await loadVerifiedOrder(env, orderId);

    const mpItems = order.items.map((item) => ({
      id: item.id,
      title: item.name,
      quantity: item.qty,
      unit_price: item.price,
      currency_id: 'ARS',
    }));
    if (order.shippingCost > 0) {
      mpItems.push({
        id: 'envio',
        title: 'Costo de envío',
        quantity: 1,
        unit_price: order.shippingCost,
        currency_id: 'ARS',
      });
    }

    const successUrl = backUrls?.success || '';
    const isLocalUrl = /localhost|127\.0\.0\.1/.test(successUrl);

    const preferenceBody = {
      items: mpItems,
      back_urls: {
        success: successUrl,
        failure: backUrls?.failure || '',
        pending: backUrls?.pending || '',
      },
      statement_descriptor: tienda.payments.statementDescriptor,
      external_reference: orderId,
    };

    if (!isLocalUrl) {
      preferenceBody.auto_return = 'approved';
    }

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preferenceBody),
    });

    const data = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('Mercado Pago rechazó la preferencia:', JSON.stringify(data));
      return jsonResponse({ error: 'No se pudo crear la preferencia de pago.' }, 500);
    }

    return jsonResponse({ id: data.id, init_point: data.init_point });
  } catch (err) {
    return checkoutErrorResponse(err, 'No se pudo crear la preferencia de pago.');
  }
}

// ---------------------------------------------------------------------------
// POST /process-payment — Card Payment Brick: crea la orden con el token
// ---------------------------------------------------------------------------
const CARD_TYPES = ['credit_card', 'debit_card', 'prepaid_card'];

async function handleProcessPayment(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido.' }, 400);
  }

  const { token, payment_method_id, installments, payer, orderId, paymentTypeId } = body || {};

  const parsedInstallments = parseInt(installments, 10);

  if (!token || !payment_method_id) {
    return jsonResponse({ error: 'Datos de pago incompletos.' }, 400);
  }

  const payerEmail = String(payer?.email || '').trim();
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(payerEmail)) {
    return jsonResponse({ error: 'El email ingresado no es válido.' }, 400);
  }

  const finalInstallments = Number.isFinite(parsedInstallments) && parsedInstallments > 0 ? parsedInstallments : 1;
  const cardType = CARD_TYPES.includes(paymentTypeId) ? paymentTypeId : 'credit_card';

  try {
    const order = await loadVerifiedOrder(env, orderId);
    const amountStr = order.total.toFixed(2);

    const mpResponse = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        type: 'online',
        processing_mode: 'automatic',
        total_amount: amountStr,
        external_reference: orderId,
        payer: {
          email: payerEmail,
        },
        transactions: {
          payments: [
            {
              amount: amountStr,
              payment_method: {
                id: payment_method_id,
                type: cardType,
                token,
                installments: finalInstallments,
              },
            },
          ],
        },
      }),
    });

    const data = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('Mercado Pago rechazó la orden:', JSON.stringify(data));
      // La API de Orders devuelve el motivo en errors[] (no en message).
      const mpError = data.errors?.[0];
      return jsonResponse(
        {
          error: 'Mercado Pago no pudo procesar el pago.',
          code: mpError?.code || null,
          detail: mpError?.message || data.message || null,
        },
        400
      );
    }

    const firstPayment = data.transactions?.payments?.[0];
    const status = firstPayment?.status || data.status;
    const statusDetail = firstPayment?.status_detail || data.status_detail;

    return jsonResponse({ status, statusDetail, paymentId: firstPayment?.id || data.id });
  } catch (err) {
    return checkoutErrorResponse(err, 'No se pudo procesar el pago.');
  }
}

// ---------------------------------------------------------------------------
// Autenticación contra Google (cuenta de servicio) para poder escribir en
// Firestore desde un Worker — no hay SDK de administrador de Firebase para
// este runtime, así que armamos el JWT a mano y lo canjeamos por un token.
// ---------------------------------------------------------------------------

function base64url(input) {
  let base64;
  if (typeof input === 'string') {
    base64 = btoa(input);
  } else {
    base64 = btoa(String.fromCharCode(...new Uint8Array(input)));
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .trim()
    .replace(/^["']|["']$/g, '') // comillas del JSON, si quedaron pegadas al copiar
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\n/g, '') // por si quedó guardado con "\n" literal (texto), no salto de línea real
    .replace(/\s/g, ''); // saltos de línea reales y espacios
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getGoogleAccessToken(env) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.FIREBASE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${base64url(signature)}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(`No se pudo obtener el token de Google: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

// ---------------------------------------------------------------------------
// Helpers de Firestore REST API
// ---------------------------------------------------------------------------

function firestoreDocsUrl(env) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

async function firestoreGetDoc(env, accessToken, path) {
  const response = await fetch(`${firestoreDocsUrl(env)}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Error al leer ${path} de Firestore: ${response.status}`);
  }
  return response.json();
}

/** Actualiza solo los campos indicados de un documento (el resto no se toca). */
async function firestorePatchFields(env, accessToken, path, fields) {
  const mask = Object.keys(fields)
    .map((name) => `updateMask.fieldPaths=${encodeURIComponent(name)}`)
    .join('&');
  const response = await fetch(`${firestoreDocsUrl(env)}/${path}?${mask}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    throw new Error(`Error al actualizar ${path} en Firestore: ${response.status}`);
  }
}

/**
 * Marca el pedido como pagado y descuenta stock de cada item, todo en un
 * único commit atómico: o se aplica todo, o no se aplica nada.
 */
async function markOrderPaidAndDecrementStock(env, accessToken, orderId, items) {
  const docRoot = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

  const writes = [
    {
      update: {
        name: `${docRoot}/pedidos/${orderId}`,
        fields: {
          status: { stringValue: 'paid' },
          paidAt: { timestampValue: new Date().toISOString() },
        },
      },
      updateMask: { fieldPaths: ['status', 'paidAt'] },
    },
    ...items
      .filter((item) => item.id && Number(item.qty) > 0)
      .map((item) => ({
        transform: {
          document: `${docRoot}/productos/${item.id}`,
          fieldTransforms: [
            {
              fieldPath: 'stock',
              increment: { integerValue: String(-Math.abs(Math.round(Number(item.qty)))) },
            },
          ],
        },
      })),
  ];

  const response = await fetch(`${firestoreDocsUrl(env)}:commit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ writes }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Firestore commit falló: ${response.status} ${errBody}`);
  }
}

// ---------------------------------------------------------------------------
// POST /webhook — Mercado Pago confirma acá el estado real del pago
// ---------------------------------------------------------------------------

/**
 * Valida la notificación con el esquema documentado por Mercado Pago
 * (HMAC-SHA256 sobre "id:<data.id lowercased>;request-id:<header>;ts:<header>;").
 *
 * Estado al 7/10/2026: con credenciales de PRUEBA y avisos de tipo "order"
 * la firma no coincide, aunque la clave cargada es la del panel (pestaña
 * "Modo de prueba") y este código valida bien una firma armada según la
 * documentación. Se probaron además unas 130 variantes (clave, id, fecha y
 * orden distintos) sin que coincida ninguna, así que no es un error de este
 * lado. Falta comprobar si con credenciales de producción coincide: mirar
 * los logs del primer pago real antes de activar REQUIRE_WEBHOOK_SIGNATURE.
 */
async function verifyMpSignature(request, env, dataId) {
  const signatureHeader = request.headers.get('x-signature') || '';
  const requestId = request.headers.get('x-request-id') || '';

  const parts = {};
  signatureHeader.split(',').forEach((piece) => {
    const [key, value] = piece.split('=');
    if (key && value) parts[key.trim()] = value.trim();
  });

  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1 || !env.MP_WEBHOOK_SECRET) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.MP_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  const computedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return computedHex === v1;
}

/**
 * Deja en el log (npx wrangler tail) los datos no secretos de un aviso cuya
 * firma no coincidió, para poder ver si pasa solo en modo prueba
 * (live_mode: false) o también con pagos reales.
 */
async function logSignatureMismatch(request, dataId) {
  let body = null;
  try {
    body = await request.clone().json();
  } catch {
    // aviso sin cuerpo JSON
  }
  console.error(
    'Firma de webhook no coincide ' +
      JSON.stringify({
        id: dataId,
        accion: body?.action ?? null,
        live_mode: body?.live_mode ?? null,
        application_id: body?.application_id ?? null,
        request_id: request.headers.get('x-request-id'),
      })
  );
}

async function handleWebhook(request, env) {
  const url = new URL(request.url);
  const dataId = url.searchParams.get('data.id') || url.searchParams.get('id');
  const topic = url.searchParams.get('type') || url.searchParams.get('topic');

  if (!dataId) {
    return new Response('ok', { status: 200 });
  }

  // El id va a parar a la URL de la API de Mercado Pago: solo letras y números.
  if (!/^[A-Za-z0-9]{1,64}$/.test(dataId)) {
    return new Response('ok', { status: 200 });
  }

  // La notificación no se toma como verdad: más abajo se consulta el pago a
  // Mercado Pago con el Access Token del comercio, y solo se marca "pagado"
  // si está aprobado, corresponde a ese pedido y cubre el total verificado.
  // Una notificación falsa no puede inventar un pago, así que la firma es una
  // segunda barrera. Se exige con REQUIRE_WEBHOOK_SIGNATURE = "true" en
  // wrangler.toml, una vez confirmado en los logs que las firmas reales
  // coinciden (si no, se rechazarían avisos de pagos legítimos).
  const signatureOk = await verifyMpSignature(request, env, dataId);
  if (!signatureOk) {
    if (env.REQUIRE_WEBHOOK_SIGNATURE === 'true') {
      console.error('Webhook rechazado: la firma no coincide.');
      return new Response('firma inválida', { status: 401 });
    }
    await logSignatureMismatch(request, dataId);
  }

  try {
    const resourceUrl =
      topic === 'payment'
        ? `https://api.mercadopago.com/v1/payments/${dataId}`
        : `https://api.mercadopago.com/v1/orders/${dataId}`;

    const resourceResponse = await fetch(resourceUrl, {
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
    });
    const resourceData = await resourceResponse.json();

    if (!resourceResponse.ok) {
      console.error('No se pudo obtener el recurso de Mercado Pago:', JSON.stringify(resourceData));
      return new Response('ok', { status: 200 });
    }

    const firstPayment = resourceData.transactions?.payments?.[0];
    const status = firstPayment?.status || resourceData.status;
    const statusDetail = firstPayment?.status_detail || resourceData.status_detail;
    const isApproved = status === 'approved' || statusDetail === 'accredited';
    const firestoreOrderId = resourceData.external_reference;

    if (!isApproved || !firestoreOrderId) {
      return new Response('ok', { status: 200 });
    }

    const accessToken = await getGoogleAccessToken(env);

    const existingDoc = await firestoreGetDoc(env, accessToken, `pedidos/${firestoreOrderId}`);
    if (!existingDoc) {
      console.error('No se encontró el pedido en Firestore:', firestoreOrderId);
      return new Response('ok', { status: 200 });
    }

    // Solo se procesa un pedido que sigue pendiente: si ya está pagado, en
    // preparación o cancelado desde el panel, el aviso no vuelve a descontar stock.
    if (existingDoc.fields?.status?.stringValue !== 'pending') {
      return new Response('ok', { status: 200 });
    }

    // Lo pagado tiene que cubrir el total que este Worker calculó al crear
    // el pago; si no hay total verificado, el pago no salió de acá.
    const verifiedTotal = fsNumber(existingDoc.fields?.verifiedTotal);
    const paidAmount = Number(resourceData.total_amount ?? resourceData.transaction_amount);
    if (!Number.isFinite(verifiedTotal) || !Number.isFinite(paidAmount) || paidAmount < verifiedTotal - 0.01) {
      console.error(
        `Monto pagado no coincide con el pedido ${firestoreOrderId}: pagado ${paidAmount}, esperado ${verifiedTotal}. No se marca como pagado.`
      );
      return new Response('ok', { status: 200 });
    }

    const itemsField = existingDoc.fields?.items?.arrayValue?.values || [];
    const items = itemsField.map((entry) => {
      const fields = entry.mapValue?.fields || {};
      return {
        id: fields.id?.stringValue,
        qty: Number(fields.qty?.integerValue ?? fields.qty?.doubleValue ?? 0),
      };
    });

    await markOrderPaidAndDecrementStock(env, accessToken, firestoreOrderId, items);

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('Error procesando el webhook:', err.message);
    return new Response('ok', { status: 200 });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // ALLOWED_ORIGIN admite varios dominios separados por coma (el de la
    // tienda y, por ejemplo, http://localhost:5173 para desarrollo). Si el
    // pedido viene de uno de la lista se le responde con ese; si no, con el
    // primero, y el navegador bloquea la respuesta.
    const origins = (env.ALLOWED_ORIGIN || '*').split(',').map((origin) => origin.trim()).filter(Boolean);
    const requestOrigin = request.headers.get('Origin');
    allowedOrigin = origins.includes('*') ? '*' : origins.includes(requestOrigin) ? requestOrigin : origins[0];

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === '/webhook') {
      return handleWebhook(request, env);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Método no permitido.' }, 405);
    }

    if (url.pathname === '/process-payment') {
      return handleProcessPayment(request, env);
    }

    return handleCreatePreference(request, env);
  },
};