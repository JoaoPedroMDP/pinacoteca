// @ts-check
// Abas da sidebar: Telas e Conversa.
//
// So troca qual painel esta visivel — nenhum dos dois sabe da existencia do
// outro. `board.js` importa este modulo para registrar o listener e chama
// `showTab('screens')` na carga.

import { autoGrow } from './chat.js';
import { sidebarTabs, tabChat, tabScreens } from './dom.js';
import { ui } from './state.js';

/** @typedef {'screens' | 'chat'} TabName */

/** @type {Record<TabName, HTMLElement>} */
const PANELS = { screens: tabScreens, chat: tabChat };

/**
 * Mostra a aba `name` e esconde a outra, no painel e no botao.
 * @param {TabName} name
 */
export function showTab(name) {
  ui.activeTab = name;

  for (const [tab, panel] of Object.entries(PANELS)) {
    const active = tab === name;
    panel.hidden = !active;

    const button = sidebarTabs.querySelector(`[data-tab="${tab}"]`);
    button?.setAttribute('aria-selected', String(active));
  }

  // O compositor cresceu com a aba escondida (`scrollHeight` da 0 sem
  // layout) — mede de novo agora que ficou visivel.
  if (name === 'chat') autoGrow();
}

sidebarTabs.addEventListener('click', (event) => {
  const target = /** @type {Element | null} */ (event.target);
  const button = target?.closest('[data-tab]');
  const tab = /** @type {TabName | null | undefined} */ (button?.getAttribute('data-tab'));
  if (tab) showTab(tab);
});
