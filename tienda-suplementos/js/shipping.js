// js/shipping.js
// Cálculo del costo de envío por zonas. Son funciones puras (sin Firebase ni
// DOM) porque las usan tres lugares que tienen que dar SIEMPRE el mismo
// resultado: la tienda (js/app.js), el panel (js/admin.js) y el Worker de
// pagos (cloudflare-worker/src/index.js), que rechaza el cobro si el total
// no coincide con el que vio el comprador.
//
// La configuración se guarda en Firestore (documento config/envios) y se
// edita desde la pestaña "Envíos" del panel. Mientras ese documento no
// exista, se usan los valores de tienda.config.js.

/**
 * @typedef {{name:string, zips:string, cost:number}} ShippingZone
 * @typedef {{freeFrom:number, defaultCost:number, onlyZones:boolean, zones:ShippingZone[]}} ShippingSettings
 */

function toAmount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/**
 * Completa y sanea lo que venga de Firestore.
 * @param {object|null} raw — contenido de config/envios (o null si no existe)
 * @param {{flatCost:number, freeFrom:number}} defaults — tienda.config.js → shipping
 * @returns {ShippingSettings}
 */
export function normalizeShippingSettings(raw, defaults) {
  const base = {
    freeFrom: toAmount(defaults?.freeFrom),
    defaultCost: toAmount(defaults?.flatCost),
    onlyZones: false,
    zones: [],
  };
  if (!raw || typeof raw !== 'object') return base;

  return {
    freeFrom: toAmount(raw.freeFrom, base.freeFrom),
    defaultCost: toAmount(raw.defaultCost, base.defaultCost),
    onlyZones: raw.onlyZones === true,
    zones: (Array.isArray(raw.zones) ? raw.zones : [])
      .filter((zone) => zone && typeof zone === 'object')
      .map((zone) => ({
        name: String(zone.name ?? '').trim(),
        zips: String(zone.zips ?? '').trim(),
        cost: toAmount(zone.cost),
      }))
      .filter((zone) => zone.name && zone.zips),
  };
}

/**
 * Saca el código postal numérico de lo que escribió el comprador.
 * Acepta "1228", " 1228 " y el formato largo "B1228ABC".
 * @returns {number|null}
 */
export function parseZip(value) {
  const match = String(value ?? '').match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

/**
 * true si el código postal entra en la lista de la zona.
 * La lista admite códigos sueltos y rangos: "1228, 1400-1499, 1832".
 */
export function zoneMatchesZip(zone, zip) {
  if (zip == null) return false;
  return String(zone.zips)
    .split(/[,;\s]+/)
    .filter(Boolean)
    .some((token) => {
      const [from, to] = token.split('-').map((part) => Number(part));
      if (!Number.isInteger(from)) return false;
      if (to === undefined) return zip === from;
      return Number.isInteger(to) && zip >= Math.min(from, to) && zip <= Math.max(from, to);
    });
}

/**
 * Costo de envío de un pedido.
 * @param {ShippingSettings} settings
 * @param {{method:string, zip:string, subtotal:number}} order
 * @returns {{available:boolean, cost:number, zoneName:string|null, free:boolean}}
 *   available=false → no se hacen envíos a ese código postal.
 */
export function quoteShipping(settings, { method, zip, subtotal }) {
  if (method !== 'delivery') {
    return { available: true, cost: 0, zoneName: null, free: false };
  }

  const zone = settings.zones.find((candidate) => zoneMatchesZip(candidate, parseZip(zip)));
  if (!zone && settings.onlyZones) {
    return { available: false, cost: 0, zoneName: null, free: false };
  }

  const baseCost = zone ? zone.cost : settings.defaultCost;
  const free = settings.freeFrom > 0 && subtotal >= settings.freeFrom;
  return { available: true, cost: free ? 0 : baseCost, zoneName: zone ? zone.name : null, free };
}
