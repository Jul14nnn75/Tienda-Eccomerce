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
  createLocalSale,
  subscribeToShippingSettings,
  saveShippingSettings,
  loginWithEmail,
  logout,
  resetPassword,
  watchAuthState,
  translateAuthError,
} from './firebase.js';
import { normalizeShippingSettings } from './shipping.js';
import tienda from '../tienda.config.js';

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
const tabShipping = document.getElementById('tab-shipping');
const viewShipping = document.getElementById('view-shipping');
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
const metricOrdersToday = document.getElementById('metric-orders-today');
const metricSalesWeekDelta = document.getElementById('metric-sales-week-delta');
const metricOrdersMonth = document.getElementById('metric-orders-month');
const metricAvgTicket = document.getElementById('metric-avg-ticket');
const summaryOrdersTodo = document.getElementById('summary-orders-todo');
const summaryLowStock = document.getElementById('summary-low-stock');

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

/**
 * Escapa texto antes de meterlo en HTML armado con template strings. Es
 * obligatorio para todo lo que escribe el comprador (nombre, teléfono,
 * dirección): sin esto, un pedido con HTML en el nombre se ejecutaría acá,
 * dentro de la sesión del admin.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
        <span class="text-sm font-medium">${escapeHtml(cat.name)}</span>
        <button
          class="icon-btn-delete"
          data-delete-category="${cat.id}"
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
    const pausedBadge =
      product.active === false ? ' <span class="stock-badge-done ml-1 align-middle">Pausado</span>' : '';

    const row = document.createElement('tr');
    row.className =
      'block md:table-row mb-3 md:mb-0 rounded-lg md:rounded-none border md:border-0 border-brand-border ' +
      'dark:border-slate-800 border-b dark:border-b-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40 p-3 md:p-0';
    row.innerHTML = `
      <td class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        <img src="${escapeHtml(product.image || 'https://placehold.co/48x48')}" class="w-12 h-12 rounded-lg bg-slate-800/50 object-contain p-1" />
      </td>
      <td data-label="Nombre" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 font-medium">${escapeHtml(product.name)}${pausedBadge}</td>
      <td data-label="Marca" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-gray-500 dark:text-gray-400">${escapeHtml(product.brand || '-')}</td>
      <td data-label="Categoría" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        ${product.category ? `<span class="category-pill">${escapeHtml(product.category)}</span>` : '-'}
      </td>
      <td data-label="Precio" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        ${formatPrice(isOffer ? product.offerPrice : product.listPrice)}
        ${isOffer ? `<span class="text-xs text-gray-400 line-through ml-1">${formatPrice(product.listPrice)}</span>` : ''}
      </td>
      <td data-label="Stock" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">
        <button type="button" data-edit-stock="${product.id}" class="${stockBadge.className} cursor-pointer hover:ring-2 hover:ring-brand-primary/40" title="Clic para cambiar el stock">${stockBadge.label}</button>
      </td>
      <td class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-left md:text-right whitespace-nowrap mt-2 md:mt-0">
        <button
          type="button"
          data-toggle-active="${product.id}"
          class="text-xs font-semibold px-2.5 py-1 mr-1 rounded-md border border-brand-border dark:border-slate-700 text-gray-600 dark:text-slate-300
                 hover:border-brand-primary hover:text-brand-primary-dark dark:hover:border-brand-accent dark:hover:text-brand-accent transition-colors"
          title="${product.active === false ? 'Volver a mostrarlo en la tienda' : 'Ocultarlo de la tienda sin borrarlo'}"
        >
          ${product.active === false ? 'Reactivar' : 'Pausar'}
        </button>
        <button class="icon-btn-edit" data-edit="${product.id}" title="Editar producto" aria-label="Editar producto">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" />
          </svg>
        </button>
        <button class="icon-btn-delete" data-delete="${product.id}" data-name="${escapeHtml(product.name)}" title="Eliminar producto" aria-label="Eliminar producto">
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
  renderSummaryLowStock();
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
  const toggleBtn = e.target.closest('[data-toggle-active]');

  if (toggleBtn) {
    const product = currentProducts.find((p) => p.id === toggleBtn.dataset.toggleActive);
    if (!product) return;
    const willBeActive = product.active === false;
    toggleBtn.disabled = true;
    updateProduct(product.id, { active: willBeActive })
      .then(() => showToast(willBeActive ? 'Producto visible en la tienda.' : 'Producto pausado.'))
      .catch((err) => {
        console.error(err);
        showToast('No se pudo actualizar el producto.', 'error');
        toggleBtn.disabled = false;
      });
    return;
  }

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
    productForm.elements['active'].checked = product.active !== false;
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
    // false = pausado: sigue en el panel pero no se muestra ni se vende en la tienda.
    active: fd['active'].checked,
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

const adminTabs = {
  summary: { tab: document.getElementById('tab-summary'), view: document.getElementById('view-summary') },
  products: { tab: tabProducts, view: viewProducts },
  orders: { tab: tabOrders, view: viewOrders },
  shipping: { tab: tabShipping, view: viewShipping },
};

function goToTab(name) {
  Object.entries(adminTabs).forEach(([key, entry]) => {
    entry.tab.classList.toggle('admin-tab-active', key === name);
    entry.view.classList.toggle('hidden', key !== name);
  });
}

Object.entries(adminTabs).forEach(([name, { tab }]) => {
  tab?.addEventListener('click', () => goToTab(name));
});

// Atajos "Ver todos →" de las tarjetas del resumen.
document.querySelectorAll('[data-go-tab]').forEach((btn) => {
  btn.addEventListener('click', () => goToTab(btn.dataset.goTab));
});

// ---------------------------------------------------------------------------
// Envíos: costo general, envío gratis y zonas por código postal
// (se guarda en Firestore, config/envios; el cálculo está en js/shipping.js)
// ---------------------------------------------------------------------------

const shippingForm = document.getElementById('shipping-form');
const shippingDefaultCostInput = document.getElementById('shipping-default-cost');
const shippingFreeFromInput = document.getElementById('shipping-free-from');
const shippingOnlyZonesInput = document.getElementById('shipping-only-zones');
const shippingZonesList = document.getElementById('shipping-zones-list');
const shippingZonesEmpty = document.getElementById('shipping-zones-empty');
const btnAddZone = document.getElementById('btn-add-zone');
const shippingSaveBtn = document.getElementById('shipping-save-btn');
const shippingFormError = document.getElementById('shipping-form-error');

// true mientras el admin tiene cambios sin guardar: evita que una
// actualización de Firestore le pise lo que está escribiendo.
let shippingFormDirty = false;

function addZoneRow(zone = { name: '', zips: '', cost: '' }) {
  const row = document.createElement('div');
  row.className = 'grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_7rem_auto] gap-2 items-start';
  row.dataset.zoneRow = '';
  row.innerHTML = `
    <input data-zone-field="name" type="text" maxlength="40" placeholder="Nombre (ej: Zona norte)" aria-label="Nombre de la zona" class="input-field text-sm" />
    <input data-zone-field="zips" type="text" placeholder="Códigos postales (ej: 1228, 1400-1499)" aria-label="Códigos postales" class="input-field text-sm" />
    <input data-zone-field="cost" type="number" min="0" step="1" placeholder="Costo" aria-label="Costo de envío" class="input-field text-sm" />
    <button type="button" data-zone-remove class="icon-btn-delete" aria-label="Quitar zona">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
      </svg>
    </button>`;
  // Los valores se asignan por propiedad (no dentro del HTML) para que un
  // nombre con comillas o "<" no rompa la fila.
  row.querySelector('[data-zone-field="name"]').value = zone.name;
  row.querySelector('[data-zone-field="zips"]').value = zone.zips;
  row.querySelector('[data-zone-field="cost"]').value = zone.cost;
  shippingZonesList.appendChild(row);
  shippingZonesEmpty.classList.add('hidden');
}

function renderShippingForm(settings) {
  shippingDefaultCostInput.value = settings.defaultCost;
  shippingFreeFromInput.value = settings.freeFrom;
  shippingOnlyZonesInput.checked = settings.onlyZones;
  shippingZonesList.innerHTML = '';
  shippingZonesEmpty.classList.toggle('hidden', settings.zones.length > 0);
  settings.zones.forEach((zone) => addZoneRow(zone));
}

/** Lee el formulario; devuelve { settings } o { error } si hay algo mal cargado. */
function readShippingForm() {
  const zones = [];
  for (const row of shippingZonesList.querySelectorAll('[data-zone-row]')) {
    const name = row.querySelector('[data-zone-field="name"]').value.trim();
    const zips = row.querySelector('[data-zone-field="zips"]').value.trim();
    const costRaw = row.querySelector('[data-zone-field="cost"]').value;
    if (!name && !zips && costRaw === '') continue; // fila vacía: se ignora

    if (!name) return { error: 'Hay una zona sin nombre.' };
    if (!/^\d{4}(-\d{4})?([\s,;]+\d{4}(-\d{4})?)*$/.test(zips)) {
      return {
        error: `Revisá los códigos postales de "${name}": van de 4 dígitos, separados por coma (ej: 1228, 1400-1499).`,
      };
    }
    const cost = Number(costRaw);
    if (costRaw === '' || !Number.isFinite(cost) || cost < 0) {
      return { error: `Falta el costo de envío de "${name}".` };
    }
    zones.push({ name, zips, cost });
  }

  const defaultCost = Number(shippingDefaultCostInput.value);
  const freeFrom = Number(shippingFreeFromInput.value);
  if (shippingDefaultCostInput.value === '' || !Number.isFinite(defaultCost) || defaultCost < 0) {
    return { error: 'Completá el costo de envío general.' };
  }
  if (shippingFreeFromInput.value === '' || !Number.isFinite(freeFrom) || freeFrom < 0) {
    return { error: 'Completá el monto de envío gratis (0 si no ofrecés envío gratis).' };
  }
  if (shippingOnlyZonesInput.checked && zones.length === 0) {
    return { error: 'Para enviar solo a las zonas cargadas, primero agregá al menos una zona.' };
  }

  return { settings: { defaultCost, freeFrom, onlyZones: shippingOnlyZonesInput.checked, zones } };
}

