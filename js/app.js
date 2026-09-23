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
} from './utils.js';
import { PLACEHOLDER_IMAGE } from './config.js';

applyStoreName();

let currentUser = null;
const state = {
  allProducts: [],
  searchTerm: '',
  activeCategory: 'Todo',
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

function handleAddToCart(product) {
  const result = addToCart({
    id: product.id,
    name: product.name,
    price: getFinalPrice(product),
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
  const finalPrice = getFinalPrice(product);
  const hasStock = (product.stock ?? 0) > 0;

  const card = document.createElement('article');
  card.className = 'product-card cursor-pointer';
  card.dataset.productId = product.id;
  card.innerHTML = `
    <div class="relative aspect-square bg-gray-800/40 rounded-xl flex items-center justify-center overflow-hidden">
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

      ${
        product.variant
          ? `<span class="text-[11px] text-gray-400 dark:text-gray-500">Variante: ${escapeHtml(product.variant)}</span>`
          : ''
      }

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
          hasStock
            ? `<svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              AGREGAR AL CARRITO`
            : 'SIN STOCK'
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
      product.variant?.toLowerCase().includes(term);

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
  const finalPrice = getFinalPrice(product);
  const hasStock = (product.stock ?? 0) > 0;

  detailImage.src = product.image || PLACEHOLDER_IMAGE;
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

  detailVariant.textContent = product.variant ? `Variante: ${product.variant}` : '';
  detailVariant.classList.toggle('hidden', !product.variant);
  detailCategory.textContent = product.category || '';
  detailCategory.classList.toggle('hidden', !product.category);

  if (hasStock) {
    detailStock.textContent = `Stock disponible: ${product.stock}`;
    detailStock.className = 'text-xs font-medium text-primary-dark dark:text-primary-bright';
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

  if (items.length === 0) {
    cartEmptyMsg.classList.remove('hidden');
    cartCheckoutBtn.disabled = true;
    cartCheckoutBtn.classList.add('opacity-50', 'cursor-not-allowed');
  } else {
    cartEmptyMsg.classList.add('hidden');
    cartCheckoutBtn.disabled = false;
    cartCheckoutBtn.classList.remove('opacity-50', 'cursor-not-allowed');

    items.forEach((item) => {
      const atMax = Number.isFinite(item.stock) && item.qty >= item.stock;
      const row = document.createElement('div');
      row.className = 'flex items-center gap-3 py-3 border-b border-brand-border dark:border-gray-700';
      row.innerHTML = `
        <img src="${escapeHtml(item.image || PLACEHOLDER_IMAGE)}" alt="${escapeHtml(item.name)}"
             class="w-14 h-14 object-contain bg-gray-50 dark:bg-gray-700 rounded-md flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold line-clamp-2">${escapeHtml(item.name)}</p>
          <p class="text-primary-dark dark:text-primary-bright font-bold text-sm">${formatPrice(item.price)}</p>
          <div class="flex items-center gap-2 mt-1">
            <button class="w-6 h-6 border border-brand-border dark:border-gray-600 rounded text-sm" data-qty-minus="${escapeHtml(item.id)}">−</button>
            <span class="text-sm w-6 text-center">${item.qty}</span>
            <button
              class="w-6 h-6 border border-brand-border dark:border-gray-600 rounded text-sm ${atMax ? 'opacity-40 cursor-not-allowed' : ''}"
              data-qty-plus="${escapeHtml(item.id)}"
              ${atMax ? 'disabled title="Alcanzaste el stock disponible"' : ''}
            >+</button>
            <button class="text-xs text-gray-400 hover:text-red-500 ml-2" data-remove="${escapeHtml(item.id)}">Quitar</button>
          </div>
          ${atMax ? `<p class="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">Stock máximo alcanzado</p>` : ''}
        </div>
      `;
      cartItemsContainer.appendChild(row);
    });
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

searchInput?.addEventListener('input', (e) => {
  state.searchTerm = e.target.value;
  renderGrid();
});

categoryNav?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-category]');
  if (!btn) return;

  state.activeCategory = btn.dataset.category;
  categoryNav.querySelectorAll('[data-category]').forEach((b) => b.classList.remove('category-tab-active'));
  btn.classList.add('category-tab-active');
  renderGrid();
});

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

cartCheckoutBtn?.addEventListener('click', async () => {
  const items = getCart();
  if (items.length === 0) return;

  const originalText = cartCheckoutBtn.textContent;
  cartCheckoutBtn.disabled = true;
  cartCheckoutBtn.textContent = 'Verificando stock...';

  try {
    // 1) Revalidar stock real contra Firestore (el del carrito puede estar viejo)
    const problems = await validateCartStock(items);

    if (problems.length > 0) {
      problems.forEach((problem) => {
        if (problem.reason === 'discontinued') {
          removeFromCart(problem.id);
          showToast(`"${problem.name}" ya no está disponible y se quitó del carrito.`, 'error');
        } else {
          syncItemStock(problem.id, problem.available);
          showToast(
            `Solo quedan ${problem.available} unidades de "${problem.name}" — se ajustó la cantidad.`,
            'error'
          );
        }
      });
      cartCheckoutBtn.disabled = false;
      cartCheckoutBtn.textContent = originalText;
      return; // el cliente revisa el carrito actualizado y vuelve a tocar "Pagar"
    }

    // 2) Registrar el pedido (queda atado al uid de la sesión actual — ver firestore.rules)
    cartCheckoutBtn.textContent = 'Generando pedido...';
    if (!currentUser) currentUser = await ensureAnonymousAuth();
    let orderId = null;
    if (currentUser) {
      const orderRef = await createOrder({
        userId: currentUser.uid,
        items: getCart().map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          qty: item.qty,
        })),
        total: getCartTotal(),
      });
      orderId = orderRef.id;
    }

    // 3) Crear la preferencia de Mercado Pago y redirigir
    cartCheckoutBtn.textContent = 'Redirigiendo a Mercado Pago...';
    // El precio real lo toma la Cloud Function desde Firestore; orderId viaja
    // como external_reference para conciliar el pago con el pedido.
    const initPoint = await createMercadoPagoCheckout(getCart(), orderId);
    window.location.href = initPoint;
  } catch (err) {
    console.error(err);
    showToast(err.message || 'No se pudo iniciar el pago con Mercado Pago.', 'error');
    cartCheckoutBtn.disabled = false;
    cartCheckoutBtn.textContent = originalText;
  }
});

document.addEventListener('cart:updated', () => {
  renderCartBadge();
  renderCartDrawer();
});

let firstSnapshotReceived = false;

subscribeToProducts((products) => {
  state.allProducts = products;
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