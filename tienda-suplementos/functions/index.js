// functions/index.js
// Cloud Function que crea una preferencia de pago en Mercado Pago (Checkout Pro)
// y devuelve el link para redirigir al comprador. El Access Token de Mercado
// Pago vive como secret de Firebase Functions: nunca se expone al navegador.

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const corsLib = require('cors');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const MP_ACCESS_TOKEN = defineSecret('MP_ACCESS_TOKEN');

// En producción, reemplazá "*" por el dominio real de tu tienda para evitar
// que cualquier sitio pueda llamar a esta función (ej: 'https://mitienda.com').
const cors = corsLib({ origin: true });

exports.createPreference = onRequest(
  { secrets: [MP_ACCESS_TOKEN], region: 'us-central1', cors: true },
  (req, res) => {
    cors(req, res, async () => {
      if (req.method !== 'POST') {
        res.status(405).json({ error: 'Método no permitido.' });
        return;
      }

      try {
        const { items, backUrls } = req.body || {};

        if (!Array.isArray(items) || items.length === 0) {
          res.status(400).json({ error: 'El carrito está vacío.' });
          return;
        }

        // Saneamos lo que llega del cliente: nunca confiamos ciegamente en el
        // precio/cantidad recibidos sin validar tipos básicos.
        const mpItems = items.map((item) => {
          const quantity = parseInt(item.qty, 10);
          const unitPrice = Number(item.price);

          if (!item.id || !item.name || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
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

        const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN.value() });
        const preference = new Preference(client);

        const result = await preference.create({
          body: {
            items: mpItems,
            back_urls: {
              success: backUrls?.success || '',
              failure: backUrls?.failure || '',
              pending: backUrls?.pending || '',
            },
            auto_return: 'approved',
            statement_descriptor: 'MI TIENDA',
          },
        });

        res.status(200).json({
          id: result.id,
          init_point: result.init_point,
        });
      } catch (err) {
        console.error('Error al crear preferencia de Mercado Pago:', err);
        res.status(500).json({ error: 'No se pudo crear la preferencia de pago.' });
      }
    });
  }
);