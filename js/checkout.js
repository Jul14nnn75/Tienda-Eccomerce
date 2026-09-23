// js/checkout.js
// Crea una preferencia de pago en Mercado Pago llamando a una Cloud Function
// propia (nunca se llama a la API de Mercado Pago directamente desde el
// navegador: el Access Token es secreto y solo puede vivir en el servidor).
//
// Antes de crear la preferencia, revalida el stock de cada item directo
// contra Firestore: el "stock" guardado en el carrito es una foto del
// momento en que se agregó, y puede haber quedado vieja (otro cliente
// compró el último, o el admin lo bajó en el panel).

import { getProductById } from './firebase.js';

const CREATE_PREFERENCE_URL = import.meta.env.VITE_MP_CREATE_PREFERENCE_URL;

/**
 * Revisa el stock real en Firestore para cada item del carrito.
 * @param {Array<{id:string, name:string, qty:number}>} items
 * @returns {Promise<Array<{id:string, name:string, reason:'discontinued'|'insufficient', available?:number}>>}
 *   Lista de problemas encontrados. Vacía = todo el carrito tiene stock suficiente.
 */
export async function validateCartStock(items) {
  const problems = [];

  const checks = await Promise.all(
    items.map(async (item) => {
      const product = await getProductById(item.id);
      return { item, product };
    })
  );

  for (const { item, product } of checks) {
    if (!product) {
      problems.push({ id: item.id, name: item.name, reason: 'discontinued' });
      continue;
    }
    const available = Number(product.stock ?? 0);
    if (item.qty > available) {
      problems.push({ id: item.id, name: item.name, reason: 'insufficient', available });
    }
  }

  return problems;
}

/**
 * @param {Array<{id:string, qty:number}>} items  Solo se usan id y qty: el precio
 *   lo resuelve el servidor contra Firestore (el cliente no es confiable).
 * @param {string|null} orderId  Pedido creado en Firestore (external_reference).
 * @returns {Promise<string>} init_point — la URL del Checkout Pro de Mercado Pago
 */
export async function createMercadoPagoCheckout(items, orderId = null) {
  if (!CREATE_PREFERENCE_URL) {
    throw new Error(
      'Falta configurar VITE_MP_CREATE_PREFERENCE_URL en el .env (la URL de tu Cloud Function).'
    );
  }

  const response = await fetch(CREATE_PREFERENCE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: items.map(({ id, qty }) => ({ id, qty })),
      orderId,
      backUrls: {
        success: `${window.location.origin}/pago/gracias.html`,
        failure: `${window.location.origin}/pago/pago-fallido.html`,
        pending: `${window.location.origin}/pago/pago-pendiente.html`,
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || 'No se pudo iniciar el pago con Mercado Pago.');
  }

  const data = await response.json();
  return data.init_point;
}
