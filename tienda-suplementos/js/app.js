// js/app.js
// Catálogo público: suscripción a Firestore, filtros/búsqueda en memoria,
// render de tarjetas de producto, modal de detalle, carrito y checkout
// con Mercado Pago.

import {
  subscribeToProducts,
  subscribeToCategories,
  subscribeToShippingSettings,
  ensureAnonymousAuth,
  createOrder,
} from './firebase.js';
import { normalizeShippingSettings, quoteShipping } from './shipping.js';
import {
  addToCart,
  getCart,
  getCartCount,
  getCartTotal,
  updateQty,
  removeFromCart,
  setCartNamespace,
  syncItemStock,
  syncItemPrice,
  clearCart,
} from './cart.js';
import {
  createMercadoPagoCheckout,
  validateCartStock,
  processCardPayment,
} from './checkout.js';

import tienda from '../tienda.config.js';

// Zonas y costos de envío: los edita el admin en la pestaña "Envíos" (Firestore,
// config/envios). Hasta que llega ese documento, o si no existe, valen los de
// tienda.config.js. El Worker de pagos hace exactamente la misma cuenta.
let shippingSettings = normalizeShippingSettings(null, tienda.shipping);

let currentUser = null;
const state = {
  allProducts: [],
  searchTerm: '',
  activeCategory: 'Todo',
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  shipping: {
    method: 'pickup', // 'pickup' | 'delivery'
    address: '',
    city: '',
    zip: '',
    cost: 0,
    zone: null,
  },
};

const grid = document.getElementById('product-grid');
const gridSkeleton = document.getElementById('product-grid-skeleton');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const categoryNav = document.getElementById('category-nav');
const categoryTabsDynamic = document.getElementById('category-tabs-dynamic');
const cartCountBadge = document.getElementById('cart-count');
const cartButton = document.getElementById('cart-button');
const cartDrawer = document.getElementById('cart-drawer');
const cartOverlay = document.getElementById('cart-overlay');
const cartCloseBtn = document.getElementById('cart-close');
const cartItemsContainer = document.getElementById('cart-items');
const cartSubtotalEl = document.getElementById('cart-subtotal');
const cartShippingRow = document.getElementById('cart-shipping-row');
const cartShippingCostEl = document.getElementById('cart-shipping-cost');
const cartTotalEl = document.getElementById('cart-total');
const cartCheckoutBtn = document.getElementById('cart-checkout');
const cartCheckoutCardBtn = document.getElementById('cart-checkout-card');

// --- DOM: envío ---
const shippingPickupBtn = document.getElementById('shipping-pickup-btn');
const shippingDeliveryBtn = document.getElementById('shipping-delivery-btn');
const pickupInfo = document.getElementById('pickup-info');
const deliveryForm = document.getElementById('delivery-form');
const shippingAddressInput = document.getElementById('shipping-address');
const shippingCityInput = document.getElementById('shipping-city');
const shippingZipInput = document.getElementById('shipping-zip');
const shippingAddressError = document.getElementById('shipping-address-error');
const customerNameInput = document.getElementById('customer-name');
const customerPhoneInput = document.getElementById('customer-phone');
const customerEmailInput = document.getElementById('customer-email');
const customerInfoError = document.getElementById('customer-info-error');

const cardPaymentModal = document.getElementById('card-payment-modal');
const cardPaymentClose = document.getElementById('card-payment-close');
const cardPaymentError = document.getElementById('card-payment-error');
const cardPaymentResult = document.getElementById('card-payment-result');

const cartEmptyMsg = document.getElementById('cart-empty-msg');
const cartDrawerCount = document.getElementById('cart-drawer-count');
const cartCheckoutSections = document.getElementById('cart-checkout-sections');
const cardPaymentAmount = document.getElementById('card-payment-amount');
const toastContainer = document.getElementById('toast-container');

const detailModal = document.getElementById('product-detail-modal');
const detailClose = document.getElementById('product-detail-close');
const detailImage = document.getElementById('product-detail-image');
const detailBrand = document.getElementById('product-detail-brand');
const detailName = document.getElementById('product-detail-name');
const detailBadgeWrap = document.getElementById('product-detail-badge-wrap');
const detailBadge = document.getElementById('product-detail-badge');
const detailListPrice = document.getElementById('product-detail-list-price');
const detailPrice = document.getElementById('product-detail-price');
const detailDescription = document.getElementById('product-detail-description');
const detailFlavor = document.getElementById('product-detail-flavor');
const detailCategory = document.getElementById('product-detail-category');
const detailStock = document.getElementById('product-detail-stock');
const detailAddBtn = document.getElementById('product-detail-add');

