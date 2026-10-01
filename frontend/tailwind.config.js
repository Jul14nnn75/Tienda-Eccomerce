/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './admin.html', './pago/gracias.html', './pago/pago-pendiente.html', './pago/pago-fallido.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#F9FAFB',
          card: '#FFFFFF',
          border: '#E5E7EB',
          green: {
            DEFAULT: '#16A34A',
            dark: '#15803D',
            light: '#DCFCE7',
          },
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};