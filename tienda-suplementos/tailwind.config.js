import tienda from './tienda.config.js';

const { theme } = tienda;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './admin.html', './pago/gracias.html', './pago/pago-pendiente.html', './pago/pago-fallido.html', './js/**/*.js', './vite.config.js'],
  theme: {
    extend: {
      // Los colores y la tipografía salen de tienda.config.js
      colors: {
        brand: {
          bg: theme.background,
          card: '#FFFFFF',
          border: theme.border,
          primary: {
            DEFAULT: theme.primary,
            dark: theme.primaryDark,
            light: theme.primaryLight,
          },
          accent: theme.accent,
        },
      },
      fontFamily: {
        sans: [`"${theme.fontFamily}"`, 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
