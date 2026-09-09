// @ts-check
// Modo ponteiro: destaca o elemento sob o cursor dentro do prototipo e copia o
// XPath dele.
//
// Tudo aqui depende de mesma origem — os prototipos sao servidos pelo mesmo
// localhost, entao da para ler o documento do iframe. Cada acesso mesmo assim
// fica em try/catch: o iframe pode estar trocando de `src` no meio do gesto.

import { ensureFloating } from './dom.js';
import {
  commentQueue, notifyQueueChange, onQueueChange, screens, ui, view,
} from './state.js';
import { clamp, computeXPath, resolveXPath } from './utils.js';
import { copyText, showToast } from './feedback.js';

/** @typedef {import('./state.js').CommentItem} CommentItem */

/** @typedef {import('./state.js').Screen} Screen */

// Injetado dentro de cada iframe. Os elementos "de fora" do foco recebem
// .pina-dim (blur leve); o alvo recebe .pina-focus (contorno azul).
const INSPECT_CSS =
  '.pina-dim{filter:blur(1.5px)!important;transition:filter .12s ease;}'
  + '.pina-focus{outline:2px solid #6ea8fe!important;outline-offset:1px!important;}';

const INSPECT_STYLE_ID = 'pina-inspect-style';

// Classes do proprio board, ignoradas ao descrever o elemento para o usuario.
const OWN_CLASSES = new Set(['pina-dim', 'pina-focus']);

/**
 * Estado do destaque.
 *
 * `base` e o elemento exato mais fundo sob o cursor. `level` sobe pela cadeia de
 * ancestrais (scroll do mouse) e `target` e o resultado: a base subida `level`
 * niveis. Como `<div>` tambem serve a layout, fixar a granularidade num nivel so
 * seria imprevisivel — por isso o nivel e ajustavel.
 *
 * @type {{ screen: Screen | null, base: Element | null, target: Element | null, level: number }}
 */
const hover = { screen: null, base: null, target: null, level: 0 };

/** Ha um card sob o cursor com destaque ativo? O scroll do board consulta isto. */
export function hasHoverTarget() {
  return hover.screen !== null;
}

/**
 * Reinjeta o estilo do destaque. Chamado a cada `load` do iframe, porque o
 * `<style>` some junto com o documento anterior.
 * @param {Document | null | undefined} doc
 */
