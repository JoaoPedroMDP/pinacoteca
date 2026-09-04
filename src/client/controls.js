// @ts-check
// Entrada do usuario: roda do mouse, arrasto, teclado e toolbar.
//
// Todos os listeners do board estao aqui. Cada um comeca decidindo *de quem e o
// gesto* — do prototipo, do modo ponteiro ou do board — e so entao age.

import { sidebarResizer, toolbar, viewport } from './dom.js';
import { screens, ui, view } from './state.js';
import {
  applyTransform, finishResize, fitToScreen, moveScreen, panBy, persistPositions,
  recordMove, redo, resetPositions, resetZoom, resizeScreen, undo, zoomAt, zoomByStep,
} from './view.js';
import { closeSizeMenu, resetSizes, setInteractive } from './cards.js';
import { adjustInspectLevel, clearHoverHighlight, hasHoverTarget } from './inspect.js';
import { saveSidebarWidth, saveSnapToGrid } from './storage.js';
import { clamp, clampSidebarWidth, resizeZoneAt } from './utils.js';
import {
  PAN_DRAG_THRESHOLD, RESIZE_CURSORS, RESIZE_EDGE_PX,
  SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_CANVAS, SIDEBAR_MIN_WIDTH,
  WHEEL_STEP, WHEEL_ZOOM_DAMPING, ZOOM_STEP,
} from './constants.js';

/**
 * Liga ou desliga o alinhamento a grade no arrasto de tela.
 * @param {boolean} enabled
 */
export function setSnapToGrid(enabled) {
  ui.snapToGrid = enabled;
  saveSnapToGrid(enabled);
  toolbar.querySelector('[data-action="toggle-snap"]')
    ?.setAttribute('aria-pressed', String(enabled));
}

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
 * A alca de arrasto de uma tela e o titulo dela — menos o botao de tamanho e o
 * menu dele, que sao para clicar, nao para arrastar.
 * @param {Event} event
 * @returns {string | null} o arquivo da tela, ou null se o gesto nasceu fora
 */
function draggedFile(event) {
  const target = /** @type {Element | null} */ (event.target);
  if (target?.closest?.('.card-resize-btn, .card-size-menu')) return null;

  const title = target?.closest?.('.card-title');
  return title?.parentElement?.dataset.file ?? null;
}

/**
 * O gesto nasceu numa borda que redimensiona?
 * @param {PointerEvent} event
 * @returns {{ file: string, screen: import('./state.js').Screen,
 *   zone: import('./utils.js').ResizeZone } | null}
 */
function resizeTarget(event) {
  const frame = /** @type {Element | null} */ (event.target)?.closest?.('.card-frame');
  if (!frame) return null;

  const file = /** @type {HTMLElement | null} */ (frame.parentElement)?.dataset.file;
  const screen = file ? screens.get(file) : null;
  if (!file || !screen) return null;

  const zone = resizeZoneAt(
    event.clientX, event.clientY, frame.getBoundingClientRect(), RESIZE_EDGE_PX,
  );
  return zone ? { file, screen, zone } : null;
}

/* ---------- Arrasto: pan do board ---------- */

/** @type {number | null} */
let panPointerId = null;
let panStartX = 0;
let panStartY = 0;
// Onde o pointerdown pegou, em px de tela — para medir o limiar antes de
// decidir se o gesto e um clique ou um arrasto de fato.
let panDownClientX = 0;
let panDownClientY = 0;
// Vira true so quando o gesto passa do limiar. Ate la nao ha captura nem
// classe `is-panning`: um clique ou duplo clique que nao se move nunca chega
// a capturar o ponteiro, entao o click/dblclick vai para o alvo real (o
// escudo), nao para o viewport.
let panStarted = false;

