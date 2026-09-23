// functions/index.js
// Cloud Function que crea una preferencia de Mercado Pago (Checkout Pro) y
// devuelve el init_point para redirigir al comprador.
//
// Seguridad:
//  - El Access Token vive como secret de Firebase (MP_ACCESS_TOKEN), nunca en el cliente.
//  - Precio, nombre y stock se leen de Firestore con el Admin SDK: el cliente
//    solo envía { id, qty }, así nadie puede manipular el precio desde el navegador.

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { MercadoPagoConfig, Preference } = require('mercadopago');

initializeApp();
const db = getFirestore();

const MP_ACCESS_TOKEN = defineSecret('MP_ACCESS_TOKEN');

// Configurables vía functions/.env (ver functions/.env.example)
const CURRENCY_ID = process.env.MP_CURRENCY_ID || 'ARS';
const STATEMENT_DESCRIPTOR = process.env.MP_STATEMENT_DESCRIPTOR || 'MI TIENDA';
// Lista separada por comas de orígenes permitidos. Vacío = cualquiera (solo para desarrollo).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Mismo criterio que js/utils.js#getFinalPrice
function getFinalPrice(product) {
  const list = Number(product.listPrice);
  const offer = Number(product.offerPrice);
  const validOffer = product.offerPrice != null && Number.isFinite(offer) && offer > 0 && offer < list;
  return validOffer ? offer : list;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
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
      const unitPrice = getFinalPrice(product);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new HttpError(409, `"${product.name}" no tiene un precio válido.`);
      }
      if (Number(product.stock ?? 0) < quantity) {
        throw new HttpError(409, `Stock insuficiente para "${product.name}".`);
      }

      return {
        id: snap.id,
        title: String(product.name),
        quantity,
        unit_price: unitPrice,
        currency_id: CURRENCY_ID,
      };
    })
  );
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
      const { items, backUrls, orderId } = req.body || {};
      const mpItems = await buildItems(items);

      const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN.value() });
      const preference = new Preference(client);

      const result = await preference.create({
        body: {
          items: mpItems,
          external_reference: orderId ? String(orderId) : undefined,
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