export function injectInspectStyle(doc) {
  try {
    if (!doc || doc.getElementById(INSPECT_STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = INSPECT_STYLE_ID;
    style.textContent = INSPECT_CSS;
    (doc.head || doc.documentElement).appendChild(style);
  } catch {
    // Iframe ainda sem documento: ignora, a proxima carga reinjeta.
  }
}

/**
 * Elemento sob o cursor, dentro do iframe.
 *
 * As coordenadas do board estao escaladas por `view.scale`, entao sao divididas
 * de volta ao espaco interno do iframe antes do `elementFromPoint`.
 *
 * @param {Screen} screen
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{ doc: Document, el: Element } | null}
 */
function elementUnderCursor(screen, clientX, clientY) {
  try {
    const doc = screen.iframe.contentDocument;
    if (!doc) return null;
    const rect = screen.iframe.getBoundingClientRect();
    const x = (clientX - rect.left) / view.scale;
    const y = (clientY - rect.top) / view.scale;
    const el = doc.elementFromPoint(x, y);
    return el ? { doc, el } : null;
  } catch {
    return null;
  }
}

/** Tira o destaque do iframe e zera o estado. */
export function clearHoverHighlight() {
  if (hover.screen) {
    try {
      hover.screen.iframe.contentDocument
        ?.querySelectorAll('.pina-dim, .pina-focus')
        .forEach((el) => el.classList.remove('pina-dim', 'pina-focus'));
    } catch { /* iframe trocou de src no meio: nada a limpar */ }
  }
  hover.screen = null;
  hover.base = null;
  hover.target = null;
  hover.level = 0;
  hideInspectTip();
}

/**
 * Quantos ancestrais existem entre a base e o `<body>` — teto do nivel.
 * @param {Element} base
 * @returns {number}
 */
function maxLevelFor(base) {
  let count = 0;
  let node = base;
  while (node.parentElement && node.nodeName !== 'BODY') {
    node = node.parentElement;
    count += 1;
  }
  return count;
}

/**
 * Alvo = base subindo `level` ancestrais, sem passar do `<body>`.
 * @param {Element} base
 * @param {number} level
 * @returns {Element}
 */
function targetFromBase(base, level) {
  let node = base;
  for (let i = 0; i < level && node.parentElement && node.nodeName !== 'BODY'; i += 1) {
    node = node.parentElement;
  }
  return node;
}

/**
 * Escurece tudo que nao esta no ramo do alvo: para cada ancestral, os irmaos
 * fora do caminho ganham `.pina-dim`. O alvo e seus filhos ficam nitidos.
 * @param {Document} doc
 * @param {Element} el
 */
function dimOthers(doc, el) {
  const root = doc.documentElement;
  let node = el;
  while (node && node.parentElement) {
    const parent = node.parentElement;
    for (const child of parent.children) {
      if (child === node) continue;
      if (child.nodeName === 'STYLE' || child.nodeName === 'SCRIPT') continue;
      child.classList.add('pina-dim');
    }
    if (parent === root) break;
    node = parent;
  }
}

/**
 * (Re)aplica o destaque para o nivel atual e move o tooltip para o cursor.
 * @param {Document} doc
 * @param {number} clientX
 * @param {number} clientY
 */
function applyHover(doc, clientX, clientY) {
  if (!hover.base) return;

  try {
    doc.querySelectorAll('.pina-dim, .pina-focus')
      .forEach((el) => el.classList.remove('pina-dim', 'pina-focus'));
  } catch { /* iframe trocou de src: nada a limpar */ }

  const target = targetFromBase(hover.base, hover.level);
  dimOthers(doc, target);
  target.classList.add('pina-focus');
  hover.target = target;
  showInspectTip(target, clientX, clientY);
}

/**
 * Movimento do mouse sobre o escudo de um card.
 * @param {string} file
 * @param {PointerEvent} event
 */
export function onInspectMove(file, event) {
  if (ui.mode !== 'pointer') return;

  const screen = screens.get(file);
  if (!screen) return;

  const found = elementUnderCursor(screen, event.clientX, event.clientY);
  if (!found) {
    clearHoverHighlight();
    return;
  }

  // Mesma base: so acompanha o cursor com o tooltip, mantendo o nivel de scroll.
  if (found.el === hover.base && screen === hover.screen) {
    showInspectTip(hover.target, event.clientX, event.clientY);
    return;
  }

  // Base nova: reinicia no elemento exato (nivel 0).
  clearHoverHighlight();
  injectInspectStyle(found.doc);
  hover.screen = screen;
  hover.base = found.el;
  hover.level = 0;
  applyHover(found.doc, event.clientX, event.clientY);
}

/**
 * Scroll do mouse no modo ponteiro: +1 sobe um ancestral, -1 volta pro filho.
 * @param {1 | -1} delta
 * @param {number} clientX
 * @param {number} clientY
 */
export function adjustInspectLevel(delta, clientX, clientY) {
  if (!hover.screen || !hover.base) return;
  const doc = hover.screen.iframe.contentDocument;
  if (!doc) return;

  hover.level = clamp(hover.level + delta, 0, maxLevelFor(hover.base));
  applyHover(doc, clientX, clientY);
}

/**
 * Ctrl+Alt+clique: copia o XPath do elemento sob o cursor, para apontar ao
 * agente de IA exatamente qual pedaco da tela deve mudar. Alt sozinho, em vez
 * disso, abre a caixinha de comentario (veja `openCommentBoxAt`) — quem decide
 * qual dos dois gestos chamar e quem despacha o clique, em `controls.js` e
 * `cards.js`.
 * @param {string} file
 * @param {MouseEvent} event
 */
export function copyXPathAt(file, event) {
  const screen = screens.get(file);
  if (!screen) return;

  const found = elementUnderCursor(screen, event.clientX, event.clientY);
  if (!found) return;

  const xpath = computeXPath(found.el);
  copyText(xpath);
  showToast(`XPath copiado — ${xpath}`);
}

/* ---------- Fila de comentarios ---------- */
//
// Cada item mora em `commentQueue` (state.js), chaveado por arquivo e XPath.
// Este modulo e o unico que muta a fila diretamente: quem quiser redesenhar a
// partir dela (aqui e em `chat.js`) se inscreve em `onQueueChange`.
//
// A caixinha aberta e estado de apresentacao, nao de dado — um item
// `confirmed` reclicado reabre a caixinha sem mudar de status (o ciclo de vida
// completo esta documentado no `design.md` da mudanca). Por isso quem esta
// aberto agora vive fora do `CommentItem`, neste `Set` local.

/** @type {Set<string>} chave = `${file} ${xpath}` */
const openBoxKeys = new Set();

/** @param {string} file @param {string} xpath */
const boxKey = (file, xpath) => `${file} ${xpath}`;

/**
 * Posicao do elemento em coordenadas internas do iframe — o mesmo espaco que
 * `frame.style` usa, entao o balao/caixinha fica correto sob pan/zoom sem
 * recalculo (veja o `@property anchorPoint` em `state.js`).
 * @param {Element} el
 * @returns {{ x: number, y: number }}
 */
function anchorFor(el) {
  const rect = el.getBoundingClientRect();
  return { x: rect.left, y: rect.top };
}

/**
 * Clique simples em modo ponteiro: abre a caixinha de comentario multi-linha
 * para o no sob o cursor. Reclicar um no que ja tem item na fila reabre a
 * caixinha pre-preenchida, editando o mesmo item em vez de criar outro.
 * @param {string} file
 * @param {MouseEvent | PointerEvent} event
 */
export function openCommentBoxAt(file, event) {
  const screen = screens.get(file);
  if (!screen) return;

  const found = elementUnderCursor(screen, event.clientX, event.clientY);
  if (!found) return;

  const xpath = computeXPath(found.el);
  const anchorPoint = anchorFor(found.el);

  let items = commentQueue.get(file);
  if (!items) {
    items = new Map();
    commentQueue.set(file, items);
  }

  const existing = items.get(xpath);
  if (existing) {
    existing.anchorPoint = anchorPoint;
  } else {
    /** @type {CommentItem} */
    const item = { xpath, text: '', status: 'draft', anchorPoint };
    items.set(xpath, item);
  }

  openBoxKeys.add(boxKey(file, xpath));
  notifyQueueChange();
}

/**
 * Enter (sem Shift) dentro da caixinha: confirma o item (`draft` -> `confirmed`,
 * ou permanece `confirmed` se ja era) e fecha a caixinha, mostrando o balao.
 * @param {string} file
 * @param {string} xpath
 */
function confirmCommentItem(file, xpath) {
  const item = commentQueue.get(file)?.get(xpath);
  if (!item) return;

  item.status = 'confirmed';
  openBoxKeys.delete(boxKey(file, xpath));
  notifyQueueChange();
}

/**
 * Remove um item da fila — balao no board e linha na lista "a enviar" do chat,
 * nos dois lugares de onde o botao "x" pode chamar isto. Ignorado enquanto o
 * item estiver `sending`: a fila trancada nao aceita remocao.
 * @param {string} file
 * @param {string} xpath
 */
export function removeCommentItem(file, xpath) {
  const items = commentQueue.get(file);
  const item = items?.get(xpath);
  if (!items || !item || item.status === 'sending') return;

  items.delete(xpath);
  if (items.size === 0) commentQueue.delete(file);
  openBoxKeys.delete(boxKey(file, xpath));
  notifyQueueChange();
}

/**
 * Reancoragem apos o iframe recarregar: para cada item da fila daquele
 * arquivo, tenta achar o XPath salvo no documento novo. Achou, atualiza a
 * ancora (e sai de `unreferenced` se estava); nao achou, vira `unreferenced`
 * — some do board e aparece na bandeja de pendentes.
 * @param {string} file
 * @param {Document | null | undefined} doc
 */
export function tryReanchor(file, doc) {
  const items = commentQueue.get(file);
  if (!items || !doc) return;

  for (const item of items.values()) {
    // Trancado por um envio em andamento: nao mexe, o turno decide o destino.
    if (item.status === 'sending') continue;

    const el = resolveXPath(doc, item.xpath);
    if (el) {
      item.anchorPoint = anchorFor(el);
      if (item.status === 'unreferenced') item.status = 'confirmed';
    } else {
      item.status = 'unreferenced';
      openBoxKeys.delete(boxKey(file, item.xpath));
    }
  }

  notifyQueueChange();
}

/**
 * Arrasto de um item sem referencia da bandeja ate um no valido: recalcula o
 * XPath a partir do alvo largado e move o item de volta a `confirmed`. Se ja
 * existir outro item no mesmo alvo (mesmo arquivo e XPath), o arrasto e
 * ignorado — nao ha como reancorar sem sobrescrever o item que ja estava la.
 * @param {string} fromFile
 * @param {string} fromXPath
 * @param {string} toFile
 * @param {Element} toEl
 */
function reanchorUnreferencedItem(fromFile, fromXPath, toFile, toEl) {
  const items = commentQueue.get(fromFile);
  const item = items?.get(fromXPath);
  if (!items || !item) return;

  const newXPath = computeXPath(toEl);
  const targetItems = commentQueue.get(toFile);
  if (targetItems?.has(newXPath) && !(fromFile === toFile && fromXPath === newXPath)) return;

  items.delete(fromXPath);
  if (items.size === 0) commentQueue.delete(fromFile);

  let destination = commentQueue.get(toFile);
  if (!destination) {
    destination = new Map();
    commentQueue.set(toFile, destination);
  }

  item.xpath = newXPath;
  item.status = 'confirmed';
  item.anchorPoint = anchorFor(toEl);
  destination.set(newXPath, item);

  notifyQueueChange();
}

/**
 * Camada dos baloes/caixinhas de uma tela, criada sob demanda dentro do
 * `card` — nao do `frame` — assim ela herda o `transform` do canvas de graca
 * (como o escudo), mas escapa do `overflow: hidden` do `.card-frame`, que
 * cortava balao/caixinha perto da borda da tela. O CSS compensa o offset do
 * titulo para o layer continuar alinhado ao topo do frame (veja
 * `.pina-queue-layer` em board.css).
 * @param {Screen} screen
 * @returns {HTMLElement}
 */
function ensureQueueLayer(screen) {
  let layer = /** @type {HTMLElement | null} */ (screen.card.querySelector(':scope > .pina-queue-layer'));
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'pina-queue-layer';
    screen.card.append(layer);
  }
  return layer;
}

/**
 * Badge "x" reaproveitado pelo balao, pela caixinha e pela bandeja de itens
 * sem referencia.
 * @param {() => void} onRemove
 * @returns {HTMLButtonElement}
 */
function makeRemoveBadge(onRemove) {
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'pina-comment-remove';
  badge.title = 'Remover comentario';
  badge.textContent = '×';
  // Sem isto o pointerdown do badge chegaria ao board por baixo (pan/drag).
  badge.addEventListener('pointerdown', (event) => event.stopPropagation());
  badge.addEventListener('click', (event) => {
    event.stopPropagation();
    onRemove();
  });
  return badge;
}

/**
 * A caixinha multi-linha: Enter confirma, Shift+Enter quebra linha, digitar
 * atualiza o texto do item ao vivo (a lista "a enviar" do chat acompanha).
 * @param {string} file
 * @param {CommentItem} item
 * @returns {HTMLElement}
 */
function buildCommentBox(file, item) {
  const box = document.createElement('div');
  box.className = 'pina-comment-box';
  box.style.left = `${item.anchorPoint?.x ?? 0}px`;
  box.style.top = `${item.anchorPoint?.y ?? 0}px`;
  // O board (escudo por baixo) nao deve iniciar pan/gesto por cima da caixinha.
  box.addEventListener('pointerdown', (event) => event.stopPropagation());

  const textarea = document.createElement('textarea');
  textarea.className = 'pina-comment-input';
  textarea.placeholder = 'Comentario para a IA...';
  textarea.value = item.text;
  textarea.addEventListener('input', () => {
    item.text = textarea.value;
    notifyQueueChange();
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    confirmCommentItem(file, item.xpath);
  });

  box.append(textarea, makeRemoveBadge(() => removeCommentItem(file, item.xpath)));
  // A caixinha acabou de abrir: o usuario ja quer digitar. `setTimeout(0)` em
  // vez de focar direto porque o elemento ainda nao esta no DOM neste ponto —
  // quem chama `buildCommentBox` so anexa o resultado depois.
  setTimeout(() => textarea.focus(), 0);
  return box;
}

/**
 * O balao: resumo do comentario ancorado no no, clicavel para reabrir a
 * caixinha (menos em `sending`, quando mostra estado de carregamento).
 * @param {string} file
 * @param {CommentItem} item
 * @returns {HTMLElement}
 */
function buildBalloon(file, item) {
  const balloon = document.createElement('div');
  balloon.className = 'pina-comment-balloon';
  balloon.style.left = `${item.anchorPoint?.x ?? 0}px`;
  balloon.style.top = `${item.anchorPoint?.y ?? 0}px`;

  const summary = document.createElement('span');
  summary.className = 'pina-comment-summary';
  summary.textContent = item.text.length > 60 ? `${item.text.slice(0, 60)}…` : item.text;
  balloon.append(summary);

  if (item.status === 'sending') {
    balloon.classList.add('is-sending');
    balloon.append(Object.assign(document.createElement('span'), { className: 'pina-comment-spinner' }));
    return balloon;
  }

  balloon.addEventListener('pointerdown', (event) => event.stopPropagation());
  balloon.addEventListener('click', (event) => {
    event.stopPropagation();
    openBoxKeys.add(boxKey(file, item.xpath));
    notifyQueueChange();
  });
  balloon.append(makeRemoveBadge(() => removeCommentItem(file, item.xpath)));
  return balloon;
}

/**
 * Redesenha baloes e caixinhas de uma tela a partir da fila. Itens
 * `unreferenced` ficam de fora — eles vao para a bandeja
 * (`renderUnreferencedTray`), nao pro card.
 * @param {string} file
 */
function renderQueueForFile(file) {
  const screen = screens.get(file);
  if (!screen) return;

  const layer = ensureQueueLayer(screen);
  layer.replaceChildren();

  const items = commentQueue.get(file);
  if (!items) return;

  for (const item of items.values()) {
    if (item.status === 'unreferenced' || !item.anchorPoint) continue;

    const boxOpen = item.status !== 'sending' && openBoxKeys.has(boxKey(file, item.xpath));
    layer.append(boxOpen ? buildCommentBox(file, item) : buildBalloon(file, item));
  }
}

/**
 * Uma linha da bandeja de pendentes de reancoragem.
 * @param {string} file
 * @param {CommentItem} item
 * @returns {HTMLElement}
 */
function buildTrayEntry(file, item) {
  const entry = document.createElement('div');
  entry.className = 'pina-tray-entry';
  entry.title = 'Arraste ate um no do prototipo para reancorar';

  const label = document.createElement('span');
  label.className = 'pina-tray-label';
  label.textContent = `${file} — ${item.text || item.xpath}`;
  entry.append(label);

  entry.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    startUnreferencedDrag(file, item.xpath, event.pointerId);
  });

  entry.append(makeRemoveBadge(() => removeCommentItem(file, item.xpath)));
  return entry;
}

