import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// Build multi-página: cada HTML es un entry point independiente.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        admin: resolve(root, 'admin.html'),
        gracias: resolve(root, 'pago/gracias.html'),
        pagoPendiente: resolve(root, 'pago/pago-pendiente.html'),
        pagoFallido: resolve(root, 'pago/pago-fallido.html'),
      },
    },
  },
});
