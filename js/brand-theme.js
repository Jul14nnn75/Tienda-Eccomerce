// js/brand-theme.js
// Aplica el tema de marca (colores + tipografía) guardado en Firestore
// (configuracion/tema, editable desde el panel admin → pestaña "Estilos")
// pisando las variables CSS de css/input.css#:root. Se incluye tanto en
// index.html como en admin.html: así un cambio hecho por el admin se ve
// en la tienda para CUALQUIER visitante, no solo en su propio navegador
// (a diferencia de js/theme.js, que es el modo claro/oscuro y sí es
// puramente local a cada visitante).
//
// Se cachea en localStorage para aplicar de inmediato sin esperar la
// respuesta de Firestore (evita el "flash" del tema anterior) — mismo
// criterio que ya usa el modo claro/oscuro.

import { subscribeBrandTheme } from './firebase.js';

const CACHE_KEY = 'tienda_brand_theme';

// Mapeo clave del doc de Firestore -> variable CSS que pisa.
const CSS_VAR_BY_KEY = {
  colorPrimary: '--color-primary',
  colorPrimaryDark: '--color-primary-dark',
  colorPrimaryLight: '--color-primary-light',
  colorPrimaryBright: '--color-primary-bright',
  colorSecondary: '--color-secondary',
  colorSecondaryDark: '--color-secondary-dark',
  colorBg: '--color-bg',
  colorBorder: '--color-border',
};

function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;

  Object.entries(CSS_VAR_BY_KEY).forEach(([key, cssVar]) => {
    if (theme[key]) root.style.setProperty(cssVar, theme[key]);
  });

  if (theme.fontFamily) {
    root.style.setProperty('--font-sans', `'${theme.fontFamily}'`);
    loadGoogleFont(theme.fontGoogleParam || theme.fontFamily.replace(/\s+/g, '+'));
  }
}

/** Inyecta (o reutiliza) el <link> de Google Fonts para la tipografía elegida. */
function loadGoogleFont(googleParam) {
  const linkId = 'store-google-font';
  let link = document.getElementById(linkId);
  if (!link) {
    link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = `https://fonts.googleapis.com/css2?family=${googleParam}:wght@400;500;600;700;800&display=swap`;
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(theme) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(theme));
  } catch {
    // localStorage puede fallar (modo privado, cuota llena) — no es crítico, seguimos sin cachear.
  }
}

// 1. Aplicar de inmediato lo último conocido (sin esperar red).
applyTheme(readCache());

// 2. Traer el tema real de Firestore; si cambió (o es la primera vez que
//    se configura), lo aplica y actualiza el cache para la próxima visita.
subscribeBrandTheme((theme) => {
  if (!theme) return; // tienda que nunca tocó "Estilos": quedan los valores por defecto de input.css
  applyTheme(theme);
  writeCache(theme);
});
