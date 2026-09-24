# Mi Tienda — E-commerce white-label (Vite + Firebase + Mercado Pago)

Catálogo público con filtros, carrito lateral con control de stock, checkout con datos de envío + **Mercado Pago Checkout Pro** (vía Cloud Function) y panel de administración con **Firebase Auth + custom claims** (productos, categorías y pedidos).

**Stack:** HTML + Vanilla JS (ES Modules) · Tailwind CSS 3 · Vite 5 · Firebase (Firestore, Storage, Auth, Functions, **Hosting**).

---

## Estructura

```
├── index.html              # Tienda pública (catálogo, carrito, checkout con envío)
├── admin.html              # Panel de administración (/admin): productos, categorías y pedidos
├── pago/                   # Retorno de Mercado Pago: gracias / pendiente / fallido
├── css/input.css           # Tailwind + VARIABLES DE TEMA (colores, fuente)
├── js/
│   ├── config.js           # Nombre de la tienda, moneda, stock bajo, envío
│   ├── utils.js            # Helpers compartidos (precios, escape, toasts)
│   ├── firebase.js         # Init de Firebase + acceso a datos y auth
│   ├── app.js               # Catálogo, filtros, modal de producto, carrito, checkout + envío
│   ├── cart.js              # Estado del carrito (localStorage, por sesión)
│   ├── checkout.js          # Revalidación de stock + llamada a la Function
│   ├── admin.js              # Dashboard: login, CRUD productos/categorías, pedidos, métricas
│   ├── pago.js               # Lógica de las páginas de retorno de pago
│   └── theme.js              # Toggle claro/oscuro
├── functions/              # Cloud Functions de Mercado Pago (createPreference, mercadoPagoWebhook)
├── scripts/                # set-admin-claim.js (alta de administradores)
├── firestore.rules         # Reglas de Firestore (admin por custom claim, validación de pedidos)
├── storage.rules           # Reglas de Storage (imágenes de productos)
├── firebase.json / .firebaserc  # Incluye la config de Firebase Hosting
└── .env                    # Variables de entorno del frontend (no se commitea)
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
5. Habilitar **Hosting** en la consola (el dominio `tu-proyecto.web.app`/`.firebaseapp.com` que te da Firebase queda autorizado para Auth automáticamente; si más adelante conectás un dominio propio, agregalo en **Authentication → Settings → Authorized domains**).

## 3. Variables de entorno (`.env`)

Creá un `.env` en la raíz (no se commitea) con estas claves:

| Variable | Descripción |
|---|---|
| `VITE_FIREBASE_API_KEY` … `VITE_FIREBASE_APP_ID` | Config de la app web de Firebase |
| `VITE_STORE_NAME` | Nombre visible de la tienda (opcional, default "Mi Tienda") |
| `VITE_MP_CREATE_PREFERENCE_URL` | URL de la Function `createPreference` (paso 5) |
| `VITE_SHIPPING_ENABLED` | `false` si la tienda NO ofrece envío a domicilio (solo retiro). Default `true`. |
| `VITE_PICKUP_ENABLED` | `false` si la tienda NO tiene local para retirar (solo envío). Default `true`. |
| `VITE_SHIPPING_COST` | Costo de envío que se **muestra** en el carrito. Tiene que coincidir con `MP_SHIPPING_COST` en `functions/.env` (ver paso 5) — ese es el que realmente se cobra. |

> ⚠️ Todo lo que empieza con `VITE_` termina **público** en el navegador. El Access Token de Mercado Pago **nunca** va en este archivo.

## 4. Desarrollo local

```bash
npm install
npm run dev
```

- Tienda: http://localhost:5173/
- Admin: http://localhost:5173/admin.html

## 5. Backend: reglas y Cloud Functions

```bash
# Reglas de seguridad
firebase deploy --only firestore:rules,storage

