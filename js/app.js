// js/app.js
// Catálogo público: suscripción a Firestore, filtros/búsqueda en memoria,
// render de tarjetas de producto, modal de detalle, carrito y checkout
// con Mercado Pago.

import { subscribeToProducts, subscribeToCategories, ensureAnonymousAuth, createOrder } from './firebase.js';
import {
  addToCart,
  getCart,
  getCartCount,
  getCartTotal,
  updateQty,
  removeFromCart,
  setCartNamespace,
  syncItemStock,
} from './cart.js';
import { createMercadoPagoCheckout, validateCartStock } from './checkout.js';
import {
  formatPrice,
  escapeHtml,
  calcDiscount,
  hasValidOffer,
  getFinalPrice,
  showToast,
  applyStoreName,
  hasVariants,
  getProductStock,
  formatVariantLabel,
  getVariantPrice,
} from './utils.js';
import { PLACEHOLDER_IMAGE, SHIPPING_ENABLED, PICKUP_ENABLED, SHIPPING_COST_ESTIMATE } from './config.js';

applyStoreName();

let currentUser = null;
const state = {
  allProducts: [],
  searchTerm: '',
  // 'Inicio' es la vista de aterrizaje (home-view); cualquier otro valor
  // ('Todo', 'Ofertas', o el nombre de una categoría) muestra el catálogo
  // con buscador (catalog-view) — ver renderView().
  activeCategory: 'Inicio',
};
let latestCategories = [];

const homeView = document.getElementById('home-view');
const homeNewSection = document.getElementById('home-new-section');
const homeNewGrid = document.getElementById('home-new-grid');
const homeOffersSection = document.getElementById('home-offers-section');
const homeOffersGrid = document.getElementById('home-offers-grid');
const homeCategoriesSection = document.getElementById('home-categories-section');
const homeCategoriesGrid = document.getElementById('home-categories-grid');

const catalogView = document.getElementById('catalog-view');
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
const cartTotalEl = document.getElementById('cart-total');
const cartCheckoutBtn = document.getElementById('cart-checkout');
const cartEmptyMsg = document.getElementById('cart-empty-msg');

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
const detailVariant = document.getElementById('product-detail-variant');
const detailCategory = document.getElementById('product-detail-category');
const detailStock = document.getElementById('product-detail-stock');
const detailAddBtn = document.getElementById('product-detail-add');
const detailBuyBtn = document.getElementById('product-detail-buy');

const detailVariantsWrap = document.getElementById('product-detail-variants');
const detailSizeGroup = document.getElementById('product-detail-size-group');
const detailSizeSelected = document.getElementById('product-detail-size-selected');
const detailSizes = document.getElementById('product-detail-sizes');
const detailColorGroup = document.getElementById('product-detail-color-group');
const detailColorSelected = document.getElementById('product-detail-color-selected');
const detailColors = document.getElementById('product-detail-colors');
const detailVariantHint = document.getElementById('product-detail-variant-hint');

const detailQtyMinus = document.getElementById('product-detail-qty-minus');
const detailQtyPlus = document.getElementById('product-detail-qty-plus');
const detailQtyValue = document.getElementById('product-detail-qty-value');

// Vista de carrito de página completa (se abre desde "Continuar compra" del
// drawer). Reemplaza al viejo popup de envío: el formulario de datos de
// entrega vive integrado acá abajo del resumen, no en una leyenda flotante.
const cartView = document.getElementById('cart-view');
const cartViewBackBtn = document.getElementById('cart-view-back');
const cartViewEmpty = document.getElementById('cart-view-empty');
const cartViewContent = document.getElementById('cart-view-content');
const cartViewItemsContainer = document.getElementById('cart-view-items');
const cartViewTotalEl = document.getElementById('cart-view-total');
const cartViewContinueBtn = document.getElementById('cart-view-continue-btn');

const shippingForm = document.getElementById('shipping-form');
const shippingFormBackBtn = document.getElementById('shipping-form-back');
const shippingMethodGroup = document.getElementById('shipping-method-group');
const shippingAddressFields = document.getElementById('shipping-address-fields');
const shippingCostLabel = document.getElementById('shipping-cost-label');
const shippingFormError = document.getElementById('shipping-form-error');
const shippingConfirmBtn = document.getElementById('shipping-confirm-btn');

// Si la tienda solo ofrece un método (o mal configuraron los dos en false:
// ahí preferimos no romper el checkout y dejar solo retiro), no tiene
// sentido mostrarle el selector al comprador.
const forcedShippingMethod = SHIPPING_ENABLED && PICKUP_ENABLED
  ? null
  : SHIPPING_ENABLED
  ? 'delivery'
  : 'pickup';

/**
 * @param {object} product
 * @param {object|null} variant  Requerida si el producto tiene variants (ver
 *   hasVariants); null para un producto simple, exactamente como antes.
 * @param {number} qty  Cantidad elegida en el modal (por defecto 1, igual que antes).
 * @param {{goToCheckout?: boolean}} [opts]  goToCheckout=true es "Comprar ahora":
 *   en vez de abrir el drawer, cierra el modal y lleva directo a la vista de
 *   carrito de página completa (ver showCartView).
 */
