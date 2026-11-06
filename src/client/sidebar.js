// @ts-check
// Barra lateral: arvore de telas agrupada por pasta, e os gestos que
// reorganizam as pastas.
//
// A sidebar nao cria o botao de cada tela — ele nasce junto com o card, em
// `cards.js`, e aqui so e posicionado na arvore. Assim o listener de clique e o
// estado visual da tela vivem num lugar so.
//
// A arvore mostra a pasta *efetiva* de cada tela (`folders.js`): arrastar uma
// tela ou uma pasta para outra pasta muda so o que o board mostra, nunca o
// disco. Quem grava e avisa e `folders.js`; daqui sai so o gesto.

import { folderNew, folderReset, screenList, screenCount, emptyState } from './dom.js';
import { screens, collapsedDirs, folders } from './state.js';
import { basenameOf, buildTree, dirnameOf, sortNames } from './utils.js';
import {
  clearFolderColor, colorOf, createFolder, folderHasScreens, folderOf, moveFileTo,
  moveFolderInto, paintElement, removeFolder, renameFolder, resetFolders, setFolderColor,
} from './folders.js';
import { DRAG_FOLDER_TYPE, DRAG_SCREEN_TYPE } from './constants.js';

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

/* ---------- Arrastar e soltar ---------- */

/**
 * O arrasto e de uma tela ou de uma pasta nossa? Arquivo vindo do sistema, ou
 * texto de outra pagina, nao e soltavel aqui.
 * @param {DragEvent} event
 * @returns {boolean}
 */
function isOurDrag(event) {
  const types = event.dataTransfer?.types ?? [];
  return types.includes(DRAG_SCREEN_TYPE) || types.includes(DRAG_FOLDER_TYPE);
}

/**
 * Aplica o que foi solto numa pasta (`''` e a raiz).
 * @param {DataTransfer} data
 * @param {string} folder
 */
function applyDrop(data, folder) {
  const file = data.getData(DRAG_SCREEN_TYPE);
  if (file) {
    if (screens.has(file) && folderOf(file) !== folder) moveFileTo(file, folder);
    return;
  }
  const path = data.getData(DRAG_FOLDER_TYPE);
  if (path && dirnameOf(path) !== folder) moveFolderInto(path, folder);
}

/**
 * Faz de `el` um alvo de soltura para `folder`. A pasta inteira (cabecalho e
 * filhos) e o alvo: soltar sobre uma tela de dentro dela poe a tela ali. O
 * `stopPropagation` e o que deixa a pasta mais funda vencer as de fora.
 * @param {HTMLElement} el
 * @param {string} folder
 */
