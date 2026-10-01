import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
        gracias: resolve(__dirname, 'pago/gracias.html'),
        pagoPendiente: resolve(__dirname, 'pago/pago-pendiente.html'),
        pagoFallido: resolve(__dirname, 'pago/pago-fallido.html'),
      },
    },
  },
});