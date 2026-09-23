// js/pago.js
// Lógica compartida de las páginas de retorno de Mercado Pago (/pago/*).
//
// El carrito se guarda por uid de Firebase Auth (ver cart.js), así que antes
// de vaciarlo hay que recuperar la sesión anónima y fijar el mismo namespace;
// si no, clearCart() borraría el carrito "guest" y no el del comprador.
//
// Cada página indica qué hacer con <body data-clear-cart="...">:
//   "approved" -> vacía solo si MP informa approved / pending / in_process
//   "always"   -> vacía siempre (pago pendiente)
//   (ausente)  -> conserva el carrito (pago fallido, para reintentar)

import { ensureAnonymousAuth } from './firebase.js';
import { setCartNamespace, clearCart } from './cart.js';
import { applyStoreName } from './utils.js';

applyStoreName();

const mode = document.body.dataset.clearCart;

function shouldClear() {
  if (mode === 'always') return true;
  if (mode !== 'approved') return false;
  const params = new URLSearchParams(window.location.search);
  const status = params.get('collection_status') || params.get('status');
  return !status || ['approved', 'pending', 'in_process'].includes(status);
}

if (shouldClear()) {
  ensureAnonymousAuth().then((user) => {
    if (user) setCartNamespace(user.uid);
    clearCart();
  });
}