function formatPrice(value) {
  return `$${Number(value ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })}`;
}

const shippingCostInfo = document.getElementById('shipping-cost-info');

/**
 * Escapa texto antes de insertarlo en HTML armado por template strings.
 * Protege contra datos de Firestore que contengan comillas, "<" o "&"
 * (por ejemplo, si alguien pegó por error un <img> completo en el campo
 * "Imagen" en vez de una URL simple) — sin esto, esos caracteres rompen
 * la estructura del HTML de la card y el resto queda como texto visible.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, type = 'success') {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : 'toast-success'}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s ease-out';
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

function calcDiscount(listPrice, offerPrice) {
  const list = Number(listPrice);
  const offer = Number(offerPrice);

  if (!list || list <= 0) return 0;
  if (offerPrice == null || offerPrice === '' || Number.isNaN(offer)) return 0;
  if (offer <= 0 || offer >= list) return 0;

  return Math.round(((list - offer) / list) * 100);
}

function hasValidOffer(product) {
  return calcDiscount(product.listPrice, product.offerPrice) > 0;
}

function handleAddToCart(product) {
  const result = addToCart({
    id: product.id,
    name: product.name,
    price: hasValidOffer(product) ? product.offerPrice : product.listPrice,
    image: product.image,
    stock: product.stock,
  });

  if (result.cappedByStock && result.added <= 0) {
    showToast('Ya tenés en el carrito todo el stock disponible de este producto.', 'error');
    return;
  }
  if (result.cappedByStock) {
    showToast('Se agregó lo que quedaba de stock disponible.', 'error');
  }

  openCartDrawer();
}

function renderProductCard(product) {
  const isOffer = hasValidOffer(product);
  const discount = isOffer ? calcDiscount(product.listPrice, product.offerPrice) : 0;
  const finalPrice = isOffer ? product.offerPrice : product.listPrice;
  const hasStock = (product.stock ?? 0) > 0;

  const card = document.createElement('article');
  card.className = 'product-card group cursor-pointer';
  card.dataset.productId = product.id;
  card.innerHTML = `
    <div class="relative aspect-square bg-white flex items-center justify-center overflow-hidden">
      <div class="image-spinner absolute inset-0 flex items-center justify-center">
        <svg class="w-6 h-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
      </div>
      <img
        src="${escapeHtml(product.image) || 'https://placehold.co/400x400?text=Sin+imagen'}"
        alt="${escapeHtml(product.name)}"
        class="relative z-10 object-contain w-full h-full p-4 opacity-0 transition duration-300 group-hover:scale-105 ${!hasStock ? 'grayscale opacity-60' : ''}"
        loading="lazy"
        onload="this.classList.remove('opacity-0'); this.previousElementSibling.remove();"
        onerror="this.previousElementSibling.remove();"
      />
      ${
        isOffer
          ? `<span class="badge-offer absolute top-2 left-2 z-20 rounded-full px-2.5 py-1 shadow-sm">${discount}% OFF</span>`
          : ''
      }
      ${
        !hasStock
          ? '<span class="absolute bottom-2 left-2 z-20 rounded-full px-2.5 py-1 text-xs font-bold bg-gray-900/80 text-white">Sin stock</span>'
          : ''
      }
    </div>
    <div class="p-4 flex flex-col flex-1 gap-2">
      ${product.brand ? `<span class="text-xs text-gray-400 font-medium">${escapeHtml(product.brand)}</span>` : ''}
      <h3 class="font-bold text-sm leading-snug line-clamp-2 min-h-[2.5rem] dark:text-white">
        ${escapeHtml(product.name)}
      </h3>

      ${
        product.flavor
          ? `<span class="text-[11px] text-gray-400 dark:text-gray-500">Sabor: ${escapeHtml(product.flavor)}</span>`
          : ''
      }

      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mt-1">
        ${isOffer ? `<span class="text-gray-400 text-xs line-through">${formatPrice(product.listPrice)}</span>` : ''}
        <p class="text-brand-primary-dark dark:text-brand-accent text-xl font-extrabold leading-none">
          ${formatPrice(finalPrice)}
        </p>
      </div>

      <button
        class="btn-primary text-sm mt-auto flex items-center justify-center gap-2 ${!hasStock ? 'opacity-50 cursor-not-allowed active:scale-100' : ''}"
        data-add-to-cart="${product.id}"
        ${!hasStock ? 'disabled' : ''}
      >
        ${
          hasStock
            ? `<svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span>Agregar<span class="hidden sm:inline"> al carrito</span></span>`
            : 'Sin stock'
        }
      </button>
    </div>
  `;
  return card;
}

function renderGrid() {
  const term = state.searchTerm.trim().toLowerCase();

  const filtered = state.allProducts.filter((product) => {
    const matchesCategory =
      state.activeCategory === 'Todo' ||
      (state.activeCategory === 'Ofertas' ? hasValidOffer(product) : product.category === state.activeCategory);

    const matchesSearch =
      !term ||
      product.name?.toLowerCase().includes(term) ||
      product.brand?.toLowerCase().includes(term) ||
      product.flavor?.toLowerCase().includes(term);

    return matchesCategory && matchesSearch;
  });

  grid.innerHTML = '';
  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    filtered.forEach((product) => grid.appendChild(renderProductCard(product)));
  }
}

let productBeingViewed = null;

function openProductModal(product) {
  productBeingViewed = product;
  const isOffer = hasValidOffer(product);
  const discount = isOffer ? calcDiscount(product.listPrice, product.offerPrice) : 0;
  const finalPrice = isOffer ? product.offerPrice : product.listPrice;
  const hasStock = (product.stock ?? 0) > 0;

  detailImage.src = product.image || 'https://placehold.co/600x600?text=Sin+imagen';
  detailImage.alt = product.name;
  detailBrand.textContent = product.brand || '';
  detailBrand.classList.toggle('hidden', !product.brand);
  detailName.textContent = product.name;

  detailBadgeWrap.classList.toggle('hidden', !isOffer);
  if (isOffer) detailBadge.textContent = `${discount}% OFF`;

  detailListPrice.classList.toggle('hidden', !isOffer);
  if (isOffer) detailListPrice.textContent = formatPrice(product.listPrice);
  detailPrice.textContent = formatPrice(finalPrice);

  detailDescription.textContent = product.description || 'Sin descripción disponible.';

  detailFlavor.textContent = product.flavor ? `Sabor: ${product.flavor}` : '';
  detailFlavor.classList.toggle('hidden', !product.flavor);
  detailCategory.textContent = product.category || '';
  detailCategory.classList.toggle('hidden', !product.category);

  if (hasStock) {
    detailStock.textContent = `Stock disponible: ${product.stock}`;
    detailStock.className = 'text-xs font-medium text-brand-primary-dark dark:text-brand-accent';
  } else {
    detailStock.textContent = 'Sin stock disponible';
    detailStock.className = 'text-xs font-medium text-red-500';
  }

  detailAddBtn.disabled = !hasStock;
  detailAddBtn.textContent = hasStock ? 'AGREGAR AL CARRITO' : 'SIN STOCK';
  detailAddBtn.classList.toggle('opacity-50', !hasStock);
  detailAddBtn.classList.toggle('cursor-not-allowed', !hasStock);

  detailModal.classList.remove('hidden');
}

function closeProductModal() {
  detailModal.classList.add('hidden');
  productBeingViewed = null;
}

detailClose?.addEventListener('click', closeProductModal);
detailModal?.addEventListener('click', (e) => {
  if (e.target === detailModal) closeProductModal();
});
detailAddBtn?.addEventListener('click', () => {
  if (productBeingViewed) handleAddToCart(productBeingViewed);
});

function renderCartBadge() {
  const count = getCartCount();
  cartCountBadge.textContent = count;
  cartCountBadge.classList.toggle('hidden', count === 0);
}

function renderCartDrawer() {
  const items = getCart();
  cartItemsContainer.innerHTML = '';

  const units = items.reduce((sum, item) => sum + item.qty, 0);
  cartDrawerCount.textContent = units === 0 ? '' : units === 1 ? '1 producto' : `${units} productos`;
  cartCheckoutSections.classList.toggle('hidden', items.length === 0);

  if (items.length === 0) {
    cartEmptyMsg.classList.remove('hidden');
    [cartCheckoutBtn, cartCheckoutCardBtn].forEach((btn) => {
      btn.disabled = true;
      btn.classList.add('opacity-50', 'cursor-not-allowed');
    });
  } else {
    cartEmptyMsg.classList.add('hidden');
    [cartCheckoutBtn, cartCheckoutCardBtn].forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove('opacity-50', 'cursor-not-allowed');
    });

    items.forEach((item) => {
      const atMax = Number.isFinite(item.stock) && item.qty >= item.stock;
      const row = document.createElement('div');
      row.className = 'flex gap-3 py-4 border-b last:border-b-0 border-brand-border dark:border-gray-700';
      row.innerHTML = `
        <img src="${escapeHtml(item.image || 'https://placehold.co/64x64')}" alt=""
             class="w-16 h-16 object-contain bg-white rounded-lg border border-brand-border dark:border-gray-700 p-1 flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm font-semibold leading-snug line-clamp-2">${escapeHtml(item.name)}</p>
            <button class="p-1 -mt-1 -mr-1 rounded text-gray-400 hover:text-red-500 transition-colors flex-shrink-0" data-remove="${item.id}" aria-label="Quitar del carrito" title="Quitar">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
          </div>
          <div class="flex items-center justify-between gap-2 mt-2">
            <div class="inline-flex items-center rounded-md border border-brand-border dark:border-gray-600">
              <button class="w-7 h-7 text-sm font-bold hover:bg-gray-100 dark:hover:bg-gray-700 rounded-l-md" data-qty-minus="${item.id}" aria-label="Restar una unidad">−</button>
              <span class="text-sm w-7 text-center font-semibold">${item.qty}</span>
              <button
                class="w-7 h-7 text-sm font-bold hover:bg-gray-100 dark:hover:bg-gray-700 rounded-r-md ${atMax ? 'opacity-40 cursor-not-allowed' : ''}"
                data-qty-plus="${item.id}"
                aria-label="Sumar una unidad"
                ${atMax ? 'disabled title="Alcanzaste el stock disponible"' : ''}
              >+</button>
            </div>
            <p class="text-brand-primary-dark dark:text-brand-accent font-bold text-sm">${formatPrice(item.price * item.qty)}</p>
          </div>
          ${atMax ? `<p class="text-[11px] text-amber-600 dark:text-amber-400 mt-1">Stock máximo alcanzado</p>` : ''}
        </div>
      `;
      cartItemsContainer.appendChild(row);
    });
  }

  updateShippingCostDisplay();
}

function getShippingQuote() {
  return quoteShipping(shippingSettings, {
    method: state.shipping.method,
    zip: state.shipping.zip,
    subtotal: getCartTotal(),
  });
}

/** Texto debajo de la dirección: zona detectada, costo y envío gratis. */
function renderShippingInfo(quote) {
  if (!shippingCostInfo) return;
  const { freeFrom, zones } = shippingSettings;
  const zipTyped = state.shipping.zip.trim().length >= 4;
  const lines = [];

  if (!quote.available) {
    lines.push(zipTyped ? 'Por ahora no hacemos envíos a ese código postal.' : 'Ingresá tu código postal para ver el costo de envío.');
  } else if (quote.free) {
    lines.push('¡Tu compra tiene envío gratis!');
  } else {
    if (zones.length > 0 && !zipTyped) {
      lines.push('Ingresá tu código postal para ver el costo de envío de tu zona.');
    } else {
      const where = quote.zoneName ? ` a ${quote.zoneName}` : '';
      lines.push(quote.cost > 0 ? `Envío${where}: ${formatPrice(quote.cost)}.` : `Envío${where} sin cargo.`);
    }
    if (freeFrom > 0) lines.push(`Envío gratis en compras desde ${formatPrice(freeFrom)}.`);
  }

  shippingCostInfo.textContent = lines.join(' ');
  shippingCostInfo.classList.toggle('text-red-500', !quote.available && zipTyped);
  shippingCostInfo.classList.toggle('text-gray-400', quote.available || !zipTyped);
}