# Mercado Pago
cd functions
cp .env.example .env              # moneda, descriptor, ALLOWED_ORIGINS, MP_SHIPPING_COST, ADMIN_NOTIFICATION_EMAIL, RESEND_FROM_EMAIL
npm install
firebase functions:secrets:set MP_ACCESS_TOKEN   # pegar el Access Token
firebase deploy --only functions
# RESEND_API_KEY (mail) NO se pide como secret acá — ver sección 10:
# mientras el proyecto esté en plan Spark (sin Blaze), el mail funciona en
# modo mock (no manda nada real, solo loguea). No hace falta nada más para
# seguir probando la tienda.
```

Este primer deploy te va a mostrar **dos** URLs (una por función):

1. Copiá la de `createPreference` en `VITE_MP_CREATE_PREFERENCE_URL` (frontend).
2. Copiá la de `mercadoPagoWebhook` en `MP_WEBHOOK_URL` dentro de `functions/.env`, y volvé a correr `firebase deploy --only functions` para que `createPreference` la mande como `notification_url` de cada preferencia. Sin este paso, Mercado Pago nunca te va a avisar cuando un pago se aprueba.

**Flujo de pago:**
1. El carrito revalida stock contra Firestore, y el comprador completa nombre, teléfono, email y método de entrega (envío a domicilio o retiro en el local) en el modal de datos de envío. El mail es obligatorio: es donde le llega la confirmación de la compra (ver sección 10).
2. Se crea el pedido en `pedidos` (`status: 'pending'`), con el `shipping` que acaba de completar, atado al `uid` de la sesión anónima del comprador.
3. `createPreference` verifica el ID token de esa sesión, vuelve a leer precio/stock de cada item desde Firestore (nunca confía en lo que mande el navegador), calcula el costo de envío a partir de `shipping.method` y `MP_SHIPPING_COST` (retiro = gratis), **pisa `items`/`total` del pedido con esos valores reales**, y arma la preferencia (productos + el envío como línea aparte si corresponde) con el ID del pedido como `external_reference` y `notification_url` apuntando a `mercadoPagoWebhook`.
4. Mercado Pago redirige a `/pago/gracias.html`, `/pago/pago-pendiente.html` o `/pago/pago-fallido.html` — estas páginas **no** marcan nada como pagado, solo vacían el carrito para que el comprador no vea el pedido dos veces.
5. Cuando Mercado Pago confirma el pago (en cualquier momento, incluso minutos después), llama a `mercadoPagoWebhook`. La función vuelve a consultar el pago por su ID contra la API de Mercado Pago (nunca confía en el cuerpo de la notificación), y si está `approved` y el monto coincide con el pedido, lo marca `approved` **y descuenta el stock** — todo en una transacción de Firestore, así un reintento del webhook nunca descuenta dos veces.
6. Desde `/admin` → pestaña **Pedidos**, marcás manualmente el estado de envío (sin preparar → preparando → enviado → entregado) a medida que lo vas despachando.
7. Si más adelante Mercado Pago informa un `refunded`/`charged_back` sobre un pedido que ya estaba `approved`, el webhook **repone el stock automáticamente** y deja el pedido marcado para revisar (ver sección 10 — Notificaciones y avisos).

> Mercado Pago exige `back_urls` públicas (https) para `auto_return`, y necesita poder llegar a `notification_url` desde internet. Para probar el pago completo (incluido el webhook) usá el deploy de Firebase Hosting, no `localhost`.

## 6. Deploy en Firebase Hosting

`firebase.json` ya tiene configurado el bloque `hosting` (sirve `dist/`, con `/admin` → `/admin.html` para que la URL quede linda).

```bash
npm run build          # genera dist/ con index.html, admin.html y las páginas de /pago
firebase deploy --only hosting
```

Tu tienda va a quedar publicada en `https://TU-PROYECTO.web.app` (y `.firebaseapp.com`). Si más adelante conectás un dominio propio (**Hosting → Agregar dominio personalizado**):
- Agregalo en *Authorized domains* de Firebase Auth.
- Poné el dominio en `ALLOWED_ORIGINS` de `functions/.env` y volvé a deployar las functions.

