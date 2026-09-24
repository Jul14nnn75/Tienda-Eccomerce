// js/admin.js
// Panel de administración: login con Firebase Auth + custom claim admin,
// CRUD de productos y categorías, métricas, búsqueda/orden y toasts.

import {
  subscribeToProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  subscribeToCategories,
  createCategory,
  deleteCategory,
  subscribeToOrders,
  updateOrderFulfillment,
  acknowledgeOrderAttention,
  subscribeBrandTheme,
  updateBrandTheme,
  loginWithEmail,
  logout,
  resetPassword,
  watchAuthState,
  translateAuthError,
} from './firebase.js';
import {
  formatPrice,
  escapeHtml,
  hasValidOffer,
  getFinalPrice,
  hasVariants,
  getProductStock,
  formatVariantLabel,
  showToast,
  applyStoreName,
} from './utils.js';
import { LOW_STOCK_THRESHOLD, PLACEHOLDER_IMAGE } from './config.js';

applyStoreName();

let allCategories = [];

let currentProducts = [];
let editingProductId = null; // null = modo "crear"
let pendingDelete = null; // { type: 'product'|'category', id, label }
let searchTerm = '';
let categoryFilter = 'Todas';
let sortState = { key: null, direction: 'asc' };

let currentOrders = [];
let orderSearchTerm = '';
let orderStatusFilter = 'Todos';
let orderFulfillmentFilter = 'Todos';
let viewingOrderId = null;
let salesSearchTerm = '';

// --- DOM: pantallas ---
const authChecking = document.getElementById('auth-checking');
const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginInfo = document.getElementById('login-info');
const loginSubmitBtn = document.getElementById('login-submit-btn');
const forgotPasswordLink = document.getElementById('forgot-password-link');
const dashboard = document.getElementById('dashboard');
const logoutBtn = document.getElementById('logout-btn');

// --- DOM: dashboard ---
const productSearch = document.getElementById('product-search');
const categoryFilterSelect = document.getElementById('category-filter');
const metricTotal = document.getElementById('metric-total');
const metricOfertas = document.getElementById('metric-ofertas');
const metricStockBajo = document.getElementById('metric-stock-bajo');
const productsTableBody = document.getElementById('products-table-body');
const productsCountLabel = document.getElementById('products-count-label');
const btnNewProduct = document.getElementById('btn-new-product');
const productModal = document.getElementById('product-modal');
const productForm = document.getElementById('product-form');
const modalTitle = document.getElementById('modal-title');
const btnCancelModal = document.getElementById('btn-cancel-modal');
const btnCancelModal2 = document.getElementById('btn-cancel-modal-2');
const imageUrlInput = document.getElementById('field-image-url');
const imageFileInput = document.getElementById('field-image-file');
const imagePreview = document.getElementById('image-preview');
const formError = document.getElementById('form-error');

// --- DOM: variantes (talle/color/SKU/stock por variante) ---
const fieldHasVariants = document.getElementById('field-has-variants');
const simpleStockFields = document.getElementById('simple-stock-fields');
const variantsEditor = document.getElementById('variants-editor');
const btnAddVariant = document.getElementById('btn-add-variant');
const variantRowsContainer = document.getElementById('variant-rows');

// --- DOM: categorías ---
const fieldCategory = document.getElementById('field-category');
const btnManageCategories = document.getElementById('btn-manage-categories');
const categoriesModal = document.getElementById('categories-modal');
const btnCloseCategoriesModal = document.getElementById('btn-close-categories-modal');
const categoriesList = document.getElementById('categories-list');
const newCategoryInput = document.getElementById('new-category-input');
const btnConfirmCategory = document.getElementById('btn-confirm-category');
const newCategoryError = document.getElementById('new-category-error');

// --- DOM: confirmación de borrado (productos y categorías) ---
const confirmModal = document.getElementById('confirm-modal');
const confirmModalTitle = document.getElementById('confirm-modal-title');
const confirmModalText = document.getElementById('confirm-modal-text');
const confirmModalCancel = document.getElementById('confirm-modal-cancel');
const confirmModalAccept = document.getElementById('confirm-modal-accept');

// --- DOM: tabs del dashboard ---
const adminTabs = document.querySelectorAll('[data-admin-tab]');
const productsPanel = document.getElementById('products-panel');
const ordersPanel = document.getElementById('orders-panel');
const salesPanel = document.getElementById('sales-panel');
const stylesPanel = document.getElementById('styles-panel');

// --- DOM: Estilos (colores + tipografía de marca) ---
const stylesForm = document.getElementById('styles-form');
const stylesPaletteSelect = document.getElementById('styles-palette-select');
const stylesCustomColors = document.getElementById('styles-custom-colors');
const stylesCustomPrimary = document.getElementById('styles-custom-primary');
const stylesCustomSecondary = document.getElementById('styles-custom-secondary');
const stylesFontSelect = document.getElementById('styles-font-select');
const stylesPreview = document.getElementById('styles-preview');
const stylesFormError = document.getElementById('styles-form-error');
const stylesFormSuccess = document.getElementById('styles-form-success');
const stylesSaveBtn = document.getElementById('styles-save-btn');

// --- DOM: aviso de reposición automática de stock ---
const attentionBanner = document.getElementById('attention-banner');
const attentionBannerText = document.getElementById('attention-banner-text');

// --- DOM: ventas ---
const salesSearchInput = document.getElementById('sales-search');
const salesTableBody = document.getElementById('sales-table-body');
const salesCountLabel = document.getElementById('sales-count-label');
const salesMetricTotal = document.getElementById('sales-metric-total');
const salesMetricCount = document.getElementById('sales-metric-count');

// --- DOM: pedidos ---
const orderSearchInput = document.getElementById('order-search');
const orderStatusFilterSelect = document.getElementById('order-status-filter');
const orderFulfillmentFilterSelect = document.getElementById('order-fulfillment-filter');
const ordersTableBody = document.getElementById('orders-table-body');
const ordersCountLabel = document.getElementById('orders-count-label');

// --- DOM: detalle de pedido ---
const orderDetailModal = document.getElementById('order-detail-modal');
const orderDetailClose = document.getElementById('order-detail-close');
const orderDetailId = document.getElementById('order-detail-id');
const orderDetailDate = document.getElementById('order-detail-date');
const orderDetailStatusBadge = document.getElementById('order-detail-status-badge');
const orderDetailBuyer = document.getElementById('order-detail-buyer');
const orderDetailShippingMethod = document.getElementById('order-detail-shipping-method');
const orderDetailShippingAddress = document.getElementById('order-detail-shipping-address');
const orderDetailItems = document.getElementById('order-detail-items');
const orderDetailShippingCost = document.getElementById('order-detail-shipping-cost');
const orderDetailTotal = document.getElementById('order-detail-total');
const orderDetailPaymentInfo = document.getElementById('order-detail-payment-info');
const orderDetailFulfillmentSelect = document.getElementById('order-detail-fulfillment-select');
const orderDetailAttention = document.getElementById('order-detail-attention');
const orderDetailAckBtn = document.getElementById('order-detail-ack-btn');