viewport.addEventListener('pointerdown', (event) => {
  // Botao esquerdo ou do meio.
  if (event.button !== 0 && event.button !== 1) return;
  // Alt+clique e captura de XPath, nao pan: deixa o evento chegar ao escudo.
  if (event.altKey) return;
  // No modo ponteiro o arrasto com o esquerdo nao move o board (o do meio move).
  if (ui.mode === 'pointer' && event.button === 0) return;
  if (isInsideInteractiveCard(event)) return;
  // O titulo e a alca de arrasto da tela: ali o gesto move o card, nao o board.
  // Vale o titulo inteiro, inclusive o botao de tamanho — que precisa do clique.
  if (/** @type {Element} */ (event.target).closest?.('.card-title')) return;
  // Nas bordas do frame o gesto redimensiona a tela.
  if (resizeTarget(event)) return;
  // A toolbar fica dentro do viewport: sem isto o setPointerCapture abaixo
  // redirecionaria o clique para o viewport e os botoes nunca disparariam.
  if (/** @type {Element} */ (event.target).closest?.('.toolbar')) return;

  // Sem isto o navegador comeca uma selecao de texto no arrasto, e ela se
  // estende em ordem de DOM: o pan sai grifando os titulos das telas no caminho.
  event.preventDefault();

  panPointerId = event.pointerId;
  panDownClientX = event.clientX;
  panDownClientY = event.clientY;
  panStartX = event.clientX - view.x;
  panStartY = event.clientY - view.y;
  panStarted = false;
});

viewport.addEventListener('pointermove', (event) => {
  if (event.pointerId !== panPointerId) return;

  if (!panStarted) {
    const dx = event.clientX - panDownClientX;
    const dy = event.clientY - panDownClientY;
    if (Math.hypot(dx, dy) < PAN_DRAG_THRESHOLD) return; // ainda pode virar clique
    panStarted = true;
    viewport.classList.add('is-panning');
    viewport.setPointerCapture(event.pointerId);
  }

  view.x = event.clientX - panStartX;
  view.y = event.clientY - panStartY;
  applyTransform();
});

/** @param {PointerEvent} event */
function endPan(event) {
  if (event.pointerId !== panPointerId) return;
  panPointerId = null;
  if (!panStarted) return; // clique: nunca capturou, nada a liberar

  panStarted = false;
  viewport.classList.remove('is-panning');
  try {
    viewport.releasePointerCapture(event.pointerId);
  } catch {
    // Ponteiro sintetico (teste) ou ja liberado: nada a fazer.
  }
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
// Posicao de antes do arrasto: e o que vai para o historico de undo, se o
// gesto de fato mover a tela (largar no mesmo lugar nao empilha nada).
let dragStartX = 0;
let dragStartY = 0;

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
  dragStartX = screen.x;
  dragStartY = screen.y;

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

  const screen = screens.get(dragFile);
  if (screen && (screen.x !== dragStartX || screen.y !== dragStartY)) {
    recordMove(dragFile, dragStartX, dragStartY);
  }

  // Posicao invalida (tela em cima de outra) fica na tela, mas nao e salva.
  persistPositions();

  // Mesmo motivo do pan: captura viva depois do pointerup desvia o click
  // seguinte para o viewport.
  try {
    viewport.releasePointerCapture(event.pointerId);
  } catch {
    // Ponteiro sintetico (teste) ou ja liberado: nada a fazer.
  }
}

viewport.addEventListener('pointerup', endDrag);
viewport.addEventListener('pointercancel', endDrag);

/* ---------- Arrasto das bordas: redimensionar a tela ---------- */

// Estado do gesto em andamento. Segue o padrao do pan, e nao o do titulo: o
// limiar existe porque a borda do frame e justamente onde o usuario tenta o
// duplo clique (liberar a tela) e o Alt+clique (XPath), e capturar o ponteiro
// ja no pointerdown desviaria esses cliques para o viewport.
/** @type {number | null} */
let resizePointerId = null;
let resizeFile = '';
/** @type {import('./utils.js').ResizeZone} */
let resizeZoneKind = 'corner';
let resizeStartWidth = 0;
let resizeStartHeight = 0;
let resizeDownClientX = 0;
let resizeDownClientY = 0;
let resizeStarted = false;

