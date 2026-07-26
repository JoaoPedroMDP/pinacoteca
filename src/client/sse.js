// @ts-check
// Cliente SSE: assina `/events` e aplica no board o que o servidor avisou.

import { connection } from './dom.js';
import { screens } from './state.js';
import { createCard, reloadCard, removeCard } from './cards.js';
import { renderSidebar } from './sidebar.js';
import { centerOn, layout } from './view.js';

/**
 * Espelho do contrato definido em `src/server/watcher.js` — mudou la, muda aqui.
 * O e2e cobre os quatro tipos.
 *
 * @typedef {'add' | 'change' | 'unlink' | 'asset'} BoardEventType
 * @typedef {{ type: BoardEventType, file: string }} BoardEvent
 */

/**
 * Monta a tela e enquadra nela: toda tela recem-detectada ganha o foco.
 * @param {string} file
 */
function addScreen(file) {
  createCard(file);
  renderSidebar();
  layout();
  centerOn(file);
}

/** @param {BoardEvent} event */
function applyEvent({ type, file }) {
  if (type === 'add') {
    if (!screens.has(file)) addScreen(file);
    return;
  }

  if (type === 'change') {
    // Um `change` de arquivo que ainda nao esta no board equivale a um `add`.
    if (screens.has(file)) reloadCard(file);
    else addScreen(file);
    return;
  }

  if (type === 'unlink') {
    removeCard(file);
    renderSidebar();
    layout();
    return;
  }

  if (type === 'asset') {
    // O servidor nao sabe quais telas usam este arquivo; o board sabe.
    for (const [screenFile, screen] of screens) {
      if (screen.assets.has(file)) reloadCard(screenFile);
    }
  }
}

/**
 * @param {'live' | 'offline'} state
 * @param {string} label
 */
function showConnection(state, label) {
  connection.dataset.state = state;
  connection.textContent = label;
}

/** Assina o stream. O `EventSource` reconecta sozinho se o servidor reiniciar. */
export function connectEvents() {
  const source = new EventSource('/events');

  source.addEventListener('open', () => showConnection('live', 'ao vivo'));
  // Reconexao e automatica; aqui so refletimos o estado no rodape.
  source.addEventListener('error', () => showConnection('offline', 'reconectando'));

  source.addEventListener('message', (event) => applyEvent(JSON.parse(event.data)));

  return source;
}
