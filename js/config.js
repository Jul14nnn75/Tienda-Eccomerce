// js/config.js
// Configuración white-label centralizada. Todo lo "de marca" que no es color
// (los colores viven en css/input.css) se ajusta acá o vía .env.

export const STORE_NAME = import.meta.env.VITE_STORE_NAME || 'Mi Tienda';

export const LOCALE = 'es-AR';
export const CURRENCY_SYMBOL = '$';

// Umbral para marcar "stock bajo" en el dashboard.
export const LOW_STOCK_THRESHOLD = 5;

export const PLACEHOLDER_IMAGE = 'https://placehold.co/400x400?text=Sin+imagen';
