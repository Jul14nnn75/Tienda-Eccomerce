# Mi Tienda — E-commerce white-label (Vite + Firebase + Mercado Pago)

Catálogo público con filtros, carrito lateral con control de stock, checkout con **Mercado Pago Checkout Pro** (vía Cloud Function) y panel de administración con **Firebase Auth + custom claims**.

**Stack:** HTML + Vanilla JS (ES Modules) · Tailwind CSS 3 · Vite 5 · Firebase (Firestore, Storage, Auth, Functions) · Netlify (hosting del frontend).

---

## Estructura

```
├── index.html              # Tienda pública
├── admin.html              # Panel de administración (/admin)
├── pago/                   # Retorno de Mercado Pago: gracias / pendiente / fallido
├── css/input.css           # Tailwind + VARIABLES DE TEMA (colores, fuente)
├── js/
│   ├── config.js           # Nombre de la tienda, moneda, umbral de stock bajo
│   ├── utils.js            # Helpers compartidos (precios, escape, toasts)
│   ├── firebase.js         # Init de Firebase + acceso a datos y auth
│   ├── app.js              # Catálogo, filtros, modal de producto, checkout
│   ├── cart.js             # Estado del carrito (localStorage, por sesión)
│   ├── checkout.js         # Revalidación de stock + llamada a la Function
│   ├── admin.js            # Dashboard: login, CRUD productos/categorías, métricas
│   ├── pago.js             # Lógica de las páginas de retorno de pago
│   └── theme.js            # Toggle claro/oscuro
├── functions/              # Cloud Function createPreference (Mercado Pago)
├── scripts/                # set-admin-claim.js (alta de administradores)
├── firestore.rules         # Reglas de Firestore (admin por custom claim)
├── storage.rules           # Reglas de Storage (imágenes de productos)
├── firebase.json / .firebaserc
├── netlify.toml            # Build y redirects para Netlify
└── .env.example            # Variables de entorno del frontend
```

---

## 1. Requisitos

- Node.js 20+
- Firebase CLI: `npm i -g firebase-tools` y `firebase login`
- Proyecto Firebase en plan **Blaze** (obligatorio para Cloud Functions)
- Cuenta de Mercado Pago con credenciales (Access Token de prueba o producción)

## 2. Configurar Firebase

1. Crear el proyecto en https://console.firebase.google.com
2. Habilitar:
   - **Firestore Database**
   - **Storage** (si vas a subir imágenes desde el admin)
   - **Authentication** → proveedores **Email/Password** y **Anónimo** (la tienda crea una sesión anónima por visitante para asociar pedidos y carrito)
3. Registrar una **app web** y copiar su configuración.
4. Poner el ID del proyecto en `.firebaserc` (reemplazar `TU-PROYECTO-FIREBASE`).
5. Agregar tu dominio de Netlify en **Authentication → Settings → Authorized domains**.

## 3. Variables de entorno (`.env`)

```bash
cp .env.example .env
```

| Variable | Descripción |
|---|---|
| `VITE_FIREBASE_API_KEY` … `VITE_FIREBASE_APP_ID` | Config de la app web de Firebase |
| `VITE_STORE_NAME` | Nombre visible de la tienda (opcional, default "Mi Tienda") |
| `VITE_MP_CREATE_PREFERENCE_URL` | URL de la Function `createPreference` (paso 5) |

> ⚠️ Todo lo que empieza con `VITE_` termina **público** en el navegador. El Access Token de Mercado Pago **nunca** va en este archivo.

## 4. Desarrollo local

```bash
npm install
npm run dev
```

- Tienda: http://localhost:5173/
- Admin: http://localhost:5173/admin.html

## 5. Backend: reglas y Cloud Function

```bash
# Reglas de seguridad
firebase deploy --only firestore:rules,storage

# Mercado Pago
cd functions
cp .env.example .env              # moneda, descriptor, ALLOWED_ORIGINS (dominio de Netlify)
npm install
firebase functions:secrets:set MP_ACCESS_TOKEN   # pegar el Access Token
firebase deploy --only functions
```

