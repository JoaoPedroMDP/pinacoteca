// @ts-check
// Modo ponteiro: destaca o elemento sob o cursor dentro do prototipo e copia o
// XPath dele.
//
// Tudo aqui depende de mesma origem — os prototipos sao servidos pelo mesmo
// localhost, entao da para ler o documento do iframe. Cada acesso mesmo assim
// fica em try/catch: o iframe pode estar trocando de `src` no meio do gesto.

import { ensureFloating } from './dom.js';
import {
  commentQueue, commentRailSide, notifyQueueChange, onQueueChange, screens, ui, view,
} from './state.js';
import { clamp, computeXPath, rectsOverlap, resolveXPath } from './utils.js';
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

/**
 * A caixinha que **ja esta na tela**, pela mesma chave de `openBoxKeys`.
 *
 * Digitar nela muta o item e chama `notifyQueueChange`, entao o redesenho
 * acontece a cada tecla. Remontar o `<textarea>` nesse redesenho cancelava a
 * composicao do navegador — tecla morta de acento (`´` + `a`) nunca fechava em
 * `á`, e o cursor voltava para o fim. Por isso o no da caixinha aberta
 * sobrevive ao redesenho: ele e reaproveitado e nunca sai do DOM (sair
 * significa perder o foco e a composicao junto).
 *
 * @type {Map<string, HTMLElement>}
 */
const mountedBoxes = new Map();

/** @param {string} file @param {string} xpath */
const boxKey = (file, xpath) => `${file} ${xpath}`;

/**
 * O no do prototipo de cada item, pela mesma chave de `openBoxKeys`. E so
 * cache: a verdade e o XPath, e `anchoredElement` resolve de novo quando o no
 * guardado ficou para tras (iframe recarregou, no saiu do documento).
 * @type {Map<string, Element>}
 */
const anchoredEls = new Map();

/**
 * O elemento vivo de um item — e dele que a linha mede a posicao a cada
 * desenho, para acompanhar o scroll interno do prototipo.
 * @param {string} file
 * @param {CommentItem} item
 * @returns {Element | null}
 */