/**
 * Bandeja fixa (canto do board) com todo item `unreferenced`, de qualquer
 * tela. Fica oculta (`hidden`) enquanto nao houver nenhum.
 */
function renderUnreferencedTray() {
  const tray = ensureFloating('pina-unreferenced-tray', 'pina-unreferenced-tray');
  tray.replaceChildren();

  let count = 0;
  for (const [file, items] of commentQueue) {
    for (const item of items.values()) {
      if (item.status !== 'unreferenced') continue;
      count += 1;
      tray.append(buildTrayEntry(file, item));
    }
  }

  tray.hidden = count === 0;
}

/**
 * Arrasto em andamento da bandeja de itens sem referencia ate um no do
 * prototipo.
 * @param {string} file
 * @param {string} xpath
 * @param {number} pointerId
 */
function startUnreferencedDrag(file, xpath, pointerId) {
  /** @param {PointerEvent} event */
  const onUp = (event) => {
    if (event.pointerId !== pointerId) return;
    window.removeEventListener('pointerup', onUp);

    for (const screen of screens.values()) {
      const found = elementUnderCursor(screen, event.clientX, event.clientY);
      if (found) {
        reanchorUnreferencedItem(file, xpath, screen.file, found.el);
        return;
      }
    }
  };

  window.addEventListener('pointerup', onUp);
}