function handleAddToCart(product, variant = null, qty = 1, { goToCheckout = false } = {}) {
  const label = variant ? formatVariantLabel(variant) : '';
  const result = addToCart(
    {
      id: product.id,
      variantId: variant?.id || null,
      sku: variant?.sku || null,
      variantLabel: label || null,
      name: product.name,
      price: getVariantPrice(product, variant),
      image: product.image,
      stock: variant ? Number(variant.stock ?? 0) : getProductStock(product),
    },
    qty
  );

  if (result.cappedByStock && result.added <= 0) {
    showToast(
      `Ya tenés en el carrito todo el stock disponible${label ? ` de "${label}"` : ' de este producto'}.`,
      'error'
    );
    return;
  }
  if (result.cappedByStock) {
    showToast('Se agregó lo que quedaba de stock disponible.', 'error');
  }

  if (goToCheckout) {
    closeProductModal();
    showCartView();
  } else {
    openCartDrawer();
  }
}

/**
 * Línea chica bajo la descripción de la card: talles disponibles si el
 * producto tiene variantes estructuradas, o el texto libre legacy
 * (product.variant) para productos viejos que todavía no lo tienen.
 */
function renderCardVariantHint(product, withVariants) {
  if (withVariants) {
    const sizes = [...new Set(product.variants.map((v) => v.size).filter(Boolean))];
    if (sizes.length === 0) return '';
    return `<span class="text-[11px] text-gray-400 dark:text-gray-500">Talles: ${escapeHtml(sizes.join(', '))}</span>`;
  }
  if (product.variant) {
    return `<span class="text-[11px] text-gray-400 dark:text-gray-500">Variante: ${escapeHtml(product.variant)}</span>`;
  }
  return '';
}

function renderProductCard(product) {
  const isOffer = hasValidOffer(product);
  const discount = isOffer ? calcDiscount(product.listPrice, product.offerPrice) : 0;
  const finalPrice = getFinalPrice(product);
  const withVariants = hasVariants(product);
  const hasStock = getProductStock(product) > 0;

  const card = document.createElement('article');
  card.className = 'product-card cursor-pointer';
  card.dataset.productId = product.id;
  card.innerHTML = `
    <div class="relative aspect-square bg-brand-bg rounded-t-md flex items-center justify-center overflow-hidden">
      <div class="image-spinner absolute inset-0 flex items-center justify-center">
        <svg class="w-6 h-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
      </div>
      <img
        src="${escapeHtml(product.image || PLACEHOLDER_IMAGE)}"
        alt="${escapeHtml(product.name)}"
        class="relative z-10 object-contain w-full h-full p-4 opacity-0 transition-opacity duration-300"
        loading="lazy"
        onload="this.classList.remove('opacity-0'); this.previousElementSibling.remove();"
        onerror="this.previousElementSibling.remove();"
      />
      ${
        isOffer
          ? `<span class="badge-offer absolute top-2 left-2 z-20 rounded-full px-2.5 py-1 shadow-sm">${discount}% OFF</span>`
          : ''
      }
    </div>
    <div class="p-4 flex flex-col flex-1 gap-2">
      ${product.brand ? `<span class="text-xs text-gray-400 font-medium">${escapeHtml(product.brand)}</span>` : ''}
      <h3 class="font-bold text-sm uppercase leading-snug line-clamp-2 min-h-[2.5rem] dark:text-white">
        ${escapeHtml(product.name)}
      </h3>

      <p class="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 min-h-[2rem]">
        ${escapeHtml(product.description)}
      </p>

      ${renderCardVariantHint(product, withVariants)}

      <div class="flex items-baseline gap-2 mt-1">
        ${isOffer ? `<span class="text-gray-400 text-xs line-through">${formatPrice(product.listPrice)}</span>` : ''}
        <p class="text-primary-dark dark:text-primary-bright text-2xl font-extrabold leading-none">
          ${formatPrice(finalPrice)}
        </p>
      </div>

      <button
        class="btn-primary mt-auto flex items-center justify-center gap-2 ${!hasStock ? 'opacity-50 cursor-not-allowed active:scale-100' : ''}"
        data-add-to-cart="${escapeHtml(product.id)}"
        ${!hasStock ? 'disabled' : ''}
      >
        ${
          !hasStock
            ? 'SIN STOCK'
            : withVariants
            ? 'VER OPCIONES'
            : `<svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              AGREGAR AL CARRITO`
        }
      </button>
    </div>
  `;
  return card;
}

/** Busca también dentro de las variantes (talle/color/SKU), no solo en el producto. */
function productMatchesSearchTerm(product, term) {
  if (
    product.name?.toLowerCase().includes(term) ||
    product.brand?.toLowerCase().includes(term) ||
    product.variant?.toLowerCase().includes(term)
  ) {
    return true;
  }
  if (hasVariants(product)) {
    return product.variants.some(
      (v) =>
        v.size?.toLowerCase().includes(term) ||
        v.color?.toLowerCase().includes(term) ||
        v.sku?.toLowerCase().includes(term)
    );
  }
  return false;
}

