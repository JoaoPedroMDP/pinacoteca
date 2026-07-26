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
//   view.js       camera: zoom, pan e layout dos cards
//   cards.js      criacao, recarga e medida de cada tela
//   sidebar.js    arvore de telas por pasta
//   inspect.js    modo ponteiro e captura de XPath
//   feedback.js   toast e area de transferencia
//   controls.js   listeners de mouse, teclado e toolbar
//   sse.js        eventos do servidor

import { rootPath, version } from './dom.js';
import { createCard } from './cards.js';
import { renderSidebar } from './sidebar.js';
import { applyTransform, fitToScreen, layout } from './view.js';
import { connectEvents } from './sse.js';
import './controls.js'; // registra os listeners

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

  for (const file of data.screens) createCard(file);
  renderSidebar();
  layout();
  fitToScreen();
}

applyTransform();
await loadScreens();
connectEvents();
