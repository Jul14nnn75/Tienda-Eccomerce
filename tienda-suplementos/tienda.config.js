// tienda.config.js
// ÚNICO archivo que hay que editar para adaptar la tienda a un cliente nuevo:
// nombre, logo, colores, tipografía, envíos y datos de contacto.
//
// Lo leen la tienda (vite.config.js, tailwind.config.js, js/app.js) y también
// el Worker de pagos (cloudflare-worker/src/index.js), así que después de
// cambiar algo acá hay que volver a buildear la tienda Y redesplegar el Worker.
//
// Las claves de Firebase y Mercado Pago NO van acá: van en .env (ver
// .env.example) y en los secrets del Worker.

export default {
  store: {
    // Nombre del comercio: título del admin, pie de página, etc.
    name: 'Mi Tienda',
    // Título de la pestaña del navegador en la tienda.
    title: 'Suplementos | Tienda Online',
    // Logo de texto en dos tonos: "MI" en color neutro + "TIENDA" en el color principal.
    logoText: 'MI',
    logoAccent: 'TIENDA',
    // Opcional: logo en imagen. Guardá el archivo en la carpeta public/ y poné
    // acá su ruta (ej: '/logo.png'). Si está vacío se usa el logo de texto.
    logoImage: '',
  },

  // Portada de la tienda. Con title vacío no se muestra el banner; los
  // "highlights" son las frases cortas de la franja de abajo (envíos, cuotas...).
  hero: {
    title: 'Todo para tu entrenamiento',
    subtitle: 'Productos originales, envíos a domicilio y retiro en el local.',
    highlights: ['Pagá con tarjeta o transferencia', 'Envíos a domicilio', 'Retiro gratis en el local'],
  },

  theme: {
    // Color principal (botones, precios, links).
    primary: '#16A34A',
    // Variante más oscura (hover de botones, textos sobre fondo claro).
    primaryDark: '#15803D',
    // Variante muy clara (fondos de etiquetas y opciones seleccionadas).
    primaryLight: '#DCFCE7',
    // Variante brillante que se usa en modo oscuro (textos y bordes).
    accent: '#34D399',
    // Fondo general y bordes del modo claro.
    background: '#F9FAFB',
    border: '#E5E7EB',
    // Tipografía: nombre de la fuente + link de Google Fonts que la carga.
    fontFamily: 'Plus Jakarta Sans',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  },

  // Valores iniciales de envío. Una vez que el dueño guarda algo en la pestaña
  // "Envíos" del panel (costos y zonas por código postal), mandan esos.
  shipping: {
    // Costo fijo del envío a domicilio.
    flatCost: 3000,
    // Subtotal desde el que el envío es gratis (0 = siempre se cobra).
    freeFrom: 30000,
    // Texto que ve el comprador al elegir "Retiro en el local".
    pickupText: 'Retirás gratis en nuestro local. Te contactamos para coordinar el horario.',
  },

  payments: {
    // Cómo figura la compra en el resumen de la tarjeta del comprador.
    statementDescriptor: 'MI TIENDA',
  },

  orders: {
    // Horas que un pedido puede estar "pendiente de pago" antes de ocultarse
    // del panel como abandonado (se sigue viendo con el filtro "Abandonados").
    abandonedAfterHours: 24,
    // Código que se antepone al teléfono del comprador para el botón de
    // WhatsApp del panel cuando no lo escribió ('549' = celulares de Argentina).
    whatsappPrefix: '549',
  },

  // Datos del pie de página. Lo que quede vacío no se muestra.
  contact: {
    // Código de país + número, sin "+" ni espacios (ej: '5491122334455').
    whatsapp: '',
    instagram: '', // usuario sin @
    address: '',
    hours: '',
  },
};
