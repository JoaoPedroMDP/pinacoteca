// @ts-check
// Modo ponteiro: destaca o elemento sob o cursor dentro do prototipo e copia o
// XPath dele.
//
// Tudo aqui depende de mesma origem — os prototipos sao servidos pelo mesmo
// localhost, entao da para ler o documento do iframe. Cada acesso mesmo assim
// fica em try/catch: o iframe pode estar trocando de `src` no meio do gesto.

import { ensureFloating } from './dom.js';
import { screens, ui, view } from './state.js';
import { clamp, computeXPath } from './utils.js';
import { copyText, showToast } from './feedback.js';

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
 * Alt+clique: copia o XPath do elemento sob o cursor, para apontar ao agente de
 * IA exatamente qual pedaco da tela deve mudar.
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