> Si cambiás algo en `.env`, acordate de correr `npm run build` de nuevo antes de `firebase deploy --only hosting` (Vite incrusta las variables `VITE_*` en el build; el deploy no las vuelve a leer).

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
- **Envío:** `VITE_SHIPPING_ENABLED` / `VITE_PICKUP_ENABLED` / `VITE_SHIPPING_COST` en `.env` (frontend, ver paso 3) + `MP_SHIPPING_COST` en `functions/.env` (el que realmente se cobra).

## 9. Panel de Pedidos y Ventas (admin)

En `/admin` → pestaña **Pedidos**:

- Tabla de todos los pedidos (fecha, comprador, método de entrega, total, estado de pago y estado de envío), con búsqueda por nombre/teléfono/ID y filtros por estado de pago y de envío.
- **"Ver"** abre el detalle: productos, dirección (si es envío a domicilio), desglose de envío + total, y datos del pago (`mpPaymentId`, fecha de pago, aviso si el monto no coincidió).
- El desplegable de **estado de envío** (sin preparar → preparando → enviado → entregado) es el único campo que el admin puede tocar a mano — es un dato de logística propio, separado del **estado de pago**, que queda como de solo lectura porque lo controla exclusivamente el webhook de Mercado Pago (nunca se puede "marcar como pagado" a mano desde acá).

En `/admin` → pestaña **Ventas**: igual que Pedidos pero solo con los ya `approved` — pensada para ver de un vistazo el total facturado, cuántas ventas hubo, y qué compró cada persona (sin los controles de estado, que viven en Pedidos).

**Aviso de reembolso:** si un pedido ya aprobado recibe después un `refunded`/`charged_back`, aparece un banner amarillo arriba de las pestañas ("N pedidos con reposición automática de stock") — el stock ya se repuso solo, el banner es para que revises el pedido y lo marques como revisado desde su detalle.

## 10. Mail transaccional (Resend)