viewport.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.altKey) return;
  if (isInsideInteractiveCard(event)) return;

  const target = resizeTarget(event);
  if (!target) return;

  event.preventDefault();

  resizePointerId = event.pointerId;
  resizeFile = target.file;
  resizeZoneKind = target.zone;
  resizeStartWidth = target.screen.frameWidth;
  resizeStartHeight = target.screen.frameHeight;
  resizeDownClientX = event.clientX;
  resizeDownClientY = event.clientY;
  resizeStarted = false;
});

viewport.addEventListener('pointermove', (event) => {
  if (event.pointerId !== resizePointerId) return;

  // O deslocamento e uma *distancia*: o pan se cancela na subtracao, so a
  // escala precisa ser desfeita para chegar a px de canvas.
  const dx = (event.clientX - resizeDownClientX) / view.scale;
  const dy = (event.clientY - resizeDownClientY) / view.scale;

  if (!resizeStarted) {
    if (Math.hypot(event.clientX - resizeDownClientX, event.clientY - resizeDownClientY)
      < PAN_DRAG_THRESHOLD) return; // ainda pode virar clique
    resizeStarted = true;
    viewport.classList.add('is-resizing');
    viewport.style.cursor = RESIZE_CURSORS[resizeZoneKind];
    try {
      viewport.setPointerCapture(event.pointerId);
    } catch {
      // Ponteiro sintetico (teste): os listeners no viewport dao conta do gesto.
    }
  }

  // A borda de baixo nao mexe na largura, a da direita nao mexe na altura.
  resizeScreen(
    resizeFile,
    resizeZoneKind === 'bottom' ? resizeStartWidth : resizeStartWidth + dx,
    resizeZoneKind === 'right' ? resizeStartHeight : resizeStartHeight + dy,
  );
});

/** Fim do redimensionamento: e aqui que o tamanho vira estado salvo. */
/** @param {PointerEvent} event */
function endResize(event) {
  if (event.pointerId !== resizePointerId) return;

  resizePointerId = null;
  if (!resizeStarted) return; // clique: nunca capturou, nada a fechar

  resizeStarted = false;
  viewport.classList.remove('is-resizing');
  viewport.style.cursor = '';

  // Tamanho invalido (tela esticada por cima de outra) fica na tela, mas nao e salvo.
  finishResize();

  try {
    viewport.releasePointerCapture(event.pointerId);
  } catch {
    // Ponteiro sintetico (teste) ou ja liberado: nada a fazer.
  }
}

viewport.addEventListener('pointerup', endResize);
viewport.addEventListener('pointercancel', endResize);

// Clique no vazio sai do modo de interacao e fecha o menu de tamanho.
viewport.addEventListener('click', (event) => {
  if (ui.interactiveFile && !isInsideInteractiveCard(event)) setInteractive(null);

  const target = /** @type {Element | null} */ (event.target);
  if (ui.openSizeMenuFile && !target?.closest?.('.card-resize-btn, .card-size-menu')) {
    closeSizeMenu();
  }
});

/* ---------- Toolbar ---------- */

toolbar.addEventListener('click', (event) => {
  const action = /** @type {Element} */ (event.target).closest('button')?.getAttribute('data-action');

  if (action === 'zoom-in') zoomByStep(ZOOM_STEP);
  else if (action === 'zoom-out') zoomByStep(1 / ZOOM_STEP);
  else if (action === 'zoom-reset') resetZoom();
  else if (action === 'fit') fitToScreen();
  // "Reorganizar" apaga a organizacao inteira, e tamanho manual faz parte dela.
  else if (action === 'rearrange') { resetSizes(); resetPositions(); }
  else if (action === 'toggle-mode') setMode(ui.mode === 'pointer' ? 'pan' : 'pointer');
  else if (action === 'toggle-snap') setSnapToGrid(!ui.snapToGrid);
});

/* ---------- Teclado ---------- */

// Estado do modo temporario: `Alt` segura o ponteiro, `espaco` segura o pan.
// `heldKey` e a tecla que esta segurando; `modeBeforeHold`, o modo de voltar ao
// solta-la. Uma tecla por vez — segurar a segunda enquanto a primeira esta
// pressionada nao faz nada, senao soltar uma delas restauraria o modo errado.
/** @type {string | null} */
let heldKey = null;
/** @type {'pan' | 'pointer' | null} */
let modeBeforeHold = null;