function renderGrid() {
  const term = state.searchTerm.trim().toLowerCase();

  const filtered = state.allProducts.filter((product) => {
    const matchesCategory =
      state.activeCategory === 'Todo' ||
      (state.activeCategory === 'Ofertas' ? hasValidOffer(product) : product.category === state.activeCategory);

    const matchesSearch = !term || productMatchesSearchTerm(product, term);

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

/**
 * Home: "lo más nuevo" (allProducts ya viene ordenado por createdAt desc
 * desde Firestore, ver firebase.js#subscribeToProducts) + ofertas vigentes +
 * accesos rápidos por categoría. Cada sección se oculta sola si no hay nada
 * que mostrar (ej. una tienda nueva sin ofertas todavía).
 */
function renderHome() {
  const news = state.allProducts.slice(0, 5);
  const offers = state.allProducts.filter(hasValidOffer).slice(0, 5);

  homeNewSection.classList.toggle('hidden', news.length === 0);
  homeNewGrid.innerHTML = '';
  news.forEach((product) => homeNewGrid.appendChild(renderProductCard(product)));

  homeOffersSection.classList.toggle('hidden', offers.length === 0);
  homeOffersGrid.innerHTML = '';
  offers.forEach((product) => homeOffersGrid.appendChild(renderProductCard(product)));

  renderHomeCategories();
}

function renderHomeCategories() {
  if (!homeCategoriesGrid) return;

  if (latestCategories.length === 0) {
    homeCategoriesSection.classList.add('hidden');
    return;
  }

  homeCategoriesSection.classList.remove('hidden');
  homeCategoriesGrid.innerHTML = latestCategories
    .map(
      (cat) => `<button data-goto-category="${escapeHtml(cat.name)}" class="category-tile">${escapeHtml(cat.name)}</button>`
    )
    .join('');
}

/** Decide qué vista mostrar (home o catálogo) y renderiza lo que corresponda. */
function renderView() {
  const isHome = state.activeCategory === 'Inicio';
  homeView.classList.toggle('hidden', !isHome);
  catalogView.classList.toggle('hidden', isHome);

  if (isHome) {
    renderHome();
  } else {
    renderGrid();
  }
}

/** Cambia de pestaña/categoría y sincroniza los tabs del header, se llame desde donde se llame (nav, home, etc.). */
function setActiveCategory(name) {
  state.activeCategory = name;
  // Cambiar de pestaña siempre te saca de la vista de carrito (y de su
  // formulario de envío, si estaba abierto) — mismo criterio que antes con
  // el modal de envío, que se cerraba al navegar.
  cartView?.classList.add('hidden');
  hideShippingForm();
  categoryNav?.querySelectorAll('[data-category]').forEach((b) => b.classList.toggle('category-tab-active', b.dataset.category === name));
  renderView();
}

let productBeingViewed = null;
// Selección en curso en el modal de detalle (solo aplica a productos con
// variantes). Se resetea cada vez que se abre el modal (ver openProductModal).
let selectedVariantAttrs = { size: null, color: null };
// Cantidad elegida en el stepper del modal. Se resetea a 1 en cada apertura.
let selectedQty = 1;

/** Stock disponible de la selección actual (variante elegida, o del producto simple si no tiene variantes). */
function getSelectionStock() {
  if (!productBeingViewed) return 0;
  if (hasVariants(productBeingViewed)) {
    const variant = getSelectedVariant();
    return variant ? Number(variant.stock ?? 0) : 0;
  }
  return getProductStock(productBeingViewed);
}

function clampSelectedQty() {
  const max = getSelectionStock();
  if (max <= 0) selectedQty = 1;
  else if (selectedQty > max) selectedQty = max;
  else if (selectedQty < 1) selectedQty = 1;
}

/** Repinta el stepper de cantidad según el stock de la selección actual. */
function renderQtyStepper() {
  clampSelectedQty();
  const max = getSelectionStock();
  detailQtyValue.textContent = selectedQty;
  detailQtyMinus.disabled = selectedQty <= 1;
  detailQtyPlus.disabled = max <= 0 || selectedQty >= max;
}

/** Habilita/deshabilita "Agregar al carrito" y "Comprar ahora" a la vez (mismo criterio para los dos). */
function updateActionButtons(canAdd, disabledLabel, enabledAddLabel = 'AGREGAR AL CARRITO', enabledBuyLabel = 'COMPRAR AHORA') {
  [
    [detailAddBtn, canAdd ? enabledAddLabel : disabledLabel],
    [detailBuyBtn, canAdd ? enabledBuyLabel : disabledLabel],
  ].forEach(([btn, label]) => {
    btn.disabled = !canAdd;
    btn.classList.toggle('opacity-50', !canAdd);
    btn.classList.toggle('cursor-not-allowed', !canAdd);
    btn.textContent = label;
  });
}

detailQtyMinus?.addEventListener('click', () => {
  if (selectedQty > 1) {
    selectedQty -= 1;
    renderQtyStepper();
  }
});
detailQtyPlus?.addEventListener('click', () => {
  const max = getSelectionStock();
  if (selectedQty < max) {
    selectedQty += 1;
    renderQtyStepper();
  }
});

function getUniqueAttrValues(variants, key) {
  return [...new Set(variants.map((v) => v[key]).filter(Boolean))];
}

/** La variante exacta que matchea talle+color elegidos (null si falta elegir alguno o no existe esa combinación). */
function findMatchingVariant(variants, attrs) {
  return (
    variants.find(
      (v) => (v.size || null) === (attrs.size || null) && (v.color || null) === (attrs.color || null)
    ) || null
  );
}

/**
 * ¿Ese valor de talle/color sigue siendo una opción válida dado lo que ya
 * está elegido del otro atributo? (ej: si ya elegiste "Negra", un talle sin
 * ninguna variante Negra con stock aparece deshabilitado — mismo patrón que
 * la mayoría de tiendas online).
 */
function attrOptionHasStock(variants, key, value, attrs) {
  const otherKey = key === 'size' ? 'color' : 'size';
  return variants.some((v) => {
    if ((v[key] || null) !== value) return false;
    if (attrs[otherKey] && (v[otherKey] || null) !== attrs[otherKey]) return false;
    return Number(v.stock ?? 0) > 0;
  });
}

function getSelectedVariant() {
  if (!productBeingViewed || !hasVariants(productBeingViewed)) return null;
  return findMatchingVariant(productBeingViewed.variants, selectedVariantAttrs);
}

function renderVariantPills(container, values, selectedKey, otherKeyAttrs, variants, dataAttr) {
  container.innerHTML = values
    .map((value) => {
      const active = selectedVariantAttrs[selectedKey] === value;
      const enabled = attrOptionHasStock(variants, selectedKey, value, otherKeyAttrs);
      return `<button type="button" data-${dataAttr}="${escapeHtml(value)}"
        class="variant-pill ${active ? 'variant-pill-active' : ''} ${!enabled ? 'variant-pill-disabled' : ''}"
        ${!enabled ? 'disabled' : ''}>${escapeHtml(value)}</button>`;
    })
    .join('');
}

/** Actualiza precio/badge de oferta según la variante elegida (o el precio base si todavía no elegiste ninguna). */
function updateDetailPriceDisplay(product, variant) {
  const variantHasCustomPrice = variant?.price != null && Number(variant.price) > 0;
  const isOffer = !variantHasCustomPrice && hasValidOffer(product);
  const discount = isOffer ? calcDiscount(product.listPrice, product.offerPrice) : 0;

  detailBadgeWrap.classList.toggle('hidden', !isOffer);
  if (isOffer) detailBadge.textContent = `${discount}% OFF`;
  detailListPrice.classList.toggle('hidden', !isOffer);
  if (isOffer) detailListPrice.textContent = formatPrice(product.listPrice);
  detailPrice.textContent = formatPrice(getVariantPrice(product, variant));
}

/** Re-renderiza pills + stock + botón según la selección actual (llamar después de cada click en una pill). */
function refreshVariantUI() {
  const product = productBeingViewed;
  const variants = product.variants;
  const sizes = getUniqueAttrValues(variants, 'size');
  const colors = getUniqueAttrValues(variants, 'color');

  // Un producto puede tener solo talles, solo colores, o ambos — el grupo
  // que no aplica queda oculto (antes quedaban ambos siempre ocultos, ver
  // fix de este mismo cambio).
  detailSizeGroup.classList.toggle('hidden', sizes.length === 0);
  detailColorGroup.classList.toggle('hidden', colors.length === 0);

  renderVariantPills(detailSizes, sizes, 'size', selectedVariantAttrs, variants, 'variant-size');
  renderVariantPills(detailColors, colors, 'color', selectedVariantAttrs, variants, 'variant-color');
  detailSizeSelected.textContent = selectedVariantAttrs.size ? ` · ${selectedVariantAttrs.size}` : '';
  detailColorSelected.textContent = selectedVariantAttrs.color ? ` · ${selectedVariantAttrs.color}` : '';

  const variant = getSelectedVariant();
  updateDetailPriceDisplay(product, variant);

  if (variant) {
    const stock = Number(variant.stock ?? 0);
    detailStock.textContent = stock > 0 ? `Stock disponible: ${stock}` : 'Sin stock para esa combinación';
    detailStock.className = `text-xs font-medium ${stock > 0 ? 'text-primary-dark dark:text-primary-bright' : 'text-red-500'}`;
  } else {
    detailStock.textContent =
      getProductStock(product) > 0 ? 'Elegí talle y color para ver el stock' : 'Sin stock disponible';
    detailStock.className = 'text-xs font-medium text-gray-400';
  }

  const canAdd = Boolean(variant) && Number(variant.stock ?? 0) > 0;
  updateActionButtons(canAdd, variant ? 'SIN STOCK' : 'ELEGÍ TALLE Y COLOR');
  renderQtyStepper();

  const missing = [!selectedVariantAttrs.size && sizes.length > 0 && 'talle', !selectedVariantAttrs.color && colors.length > 0 && 'color'].filter(
    Boolean
  );
  detailVariantHint.classList.toggle('hidden', missing.length === 0);
  if (missing.length > 0) {
    detailVariantHint.textContent = `Elegí ${missing.join(' y ')} para continuar.`;
  }
}

detailVariantsWrap?.addEventListener('click', (e) => {
  const sizeBtn = e.target.closest('[data-variant-size]');
  const colorBtn = e.target.closest('[data-variant-color]');
  if (sizeBtn && !sizeBtn.disabled) {
    const size = sizeBtn.dataset.variantSize;
    selectedVariantAttrs.size = selectedVariantAttrs.size === size ? null : size;
    refreshVariantUI();
  }
  if (colorBtn && !colorBtn.disabled) {
    const color = colorBtn.dataset.variantColor;
    selectedVariantAttrs.color = selectedVariantAttrs.color === color ? null : color;
    refreshVariantUI();
  }
});

function openProductModal(product) {
  productBeingViewed = product;
  selectedVariantAttrs = { size: null, color: null };
  selectedQty = 1;
  const withVariants = hasVariants(product);

  detailImage.src = product.image || PLACEHOLDER_IMAGE;
  detailImage.alt = product.name;
  detailBrand.textContent = product.brand || '';
  detailBrand.classList.toggle('hidden', !product.brand);
  detailName.textContent = product.name;

  detailDescription.textContent = product.description || 'Sin descripción disponible.';

  // El texto libre "Variante: ..." es legacy: solo se muestra en productos
  // viejos que todavía no tienen variantes estructuradas.
  detailVariant.textContent = !withVariants && product.variant ? `Variante: ${product.variant}` : '';
  detailVariant.classList.toggle('hidden', withVariants || !product.variant);
  detailCategory.textContent = product.category || '';
  detailCategory.classList.toggle('hidden', !product.category);

  detailVariantsWrap.classList.toggle('hidden', !withVariants);

  if (withVariants) {
    // Si solo hay una variante no tiene sentido mostrarle pills de una sola
    // opción al comprador: se preselecciona sola.
    if (product.variants.length === 1) {
      selectedVariantAttrs = {
        size: product.variants[0].size || null,
        color: product.variants[0].color || null,
      };
    }
    refreshVariantUI();
  } else {
    updateDetailPriceDisplay(product, null);
    const hasStock = getProductStock(product) > 0;
    if (hasStock) {
      detailStock.textContent = `Stock disponible: ${getProductStock(product)}`;
      detailStock.className = 'text-xs font-medium text-primary-dark dark:text-primary-bright';
    } else {
      detailStock.textContent = 'Sin stock disponible';
      detailStock.className = 'text-xs font-medium text-red-500';
    }
    updateActionButtons(hasStock, 'SIN STOCK');
    renderQtyStepper();
    detailVariantHint.classList.add('hidden');
  }

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
  if (!productBeingViewed) return;
  if (hasVariants(productBeingViewed)) {
    const variant = getSelectedVariant();
    if (!variant || Number(variant.stock ?? 0) <= 0) return; // el botón ya debería estar disabled
    handleAddToCart(productBeingViewed, variant, selectedQty);
  } else {
    handleAddToCart(productBeingViewed, null, selectedQty);
  }
});

detailBuyBtn?.addEventListener('click', () => {
  if (!productBeingViewed) return;
  if (hasVariants(productBeingViewed)) {
    const variant = getSelectedVariant();
    if (!variant || Number(variant.stock ?? 0) <= 0) return;
    handleAddToCart(productBeingViewed, variant, selectedQty, { goToCheckout: true });
  } else {
    handleAddToCart(productBeingViewed, null, selectedQty, { goToCheckout: true });
  }
});

function renderCartBadge() {
  const count = getCartCount();
  cartCountBadge.textContent = count;
  cartCountBadge.classList.toggle('hidden', count === 0);
}

/** Card de un item del carrito — la usan tanto el drawer como la vista de carrito de página completa. */
function renderCartRow(item) {
  const atMax = Number.isFinite(item.stock) && item.qty >= item.stock;
  const row = document.createElement('div');
  row.className = 'flex items-center gap-3 py-3 border-b border-brand-border dark:border-gray-700 last:border-b-0';
  row.innerHTML = `
    <img src="${escapeHtml(item.image || PLACEHOLDER_IMAGE)}" alt="${escapeHtml(item.name)}"
         class="w-16 h-16 object-contain bg-gray-50 dark:bg-gray-700 rounded-md flex-shrink-0" />
    <div class="flex-1 min-w-0">
      <p class="text-sm font-semibold line-clamp-2">${escapeHtml(item.name)}</p>
      ${item.variantLabel ? `<p class="text-xs text-gray-400 dark:text-gray-500">${escapeHtml(item.variantLabel)}</p>` : ''}
      <p class="text-primary-dark dark:text-primary-bright font-bold text-sm">${formatPrice(item.price)}</p>
      <div class="flex items-center gap-2 mt-1">
        <button class="w-6 h-6 border border-brand-border dark:border-gray-600 rounded text-sm" data-qty-minus="${escapeHtml(item.id)}" data-variant-id="${escapeHtml(item.variantId || '')}">−</button>
        <span class="text-sm w-6 text-center">${item.qty}</span>
        <button
          class="w-6 h-6 border border-brand-border dark:border-gray-600 rounded text-sm ${atMax ? 'opacity-40 cursor-not-allowed' : ''}"
          data-qty-plus="${escapeHtml(item.id)}"
          data-variant-id="${escapeHtml(item.variantId || '')}"
          ${atMax ? 'disabled title="Alcanzaste el stock disponible"' : ''}
        >+</button>
        <button class="text-xs text-gray-400 hover:text-red-500 ml-2" data-remove="${escapeHtml(item.id)}" data-variant-id="${escapeHtml(item.variantId || '')}">Quitar</button>
      </div>
      ${atMax ? `<p class="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">Stock máximo alcanzado</p>` : ''}
    </div>
  `;
  return row;
}

function renderCartDrawer() {
  const items = getCart();
  cartItemsContainer.innerHTML = '';

  if (items.length === 0) {
    cartEmptyMsg.classList.remove('hidden');
    cartCheckoutBtn.disabled = true;
    cartCheckoutBtn.classList.add('opacity-50', 'cursor-not-allowed');
  } else {
    cartEmptyMsg.classList.add('hidden');
    cartCheckoutBtn.disabled = false;
    cartCheckoutBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    items.forEach((item) => cartItemsContainer.appendChild(renderCartRow(item)));
  }

  cartTotalEl.textContent = formatPrice(getCartTotal());
}

function openCartDrawer() {
  cartDrawer.classList.remove('translate-x-full');
  cartOverlay.classList.remove('hidden');
}

function closeCartDrawer() {
  cartDrawer.classList.add('translate-x-full');
  cartOverlay.classList.add('hidden');
}

/** Repinta la vista de carrito de página completa (items + total del resumen). */
function renderCartView() {
  const items = getCart();
  const isEmpty = items.length === 0;
  cartViewEmpty.classList.toggle('hidden', !isEmpty);
  cartViewContent.classList.toggle('hidden', isEmpty);
  if (isEmpty) return;

  cartViewItemsContainer.innerHTML = '';
  items.forEach((item) => cartViewItemsContainer.appendChild(renderCartRow(item)));
  cartViewTotalEl.textContent = formatPrice(getCartTotal());
}

/** Abre la vista de carrito de página completa (reemplaza al viejo flujo "drawer → popup de envío"). */
function showCartView() {
  renderCartView();
  cartView.classList.remove('hidden');
  homeView.classList.add('hidden');
  catalogView.classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function hideCartView() {
  cartView.classList.add('hidden');
  hideShippingForm();
  renderView(); // vuelve a Home o al catálogo según la categoría que estaba activa
}

/** Muestra el formulario de envío integrado abajo del resumen (no es un popup). */
function revealShippingForm() {
  shippingForm.classList.remove('hidden');
  cartViewContinueBtn.classList.add('hidden');
  shippingForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideShippingForm() {
  shippingForm?.classList.add('hidden');
  cartViewContinueBtn?.classList.remove('hidden');
}

searchInput?.addEventListener('input', (e) => {
  state.searchTerm = e.target.value;
  // Buscar estando en Home no tendría dónde mostrar resultados: si escriben
  // algo estando ahí, los llevamos a "Todo" (con el término ya cargado).
  if (state.activeCategory === 'Inicio' && state.searchTerm.trim()) {
    setActiveCategory('Todo');
  } else if (state.activeCategory !== 'Inicio') {
    renderGrid();
  }
});

categoryNav?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-category]');
  if (!btn) return;
  setActiveCategory(btn.dataset.category);
});

// Accesos desde Home (botón "Ver catálogo", "Ver todo" de cada sección, las
// tiles de categorías) y desde el estado vacío de la vista de carrito ("Ir a
// la tienda") — todos usan el mismo atributo para no duplicar la lógica de
// cambio de pestaña.
function handleGotoCategoryClick(e) {
  const btn = e.target.closest('[data-goto-category]');
  if (!btn) return;
  setActiveCategory(btn.dataset.gotoCategory);
}
homeView?.addEventListener('click', handleGotoCategoryClick);
cartView?.addEventListener('click', handleGotoCategoryClick);

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
  latestCategories = categories;
  renderCategoryTabs(categories);
  if (state.activeCategory === 'Inicio') renderHomeCategories();
});

