// @ts-check
// Barra lateral: arvore de telas agrupada por pasta.
//
// A sidebar nao cria o botao de cada tela — ele nasce junto com o card, em
// `cards.js`, e aqui so e posicionado na arvore. Assim o listener de clique e o
// estado visual da tela vivem num lugar so.

import { screenList, screenCount, emptyState } from './dom.js';
import { screens, collapsedDirs } from './state.js';
import { buildTree, sortNames } from './utils.js';

/** @typedef {import('./utils.js').TreeNode} TreeNode */

/**
 * Marca qual tela esta em foco (a ultima centralizada ou liberada para clique).
 * @param {string | null} file
 */
export function setCurrent(file) {
  for (const [key, screen] of screens) {
    screen.item.setAttribute('aria-current', String(key === file));
  }
}

/**
 * Cabecalho colapsavel de uma pasta, com os filhos dentro.
 * @param {string} name nome da pasta, sem o caminho
 * @param {TreeNode} node
 * @returns {HTMLElement}
 */
function folderElement(name, node) {
  const wrap = document.createElement('div');
  wrap.className = 'tree-folder';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'folder-toggle';
  const collapsed = collapsedDirs.has(node.path);
  toggle.setAttribute('aria-expanded', String(!collapsed));

  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▸';
  const label = document.createElement('span');
  label.className = 'folder-name';
  label.textContent = name;
  toggle.append(caret, label);
  toggle.addEventListener('click', () => {
    if (collapsedDirs.has(node.path)) collapsedDirs.delete(node.path);
    else collapsedDirs.add(node.path);
    renderSidebar();
  });

  const children = document.createElement('div');
  children.className = 'folder-children';
  children.hidden = collapsed;
  children.append(...renderNodes(node));

  wrap.append(toggle, children);
  return wrap;
}

/**
 * Pastas primeiro (em ordem), depois os arquivos daquele nivel.
 * @param {TreeNode} node
 * @returns {HTMLElement[]}
 */
function renderNodes(node) {
  /** @type {HTMLElement[]} */
  const out = [];

  for (const name of sortNames([...node.dirs.keys()])) {
    const child = node.dirs.get(name);
    if (child) out.push(folderElement(name, child));
  }
  for (const file of sortNames(node.files)) {
    const screen = screens.get(file);
    if (screen) out.push(screen.item);
  }
  return out;
}

/** Redesenha a arvore inteira a partir das telas montadas. */
export function renderSidebar() {
  const files = sortNames([...screens.keys()]);
  screenList.replaceChildren(...renderNodes(buildTree(files)));
  screenCount.textContent = String(files.length);
  emptyState.hidden = files.length > 0;
}
