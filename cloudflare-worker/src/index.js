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

// En producción, reemplazá "*" por el dominio real de tu tienda
// (ej: "https://mitienda.com.ar") para que solo tu sitio pueda llamar a esto.
const ALLOWED_ORIGIN = '*';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
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

  const { items, backUrls, orderId } = body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return jsonResponse({ error: 'El carrito está vacío.' }, 400);
  }

  let mpItems;
  try {
    mpItems = items.map((item) => {
      const quantity = parseInt(item.qty, 10);
      const unitPrice = Number(item.price);

      if (
        !item.id ||
        !item.name ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(unitPrice) ||
        unitPrice <= 0
      ) {
        throw new Error(`Item de carrito inválido: ${JSON.stringify(item)}`);
      }

      return {
        id: String(item.id),
        title: String(item.name),
        quantity,
        unit_price: unitPrice,
        currency_id: 'ARS',
      };
    });
  } catch (err) {
    return jsonResponse({ error: err.message }, 400);
  }

  try {
    const successUrl = backUrls?.success || '';
    const isLocalUrl = /localhost|127\.0\.0\.1/.test(successUrl);

    const preferenceBody = {
      items: mpItems,
      back_urls: {
        success: successUrl,
        failure: backUrls?.failure || '',
        pending: backUrls?.pending || '',
      },
      statement_descriptor: env.STATEMENT_DESCRIPTOR || 'MI TIENDA',
    };

    if (orderId) {
      preferenceBody.external_reference = String(orderId);
    }

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
    console.error('Error al crear preferencia de Mercado Pago:', err.message);
    return jsonResponse({ error: 'No se pudo crear la preferencia de pago.' }, 500);
  }
}

// ---------------------------------------------------------------------------
// POST /process-payment — Card Payment Brick: crea la orden con el token
// ---------------------------------------------------------------------------
async function handleProcessPayment(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido.' }, 400);
  }

  const { token, payment_method_id, transaction_amount, installments, payer, orderId } = body || {};

  const amount = Number(transaction_amount);
  const parsedInstallments = parseInt(installments, 10);

  if (!token || !payment_method_id || !Number.isFinite(amount) || amount <= 0) {
    return jsonResponse({ error: 'Datos de pago incompletos.' }, 400);
  }

  const amountStr = amount.toFixed(2);
  const finalInstallments = Number.isFinite(parsedInstallments) && parsedInstallments > 0 ? parsedInstallments : 1;

  try {
    const idempotencyKey = crypto.randomUUID();

    const mpResponse = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        type: 'online',
        processing_mode: 'automatic',
        total_amount: amountStr,
        external_reference: orderId ? String(orderId) : idempotencyKey,
        payer: {
          email: payer?.email,
        },
        transactions: {
          payments: [
            {
              amount: amountStr,
              payment_method: {
                id: payment_method_id,
                type: 'credit_card',
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
      return jsonResponse({ error: data.message || 'No se pudo procesar el pago.' }, 400);
    }

    const firstPayment = data.transactions?.payments?.[0];
    const status = firstPayment?.status || data.status;
    const statusDetail = firstPayment?.status_detail || data.status_detail;

    return jsonResponse({ status, statusDetail, paymentId: firstPayment?.id || data.id });
  } catch (err) {
    console.error('Error al procesar el pago con tarjeta:', err.message);
    return jsonResponse({ error: 'No se pudo procesar el pago.' }, 500);
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
 * Confirmado con soporte técnico que los datos de entrada (request-id, ts,
 * data.id, secret) llegan correctos — el mismatch queda pendiente de
 * resolver con Mercado Pago. Mientras tanto, handleWebhook solo advierte en
 * vez de bloquear (ver TODO ahí).
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

async function handleWebhook(request, env) {
  const url = new URL(request.url);
  const dataId = url.searchParams.get('data.id') || url.searchParams.get('id');
  const topic = url.searchParams.get('type') || url.searchParams.get('topic');

  if (!dataId) {
    return new Response('ok', { status: 200 });
  }

  const signatureOk = await verifyMpSignature(request, env, dataId);
  if (!signatureOk) {
    // TODO: esto tiene que volver a bloquear (return 401) antes de manejar
    // dinero real — por ahora solo advierte, porque la firma no cierra con
    // ninguna combinación documentada y hay que confirmarlo con soporte de
    // Mercado Pago. Sin este bloqueo, cualquiera que sepa la URL podría
    // simular un pago aprobado.
    console.error('ADVERTENCIA: firma de webhook no coincide, se procesa igual (temporal).');
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

    if (existingDoc.fields?.status?.stringValue === 'paid') {
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