// Unico ponto que redesenha board e bandeja a partir da fila: cada mutacao
// (aqui e em `chat.js`) so precisa chamar `notifyQueueChange`.
onQueueChange(() => {
  for (const file of screens.keys()) renderQueueForFile(file);
  renderUnreferencedTray();
});

/* ---------- Tooltip ---------- */

/**
 * Descreve o alvo de forma curta: tag + #id ou .classe.
 * @param {Element} el
 * @returns {string}
 */
function describeEl(el) {
  if (el.id) return `${el.nodeName.toLowerCase()}#${el.id}`;

  const cls = [...el.classList].find((name) => !OWN_CLASSES.has(name));
  return cls ? `${el.nodeName.toLowerCase()}.${cls}` : el.nodeName.toLowerCase();
}

/**
 * @param {Element | null} el
 * @param {number} clientX
 * @param {number} clientY
 */
function showInspectTip(el, clientX, clientY) {
  if (!el) return;

  const tip = ensureFloating('inspect-tip', 'inspect-tip');
  tip.textContent = `${describeEl(el)} · scroll: muda o nivel`;
  tip.style.left = `${clientX + 14}px`;
  tip.style.top = `${clientY + 14}px`;
  tip.classList.add('is-visible');
}

function hideInspectTip() {
  document.getElementById('inspect-tip')?.classList.remove('is-visible');
}