// ---------------------------------------------------------------------------
// Autenticación (Firebase Auth)
// ---------------------------------------------------------------------------

function showDashboard() {
  authChecking.classList.add('hidden');
  loginScreen.classList.add('hidden');
  dashboard.classList.remove('hidden');
}

function showLogin() {
  authChecking.classList.add('hidden');
  dashboard.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

watchAuthState(async (user) => {
  if (!user) {
    showLogin();
    return;
  }

  try {
    const tokenResult = await user.getIdTokenResult();
    if (tokenResult.claims.admin === true) {
      showDashboard();
    } else {
      await logout();
      loginError.textContent = 'Esta cuenta no tiene permisos de administrador.';
      loginError.classList.remove('hidden');
      showLogin();
    }
  } catch (err) {
    console.error(err);
    showLogin();
  }
});

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  loginInfo.classList.add('hidden');

  const email = loginForm.elements['email'].value.trim();
  const password = loginForm.elements['password'].value;

  loginSubmitBtn.disabled = true;
  loginSubmitBtn.textContent = 'Ingresando...';

  try {
    await loginWithEmail(email, password);
  } catch (err) {
    console.error(err);
    loginError.textContent = translateAuthError(err);
    loginError.classList.remove('hidden');
  } finally {
    loginSubmitBtn.disabled = false;
    loginSubmitBtn.textContent = 'Ingresar';
  }
});

forgotPasswordLink?.addEventListener('click', async () => {
  loginError.classList.add('hidden');
  loginInfo.classList.add('hidden');

  const email = loginForm.elements['email'].value.trim();
  if (!email) {
    loginError.textContent = 'Ingresá tu email arriba y luego tocá este enlace.';
    loginError.classList.remove('hidden');
    return;
  }

  try {
    await resetPassword(email);
    loginInfo.textContent = `Te enviamos un email a ${email} para restablecer tu contraseña.`;
    loginInfo.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    loginError.textContent = translateAuthError(err);
    loginError.classList.remove('hidden');
  }
});

logoutBtn?.addEventListener('click', async () => {
  await logout();
});

// ---------------------------------------------------------------------------
// Tabs del dashboard (Productos / Pedidos)
// ---------------------------------------------------------------------------

function activateAdminTab(target) {
  adminTabs.forEach((t) => t.classList.toggle('admin-tab-active', t.dataset.adminTab === target));
  productsPanel.classList.toggle('hidden', target !== 'products');
  ordersPanel.classList.toggle('hidden', target !== 'orders');
  salesPanel.classList.toggle('hidden', target !== 'sales');
  stylesPanel.classList.toggle('hidden', target !== 'styles');
}

adminTabs.forEach((tab) => {
  tab.addEventListener('click', () => activateAdminTab(tab.dataset.adminTab));
});

attentionBanner?.addEventListener('click', () => activateAdminTab('orders'));

function updateAttentionBanner() {
  const count = currentOrders.filter((o) => o.needsAttention === true).length;
  attentionBanner.classList.toggle('hidden', count === 0);
  attentionBannerText.textContent =
    count === 1
      ? '1 pedido con reposición automática de stock por un reembolso'
      : `${count} pedidos con reposición automática de stock por reembolsos`;
}

// ---------------------------------------------------------------------------
// Helpers de negocio (compartidos con la tabla y las métricas)
// ---------------------------------------------------------------------------

function getStockBadge(stock) {
  const value = Number(stock ?? 0);
  if (value <= 0) return { label: `${value}`, className: 'stock-badge-out' };
  if (value <= LOW_STOCK_THRESHOLD) return { label: `${value}`, className: 'stock-badge-low' };
  return { label: `${value}`, className: 'stock-badge-ok' };
}

function isLowStock(product) {
  return getProductStock(product) <= LOW_STOCK_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Categorías (select del formulario, filtro de la tabla, y modal de gestión
// con creación + eliminación)
// ---------------------------------------------------------------------------

function renderCategoryOptions() {
  const previousFilterValue = categoryFilterSelect.value;
  const previousFieldValue = fieldCategory.value;

  categoryFilterSelect.innerHTML = '<option value="Todas">Todas las categorías</option>';
  fieldCategory.innerHTML = '';

  allCategories.forEach((cat) => {
    const filterOption = document.createElement('option');
    filterOption.value = cat.name;
    filterOption.textContent = cat.name;
    categoryFilterSelect.appendChild(filterOption);

    const fieldOption = document.createElement('option');
    fieldOption.value = cat.name;
    fieldOption.textContent = cat.name;
    fieldCategory.appendChild(fieldOption);
  });

  if (allCategories.some((c) => c.name === previousFilterValue)) {
    categoryFilterSelect.value = previousFilterValue;
  }
  if (allCategories.some((c) => c.name === previousFieldValue)) {
    fieldCategory.value = previousFieldValue;
  }
}

function renderCategoriesList() {
  if (allCategories.length === 0) {
    categoriesList.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Todavía no hay categorías.</p>';
    return;
  }

  categoriesList.innerHTML = allCategories
    .map(
      (cat) => `
      <div class="flex items-center justify-between px-3 py-2 rounded-lg border border-brand-border dark:border-slate-800">
        <span class="text-sm font-medium">${escapeHtml(cat.name)}</span>
        <button
          class="icon-btn-delete"
          data-delete-category="${escapeHtml(cat.id)}"
          data-category-name="${escapeHtml(cat.name)}"
          title="Eliminar categoría"
          aria-label="Eliminar categoría"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M10 11v6" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M14 11v6" />
          </svg>
        </button>
      </div>`
    )
    .join('');
}

function openCategoriesModal() {
  newCategoryInput.value = '';
  newCategoryError.classList.add('hidden');
  renderCategoriesList();
  categoriesModal.classList.remove('hidden');
}

function closeCategoriesModal() {
  categoriesModal.classList.add('hidden');
}

btnManageCategories?.addEventListener('click', openCategoriesModal);
btnCloseCategoriesModal?.addEventListener('click', closeCategoriesModal);

newCategoryInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    btnConfirmCategory.click();
  }
});

btnConfirmCategory?.addEventListener('click', async () => {
  const name = newCategoryInput.value.trim();
  newCategoryError.classList.add('hidden');

  if (!name) {
    newCategoryError.textContent = 'Escribí un nombre para la categoría.';
    newCategoryError.classList.remove('hidden');
    return;
  }

  const alreadyExists = allCategories.some((c) => c.name.toLowerCase() === name.toLowerCase());
  if (alreadyExists) {
    newCategoryError.textContent = 'Ya existe una categoría con ese nombre.';
    newCategoryError.classList.remove('hidden');
    return;
  }

  btnConfirmCategory.disabled = true;
  btnConfirmCategory.textContent = 'Agregando...';

  try {
    await createCategory(name);
    newCategoryInput.value = '';
    showToast(`Categoría "${name}" creada correctamente.`);
  } catch (err) {
    console.error(err);
    newCategoryError.textContent = 'No se pudo crear la categoría.';
    newCategoryError.classList.remove('hidden');
  } finally {
    btnConfirmCategory.disabled = false;
    btnConfirmCategory.textContent = 'Agregar';
  }
});