/**
 * Segura um modo enquanto a tecla estiver pressionada.
 * @param {string} key a tecla que esta segurando, para o keyup saber de quem e
 * @param {'pan' | 'pointer'} mode
 * @returns {boolean} true se o modo passou a ser segurado por esta tecla
 */
function holdMode(key, mode) {
  // Ja segurando (inclusive a repeticao do proprio keydown), ou ja no modo
  // pedido — nos dois casos nao ha o que guardar.
  if (heldKey !== null || ui.mode === mode) return false;
  heldKey = key;
  modeBeforeHold = ui.mode;
  setMode(mode);
  return true;
}

/** Soltar a tecla (ou perder o foco da janela) volta ao modo anterior. */
function releaseHeldMode() {
  if (modeBeforeHold === null) return;
  setMode(modeBeforeHold);
  heldKey = null;
  modeBeforeHold = null;
}

/**
 * Ctrl/Cmd+Z desfaz, Ctrl/Cmd+Shift+Z refaz o ultimo arrasto de tela.
 * @param {KeyboardEvent} event
 * @returns {boolean} true se o atalho foi tratado
 */
function handleHistoryShortcut(event) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return false;
  event.preventDefault(); // senao o navegador tenta desfazer o proprio input
  if (event.shiftKey) redo();
  else undo();
  return true;
}

/**
 * O foco esta num campo que o usuario esta digitando? Espaco (e outros
 * atalhos de uma letra so) tem que virar caractere ali, nao atalho do board.
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

window.addEventListener('keydown', (event) => {
  // Segurar Alt ativa o ponteiro enquanto a tecla estiver pressionada.
  if (event.key === 'Alt') {
    // O preventDefault evita o Alt roubar o foco pro menu do navegador — mas so
    // quando a tecla de fato assumiu o ponteiro.
    if (holdMode('Alt', 'pointer')) event.preventDefault();
    return;
  }

  // Segurar espaco ativa o pan — mas so fora de um campo de texto, senao nunca
  // daria pra digitar espaco no compositor da conversa (ou em qualquer input).
  if (event.key === ' ' && !isTypingTarget(event.target)) {
    // Sempre: espaco rola a pagina e aciona o botao da toolbar que estiver com o
    // foco. Nos dois casos o gesto que o usuario quer e o pan.
    event.preventDefault();
    holdMode(' ', 'pan');
    return;
  }

  if (handleHistoryShortcut(event)) return;

  // Os atalhos abaixo nao disputam com os do navegador.
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === 'Escape') {
    setInteractive(null);
    closeSizeMenu();
  }
  else if (event.key === '0') fitToScreen();
  else if (event.key === '1') resetZoom();
  else if (event.key === '+' || event.key === '=') zoomByStep(ZOOM_STEP);
  else if (event.key === '-') zoomByStep(1 / ZOOM_STEP);
});

window.addEventListener('keyup', (event) => {
  if (event.key === heldKey) releaseHeldMode();
});

// Perder o foco solta a tecla sem disparar keyup: nao deixa preso no modo.
window.addEventListener('blur', releaseHeldMode);

/**
 * Liga o teclado dentro de uma tela liberada para clique.
 *
 * Um iframe focado engole o teclado: enquanto o cursor do usuario esta dentro
 * do prototipo, os listeners de cima nunca disparam. Por isso os atalhos que
 * precisam funcionar *de dentro* sao registrados tambem na janela do iframe —
 * mesma origem, mesmo padrao de `injectInspectStyle`.
 *
 * So dois atalhos, e de proposito: `Alt` segura o ponteiro e `Escape` devolve o
 * controle ao board. Os outros (espaco, `0`, `1`, `+`, `-`) sao caracteres que
 * o usuario pode estar digitando num campo do prototipo — sequestra-los ali
 * quebraria justamente o que o modo interativo existe para permitir.
 *
 * Chamado a cada `load`: o documento novo traz uma `contentWindow` nova, entao
 * nao ha listener duplicado a remover.
 *
 * @param {Window | null} frameWindow
 */
