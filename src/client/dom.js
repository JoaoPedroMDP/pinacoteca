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

export const chatTabs = required('chat-tabs');
export const chatPanel = required('chat-panel');
export const chatConversations = required('chat-conversations');
export const chatConversationsList = required('chat-conversations-list');
export const chatConversationsEmpty = required('chat-conversations-empty');
export const chatConversationsNote = required('chat-conversations-note');
export const chatNew = /** @type {HTMLButtonElement} */ (required('chat-new'));
export const chatLog = required('chat-log');
export const chatEmpty = required('chat-empty');
export const chatQueue = required('chat-queue');
export const chatQueueList = required('chat-queue-list');
export const chatComposer = required('chat-composer');
export const chatInput = required('chat-input');
export const chatSend = required('chat-send');
export const chatSendMode = required('chat-send-mode');
export const chatStop = required('chat-stop');
export const chatModel = required('chat-model');
export const chatEffort = required('chat-effort');
export const chatAuto = required('chat-auto');

/* ---------- Configuracoes ---------- */

export const settingsOpen = required('settings-open');
export const settingsDialog = /** @type {HTMLDialogElement} */ (required('settings-dialog'));
export const settingsClose = required('settings-close');
export const settingsBody = required('settings-body');
export const settingsNav = required('settings-nav');
export const settingsPanelGeneral = required('settings-panel-general');
export const settingsPanelModels = required('settings-panel-models');
export const settingsModelPanelClaude = required('settings-model-panel-claude');
export const chatCredentialNote = required('chat-credential-note');
export const chatKeyInput = required('chat-key-input');
export const chatKeySave = required('chat-key-save');

/** A toolbar fica *dentro* do viewport — veja o tratamento no `controls.js`. */
export const toolbar = /** @type {HTMLElement} */ (document.querySelector('.toolbar'));

export const globalSizeMenu = required('global-size-menu');

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
