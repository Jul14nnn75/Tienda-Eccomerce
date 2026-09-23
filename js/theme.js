// js/theme.js
// Maneja el toggle de tema claro/oscuro (clase "dark" en <html>),
// persistido en localStorage. El flash inicial se evita con el script
// inline en el <head> de cada página (ver index.html / admin.html).

const THEME_KEY = 'tienda_theme';

function isDarkActive() {
  return document.documentElement.classList.contains('dark');
}

function syncIcons() {
  const dark = isDarkActive();
  document.querySelectorAll('[data-theme-icon="sun"]').forEach((el) => el.classList.toggle('hidden', dark));
  document.querySelectorAll('[data-theme-icon="moon"]').forEach((el) => el.classList.toggle('hidden', !dark));
}

function toggleTheme() {
  const dark = document.documentElement.classList.toggle('dark');
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  syncIcons();
}

document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
  btn.addEventListener('click', toggleTheme);
});

syncIcons();