function anchoredElement(file, item) {
  const key = boxKey(file, item.xpath);
  try {
    const doc = screens.get(file)?.iframe.contentDocument;
    if (!doc) return null;

    const cached = anchoredEls.get(key);
    if (cached?.isConnected && cached.ownerDocument === doc) return cached;

    const el = resolveXPath(doc, item.xpath);
    if (el) anchoredEls.set(key, el);
    else anchoredEls.delete(key);
    return el;
  } catch {
    // Iframe trocando de `src` no meio: sem elemento ate o proximo `load`.
    return null;
  }
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

  let items = commentQueue.get(file);
  if (!items) {
    items = new Map();
    commentQueue.set(file, items);
  }

  if (!items.has(xpath)) {
    /** @type {CommentItem} */
    const item = { xpath, text: '', status: 'draft' };
    items.set(xpath, item);
  }

  anchoredEls.set(boxKey(file, xpath), found.el);
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
  anchoredEls.delete(boxKey(file, xpath));
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

    const key = boxKey(file, item.xpath);
    const el = resolveXPath(doc, item.xpath);
    if (el) {
      anchoredEls.set(key, el);
      if (item.status === 'unreferenced') item.status = 'confirmed';
    } else {
      item.status = 'unreferenced';
      openBoxKeys.delete(key);
      anchoredEls.delete(key);
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
  anchoredEls.delete(boxKey(fromFile, fromXPath));

  let destination = commentQueue.get(toFile);
  if (!destination) {
    destination = new Map();
    commentQueue.set(toFile, destination);
  }

  item.xpath = newXPath;
  item.status = 'confirmed';
  anchoredEls.set(boxKey(toFile, newXPath), toEl);
  destination.set(newXPath, item);

  notifyQueueChange();
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Camada dos comentarios de uma tela, criada sob demanda dentro do `card` —
 * nao do `frame` — assim ela herda o `transform` do canvas de graca (como o
 * escudo), mas escapa do `overflow: hidden` do `.card-frame`, que cortaria a
 * coluna ao lado da tela. O CSS compensa o offset do titulo para o layer
 * continuar alinhado ao topo do frame (veja `.pina-queue-layer` em board.css),
 * e e por isso que coordenada do layer e coordenada interna do iframe sao o
 * mesmo espaco.
 *
 * Dentro dela: o `<svg>` das linhas, cobrindo o frame, e a coluna com baloes e
 * caixinhas empilhados, ao lado dele.
 * @param {Screen} screen
 * @returns {{ layer: HTMLElement, links: SVGSVGElement, rail: HTMLElement }}
 */
function ensureQueueLayer(screen) {
  let layer = /** @type {HTMLElement | null} */ (screen.card.querySelector(':scope > .pina-queue-layer'));
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'pina-queue-layer';

    const links = document.createElementNS(SVG_NS, 'svg');
    links.classList.add('pina-comment-links');

    const rail = document.createElement('div');
    rail.className = 'pina-comment-rail';
    // A roda sobre uma coluna que rola e da coluna; sem rolagem, segue para o
    // board (zoom/pan) como em qualquer outro ponto.
    rail.addEventListener('wheel', (event) => {
      if (rail.scrollHeight > rail.clientHeight) event.stopPropagation();
    });
    rail.addEventListener('scroll', () => scheduleCommentLinks(screen.file));

    layer.append(links, rail);
    screen.card.append(layer);
  }
  return {
    layer,
    links: /** @type {SVGSVGElement} */ (layer.querySelector(':scope > .pina-comment-links')),
    rail: /** @type {HTMLElement} */ (layer.querySelector(':scope > .pina-comment-rail')),
  };
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
 * Rola a coluna o minimo para o no ficar inteiro a vista. Nao e
 * `scrollIntoView`: ele tambem rolaria o `#viewport` (que tem
 * `overflow: hidden`, mas rola por script) e desalinharia o board.
 * @param {HTMLElement} node
 */
function revealInRail(node) {
  const rail = node.parentElement;
  if (!rail) return;

  const top = node.offsetTop;
  const bottom = top + node.offsetHeight;
  if (top < rail.scrollTop) rail.scrollTop = top;
  else if (bottom > rail.scrollTop + rail.clientHeight) rail.scrollTop = bottom - rail.clientHeight;
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
  box.dataset.xpath = item.xpath;
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
  // quem chama `buildCommentBox` so anexa o resultado depois. `preventScroll`
  // pelo mesmo motivo de `revealInRail`: o foco nativo rolaria o board.
  setTimeout(() => {
    textarea.focus({ preventScroll: true });
    revealInRail(box);
  }, 0);
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
  balloon.dataset.xpath = item.xpath;

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
 * A caixinha daquele item, reaproveitada se ja estiver desenhada. Reaproveitar
 * e o ponto: o redesenho acontece a cada tecla digitada, e um `<textarea>`
 * remontado perde o foco e cancela a composicao do acento (veja
 * `mountedBoxes`).
 * @param {string} key
 * @param {string} file
 * @param {CommentItem} item
 * @returns {HTMLElement}
 */
function commentBoxFor(key, file, item) {
  const mounted = mountedBoxes.get(key);
  if (mounted) return mounted;

  const box = buildCommentBox(file, item);
  mountedBoxes.set(key, box);
  return box;
}

/**
 * Redesenha a coluna de uma tela a partir da fila, na ordem da fila. Itens
 * `unreferenced` ficam de fora — eles vao para a bandeja
 * (`renderUnreferencedTray`), nao pro card.
 *
 * A coluna nao e esvaziada de uma vez: so os nos que **sairam** da fila sao
 * removidos, e os outros entram antes ou depois da caixinha aberta sem que ela
 * saia do lugar. Trocar tudo — ou mover a caixinha — tiraria ela do DOM, e com
 * ela o foco e a composicao do teclado.
 *
 * @param {string} file
 */
function renderQueueForFile(file) {
  const screen = screens.get(file);
  if (!screen) return;

  const { rail } = ensureQueueLayer(screen);
  rail.classList.toggle('is-left', commentRailSide.get(file) === 'left');

  /** @type {HTMLElement[]} */
  const nodes = [];
  for (const item of commentQueue.get(file)?.values() ?? []) {
    if (item.status === 'unreferenced') continue;

    const key = boxKey(file, item.xpath);
    const boxOpen = item.status !== 'sending' && openBoxKeys.has(key);
    nodes.push(boxOpen ? commentBoxFor(key, file, item) : buildBalloon(file, item));
  }

  /** @type {Set<Element>} */
  const kept = new Set(nodes);
  for (const child of [...rail.children]) {
    if (!kept.has(child)) child.remove();
  }
  // So os baloes recem-criados entram aqui: quem ja esta na posicao certa (a
  // caixinha aberta) e pulado, e o `insertBefore` dos outros nao a move.
  nodes.forEach((node, index) => {
    const current = rail.children[index] ?? null;
    if (current !== node) rail.insertBefore(node, current);
  });

  refreshLinks(file);
}

/* ---------- Linhas entre a coluna e o no ---------- */

/** Arquivos com linhas a redesenhar no proximo quadro. @type {Set<string>} */
const pendingLinks = new Set();
let linksFrame = 0;

/**
 * Agenda o redesenho das linhas para o proximo quadro. Scroll do prototipo,
 * scroll da coluna e zoom disparam muitas vezes por quadro; medir a cada um
 * seria trabalho jogado fora.
 * @param {string} [file] sem arquivo, todas as telas com comentario (zoom)
 */
export function scheduleCommentLinks(file) {
  if (file) pendingLinks.add(file);
  else for (const queued of commentQueue.keys()) pendingLinks.add(queued);

  if (linksFrame || pendingLinks.size === 0) return;
  linksFrame = window.requestAnimationFrame(() => {
    linksFrame = 0;
    const files = [...pendingLinks];
    pendingLinks.clear();
    for (const queued of files) refreshLinks(queued);
  });
}

/**
 * Redesenha as linhas de uma tela: cada balao/caixinha da coluna ate o no do
 * seu item, medido ao vivo.
 *
 * Tudo e desenhado no espaco do layer, que e o espaco interno do iframe (veja
 * `ensureQueueLayer`): o rect do no, lido de dentro do iframe, ja vem nele. Ja
 * o rect do item da coluna vem em px de tela, e e dividido por `view.scale`.
 *
 * Uma ponta que nao esta a vista — no rolado para fora do frame, item rolado
 * para fora da coluna — e presa a borda e a linha fica apagada e tracejada,
 * dizendo "esta para la".
 * @param {string} file
 */
function refreshLinks(file) {
  const screen = screens.get(file);
  const layerEl = screen?.card.querySelector(':scope > .pina-queue-layer');
  if (!screen || !layerEl) return;

  const { layer, links, rail } = ensureQueueLayer(screen);
  const onLeft = rail.classList.contains('is-left');
  const layerRect = layer.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();
  const width = screen.frame.clientWidth;
  const height = screen.frame.clientHeight;

  /** @type {SVGElement[]} */
  const drawn = [];
  for (const node of /** @type {HTMLCollectionOf<HTMLElement>} */ (rail.children)) {
    const item = commentQueue.get(file)?.get(node.dataset.xpath ?? '');
    const el = item ? anchoredElement(file, item) : null;
    if (!el) continue;

    // Ponta da coluna: borda do item voltada para o frame, na altura da
    // primeira linha de texto (o centro de uma caixinha alta ficaria longe).
    const nodeRect = node.getBoundingClientRect();
    const rawY = nodeRect.top + Math.min(nodeRect.height / 2, 14);
    const railY = clamp(rawY, railRect.top, railRect.bottom);
    const startX = ((onLeft ? nodeRect.right : nodeRect.left) - layerRect.left) / view.scale;
    const startY = (railY - layerRect.top) / view.scale;

    // Ponta do no: borda voltada para a coluna, presa ao frame.
    const elRect = el.getBoundingClientRect();
    const endX = clamp(onLeft ? elRect.left : elRect.right, 0, width);
    const endY = clamp(elRect.top + Math.min(elRect.height / 2, 12), 0, height);

    const hidden = railY !== rawY || elRect.bottom < 0 || elRect.top > height;
    const midX = (startX + endX) / 2;

    const path = document.createElementNS(SVG_NS, 'path');
    path.classList.add('pina-comment-link');
    path.classList.toggle('is-hidden-end', hidden);
    path.setAttribute('d', `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`);

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.classList.add('pina-comment-link-dot');
    dot.classList.toggle('is-hidden-end', hidden);
    dot.setAttribute('cx', String(endX));
    dot.setAttribute('cy', String(endY));

    drawn.push(path, dot);
  }

  links.replaceChildren(...drawn);
}

/**
 * O mouse entrou numa tela: a coluna de comentarios de qualquer outra tela que
 * esteja por cima dela troca de lado, saindo da frente.
 *
 * Nao importa saber qual tela esta a esquerda de qual: a pergunta e so "esta
 * coluna encosta na tela em hover?", e a regra e "afastar dela". Os rects sao
 * os de tela (`getBoundingClientRect`), que ja trazem pan, zoom e a
 * contra-escala da coluna — a mesma conta em coordenadas do board teria de
 * refazer essa contra-escala a mao.
 * @param {string} file
 */
export function onCardHover(file) {
  const hovered = screens.get(file)?.frame.getBoundingClientRect();
  if (!hovered) return;

  for (const other of screens.values()) {
    if (other.file === file) continue;

    const rail = other.card.querySelector(':scope > .pina-queue-layer > .pina-comment-rail');
    if (!rail || rail.childElementCount === 0) continue;
    if (!rectsOverlap(rail.getBoundingClientRect(), hovered)) continue;

    const side = commentRailSide.get(other.file) === 'left' ? 'right' : 'left';
    commentRailSide.set(other.file, side);
    rail.classList.toggle('is-left', side === 'left');
    refreshLinks(other.file);
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
  // Caixinha que saiu da tela (fechou, virou balao, sumiu com o item) esta
  // desconectada do documento: e o sinal de que o no nao vale mais ser
  // guardado. Sem isso um item recriado no mesmo no herdaria o texto antigo.
  for (const [key, box] of mountedBoxes) {
    if (!box.isConnected) mountedBoxes.delete(key);
  }
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