/**
 * Recalcula el costo de envío (según método elegido y subtotal), y repinta
 * subtotal / fila de envío / total en el footer del drawer.
 */
function updateShippingCostDisplay() {
  const subtotal = getCartTotal();
  const quote = getShippingQuote();
  const cost = quote.cost;
  state.shipping.cost = cost;
  state.shipping.zone = quote.zoneName;
  renderShippingInfo(quote);

  cartSubtotalEl.textContent = formatPrice(subtotal);
  cartShippingRow.classList.toggle('hidden', state.shipping.method !== 'delivery');
  cartShippingCostEl.textContent = cost === 0 ? 'Gratis' : formatPrice(cost);
  cartTotalEl.textContent = formatPrice(subtotal + cost);
}

/** Cambia entre "Retiro en el local" y "Envío a domicilio", y actualiza la UI. */
function setShippingMethod(method) {
  state.shipping.method = method;
  shippingPickupBtn.classList.toggle('shipping-option-active', method === 'pickup');
  shippingDeliveryBtn.classList.toggle('shipping-option-active', method === 'delivery');
  pickupInfo.classList.toggle('hidden', method !== 'pickup');
  deliveryForm.classList.toggle('hidden', method !== 'delivery');
  shippingAddressError.classList.add('hidden');
  updateShippingCostDisplay();
}

