# Tienda Genérica

Base reusable de e-commerce: catálogo público + carrito + checkout con
Mercado Pago (tarjeta sin salir del sitio + transferencia bancaria) + panel
de administración con gestión de productos y pedidos. Pensada para clonar y
adaptar a un cliente nuevo cambiando lo mínimo posible.

## Arquitectura

```
tienda-generica-repo/
├── frontend/            # Vite + Vanilla JS + Tailwind + Firebase (Firestore/Storage/Auth)
└── cloudflare-worker/    # Backend de pagos (gratis, sin Blaze) — habla con Mercado Pago y Firestore
```

**Por qué hay un Worker de Cloudflare separado, en vez de Cloud Functions de
Firebase:** las Cloud Functions necesitan el plan Blaze (requiere tarjeta)
para poder salir a internet (hablarle a la API de Mercado Pago). El Worker
corre gratis en Cloudflare, sin tarjeta, y hace exactamente lo mismo.

- `frontend/` → se deploya como sitio estático (Cloudflare Pages, Netlify, Vercel, lo que sea).
- `cloudflare-worker/` → se deploya aparte, con `wrangler deploy`, y le da al frontend tres URLs (crear preferencia de MP, procesar pago con tarjeta, recibir webhooks).

## Lo primero que hay que tocar para un cliente nuevo: `frontend/js/config.js`

Nombre de la tienda, número de WhatsApp, costo/umbral de envío, textos
legales del footer. Todo lo demás (colores, logo, credenciales) se explica
abajo.

## Setup completo, de cero

### 1. Firebase

1. Creá un proyecto en https://console.firebase.google.com
2. Habilitá **Firestore Database**, **Storage** y **Authentication** (método Email/Password).
3. Deployá las reglas de seguridad ya escritas:
   ```bash
   cd frontend
   firebase deploy --only firestore:rules
   ```
4. Creá un usuario en Authentication (el que va a loguearse en `/admin.html`).
5. Marcalo como admin (las reglas usan un *custom claim*, no un email hardcodeado):
   ```bash
   cd frontend/scripts
   npm install
   # Generá una clave de cuenta de servicio: Firebase Console → Configuración
   # del proyecto → Cuentas de servicio → Generar nueva clave privada.
   # Guardala como scripts/service-account.json (ya está en .gitignore).
   node set-admin-claim.js <uid-del-usuario>
   ```

### 2. Frontend

```bash
cd frontend
cp .env.example .env
npm install
```

Completá `.env` con los datos de tu app web de Firebase (Project Settings →
General → Your apps) y las dos URLs del Worker (`VITE_MP_CREATE_PREFERENCE_URL`,
`VITE_MP_PROCESS_PAYMENT_URL` — ver paso 4) y `VITE_MP_PUBLIC_KEY` (paso 3).

```bash
npm run dev       # http://localhost:5173 (tienda) y /admin (panel)
npm run build     # build de producción → carpeta dist/
```

### 3. Mercado Pago

1. Creá una aplicación en https://www.mercadopago.com.ar/developers
2. Usá las **credenciales de prueba** primero (Access Token + Public Key) para todo el desarrollo.
3. Public Key → `VITE_MP_PUBLIC_KEY` del `.env` del frontend.
4. Access Token → secret del Worker (paso 4).
5. Cuando el cliente vaya a producción de verdad: repetís todo con las
   **credenciales de producción** de la cuenta de Mercado Pago **del cliente**
   (no la tuya).

### 4. Cloudflare Worker

```bash
cd cloudflare-worker
npm install
npx wrangler login
```

Completá `wrangler.toml` con el Project ID real de Firebase, y cargá los secrets:

```bash
npx wrangler secret put MP_ACCESS_TOKEN
npx wrangler secret put MP_WEBHOOK_SECRET
npx wrangler secret put FIREBASE_CLIENT_EMAIL
# La private_key tiene saltos de línea — mejor pasarla directo desde el JSON
# de la cuenta de servicio, sin copiar/pegar a mano:
node -e "console.log(require('../frontend/scripts/service-account.json').private_key)" | npx wrangler secret put FIREBASE_PRIVATE_KEY

npx wrangler deploy
```

