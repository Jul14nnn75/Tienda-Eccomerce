/** @type {import('tailwindcss').Config} */

// Los colores de marca NO se definen acá: se leen de variables CSS declaradas
// en css/input.css (:root). Para re-brandear la tienda alcanza con cambiar
// esos valores RGB; no hace falta tocar HTML ni JS.
const withAlpha = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./*.html', './pago/**/*.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: withAlpha('--color-primary'),
          dark: withAlpha('--color-primary-dark'),
          light: withAlpha('--color-primary-light'),
          bright: withAlpha('--color-primary-bright'), // acentos en modo oscuro
        },
        secondary: {
          DEFAULT: withAlpha('--color-secondary'),
          dark: withAlpha('--color-secondary-dark'),
        },
        brand: {
          bg: withAlpha('--color-bg'),
          card: withAlpha('--color-card'),
          border: withAlpha('--color-border'),
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
