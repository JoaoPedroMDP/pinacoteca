// @ts-check
// Persistencia da organizacao do board: onde cada tela ficou no canvas.
//
// Fica no localStorage do navegador, e nao em arquivo, porque a pinacoteca e
// somente leitura sobre a pasta observada — ela nao escreve nada la dentro.
//
// A chave leva a raiz observada: o mesmo navegador pode ter varios boards
// abertos, e a organizacao de uma pasta nao tem nada a ver com a da outra.
//
// Toda leitura e escrita e tolerante a falha: localStorage bloqueado (modo
// privado, cookies desligados) ou JSON estragado apenas devolve o board ao
// layout automatico, nunca derruba a pagina.

import { source } from './state.js';

const KEY_PREFIX = 'pinacoteca:positions:';

/** @typedef {{ x: number, y: number }} Position */

/** @returns {string} */
function storageKey() {
  return `${KEY_PREFIX}${source.root}`;
}

/**
 * Posicoes salvas, por caminho relativo da tela.
 * @returns {Record<string, Position>} vazio quando nao ha nada utilizavel
 */
export function loadPositions() {
  /** @type {Record<string, Position>} */
  const positions = {};

  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return positions;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return positions;

    for (const [file, value] of Object.entries(parsed)) {
      // Descarta entrada estragada em vez de deixar um NaN chegar ao layout.
      if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) {
        positions[file] = { x: value.x, y: value.y };
      }
    }
  } catch {
    return {};
  }
  return positions;
}

/**
 * Posicao salva de uma tela so.
 * @param {string} file
 * @returns {Position | null}
 */
export function savedPosition(file) {
  return loadPositions()[file] ?? null;
}

/**
 * Grava a organizacao inteira. Quem chama ja filtrou o que e valido — aqui so
 * se escreve.
 * @param {Record<string, Position>} positions
 */
export function savePositions(positions) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(positions));
  } catch {
    // Sem espaco ou sem permissao: o board segue funcionando, so nao lembra.
  }
}

/** Esquece a organizacao deste board e volta ao layout automatico. */
export function clearPositions() {
  try {
    localStorage.removeItem(storageKey());
  } catch {
    // Idem: nada a fazer se o navegador nao deixa escrever.
  }
}

// O snap-to-grid e preferencia do navegador, nao da pasta observada: ao
// contrario das posicoes, uma chave so serve todo board aberto nele.
const SNAP_KEY = 'pinacoteca:snap-to-grid';

/** @returns {boolean} */
export function loadSnapToGrid() {
  try {
    return localStorage.getItem(SNAP_KEY) === '1';
  } catch {
    return false;
  }
}

/** @param {boolean} enabled */
export function saveSnapToGrid(enabled) {
  try {
    localStorage.setItem(SNAP_KEY, enabled ? '1' : '0');
  } catch {
    // Sem espaco ou sem permissao: segue funcionando, so nao lembra.
  }
}