shippingPickupBtn?.addEventListener('click', () => setShippingMethod('pickup'));
shippingDeliveryBtn?.addEventListener('click', () => setShippingMethod('delivery'));

shippingAddressInput?.addEventListener('input', (e) => {
  state.shipping.address = e.target.value;
});
shippingCityInput?.addEventListener('input', (e) => {
  state.shipping.city = e.target.value;
});
shippingZipInput?.addEventListener('input', (e) => {
  state.shipping.zip = e.target.value;
  updateShippingCostDisplay(); // el costo depende de la zona del código postal
});

/** true si no hace falta dirección (retiro), o si la dirección de envío está completa. */
function isShippingAddressValid() {
  if (state.shipping.method !== 'delivery') return true;
  return Boolean(state.shipping.address.trim() && state.shipping.city.trim() && state.shipping.zip.trim());
}

customerNameInput?.addEventListener('input', (e) => {
  state.customerName = e.target.value;
});
customerPhoneInput?.addEventListener('input', (e) => {
  state.customerPhone = e.target.value;
});
customerEmailInput?.addEventListener('input', (e) => {
  state.customerEmail = e.target.value;
});

// Solo ASCII: Mercado Pago rechaza emails con ñ o acentos (y el Brick, al
// recibir un email inválido, vuelve a mostrar su propio campo "E-mail").
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Pedido ya creado para el carrito actual: si el pago falla y el cliente
// reintenta sin cambiar nada, se reutiliza en vez de crear otro pedido
// "Pendiente de pago" duplicado en el dashboard.
let pendingOrder = null; // { key, orderId }