export function bindFrameKeys(frameWindow) {
  try {
    if (!frameWindow) return;

    frameWindow.addEventListener('keydown', (event) => {
      if (event.key === 'Alt') {
        if (holdMode('Alt', 'pointer')) event.preventDefault();
      } else if (event.key === 'Escape') {
        setInteractive(null);
        closeSizeMenu();
      }
    });

    frameWindow.addEventListener('keyup', (event) => {
      if (event.key === heldKey) releaseHeldMode();
    });

    // Sair do iframe (para o board ou para outra janela) solta a tecla sem
    // keyup, do mesmo jeito que o `blur` do board.
    frameWindow.addEventListener('blur', releaseHeldMode);
  } catch {
    // Iframe trocando de `src` no meio: a proxima carga registra de novo.
  }
}


/* ---------- Largura da sidebar ---------- */

const SIDEBAR_LIMITS = {
  min: SIDEBAR_MIN_WIDTH,
  max: SIDEBAR_MAX_WIDTH,
  minCanvas: SIDEBAR_MIN_CANVAS,
};

/**
 * Aplica a largura da sidebar.
 *
 * Guarda em `ui.sidebarWidth` a largura *escolhida* e pinta a *aplicada*: numa
 * janela estreita as duas divergem, porque o board tem piso de espaco. Guardar
 * a aplicada faria a sidebar encolher de vez — ao devolver a janela ao tamanho
 * de antes ela nao voltaria.
 *
 * O valor sai daqui pela variavel CSS que o `#sidebar` ja lia: o layout
 * continua sendo do `board.css`, e este modulo so escolhe o numero.
 *
 * @param {number} width largura pedida, em px
 * @returns {number} a largura que de fato valeu na janela atual
 */
export function setSidebarWidth(width) {
  ui.sidebarWidth = Math.round(clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));

  const applied = clampSidebarWidth(ui.sidebarWidth, window.innerWidth, SIDEBAR_LIMITS);
  document.documentElement.style.setProperty('--sidebar-width', `${applied}px`);
  return applied;
}

// Estado do arrasto do puxador: nasce no pointerdown e morre no pointerup.
/** @type {number | null} */
let sidebarPointerId = null;

sidebarResizer.addEventListener('pointerdown', (event) => {
  // So o botao principal arrasta; o direito abre o menu do navegador.
  if (event.button !== 0) return;

  sidebarPointerId = event.pointerId;
  sidebarResizer.setPointerCapture(event.pointerId);
  sidebarResizer.classList.add('is-dragging');
  // Sem isto o arrasto seleciona o texto da sidebar junto.
  event.preventDefault();
});

sidebarResizer.addEventListener('pointermove', (event) => {
  if (event.pointerId !== sidebarPointerId) return;
  // A sidebar comeca na borda esquerda da janela, entao o X do ponteiro *e* a
  // largura pedida — nao ha origem do gesto a guardar.
  setSidebarWidth(event.clientX);
});

/** @param {PointerEvent} event */
function endSidebarDrag(event) {
  if (event.pointerId !== sidebarPointerId) return;

  sidebarPointerId = null;
  sidebarResizer.classList.remove('is-dragging');
  // So grava no fim: um `setItem` por pointermove seria escrita a toa.
  saveSidebarWidth(ui.sidebarWidth);
}

sidebarResizer.addEventListener('pointerup', endSidebarDrag);
sidebarResizer.addEventListener('pointercancel', endSidebarDrag);

// Janela encolhida com a sidebar larga deixaria o board sem espaco: revalida a
// largura contra a janela nova, sem gravar — o valor salvo continua sendo o que
// o usuario escolheu, e volta quando a janela crescer de novo.
window.addEventListener('resize', () => {
  if (ui.sidebarWidth > 0) setSidebarWidth(ui.sidebarWidth);
});
