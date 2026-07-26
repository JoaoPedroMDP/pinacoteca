// @ts-check
// Referencias aos elementos fixos da pagina (`index.html`).
//
// Todo `getElementById` do board mora aqui. Assim, se um id sumir do HTML, a
// falha aparece na carga, com o nome do id, em vez de virar um `null` silencioso
// no meio de um listener.

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function required(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} nao existe em index.html`);
  return el;
}

export const viewport = required('viewport');
export const canvas = required('canvas');
export const screenList = required('screen-list');
export const screenCount = required('screen-count');
export const rootPath = required('root-path');
export const connection = required('connection');
export const version = required('version');
export const zoomLabel = required('zoom-label');
export const emptyState = required('empty-state');

/** A toolbar fica *dentro* do viewport — veja o tratamento no `controls.js`. */
export const toolbar = /** @type {HTMLElement} */ (document.querySelector('.toolbar'));

/**
 * Cria o elemento uma vez e reaproveita nas chamadas seguintes. Usado pelos
 * avisos flutuantes (toast, tooltip), que so existem depois da primeira vez.
 *
 * @param {string} id
 * @param {string} className
 * @returns {HTMLElement}
 */
export function ensureFloating(id, className) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = className;
    document.body.append(el);
  }
  return el;
}