/** Hacen falta siempre, incluso para retiro en el local (para poder contactar al cliente). */
function isCustomerInfoValid() {
  return Boolean(state.customerName.trim() && state.customerPhone.trim() && state.customerEmail.trim());
}

function openCartDrawer() {
  cartDrawer.classList.remove('translate-x-full');
  cartOverlay.classList.remove('hidden');
}

function closeCartDrawer() {
  cartDrawer.classList.add('translate-x-full');
  cartOverlay.classList.add('hidden');
}

searchInput?.addEventListener('input', (e) => {
  state.searchTerm = e.target.value;
  renderGrid();
});

// Delegado en el <nav>: funciona tanto para "Todo"/"Ofertas" (fijos en el
// HTML) como para los tabs de categoría que se generan dinámicamente abajo.
categoryNav?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-category]');
  if (!btn) return;

  state.activeCategory = btn.dataset.category;
  categoryNav.querySelectorAll('[data-category]').forEach((b) => b.classList.remove('category-tab-active'));
  btn.classList.add('category-tab-active');
  renderGrid();
});

/** Genera los tabs de categoría (entre "Todo" y "Ofertas") a partir de Firestore. */
function renderCategoryTabs(categories) {
  if (!categoryTabsDynamic) return;
  categoryTabsDynamic.innerHTML = '';

  categories.forEach((cat) => {
    const btn = document.createElement('button');
    btn.dataset.category = cat.name;
    btn.className = 'category-tab whitespace-nowrap';
    if (state.activeCategory === cat.name) btn.classList.add('category-tab-active');
    btn.textContent = cat.name;
    categoryTabsDynamic.appendChild(btn);
  });
}

subscribeToCategories((categories) => {
  renderCategoryTabs(categories);
});

grid?.addEventListener('click', (e) => {
  const addBtn = e.target.closest('[data-add-to-cart]');
  if (addBtn) {
    const product = state.allProducts.find((p) => p.id === addBtn.dataset.addToCart);
    if (product) handleAddToCart(product);
    return;
  }

  const card = e.target.closest('[data-product-id]');
  if (card) {
    const product = state.allProducts.find((p) => p.id === card.dataset.productId);
    if (product) openProductModal(product);
  }
});

