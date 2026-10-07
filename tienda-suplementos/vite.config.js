import { defineConfig } from 'vite';
import { resolve } from 'path';
import tienda from './tienda.config.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function logoHtml({ store }) {
  if (store.logoImage) {
    return `<img src="${escapeHtml(store.logoImage)}" alt="${escapeHtml(store.name)}" class="h-8 w-auto" />`;
  }
  return `<span class="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center flex-shrink-0">
          <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path d="M11.3 1.046A1 1 0 0112 2v7h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 20v-7H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
          </svg>
        </span>
        <span class="text-lg font-extrabold leading-none">
          <span class="text-gray-900 dark:text-white">${escapeHtml(store.logoText)}</span><span class="text-brand-primary">${escapeHtml(store.logoAccent)}</span>
        </span>`;
}

function heroHtml({ hero }) {
  if (!hero?.title) return '';
  const highlights = (hero.highlights || [])
    .map(
      (text) => `<li class="flex items-center gap-1.5">
          <svg class="w-4 h-4 text-brand-primary dark:text-brand-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20 6 9 17l-5-5" />
          </svg>
          ${escapeHtml(text)}
        </li>`
    )
    .join('');

  return `<section class="bg-gradient-to-br from-brand-primary/15 via-transparent to-brand-primary/5 border-b border-brand-border dark:border-gray-800">
    <div class="max-w-6xl mx-auto px-4 py-10 sm:py-14">
      <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white max-w-2xl">${escapeHtml(hero.title)}</h1>
      ${hero.subtitle ? `<p class="mt-3 text-base text-gray-600 dark:text-gray-300 max-w-xl">${escapeHtml(hero.subtitle)}</p>` : ''}
      ${highlights ? `<ul class="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-gray-700 dark:text-gray-200">${highlights}</ul>` : ''}
    </div>
  </section>`;
}

function footerHtml({ store, contact }) {
  const linkClass = 'hover:text-brand-primary-dark dark:hover:text-brand-accent transition-colors';
  const items = [
    contact.address && `<span>${escapeHtml(contact.address)}</span>`,
    contact.hours && `<span>${escapeHtml(contact.hours)}</span>`,
    contact.whatsapp &&
      `<a href="https://wa.me/${encodeURIComponent(contact.whatsapp)}" target="_blank" rel="noopener" class="${linkClass}">WhatsApp</a>`,
    contact.instagram &&
      `<a href="https://instagram.com/${encodeURIComponent(contact.instagram)}" target="_blank" rel="noopener" class="${linkClass}">Instagram</a>`,
  ].filter(Boolean);

  return `<footer class="max-w-6xl mx-auto px-4 py-8 text-center text-xs text-gray-500 dark:text-gray-400">
    <p class="font-semibold text-gray-700 dark:text-gray-200 mb-2">${escapeHtml(store.name)}</p>
    ${items.length ? `<div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">${items.join('')}</div>` : ''}
  </footer>`;
}

/**
 * Reemplaza los %TIENDA_...% de los HTML con los datos de tienda.config.js
 * y agrega el link de la tipografía en todas las páginas.
 */
function tiendaConfigPlugin() {
  const tokens = {
    NAME: escapeHtml(tienda.store.name),
    TITLE: escapeHtml(tienda.store.title),
    PICKUP_TEXT: escapeHtml(tienda.shipping.pickupText),
    LOGO: logoHtml(tienda),
    HERO: heroHtml(tienda),
    FOOTER: footerHtml(tienda),
  };

  return {
    name: 'tienda-config',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const tags = tienda.theme.fontUrl
          ? [
              { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' }, injectTo: 'head' },
              {
                tag: 'link',
                attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
                injectTo: 'head',
              },
              { tag: 'link', attrs: { rel: 'stylesheet', href: tienda.theme.fontUrl }, injectTo: 'head' },
            ]
          : [];
        return {
          html: html.replace(/%TIENDA_([A-Z_]+)%/g, (match, key) => tokens[key] ?? match),
          tags,
        };
      },
    },
  };
}

export default defineConfig({
  plugins: [tiendaConfigPlugin()],
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