/** Click delegado de tarjeta de producto: se usa en la grilla del catálogo y en las de Home. */
function handleProductGridClick(e) {
  const addBtn = e.target.closest('[data-add-to-cart]');
  if (addBtn) {
    const product = state.allProducts.find((p) => p.id === addBtn.dataset.addToCart);
    if (!product) return;
    // Con variantes no se puede agregar "a ciegas" desde la card: hay que
    // elegir talle/color primero, así que este botón abre el detalle en vez
    // de agregar directo (ver también el botón dentro del modal).
    if (hasVariants(product)) {
      openProductModal(product);
    } else {
      handleAddToCart(product);
    }
    return;
  }

  const card = e.target.closest('[data-product-id]');
  if (card) {
    const product = state.allProducts.find((p) => p.id === card.dataset.productId);
    if (product) openProductModal(product);
  }
}

[grid, homeNewGrid, homeOffersGrid].forEach((container) => container?.addEventListener('click', handleProductGridClick));

// Una línea del carrito se identifica por (id, variantId) — dos variantes
// del mismo producto son líneas distintas, ver js/cart.js.
function findCartLine(id, variantId) {
  return getCart().find((i) => i.id === id && (i.variantId || null) === (variantId || null));
}

/** Click delegado de una fila de carrito: lo usan tanto el drawer como la vista de carrito de página completa. */
function handleCartRowClick(e) {
  const plusBtn = e.target.closest('[data-qty-plus]');
  const minusBtn = e.target.closest('[data-qty-minus]');
  const removeBtn = e.target.closest('[data-remove]');

  if (plusBtn) {
    const variantId = plusBtn.dataset.variantId || null;
    const item = findCartLine(plusBtn.dataset.qtyPlus, variantId);
    if (item) {
      if (Number.isFinite(item.stock) && item.qty >= item.stock) {
        showToast('Alcanzaste el stock disponible de este producto.', 'error');
      } else {
        updateQty(item.id, item.qty + 1, variantId);
      }
    }
  }
  if (minusBtn) {
    const variantId = minusBtn.dataset.variantId || null;
    const item = findCartLine(minusBtn.dataset.qtyMinus, variantId);
    if (item) updateQty(item.id, item.qty - 1, variantId);
  }
  if (removeBtn) {
    removeFromCart(removeBtn.dataset.remove, removeBtn.dataset.variantId || null);
  }
}

