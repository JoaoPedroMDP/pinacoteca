// @ts-check
// Camera do board: zoom, pan e posicionamento dos cards no canvas.
//
// O zoom e um `transform: scale()` no canvas inteiro, nao um redimensionamento
// dos iframes: assim o conteudo nao sofre reflow ao dar zoom, e o resultado e o
// comportamento de canvas que se espera.

import { canvas, viewport, zoomLabel } from './dom.js';
import { screens, ui, view } from './state.js';
import { setCurrent } from './sidebar.js';
import { assignColumns, clamp, findOverlaps, rectsOverlap, snapToGrid } from './utils.js';
import { clearPositions, loadPositions, savePositions } from './storage.js';
import {
  CARD_TITLE_HEIGHT, CENTER_PADDING, FIT_PADDING, GAP, GRID_SIZE,
  MAX_FRAME_HEIGHT, MAX_FRAME_WIDTH, MAX_SCALE,
  MIN_FRAME_HEIGHT, MIN_FRAME_WIDTH, MIN_SCALE,
} from './constants.js';

/** Escreve `view` no DOM. Toda mudanca de zoom ou pan termina aqui. */
export function applyTransform() {
  canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  // Contra-escala dos titulos: cada .card-title usa 1/scale para ficar sempre 16px na tela.
  canvas.style.setProperty('--inv-scale', String(1 / view.scale));
  // O mesmo zoom, na mao do CSS: e com ele que o titulo limita a largura dele a
  // do card *na tela*, em vez de crescer junto com a contra-escala (veja board.css).
  canvas.style.setProperty('--scale', String(view.scale));
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
 * Caixa de uma tela no canvas. O titulo entra na conta: ele ocupa espaco acima
 * do frame e e por onde a tela e arrastada.
 *
 * @param {import('./state.js').Screen} screen
 * @returns {import('./utils.js').Rect}
 */
function screenRect(screen) {
  return {
    x: screen.x,
    y: screen.y,
    width: screen.frameWidth,
    height: CARD_TITLE_HEIGHT + screen.frameHeight,
  };
}

/**
 * Caixa que envolve todos os cards, em px de canvas.
 *
 * O canto nao e a origem: uma tela arrastada pode ficar em coordenada negativa,
 * e enquadrar precisa saber onde o conteudo comeca, nao so onde termina.
 *
 * @returns {import('./utils.js').Rect | null} null quando o board esta vazio
 */
function contentBounds() {
  if (screens.size === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const screen of screens.values()) {
    const rect = screenRect(screen);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
  view.x = (available.width - bounds.width * view.scale) / 2 - bounds.x * view.scale;
  view.y = (available.height - bounds.height * view.scale) / 2 - bounds.y * view.scale;
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
 * Escreve a posicao da tela no DOM. Todo movimento de card termina aqui.
 * @param {import('./state.js').Screen} screen
 * @param {number} x
 * @param {number} y
 */
function place(screen, x, y) {
  screen.x = x;
  screen.y = y;
  screen.card.style.left = `${x}px`;
  screen.card.style.top = `${y}px`;
}

/**
 * Escreve o tamanho da tela no DOM. Todo redimensionamento de card termina
 * aqui — a largura mora no `.card` e a altura no `.card-frame`, do mesmo jeito
 * que a medida do conteudo escreve.
 * @param {import('./state.js').Screen} screen
 * @param {number} width
 * @param {number} height
 */
function placeSize(screen, width, height) {
  screen.frameWidth = width;
  screen.frameHeight = height;
  screen.card.style.width = `${width}px`;
  screen.frame.style.height = `${height}px`;
}

/**
 * Desce a tela ate ela nao tapar nenhuma tela fixa.
 *
 * Uma passada so basta porque os obstaculos vem ordenados por `y` e cada colisao
 * joga a tela para *abaixo* daquele obstaculo: um obstaculo ja ultrapassado nao
 * volta a colidir.
 *
 * @param {import('./utils.js').Rect} rect caixa da tela na posicao pretendida
 * @param {import('./utils.js').Rect[]} blockers telas fixas, ordenadas por `y`
 * @returns {number} o `y` livre
 */
function belowPinned(rect, blockers) {
  let y = rect.y;
  for (const blocker of blockers) {
    if (rectsOverlap({ ...rect, y }, blocker)) y = blocker.y + blocker.height + GAP;
  }
  return y;
}

/**
 * Marca com contorno vermelho toda tela que esta por cima de outra.
 *
 * Posicao invalida existe na tela — o usuario pode largar uma tela em cima da
 * outra —, ela so nunca chega ao localStorage.
 *
 * @returns {Set<string>} os arquivos em posicao invalida
 */
export function refreshOverlaps() {
  const invalid = findOverlaps(
    [...screens.values()].map((screen) => ({ file: screen.file, ...screenRect(screen) })),
  );

  for (const screen of screens.values()) {
    screen.card.classList.toggle('is-invalid', invalid.has(screen.file));
  }
  return invalid;
}

/**
 * Move uma tela para um ponto do canvas. Mover fixa a tela: dali em diante ela
 * e do usuario, e o layout automatico nao mexe mais nela.
 *
 * @param {string} file
 * @param {number} x
 * @param {number} y
 */
export function moveScreen(file, x, y) {
  const screen = screens.get(file);
  if (!screen) return;

  screen.pinned = true;
  if (ui.snapToGrid) {
    x = snapToGrid(x, GRID_SIZE);
    y = snapToGrid(y, GRID_SIZE);
  }
  place(screen, x, y);
  refreshOverlaps();
}

/**
 * Redimensiona uma tela. Como so as bordas de baixo e da direita agarram, o
 * canto de cima nao se mexe e nao ha `x`/`y` a recalcular.
 *
 * Redimensionar fixa a tela pelo mesmo motivo que mover fixa: o layout
 * automatico decide a largura da coluna pela tela mais larga dela, e devolver
 * a tela ao fluxo logo depois de o usuario escolher o tamanho a jogaria para
 * outro lugar no mesmo gesto.
 *
 * Nao roda `layout()`: isto e chamado a cada `pointermove` do arrasto, e
 * reposicionar o board inteiro nessa frequencia faria as outras telas
 * tremerem debaixo do cursor. Quem fecha o gesto chama `finishResize`.
 *
 * @param {string} file
 * @param {number} width
 * @param {number} height
 */
export function resizeScreen(file, width, height) {
  const screen = screens.get(file);
  if (!screen) return;

  screen.pinned = true;
  screen.sized = true;
  placeSize(
    screen,
    Math.round(clamp(width, MIN_FRAME_WIDTH, MAX_FRAME_WIDTH)),
    Math.round(clamp(height, MIN_FRAME_HEIGHT, MAX_FRAME_HEIGHT)),
  );
  refreshOverlaps();
}

/**
 * Fecha um redimensionamento: as telas que ainda escorrem se reacomodam em
 * volta do novo tamanho, e a organizacao vira estado salvo.
 */
export function finishResize() {
  layout();
  persistPositions();
}

/**
 * Aplica uma dimensao do menu de tamanho. Nao e gesto continuo, entao ja
 * fecha o redimensionamento no mesmo passo.
 * @param {string} file
 * @param {number} width
 * @param {number} height
 */
export function applyPresetSize(file, width, height) {
  resizeScreen(file, width, height);
  finishResize();
}

/* ---------- Desfazer / refazer o arrasto de tela ---------- */

/**
 * @typedef {{ file: string, x: number, y: number }} HistoryEntry
 *   Posicao de uma tela antes do movimento que a levou ao topo da outra pilha.
 */

// Limite generoso: um board de prototipo nao arrasta telas milhares de vezes
// numa sessao, e isto e so para a pilha nao crescer sem fim.
const HISTORY_LIMIT = 100;

/** @type {HistoryEntry[]} */
const undoStack = [];
/** @type {HistoryEntry[]} */
const redoStack = [];

/**
 * Registra que `file` estava em `(x, y)` antes do arrasto que acabou de
 * terminar. So o arrasto de titulo passa por aqui — pan, zoom, snap e
 * "Reorganizar" nao entram no historico.
 * @param {string} file
 * @param {number} x
 * @param {number} y
 */
export function recordMove(file, x, y) {
  undoStack.push({ file, x, y });
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0; // acao nova invalida qualquer redo pendente
}

/** Esquece o historico de arrasto. Chamado quando "Reorganizar" apaga tudo. */
export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
}

/**
 * Troca a posicao atual de uma tela pela do topo de uma pilha, empurrando a
 * posicao atual para a pilha oposta.
 * @param {HistoryEntry[]} from
 * @param {HistoryEntry[]} to
 */
function swapHistory(from, to) {
  const entry = from.pop();
  if (!entry) return;

  const screen = screens.get(entry.file);
  if (!screen) return;

  to.push({ file: entry.file, x: screen.x, y: screen.y });
  screen.pinned = true;
  place(screen, entry.x, entry.y);
  refreshOverlaps();
  persistPositions();
}

/** Desfaz o ultimo arrasto de tela. Sem historico: nao faz nada. */
export function undo() {
  swapHistory(undoStack, redoStack);
}

/** Refaz o ultimo arrasto desfeito. Sem historico: nao faz nada. */
export function redo() {
  swapHistory(redoStack, undoStack);
}

/**
 * Grava a organizacao atual. So estado valido entra: uma tela largada — ou
 * esticada — em cima de outra mantem no localStorage a ultima posicao e o
 * ultimo tamanho validos em que esteve.
 *
 * O registro de cada tela e reescrito inteiro a partir do estado vivo dela,
 * entao uma tela que voltou ao tamanho automatico perde o `width`/`height`
 * salvo sem precisar de nenhuma limpeza a parte.
 */
export function persistPositions() {
  const invalid = refreshOverlaps();
  const positions = loadPositions();

  for (const screen of screens.values()) {
    if (!screen.pinned || invalid.has(screen.file)) continue;

    positions[screen.file] = screen.sized
      ? { x: screen.x, y: screen.y, width: screen.frameWidth, height: screen.frameHeight }
      : { x: screen.x, y: screen.y };
  }
  savePositions(positions);
}

/** Esquece a organizacao do usuario e devolve tudo ao layout automatico. */
export function resetPositions() {
  clearPositions();
  clearHistory();
  for (const screen of screens.values()) screen.pinned = false;
  layout();
}

/**
 * Distribui os cards em colunas (`⌈√n⌉`), cada um indo para a coluna mais curta
 * no momento. Cada coluna tem a largura da tela mais larga *dela*: uma tela
 * desktop no board nao empurra as estreitas para slots de 1280px.
 *
 * Telas fixas (`pinned`) ficam onde o usuario deixou; as demais escorrem pelas
 * colunas desviando delas, para o automatico nunca cair em cima do manual.
 *
 * Chame sempre que um card mudar de tamanho ou uma tela entrar ou sair.
 */
export function layout() {
  const all = [...screens.values()].sort((a, b) => a.file.localeCompare(b.file));
  const pinned = all.filter((screen) => screen.pinned);
  const flowing = all.filter((screen) => !screen.pinned);

  // Tela fixa tambem passa pelo DOM: e a carga inicial que a coloca no lugar.
  for (const screen of pinned) place(screen, screen.x, screen.y);
  const blockers = pinned.map(screenRect).sort((a, b) => a.y - b.y);

  const columns = assignColumns(
    flowing.map((screen) => CARD_TITLE_HEIGHT + screen.frameHeight + GAP),
    Math.ceil(Math.sqrt(flowing.length)),
  );

  let x = 0;
  for (const column of columns) {
    let columnWidth = MIN_FRAME_WIDTH;
    for (const index of column) columnWidth = Math.max(columnWidth, flowing[index].frameWidth);

    let y = 0;
    for (const index of column) {
      const screen = flowing[index];
      y = belowPinned({ ...screenRect(screen), x, y }, blockers);
      place(screen, x, y);
      y += CARD_TITLE_HEIGHT + screen.frameHeight + GAP;
    }
    x += columnWidth + GAP;
  }

  refreshOverlaps();
}
