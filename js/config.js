// js/config.js
// Configuración white-label centralizada. Todo lo "de marca" que no es color
// (los colores viven en css/input.css) se ajusta acá o vía .env.

export const STORE_NAME = import.meta.env.VITE_STORE_NAME || 'Mi Tienda';

export const LOCALE = 'es-AR';
export const CURRENCY_SYMBOL = '$';

// Umbral para marcar "stock bajo" en el dashboard.
export const LOW_STOCK_THRESHOLD = 5;

export const PLACEHOLDER_IMAGE = 'https://placehold.co/400x400?text=Sin+imagen';

// ---------------------------------------------------------------------------
// Envío — configurable por tienda vía .env. El costo que se muestra acá es
// solo una ESTIMACIÓN para el carrito: el monto real que se cobra lo vuelve
// a calcular la Cloud Function (functions/index.js, variable MP_SHIPPING_COST
// en functions/.env) a partir del método guardado en el pedido, nunca de lo
// que mande el navegador.
// ---------------------------------------------------------------------------

// Si tu tienda solo tiene retiro en el local, poné VITE_SHIPPING_ENABLED=false.
export const SHIPPING_ENABLED = (import.meta.env.VITE_SHIPPING_ENABLED ?? 'true') !== 'false';
// Si tu tienda no tiene local para retirar, poné VITE_PICKUP_ENABLED=false.
export const PICKUP_ENABLED = (import.meta.env.VITE_PICKUP_ENABLED ?? 'true') !== 'false';
// Estimación mostrada en el carrito antes de pagar. Tiene que coincidir con
// MP_SHIPPING_COST en functions/.env, si no el comprador ve un número y paga otro.
export const SHIPPING_COST_ESTIMATE = Number(import.meta.env.VITE_SHIPPING_COST || 0);
