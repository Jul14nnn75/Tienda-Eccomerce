# Tienda online + panel de administración

Catálogo público con carrito y pago por Mercado Pago, más un panel para
gestionar productos y pedidos.

- **Tienda y admin** (`tienda-suplementos/`): HTML + JavaScript + Tailwind, con Vite.
- **Datos**: Firebase (Firestore, Storage y Authentication).
- **Pagos** (`cloudflare-worker/`): Worker de Cloudflare que habla con Mercado Pago.

## Qué se edita para cada cliente

| Qué | Dónde |
| --- | --- |
| Nombre, logo, colores, tipografía, envíos, contacto | `tienda.config.js` |
| Claves públicas de Firebase y Mercado Pago, URL del Worker | `.env` (copiar de `.env.example`) |
| Proyecto de Firebase y dominio permitido del Worker | `cloudflare-worker/wrangler.toml` |
| Claves secretas (Mercado Pago, cuenta de servicio de Firebase) | secrets del Worker (paso 4) |
| Proyecto de Firebase para desplegar reglas | `.firebaserc` |

Productos, categorías, pedidos y **costos de envío por zona** se cargan desde
el panel admin, no desde el código. Los envíos se guardan en Firestore
(`config/envios`); mientras el dueño no guarde nada en la pestaña "Envíos",
valen los de `tienda.config.js`.

`tienda.config.js` lo leen la tienda **y** el Worker: después de cambiarlo hay
que volver a buildear la tienda y redesplegar el Worker.

## Alta de un cliente nuevo

### 1. Firebase

1. Crear un proyecto en https://console.firebase.google.com
2. Habilitar **Firestore Database** y **Storage**.
3. En **Authentication → Sign-in method**, habilitar **Correo electrónico/contraseña**
   (para el admin) y **Anónimo** (la tienda lo usa para que cada comprador
   pueda crear su pedido; sin esto nadie puede pagar).
4. Registrar una app web y copiar sus datos al `.env`.
5. Poner el ID del proyecto en `.firebaserc` y en `cloudflare-worker/wrangler.toml`.

### 2. Tienda

```bash
npm install
```

Copiar `.env.example` como `.env`, completarlo, y editar `tienda.config.js`.

```bash
npm run dev
```

- Tienda: http://localhost:5173/
- Admin: http://localhost:5173/admin.html

Si se cambia `tienda.config.js` con el servidor abierto y la página queda sin
estilos, cortar `npm run dev` y volver a iniciarlo.

### 3. Reglas de Firestore

```bash
npx firebase-tools login
```

```bash
npx firebase-tools deploy --only firestore:rules
```

### 4. Worker de pagos

Desde `cloudflare-worker/`:

```bash
npm install
```

Cargar los cuatro secrets (uno por comando, pide el valor al ejecutarlo):

```bash
npx wrangler secret put MP_ACCESS_TOKEN
```

```bash
npx wrangler secret put MP_WEBHOOK_SECRET
```

```bash
npx wrangler secret put FIREBASE_CLIENT_EMAIL
```

```bash
npx wrangler secret put FIREBASE_PRIVATE_KEY
```

- `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET`: Mercado Pago → Tus integraciones → la app del cliente.
- `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY`: Firebase Console → Configuración
  del proyecto → Cuentas de servicio → Generar nueva clave privada.

En `wrangler.toml`, cambiar `name` (un Worker por cliente), `FIREBASE_PROJECT_ID`
y `ALLOWED_ORIGIN` (el dominio final de la tienda, ej. `https://mitienda.com.ar`;
admite varios separados por coma).

`REQUIRE_WEBHOOK_SIGNATURE` arranca en `"false"`: el Worker igual confirma cada
pago consultándolo a Mercado Pago. Pasarlo a `"true"` cuando `npx wrangler tail`
ya no muestre el aviso de firma en pagos reales.

```bash
npm run deploy
```

Copiar la URL que muestra al `.env` de la tienda, y configurar en Mercado Pago
el webhook apuntando a `<URL del Worker>/webhook`.

### 5. Usuario administrador

1. Crear el usuario en Firebase Console → Authentication → Users.
2. Guardar la clave de la cuenta de servicio como `scripts/service-account.json`.
3. Desde `scripts/`:

```bash
npm install
```

```bash
node set-admin-claim.js <uid-del-usuario>
```

### 6. Publicar la tienda

```bash
npm run build
```

Subir la carpeta `dist/` al hosting elegido.

## Cómo se cobra

1. Al tocar "Pagar", la tienda guarda el pedido en Firestore como `pending`.
2. El Worker lee ese pedido, recalcula el total con los precios reales de
   Firestore y cobra ese monto (nunca el que manda el navegador).
3. Mercado Pago avisa al webhook del Worker; si lo pagado cubre el total, el
   pedido pasa a `paid` y se descuenta el stock.

## Modelo de datos

```js
// productos
{
  name, brand, category, flavor, description,
  listPrice: number,
  offerPrice: number | null,   // vale solo si es menor a listPrice
  stock: number,
  active: boolean,             // false = pausado (no se muestra ni se vende)
  image: string,               // URL directa o de Firebase Storage
  createdAt, updatedAt,
}

// pedidos
{
  userId, customerName, customerPhone, customerEmail,
  items: [{ id, name, price, qty }],
  total: number,
  shipping: { method: 'pickup' | 'delivery', cost, zone, address },
  status: 'pending' | 'paid' | ...,
  verifiedTotal: number,       // lo escribe el Worker
  createdAt, paidAt,
}

// config/envios
{
  defaultCost: number,         // envío fuera de las zonas
  freeFrom: number,            // envío gratis desde este subtotal (0 = nunca)
  onlyZones: boolean,          // true = no se envía fuera de las zonas
  zones: [{ name, zips: '1228, 1400-1499', cost }],
}
```
