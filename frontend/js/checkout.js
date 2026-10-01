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
const PROCESS_PAYMENT_URL = import.meta.env.VITE_MP_PROCESS_PAYMENT_URL;

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
 * @param {Array<{id:string, name:string, price:number, qty:number}>} items
 * @returns {Promise<string>} init_point — la URL del Checkout Pro de Mercado Pago
 */
export async function createMercadoPagoCheckout(items, orderId) {
  if (!CREATE_PREFERENCE_URL) {
    throw new Error(
      'Falta configurar VITE_MP_CREATE_PREFERENCE_URL en el .env (la URL de tu Cloud Function).'
    );
  }

  const response = await fetch(CREATE_PREFERENCE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items,
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

/**
 * Envía al Worker el objeto que devuelve el onSubmit del Card Payment Brick
 * (token, payment_method_id, installments, payer, etc.) para procesar el
 * pago con tarjeta sin salir del sitio.
 * @param {object} paymentData — lo que el Brick pasa a onSubmit
 * @returns {Promise<{status:'approved'|'in_process'|'rejected', statusDetail:string, paymentId:string}>}
 */
export async function processCardPayment(paymentData) {
  if (!PROCESS_PAYMENT_URL) {
    throw new Error(
      'Falta configurar VITE_MP_PROCESS_PAYMENT_URL en el .env (la URL de tu Worker + /process-payment).'
    );
  }

  const response = await fetch(PROCESS_PAYMENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(paymentData),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'No se pudo procesar el pago.');
  }

  return data;
}

/**
 * Envía al Worker el formData que devuelve el onSubmit del Payment Brick
 * genérico (efectivo/transferencia) para generar el pago sin salir del sitio.
 * @param {object} formData — lo que el Brick pasa a onSubmit
 * @returns {Promise<{status:string, statusDetail:string, paymentId:string, voucherUrl:string|null}>}
 */
