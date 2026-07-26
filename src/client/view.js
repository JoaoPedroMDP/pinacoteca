// @ts-check
// Camera do board: zoom, pan e posicionamento dos cards no canvas.
//
// O zoom e um `transform: scale()` no canvas inteiro, nao um redimensionamento
// dos iframes: assim o conteudo nao sofre reflow ao dar zoom, e o resultado e o
// comportamento de canvas que se espera.

import { canvas, viewport, zoomLabel } from './dom.js';
import { screens, view } from './state.js';
import { setCurrent } from './sidebar.js';
import { clamp } from './utils.js';
import {
  CARD_TITLE_HEIGHT, CENTER_PADDING, FIT_PADDING, GAP,
  MAX_SCALE, MIN_FRAME_WIDTH, MIN_SCALE,
} from './constants.js';

/** Escreve `view` no DOM. Toda mudanca de zoom ou pan termina aqui. */
export function applyTransform() {
  canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  // Contra-escala dos titulos: cada .card-title usa 1/scale para ficar sempre 16px na tela.
  canvas.style.setProperty('--inv-scale', String(1 / view.scale));
  zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
}

/**
 * Zoom mantendo fixo o ponto do canvas que esta sob o cursor.
 * @param {number} factor multiplicador da escala
 * @param {number} clientX
 * @param {number} clientY
 */
export function zoomAt(factor, clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  const pointerX = clientX - rect.left;
  const pointerY = clientY - rect.top;

  const nextScale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const ratio = nextScale / view.scale;

  view.x = pointerX - ratio * (pointerX - view.x);
  view.y = pointerY - ratio * (pointerY - view.y);
  view.scale = nextScale;

  applyTransform();
}

/**
 * Zoom pelo centro da tela, para os botoes e atalhos de teclado.
 * @param {number} factor
 */
export function zoomByStep(factor) {
  const rect = viewport.getBoundingClientRect();
  zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

/** Volta ao zoom 1:1 sem mexer no pan. */
export function resetZoom() {
  view.scale = 1;
  applyTransform();
}

/**
 * Move o board sem mudar o zoom.
 * @param {number} deltaX
 * @param {number} deltaY
 */
export function panBy(deltaX, deltaY) {
  view.x += deltaX;
  view.y += deltaY;
  applyTransform();
}

/**
 * Caixa que envolve todos os cards, em px de canvas.
 * @returns {{ width: number, height: number } | null} null quando o board esta vazio
 */
function contentBounds() {
  if (screens.size === 0) return null;

  let maxX = 0;
  let maxY = 0;
  for (const screen of screens.values()) {
    maxX = Math.max(maxX, screen.x + screen.frameWidth);
    maxY = Math.max(maxY, screen.y + CARD_TITLE_HEIGHT + screen.frameHeight);
  }
  return { width: maxX, height: maxY };
}

/** Enquadra o board inteiro na tela, sem passar de 100%. */
export function fitToScreen() {
  const bounds = contentBounds();
  if (!bounds) return;

  const available = viewport.getBoundingClientRect();
  const fitScale = Math.min(
    (available.width - FIT_PADDING * 2) / bounds.width,
    (available.height - FIT_PADDING * 2) / bounds.height,
    1,
  );

  view.scale = clamp(fitScale, MIN_SCALE, MAX_SCALE);
  view.x = (available.width - bounds.width * view.scale) / 2;
  view.y = (available.height - bounds.height * view.scale) / 2;
  applyTransform();
}

/**
 * Enquadra e centraliza uma tela so. Usado pelo clique na sidebar e por toda
 * tela recem-detectada.
 * @param {string} file
 */
export function centerOn(file) {
  const screen = screens.get(file);
  if (!screen) return;

  const available = viewport.getBoundingClientRect();
  const cardHeight = CARD_TITLE_HEIGHT + screen.frameHeight;

  view.scale = clamp(
    Math.min(
      (available.width - CENTER_PADDING * 2) / screen.frameWidth,
      (available.height - CENTER_PADDING * 2) / cardHeight,
    ),
    MIN_SCALE,
    1,
  );
  view.x = available.width / 2 - (screen.x + screen.frameWidth / 2) * view.scale;
  view.y = available.height / 2 - (screen.y + cardHeight / 2) * view.scale;

  applyTransform();
  setCurrent(file);
}

/**
 * Distribui os cards em colunas (`⌈√n⌉`), cada um indo para a coluna mais curta
 * no momento. A largura da coluna e a do card mais largo do board, para que
 * telas estreitas fiquem encostadas em vez de espalhadas por slots de 1280px.
 *
 * Chame sempre que um card mudar de tamanho ou uma tela entrar ou sair.
 */
export function layout() {
  const files = [...screens.keys()].sort((a, b) => a.localeCompare(b));
  const columns = Math.max(1, Math.ceil(Math.sqrt(files.length)));
  const columnHeights = new Array(columns).fill(0);

  let columnWidth = MIN_FRAME_WIDTH;
  for (const screen of screens.values()) columnWidth = Math.max(columnWidth, screen.frameWidth);

  for (const file of files) {
    const screen = screens.get(file);
    if (!screen) continue;

    let target = 0;
    for (let i = 1; i < columns; i += 1) {
      if (columnHeights[i] < columnHeights[target]) target = i;
    }

    screen.x = target * (columnWidth + GAP);
    screen.y = columnHeights[target];
    screen.card.style.left = `${screen.x}px`;
    screen.card.style.top = `${screen.y}px`;

    columnHeights[target] += CARD_TITLE_HEIGHT + screen.frameHeight + GAP;
  }
}
