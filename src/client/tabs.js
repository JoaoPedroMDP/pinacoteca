// @ts-check
// Abas da sidebar (Telas e Conversa) e, dentro da conversa, as subabas
// Conversas e Chat.
//
// Sao dois niveis do mesmo gesto — mostrar um painel e esconder os irmaos —,
// entao vivem no mesmo modulo, num grupo cada. Nenhum painel sabe da existencia
// do outro. `board.js` importa este modulo para registrar os listeners e chama
// `showTab('sidebar', 'screens')` na carga.

import { autoGrow } from './chat.js';
import {
  chatConversations, chatPanel, chatTabs, sidebarTabs, tabChat, tabScreens,
} from './dom.js';
import { ui } from './state.js';

/** @typedef {'screens' | 'chat'} SidebarTabName */
/** @typedef {'list' | 'chat'} ChatTabName */
/** @typedef {'sidebar' | 'chat'} TabGroup */

/**
 * Cada grupo: onde ficam os botoes, qual atributo os nomeia e que painel cada
 * nome mostra.
 *
 * @type {Record<TabGroup, { tablist: HTMLElement, attribute: string, panels: Record<string, HTMLElement> }>}
 */
const GROUPS = {
  sidebar: {
    tablist: sidebarTabs,
    attribute: 'data-tab',
    panels: { screens: tabScreens, chat: tabChat },
  },
  chat: {
    tablist: chatTabs,
    attribute: 'data-chat-tab',
    panels: { list: chatConversations, chat: chatPanel },
  },
};

/**
 * Mostra a aba `name` do grupo e esconde as irmas, no painel e no botao.
 *
 * @param {TabGroup} group
 * @param {SidebarTabName | ChatTabName} name
 */
export function showTab(group, name) {
  const { tablist, attribute, panels } = GROUPS[group];

  if (group === 'sidebar') ui.activeTab = /** @type {SidebarTabName} */ (name);
  else ui.activeChatTab = /** @type {ChatTabName} */ (name);

  for (const [tab, panel] of Object.entries(panels)) {
    const active = tab === name;
    panel.hidden = !active;

    const button = tablist.querySelector(`[${attribute}="${tab}"]`);
    button?.setAttribute('aria-selected', String(active));
  }

  // O compositor cresceu com a aba escondida (`scrollHeight` da 0 sem
  // layout) — mede de novo agora que ficou visivel.
  if (panels.chat && !panels.chat.hidden) autoGrow();
}

for (const [group, { tablist, attribute }] of Object.entries(GROUPS)) {
  tablist.addEventListener('click', (event) => {
    const target = /** @type {Element | null} */ (event.target);
    const button = target?.closest(`[${attribute}]`);
    const tab = button?.getAttribute(attribute);
    if (tab) showTab(/** @type {TabGroup} */ (group), /** @type {any} */ (tab));
  });
}