Te va a dar una URL (`https://<nombre>.<tu-subdominio>.workers.dev`). Esa URL
+ `/process-payment` y la URL base van en el `.env` del frontend
(`VITE_MP_CREATE_PREFERENCE_URL` y `VITE_MP_PROCESS_PAYMENT_URL`).

### 5. Webhook de Mercado Pago

Mercado Pago → Tus integraciones → tu app → Webhooks → pegá
`https://<tu-worker>.workers.dev/webhook`, evento **"Order (Mercado Pago)"**.
La "Clave secreta" que te muestra ahí es el `MP_WEBHOOK_SECRET` de arriba.

⚠️ **Pendiente conocido:** la verificación de firma del webhook (HMAC) no
cierra con ninguna combinación documentada por Mercado Pago — está
implementada siguiendo su documentación oficial, pero el hash no coincide, y
no encontramos la causa a pesar de confirmar con logs que el `request-id`, el
`ts` y el secret llegan todos correctos. **Por eso ahora mismo la verificación
solo advierte (`console.error`), no bloquea la notificación.** Antes de
manejar dinero real de un cliente, hay que:
1. Escribirle a soporte de Mercado Pago con la evidencia ya juntada (manifest, hash calculado, hash recibido).
2. Volver el `if (!signatureOk)` de `handleWebhook` (en `cloudflare-worker/src/index.js`) a devolver `401` en vez de solo loguear.

### 6. Personalización de marca

- **Nombre, WhatsApp, envío, legales** → `frontend/js/config.js`.
- **Colores** → `frontend/tailwind.config.js` (`brand-green`, etc.).
- **Logo/ícono** → el `<svg>` dentro del header en `index.html` y `admin.html`.
- **Nombre del Worker y texto en el resumen de tarjeta** → `cloudflare-worker/wrangler.toml` (`name`, `STATEMENT_DESCRIPTOR`).

## Modelo de datos (Firestore)

```js
// productos/{id}
{
  name, brand, category, listPrice, offerPrice (null = sin oferta),
  stock, flavor, description, image, createdAt, updatedAt
}

// categorias/{id}
{ name, createdAt }

// pedidos/{id}
{
  userId,                       // uid de la sesión anónima del cliente
  customerName, customerPhone, customerEmail,
  items: [{ id, name, price, qty }],
  total,
  shipping: { method: 'pickup' | 'delivery', cost, address: {...} | null },
  status: 'pending' | 'paid' | 'preparing' | 'ready' | 'completed',
  createdAt, paidAt,
}
```

## Qué incluye esta base

- Catálogo con categorías dinámicas, búsqueda, ofertas.
- Carrito persistente (localStorage, aislado por sesión).
- Checkout con 3 métodos: tarjeta (Card Payment Brick, sin salir del sitio),
  transferencia bancaria (redirige a Checkout Pro de Mercado Pago), y datos
  de envío (retiro en el local / envío a domicilio con costo configurable).
- Webhook que marca el pedido como pagado **y descuenta stock automáticamente**
  cuando Mercado Pago confirma el pago de verdad (no al tocar "Pagar").
- Panel admin: login con Firebase Auth + custom claim, CRUD de productos,
  categorías dinámicas, y gestión de pedidos (5 estados, búsqueda, filtro por
  fecha, notificación en vivo de pedido nuevo, mini dashboard de ventas,
  exportar a CSV).

## Roadmap — lo que falta para que sea más genérica todavía

- Variantes de producto (sabor/talle/color con stock propio cada una).
- Cupones de descuento.
- Meta tags / Open Graph configurables desde `config.js` (hoy están fijos en el `<head>`).
- Costo de envío por zona/localidad (hoy es un monto fijo único).