categoriesList?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-delete-category]');
  if (!btn) return;

  const id = btn.dataset.deleteCategory;
  const name = btn.dataset.categoryName;
  const usageCount = currentProducts.filter((p) => p.category === name).length;
  const usageNote =
    usageCount > 0
      ? ` Actualmente la usan ${usageCount} producto${usageCount === 1 ? '' : 's'}; van a conservarla como texto, pero ya no vas a poder elegirla en el desplegable.`
      : '';

  openConfirmModal({
    type: 'category',
    id,
    label: name,
    title: '¿Eliminar categoría?',
    message: `Vas a eliminar la categoría "${name}".${usageNote} Esta acción no se puede deshacer.`,
  });
});

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

function renderMetrics() {
  metricTotal.textContent = currentProducts.length;
  metricOfertas.textContent = currentProducts.filter(hasValidOffer).length;
  metricStockBajo.textContent = currentProducts.filter(isLowStock).length;
}

// ---------------------------------------------------------------------------
// Tabla de productos (con búsqueda)
// ---------------------------------------------------------------------------

function getFilteredProducts() {
  const term = searchTerm.trim().toLowerCase();

  const filtered = currentProducts.filter((p) => {
    const matchesCategory = categoryFilter === 'Todas' || p.category === categoryFilter;
    const matchesSearch = !term || p.name?.toLowerCase().includes(term) || p.brand?.toLowerCase().includes(term);
    return matchesCategory && matchesSearch;
  });

  return applySort(filtered);
}

function applySort(products) {
  if (!sortState.key) return products;

  return [...products].sort((a, b) => {
    let valA;
    let valB;

    if (sortState.key === 'price') {
      valA = Number(getFinalPrice(a));
      valB = Number(getFinalPrice(b));
    } else if (sortState.key === 'stock') {
      valA = getProductStock(a);
      valB = getProductStock(b);
    } else if (sortState.key === 'name') {
      valA = (a.name || '').toLowerCase();
      valB = (b.name || '').toLowerCase();
    } else {
      return 0;
    }

    if (valA < valB) return sortState.direction === 'asc' ? -1 : 1;
    if (valA > valB) return sortState.direction === 'asc' ? 1 : -1;
    return 0;
  });
}

function updateSortIndicators() {
  document.querySelectorAll('[data-sort-icon]').forEach((el) => {
    const key = el.dataset.sortIcon;
    el.textContent = sortState.key === key ? (sortState.direction === 'asc' ? '↑' : '↓') : '';
  });
}

document.querySelectorAll('[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortState.key === key) {
      sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
      sortState.key = key;
      sortState.direction = 'asc';
    }
    updateSortIndicators();
    renderTable();
  });
});

function renderTable() {
  const filtered = getFilteredProducts();
  productsTableBody.innerHTML = '';

  if (filtered.length === 0) {
    productsTableBody.innerHTML = `
      <tr><td colspan="7" class="text-center text-gray-400 py-8">
        ${
          currentProducts.length === 0
            ? 'Todavía no hay productos. Creá el primero con "Nuevo producto".'
            : 'No encontramos productos con ese criterio de búsqueda.'
        }
      </td></tr>`;
    productsCountLabel.textContent =
      currentProducts.length === 0 ? '' : `Mostrando 0 de ${currentProducts.length} productos`;
    return;
  }

  filtered.forEach((product) => {
    const stockBadge = getStockBadge(getProductStock(product));
    const isOffer = hasValidOffer(product);
    const productVariants = hasVariants(product);

    const row = document.createElement('tr');
    row.className =
      'block md:table-row mb-3 md:mb-0 rounded-lg md:rounded-none border md:border-0 border-brand-border ' +
      'dark:border-slate-800 border-b dark:border-b-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40 p-3 md:p-0';
    row.innerHTML = `
      <td class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        <img src="${escapeHtml(product.image || PLACEHOLDER_IMAGE)}" alt="" class="w-12 h-12 rounded-lg bg-slate-800/50 object-contain p-1" />
      </td>
      <td data-label="Nombre" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 font-medium">${escapeHtml(product.name)}</td>
      <td data-label="Marca" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-gray-500 dark:text-gray-400">${escapeHtml(product.brand) || '-'}</td>
      <td data-label="Categoría" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        ${product.category ? `<span class="category-pill">${escapeHtml(product.category)}</span>` : '-'}
      </td>
      <td data-label="Precio" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        ${formatPrice(getFinalPrice(product))}
        ${isOffer ? `<span class="text-xs text-gray-400 line-through ml-1">${formatPrice(product.listPrice)}</span>` : ''}
      </td>
      <td data-label="Stock" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        <span class="${stockBadge.className}">${stockBadge.label}</span>
        ${productVariants ? `<span class="text-xs text-gray-400 ml-1">(${product.variants.length} variante${product.variants.length === 1 ? '' : 's'})</span>` : ''}
      </td>
      <td class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-left md:text-right whitespace-nowrap mt-2 md:mt-0">
        <button class="icon-btn-edit" data-edit="${escapeHtml(product.id)}" title="Editar producto" aria-label="Editar producto">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" />
          </svg>
        </button>
        <button class="icon-btn-delete" data-delete="${escapeHtml(product.id)}" data-name="${escapeHtml(product.name)}" title="Eliminar producto" aria-label="Eliminar producto">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M10 11v6" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M14 11v6" />
          </svg>
        </button>
      </td>
    `;
    productsTableBody.appendChild(row);
  });

  productsCountLabel.textContent = `Mostrando ${filtered.length} de ${currentProducts.length} productos`;
}

function renderAll() {
  renderMetrics();
  renderTable();
}