cartItemsContainer?.addEventListener('click', (e) => {
  const plusBtn = e.target.closest('[data-qty-plus]');
  const minusBtn = e.target.closest('[data-qty-minus]');
  const removeBtn = e.target.closest('[data-remove]');

  if (plusBtn) {
    const item = getCart().find((i) => i.id === plusBtn.dataset.qtyPlus);
    if (item) {
      if (Number.isFinite(item.stock) && item.qty >= item.stock) {
        showToast('Alcanzaste el stock disponible de este producto.', 'error');
      } else {
        updateQty(item.id, item.qty + 1);
      }
    }
  }
  if (minusBtn) {
    const item = getCart().find((i) => i.id === minusBtn.dataset.qtyMinus);
    if (item) updateQty(item.id, item.qty - 1);
  }
  if (removeBtn) {
    removeFromCart(removeBtn.dataset.remove);
  }
});

cartButton?.addEventListener('click', openCartDrawer);
cartCloseBtn?.addEventListener('click', closeCartDrawer);
cartOverlay?.addEventListener('click', closeCartDrawer);

/**
 * Revalida el stock contra Firestore y registra el pedido. Lo usan tanto el
 * botón de Mercado Pago como el de tarjeta (Brick) — es el mismo checkpoint
 * de seguridad para los dos caminos de pago.
 * @returns {Promise<Array|null>} el carrito ya validado, o null si hubo que
 *   frenar (carrito vacío, dirección de envío incompleta, o algún item sin
 *   stock suficiente).
 */
async function prepareCheckout() {
  const items = getCart();
  if (items.length === 0) return null;

  if (!isCustomerInfoValid()) {
    customerInfoError.textContent = 'Completá tu nombre, teléfono y email para continuar.';
    customerInfoError.classList.remove('hidden');
    showToast('Completá tu nombre, teléfono y email para continuar.', 'error');
    return null;
  }
  // Mercado Pago rechaza el pago (400) si el email del comprador no tiene
  // formato válido, así que lo frenamos acá antes de crear el pedido.
  if (!EMAIL_REGEX.test(state.customerEmail.trim())) {
    customerInfoError.textContent = 'Ingresá un email válido, sin ñ ni acentos (ej: nombre@gmail.com).';
    customerInfoError.classList.remove('hidden');
    showToast('Ingresá un email válido para continuar.', 'error');
    return null;
  }
  customerInfoError.classList.add('hidden');

  if (!isShippingAddressValid()) {
    shippingAddressError.textContent = 'Completá la dirección de envío para continuar.';
    shippingAddressError.classList.remove('hidden');
    showToast('Completá la dirección de envío para continuar.', 'error');
    return null;
  }
  if (!getShippingQuote().available) {
    shippingAddressError.textContent = 'Por ahora no hacemos envíos a ese código postal. Podés elegir retiro en el local.';
    shippingAddressError.classList.remove('hidden');
    showToast('No hacemos envíos a ese código postal.', 'error');
    return null;
  }
  shippingAddressError.classList.add('hidden');

  const problems = await validateCartStock(items);

  if (problems.length > 0) {
    problems.forEach((problem) => {
      if (problem.reason === 'discontinued') {
        removeFromCart(problem.id);
        showToast(`"${problem.name}" ya no está disponible y se quitó del carrito.`, 'error');
      } else if (problem.reason === 'price') {
        syncItemPrice(problem.id, problem.price);
        showToast(`El precio de "${problem.name}" cambió — se actualizó el carrito.`, 'error');
      } else {
        syncItemStock(problem.id, problem.available);
        showToast(
          `Solo quedan ${problem.available} unidades de "${problem.name}" — se ajustó la cantidad.`,
          'error'
        );
      }
    });
    return null; // el cliente revisa el carrito actualizado y vuelve a tocar "Pagar"
  }

  // Sin sesión no se puede guardar el pedido, y el Worker no cobra nada que
  // no esté atado a un pedido (de ahí saca el monto real).
  if (!currentUser) {
    showToast('No se pudo iniciar tu sesión. Recargá la página y volvé a intentar.', 'error');
    return null;
  }

  let orderId = null;
  if (currentUser) {
    const orderData = {
      userId: currentUser.uid,
      customerName: state.customerName.trim(),
      customerPhone: state.customerPhone.trim(),
      customerEmail: state.customerEmail.trim(),
      items: getCart().map((item) => ({ id: item.id, name: item.name, price: item.price, qty: item.qty })),
      total: getCartTotal() + state.shipping.cost,
      shipping: {
        method: state.shipping.method,
        cost: state.shipping.cost,
        zone: state.shipping.method === 'delivery' ? state.shipping.zone : null,
        address:
          state.shipping.method === 'delivery'
            ? { address: state.shipping.address, city: state.shipping.city, zip: state.shipping.zip }
            : null,
      },
    };
    const orderKey = JSON.stringify(orderData);

    if (pendingOrder?.key === orderKey) {
      orderId = pendingOrder.orderId;
    } else {
      const orderRef = await createOrder(orderData);
      orderId = orderRef.id;
      pendingOrder = { key: orderKey, orderId };
    }
  }

  // orderId conecta este pedido con el pago en Mercado Pago (external_reference)
  // — el webhook lo usa para saber qué pedido marcar como pagado y a qué
  // productos descontarles stock cuando el pago se confirma de verdad.
  return { items: getCart(), orderId };
}

