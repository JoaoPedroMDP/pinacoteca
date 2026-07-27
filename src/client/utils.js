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
 * Arredonda uma coordenada para a grade mais proxima.
 * @param {number} value
 * @param {number} size tamanho da celula da grade, em px de canvas
 * @returns {number}
 */
export function snapToGrid(value, size) {
  return Math.round(value / size) * size;
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
 * Caixa de uma tela no canvas, em px de canvas.
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

/**
 * Duas caixas se sobrepoem?
 *
 * O limite e estrito: encostar nao conta. Dois cards colados lado a lado
 * continuam validos — sobreposicao e uma tela *tapando* a outra.
 *
 * @param {Rect} a
 * @param {Rect} b
 * @returns {boolean}
 */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.width
    && b.x < a.x + a.width
    && a.y < b.y + b.height
    && b.y < a.y + a.height;
}

/**
 * Quais telas estao por cima de alguma outra. Sobreposicao e mutua: as duas
 * telas envolvidas entram no conjunto, porque as duas estao em posicao invalida.
 *
 * @param {Array<Rect & { file: string }>} boxes
 * @returns {Set<string>} os arquivos em posicao invalida
 */
export function findOverlaps(boxes) {
  /** @type {Set<string>} */
  const invalid = new Set();

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (!rectsOverlap(boxes[i], boxes[j])) continue;
      invalid.add(boxes[i].file);
      invalid.add(boxes[j].file);
    }
  }
  return invalid;
}

/**
 * Reparte itens entre `columns` colunas, cada item indo para a coluna mais curta
 * no momento. So distribui: quem chama e que sabe posicionar.
 *
 * Separado do posicionamento de proposito — assim a coluna de cada tela e
 * decidida *antes* de se saber a largura de cada coluna, que sai justamente das
 * telas que cairam nela.
 *
 * @param {number[]} heights altura de cada item, na ordem em que devem entrar
 * @param {number} columns quantas colunas; menos de uma vira uma
 * @returns {number[][]} os indices de `heights` em cada coluna, em ordem
 */
export function assignColumns(heights, columns) {
  const total = Math.max(1, columns);
  /** @type {number[][]} */
  const buckets = Array.from({ length: total }, () => []);
  const filled = new Array(total).fill(0);

  heights.forEach((height, index) => {
    let target = 0;
    for (let i = 1; i < total; i += 1) {
      if (filled[i] < filled[target]) target = i;
    }
    buckets[target].push(index);
    filled[target] += height;
  });

  return buckets;
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
