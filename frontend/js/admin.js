// js/admin.js
// Panel de administración: login con Firebase Auth, protección de sesión,
// CRUD de productos con saneamiento de datos, métricas, búsqueda,
// confirmación de borrado y notificaciones toast.

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
  updateOrderStatus,
  loginWithEmail,
  logout,
  resetPassword,
  watchAuthState,
  translateAuthError,
} from './firebase.js';
import { STORE_CONFIG } from './config.js';

document.title = `Dashboard | ${STORE_CONFIG.name}`;

let allCategories = [];

let currentProducts = [];
let editingProductId = null; // null = modo "crear"
let pendingDelete = null; // { type: 'product'|'category', id, label }
let searchTerm = '';
let categoryFilter = 'Todas';
let sortState = { key: null, direction: 'asc' };

let currentOrders = [];
let orderStatusFilter = 'Todos';
let orderSearchTerm = '';
let orderDateFilter = 'Todos';
let firstOrdersSnapshotReceived = false;
let previousOrderIds = new Set();
let recentlyAddedOrderIds = new Set();
let orderBeingViewed = null;

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

// --- DOM: pestañas ---
const tabProducts = document.getElementById('tab-products');
const tabOrders = document.getElementById('tab-orders');
const viewProducts = document.getElementById('view-products');
const viewOrders = document.getElementById('view-orders');
const ordersPendingBadge = document.getElementById('orders-pending-badge');

// --- DOM: pedidos ---
const metricOrdersPending = document.getElementById('metric-orders-pending');
const metricOrdersProgress = document.getElementById('metric-orders-progress');
const metricOrdersCompleted = document.getElementById('metric-orders-completed');
const ordersSearchInput = document.getElementById('orders-search');
const ordersDateFilterSelect = document.getElementById('orders-date-filter');
const ordersStatusFilter = document.getElementById('orders-status-filter');
const btnExportOrders = document.getElementById('btn-export-orders');
const ordersTableBody = document.getElementById('orders-table-body');
const ordersCountLabel = document.getElementById('orders-count-label');

// --- DOM: mini dashboard de ventas ---
const metricSalesToday = document.getElementById('metric-sales-today');
const metricSalesWeek = document.getElementById('metric-sales-week');
const metricSalesMonth = document.getElementById('metric-sales-month');
const salesChart = document.getElementById('sales-chart');
const topProductsList = document.getElementById('top-products-list');

const orderDetailModal = document.getElementById('order-detail-modal');
const orderDetailClose = document.getElementById('order-detail-close');
const orderDetailStatus = document.getElementById('order-detail-status');
const orderDetailCustomer = document.getElementById('order-detail-customer');
const orderDetailShipping = document.getElementById('order-detail-shipping');
const orderDetailItems = document.getElementById('order-detail-items');
const orderDetailTotal = document.getElementById('order-detail-total');
const orderDetailStatusSelect = document.getElementById('order-detail-status-select');
const orderDetailSaveStatus = document.getElementById('order-detail-save-status');

// --- DOM: toasts ---
const toastContainer = document.getElementById('toast-container');

const LOW_STOCK_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : 'toast-success'}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s ease-out';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

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
// Helpers de negocio (compartidos con la tabla y las métricas)
// ---------------------------------------------------------------------------

function formatPrice(value) {
  return `$${Number(value ?? 0).toLocaleString('es-AR')}`;
}

function hasValidOffer(product) {
  const list = Number(product.listPrice);
  const offer = Number(product.offerPrice);
  if (!list || list <= 0) return false;
  if (product.offerPrice == null || Number.isNaN(offer)) return false;
  return offer > 0 && offer < list;
}

function getStockBadge(stock) {
  const value = Number(stock ?? 0);
  if (value <= 0) return { label: `${value}`, className: 'stock-badge-out' };
  if (value <= LOW_STOCK_THRESHOLD) return { label: `${value}`, className: 'stock-badge-low' };
  return { label: `${value}`, className: 'stock-badge-ok' };
}