cartItemsContainer?.addEventListener('click', handleCartRowClick);
cartViewItemsContainer?.addEventListener('click', handleCartRowClick);

cartButton?.addEventListener('click', openCartDrawer);
cartCloseBtn?.addEventListener('click', closeCartDrawer);
cartOverlay?.addEventListener('click', closeCartDrawer);

// "Continuar compra" del drawer ya no valida stock ni abre un popup: ahora
// lleva a la vista de carrito de página completa (ver showCartView). La
// validación de stock se hace ahí, al tocar "Continuar compra" del resumen.
cartCheckoutBtn?.addEventListener('click', () => {
  if (getCart().length === 0) return;
  closeCartDrawer();
  showCartView();
});

cartViewBackBtn?.addEventListener('click', hideCartView);

cartViewContinueBtn?.addEventListener('click', async () => {
  const items = getCart();
  if (items.length === 0) return;

  const originalText = cartViewContinueBtn.textContent;
  cartViewContinueBtn.disabled = true;
  cartViewContinueBtn.textContent = 'Verificando stock...';

  try {
    // Revalidar stock real contra Firestore (el del carrito puede estar viejo)
    // antes de pedirle los datos de envío — no tiene sentido hacer completar
    // un formulario para después decirle que ya no hay stock.
    const problems = await validateCartStock(items);

    if (problems.length > 0) {
      problems.forEach((problem) => {
        if (problem.reason === 'discontinued') {
          removeFromCart(problem.id, problem.variantId || null);
          showToast(`"${problem.name}" ya no está disponible y se quitó del carrito.`, 'error');
        } else {
          syncItemStock(problem.id, problem.available, problem.variantId || null);
          showToast(
            `Solo quedan ${problem.available} unidades de "${problem.name}" — se ajustó la cantidad.`,
            'error'
          );
        }
      });
      return; // el cliente revisa el carrito actualizado y vuelve a tocar "Continuar"
    }

    openShippingFormFields();
    revealShippingForm();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'No se pudo verificar el stock. Probá de nuevo.', 'error');
  } finally {
    cartViewContinueBtn.disabled = false;
    cartViewContinueBtn.textContent = originalText;
  }
});

