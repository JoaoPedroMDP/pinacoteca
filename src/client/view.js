// @ts-check
// Camera do board: zoom, pan e posicionamento dos cards no canvas.
//
// O zoom e um `transform: scale()` no canvas inteiro, nao um redimensionamento
// dos iframes: assim o conteudo nao sofre reflow ao dar zoom, e o resultado e o
// comportamento de canvas que se espera.

import { canvas, viewport, zoomLabel } from './dom.js';
import { folders, screens, ui, view } from './state.js';
import { setCurrent } from './sidebar.js';
import {
  assignColumns, clamp, connectedFrom, findOverlaps, rectsOverlap, separateOverlaps, shelfWidth,
  snapToGrid,
} from './utils.js';
import { clearPositions, loadPositions, savePositions } from './storage.js';
import { scheduleCommentLinks } from './inspect.js';
import {
  clearGroupOrigins, colorOf, folderOf, groupByFolder, markLastMoved, paintElement,
  setFolderColor, setGroupOrigin,
} from './folders.js';
import {
  CARD_TITLE_HEIGHT, CENTER_PADDING, DETAIL_MIN_SCALE, FIT_PADDING, FOLDER_REACH, FOLDER_ZONE_LABEL,
  FOLDER_ZONE_PAD, GAP, GRID_SIZE,
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
  // Nivel de detalhe: no zoom afastado o board.css esconde os titulos dos cards.
  viewport.classList.toggle('is-zoomed-out', view.scale < DETAIL_MIN_SCALE);
  // A coluna de comentarios e contra-escalada, entao o zoom move a ponta das
  // linhas que sai dela.
  scheduleCommentLinks();
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
  refreshFolderZones();
  return invalid;
}

/* ---------- Grupo visual de cada pasta ---------- */

/** @typedef {import('./state.js').Screen} Screen */

/**
 * As telas que o fundo da pasta envolve: um conjunto ligado.
 *
 * A semente sao as telas do grupo que o layout posiciona (as que o tamanho
 * global fixou contam como dele). Quando nao sobrou nenhuma — o usuario moveu
 * todas —, a semente e a ultima tela movida da pasta; sem registro dela, a
 * primeira. Dali, toda tela da mesma pasta que encosta numa do conjunto
 * (`FOLDER_REACH`) entra, em cadeia. Assim o fundo nunca some enquanto a pasta
 * tiver tela, acompanha a ultima movida, e acolhe a tela largada ao lado dele.
 *
 * @param {string} folder
 * @param {Screen[]} [members] as telas da pasta, se quem chama ja as tem
 * @returns {Screen[]}
 */
export function folderGroup(folder, members) {
  const all = members ?? [...screens.values()].filter((screen) => folderOf(screen.file) === folder);
  if (all.length === 0) return [];

  /** @type {number[]} */
  let seeds = [];
  all.forEach((screen, index) => {
    if (!screen.pinned || screen.autoPinned) seeds.push(index);
  });
  if (seeds.length === 0) {
    const last = all.findIndex((screen) => screen.file === folders.lastMoved[folder]);
    seeds = [Math.max(0, last)];
  }
  const found = connectedFrom(all.map(screenRect), seeds, FOLDER_REACH);
  return all.filter((_, index) => found.has(index));
}

/**
 * Caixa do fundo em volta de um grupo: a folga dos lados e a faixa do nome em
 * cima.
 * @param {Screen[]} group nao vazio
 * @returns {import('./utils.js').Rect}
 */