function isLowStock(product) {
  const value = Number(product.stock ?? 0);
  return value <= LOW_STOCK_THRESHOLD;
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
        <span class="text-sm font-medium">${cat.name}</span>
        <button
          class="icon-btn-delete"
          data-delete-category="${cat.id}"
          data-category-name="${cat.name}"
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
      valA = hasValidOffer(a) ? a.offerPrice : a.listPrice;
      valB = hasValidOffer(b) ? b.offerPrice : b.listPrice;
    } else if (sortState.key === 'stock') {
      valA = Number(a.stock ?? 0);
      valB = Number(b.stock ?? 0);
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
    const stockBadge = getStockBadge(product.stock);
    const isOffer = hasValidOffer(product);

    const row = document.createElement('tr');
    row.className =
      'block md:table-row mb-3 md:mb-0 rounded-lg md:rounded-none border md:border-0 border-brand-border ' +
      'dark:border-slate-800 border-b dark:border-b-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40 p-3 md:p-0';
    row.innerHTML = `
      <td class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        <img src="${product.image || 'https://placehold.co/48x48'}" class="w-12 h-12 rounded-lg bg-slate-800/50 object-contain p-1" />
      </td>
      <td data-label="Nombre" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 font-medium">${product.name}</td>
      <td data-label="Marca" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-gray-500 dark:text-gray-400">${product.brand || '-'}</td>
      <td data-label="Categoría" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        ${product.category ? `<span class="category-pill">${product.category}</span>` : '-'}
      </td>
      <td data-label="Precio" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        ${formatPrice(isOffer ? product.offerPrice : product.listPrice)}
        ${isOffer ? `<span class="text-xs text-gray-400 line-through ml-1">${formatPrice(product.listPrice)}</span>` : ''}
      </td>
      <td data-label="Stock" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        <span class="${stockBadge.className}">${stockBadge.label}</span>
      </td>
      <td class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-left md:text-right whitespace-nowrap mt-2 md:mt-0">
        <button class="icon-btn-edit" data-edit="${product.id}" title="Editar producto" aria-label="Editar producto">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" />
          </svg>
        </button>
        <button class="icon-btn-delete" data-delete="${product.id}" data-name="${product.name}" title="Eliminar producto" aria-label="Eliminar producto">
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

function openModal(product = null) {
  editingProductId = product?.id ?? null;
  modalTitle.textContent = product ? 'Editar producto' : 'Nuevo producto';
  formError.classList.add('hidden');

  productForm.reset();
  imagePreview.classList.add('hidden');

  if (product) {
    productForm.elements['name'].value = product.name || '';
    productForm.elements['brand'].value = product.brand || '';
    productForm.elements['category'].value = product.category || '';
    productForm.elements['listPrice'].value = product.listPrice ?? '';
    productForm.elements['offerPrice'].value = product.offerPrice ?? '';
    productForm.elements['stock'].value = product.stock ?? 0;
    productForm.elements['flavor'].value = product.flavor || '';
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

  const data = {
    name: fd['name'].value.trim(),
    brand: fd['brand'].value.trim(),
    category: fd['category'].value,
    listPrice,
    offerPrice,
    stock: parseInt(fd['stock'].value || '0', 10),
    flavor: fd['flavor'].value.trim(),
    description: fd['description'].value.trim(),
    image: imageUrlInput.value.trim(),
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
// Pestañas Productos / Pedidos
// ---------------------------------------------------------------------------

function showProductsTab() {
  tabProducts.classList.add('admin-tab-active');
  tabOrders.classList.remove('admin-tab-active');
  viewProducts.classList.remove('hidden');
  viewOrders.classList.add('hidden');
}

function showOrdersTab() {
  tabOrders.classList.add('admin-tab-active');
  tabProducts.classList.remove('admin-tab-active');
  viewOrders.classList.remove('hidden');
  viewProducts.classList.add('hidden');
}

tabProducts?.addEventListener('click', showProductsTab);
tabOrders?.addEventListener('click', showOrdersTab);

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

function formatOrderDate(timestamp) {
  if (!timestamp?.toDate) return '—';
  return timestamp.toDate().toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Flujo de estados de un pedido: pendiente de pago → pagado → preparando →
 * listo/enviado → completado. La etiqueta de "listo" y "completado" cambia
 * de texto según el método de entrega (retiro vs envío), aunque el valor
 * guardado en Firestore es el mismo para los dos casos.
 */
function getOrderStatusLabel(status, shippingMethod) {
  const isPickup = shippingMethod !== 'delivery';
  const labels = {
    pending: 'Pendiente de pago',
    paid: 'Pagado',
    preparing: 'Preparando',
    ready: isPickup ? 'Listo para retirar' : 'Enviado',
    completed: isPickup ? 'Retirado' : 'Entregado',
  };
  return labels[status] || labels.pending;
}

function getOrderStatusBadgeClass(status) {
  const classes = {
    pending: 'stock-badge-low',
    paid: 'stock-badge-info',
    preparing: 'stock-badge-progress',
    ready: 'stock-badge-ok',
    completed: 'stock-badge-done',
  };
  return classes[status] || classes.pending;
}

function orderStatusBadge(order) {
  const status = order.status || 'pending';
  return `<span class="${getOrderStatusBadgeClass(status)}">${getOrderStatusLabel(status, order.shipping?.method)}</span>`;
}

function orderShippingSummary(order) {
  if (order.shipping?.method === 'delivery') {
    const addr = order.shipping.address;
    return addr ? `Envío — ${addr.address}, ${addr.city} (CP ${addr.zip})` : 'Envío a domicilio';
  }
  return 'Retiro en el local';
}

function renderOrdersMetrics() {
  const pending = currentOrders.filter((o) => (o.status || 'pending') === 'pending').length;
  const inProgress = currentOrders.filter((o) => ['paid', 'preparing', 'ready'].includes(o.status)).length;
  const completed = currentOrders.filter((o) => o.status === 'completed').length;

  metricOrdersPending.textContent = pending;
  metricOrdersProgress.textContent = inProgress;
  metricOrdersCompleted.textContent = completed;

  ordersPendingBadge.textContent = pending;
  ordersPendingBadge.classList.toggle('hidden', pending === 0);
}

/** true si la fecha del pedido cae dentro del filtro elegido (hoy/semana/mes). */
function orderMatchesDateFilter(order) {
  if (orderDateFilter === 'Todos') return true;
  const date = order.createdAt?.toDate?.();
  if (!date) return false;

  const now = new Date();
  if (orderDateFilter === 'today') {
    return date.toDateString() === now.toDateString();
  }
  if (orderDateFilter === 'week') {
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);
    return date >= sevenDaysAgo;
  }
  if (orderDateFilter === 'month') {
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }
  return true;
}

function getFilteredOrders() {
  const term = orderSearchTerm.trim().toLowerCase();

  return currentOrders.filter((order) => {
    const matchesStatus = orderStatusFilter === 'Todos' || (order.status || 'pending') === orderStatusFilter;
    const matchesSearch =
      !term ||
      order.customerName?.toLowerCase().includes(term) ||
      order.customerPhone?.toLowerCase().includes(term);
    const matchesDate = orderMatchesDateFilter(order);
    return matchesStatus && matchesSearch && matchesDate;
  });
}

function renderOrdersTable() {
  const filtered = getFilteredOrders();
  ordersTableBody.innerHTML = '';

  if (filtered.length === 0) {
    ordersTableBody.innerHTML = `
      <tr><td colspan="7" class="text-center text-gray-400 py-8">
        ${currentOrders.length === 0 ? 'Todavía no entró ningún pedido.' : 'No hay pedidos que coincidan con la búsqueda.'}
      </td></tr>`;
    ordersCountLabel.textContent = currentOrders.length === 0 ? '' : `Mostrando 0 de ${currentOrders.length} pedidos`;
    return;
  }

  filtered.forEach((order) => {
    const itemsSummary =
      order.items?.length > 0
        ? `${order.items[0].name}${order.items.length > 1 ? ` y ${order.items.length - 1} más` : ''}`
        : '—';

    const row = document.createElement('tr');
    row.className =
      'block md:table-row mb-3 md:mb-0 rounded-lg md:rounded-none border md:border-0 border-brand-border ' +
      'dark:border-slate-800 border-b dark:border-b-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40 p-3 md:p-0 cursor-pointer' +
      (recentlyAddedOrderIds.has(order.id) ? ' new-order-row' : '');
    row.dataset.orderId = order.id;
    row.innerHTML = `
      <td data-label="Fecha" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-gray-500 dark:text-gray-400">${formatOrderDate(order.createdAt)}</td>
      <td data-label="Cliente" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 font-medium">${order.customerName || '—'}<br/><span class="text-xs text-gray-400">${order.customerPhone || ''}</span></td>
      <td data-label="Productos" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">${itemsSummary}</td>
      <td data-label="Entrega" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-xs">${orderShippingSummary(order)}</td>
      <td data-label="Total" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 font-semibold">${formatPrice(order.total)}</td>
      <td data-label="Estado" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">${orderStatusBadge(order)}</td>
      <td class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-left md:text-right">
        <span class="text-brand-green-dark dark:text-emerald-400 text-xs font-semibold">Ver →</span>
      </td>
    `;
    ordersTableBody.appendChild(row);
  });

  ordersCountLabel.textContent = `Mostrando ${filtered.length} de ${currentOrders.length} pedidos`;
}

ordersStatusFilter?.addEventListener('change', (e) => {
  orderStatusFilter = e.target.value;
  renderOrdersTable();
});

ordersSearchInput?.addEventListener('input', (e) => {
  orderSearchTerm = e.target.value;
  renderOrdersTable();
});

ordersDateFilterSelect?.addEventListener('change', (e) => {
  orderDateFilter = e.target.value;
  renderOrdersTable();
});

function openOrderDetailModal(order) {
  orderBeingViewed = order;

  orderDetailStatus.innerHTML = orderStatusBadge(order);
  orderDetailCustomer.textContent =
    `${order.customerName || 'Sin nombre'} — ${order.customerPhone || 'sin teléfono'}` +
    (order.customerEmail ? ` — ${order.customerEmail}` : '');
  orderDetailShipping.textContent = orderShippingSummary(order);

  orderDetailItems.innerHTML = (order.items || [])
    .map(
      (item) => `
      <div class="flex justify-between">
        <span>${item.qty}x ${item.name}</span>
        <span class="text-gray-500 dark:text-gray-400">${formatPrice(item.price * item.qty)}</span>
      </div>`
    )
    .join('');

  orderDetailTotal.textContent = formatPrice(order.total);
  orderDetailStatusSelect.value = order.status || 'pending';

  orderDetailModal.classList.remove('hidden');
}

function closeOrderDetailModal() {
  orderDetailModal.classList.add('hidden');
  orderBeingViewed = null;
}

orderDetailClose?.addEventListener('click', closeOrderDetailModal);
orderDetailModal?.addEventListener('click', (e) => {
  if (e.target === orderDetailModal) closeOrderDetailModal();
});

ordersTableBody?.addEventListener('click', (e) => {
  const row = e.target.closest('[data-order-id]');
  if (!row) return;
  const order = currentOrders.find((o) => o.id === row.dataset.orderId);
  if (order) openOrderDetailModal(order);
});

orderDetailSaveStatus?.addEventListener('click', async () => {
  if (!orderBeingViewed) return;
  const newStatus = orderDetailStatusSelect.value;

  orderDetailSaveStatus.disabled = true;
  try {
    await updateOrderStatus(orderBeingViewed.id, newStatus);
    showToast('Estado del pedido actualizado.');
    closeOrderDetailModal();
  } catch (err) {
    console.error(err);
    showToast('No se pudo actualizar el pedido.', 'error');
  } finally {
    orderDetailSaveStatus.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Exportar pedidos a CSV (respeta los filtros aplicados en pantalla)
// ---------------------------------------------------------------------------

function escapeCsvField(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportOrdersToCsv() {
  const orders = getFilteredOrders();
  if (orders.length === 0) {
    showToast('No hay pedidos para exportar con ese filtro.', 'error');
    return;
  }

  const headers = ['Fecha', 'Cliente', 'Teléfono', 'Email', 'Productos', 'Entrega', 'Total', 'Estado'];
  const rows = orders.map((order) => [
    formatOrderDate(order.createdAt),
    order.customerName || '',
    order.customerPhone || '',
    order.customerEmail || '',
    (order.items || []).map((item) => `${item.qty}x ${item.name}`).join(' | '),
    orderShippingSummary(order),
    order.total || 0,
    getOrderStatusLabel(order.status || 'pending', order.shipping?.method),
  ]);

  const csvContent = [headers, ...rows].map((row) => row.map(escapeCsvField).join(',')).join('\n');
  // \uFEFF (BOM) al principio: sin esto, Excel rompe las tildes/ñ al abrir el CSV.
  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `pedidos_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

btnExportOrders?.addEventListener('click', exportOrdersToCsv);

// ---------------------------------------------------------------------------
// Mini dashboard de ventas
// ---------------------------------------------------------------------------

/** Cuenta como venta cualquier pedido que ya no esté esperando el pago. */
function isRevenueOrder(order) {
  return (order.status || 'pending') !== 'pending';
}

function renderSalesDashboard() {
  const now = new Date();
  const todayStr = now.toDateString();

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);

  let salesToday = 0;
  let salesWeek = 0;
  let salesMonth = 0;
  const dailyTotals = {}; // 'YYYY-MM-DD' -> monto vendido ese día
  const productTotals = {}; // nombre de producto -> { qty, revenue }

  currentOrders.forEach((order) => {
    if (!isRevenueOrder(order)) return;
    const date = order.createdAt?.toDate?.();
    if (!date) return;

    const total = Number(order.total) || 0;

    if (date.toDateString() === todayStr) salesToday += total;
    if (date >= sevenDaysAgo) salesWeek += total;
    if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) salesMonth += total;
    if (date >= sevenDaysAgo) {
      const key = date.toISOString().slice(0, 10);
      dailyTotals[key] = (dailyTotals[key] || 0) + total;
    }

    (order.items || []).forEach((item) => {
      const key = item.name || 'Producto';
      if (!productTotals[key]) productTotals[key] = { qty: 0, revenue: 0 };
      productTotals[key].qty += Number(item.qty) || 0;
      productTotals[key].revenue += (Number(item.price) || 0) * (Number(item.qty) || 0);
    });
  });

  metricSalesToday.textContent = formatPrice(salesToday);
  metricSalesWeek.textContent = formatPrice(salesWeek);
  metricSalesMonth.textContent = formatPrice(salesMonth);

  renderSalesChart(dailyTotals);
  renderTopProducts(productTotals);
}

