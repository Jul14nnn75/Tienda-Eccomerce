// js/config.js
// Configuración de marca para esta tienda. Es lo PRIMERO que hay que editar
// al clonar esta base para un cliente nuevo — nombre, WhatsApp, envío, etc.
//
// Lo que NO vive acá (porque no se puede cambiar en tiempo de ejecución):
//   - Colores de marca → tailwind.config.js (brand-green, brand-green-dark, etc.)
//   - Logo/ícono → el <svg> del header en index.html y admin.html
//   - Nombre del Worker y STATEMENT_DESCRIPTOR → cloudflare-worker/wrangler.toml
//   - Credenciales de Firebase / Mercado Pago → .env (ver .env.example)

export const STORE_CONFIG = {
  // Nombre que se muestra en el header y en el <title> de las páginas.
  name: 'Mi Tienda',

  // Número de WhatsApp en formato internacional, SIN "+" ni espacios ni guiones.
  // Ejemplo Argentina: 54 9 11 2233-4455 → "5491122334455"
  // Dejalo vacío ('') para que el botón flotante de WhatsApp no se muestre.
  whatsappNumber: '',

  // Mensaje precargado al abrir WhatsApp desde el botón flotante.
  whatsappDefaultMessage: 'Hola! Tengo una consulta sobre un producto.',

  // Envío: por ahora es un monto fijo + un umbral de envío gratis (no por
  // zona/localidad). Poné flatShippingCost en 0 si no querés cobrar envío.
  freeShippingThreshold: 30000,
  flatShippingCost: 3000,

  // Links del footer. Dejá el texto vacío ('') en cualquiera de los dos
  // para que esa sección no se muestre.
  legal: {
    termsText: '',
    returnsText: '',
  },
};