btnAddZone?.addEventListener('click', () => {
  addZoneRow();
  shippingFormDirty = true;
  shippingZonesList.lastElementChild.querySelector('input').focus();
});

shippingZonesList?.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('[data-zone-remove]');
  if (!removeBtn) return;
  removeBtn.closest('[data-zone-row]').remove();
  shippingFormDirty = true;
  shippingZonesEmpty.classList.toggle('hidden', shippingZonesList.children.length > 0);
});

shippingForm?.addEventListener('input', () => {
  shippingFormDirty = true;
});

shippingForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { settings, error } = readShippingForm();
  shippingFormError.textContent = error || '';
  shippingFormError.classList.toggle('hidden', !error);
  if (error) return;

  shippingSaveBtn.disabled = true;
  try {
    await saveShippingSettings(settings);
    shippingFormDirty = false;
    renderShippingForm(settings);
    showToast('Envíos actualizados.');
  } catch (err) {
    console.error(err);
    showToast('No se pudieron guardar los envíos.', 'error');
  } finally {
    shippingSaveBtn.disabled = false;
  }
});

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

// Paso siguiente de cada estado, para el botón rápido de la lista. "pending"
// no tiene: lo pasa a pagado el webhook de Mercado Pago (o el admin a mano
// desde el detalle).
const NEXT_ORDER_STATUS = { paid: 'preparing', preparing: 'ready', ready: 'completed' };

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
    const zone = order.shipping.zone ? ` (${order.shipping.zone})` : '';
    return addr ? `Envío${zone} — ${addr.address}, ${addr.city} (CP ${addr.zip})` : 'Envío a domicilio';
  }
  if (order.source === 'local') {
    return `Venta en el local${order.paymentMethod ? ` — ${order.paymentMethod}` : ''}`;
  }
  return 'Retiro en el local';
}

