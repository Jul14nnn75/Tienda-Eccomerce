// js/checkout.js
// Crea una preferencia de pago en Mercado Pago llamando a una Cloud Function
// propia (nunca se llama a la API de Mercado Pago directamente desde el
// navegador: el Access Token es secreto y solo puede vivir en el servidor).
//
// Antes de crear la preferencia, revalida el stock de cada item directo
// contra Firestore: el "stock" guardado en el carrito es una foto del
// momento en que se agregó, y puede haber quedado vieja (otro cliente
// compró el último, o el admin lo bajó en el panel).

import { getProductById, getAuthToken } from './firebase.js';

const CREATE_PREFERENCE_URL = import.meta.env.VITE_MP_CREATE_PREFERENCE_URL;

/**
 * Revisa el stock real en Firestore para cada item del carrito. Si el item
 * tiene variantId, valida el stock de ESA variante puntual (no el stock
 * "global" del producto, que con variantes deja de ser la fuente de verdad
 * — ver functions/index.js#buildItems, misma validación server-side).
 * @param {Array<{id:string, variantId?:string|null, name:string, qty:number}>} items
 * @returns {Promise<Array<{id:string, variantId:?string, name:string, reason:'discontinued'|'insufficient', available?:number}>>}
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
      problems.push({ id: item.id, variantId: item.variantId || null, name: item.name, reason: 'discontinued' });
      continue;
    }

    const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
    if (hasVariants) {
      const variant = item.variantId ? product.variants.find((v) => v.id === item.variantId) : null;
      if (!variant) {
        // La variante que tenía en el carrito ya no existe (el admin la borró).
        problems.push({ id: item.id, variantId: item.variantId || null, name: item.name, reason: 'discontinued' });
        continue;
      }
      const available = Number(variant.stock ?? 0);
      if (item.qty > available) {
        problems.push({ id: item.id, variantId: item.variantId, name: item.name, reason: 'insufficient', available });
      }
      continue;
    }

    const available = Number(product.stock ?? 0);
    if (item.qty > available) {
      problems.push({ id: item.id, variantId: null, name: item.name, reason: 'insufficient', available });
    }
  }

  return problems;
}

/**
 * @param {Array<{id:string, qty:number, variantId?:string|null}>} items  Solo se
 *   usan id, qty y variantId: el precio lo resuelve el servidor contra
 *   Firestore (el cliente no es confiable) — ver functions/index.js#buildItems.
 * @param {string} orderId  Pedido creado en Firestore (external_reference),
 *   ya con su campo `shipping` (método + dirección si corresponde — ver
 *   js/app.js). Obligatorio: sin un pedido para conciliar, el webhook de
 *   Mercado Pago no tiene forma de marcar el pago ni descontar stock (ver
 *   functions/index.js). El costo de envío no se manda acá: la Cloud
 *   Function lo calcula sola a partir de `order.shipping.method`.
 * @returns {Promise<string>} init_point — la URL del Checkout Pro de Mercado Pago
 */
export async function createMercadoPagoCheckout(items, orderId) {
  if (!CREATE_PREFERENCE_URL) {
    throw new Error(
      'Falta configurar VITE_MP_CREATE_PREFERENCE_URL en el .env (la URL de tu Cloud Function).'
    );
  }
  if (!orderId) {
    throw new Error('No se pudo registrar el pedido. Probá de nuevo.');
  }

  const token = await getAuthToken();
  if (!token) {
    throw new Error('No se pudo verificar tu sesión. Recargá la página y probá de nuevo.');
  }

  const response = await fetch(CREATE_PREFERENCE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      items: items.map(({ id, qty, variantId }) => ({ id, qty, variantId: variantId || null })),
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