`mercadoPagoWebhook` manda mails llamando directo a la API de [Resend](https://resend.com) (sin depender de instalar ninguna extensión de Firebase):

- **Al dueño de la tienda** (`ADMIN_NOTIFICATION_EMAIL` en `functions/.env`): aviso de "nueva venta" cuando se aprueba un pedido, y de "reembolso/contracargo" cuando se repone stock automáticamente.
- **Al comprador** (`shipping.email`, que completa en el checkout): confirmación de compra con el detalle del pedido, apenas se aprueba el pago.

Ninguno de los dos mails hace fallar el webhook si no se puede mandar (sin key, Resend caído, etc.) — queda logueado en las Functions logs y el pedido se procesa igual (stock, estado) sin depender del mail.

**Modo actual: mock (plan Spark, sin Blaze).** Mandar `RESEND_API_KEY` como Firebase Secret requiere Secret Manager, que a su vez requiere el plan Blaze (pay-as-you-go) del proyecto. Como decisión explícita se mantiene el proyecto en Spark por ahora, así que `RESEND_API_KEY` no está configurada como secret: `sendEmail()` en `functions/index.js` lee la key de `process.env.RESEND_API_KEY` en vez de Secret Manager, y si no está seteada (el caso normal hoy) **no manda mails reales** — loguea en las Functions logs (o la consola del emulador) lo que hubiera mandado. El resto del flujo (checkout, pago, webhook, stock, panel admin) funciona exactamente igual; lo único que no pasa es que el mail salga de verdad.

Si en algún momento querés probar el envío real sin pasar a Blaze, podés generar una key de prueba gratis en https://resend.com y ponerla en `functions/.env.local` (ya está en `.gitignore` — no se commitea ni se sube en un deploy, solo la ve el emulador local: `npm run serve` dentro de `functions/`).

**Para activar el envío real en producción** (cuando se decida pasar el proyecto a Blaze):

1. Creá una cuenta en https://resend.com y andá a **API Keys** → crear una nueva.
2. `firebase functions:secrets:set RESEND_API_KEY` (ya con Blaze habilitado).
3. En `functions/index.js`, seguir los 3 pasos del comentario **"ACTIVAR RESEND EN PRODUCCIÓN"** al principio del archivo (descomentar una línea + agregarla al array `secrets` de `mercadoPagoWebhook`) y deployar. No hace falta tocar nada más — `sendEmail()` sigue leyendo `process.env.RESEND_API_KEY`, que Firebase completa solo una vez el secret está vinculado.
4. En `functions/.env`, `RESEND_FROM_EMAIL` — mientras probás, dejalo en `onboarding@resend.dev` (funciona sin verificar nada). Para producción real, verificá tu propio dominio en Resend (**Domains** → agregar `skilariodev.com.ar` o el dominio del cliente → configurar los registros DNS que te da) y usá algo como `Mi Tienda <pedidos@tudominio.com>` — los mails con el dominio de prueba a veces terminan en spam o Resend los limita.

Resend tiene plan gratis (100 mails/día, 3.000/mes) — de sobra para el volumen de una tienda chica/mediana. Si en algún cliente puntual ya usan otro proveedor (SendGrid, Mailgun), `sendEmail()` en `functions/index.js` es la única función que habría que adaptar — el resto del webhook no cambia.

> Avisarle al comprador cuando cambia el **estado de envío** (preparando/enviado/entregado) sigue sin implementarse — hoy solo recibe la confirmación de compra al momento de pagar (ver "Pendiente" más abajo).

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

**`categorias`** `{ name, createdAt }`

**`pedidos`**
```js
{
  userId: string,
  items: [{ id, name, price, qty }],  // el cliente los propone; createPreference los pisa con los valores reales de Firestore
  total: number,                       // productos + envío; recalculado server-side en createPreference
  status: 'pending' | 'approved' | 'rejected' | 'in_process' | 'refunded' | 'charged_back' | 'cancelled', // estado de PAGO — solo lo escribe el webhook
  fulfillmentStatus: 'pendiente' | 'preparando' | 'enviado' | 'entregado', // estado de ENTREGA — lo cambia el admin a mano (default 'pendiente' si no está)
  shipping: {
    method: 'delivery' | 'pickup',
    fullName: string,
    phone: string,
    email: string,        // obligatorio — acá le llega la confirmación de compra (ver sección 10)
    address: string,     // solo si method === 'delivery'
    postalCode: string,  // solo si method === 'delivery'
    city: string,        // opcional, solo si method === 'delivery'
    cost: number,        // 0 si es pickup; lo calcula createPreference según MP_SHIPPING_COST
  },
  mpPaymentId: string,    // id del pago en Mercado Pago (lo escribe el webhook)
  mpStatus: string,       // último status crudo devuelto por la API de Mercado Pago
  stockApplied: boolean,  // true una vez que el webhook ya descontó stock por este pedido (evita descontarlo dos veces)
  stockRestored: boolean, // true si hubo un refunded/charged_back sobre un pedido aprobado y ya se repuso el stock (evita reponerlo dos veces)
  needsAttention: boolean,// true cuando se repuso stock automáticamente — el admin lo apaga a mano ("Marcar como revisado")
  amountMismatch: boolean,// true si el monto pagado no coincidió con order.total (revisar a mano)
  createdAt, updatedAt, paidAt // serverTimestamp
}
```

## Pendiente / fuera de alcance

- **Avisar al comprador cuando cambia el estado de envío:** hoy el comprador recibe la confirmación de compra al pagar (sección 10), pero no un aviso cuando el admin lo marca como "enviado" o "entregado" — sigue sin implementarse (por mail o WhatsApp).
- **Multi-tienda (multi-tenant):** este repo es un template de un deploy por cliente (cada tienda = su propio proyecto de Firebase, su propio dominio y su propia cuenta de Mercado Pago). Si en algún momento arman un panel central para administrar varias tiendas desde un solo lugar, eso requiere repensar el modelo de datos con `storeId` — mientras tanto, cada cliente nuevo es un deploy nuevo (ver `claude/runbook-nuevo-cliente.md` en el proyecto de Claude para los pasos).
