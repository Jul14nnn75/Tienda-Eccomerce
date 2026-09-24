// js/firebase.js
// Inicialización única de Firebase (Firestore, Storage, Auth),
// consumida por app.js y admin.js. Credenciales desde import.meta.env.

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
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

// Aviso visible si falta configurar Firebase en .env (evita el skeleton infinito)
const missingKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingKeys.length) {
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<div style="background:#b91c1c;color:#fff;padding:12px;text-align:center;font:14px sans-serif">
      Firebase no configurado: faltan ${missingKeys.join(', ')} en .env — reiniciá <code>npm run dev</code>.
    </div>`
  );
  throw new Error(`Firebase no configurado. Faltan: ${missingKeys.join(', ')}`);
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

const PRODUCTS_COLLECTION = 'productos';
const ORDERS_COLLECTION = 'pedidos';
const CATEGORIES_COLLECTION = 'categorias';
const CONFIG_COLLECTION = 'configuracion';
const THEME_DOC_ID = 'tema';

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
// Tema de marca (configuracion/tema) — colores + tipografía editables desde
// el panel admin (pestaña "Estilos"). Lectura pública (lo necesita CUALQUIER
// visitante de la tienda para pintar los colores correctos, no solo el
// admin), escritura solo admin — ver firestore.rules. Si el doc no existe
// todavía (tienda que nunca tocó "Estilos"), subscribeBrandTheme manda
// `null` y js/brand-theme.js simplemente no toca nada: quedan los valores
// por defecto de css/input.css (:root). No hace falta ninguna migración.
// ---------------------------------------------------------------------------

export function subscribeBrandTheme(callback) {
  return onSnapshot(
    doc(db, CONFIG_COLLECTION, THEME_DOC_ID),
    (snap) => callback(snap.exists() ? snap.data() : null),
    (error) => {
      console.error('Error al leer el tema de marca:', error);
      callback(null);
    }
  );
}

export async function updateBrandTheme(data) {
  await setDoc(
    doc(db, CONFIG_COLLECTION, THEME_DOC_ID),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// ---------------------------------------------------------------------------
// Pedidos (Firestore) — cada pedido queda atado al uid del comprador
// ---------------------------------------------------------------------------

/**
 * Crea un pedido asociado al usuario actual (ver firestore.rules: solo se
 * puede crear si data.userId === request.auth.uid, status es 'pending',
 * total/items tienen forma válida, y shipping tiene la forma de
 * validShipping() — ver firestore.rules).
 * @param {{userId: string, items: Array, total: number, shipping: object}} orderData
 */
export async function createOrder(orderData) {
  const docRef = await addDoc(collection(db, ORDERS_COLLECTION), {
    ...orderData,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  return docRef;
}

/**
 * Panel admin: pedidos en tiempo real, del más nuevo al más viejo. Requiere
 * el custom claim admin (ver firestore.rules — "allow read: ... || isAdmin()").
 * Si Firestore pide crear un índice para el orderBy, la consola te va a dar
 * el link directo para crearlo con un clic.
 */
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
 * Actualiza el estado de "envío/entrega" que maneja el admin a mano
 * (fulfillmentStatus: pendiente → preparando → enviado → entregado).
 * Distinto de "status", que es el estado del PAGO y lo controla únicamente
 * el webhook de Mercado Pago (ver functions/index.js) — el admin nunca debería
 * poder marcar un pedido como pagado a mano desde acá.
 */
export async function updateOrderFulfillment(id, fulfillmentStatus) {
  await updateDoc(doc(db, ORDERS_COLLECTION, id), {
    fulfillmentStatus,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Limpia el aviso de "reposición automática de stock" de un pedido
 * (needsAttention) después de que el admin lo revisó — ver mercadoPagoWebhook
 * en functions/index.js, que es quien lo prende.
 */
export async function acknowledgeOrderAttention(id) {
  await updateDoc(doc(db, ORDERS_COLLECTION, id), {
    needsAttention: false,
    updatedAt: serverTimestamp(),
  });
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

/**
 * ID token del usuario actual, para mandar en el header Authorization al
 * llamar a createPreference (la Cloud Function lo verifica antes de dejar
 * tocar un pedido — ver functions/index.js#requireAuth).
 * @returns {Promise<string|null>}
 */
export function getAuthToken() {
  if (!auth.currentUser) return Promise.resolve(null);
  return auth.currentUser.getIdToken();
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
