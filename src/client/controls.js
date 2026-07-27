// @ts-check
// Entrada do usuario: roda do mouse, arrasto, teclado e toolbar.
//
// Todos os listeners do board estao aqui. Cada um comeca decidindo *de quem e o
// gesto* — do prototipo, do modo ponteiro ou do board — e so entao age.

import { toolbar, viewport } from './dom.js';
import { screens, ui, view } from './state.js';
import {
  applyTransform, fitToScreen, moveScreen, panBy, persistPositions,
  resetPositions, resetZoom, zoomAt, zoomByStep,
} from './view.js';
import { setInteractive } from './cards.js';
import { adjustInspectLevel, clearHoverHighlight, hasHoverTarget } from './inspect.js';
import { WHEEL_STEP, WHEEL_ZOOM_DAMPING, ZOOM_STEP } from './constants.js';

/**
 * Troca o modo de interacao do board.
 * @param {'pan' | 'pointer'} next
 */
export function setMode(next) {
  ui.mode = next;
  viewport.classList.toggle('is-pointer', next === 'pointer');
  if (next !== 'pointer') clearHoverHighlight();
  toolbar.querySelector('[data-action="toggle-mode"]')
    ?.setAttribute('aria-pressed', String(next === 'pointer'));
}

/**
 * O gesto pertence ao prototipo? So quando a tela esta liberada para clique e o
 * evento nasceu dentro dela.
 * @param {Event} event
 * @returns {boolean}
 */
function isInsideInteractiveCard(event) {
  const target = /** @type {Element | null} */ (event.target);
  return Boolean(ui.interactiveFile && target?.closest?.('.card.is-interactive'));
}

/* ---------- Roda do mouse: nivel do destaque, zoom ou pan ---------- */

// Scroll acumulado do modo ponteiro. So troca de nivel a cada WHEEL_STEP px.
let wheelAccum = 0;

/** @param {WheelEvent} event */
function onWheelInspect(event) {
  event.preventDefault();

  // Troca de direcao zera o acumulado: nao "gasta" scroll do sentido anterior.
  if ((wheelAccum < 0) !== (event.deltaY < 0)) wheelAccum = 0;
  wheelAccum += event.deltaY;

  while (Math.abs(wheelAccum) >= WHEEL_STEP) {
    // Scroll pra cima (deltaY < 0) sobe um ancestral; pra baixo volta pro filho.
    adjustInspectLevel(wheelAccum < 0 ? 1 : -1, event.clientX, event.clientY);
    wheelAccum -= Math.sign(wheelAccum) * WHEEL_STEP;
  }
}

viewport.addEventListener('wheel', (event) => {
  // No modo ponteiro sobre um card, o scroll muda o nivel do destaque.
  if (ui.mode === 'pointer' && hasHoverTarget()) {
    onWheelInspect(event);
    return;
  }

  // Sobre um card liberado, o scroll pertence ao prototipo.
  if (isInsideInteractiveCard(event)) return;

  event.preventDefault();

  if (event.ctrlKey || event.metaKey) {
    zoomAt(Math.exp(-event.deltaY / WHEEL_ZOOM_DAMPING), event.clientX, event.clientY);
  } else {
    panBy(-event.deltaX, -event.deltaY);
  }
}, { passive: false });

/**
 * O ponto do canvas que esta sob o cursor, desfazendo o pan e o zoom.
 * @param {PointerEvent} event
 * @returns {{ x: number, y: number }} em px de canvas
 */
function canvasPoint(event) {
  const rect = viewport.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - view.x) / view.scale,
    y: (event.clientY - rect.top - view.y) / view.scale,
  };
}

/**
 * A alca de arrasto de uma tela e o titulo dela.
 * @param {Event} event
 * @returns {string | null} o arquivo da tela, ou null se o gesto nasceu fora
 */
function draggedFile(event) {
  const title = /** @type {Element | null} */ (event.target)?.closest?.('.card-title');
  return title?.parentElement?.dataset.file ?? null;
}

/* ---------- Arrasto: pan do board ---------- */

/** @type {number | null} */
let panPointerId = null;
let panStartX = 0;
let panStartY = 0;

viewport.addEventListener('pointerdown', (event) => {
  // Botao esquerdo ou do meio.
  if (event.button !== 0 && event.button !== 1) return;
  // Alt+clique e captura de XPath, nao pan: deixa o evento chegar ao escudo.
  if (event.altKey) return;
  // No modo ponteiro o arrasto com o esquerdo nao move o board (o do meio move).
  if (ui.mode === 'pointer' && event.button === 0) return;
  if (isInsideInteractiveCard(event)) return;
  // O titulo e a alca de arrasto da tela: ali o gesto move o card, nao o board.
  if (draggedFile(event)) return;
  // A toolbar fica dentro do viewport: sem isto o setPointerCapture abaixo
  // redirecionaria o clique para o viewport e os botoes nunca disparariam.
  if (/** @type {Element} */ (event.target).closest?.('.toolbar')) return;

  // Sem isto o navegador comeca uma selecao de texto no arrasto, e ela se
  // estende em ordem de DOM: o pan sai grifando os titulos das telas no caminho.
  event.preventDefault();

  panPointerId = event.pointerId;
  panStartX = event.clientX - view.x;
  panStartY = event.clientY - view.y;
  viewport.classList.add('is-panning');
  viewport.setPointerCapture(event.pointerId);
});

