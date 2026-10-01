// js/cart.js
// Maneja el estado del carrito y su persistencia en localStorage.
//
// El carrito se guarda con una clave por sesión (namespace), para que el
// carrito de un usuario/sesión de Firebase Auth (incluida la sesión anónima
// automática) no se mezcle con el de otra persona que use el mismo navegador
// (ej: dos clientes distintos en la misma compu de un local). setCartNamespace
// la llama app.js una vez que Firebase Auth resuelve quién es el visitante.
//
// Nota: esto NO sincroniza el carrito entre dispositivos (localStorage es
// por navegador) — solo evita que se mezclen carritos de sesiones distintas
// en el mismo navegador.
//
// Cada item guarda su "stock" disponible al momento de agregarlo, y tanto
// addToCart como updateQty usan ese tope para no dejar comprar más unidades
// de las que había en Firestore en ese momento (el checkout revalida el
// stock real contra Firestore antes de procesar el pago, ver checkout.js).

const STORAGE_PREFIX = 'tienda_cart_v1';
let namespace = 'guest';

/** @typedef {{id:string, name:string, price:number, image:string, qty:number, stock:number}} CartItem */

function getStorageKey() {
  return `${STORAGE_PREFIX}:${namespace}`;
}

/**
 * Cambia el namespace del carrito (normalmente al uid de Firebase Auth).
 * Si había un carrito "guest" con items y el nuevo namespace todavía no
 * tiene carrito propio, migra esos items en vez de perderlos.
 */
export function setCartNamespace(uid) {
  const previousKey = getStorageKey();
  namespace = uid || 'guest';
  const newKey = getStorageKey();

  if (previousKey !== newKey) {
    const previousRaw = localStorage.getItem(previousKey);
    const alreadyHasNew = localStorage.getItem(newKey);
    if (previousRaw && !alreadyHasNew) {
      localStorage.setItem(newKey, previousRaw);
      localStorage.removeItem(previousKey);
    }
    document.dispatchEvent(new CustomEvent('cart:updated', { detail: { items: readCart() } }));
  }
}

/** @returns {CartItem[]} */
function readCart() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Carrito corrupto en localStorage, se reinicia.', err);
    return [];
  }
}

/** @param {CartItem[]} items */
function writeCart(items) {
  localStorage.setItem(getStorageKey(), JSON.stringify(items));
  document.dispatchEvent(new CustomEvent('cart:updated', { detail: { items } }));
}

function getStockCap(stock) {
  return Number.isFinite(stock) ? stock : Infinity;
}

export function getCart() {
  return readCart();
}

export function getCartCount() {
  return readCart().reduce((sum, item) => sum + item.qty, 0);
}

export function getCartTotal() {
  return readCart().reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function addToCart(product, qty = 1) {
  const items = readCart();
  const cap = getStockCap(product.stock);
  const existing = items.find((item) => item.id === product.id);
  const previousQty = existing ? existing.qty : 0;
  const desiredQty = previousQty + qty;
  const finalQty = Math.min(desiredQty, cap);

  if (existing) {
    existing.qty = finalQty;
    existing.stock = cap;
  } else {
    items.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image || '',
      stock: cap,
      qty: finalQty,
    });
  }

  writeCart(items);
  return { added: finalQty - previousQty, cappedByStock: desiredQty > cap };
}

export function updateQty(productId, qty) {
  let items = readCart();
  if (qty <= 0) {
    items = items.filter((item) => item.id !== productId);
  } else {
    const item = items.find((i) => i.id === productId);
    if (item) {
      const cap = getStockCap(item.stock);
      item.qty = Math.min(qty, cap);
    }
  }
  writeCart(items);
}

export function removeFromCart(productId) {
  const items = readCart().filter((item) => item.id !== productId);
  writeCart(items);
}

/**
 * Actualiza el stock "conocido" de un item ya en el carrito (después de
 * revalidar contra Firestore en el checkout) y recorta la cantidad si
 * ahora supera ese stock. A diferencia de updateQty, esto corrige el TOPE
 * guardado, no solo la cantidad actual.
 */
export function syncItemStock(productId, freshStock) {
  const items = readCart();
  const item = items.find((i) => i.id === productId);
  if (!item) return;
  item.stock = freshStock;
  item.qty = Math.min(item.qty, freshStock);
  writeCart(items);
}

export function clearCart() {
  writeCart([]);
}