cartCheckoutBtn?.addEventListener('click', async () => {
  if (getCart().length === 0) return;

  const originalText = cartCheckoutBtn.textContent;
  cartCheckoutBtn.disabled = true;
  cartCheckoutBtn.textContent = 'Verificando stock...';

  try {
    const result = await prepareCheckout();
    if (!result) return;
    const { items, orderId } = result;

    const mpItems =
      state.shipping.cost > 0
        ? [...items, { id: 'envio', name: 'Costo de envío', qty: 1, price: state.shipping.cost }]
        : items;

    cartCheckoutBtn.textContent = 'Redirigiendo a Mercado Pago...';
    const initPoint = await createMercadoPagoCheckout(mpItems, orderId);
    window.location.href = initPoint;
  } catch (err) {
    console.error(err);
    showToast(err.message || 'No se pudo iniciar el pago con Mercado Pago.', 'error');
  } finally {
    cartCheckoutBtn.disabled = false;
    cartCheckoutBtn.textContent = originalText;
  }
});

// ---------------------------------------------------------------------------
// Pago con tarjeta sin salir del sitio (Card Payment Brick de Mercado Pago)
// ---------------------------------------------------------------------------

let mpInstance = null;
let cardPaymentBrickController = null;

function getMercadoPago() {
  if (!mpInstance) {
    const publicKey = import.meta.env.VITE_MP_PUBLIC_KEY;
    if (!publicKey) {
      throw new Error('Falta configurar VITE_MP_PUBLIC_KEY en el .env.');
    }
    // window.MercadoPago lo trae el <script src="https://sdk.mercadopago.com/js/v2">
    mpInstance = new window.MercadoPago(publicKey, { locale: 'es-AR' });
  }
  return mpInstance;
}

async function unmountCardBrick() {
  if (cardPaymentBrickController) {
    try {
      await cardPaymentBrickController.unmount();
    } catch (err) {
      console.error('Error al desmontar el Brick:', err);
    }
    cardPaymentBrickController = null;
  }
}

function closeCardPaymentModal() {
  cardPaymentModal.classList.add('hidden');
  unmountCardBrick();
}

cardPaymentClose?.addEventListener('click', closeCardPaymentModal);
cardPaymentModal?.addEventListener('click', (e) => {
  if (e.target === cardPaymentModal) closeCardPaymentModal();
});

function showCardPaymentError(message) {
  cardPaymentResult.classList.add('hidden');
  cardPaymentError.textContent = message;
  cardPaymentError.classList.remove('hidden');
}

function showCardPaymentResult(message, tone) {
  cardPaymentError.classList.add('hidden');
  cardPaymentResult.textContent = message;
  cardPaymentResult.className =
    tone === 'success'
      ? 'text-sm mb-3 text-brand-primary-dark dark:text-brand-accent'
      : 'text-sm mb-3 text-amber-600 dark:text-amber-400';
  cardPaymentResult.classList.remove('hidden');
}

