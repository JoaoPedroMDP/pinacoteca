// @ts-check
// Entrypoint do board (carregado por `index.html`).
//
// Faz duas coisas: pinta o estado inicial vindo de `/api/screens` e liga o
// stream de eventos. Todo o resto mora nos modulos abaixo:
//
//   constants.js  numeros ajustaveis
//   utils.js      funcoes puras (sem DOM, sem estado)
//   dom.js        referencias aos elementos de index.html
//   state.js      estado mutavel: telas, zoom/pan, modo
//   storage.js    organizacao das telas, no localStorage
//   view.js       camera: zoom, pan e layout dos cards
//   cards.js      criacao, recarga e medida de cada tela
//   sidebar.js    arvore de telas por pasta
//   inspect.js    modo ponteiro e captura de XPath
//   feedback.js   toast e area de transferencia
//   controls.js   listeners de mouse, teclado e toolbar
//   sse.js        eventos do servidor
//   tabs.js       abas da sidebar: Telas e Conversa
//   chat.js       painel de conversa: compositor, historico e o log
//   chat-client.js  transporte da conversa: as rotas /api/chat/

import { rootPath, version } from './dom.js';
import { source } from './state.js';
import { SIDEBAR_DEFAULT_WIDTH } from './constants.js';
import { loadSidebarWidth, loadSnapToGrid } from './storage.js';
import { createCard } from './cards.js';
import { renderSidebar } from './sidebar.js';
import { applyTransform, fitToScreen, layout } from './view.js';
import { connectEvents } from './sse.js';
import { setSidebarWidth, setSnapToGrid } from './controls.js'; // tambem registra os listeners
import { showTab } from './tabs.js'; // tambem registra o listener das abas
import { initChat } from './chat.js';
import { connectChat } from './chat-client.js';
import { initSettings } from './settings.js';

/**
 * @typedef {{ root: string, version: string, screens: string[] }} ScreensResponse
 *   Formato de `GET /api/screens` (veja `src/server/index.js`).
 */

/** Carga inicial: monta um card por HTML encontrado e enquadra o board. */
async function loadScreens() {
  const response = await fetch('/api/screens');
  /** @type {ScreensResponse} */
  const data = await response.json();

  rootPath.textContent = data.root;
  rootPath.title = data.root;
  if (data.version) version.textContent = `v${data.version}`;

  // Antes de montar card nenhum: e a raiz que diz qual organizacao salva e desta
  // pasta, e `createCard` ja consulta essa organizacao.
  source.root = data.root;

  for (const file of data.screens) createCard(file);
  renderSidebar();
  layout();
  fitToScreen();
}

applyTransform();
setSnapToGrid(loadSnapToGrid());
// Antes de qualquer medida: `fitToScreen` enquadra pela largura do viewport, e
// o viewport e o que sobra depois da sidebar.
setSidebarWidth(loadSidebarWidth() || SIDEBAR_DEFAULT_WIDTH);
showTab('screens');
await loadScreens();
// Depois da carga de proposito: o rascunho e o historico da conversa sao por
// raiz observada, e a raiz so e conhecida a partir de `/api/screens`.
initChat();
initSettings();
// Depois do `initChat`/`initSettings`: `connectChat` pinta na interface o que
// o servidor sabe (se ha chave, se a aprovacao e automatica), e os dois
// `init*` sobrescreveriam.
await connectChat();
connectEvents();
