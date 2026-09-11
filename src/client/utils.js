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
 * Largura valida para a sidebar. Alem dos limites fixos, garante que o board
 * fique com pelo menos `minCanvas` px: numa janela estreita esse piso e o que
 * manda, e pode empurrar o resultado abaixo de `min`.
 *
 * @param {number} width largura pedida, em px
 * @param {number} viewportWidth largura da janela, em px
 * @param {{ min: number, max: number, minCanvas: number }} limits
 * @returns {number} largura em px, ja arredondada
 */
export function clampSidebarWidth(width, viewportWidth, limits) {
  if (!Number.isFinite(width)) return limits.min;

  // O teto real e o menor entre o limite fixo e o que sobra para o board.
  const ceiling = Math.min(limits.max, viewportWidth - limits.minCanvas);
  // Janela estreita demais para os dois: o board ganha, e a sidebar encolhe
  // abaixo do minimo em vez de empurrar o canvas para fora da tela.
  if (ceiling < limits.min) return Math.max(0, Math.round(ceiling));

  return Math.round(clamp(width, limits.min, ceiling));
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
 * Desfaz as sobreposicoes de um conjunto de caixas, descendo quem estiver por
 * baixo o minimo que resolve.
 *
 * So desce, e nunca desvia para o lado, pelo mesmo motivo que `belowPinned`
 * (em `view.js`) tambem so desce: o board e lido em colunas, e uma tela saltando
 * para o lado embaralha mais a leitura do que uma descendo. `gap` e a folga
 * deixada entre as duas depois de separadas, para elas nao ficarem coladas.
 *
 * As caixas sao percorridas de cima para baixo, e cada uma so e comparada com as
 * que ja foram resolvidas: quem desce nunca volta a colidir com quem ficou
 * acima, entao uma passada basta mesmo com colisoes em cascata.
 *
 * Nao toca nas caixas recebidas — devolve so quanto cada uma precisa descer.
 *
 * @param {Array<Rect & { file: string }>} boxes
 * @param {number} gap folga entre duas caixas separadas, em px de canvas
 * @returns {Map<string, number>} o `y` novo de cada caixa que precisou descer
 */
export function separateOverlaps(boxes, gap) {
  const ordered = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);

  /** @type {Map<string, number>} */
  const moved = new Map();
  /** @type {Rect[]} */
  const settled = [];

  for (const box of ordered) {
    let { y } = box;
    // Repete ate parar de colidir: descer para escapar de uma caixa pode meter a
    // atual dentro de outra que estava mais abaixo.
    for (let again = true; again;) {
      again = false;
      for (const other of settled) {
        if (!rectsOverlap({ ...box, y }, other)) continue;
        y = other.y + other.height + gap;
        again = true;
      }
    }

    if (y !== box.y) moved.set(box.file, y);
    settled.push({ ...box, y });
  }
  return moved;
}

/**
 * @typedef {'right' | 'bottom' | 'corner'} ResizeZone
 */

/**
 * Em qual borda redimensionavel do frame o ponto caiu.
 *
 * So a direita, a base e a quina entre as duas: sao as bordas que crescem o
 * card sem mexer no canto de cima, entao o `x`/`y` da tela nunca muda durante
 * o arrasto. Tudo em px de *tela*, porque a folga de agarre precisa ter o mesmo
 * tamanho para o dedo em qualquer nivel de zoom.
 *
 * @param {number} clientX
 * @param {number} clientY
 * @param {Rect} frameRect caixa do frame na tela (getBoundingClientRect)
 * @param {number} edge folga de agarre, em px de tela
 * @returns {ResizeZone | null} null quando o ponto esta longe das bordas
 */
export function resizeZoneAt(clientX, clientY, frameRect, edge) {
  const right = frameRect.x + frameRect.width;
  const bottom = frameRect.y + frameRect.height;

  // A folga vale para os dois lados da borda: um pouco antes e um pouco depois.
  if (clientX < frameRect.x || clientX > right + edge) return null;
  if (clientY < frameRect.y || clientY > bottom + edge) return null;

  const nearRight = clientX >= right - edge;
  const nearBottom = clientY >= bottom - edge;

  if (nearRight && nearBottom) return 'corner';
  if (nearRight) return 'right';
  if (nearBottom) return 'bottom';
  return null;
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
 * Elemento apontado por um XPath calculado por `computeXPath`, dentro de um
 * documento novo — o inverso dela. `null` quando o documento não tem mais
 * nenhum nó naquele caminho (o alvo virou "etéreo", veja `state.js`).
 *
 * `9` é `XPathResult.FIRST_ORDERED_NODE_TYPE`: escrito como número em vez do
 * nome global porque este arquivo é testado fora do navegador (`test/unit.mjs`
 * passa um `doc` falso), e `XPathResult` não existe em Node.
 *
 * @param {Document} doc
 * @param {string} xpath
 * @returns {Element | null}
 */
export function resolveXPath(doc, xpath) {
  try {
    const result = doc.evaluate(xpath, doc, null, 9, null);
    const node = result.singleNodeValue;
    return node && node.nodeType === 1 ? /** @type {Element} */ (node) : null;
  } catch {
    return null;
  }
}

/**
 * Serializa os itens referenciados da fila de comentários numa única
 * mensagem, numerada, com o XPath em linha própria (fácil de copiar/usar
 * pelo agente) e o comentário em bloco abaixo (suporta multi-linha sem
 * ambiguidade). Itens `unreferenced` ficam de fora: no momento do envio,
 * quem ainda não resolveu o nó é descartado da mensagem.
 *
 * @param {Map<string, Map<string, import('./state.js').CommentItem>>} queue
 * @returns {string} vazio quando não há item elegível
 */
export function serializeCommentQueue(queue) {
  const lines = [];
  let n = 0;

  for (const items of queue.values()) {
    for (const item of items.values()) {
      if (item.status === 'unreferenced') continue;
      n += 1;
      lines.push(`${n}. XPath: ${item.xpath}\n   Comentário: ${item.text}`);
    }
  }

  return lines.join('\n\n');
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
