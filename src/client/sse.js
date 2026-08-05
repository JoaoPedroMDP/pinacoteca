// @ts-check
// Cliente SSE: assina `/events` e aplica no board o que o servidor avisou.

import { connection } from './dom.js';
import { screens } from './state.js';
import { createCard, markLastChanged, reloadCard, removeCard, settle } from './cards.js';
import { renderSidebar } from './sidebar.js';
import { centerOn, layout } from './view.js';

/**
 * Espelho do contrato definido em `src/server/watcher.js` — mudou la, muda aqui.
 * O e2e cobre os quatro tipos.
 *
 * @typedef {'add' | 'change' | 'unlink' | 'asset' | 'settled'} BoardEventType
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

/**
 * Aplica o evento e devolve as telas que ele atingiu, para o board marcar quais
 * mudaram por ultimo.
 *
 * @param {BoardEvent} event
 * @returns {string[]} telas atingidas; vazio quando o evento nao mexeu em nenhuma
 */
function applyEvent({ type, file }) {
  if (type === 'add') {
    if (!screens.has(file)) addScreen(file);
    return [file];
  }

  if (type === 'change') {
    // Um `change` de arquivo que ainda nao esta no board equivale a um `add`.
    if (screens.has(file)) reloadCard(file);
    else addScreen(file);
    return [file];
  }

  if (type === 'unlink') {
    removeCard(file);
    renderSidebar();
    layout();
    // A tela saiu do board: nao ha o que contornar.
    return [];
  }

  if (type === 'asset') {
    // O servidor nao sabe quais telas usam este arquivo; o board sabe.
    /** @type {string[]} */
    const affected = [];
    for (const [screenFile, screen] of screens) {
      if (!screen.assets.has(file)) continue;
      reloadCard(screenFile);
      affected.push(screenFile);
    }
    return affected;
  }

  if (type === 'settled') {
    // Quem estava escrevendo parou. A marca verde continua onde esta: ela
    // aponta a ultima tela mexida, e o silencio nao mexeu em tela nenhuma.
    settle();
  }

  return [];
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

  source.addEventListener('message', (event) => {
    const affected = applyEvent(JSON.parse(event.data));
    // Evento que nao atingiu tela nenhuma (remocao, asset que ninguem carrega)
    // deixa a marca anterior de pe: ela continua sendo a ultima tela mexida.
    if (affected.length > 0) markLastChanged(affected);
  });

  return source;
}