// ---------------------------------------------------------------------------
// Formulario de datos de envío: nombre/teléfono del comprador + método (envío
// a domicilio o retiro en el local) + dirección/CP si corresponde. Vive
// integrado abajo del resumen en la vista de carrito (ver #cart-view en
// index.html) — ya no es un popup. Se revela recién después de confirmar que
// hay stock (ver el listener de cartViewContinueBtn), y de acá sale directo
// a crear el pedido + la preferencia de Mercado Pago.
// ---------------------------------------------------------------------------

function getSelectedShippingMethod() {
  if (forcedShippingMethod) return forcedShippingMethod;
  return shippingForm.elements['method']?.value === 'pickup' ? 'pickup' : 'delivery';
}

function updateShippingFormVisibility() {
  const method = getSelectedShippingMethod();
  const isDelivery = method === 'delivery';

  shippingAddressFields.classList.toggle('hidden', !isDelivery);
  shippingForm.elements['address'].required = isDelivery;
  shippingForm.elements['postalCode'].required = isDelivery;

  shippingCostLabel.textContent = isDelivery ? formatPrice(SHIPPING_COST_ESTIMATE) : 'Gratis';
}

/** Deja el formulario listo (reseteado, método correcto) antes de mostrarlo con revealShippingForm(). */
function openShippingFormFields() {
  shippingForm.reset();
  shippingFormError.classList.add('hidden');

  // Blanquear "required" de campos ocultos para que el navegador no bloquee
  // el submit pidiendo completar algo que ni se ve.
  shippingForm.elements['address'].required = false;
  shippingForm.elements['postalCode'].required = false;

  if (forcedShippingMethod) {
    shippingMethodGroup.classList.add('hidden');
    // Fuerza el radio oculto al único método habilitado, para que
    // getSelectedShippingMethod() sea consistente igual (aunque ya no lo mira).
    const radio = shippingForm.querySelector(`input[name="method"][value="${forcedShippingMethod}"]`);
    if (radio) radio.checked = true;
  } else {
    shippingMethodGroup.classList.remove('hidden');
  }

  updateShippingFormVisibility();
}

