// js/firebase.js
// Inicialización única de Firebase (Firestore, Storage, Auth),
// consumida por app.js y admin.js. Credenciales desde import.meta.env.

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  increment,
} from 'firebase/firestore';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';
import {
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

const PRODUCTS_COLLECTION = 'productos';
const ORDERS_COLLECTION = 'pedidos';
const CATEGORIES_COLLECTION = 'categorias';

// ---------------------------------------------------------------------------
// Productos (Firestore)
// ---------------------------------------------------------------------------

export function subscribeToProducts(callback) {
  const q = query(collection(db, PRODUCTS_COLLECTION), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const products = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      callback(products);
    },
    (error) => {
      console.error('Error al leer productos de Firestore:', error);
      callback([]);
    }
  );
}

export async function fetchProductsOnce() {
  const snapshot = await getDocs(collection(db, PRODUCTS_COLLECTION));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function getProductById(id) {
  const snap = await getDoc(doc(db, PRODUCTS_COLLECTION, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createProduct(data) {
  const docRef = await addDoc(collection(db, PRODUCTS_COLLECTION), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef;
}

export async function updateProduct(id, data) {
  await updateDoc(doc(db, PRODUCTS_COLLECTION, id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteProduct(id) {
  await deleteDoc(doc(db, PRODUCTS_COLLECTION, id));
}

export async function uploadProductImage(file, productId) {
  const path = `products/${productId}/${Date.now()}-${file.name}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file);
  return getDownloadURL(ref);
}
// ---------------------------------------------------------------------------
// Categorías (Firestore) — fuente única de verdad para el select del admin,
// el filtro del dashboard y los tabs de la tienda pública.
// ---------------------------------------------------------------------------

export function subscribeToCategories(callback) {
  const q = query(collection(db, CATEGORIES_COLLECTION), orderBy('name', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const categories = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      callback(categories);
    },
    (error) => {
      console.error('Error al leer categorías de Firestore:', error);
      callback([]);
    }
  );
}

export async function createCategory(name) {
  const docRef = await addDoc(collection(db, CATEGORIES_COLLECTION), {
    name,
    createdAt: serverTimestamp(),
  });
  return docRef;
}

export async function deleteCategory(id) {
  await deleteDoc(doc(db, CATEGORIES_COLLECTION, id));
}

// ---------------------------------------------------------------------------
// Configuración de envíos (Firestore, documento config/envios) — la edita el
// admin desde la pestaña "Envíos"; la leen la tienda y el Worker de pagos.
// ---------------------------------------------------------------------------

const SHIPPING_SETTINGS_DOC = ['config', 'envios'];

/** Llama al callback con el contenido del documento, o null si no existe. */
export function subscribeToShippingSettings(callback) {
  return onSnapshot(
    doc(db, ...SHIPPING_SETTINGS_DOC),
    (snap) => callback(snap.exists() ? snap.data() : null),
    (error) => {
      console.error('Error al leer la configuración de envíos:', error);
      callback(null);
    }
  );
}

export async function saveShippingSettings(settings) {
  await setDoc(doc(db, ...SHIPPING_SETTINGS_DOC), { ...settings, updatedAt: serverTimestamp() });
}

// ---------------------------------------------------------------------------
// Pedidos (Firestore) — cada pedido queda atado al uid del comprador
// ---------------------------------------------------------------------------

/**
 * Crea un pedido asociado al usuario actual (ver firestore.rules: solo se
 * puede crear si data.userId === request.auth.uid).
 * @param {{userId: string, items: Array, total: number}} orderData
 */
export async function createOrder(orderData) {
  const docRef = await addDoc(collection(db, ORDERS_COLLECTION), {
    ...orderData,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  return docRef;
}

/** Solo para el panel admin: lista todos los pedidos, más nuevos primero. */
export function subscribeToOrders(callback) {
  const q = query(collection(db, ORDERS_COLLECTION), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const orders = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      callback(orders);
    },
    (error) => {
      console.error('Error al leer pedidos de Firestore:', error);
      callback([]);
    }
  );
}

/**
 * Registra una venta hecha en el local desde el panel: crea el pedido ya
 * completado y descuenta el stock de cada producto, todo junto (si algo
 * falla, no se guarda nada). Solo admin (ver firestore.rules).
 * @param {{customerName:string, paymentMethod:string, items:Array<{id,name,price,qty}>, total:number}} sale
 */
export async function createLocalSale(sale) {
  const batch = writeBatch(db);
  const orderRef = doc(collection(db, ORDERS_COLLECTION));

  batch.set(orderRef, {
    userId: auth.currentUser.uid,
    source: 'local',
    customerName: sale.customerName,
    customerPhone: '',
    customerEmail: '',
    paymentMethod: sale.paymentMethod,
    items: sale.items,
    total: sale.total,
    shipping: { method: 'pickup', cost: 0, zone: null, address: null },
    status: 'completed',
    createdAt: serverTimestamp(),
    paidAt: serverTimestamp(),
  });

  sale.items.forEach((item) => {
    batch.update(doc(db, PRODUCTS_COLLECTION, item.id), {
      stock: increment(-item.qty),
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();
  return orderRef;
}

/** Estados en los que el pedido NO tiene el stock descontado. */
const STATUSES_WITHOUT_STOCK = ['pending', 'cancelled'];

/**
 * true si el stock de este pedido está descontado ahora mismo. Los pedidos
 * viejos no tienen el campo stockDiscounted: se deduce de paidAt, que solo
 * escriben el webhook de pagos y las ventas del local (los dos descuentan).
 */
export function isOrderStockDiscounted(order) {
  return order.stockDiscounted ?? Boolean(order.paidAt);
}

/**
 * Cambia el estado de un pedido desde el panel y mantiene el stock
 * consistente, todo junto: al cancelar (o volver a "pendiente") devuelve las
 * unidades; al marcarlo como pagado a mano las descuenta.
 * @param {object} order — el pedido tal como está en Firestore (con id)
 * @param {string} newStatus
 * @param {Set<string>} existingProductIds — productos que siguen existiendo;
 *   a los borrados no se les puede tocar el stock.
 */
export async function changeOrderStatus(order, newStatus, existingProductIds) {
  const batch = writeBatch(db);
  const discounted = isOrderStockDiscounted(order);
  const shouldBeDiscounted = !STATUSES_WITHOUT_STOCK.includes(newStatus);

  const orderUpdate = { status: newStatus };

  if (discounted !== shouldBeDiscounted) {
    const sign = shouldBeDiscounted ? -1 : 1;
    (order.items || [])
      .filter((item) => existingProductIds.has(item.id) && Number(item.qty) > 0)
      .forEach((item) => {
        batch.update(doc(db, PRODUCTS_COLLECTION, item.id), {
          stock: increment(sign * Math.round(Number(item.qty))),
          updatedAt: serverTimestamp(),
        });
      });
    orderUpdate.stockDiscounted = shouldBeDiscounted;
    if (shouldBeDiscounted && !order.paidAt) orderUpdate.paidAt = serverTimestamp();
  }
  if (newStatus === 'cancelled') orderUpdate.cancelledAt = serverTimestamp();

  batch.update(doc(db, ORDERS_COLLECTION, order.id), orderUpdate);
  await batch.commit();
}

/**
 * Aplica cambios a muchos productos de una vez (ej: actualización masiva de
 * precios). Firestore admite hasta 500 escrituras por lote, así que se parte.
 * @param {Array<{id:string, data:object}>} updates
 */
export async function bulkUpdateProducts(updates) {
  for (let i = 0; i < updates.length; i += 400) {
    const batch = writeBatch(db);
    updates.slice(i, i + 400).forEach(({ id, data }) => {
      batch.update(doc(db, PRODUCTS_COLLECTION, id), { ...data, updatedAt: serverTimestamp() });
    });
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// Autenticación (Firebase Auth)
// ---------------------------------------------------------------------------

/**
 * Garantiza que haya una sesión activa antes de operar contra Firestore
 * (necesario para que las reglas de "pedidos" puedan identificar al dueño).
 * Si el visitante no tiene sesión, inicia una sesión anónima automática
 * (no le pide registro ni contraseña).
 * @returns {Promise<import('firebase/auth').User|null>}
 */
export function ensureAnonymousAuth() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (user) {
        resolve(user);
        return;
      }
      signInAnonymously(auth)
        .then((credential) => resolve(credential.user))
        .catch((err) => {
          console.error('No se pudo iniciar sesión anónima:', err);
          resolve(null);
        });
    });
  });
}

export function loginWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export function translateAuthError(error) {
  const map = {
    'auth/invalid-email': 'El email ingresado no es válido.',
    'auth/user-disabled': 'Esta cuenta fue deshabilitada.',
    'auth/user-not-found': 'No existe una cuenta con ese email.',
    'auth/wrong-password': 'La contraseña es incorrecta.',
    'auth/invalid-credential': 'Email o contraseña incorrectos.',
    'auth/too-many-requests': 'Demasiados intentos fallidos. Probá de nuevo más tarde.',
    'auth/missing-password': 'Ingresá una contraseña.',
  };
  return map[error?.code] || 'Ocurrió un error al iniciar sesión. Intentá de nuevo.';
}