cartCheckoutCardBtn?.addEventListener('click', async () => {
  if (getCart().length === 0) return;

  const originalText = cartCheckoutCardBtn.textContent;
  cartCheckoutCardBtn.disabled = true;
  cartCheckoutCardBtn.textContent = 'Verificando stock...';

  try {
    const result = await prepareCheckout();
    if (!result) return;
    const { orderId } = result;

    const amount = getCartTotal() + state.shipping.cost;

    cardPaymentError.classList.add('hidden');
    cardPaymentResult.classList.add('hidden');
    closeCartDrawer();
    cardPaymentModal.classList.remove('hidden');

    const isDark = document.documentElement.classList.contains('dark');
    cardPaymentAmount.textContent = formatPrice(amount);

    const mp = getMercadoPago();
    await unmountCardBrick();

    cardPaymentBrickController = await mp.bricks().create('cardPayment', 'cardPaymentBrick_container', {
      initialization: { amount, payer: { email: state.customerEmail.trim() } },
      customization: {
        visual: {
          hideFormTitle: true,
          texts: { formSubmit: `Pagar ${formatPrice(amount)}` },
          style: {
            theme: isDark ? 'dark' : 'default',
            // Colores de tienda.config.js, para que el formulario de Mercado
            // Pago no desentone con el resto del sitio.
            customVariables: {
              baseColor: tienda.theme.primary,
              baseColorFirstVariant: tienda.theme.primaryDark,
              baseColorSecondVariant: tienda.theme.primaryDark,
              buttonTextColor: '#ffffff',
              formBackgroundColor: isDark ? '#1f2937' : '#ffffff',
              inputBackgroundColor: isDark ? '#111827' : '#ffffff',
              textPrimaryColor: isDark ? '#f3f4f6' : '#111827',
              textSecondaryColor: isDark ? '#9ca3af' : '#6b7280',
              formPadding: '0px',
              borderRadiusMedium: '8px',
              borderRadiusLarge: '10px',
            },
          },
        },
      },
      callbacks: {
        onReady: () => {},
        onError: (error) => {
          console.error('Error del Card Payment Brick:', error);
          showCardPaymentError('Ocurrió un error al cargar el formulario de pago.');
        },
        // additionalData.paymentTypeId distingue crédito de débito.
        onSubmit: (cardFormData, additionalData) =>
          new Promise((resolve) => {
            processCardPayment({ ...cardFormData, orderId, paymentTypeId: additionalData?.paymentTypeId })
              .then((result) => {
                const isApproved = result.status === 'approved' || result.statusDetail === 'accredited';
                const isPending =
                  result.status === 'in_process' ||
                  result.statusDetail === 'pending_contingency' ||
                  result.statusDetail === 'in_process' ||
                  result.statusDetail === 'pending_review_manual';

                if (isApproved) {
                  showCardPaymentResult('¡Pago aprobado! Gracias por tu compra.', 'success');
                  clearCart();
                  setTimeout(() => {
                    closeCardPaymentModal();
                    window.location.href = '/pago/gracias.html';
                  }, 1500);
                } else if (isPending) {
                  showCardPaymentResult('Tu pago quedó pendiente de aprobación.', 'pending');
                  clearCart();
                  setTimeout(() => {
                    closeCardPaymentModal();
                    window.location.href = '/pago/pago-pendiente.html';
                  }, 1500);
                } else {
                  showCardPaymentError(
                    `El pago fue rechazado (${result.statusDetail || 'sin detalle'}) y no se te cobró nada. Probá con otra tarjeta.`
                  );
                }
              })
              .catch((err) => {
                console.error(err);
                showCardPaymentError(
                  `${err.message || 'No se pudo procesar el pago.'} No se te cobró nada: revisá los datos y volvé a intentar.`
                );
              })
              .finally(() => resolve()); // el Brick necesita que resolvamos siempre, incluso si falló
          }),
      },
    });
  } catch (err) {
    console.error(err);
    showToast(err.message || 'No se pudo iniciar el pago con tarjeta.', 'error');
  } finally {
    cartCheckoutCardBtn.disabled = false;
    cartCheckoutCardBtn.textContent = originalText;
  }
});


document.addEventListener('cart:updated', () => {
  renderCartBadge();
  renderCartDrawer();
});

subscribeToShippingSettings((raw) => {
  shippingSettings = normalizeShippingSettings(raw, tienda.shipping);
  updateShippingCostDisplay();
});

let firstSnapshotReceived = false;

subscribeToProducts((products) => {
  // Los productos pausados desde el panel (active: false) no se muestran.
  state.allProducts = products.filter((product) => product.active !== false);
  renderGrid();

  if (!firstSnapshotReceived) {
    firstSnapshotReceived = true;
    gridSkeleton?.classList.add('hidden');
    grid?.classList.remove('hidden');
  }
});

renderCartBadge();
renderCartDrawer();

// Sesión anónima automática: cada visitante recibe un uid propio (sin pedirle
// registro) para poder crear pedidos propios según las reglas de Firestore,
// y para que el carrito quede aislado por sesión en este navegador.
ensureAnonymousAuth().then((user) => {
  currentUser = user;
  if (user) setCartNamespace(user.uid);
});