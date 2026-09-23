// js/firebase.js
// Inicialización única de Firebase (Firestore, Storage, Auth),
// consumida por app.js y admin.js. Credenciales desde import.meta.env.

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
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