/**
 * Pedido abandonado: quedó "pendiente de pago" hace más horas que las de
 * tienda.config.js (orders.abandonedAfterHours). El pedido se crea antes de
 * cobrar, así que cada comprador que no termina el pago deja uno; se ocultan
 * de la lista y de los contadores para que no tapen los pedidos reales.
 */
function isAbandonedOrder(order) {
  if ((order.status || 'pending') !== 'pending') return false;
  const created = order.createdAt?.toDate?.();
  if (!created) return false;
  return Date.now() - created.getTime() > tienda.orders.abandonedAfterHours * 60 * 60 * 1000;
}

function renderOrdersMetrics() {
  const pending = currentOrders.filter(
    (o) => (o.status || 'pending') === 'pending' && !isAbandonedOrder(o)
  ).length;
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
    // Los abandonados solo aparecen con su propio filtro.
    const matchesStatus =
      orderStatusFilter === 'abandoned'
        ? isAbandonedOrder(order)
        : !isAbandonedOrder(order) &&
          (orderStatusFilter === 'Todos' || (order.status || 'pending') === orderStatusFilter);
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

    const nextStatus = NEXT_ORDER_STATUS[order.status];

    const row = document.createElement('tr');
    row.className =
      'block md:table-row mb-3 md:mb-0 rounded-lg md:rounded-none border md:border-0 border-brand-border ' +
      'dark:border-slate-800 border-b dark:border-b-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40 p-3 md:p-0 cursor-pointer' +
      (recentlyAddedOrderIds.has(order.id) ? ' new-order-row' : '');
    row.dataset.orderId = order.id;
    row.innerHTML = `
      <td data-label="Fecha" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-gray-500 dark:text-gray-400">${formatOrderDate(order.createdAt)}</td>
      <td data-label="Cliente" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 font-medium">${escapeHtml(order.customerName || '—')}<br/><span class="text-xs text-gray-400">${escapeHtml(order.customerPhone || '')}</span></td>
      <td data-label="Productos" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">${escapeHtml(itemsSummary)}</td>
      <td data-label="Entrega" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-xs">${escapeHtml(orderShippingSummary(order))}</td>
      <td data-label="Total" class="block md:table-cell py-1 md:py-2 px-0 md:px-3 font-semibold">${formatPrice(order.total)}</td>
      <td data-label="Estado" class="block md:table-cell py-1 md:py-2 px-0 md:px-3">${orderStatusBadge(order)}</td>
      <td class="block md:table-cell py-1 md:py-2 px-0 md:px-3 text-left md:text-right whitespace-nowrap">
        ${
          nextStatus
            ? `<button type="button" data-advance-order="${order.id}" data-next-status="${nextStatus}"
                 class="text-xs font-semibold px-2.5 py-1 rounded-md border border-brand-border dark:border-slate-700
                        hover:border-brand-primary hover:text-brand-primary-dark dark:hover:border-brand-accent dark:hover:text-brand-accent transition-colors"
                 title="Pasar el pedido al siguiente estado">
                 ${escapeHtml(getOrderStatusLabel(nextStatus, order.shipping?.method))} →
               </button>`
            : ''
        }
        <span class="text-brand-primary-dark dark:text-brand-accent text-xs font-semibold ml-2">Ver</span>
      </td>
    `;
    ordersTableBody.appendChild(row);
  });

  const abandoned = currentOrders.filter(isAbandonedOrder).length;
  ordersCountLabel.textContent =
    `Mostrando ${filtered.length} de ${currentOrders.length} pedidos` +
    (abandoned > 0 && orderStatusFilter !== 'abandoned'
      ? ` · ${abandoned} sin pagar hace más de ${tienda.orders.abandonedAfterHours} h están ocultos (filtro "Abandonados")`
      : '');
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