function makeDropTarget(el, folder) {
  el.addEventListener('dragover', (event) => {
    if (!isOurDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    el.classList.add('is-drop-target');
  });
  el.addEventListener('dragleave', (event) => {
    if (event.relatedTarget instanceof Element && el.contains(event.relatedTarget)) return;
    el.classList.remove('is-drop-target');
  });
  el.addEventListener('drop', (event) => {
    if (!isOurDrag(event) || !event.dataTransfer) return;
    event.preventDefault();
    event.stopPropagation();
    el.classList.remove('is-drop-target');
    applyDrop(event.dataTransfer, folder);
  });
}

/* ---------- Pasta ---------- */

/**
 * Troca o botao da pasta por um campo com o nome dela. Enter (ou sair do campo)
 * renomeia; Esc desiste.
 * @param {HTMLElement} toggle
 * @param {string} path
 */
function beginRename(toggle, path) {
  const input = document.createElement('input');
  input.className = 'folder-rename';
  input.value = basenameOf(path);
  input.setAttribute('aria-label', 'Nome da pasta');

  let finished = false;
  /** @param {boolean} accept */
  const finish = (accept) => {
    if (finished) return;
    finished = true;
    const name = input.value.trim();
    // Renomear redesenha a sidebar sozinho; desistir precisa devolver o botao.
    if (!accept || !name || name === basenameOf(path) || !renameFolder(path, name)) renderSidebar();
  };
  input.addEventListener('keydown', (event) => {
    // Esc e Enter sao deste campo: nao fecham nada do board.
    event.stopPropagation();
    if (event.key === 'Enter') finish(true);
    else if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));

  toggle.replaceWith(input);
  input.focus();
  input.select();
}

/**
 * Seletor de cor da pasta. `input` recolore ao vivo; `change` grava. Clique com
 * o botao direito esquece a cor escolhida.
 * @param {string} path
 * @returns {HTMLInputElement}
 */
function colorInput(path) {
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'folder-color';
  input.value = colorOf(path) ?? '#000000';
  input.title = path in folders.colors
    ? 'Cor da pasta (botao direito volta a cor automatica)'
    : 'Cor da pasta';
  input.addEventListener('input', () => setFolderColor(path, input.value, false));
  input.addEventListener('change', () => setFolderColor(path, input.value, true));
  input.addEventListener('contextmenu', (event) => {
    if (!(path in folders.colors)) return;
    event.preventDefault();
    clearFolderColor(path);
    renderSidebar();
  });
  return input;
}

/**
 * Cabecalho de uma pasta: o botao de colapso (com o nome), a cor e, quando ela
 * esta vazia, o botao de apagar.
 * @param {string} name
 * @param {TreeNode} node
 * @returns {HTMLElement}
 */
function folderHead(name, node) {
  const head = document.createElement('div');
  head.className = 'folder-head';
  head.draggable = true;
  head.dataset.path = node.path;
  head.addEventListener('dragstart', (event) => {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(DRAG_FOLDER_TYPE, node.path);
    event.dataTransfer.effectAllowed = 'move';
  });

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'folder-toggle';
  toggle.title = 'Duplo clique renomeia';
  toggle.setAttribute('aria-expanded', String(!collapsedDirs.has(node.path)));

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
  toggle.addEventListener('dblclick', () => beginRename(toggle, node.path));

  head.append(toggle, colorInput(node.path));

  if (!folderHasScreens(node.path)) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'folder-remove';
    remove.title = 'Apagar pasta vazia';
    remove.textContent = '×';
    remove.addEventListener('click', () => removeFolder(node.path));
    head.append(remove);
  }
  return head;
}

/**
 * Pasta colapsavel, com os filhos dentro.
 * @param {string} name nome da pasta, sem o caminho
 * @param {TreeNode} node
 * @returns {HTMLElement}
 */
function folderElement(name, node) {
  const wrap = document.createElement('div');
  wrap.className = 'tree-folder';
  // A cor fica na pasta inteira: a linha de recuo dos filhos tambem a usa.
  paintElement(wrap, node.path);
  makeDropTarget(wrap, node.path);

  const children = document.createElement('div');
  children.className = 'folder-children';
  children.hidden = collapsedDirs.has(node.path);
  children.append(...renderNodes(node));

  wrap.append(folderHead(name, node), children);
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
  screenList.replaceChildren(...renderNodes(buildTree(files, folderOf, folders.extra)));
  screenCount.textContent = String(files.length);
  emptyState.hidden = files.length > 0;
}

/**
 * Liga os controles fixos das pastas: soltar na raiz, "Nova pasta" e
 * "Restaurar pastas". Chamado uma vez, pelo `board.js`.
 */
export function initFolderControls() {
  makeDropTarget(screenList, '');

  folderNew.addEventListener('click', () => {
    const path = createFolder('');
    // A pasta nova ja nasce pedindo nome: "nova pasta" quase nunca e o que se quer.
    const head = [...screenList.querySelectorAll('.folder-head')]
      .find((el) => el instanceof HTMLElement && el.dataset.path === path);
    const toggle = head?.querySelector('.folder-toggle');
    if (toggle instanceof HTMLElement) beginRename(toggle, path);
  });

  folderReset.addEventListener('click', () => resetFolders());
}
