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
export const sidebar = required('sidebar');
export const sidebarResizer = required('sidebar-resizer');

/* ---------- Abas da sidebar ---------- */

export const sidebarTabs = required('sidebar-tabs');
export const tabScreens = required('tab-screens');
export const tabChat = required('tab-chat');

/* ---------- Conversa ---------- */

export const chatLog = required('chat-log');
export const chatEmpty = required('chat-empty');
export const chatSettings = required('chat-settings');
export const chatCredentialNote = required('chat-credential-note');
export const chatKeyInput = required('chat-key-input');
export const chatKeySave = required('chat-key-save');
export const chatComposer = required('chat-composer');
export const chatInput = required('chat-input');
export const chatSend = required('chat-send');
export const chatSendMode = required('chat-send-mode');
export const chatStop = required('chat-stop');
export const chatModel = required('chat-model');
export const chatEffort = required('chat-effort');
export const chatAuto = required('chat-auto');

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
