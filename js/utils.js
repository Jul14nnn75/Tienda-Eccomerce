// js/utils.js
// Helpers compartidos por la tienda (app.js) y el panel (admin.js).

import { STORE_NAME, LOCALE, CURRENCY_SYMBOL } from './config.js';

export function formatPrice(value) {
  return `${CURRENCY_SYMBOL}${Number(value ?? 0).toLocaleString(LOCALE, { minimumFractionDigits: 0 })}`;
}

/**
 * Escapa texto antes de insertarlo en HTML armado con template strings.
 * Evita que datos de Firestore con "<", comillas o "&" rompan el markup
 * (o inyecten HTML).
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** % de descuento entre precio de lista y oferta (0 si la oferta no es válida). */
export function calcDiscount(listPrice, offerPrice) {
  const list = Number(listPrice);
  const offer = Number(offerPrice);
  if (!list || list <= 0) return 0;
  if (offerPrice == null || offerPrice === '' || Number.isNaN(offer)) return 0;
  if (offer <= 0 || offer >= list) return 0;
  return Math.round(((list - offer) / list) * 100);
}

export function hasValidOffer(product) {
  return calcDiscount(product.listPrice, product.offerPrice) > 0;
}

/** Precio efectivo de venta (oferta si es válida, si no lista). */
export function getFinalPrice(product) {
  return hasValidOffer(product) ? product.offerPrice : product.listPrice;
}

// ---------------------------------------------------------------------------
// Variantes (talle/color/SKU/stock propio) — mismo criterio que
// functions/index.js (findVariant/formatVariantLabel/getFinalPrice), porque
// el cliente y el servidor son runtimes separados y no comparten código.
// Un producto sin `variants` (o con el array vacío) sigue siendo un
// producto "simple", con stock propio — comportamiento idéntico al de
// antes de agregar variantes.
// ---------------------------------------------------------------------------

export function hasVariants(product) {
  return Array.isArray(product?.variants) && product.variants.length > 0;
}

/** Stock total: la suma de las variantes si las tiene, o el stock simple si no. */
export function getProductStock(product) {
  if (hasVariants(product)) {
    return product.variants.reduce((sum, v) => sum + Number(v?.stock ?? 0), 0);
  }
  return Number(product?.stock ?? 0);
}

/** "M / Negra" — mismo formato en la tienda, el carrito y los mails. */
export function formatVariantLabel(variant) {
  if (!variant) return '';
  return [variant?.size, variant?.color].filter(Boolean).join(' / ');
}

/** Precio a cobrar por una variante: el propio si tiene uno válido, si no el del producto. */
export function getVariantPrice(product, variant) {
  const variantPrice = Number(variant?.price);
  if (variant?.price != null && Number.isFinite(variantPrice) && variantPrice > 0) {
    return variantPrice;
  }
  return getFinalPrice(product);
}

/** Notificación flotante. Requiere un #toast-container en la página. */
export function showToast(message, type = 'success', duration = 2500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : 'toast-success'}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.2s ease-out';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

/** Reemplaza el nombre por defecto en <title> y en los elementos [data-store-name]. */
export function applyStoreName() {
  document.title = document.title.replace('Mi Tienda', STORE_NAME);
  document.querySelectorAll('[data-store-name]').forEach((el) => {
    el.textContent = STORE_NAME;
  });
}