function renderTableSkeleton(rows = 4) {
  productsTableBody.innerHTML = Array.from({ length: rows })
    .map(
      () => `
      <tr class="block md:table-row border-b border-brand-border dark:border-slate-800 p-3 md:p-0 animate-pulse">
        <td class="block md:table-cell py-2 px-0 md:px-3">
          <div class="w-12 h-12 rounded-lg bg-gray-200 dark:bg-slate-800"></div>
        </td>
        <td class="block md:table-cell py-2 px-0 md:px-3"><div class="h-4 w-32 bg-gray-200 dark:bg-slate-800 rounded"></div></td>
        <td class="block md:table-cell py-2 px-0 md:px-3"><div class="h-4 w-20 bg-gray-200 dark:bg-slate-800 rounded"></div></td>
        <td class="block md:table-cell py-2 px-0 md:px-3"><div class="h-4 w-16 bg-gray-200 dark:bg-slate-800 rounded"></div></td>
        <td class="block md:table-cell py-2 px-0 md:px-3"><div class="h-4 w-16 bg-gray-200 dark:bg-slate-800 rounded"></div></td>
        <td class="block md:table-cell py-2 px-0 md:px-3"><div class="h-4 w-12 bg-gray-200 dark:bg-slate-800 rounded"></div></td>
        <td class="block md:table-cell py-2 px-0 md:px-3"><div class="h-4 w-16 bg-gray-200 dark:bg-slate-800 rounded"></div></td>
      </tr>`
    )
    .join('');
  productsCountLabel.textContent = '';
}

renderTableSkeleton();

productSearch?.addEventListener('input', (e) => {
  searchTerm = e.target.value;
  renderTable();
});
categoryFilterSelect?.addEventListener('change', (e) => {
  categoryFilter = e.target.value;
  renderTable();
});

productsTableBody?.addEventListener('click', (e) => {
  const editBtn = e.target.closest('[data-edit]');
  const deleteBtn = e.target.closest('[data-delete]');

  if (editBtn) {
    const product = currentProducts.find((p) => p.id === editBtn.dataset.edit);
    if (product) openModal(product);
  }

  if (deleteBtn) {
    openConfirmModal({
      type: 'product',
      id: deleteBtn.dataset.delete,
      label: deleteBtn.dataset.name,
      title: '¿Eliminar producto?',
      message: `Vas a eliminar "${deleteBtn.dataset.name}". Esta acción no se puede deshacer.`,
    });
  }
});

// ---------------------------------------------------------------------------
// Modal de confirmación de borrado (genérico: productos y categorías)
// ---------------------------------------------------------------------------

function openConfirmModal({ type, id, label, title, message }) {
  pendingDelete = { type, id, label };
  confirmModalTitle.textContent = title;
  confirmModalText.textContent = message;
  confirmModal.classList.remove('hidden');
}

function closeConfirmModal() {
  confirmModal.classList.add('hidden');
  pendingDelete = null;
}

confirmModalCancel?.addEventListener('click', closeConfirmModal);

confirmModalAccept?.addEventListener('click', async () => {
  if (!pendingDelete) return;
  const { type, id, label } = pendingDelete;

  try {
    if (type === 'product') {
      await deleteProduct(id);
      showToast('Producto eliminado correctamente.');
    } else if (type === 'category') {
      await deleteCategory(id);
      showToast(`Categoría "${label}" eliminada.`);
    }
  } catch (err) {
    console.error(err);
    showToast(type === 'product' ? 'No se pudo eliminar el producto.' : 'No se pudo eliminar la categoría.', 'error');
  } finally {
    closeConfirmModal();
  }
});

// ---------------------------------------------------------------------------
// Modal de creación / edición (CRUD)
// ---------------------------------------------------------------------------

// --- Editor de variantes (talle/color/SKU/stock propio, precio opcional) ---
// Cada fila vive como un <div data-variant-id> con inputs sueltos (sin su
// propio <form>): se leen a mano en el submit (readVariantRows) en vez de
// depender de FormData, porque el nombre de los campos se repite en cada fila.

function createVariantId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function addVariantRow(variant = {}) {
  const row = document.createElement('div');
  row.className = 'variant-row grid grid-cols-2 md:grid-cols-[1fr_1fr_1.4fr_0.8fr_1fr_28px] gap-2 items-center';
  row.dataset.variantId = variant.id || createVariantId();
  row.innerHTML = `
    <input type="text" class="input-field text-sm" data-field="size" placeholder="Talle (ej: M)" value="${escapeHtml(variant.size || '')}" />
    <input type="text" class="input-field text-sm" data-field="color" placeholder="Color" value="${escapeHtml(variant.color || '')}" />
    <input type="text" class="input-field text-sm col-span-2 md:col-span-1" data-field="sku" placeholder="SKU" value="${escapeHtml(variant.sku || '')}" />
    <input type="number" min="0" step="1" class="input-field text-sm" data-field="stock" placeholder="Stock" value="${variant.stock ?? 0}" />
    <input type="number" min="0" step="0.01" class="input-field text-sm" data-field="price" placeholder="Precio" value="${variant.price ?? ''}" />
    <button type="button" class="icon-btn-delete" data-remove-variant title="Quitar variante" aria-label="Quitar variante">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
      </svg>
    </button>
  `;
  variantRowsContainer.appendChild(row);
}

function clearVariantRows() {
  variantRowsContainer.innerHTML = '';
}

function readVariantRows() {
  return Array.from(variantRowsContainer.querySelectorAll('[data-variant-id]')).map((row) => ({
    id: row.dataset.variantId,
    size: row.querySelector('[data-field="size"]').value.trim(),
    color: row.querySelector('[data-field="color"]').value.trim(),
    sku: row.querySelector('[data-field="sku"]').value.trim(),
    stock: row.querySelector('[data-field="stock"]').value,
    price: row.querySelector('[data-field="price"]').value,
  }));
}

function updateVariantsModeUI() {
  const usingVariants = fieldHasVariants.checked;
  simpleStockFields.classList.toggle('hidden', usingVariants);
  variantsEditor.classList.toggle('hidden', !usingVariants);
}

fieldHasVariants?.addEventListener('change', () => {
  updateVariantsModeUI();
  if (fieldHasVariants.checked && variantRowsContainer.children.length === 0) {
    addVariantRow();
  }
});

btnAddVariant?.addEventListener('click', () => addVariantRow());

variantRowsContainer?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-variant]');
  if (!btn) return;
  btn.closest('[data-variant-id]')?.remove();
});

function openModal(product = null) {
  editingProductId = product?.id ?? null;
  modalTitle.textContent = product ? 'Editar producto' : 'Nuevo producto';
  formError.classList.add('hidden');

  productForm.reset();
  imagePreview.classList.add('hidden');
  clearVariantRows();

  const productHasVariants = hasVariants(product);
  fieldHasVariants.checked = productHasVariants;
  if (productHasVariants) {
    product.variants.forEach((v) => addVariantRow(v));
  }
  updateVariantsModeUI();

  if (product) {
    productForm.elements['name'].value = product.name || '';
    productForm.elements['brand'].value = product.brand || '';
    productForm.elements['category'].value = product.category || '';
    productForm.elements['listPrice'].value = product.listPrice ?? '';
    productForm.elements['offerPrice'].value = product.offerPrice ?? '';
    productForm.elements['stock'].value = product.stock ?? 0;
    productForm.elements['variant'].value = product.variant || '';
    productForm.elements['description'].value = product.description || '';
    imageUrlInput.value = product.image || '';
    if (product.image) {
      imagePreview.src = product.image;
      imagePreview.classList.remove('hidden');
    }
  }

  productModal.classList.remove('hidden');
}