function renderSalesChart(dailyTotals) {
  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d);
  }

  const values = days.map((d) => dailyTotals[d.toISOString().slice(0, 10)] || 0);
  const max = Math.max(...values, 1);

  salesChart.innerHTML = days
    .map((d, i) => {
      const value = values[i];
      const heightPct = Math.max((value / max) * 100, 2);
      const label = d.toLocaleDateString('es-AR', { weekday: 'short' }).slice(0, 3);
      return `
        <div class="flex-1 flex flex-col items-center justify-end gap-1 h-full" title="${formatPrice(value)}">
          <div class="w-full bg-brand-green dark:bg-emerald-500 rounded-t" style="height: ${heightPct}%"></div>
          <span class="text-[10px] text-gray-400 capitalize">${label}</span>
        </div>`;
    })
    .join('');
}

function renderTopProducts(productTotals) {
  const sorted = Object.entries(productTotals)
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 5);

  if (sorted.length === 0) {
    topProductsList.innerHTML = '<p class="text-gray-400 text-xs">Todavía no hay ventas pagadas.</p>';
    return;
  }

  topProductsList.innerHTML = sorted
    .map(
      ([name, data], index) => `
      <div class="flex items-center justify-between gap-2">
        <span class="text-gray-500 dark:text-gray-400 w-4">${index + 1}.</span>
        <span class="flex-1 truncate">${name}</span>
        <span class="text-xs text-gray-400 flex-shrink-0">${data.qty}u</span>
        <span class="font-semibold text-brand-green-dark dark:text-emerald-400 flex-shrink-0">${formatPrice(data.revenue)}</span>
      </div>`
    )
    .join('');
}

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
  // Detecta pedidos nuevos (no presentes en el snapshot anterior) para avisar
  // en vivo — pero no en la primera carga, donde "todos" serían "nuevos".
  if (firstOrdersSnapshotReceived) {
    const newOnes = orders.filter((o) => !previousOrderIds.has(o.id));
    if (newOnes.length > 0) {
      newOnes.forEach((order) => {
        showToast(`Nuevo pedido de ${order.customerName || 'un cliente'} — ${formatPrice(order.total)}`);
        recentlyAddedOrderIds.add(order.id);
      });
      // Saca el resaltado después de un par de segundos.
      setTimeout(() => {
        newOnes.forEach((order) => recentlyAddedOrderIds.delete(order.id));
        renderOrdersTable();
      }, 2500);
    }
  }
  previousOrderIds = new Set(orders.map((o) => o.id));
  firstOrdersSnapshotReceived = true;

  currentOrders = orders;
  renderOrdersMetrics();
  renderOrdersTable();
  renderSalesDashboard();
});