function zoneRect(group) {
  const rects = group.map(screenRect);
  const left = Math.min(...rects.map((r) => r.x)) - FOLDER_ZONE_PAD;
  const top = Math.min(...rects.map((r) => r.y)) - FOLDER_ZONE_PAD - FOLDER_ZONE_LABEL;
  const right = Math.max(...rects.map((r) => r.x + r.width)) + FOLDER_ZONE_PAD;
  const bottom = Math.max(...rects.map((r) => r.y + r.height)) + FOLDER_ZONE_PAD;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Abre ou fecha o menu do nome de uma pasta no board. Um por vez.
 * @param {string | null} folder null fecha o que estiver aberto
 */
export function setFolderMenu(folder) {
  ui.openFolderMenu = folder;
  for (const zone of canvas.querySelectorAll('.folder-zone')) {
    if (!(zone instanceof HTMLElement)) continue;
    const open = zone.dataset.folderPath === folder;
    zone.classList.toggle('has-open-menu', open);
    zone.querySelector('.folder-zone-menu-btn')?.setAttribute('aria-expanded', String(open));
    // O seletor abre na cor atual, mesmo que ela tenha mudado pela sidebar.
    const input = /** @type {HTMLInputElement | null} */ (zone.querySelector('.folder-zone-color'));
    if (open && input && folder) input.value = colorOf(folder) ?? '#000000';
  }
}

/**
 * O menu do nome da pasta: reagrupar e mudar a cor.
 * @param {string} folder
 * @returns {HTMLElement}
 */
function buildFolderMenu(folder) {
  const menu = document.createElement('div');
  menu.className = 'folder-zone-menu';

  const regroup = document.createElement('button');
  regroup.type = 'button';
  regroup.className = 'folder-zone-option';
  regroup.dataset.action = 'regroup';
  regroup.textContent = 'Reagrupar telas';
  regroup.addEventListener('click', () => {
    setFolderMenu(null);
    regroupFolder(folder);
  });

  // `<label>` em volta do seletor: clicar na opcao inteira abre a paleta.
  const color = document.createElement('label');
  color.className = 'folder-zone-option';
  color.textContent = 'Mudar cor';
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'folder-zone-color';
  input.addEventListener('input', () => setFolderColor(folder, input.value, false));
  input.addEventListener('change', () => setFolderColor(folder, input.value, true));
  color.append(input);

  menu.append(regroup, color);
  return menu;
}

/**
 * Monta o fundo de uma pasta: o retangulo, o nome (que e a alca de arrasto do
 * grupo, veja `controls.js`) e o menu dele.
 * @param {string} folder
 * @returns {HTMLElement}
 */
function buildZone(folder) {
  const zone = document.createElement('div');
  zone.className = 'folder-zone';

  const label = document.createElement('div');
  label.className = 'folder-zone-label';
  label.title = 'Arraste para mover o grupo';
  const name = document.createElement('span');
  name.className = 'folder-zone-name';
  name.textContent = folder;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'folder-zone-menu-btn';
  button.title = 'Opcoes da pasta';
  button.setAttribute('aria-expanded', 'false');
  button.textContent = '▾';
  button.addEventListener('click', () => setFolderMenu(ui.openFolderMenu === folder ? null : folder));

  label.append(name, button, buildFolderMenu(folder));
  zone.append(label);
  return zone;
}

/**
 * Redesenha o fundo colorido de cada pasta atras do grupo dela (`folderGroup`).
 *
 * Os fundos sao reaproveitados por pasta, e nao remontados: isto roda a cada
 * passo de um arrasto, e remontar fecharia o menu e o seletor de cor abertos.
 * Telas na raiz nao tem fundo.
 *
 * Roda junto com `refreshOverlaps`, que ja e chamado depois de todo movimento.
 */
function refreshFolderZones() {
  /** @type {Map<string, HTMLElement>} */
  const existing = new Map();
  for (const zone of canvas.querySelectorAll('.folder-zone')) {
    if (zone instanceof HTMLElement) existing.set(zone.dataset.folderPath ?? '', zone);
  }

  /** @type {HTMLElement[]} */
  const fresh = [];
  for (const [folder, members] of groupByFolder([...screens.values()])) {
    if (!folder) continue;
    const zone = existing.get(folder) ?? buildZone(folder);
    existing.delete(folder);

    const box = zoneRect(folderGroup(folder, members));
    zone.style.left = `${box.x}px`;
    zone.style.top = `${box.y}px`;
    zone.style.width = `${box.width}px`;
    zone.style.height = `${box.height}px`;
    paintElement(zone, folder);
    zone.classList.toggle('has-open-menu', ui.openFolderMenu === folder);
    if (!zone.isConnected) fresh.push(zone);
  }

  for (const zone of existing.values()) zone.remove();
  if (ui.openFolderMenu && !screensInFolder(ui.openFolderMenu)) ui.openFolderMenu = null;
  // No comeco do canvas: o fundo fica atras dos cards sem disputar z-index.
  canvas.prepend(...fresh);
}

/**
 * A pasta ainda tem tela? (O menu de uma pasta que esvaziou nao fica aberto.)
 * @param {string} folder
 * @returns {boolean}
 */
function screensInFolder(folder) {
  for (const screen of screens.values()) if (folderOf(screen.file) === folder) return true;
  return false;
}

/**
 * @typedef {{ folder: string, origin: { x: number, y: number } | null,
 *   items: Array<{ screen: Screen, x: number, y: number }>, dx: number, dy: number }} GroupDrag
 *   Um arrasto de grupo em andamento: de onde cada tela partiu e quanto ja andou.
 */

/**
 * Comeca a arrastar o grupo de uma pasta pelo nome dela.
 *
 * Vai junto tudo que o fundo envolve agora: as telas do layout e as movidas a
 * mao que estao encostadas nelas. A origem do bloco e a guardada, ou — se o
 * bloco ainda estava na prateleira — o canto do fundo em volta das telas do
 * layout, que e onde `arrangeGroup` as pos.
 *
 * @param {string} folder
 * @returns {GroupDrag | null}
 */
export function beginGroupDrag(folder) {
  const group = folderGroup(folder);
  if (group.length === 0) return null;
  const flowing = group.filter((screen) => !screen.pinned);
  const saved = folders.origins[folder];
  const origin = saved ? { ...saved } : flowing.length > 0 ? zoneRect(flowing) : null;
  return {
    folder,
    origin: origin ? { x: origin.x, y: origin.y } : null,
    items: group.map((screen) => ({ screen, x: screen.x, y: screen.y })),
    dx: 0,
    dy: 0,
  };
}

/**
 * Um passo do arrasto do grupo. Nao roda o layout: os outros blocos tremeriam
 * embaixo do cursor. As telas so andam juntas, e o layout acontece no fim.
 * @param {GroupDrag} drag
 * @param {number} dx deslocamento desde o comeco, em px de canvas
 * @param {number} dy
 */
export function dragGroup(drag, dx, dy) {
  if (ui.snapToGrid) {
    const ref = drag.origin ?? drag.items[0];
    dx = snapToGrid(ref.x + dx, GRID_SIZE) - ref.x;
    dy = snapToGrid(ref.y + dy, GRID_SIZE) - ref.y;
  }
  drag.dx = Math.round(dx);
  drag.dy = Math.round(dy);
  for (const item of drag.items) place(item.screen, item.x + drag.dx, item.y + drag.dy);
  refreshOverlaps();
}

/**
 * Fim do arrasto do grupo: a origem nova vira a do bloco, o layout reacomoda
 * o resto do board em volta e a organizacao e gravada.
 * @param {GroupDrag} drag
 */
export function endGroupDrag(drag) {
  if (drag.dx === 0 && drag.dy === 0) return;
  if (drag.origin) {
    setGroupOrigin(drag.folder, { x: drag.origin.x + drag.dx, y: drag.origin.y + drag.dy });
  }
  layout();
  persistPositions();
}

/**
 * Traz todas as telas da pasta de volta ao grupo, arrumadas pelo layout: nenhuma
 * fica fixa onde o usuario a deixou, e a posicao salva delas e esquecida.
 *
 * Se o bloco ainda nao tinha origem, ele ganha uma no canto do fundo atual — o
 * grupo se reorganiza onde esta, em vez de saltar para a prateleira.
 *
 * @param {string} folder
 */
export function regroupFolder(folder) {
  const members = [...screens.values()].filter((screen) => folderOf(screen.file) === folder);
  if (members.length === 0) return;

  if (!folders.origins[folder]) {
    const box = zoneRect(folderGroup(folder, members));
    setGroupOrigin(folder, { x: box.x, y: box.y });
  }

  const positions = loadPositions();
  for (const screen of members) {
    screen.pinned = false;
    screen.autoPinned = false;
    delete positions[screen.file];
  }
  savePositions(positions);
  layout();
  persistPositions();
}

/**
 * Arruma as telas de uma pasta em colunas (`⌈√n⌉`), relativas ao canto do
 * bloco. Pasta de verdade reserva a folga e a faixa do nome do fundo; a raiz,
 * sem fundo, nao reserva nada — um board sem pastas sai igual ao de sempre.
 *
 * @param {string} folder
 * @param {import('./state.js').Screen[]} members
 * @returns {{ width: number, height: number,
 *   items: Array<{ screen: import('./state.js').Screen, x: number, y: number }> }}
 */
function arrangeGroup(folder, members) {
  const pad = folder ? FOLDER_ZONE_PAD : 0;
  const top = folder ? FOLDER_ZONE_PAD + FOLDER_ZONE_LABEL : 0;
  const columns = assignColumns(
    members.map((screen) => CARD_TITLE_HEIGHT + screen.frameHeight + GAP),
    Math.ceil(Math.sqrt(members.length)),
  );

  /** @type {Array<{ screen: import('./state.js').Screen, x: number, y: number }>} */
  const items = [];
  let x = pad;
  let bottom = top;
  for (const column of columns) {
    if (column.length === 0) continue;
    let columnWidth = MIN_FRAME_WIDTH;
    for (const index of column) columnWidth = Math.max(columnWidth, members[index].frameWidth);

    let y = top;
    for (const index of column) {
      const screen = members[index];
      items.push({ screen, x, y });
      y += CARD_TITLE_HEIGHT + screen.frameHeight;
      bottom = Math.max(bottom, y);
      y += GAP;
    }
    x += columnWidth + GAP;
  }
  return { width: x - GAP + pad, height: bottom + pad, items };
}

/**
 * Desfaz as sobreposicoes que sobraram, descendo quem esta por baixo.
 *
 * Usado pelo gesto de tamanho global: depois de o `layout()` acomodar as telas
 * que escorrem, o que ainda pode colidir sao duas telas que o *usuario* colocou
 * onde estao e que cresceram uma dentro da outra. Ele mirou aqueles pontos, mas
 * nao mirou a colisao — deixar as duas vermelhas custaria tambem o tamanho
 * delas, que `persistPositions` nao grava em tela sobreposta.
 *
 * Nao vale para o arrasto a mao: largar uma tela em cima de outra continua sendo
 * uma posicao invalida do usuario, marcada e nao gravada.
 *
 * @returns {boolean} true quando alguma tela precisou descer
 */
export function separateCollisions() {
  const moved = separateOverlaps(
    [...screens.values()].map((screen) => ({ file: screen.file, ...screenRect(screen) })),
    GAP,
  );

  for (const [file, y] of moved) {
    const screen = screens.get(file);
    if (screen) place(screen, screen.x, y);
  }
  refreshOverlaps();
  return moved.size > 0;
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
  // O usuario mirou este ponto: a tela deixa de ser do gesto global e nao volta
  // a escorrer no proximo.
  screen.autoPinned = false;
  // E e ela que segura o fundo da pasta quando nenhuma outra e do layout.
  markLastMoved(file);
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
  // Idem `moveScreen`: o tamanho escolhido a mao e do usuario. `applyGlobalSize`
  // passa por aqui no laco dele e remarca depois o que for dele.
  screen.autoPinned = false;
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
  clearGroupOrigins();
  clearHistory();
  for (const screen of screens.values()) {
    screen.pinned = false;
    screen.autoPinned = false;
  }
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
  const blockers = pinned.map(screenRect);

  const arranged = groupByFolder(flowing).map(([folder, members]) => ({
    folder, ...arrangeGroup(folder, members),
  }));

  // Bloco que o usuario pos num lugar (arrastando pelo nome da pasta) fica la,
  // e vira obstaculo para os da prateleira, como uma tela fixa.
  const blocks = [];
  for (const block of arranged) {
    const origin = block.folder ? folders.origins[block.folder] : undefined;
    if (!origin) {
      blocks.push(block);
      continue;
    }
    for (const item of block.items) place(item.screen, origin.x + item.x, origin.y + item.y);
    blockers.push({ x: origin.x, y: origin.y, width: block.width, height: block.height });
  }
  blockers.sort((a, b) => a.y - b.y);
  const limit = shelfWidth(blocks, GAP);

  // Prateleiras: um bloco por pasta, da esquerda para a direita, quebrando a
  // linha no limite. A linha seguinte comeca abaixo do que a anterior de fato
  // ocupou — um bloco pode ter descido para desviar de uma tela fixa.
  let x = 0;
  let rowTop = 0;
  let rowBottom = 0;
  for (const block of blocks) {
    if (x > 0 && x + block.width > limit) {
      x = 0;
      rowTop = rowBottom + GAP;
    }
    rowBottom = Math.max(rowBottom, placeBlock(block, x, rowTop, blockers));
    x += block.width + GAP;
  }

  refreshOverlaps();
}

/**
 * Poe um bloco de pasta no canvas, desviando das telas fixas.
 *
 * Pasta de verdade desce **inteira**, para o fundo continuar envolvendo um
 * grupo so. A raiz desce tela a tela, como o layout sempre fez: e o caso de um
 * board sem pastas, e ele continua igual.
 *
 * @param {ReturnType<typeof arrangeGroup> & { folder: string }} block
 * @param {number} x
 * @param {number} y
 * @param {import('./utils.js').Rect[]} blockers
 * @returns {number} o `y` mais baixo que o bloco ocupou
 */
function placeBlock(block, x, y, blockers) {
  let bottom = y;
  if (block.folder) {
    const top = belowPinned({ x, y, width: block.width, height: block.height }, blockers);
    for (const item of block.items) place(item.screen, x + item.x, top + item.y);
    return top + block.height;
  }

  /** @type {Map<number, number>} quanto cada coluna ja desceu para desviar */
  const pushed = new Map();
  for (const item of block.items) {
    const offset = pushed.get(item.x) ?? 0;
    const target = y + item.y + offset;
    const free = belowPinned({ ...screenRect(item.screen), x: x + item.x, y: target }, blockers);
    pushed.set(item.x, offset + free - target);
    place(item.screen, x + item.x, free);
    bottom = Math.max(bottom, free + CARD_TITLE_HEIGHT + item.screen.frameHeight);
  }
  return bottom;
}