const orderDetailWhatsapp = document.getElementById('order-detail-whatsapp');

/**
 * Link de WhatsApp al comprador con un mensaje ya escrito según el estado
 * del pedido. Devuelve null si el teléfono no sirve.
 */
function orderWhatsappUrl(order) {
  let digits = String(order.customerPhone || '').replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length < 8) return null;
  // Si el comprador no escribió el código de país, se agrega el de tienda.config.js.
  const prefix = tienda.orders.whatsappPrefix;
  if (prefix && !digits.startsWith(prefix.slice(0, 2))) digits = prefix + digits;

  const isPickup = order.shipping?.method !== 'delivery';
  const name = (order.customerName || '').trim().split(/\s+/)[0];
  const greeting = `Hola${name ? ` ${name}` : ''}, te escribimos de ${tienda.store.name}.`;
  const messages = {
    pending: 'Vimos que tu pedido quedó sin pagar. ¿Necesitás ayuda para terminar la compra?',
    paid: 'Recibimos tu pago. ¡Gracias por tu compra! Ya estamos preparando tu pedido.',
    preparing: 'Estamos preparando tu pedido.',
    ready: isPickup ? 'Tu pedido ya está listo para retirar.' : 'Tu pedido ya está en camino.',
    completed: '¡Gracias por tu compra! Esperamos que la disfrutes.',
  };
  const message = `${greeting} ${messages[order.status] || messages.pending}`;

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

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
        <span>${escapeHtml(item.qty)}x ${escapeHtml(item.name)}</span>
        <span class="text-gray-500 dark:text-gray-400">${formatPrice(item.price * item.qty)}</span>
      </div>`
    )
    .join('');

  orderDetailTotal.textContent = formatPrice(order.total);
  orderDetailStatusSelect.value = order.status || 'pending';

  const whatsappUrl = orderWhatsappUrl(order);
  orderDetailWhatsapp.classList.toggle('hidden', !whatsappUrl);
  if (whatsappUrl) orderDetailWhatsapp.href = whatsappUrl;

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

/** Abre el detalle del pedido de la fila clickeada (tabla de pedidos y resumen). */
function handleOrderRowClick(e) {
  const advanceBtn = e.target.closest('[data-advance-order]');
  if (advanceBtn) {
    advanceOrder(advanceBtn);
    return;
  }
  const row = e.target.closest('[data-order-id]');
  if (!row) return;
  const order = currentOrders.find((o) => o.id === row.dataset.orderId);
  if (order) openOrderDetailModal(order);
}

/** Botón rápido de la fila: pasa el pedido al siguiente estado sin abrir el detalle. */
async function advanceOrder(button) {
  button.disabled = true;
  try {
    await updateOrderStatus(button.dataset.advanceOrder, button.dataset.nextStatus);
    showToast('Estado del pedido actualizado.');
  } catch (err) {
    console.error(err);
    showToast('No se pudo actualizar el pedido.', 'error');
    button.disabled = false;
  }
}

ordersTableBody?.addEventListener('click', handleOrderRowClick);
summaryOrdersTodo?.addEventListener('click', handleOrderRowClick);

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

/** Clave de día en hora LOCAL (toISOString usa UTC y corre las ventas de la noche al día siguiente). */
function localDayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** "$135.000" → "$135k", para las etiquetas del gráfico. */
function formatCompactPrice(value) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

function pluralOrders(count) {
  return count === 1 ? '1 pedido' : `${count} pedidos`;
}

function renderSalesDashboard() {
  const now = new Date();
  const todayStr = now.toDateString();

  // "Últimos 7 días" = hoy y los 6 días anteriores, igual que el gráfico.
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const previousWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13);

  let salesToday = 0;
  let ordersToday = 0;
  let salesWeek = 0;
  let salesPreviousWeek = 0;
  let salesMonth = 0;
  let ordersMonth = 0;
  const dailyTotals = {}; // clave de día local -> monto vendido ese día
  const productTotals = {}; // nombre de producto -> { qty, revenue }

  currentOrders.forEach((order) => {
    if (!isRevenueOrder(order)) return;
    const date = order.createdAt?.toDate?.();
    if (!date) return;

    const total = Number(order.total) || 0;

    if (date.toDateString() === todayStr) {
      salesToday += total;
      ordersToday += 1;
    }
    if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
      salesMonth += total;
      ordersMonth += 1;
    }
    if (date >= weekStart) {
      salesWeek += total;
      const key = localDayKey(date);
      dailyTotals[key] = (dailyTotals[key] || 0) + total;
    } else if (date >= previousWeekStart) {
      salesPreviousWeek += total;
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
  metricOrdersToday.textContent = ordersToday > 0 ? pluralOrders(ordersToday) : 'Sin ventas todavía';
  metricOrdersMonth.textContent = pluralOrders(ordersMonth);
  metricAvgTicket.textContent = formatPrice(ordersMonth > 0 ? Math.round(salesMonth / ordersMonth) : 0);

  // Comparación con los 7 días anteriores (solo si hubo ventas para comparar).
  if (salesPreviousWeek > 0) {
    const delta = Math.round(((salesWeek - salesPreviousWeek) / salesPreviousWeek) * 100);
    metricSalesWeekDelta.textContent = `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs. los 7 días anteriores`;
    metricSalesWeekDelta.className = `text-xs font-medium ${
      delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
    }`;
  } else {
    metricSalesWeekDelta.textContent = 'Sin ventas en los 7 días anteriores';
    metricSalesWeekDelta.className = 'text-xs text-gray-400';
  }

  renderSalesChart(dailyTotals);
  renderTopProducts(productTotals);
  renderSummaryOrdersTodo();
}

/** Resumen: pedidos pagados que todavía hay que preparar o entregar, los más viejos primero. */
function renderSummaryOrdersTodo() {
  const todo = currentOrders
    .filter((order) => NEXT_ORDER_STATUS[order.status])
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));

  if (todo.length === 0) {
    summaryOrdersTodo.innerHTML = '<p class="text-gray-400 text-xs py-2">No hay pedidos esperando. ¡Todo al día!</p>';
    return;
  }

  summaryOrdersTodo.innerHTML =
    todo
      .slice(0, 5)
      .map(
        (order) => `
      <div data-order-id="${order.id}" class="flex items-center justify-between gap-3 py-2 border-b last:border-b-0 border-brand-border dark:border-slate-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/40 -mx-2 px-2 rounded">
        <div class="min-w-0">
          <p class="font-medium truncate">${escapeHtml(order.customerName || 'Sin nombre')}</p>
          <p class="text-xs text-gray-400 truncate">${formatOrderDate(order.createdAt)} · ${formatPrice(order.total)}</p>
        </div>
        <span class="flex-shrink-0">${orderStatusBadge(order)}</span>
      </div>`
      )
      .join('') +
    (todo.length > 5 ? `<p class="text-xs text-gray-400 pt-2">y ${todo.length - 5} más</p>` : '');
}

/** Resumen: productos visibles con stock bajo o agotado, los más urgentes primero. */
function renderSummaryLowStock() {
  const low = currentProducts
    .filter((product) => product.active !== false && isLowStock(product))
    .sort((a, b) => Number(a.stock ?? 0) - Number(b.stock ?? 0));

  if (low.length === 0) {
    summaryLowStock.innerHTML = '<p class="text-gray-400 text-xs py-2">Todos los productos tienen stock suficiente.</p>';
    return;
  }

  summaryLowStock.innerHTML =
    low
      .slice(0, 5)
      .map((product) => {
        const badge = getStockBadge(product.stock);
        return `
      <div data-edit="${product.id}" class="flex items-center justify-between gap-3 py-2 border-b last:border-b-0 border-brand-border dark:border-slate-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/40 -mx-2 px-2 rounded">
        <span class="font-medium truncate">${escapeHtml(product.name)}</span>
        <span class="${badge.className} flex-shrink-0">${Number(product.stock ?? 0) <= 0 ? 'Agotado' : `Quedan ${badge.label}`}</span>
      </div>`;
      })
      .join('') +
    (low.length > 5 ? `<p class="text-xs text-gray-400 pt-2">y ${low.length - 5} más</p>` : '');
}

summaryLowStock?.addEventListener('click', (e) => {
  const row = e.target.closest('[data-edit]');
  const product = row && currentProducts.find((p) => p.id === row.dataset.edit);
  if (product) openModal(product);
});

function renderSalesChart(dailyTotals) {
  const days = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d);
  }

  const values = days.map((d) => dailyTotals[localDayKey(d)] || 0);
  const max = Math.max(...values, 1);

  // Cada columna: monto arriba, barra (hoy resaltado, el resto más suave) y día abajo.
  salesChart.innerHTML = days
    .map((d, i) => {
      const value = values[i];
      const isToday = i === days.length - 1;
      const heightPct = value > 0 ? Math.max((value / max) * 100, 4) : 0;
      const label = isToday ? 'Hoy' : d.toLocaleDateString('es-AR', { weekday: 'short' }).slice(0, 3);
      const fullDate = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
      return `
        <div class="flex-1 min-w-0 flex flex-col items-center gap-1.5 h-full" title="${fullDate}: ${formatPrice(value)}">
          <div class="flex-1 w-full flex flex-col items-center justify-end gap-1 border-b border-brand-border dark:border-slate-700">
            <span class="text-[11px] font-semibold ${value > 0 ? 'text-gray-600 dark:text-gray-300' : 'text-gray-300 dark:text-slate-600'}">
              ${value > 0 ? formatCompactPrice(value) : '—'}
            </span>
            <div class="w-full max-w-[3rem] rounded-t ${
              isToday ? 'bg-brand-primary dark:bg-brand-accent' : 'bg-brand-primary/40 dark:bg-brand-accent/40'
            }" style="height: ${heightPct}%"></div>
          </div>
          <span class="text-[11px] capitalize ${isToday ? 'font-bold text-gray-700 dark:text-gray-200' : 'text-gray-400'}">${label}</span>
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
        <span class="flex-1 truncate">${escapeHtml(name)}</span>
        <span class="text-xs text-gray-400 flex-shrink-0">${data.qty}u</span>
        <span class="font-semibold text-brand-primary-dark dark:text-brand-accent flex-shrink-0">${formatPrice(data.revenue)}</span>
      </div>`
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Venta en el local: el dueño carga lo que vendió en el mostrador para que
// el stock y las estadísticas no dependan solo de las ventas web.
// ---------------------------------------------------------------------------

const saleModal = document.getElementById('sale-modal');
const saleForm = document.getElementById('sale-form');
const saleSearch = document.getElementById('sale-search');
const saleProducts = document.getElementById('sale-products');
const saleItems = document.getElementById('sale-items');
const saleTotal = document.getElementById('sale-total');
const saleCustomer = document.getElementById('sale-customer');
const salePayment = document.getElementById('sale-payment');
const saleError = document.getElementById('sale-error');
const saleSubmit = document.getElementById('sale-submit');

let saleLines = []; // [{ id, qty }] — nombre, precio y stock se leen del producto al momento

function productSalePrice(product) {
  return Number(hasValidOffer(product) ? product.offerPrice : product.listPrice) || 0;
}

/** Líneas de la venta con los datos actuales de cada producto (descarta los que ya no existen). */
function getSaleDetail() {
  return saleLines
    .map((line) => {
      const product = currentProducts.find((p) => p.id === line.id);
      return product ? { product, qty: line.qty, price: productSalePrice(product) } : null;
    })
    .filter(Boolean);
}

function renderSaleProducts() {
  const term = saleSearch.value.trim().toLowerCase();
  const matches = currentProducts
    .filter((p) => !term || p.name?.toLowerCase().includes(term) || p.brand?.toLowerCase().includes(term))
    .slice(0, 30);

  if (matches.length === 0) {
    saleProducts.innerHTML = '<p class="text-gray-400 text-xs py-2">No hay productos con ese nombre.</p>';
    return;
  }

  saleProducts.innerHTML = matches
    .map((product) => {
      const stock = Number(product.stock ?? 0);
      return `
      <button type="button" data-sale-add="${product.id}" ${stock <= 0 ? 'disabled' : ''}
        class="flex items-center justify-between gap-3 text-left py-2 px-2 rounded border-b last:border-b-0 border-brand-border dark:border-slate-800
               hover:bg-gray-50 dark:hover:bg-slate-800/40 disabled:opacity-40 disabled:cursor-not-allowed">
        <span class="min-w-0">
          <span class="block font-medium truncate">${escapeHtml(product.name)}</span>
          <span class="block text-xs text-gray-400">${formatPrice(productSalePrice(product))} · ${stock <= 0 ? 'sin stock' : `stock ${stock}`}</span>
        </span>
        <span class="text-brand-primary-dark dark:text-brand-accent font-bold text-lg leading-none flex-shrink-0">+</span>
      </button>`;
    })
    .join('');
}

function renderSaleItems() {
  const detail = getSaleDetail();

  saleItems.innerHTML =
    detail.length === 0
      ? '<p class="text-gray-400 text-xs py-2">Elegí productos de la lista para sumarlos a la venta.</p>'
      : detail
          .map(
            ({ product, qty, price }) => `
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0 flex-1">
          <span class="block truncate">${escapeHtml(product.name)}</span>
          <span class="block text-xs text-gray-400">${formatPrice(price * qty)}</span>
        </span>
        <span class="flex items-center gap-1 flex-shrink-0">
          <button type="button" data-sale-qty="${product.id}" data-delta="-1" class="w-7 h-7 rounded border border-brand-border dark:border-slate-700 font-bold" aria-label="Quitar una unidad">−</button>
          <span class="w-7 text-center font-semibold">${qty}</span>
          <button type="button" data-sale-qty="${product.id}" data-delta="1" class="w-7 h-7 rounded border border-brand-border dark:border-slate-700 font-bold" aria-label="Sumar una unidad">+</button>
        </span>
      </div>`
          )
          .join('');

  saleTotal.textContent = formatPrice(detail.reduce((sum, line) => sum + line.price * line.qty, 0));
}

/** Suma o resta unidades de un producto en la venta, sin pasar el stock disponible. */
function changeSaleQty(productId, delta) {
  const product = currentProducts.find((p) => p.id === productId);
  if (!product) return;
  const stock = Number(product.stock ?? 0);
  const line = saleLines.find((l) => l.id === productId);
  const nextQty = (line?.qty ?? 0) + delta;

  if (nextQty > stock) {
    showToast(`Solo hay ${stock} en stock de "${product.name}".`, 'error');
    return;
  }
  if (nextQty <= 0) {
    saleLines = saleLines.filter((l) => l.id !== productId);
  } else if (line) {
    line.qty = nextQty;
  } else {
    saleLines.push({ id: productId, qty: nextQty });
  }
  saleError.classList.add('hidden');
  renderSaleItems();
}

function openSaleModal() {
  saleLines = [];
  saleForm.reset();
  saleError.classList.add('hidden');
  renderSaleProducts();
  renderSaleItems();
  saleModal.classList.remove('hidden');
  saleSearch.focus();
}

function closeSaleModal() {
  saleModal.classList.add('hidden');
}

document.getElementById('btn-new-sale')?.addEventListener('click', openSaleModal);
document.getElementById('sale-close')?.addEventListener('click', closeSaleModal);
document.getElementById('sale-cancel')?.addEventListener('click', closeSaleModal);
saleSearch?.addEventListener('input', renderSaleProducts);

saleProducts?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-sale-add]');
  if (btn) changeSaleQty(btn.dataset.saleAdd, 1);
});

saleItems?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-sale-qty]');
  if (btn) changeSaleQty(btn.dataset.saleQty, Number(btn.dataset.delta));
});

saleForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const detail = getSaleDetail();

  let error = '';
  if (detail.length === 0) error = 'Agregá al menos un producto.';
  const short = detail.find(({ product, qty }) => qty > Number(product.stock ?? 0));
  if (short) error = `No alcanza el stock de "${short.product.name}".`;

  saleError.textContent = error;
  saleError.classList.toggle('hidden', !error);
  if (error) return;

  const total = detail.reduce((sum, line) => sum + line.price * line.qty, 0);

  saleSubmit.disabled = true;
  try {
    await createLocalSale({
      customerName: saleCustomer.value.trim() || 'Venta en el local',
      paymentMethod: salePayment.value,
      items: detail.map(({ product, qty, price }) => ({ id: product.id, name: product.name, price, qty })),
      total,
    });
    showToast(`Venta registrada — ${formatPrice(total)}`);
    closeSaleModal();
  } catch (err) {
    console.error(err);
    saleError.textContent = 'No se pudo registrar la venta. Revisá la conexión y probá de nuevo.';
    saleError.classList.remove('hidden');
  } finally {
    saleSubmit.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Comprobante imprimible de un pedido (para armar el paquete o entregar)
// ---------------------------------------------------------------------------

function printOrder(order) {
  const rows = (order.items || [])
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.qty)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td class="num">${formatPrice(item.price)}</td>
        <td class="num">${formatPrice(item.price * item.qty)}</td>
      </tr>`
    )
    .join('');

  const shippingCost = Number(order.shipping?.cost) || 0;
  const contact = [order.customerPhone, order.customerEmail].filter(Boolean).map(escapeHtml).join(' · ');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Pedido ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; margin: 32px; font-size: 14px; }
    h1 { font-size: 22px; margin: 0; }
    .muted { color: #666; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
    .block { margin-bottom: 16px; }
    .label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #666; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; color: #666; border-bottom: 1px solid #999; padding: 6px 4px; }
    td { padding: 6px 4px; border-bottom: 1px solid #ddd; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .total td { border-bottom: 0; font-weight: 700; font-size: 16px; }
  </style>
</head>
<body>
  <div class="head">
    <div>
      <h1>${escapeHtml(tienda.store.name)}</h1>
      <div class="muted">Pedido ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</div>
    </div>
    <div style="text-align: right">
      <div>${escapeHtml(formatOrderDate(order.createdAt))}</div>
      <div class="muted">${escapeHtml(getOrderStatusLabel(order.status || 'pending', order.shipping?.method))}</div>
    </div>
  </div>

  <div class="block">
    <div class="label">Cliente</div>
    <div>${escapeHtml(order.customerName || 'Sin nombre')}</div>
    ${contact ? `<div class="muted">${contact}</div>` : ''}
  </div>

  <div class="block">
    <div class="label">Entrega</div>
    <div>${escapeHtml(orderShippingSummary(order))}</div>
  </div>

  <table>
    <thead>
      <tr><th>Cant.</th><th>Producto</th><th class="num">Precio</th><th class="num">Subtotal</th></tr>
    </thead>
    <tbody>
      ${rows}
      ${shippingCost > 0 ? `<tr><td></td><td>Envío</td><td></td><td class="num">${formatPrice(shippingCost)}</td></tr>` : ''}
      <tr class="total"><td></td><td>Total</td><td></td><td class="num">${formatPrice(order.total)}</td></tr>
    </tbody>
  </table>
</body>
</html>`;

  const printWindow = window.open('', '_blank', 'width=720,height=900');
  if (!printWindow) {
    showToast('El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes.', 'error');
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

document.getElementById('order-detail-print')?.addEventListener('click', () => {
  if (orderBeingViewed) printOrder(orderBeingViewed);
});

// ---------------------------------------------------------------------------
// Stock editable desde la tabla: clic en la cantidad, escribir y Enter
// ---------------------------------------------------------------------------

productsTableBody?.addEventListener('click', (e) => {
  const badge = e.target.closest('[data-edit-stock]');
  if (!badge) return;

  const product = currentProducts.find((p) => p.id === badge.dataset.editStock);
  if (!product) return;

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.value = Number(product.stock ?? 0);
  input.className = 'input-field text-sm w-20 py-1';
  input.setAttribute('aria-label', `Stock de ${product.name}`);
  badge.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const value = parseInt(input.value, 10);
    const changed = save && Number.isInteger(value) && value >= 0 && value !== Number(product.stock ?? 0);

    if (save && (!Number.isInteger(value) || value < 0)) {
      showToast('El stock tiene que ser un número de 0 para arriba.', 'error');
    }
    if (changed) {
      try {
        await updateProduct(product.id, { stock: value });
        showToast(`Stock de "${product.name}" actualizado a ${value}.`);
        return; // la tabla se vuelve a dibujar sola cuando Firestore avisa del cambio
      } catch (err) {
        console.error(err);
        showToast('No se pudo actualizar el stock.', 'error');
      }
    }
    renderTable();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
});

// ---------------------------------------------------------------------------
// Suscripción en tiempo real a Firestore
// ---------------------------------------------------------------------------

subscribeToProducts((products) => {
  currentProducts = products;
  renderAll();
  if (!saleModal.classList.contains('hidden')) {
    renderSaleProducts();
    renderSaleItems();
  }
});

subscribeToCategories((categories) => {
  allCategories = categories;
  renderCategoryOptions();
});

subscribeToShippingSettings((raw) => {
  if (shippingFormDirty) return;
  renderShippingForm(normalizeShippingSettings(raw, tienda.shipping));
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