viewport.addEventListener('pointermove', (event) => {
  if (event.pointerId !== panPointerId) return;
  view.x = event.clientX - panStartX;
  view.y = event.clientY - panStartY;
  applyTransform();
});

/** @param {PointerEvent} event */
function endPan(event) {
  if (event.pointerId !== panPointerId) return;
  panPointerId = null;
  viewport.classList.remove('is-panning');
}

viewport.addEventListener('pointerup', endPan);
viewport.addEventListener('pointercancel', endPan);

/* ---------- Arrasto do titulo: reorganizar as telas ---------- */

// Estado do gesto em andamento: nasce no pointerdown e morre no pointerup.
/** @type {number | null} */
let dragPointerId = null;
let dragFile = '';
let dragOffsetX = 0;
let dragOffsetY = 0;

viewport.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.altKey) return;

  const file = draggedFile(event);
  const screen = file ? screens.get(file) : null;
  if (!file || !screen) return;

  event.preventDefault(); // senao o arrasto vira selecao do texto do titulo

  const point = canvasPoint(event);
  dragPointerId = event.pointerId;
  dragFile = file;
  // Guardar onde dentro do card o cursor pegou: sem isso a tela pularia para
  // ficar com o canto embaixo do cursor no primeiro movimento.
  dragOffsetX = point.x - screen.x;
  dragOffsetY = point.y - screen.y;

  viewport.classList.add('is-dragging');
  try {
    viewport.setPointerCapture(event.pointerId);
  } catch {
    // Ponteiro sintetico (teste) nao existe para o navegador capturar. Os
    // listeners de move/up no viewport dao conta do gesto do mesmo jeito.
  }
});

viewport.addEventListener('pointermove', (event) => {
  if (event.pointerId !== dragPointerId) return;

  const point = canvasPoint(event);
  moveScreen(dragFile, Math.round(point.x - dragOffsetX), Math.round(point.y - dragOffsetY));
});

/** Fim do arrasto: e aqui que a organizacao vira estado salvo. */
/** @param {PointerEvent} event */
function endDrag(event) {
  if (event.pointerId !== dragPointerId) return;

  dragPointerId = null;
  viewport.classList.remove('is-dragging');
  // Posicao invalida (tela em cima de outra) fica na tela, mas nao e salva.
  persistPositions();
}

viewport.addEventListener('pointerup', endDrag);
viewport.addEventListener('pointercancel', endDrag);

// Clique no vazio sai do modo de interacao.
viewport.addEventListener('click', (event) => {
  if (ui.interactiveFile && !isInsideInteractiveCard(event)) setInteractive(null);
});

/* ---------- Toolbar ---------- */

toolbar.addEventListener('click', (event) => {
  const action = /** @type {Element} */ (event.target).closest('button')?.getAttribute('data-action');

  if (action === 'zoom-in') zoomByStep(ZOOM_STEP);
  else if (action === 'zoom-out') zoomByStep(1 / ZOOM_STEP);
  else if (action === 'zoom-reset') resetZoom();
  else if (action === 'fit') fitToScreen();
  else if (action === 'rearrange') resetPositions();
  else if (action === 'toggle-mode') setMode(ui.mode === 'pointer' ? 'pan' : 'pointer');
});

/* ---------- Teclado ---------- */

// Modo de antes de segurar Alt; null quando o Alt nao esta segurando o ponteiro.
/** @type {'pan' | 'pointer' | null} */
let modeBeforeAlt = null;

/** Soltar o Alt (ou perder o foco da janela) volta ao modo anterior. */
function releaseAltPointer() {
  if (modeBeforeAlt === null) return;
  setMode(modeBeforeAlt);
  modeBeforeAlt = null;
}

window.addEventListener('keydown', (event) => {
  // Segurar Alt ativa o ponteiro enquanto a tecla estiver pressionada.
  if (event.key === 'Alt') {
    if (modeBeforeAlt !== null || ui.mode === 'pointer') return;
    event.preventDefault(); // evita o Alt roubar o foco pro menu do navegador
    modeBeforeAlt = ui.mode;
    setMode('pointer');
    return;
  }

  // Os atalhos abaixo nao disputam com os do navegador.
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === 'Escape') setInteractive(null);
  else if (event.key === '0') fitToScreen();
  else if (event.key === '1') resetZoom();
  else if (event.key === '+' || event.key === '=') zoomByStep(ZOOM_STEP);
  else if (event.key === '-') zoomByStep(1 / ZOOM_STEP);
});

window.addEventListener('keyup', (event) => {
  if (event.key === 'Alt') releaseAltPointer();
});

// Perder o foco solta a tecla sem disparar keyup: nao deixa preso no ponteiro.
window.addEventListener('blur', releaseAltPointer);