shippingFormBackBtn?.addEventListener('click', hideShippingForm);
shippingForm?.addEventListener('change', (e) => {
  if (e.target.name === 'method') updateShippingFormVisibility();
});

shippingForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  shippingFormError.classList.add('hidden');

  const items = getCart();
  if (items.length === 0) {
    hideShippingForm();
    return;
  }

  const fd = shippingForm.elements;
  const fullName = fd['fullName'].value.trim();
  const phone = fd['phone'].value.trim();
  const email = fd['email'].value.trim();
  const method = getSelectedShippingMethod();
  const address = fd['address'].value.trim();
  const postalCode = fd['postalCode'].value.trim();
  const city = fd['city'].value.trim();

  if (!fullName || !phone) {
    shippingFormError.textContent = 'Completá tu nombre y teléfono.';
    shippingFormError.classList.remove('hidden');
    return;
  }
  // Validación básica (la validación real, que no se puede saltear desde el
  // navegador, vive en firestore.rules#validShipping).
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    shippingFormError.textContent = 'Ingresá un email válido — te vamos a mandar la confirmación de la compra ahí.';
    shippingFormError.classList.remove('hidden');
    return;
  }
  if (method === 'delivery' && (!address || !postalCode)) {
    shippingFormError.textContent = 'Completá la dirección y el código postal para el envío.';
    shippingFormError.classList.remove('hidden');
    return;
  }

  const shippingCostEstimate = method === 'delivery' ? SHIPPING_COST_ESTIMATE : 0;
  const shipping = {
    method,
    fullName,
    phone,
    email,
    ...(method === 'delivery' ? { address, postalCode, city } : {}),
  };

  const originalText = shippingConfirmBtn.textContent;
  shippingConfirmBtn.disabled = true;

  try {
    // Registrar el pedido (queda atado al uid de la sesión actual — ver
    // firestore.rules, incluida la validación de "shipping"). Si por lo que
    // sea no hay sesión (falló la autenticación anónima), no seguimos: sin
    // pedido, el webhook de Mercado Pago no tiene forma de conciliar el pago
    // ni descontar stock (ver checkout.js/functions/index.js).
    shippingConfirmBtn.textContent = 'Generando pedido...';
    if (!currentUser) currentUser = await ensureAnonymousAuth();
    if (!currentUser) {
      throw new Error('No se pudo iniciar tu sesión. Recargá la página y probá de nuevo.');
    }

    const orderRef = await createOrder({
      userId: currentUser.uid,
      items: getCart().map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        qty: item.qty,
        variantId: item.variantId || null,
        sku: item.sku || null,
        variantLabel: item.variantLabel || null,
      })),
      total: getCartTotal() + shippingCostEstimate,
      shipping,
    });
    const orderId = orderRef.id;

    // Crear la preferencia de Mercado Pago y redirigir. El precio real (items
    // + costo de envío según el método guardado en el pedido) lo recalcula
    // la Cloud Function desde Firestore y pisa items/total del pedido con
    // esos valores; orderId viaja como external_reference para que el
    // webhook concilie el pago con el pedido.
    shippingConfirmBtn.textContent = 'Redirigiendo a Mercado Pago...';
    const initPoint = await createMercadoPagoCheckout(getCart(), orderId);
    window.location.href = initPoint;
  } catch (err) {
    console.error(err);
    shippingFormError.textContent = err.message || 'No se pudo iniciar el pago con Mercado Pago.';
    shippingFormError.classList.remove('hidden');
    shippingConfirmBtn.disabled = false;
    shippingConfirmBtn.textContent = originalText;
  }
});

document.addEventListener('cart:updated', () => {
  renderCartBadge();
  renderCartDrawer();
  // Solo repinta items/total si la vista de carrito está abierta — no toca
  // si el formulario de envío está visible o no (eso es un estado aparte).
  if (!cartView.classList.contains('hidden')) renderCartView();
});

let firstSnapshotReceived = false;

subscribeToProducts((products) => {
  state.allProducts = products;
  renderView();

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