Copiá la URL que devuelve el deploy (`https://us-central1-<proyecto>.cloudfunctions.net/createPreference`) en `VITE_MP_CREATE_PREFERENCE_URL`.

**Flujo de pago:** el carrito revalida stock contra Firestore → se crea el pedido en `pedidos` (status `pending`) → la Function arma la preferencia **leyendo precio y stock desde Firestore** (el cliente solo envía `id` y `qty`) y usa el ID del pedido como `external_reference` → Mercado Pago redirige a `/pago/gracias.html`, `/pago/pago-pendiente.html` o `/pago/pago-fallido.html`.

> Mercado Pago exige `back_urls` públicas (https) para `auto_return`. Para probar el pago completo usá el deploy de Netlify, no `localhost`.

## 6. Deploy en Netlify

1. Subí el repo a GitHub/GitLab e importalo en Netlify (**Add new site → Import an existing project**).
2. Build ya configurado en `netlify.toml` (`npm run build` → `dist`). No hace falta tocar nada.
3. En **Site configuration → Environment variables** cargá **las mismas** variables `VITE_*` del `.env`.
4. Deploy. Después:
   - Agregá el dominio en *Authorized domains* de Firebase Auth.
   - Poné el dominio en `ALLOWED_ORIGINS` de `functions/.env` y volvé a deployar las functions.

> Si cambiás variables en Netlify, hacé **Clear cache and deploy** (Vite las incrusta en el build).

## 7. Alta del primer administrador

El panel valida el custom claim `admin: true` (y las reglas de Firestore/Storage también), no un email ni una contraseña en el código.

1. **Authentication → Users → Add user**: crear el usuario con email y contraseña.
2. **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**. Guardarla como `scripts/service-account.json` (ignorada por git).
3. Asignar el claim:

```bash
cd scripts
npm install
npm run set-admin -- admin@tudominio.com          # otorgar
npm run set-admin -- admin@tudominio.com --remove # revocar
```

4. Ingresar en `/admin`. Si ya tenía sesión abierta, cerrar sesión y volver a entrar.

> Borrá o guardá fuera del repo `service-account.json` cuando termines: da acceso total al proyecto.

## 8. Personalización (white-label)

- **Colores y fuente:** bloque `:root` al inicio de `css/input.css` (valores RGB). Se aplican a tienda, admin y páginas de pago.
  ```css
  --color-primary: 37 99 235;      /* ej: azul */
  --color-primary-dark: 29 78 216;
  ```
- **Nombre:** `VITE_STORE_NAME` en `.env`.
- **Logo:** reemplazar el SVG del header en `index.html` (comentado).
- **Moneda / formato:** `js/config.js` (frontend) y `MP_CURRENCY_ID` en `functions/.env`.
- **Stock bajo:** `LOW_STOCK_THRESHOLD` en `js/config.js`.

## Modelo de datos (Firestore)

**`productos`**
```js
{
  name: string,           // obligatorio
  brand: string,
  category: string,       // nombre de un doc de `categorias`
  listPrice: number,      // obligatorio
  offerPrice: number|null,// < listPrice para mostrarse como oferta
  stock: number,
  variant: string,        // opcional: color, talle, tamaño...
  description: string,
  image: string,          // URL directa o de Firebase Storage
  createdAt, updatedAt    // serverTimestamp
}
```

**`categorias`** `{ name, createdAt }` · **`pedidos`** `{ userId, items[{id,name,price,qty}], total, status, createdAt }`

## Pendiente / fuera de alcance

- **Webhook de Mercado Pago:** el `status` de `pedidos` queda en `pending`; para marcarlo `approved` y descontar stock automáticamente hay que agregar una Function que reciba las notificaciones IPN/Webhook y busque el pedido por `external_reference`.