function closeModal() {
  productModal.classList.add('hidden');
  editingProductId = null;
}

btnNewProduct?.addEventListener('click', () => openModal());
btnCancelModal?.addEventListener('click', closeModal);
btnCancelModal2?.addEventListener('click', closeModal);

imageUrlInput?.addEventListener('input', () => {
  if (imageUrlInput.value) {
    imagePreview.src = imageUrlInput.value;
    imagePreview.classList.remove('hidden');
  } else {
    imagePreview.classList.add('hidden');
  }
});

imageFileInput?.addEventListener('change', () => {
  const file = imageFileInput.files?.[0];
  if (!file) return;
  imagePreview.src = URL.createObjectURL(file);
  imagePreview.classList.remove('hidden');
});

function sanitizeOfferPrice(raw) {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;
  const parsed = parseFloat(trimmed);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

productForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.add('hidden');

  const fd = productForm.elements;
  const listPrice = parseFloat(fd['listPrice'].value);
  const offerPrice = sanitizeOfferPrice(fd['offerPrice'].value);

  if (!fd['name'].value.trim()) {
    formError.textContent = 'El nombre del producto es obligatorio.';
    formError.classList.remove('hidden');
    return;
  }
  if (Number.isNaN(listPrice) || listPrice < 0) {
    formError.textContent = 'El precio de lista debe ser un número válido.';
    formError.classList.remove('hidden');
    return;
  }
  if (offerPrice != null && offerPrice >= listPrice) {
    formError.textContent = 'El precio de oferta debe ser menor al precio de lista.';
    formError.classList.remove('hidden');
    return;
  }

  const usingVariants = fieldHasVariants.checked;
  let variants = [];

  if (usingVariants) {
    const rawRows = readVariantRows();
    if (rawRows.length === 0) {
      formError.textContent = 'Agregá al menos una variante o desactivá "Este producto tiene variantes".';
      formError.classList.remove('hidden');
      return;
    }

    const skuSeen = new Set();
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const label = `Variante #${i + 1}`;

      if (!row.size && !row.color) {
        formError.textContent = `${label}: completá al menos el talle o el color.`;
        formError.classList.remove('hidden');
        return;
      }
      if (!row.sku) {
        formError.textContent = `${label}: el SKU es obligatorio.`;
        formError.classList.remove('hidden');
        return;
      }
      const skuKey = row.sku.toLowerCase();
      if (skuSeen.has(skuKey)) {
        formError.textContent = `El SKU "${row.sku}" está repetido entre variantes.`;
        formError.classList.remove('hidden');
        return;
      }
      skuSeen.add(skuKey);

      const stockNum = parseInt(row.stock || '0', 10);
      if (Number.isNaN(stockNum) || stockNum < 0) {
        formError.textContent = `${label}: el stock debe ser un número válido (0 o más).`;
        formError.classList.remove('hidden');
        return;
      }

      let priceNum = null;
      const priceRaw = (row.price ?? '').toString().trim();
      if (priceRaw !== '') {
        const parsedPrice = parseFloat(priceRaw);
        if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
          formError.textContent = `${label}: el precio, si lo completás, debe ser mayor a 0.`;
          formError.classList.remove('hidden');
          return;
        }
        priceNum = parsedPrice;
      }

      variants.push({ id: row.id, size: row.size, color: row.color, sku: row.sku, stock: stockNum, price: priceNum });
    }
  }

  const data = {
    name: fd['name'].value.trim(),
    brand: fd['brand'].value.trim(),
    category: fd['category'].value,
    listPrice,
    offerPrice,
    description: fd['description'].value.trim(),
    image: imageUrlInput.value.trim(),
    ...(usingVariants
      ? {
          variants,
          stock: variants.reduce((sum, v) => sum + v.stock, 0),
          variant: '',
        }
      : {
          variants: [],
          stock: parseInt(fd['stock'].value || '0', 10),
          variant: fd['variant'].value.trim(),
        }),
  };

  const submitBtn = productForm.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando...';

  const isEditing = Boolean(editingProductId);

  try {
    let productId = editingProductId;

    if (!productId) {
      const docRef = await createProduct(data);
      productId = docRef.id;
    } else {
      await updateProduct(productId, data);
    }

    const file = imageFileInput.files?.[0];
    if (file) {
      const uploadedUrl = await uploadProductImage(file, productId);
      await updateProduct(productId, { image: uploadedUrl });
    }

    showToast(isEditing ? 'Producto actualizado correctamente.' : 'Producto creado correctamente.');
    closeModal();
  } catch (err) {
    console.error(err);
    formError.textContent = 'Ocurrió un error al guardar. Revisá la consola para más detalles.';
    formError.classList.remove('hidden');
    showToast('No se pudo guardar el producto.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Guardar producto';
  }
});

// ---------------------------------------------------------------------------
// Pedidos: tabla con búsqueda/filtros, detalle y cambio de estado de envío.
// El estado de PAGO ("status") es de solo lectura acá — lo controla
// únicamente el webhook de Mercado Pago (ver functions/index.js). Lo único
// que el admin puede tocar a mano es "fulfillmentStatus" (sin preparar →
// preparando → enviado → entregado), que es un dato propio de logística.
// ---------------------------------------------------------------------------

const PAYMENT_STATUS_LABELS = {
  pending: 'Pendiente',
  approved: 'Pagado',
  in_process: 'En proceso',
  rejected: 'Rechazado',
  refunded: 'Reembolsado',
  charged_back: 'Contracargo',
  cancelled: 'Cancelado',
};

const FULFILLMENT_LABELS = {
  pendiente: 'Sin preparar',
  preparando: 'Preparando',
  enviado: 'Enviado',
  entregado: 'Entregado',
};

function getPaymentStatusBadge(status) {
  const label = PAYMENT_STATUS_LABELS[status] || status || 'Pendiente';
  if (status === 'approved') return { label, className: 'order-status-approved' };
  if (status === 'pending' || status === 'in_process') return { label, className: 'order-status-pending' };
  if (status === 'rejected') return { label, className: 'order-status-rejected' };
  return { label, className: 'order-status-neutral' }; // refunded, charged_back, cancelled
}

