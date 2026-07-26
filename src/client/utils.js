// @ts-check
// Funcoes puras, sem DOM e sem estado. O que entrar aqui tem de poder ser
// testado so com entrada e saida.

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Escapa cada segmento separadamente: as barras continuam sendo barras.
 * @param {string} file caminho relativo da tela
 * @returns {string}
 */
export function encodePath(file) {
  return file.split('/').map(encodeURIComponent).join('/');
}

/**
 * URL do prototipo com cache-busting — o board conta com o disco ser a verdade.
 * @param {string} file caminho relativo da tela
 * @returns {string}
 */
export function previewUrl(file) {
  return `/preview/${encodePath(file)}?t=${Date.now()}`;
}

/**
 * XPath absoluto do elemento; usa @id quando existe (mais curto e estavel).
 * @param {Element} el
 * @returns {string}
 */
export function computeXPath(el) {
  if (el.id) return `//*[@id="${el.id}"]`;

  /** @type {string[]} */
  const parts = [];
  /** @type {Element | null} */
  let node = el;
  while (node && node.nodeType === 1) {
    let index = 1;
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.nodeName === node.nodeName) index += 1;
    }
    parts.unshift(`${node.nodeName.toLowerCase()}[${index}]`);
    if (node.nodeName === 'HTML') break;
    node = node.parentElement;
  }
  return `/${parts.join('/')}`;
}

/**
 * @typedef {{ path: string, dirs: Map<string, TreeNode>, files: string[] }} TreeNode
 */

/**
 * Monta uma arvore de pastas a partir dos caminhos relativos das telas.
 * @param {string[]} files
 * @returns {TreeNode} a raiz, cujo `path` e a string vazia
 */
export function buildTree(files) {
  /** @type {TreeNode} */
  const root = { path: '', dirs: new Map(), files: [] };

  for (const file of files) {
    const parts = file.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i];
      let child = node.dirs.get(name);
      if (!child) {
        child = { path: node.path ? `${node.path}/${name}` : name, dirs: new Map(), files: [] };
        node.dirs.set(name, child);
      }
      node = child;
    }
    node.files.push(file);
  }
  return root;
}

/**
 * Ordem alfabetica estavel, usada em toda lista de arquivo e pasta do board.
 * @param {string[]} names
 * @returns {string[]} uma copia ordenada
 */
export function sortNames(names) {
  return [...names].sort((a, b) => a.localeCompare(b));
}