function formatOrderDate(timestamp) {
  if (!timestamp?.toDate) return '-';
  return timestamp.toDate().toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getShippingSummary(order) {
  const shipping = order.shipping || {};
  if (shipping.method === 'pickup') return 'Retiro en el local';
  return 'Envío a domicilio';
}

function getFilteredOrders() {
  const term = orderSearchTerm.trim().toLowerCase();

  return currentOrders.filter((order) => {
    const matchesStatus = orderStatusFilter === 'Todos' || order.status === orderStatusFilter;
    const matchesFulfillment =
      orderFulfillmentFilter === 'Todos' ||
      (order.fulfillmentStatus || 'pendiente') === orderFulfillmentFilter;

    const shipping = order.shipping || {};
    const matchesSearch =
      !term ||
      order.id.toLowerCase().includes(term) ||
      shipping.fullName?.toLowerCase().includes(term) ||
      shipping.phone?.toLowerCase().includes(term);

    return matchesStatus && matchesFulfillment && matchesSearch;
  });
}

function renderOrdersTable() {
  const filtered = getFilteredOrders();
  ordersTableBody.innerHTML = '';

  if (filtered.length === 0) {
    ordersTableBody.innerHTML = `
      <tr><td colspan="7" class="text-center text-gray-400 py-8">
        ${
          currentOrders.length === 0
            ? 'Todavía no hay pedidos.'
            : 'No encontramos pedidos con ese criterio.'
        }
      </td></tr>`;
    ordersCountLabel.textContent =
      currentOrders.length === 0 ? '' : `Mostrando 0 de ${currentOrders.length} pedidos`;
    return;
  }

  filtered.forEach((order) => {
    const shipping = order.shipping || {};
    const statusBadge = getPaymentStatusBadge(order.status);
    const fulfillment = order.fulfillmentStatus || 'pendiente';

    const row = document.createElement('tr');
    row.className =
      'block md:table-row mb-3 md:mb-0 rounded-lg md:rounded-none border md:border-0 border-brand-border ' +
      'dark:border-slate-800 border-b dark:border-b-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40 p-3 md:p-0';
    row.innerHTML = `
      <td data-label="Fecha" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
        ${formatOrderDate(order.createdAt)}
      </td>
      <td data-label="Comprador" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        <p class="font-medium">${escapeHtml(shipping.fullName) || '-'}</p>
        <p class="text-xs text-gray-400">${escapeHtml(shipping.phone) || ''}</p>
      </td>
      <td data-label="Entrega" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">${getShippingSummary(order)}</td>
      <td data-label="Total" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 font-semibold">${formatPrice(order.total)}</td>
      <td data-label="Pago" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        <span class="${statusBadge.className}">${statusBadge.label}</span>
        ${order.needsAttention ? '<span title="Se repuso stock automáticamente — revisar" class="ml-1">⚠️</span>' : ''}
      </td>
      <td data-label="Envío" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        <select class="input-field text-xs py-1" data-fulfillment-select="${escapeHtml(order.id)}">
          ${Object.entries(FULFILLMENT_LABELS)
            .map(([value, label]) => `<option value="${value}" ${value === fulfillment ? 'selected' : ''}>${label}</option>`)
            .join('')}
        </select>
      </td>
      <td class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-left md:text-right whitespace-nowrap mt-2 md:mt-0">
        <button class="text-xs font-semibold text-primary hover:underline" data-view-order="${escapeHtml(order.id)}">Ver</button>
      </td>
    `;
    ordersTableBody.appendChild(row);
  });

  ordersCountLabel.textContent = `Mostrando ${filtered.length} de ${currentOrders.length} pedidos`;
}

orderSearchInput?.addEventListener('input', (e) => {
  orderSearchTerm = e.target.value;
  renderOrdersTable();
});
orderStatusFilterSelect?.addEventListener('change', (e) => {
  orderStatusFilter = e.target.value;
  renderOrdersTable();
});
orderFulfillmentFilterSelect?.addEventListener('change', (e) => {
  orderFulfillmentFilter = e.target.value;
  renderOrdersTable();
});

async function handleFulfillmentChange(orderId, value, selectEl) {
  selectEl.disabled = true;
  try {
    await updateOrderFulfillment(orderId, value);
    showToast('Estado de envío actualizado.');
  } catch (err) {
    console.error(err);
    showToast('No se pudo actualizar el estado de envío.', 'error');
  } finally {
    selectEl.disabled = false;
  }
}

ordersTableBody?.addEventListener('change', (e) => {
  const select = e.target.closest('[data-fulfillment-select]');
  if (select) handleFulfillmentChange(select.dataset.fulfillmentSelect, select.value, select);
});

ordersTableBody?.addEventListener('click', (e) => {
  const viewBtn = e.target.closest('[data-view-order]');
  if (!viewBtn) return;
  const order = currentOrders.find((o) => o.id === viewBtn.dataset.viewOrder);
  if (order) openOrderDetailModal(order);
});

// ---------------------------------------------------------------------------
// Modal de detalle de pedido
// ---------------------------------------------------------------------------

function openOrderDetailModal(order) {
  viewingOrderId = order.id;
  const shipping = order.shipping || {};
  const statusBadge = getPaymentStatusBadge(order.status);

  orderDetailId.textContent = `Pedido #${order.id}`;
  orderDetailDate.textContent = formatOrderDate(order.createdAt);
  orderDetailStatusBadge.innerHTML = `<span class="${statusBadge.className}">${statusBadge.label}</span>`;

  orderDetailBuyer.textContent = [shipping.fullName, shipping.phone].filter(Boolean).join(' · ') || 'Sin datos';

  orderDetailShippingMethod.textContent = getShippingSummary(order);
  if (shipping.method === 'pickup') {
    orderDetailShippingAddress.textContent = '';
  } else {
    orderDetailShippingAddress.textContent = [shipping.address, shipping.postalCode, shipping.city]
      .filter(Boolean)
      .join(', ');
  }

  const items = Array.isArray(order.items) ? order.items : [];
  orderDetailItems.innerHTML = items
    .map(
      (item) => `
      <div class="flex justify-between">
        <span>${item.qty}x ${escapeHtml(item.name)}${item.variantLabel ? ` <span class="text-gray-400">(${escapeHtml(item.variantLabel)})</span>` : ''}${item.sku ? ` <span class="text-gray-400 text-xs">— SKU ${escapeHtml(item.sku)}</span>` : ''}</span>
        <span>${formatPrice((item.price || 0) * (item.qty || 0))}</span>
      </div>`
    )
    .join('') || '<p class="text-gray-400">Sin productos.</p>';

  const shippingCost = Number(shipping.cost ?? 0);
  orderDetailShippingCost.textContent = shippingCost > 0 ? formatPrice(shippingCost) : 'Gratis / retiro';
  orderDetailTotal.textContent = formatPrice(order.total);

  const paymentBits = [];
  if (order.mpPaymentId) paymentBits.push(`ID de pago MP: ${order.mpPaymentId}`);
  if (order.paidAt?.toDate) paymentBits.push(`Pagado el ${formatOrderDate(order.paidAt)}`);
  if (order.amountMismatch) paymentBits.push('⚠️ El monto pagado no coincidió con el total del pedido — revisar a mano.');
  orderDetailPaymentInfo.textContent = paymentBits.join(' · ');
  orderDetailPaymentInfo.classList.toggle('hidden', paymentBits.length === 0);

  orderDetailFulfillmentSelect.value = order.fulfillmentStatus || 'pendiente';

  orderDetailAttention.classList.toggle('hidden', order.needsAttention !== true);

  orderDetailModal.classList.remove('hidden');
}

function closeOrderDetailModal() {
  orderDetailModal.classList.add('hidden');
  viewingOrderId = null;
}

orderDetailClose?.addEventListener('click', closeOrderDetailModal);
orderDetailModal?.addEventListener('click', (e) => {
  if (e.target === orderDetailModal) closeOrderDetailModal();
});
orderDetailFulfillmentSelect?.addEventListener('change', (e) => {
  if (viewingOrderId) handleFulfillmentChange(viewingOrderId, e.target.value, orderDetailFulfillmentSelect);
});

orderDetailAckBtn?.addEventListener('click', async () => {
  if (!viewingOrderId) return;
  orderDetailAckBtn.disabled = true;
  try {
    await acknowledgeOrderAttention(viewingOrderId);
    orderDetailAttention.classList.add('hidden');
    showToast('Marcado como revisado.');
  } catch (err) {
    console.error(err);
    showToast('No se pudo marcar como revisado.', 'error');
  } finally {
    orderDetailAckBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Ventas: pedidos ya aprobados, con comprador y productos — para ver de un
// vistazo qué se vendió. Sin controles de estado (eso vive en Pedidos).
// ---------------------------------------------------------------------------

function getFilteredSales() {
  const term = salesSearchTerm.trim().toLowerCase();
  return currentOrders.filter((order) => {
    if (order.status !== 'approved') return false;
    if (!term) return true;

    const shipping = order.shipping || {};
    const items = Array.isArray(order.items) ? order.items : [];
    return (
      shipping.fullName?.toLowerCase().includes(term) ||
      shipping.phone?.toLowerCase().includes(term) ||
      items.some((item) => item.name?.toLowerCase().includes(term))
    );
  });
}

function renderSalesTable() {
  const sales = getFilteredSales();

  salesMetricCount.textContent = sales.length;
  salesMetricTotal.textContent = formatPrice(sales.reduce((sum, order) => sum + Number(order.total || 0), 0));

  salesTableBody.innerHTML = '';

  if (sales.length === 0) {
    salesTableBody.innerHTML = `
      <tr><td colspan="6" class="text-center text-gray-400 py-8">
        ${currentOrders.some((o) => o.status === 'approved') ? 'No encontramos ventas con ese criterio.' : 'Todavía no hay ventas confirmadas.'}
      </td></tr>`;
    salesCountLabel.textContent = '';
    return;
  }

  sales.forEach((order) => {
    const shipping = order.shipping || {};
    const items = Array.isArray(order.items) ? order.items : [];
    const itemsSummary = items
      .map((item) => `${item.qty}x ${item.name}${item.variantLabel ? ` (${item.variantLabel})` : ''}`)
      .join(', ');

    const row = document.createElement('tr');
    row.className =
      'block md:table-row mb-3 md:mb-0 rounded-lg md:rounded-none border md:border-0 border-brand-border ' +
      'dark:border-slate-800 border-b dark:border-b-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40 p-3 md:p-0';
    row.innerHTML = `
      <td data-label="Fecha" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
        ${formatOrderDate(order.createdAt)}
      </td>
      <td data-label="Comprador" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        <p class="font-medium">${escapeHtml(shipping.fullName) || '-'}</p>
        <p class="text-xs text-gray-400">${escapeHtml(shipping.phone) || ''}</p>
      </td>
      <td data-label="Productos" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-gray-600 dark:text-gray-300">${escapeHtml(itemsSummary)}</td>
      <td data-label="Entrega" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">${getShippingSummary(order)}</td>
      <td data-label="Total" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 font-semibold">${formatPrice(order.total)}</td>
      <td class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-left md:text-right whitespace-nowrap mt-2 md:mt-0">
        <button class="text-xs font-semibold text-primary hover:underline" data-view-sale="${escapeHtml(order.id)}">Ver</button>
      </td>
    `;
    salesTableBody.appendChild(row);
  });

  salesCountLabel.textContent = `Mostrando ${sales.length} venta${sales.length === 1 ? '' : 's'}`;
}

salesSearchInput?.addEventListener('input', (e) => {
  salesSearchTerm = e.target.value;
  renderSalesTable();
});

salesTableBody?.addEventListener('click', (e) => {
  const viewBtn = e.target.closest('[data-view-sale]');
  if (!viewBtn) return;
  const order = currentOrders.find((o) => o.id === viewBtn.dataset.viewSale);
  if (order) openOrderDetailModal(order);
});

// ---------------------------------------------------------------------------
// Estilos: colores + tipografía de la tienda (configuracion/tema).
// Presets curados (para que se vea prolijo sin exponer 8 selectores de
// color sueltos) + un modo "Personalizado" con 2 colores (primario/acento):
// el resto de los tonos (hover, fondo suave, acento en modo oscuro) se
// derivan automáticamente aclarando/oscureciendo esos 2 — ver deriveCustomTheme.
// ---------------------------------------------------------------------------

const COLOR_PALETTES = [
  {
    id: 'carbon-cobre',
    label: 'Carbón + Cobre (default)',
    colors: {
      colorPrimary: '31 41 55',
      colorPrimaryDark: '17 24 39',
      colorPrimaryLight: '243 232 218',
      colorPrimaryBright: '227 166 109',
      colorSecondary: '181 121 60',
      colorSecondaryDark: '150 96 45',
      colorBg: '250 249 247',
      colorBorder: '229 226 220',
    },
  },
  {
    id: 'verde-clasico',
    label: 'Verde clásico',
    colors: {
      colorPrimary: '22 163 74',
      colorPrimaryDark: '21 128 61',
      colorPrimaryLight: '220 252 231',
      colorPrimaryBright: '52 211 153',
      colorSecondary: '217 119 6',
      colorSecondaryDark: '180 83 9',
      colorBg: '249 250 251',
      colorBorder: '229 231 235',
    },
  },
  {
    id: 'negro-dorado',
    label: 'Negro + Dorado',
    colors: {
      colorPrimary: '17 17 17',
      colorPrimaryDark: '0 0 0',
      colorPrimaryLight: '250 240 210',
      colorPrimaryBright: '230 190 100',
      colorSecondary: '191 149 63',
      colorSecondaryDark: '156 118 42',
      colorBg: '250 250 248',
      colorBorder: '230 228 220',
    },
  },
  {
    id: 'marino-coral',
    label: 'Azul marino + Coral',
    colors: {
      colorPrimary: '30 58 95',
      colorPrimaryDark: '17 39 66',
      colorPrimaryLight: '219 234 254',
      colorPrimaryBright: '125 178 255',
      colorSecondary: '224 94 79',
      colorSecondaryDark: '185 68 55',
      colorBg: '248 250 252',
      colorBorder: '224 231 240',
    },
  },
  { id: 'custom', label: 'Personalizado…' },
];

const FONT_PRESETS = [
  { id: 'inter', label: 'Inter (default)', fontFamily: 'Inter', fontGoogleParam: 'Inter' },
  { id: 'plus-jakarta', label: 'Plus Jakarta Sans', fontFamily: 'Plus Jakarta Sans', fontGoogleParam: 'Plus+Jakarta+Sans' },
  { id: 'poppins', label: 'Poppins', fontFamily: 'Poppins', fontGoogleParam: 'Poppins' },
  { id: 'dm-sans', label: 'DM Sans', fontFamily: 'DM Sans', fontGoogleParam: 'DM+Sans' },
];

function hexToRgbTriplet(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function rgbTripletToHex(triplet) {
  const [r, g, b] = (triplet || '0 0 0').split(' ').map(Number);
  const toHex = (n) => Math.max(0, Math.min(255, n || 0)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Mezcla un color hex con blanco/negro (amount 0 = el color original, 1 = el destino). Sin dependencias. */
function mixHexTriplet(hex, targetHex, amount) {
  const a = hexToRgbTriplet(hex).split(' ').map(Number);
  const b = hexToRgbTriplet(targetHex).split(' ').map(Number);
  const mixed = a.map((channel, i) => Math.round(channel + (b[i] - channel) * amount));
  return mixed.join(' ');
}

/** A partir de 2 colores (primario/acento) elegidos a mano, deriva el resto de los tonos que necesita el tema. */
function deriveCustomTheme(primaryHex, secondaryHex) {
  return {
    colorPrimary: hexToRgbTriplet(primaryHex),
    colorPrimaryDark: mixHexTriplet(primaryHex, '#000000', 0.35),
    colorPrimaryLight: mixHexTriplet(primaryHex, '#ffffff', 0.9),
    colorPrimaryBright: mixHexTriplet(primaryHex, '#ffffff', 0.45),
    colorSecondary: hexToRgbTriplet(secondaryHex),
    colorSecondaryDark: mixHexTriplet(secondaryHex, '#000000', 0.3),
    colorBg: '250 249 247',
    colorBorder: '229 226 220',
  };
}

function populateStylesSelects() {
  stylesPaletteSelect.innerHTML = COLOR_PALETTES.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  stylesFontSelect.innerHTML = FONT_PRESETS.map((f) => `<option value="${f.id}">${f.label}</option>`).join('');
}

function renderStylesPreview(colors) {
  const swatches = [
    { key: 'colorPrimary', label: 'Primario' },
    { key: 'colorSecondary', label: 'Acento' },
    { key: 'colorPrimaryLight', label: 'Fondo suave' },
  ];
  stylesPreview.innerHTML = swatches
    .map(
      (s) => `
      <span class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <span class="w-6 h-6 rounded-full border border-brand-border dark:border-slate-700" style="background: rgb(${colors[s.key]})"></span>
        ${s.label}
      </span>`
    )
    .join('');
}

function getCurrentPaletteColors() {
  if (stylesPaletteSelect.value === 'custom') {
    return deriveCustomTheme(stylesCustomPrimary.value, stylesCustomSecondary.value);
  }
  const palette = COLOR_PALETTES.find((p) => p.id === stylesPaletteSelect.value);
  return palette?.colors || COLOR_PALETTES[0].colors;
}

function updateStylesPreview() {
  renderStylesPreview(getCurrentPaletteColors());
}

stylesPaletteSelect?.addEventListener('change', () => {
  stylesCustomColors.classList.toggle('hidden', stylesPaletteSelect.value !== 'custom');
  updateStylesPreview();
});

stylesCustomPrimary?.addEventListener('input', updateStylesPreview);
stylesCustomSecondary?.addEventListener('input', updateStylesPreview);

/** Carga en el form lo que ya está guardado (o los defaults si la tienda nunca tocó "Estilos"). */
function applyBrandThemeToForm(theme) {
  if (!theme) {
    stylesPaletteSelect.value = COLOR_PALETTES[0].id;
    stylesFontSelect.value = FONT_PRESETS[0].id;
    stylesCustomColors.classList.add('hidden');
    updateStylesPreview();
    return;
  }

  // ¿El tema guardado coincide exactamente con algún preset? Si no, lo tratamos como "Personalizado".
  const matchingPalette = COLOR_PALETTES.find(
    (p) => p.colors && p.colors.colorPrimary === theme.colorPrimary && p.colors.colorSecondary === theme.colorSecondary
  );
  if (matchingPalette) {
    stylesPaletteSelect.value = matchingPalette.id;
    stylesCustomColors.classList.add('hidden');
  } else {
    stylesPaletteSelect.value = 'custom';
    stylesCustomColors.classList.remove('hidden');
    if (theme.colorPrimary) stylesCustomPrimary.value = rgbTripletToHex(theme.colorPrimary);
    if (theme.colorSecondary) stylesCustomSecondary.value = rgbTripletToHex(theme.colorSecondary);
  }

  const matchingFont = FONT_PRESETS.find((f) => f.fontFamily === theme.fontFamily);
  stylesFontSelect.value = matchingFont?.id || FONT_PRESETS[0].id;

  updateStylesPreview();
}

stylesForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  stylesFormError.classList.add('hidden');
  stylesFormSuccess.classList.add('hidden');

  const colors = getCurrentPaletteColors();
  const font = FONT_PRESETS.find((f) => f.id === stylesFontSelect.value) || FONT_PRESETS[0];

  stylesSaveBtn.disabled = true;
  stylesSaveBtn.textContent = 'Guardando...';

  try {
    await updateBrandTheme({
      ...colors,
      fontFamily: font.fontFamily,
      fontGoogleParam: font.fontGoogleParam,
    });
    stylesFormSuccess.textContent = 'Listo — ya se aplicó en la tienda para todos los visitantes.';
    stylesFormSuccess.classList.remove('hidden');
    showToast('Estilos actualizados correctamente.');
  } catch (err) {
    console.error(err);
    stylesFormError.textContent = 'No se pudieron guardar los estilos. Revisá la consola para más detalles.';
    stylesFormError.classList.remove('hidden');
  } finally {
    stylesSaveBtn.disabled = false;
    stylesSaveBtn.textContent = 'Guardar estilos';
  }
});

populateStylesSelects();
applyBrandThemeToForm(null); // valores por defecto hasta que llegue el primer snapshot de Firestore

subscribeBrandTheme((theme) => {
  applyBrandThemeToForm(theme);
});

// ---------------------------------------------------------------------------
// Suscripción en tiempo real a Firestore
// ---------------------------------------------------------------------------

subscribeToProducts((products) => {
  currentProducts = products;
  renderAll();
});

subscribeToCategories((categories) => {
  allCategories = categories;
  renderCategoryOptions();
});

subscribeToOrders((orders) => {
  currentOrders = orders;
  renderOrdersTable();
  renderSalesTable();
  updateAttentionBanner();
});