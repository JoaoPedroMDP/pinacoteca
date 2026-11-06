// @ts-check
// Markdown da resposta do agente: um parser pequeno e o desenhador dele.
//
// O parser (`parseMarkdown`) e puro — texto entra, arvore sai — e e o que o
// `unit.mjs` testa. O desenhador (`renderMarkdown`) monta DOM com
// `createElement` e `textContent`, **nunca `innerHTML`**: o texto vem do modelo
// e e tratado como qualquer conteudo de fora. Um `<script>` no meio da resposta
// vira texto, nao tag.
//
// Cobre o que um modelo escreve numa resposta de chat: titulo, paragrafo,
// negrito, italico, riscado, codigo (inline e em bloco), lista (aninhada),
// citacao, linha horizontal, link e tabela. Markdown incompleto — o caso comum
// no meio do streaming — sai como texto ate o delimitador de fechamento chegar.

/**
 * @typedef {{ type: 'text', text: string }
 *   | { type: 'br' }
 *   | { type: 'code', text: string }
 *   | { type: 'strong' | 'em' | 'del', children: Inline[] }
 *   | { type: 'link', href: string, children: Inline[] }} Inline
 */

/** @typedef {'' | 'left' | 'center' | 'right'} Align */

/**
 * @typedef {{ type: 'heading', level: number, inlines: Inline[] }
 *   | { type: 'paragraph', inlines: Inline[] }
 *   | { type: 'code', lang: string, text: string }
 *   | { type: 'list', ordered: boolean, start: number, items: Block[][] }
 *   | { type: 'quote', blocks: Block[] }
 *   | { type: 'hr' }
 *   | { type: 'table', align: Align[], head: Inline[][], rows: Inline[][][] }} Block
 */

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const HR_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE_RE = /^ {0,3}>\s?/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const SAFE_HREF_RE = /^(https?:|mailto:)/i;
const BARE_URL_RE = /^https?:\/\/[^\s<]*[^\s<.,:;"')\]]/;

/* ---------- Blocos ---------- */

/** @param {string} line */
const indentOf = (line) => line.length - line.trimStart().length;

/** @param {string} line */
const isBlank = (line) => line.trim() === '';

/**
 * A linha comeca um bloco que interrompe o paragrafo em curso?
 * @param {string} line
 * @returns {boolean}
 */
function startsBlock(line) {
  return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line)
    || QUOTE_RE.test(line) || LIST_RE.test(line);
}

/**
 * Celulas de uma linha de tabela, sem as barras das pontas.
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/**
 * @param {string} cell
 * @returns {Align}
 */
function alignOf(cell) {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return '';
}

/**
 * Tabela GFM: cabecalho, separador e linhas ate a primeira em branco.
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ block: Block, next: number } | null}
 */
function parseTable(lines, start) {
  const header = lines[start];
  const separator = lines[start + 1];
  if (!header.includes('|') || separator === undefined || !TABLE_SEP_RE.test(separator)) return null;

  const head = splitRow(header);
  const align = splitRow(separator).map(alignOf);
  if (align.length !== head.length) return null;

  /** @type {Inline[][][]} */
  const rows = [];
  let i = start + 2;
  while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
    const cells = splitRow(lines[i]);
    rows.push(head.map((_, index) => parseInline(cells[index] ?? '')));
    i += 1;
  }
  return { block: { type: 'table', align, head: head.map((cell) => parseInline(cell)), rows }, next: i };
}

/**
 * Bloco de codigo cercado. Sem a cerca de fechamento (streaming), vai ate o fim.
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ block: Block, next: number }}
 */
function parseFence(lines, start) {
  const match = /** @type {RegExpExecArray} */ (FENCE_RE.exec(lines[start]));
  const fence = match[1];
  const body = [];
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith(fence[0].repeat(fence.length)) && line.replace(/[`~]/g, '') === '') {
      i += 1;
      break;
    }
    body.push(lines[i]);
    i += 1;
  }
  return { block: { type: 'code', lang: match[2], text: body.join('\n') }, next: i };
}

/**
 * Linhas consecutivas comecando com `>`, sem o marcador, viram blocos de novo.
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ block: Block, next: number }}
 */
function parseQuote(lines, start) {
  const body = [];
  let i = start;
  while (i < lines.length && QUOTE_RE.test(lines[i])) {
    body.push(lines[i].replace(QUOTE_RE, ''));
    i += 1;
  }
  return { block: { type: 'quote', blocks: parseBlocks(body) }, next: i };
}

/**
 * O corpo de um item: a primeira linha e o que estiver mais recuado que o
 * marcador. Linha em branco so continua o item se a seguinte estiver recuada.
 * @param {string[]} lines
 * @param {number} start
 * @param {number} indent recuo do marcador
 * @param {number} contentIndent recuo do texto depois do marcador
 * @returns {{ body: string[], next: number }}
 */
function itemBody(lines, start, indent, contentIndent) {
  const first = /** @type {RegExpExecArray} */ (LIST_RE.exec(lines[start]));
  const body = [first[4]];
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      const next = lines[i + 1];
      if (next === undefined || isBlank(next) || indentOf(next) < contentIndent) break;
      body.push('');
    } else if (indentOf(line) > indent) {
      body.push(line.slice(Math.min(indentOf(line), contentIndent)));
    } else if (!startsBlock(line)) {
      // Continuacao preguicosa: linha sem recuo que nao abre bloco segue o paragrafo.
      body.push(line.trim());
    } else {
      break;
    }
    i += 1;
  }
  return { body, next: i };
}

/**
 * Lista: itens de mesmo recuo e mesmo tipo (com ou sem numero).
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ block: Block, next: number }}
 */
function parseList(lines, start) {
  const first = /** @type {RegExpExecArray} */ (LIST_RE.exec(lines[start]));
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);

  /** @type {Block[][]} */
  const items = [];
  let i = start;
  while (i < lines.length) {
    const match = LIST_RE.exec(lines[i]);
    if (match && match[1].length === indent && /\d/.test(match[2]) === ordered) {
      const contentIndent = indent + match[2].length + match[3].length;
      const { body, next } = itemBody(lines, i, indent, contentIndent);
      items.push(parseBlocks(body));
      i = next;
    } else if (isBlank(lines[i]) && LIST_RE.exec(lines[i + 1] ?? '')?.[1].length === indent) {
      i += 1;
    } else {
      break;
    }
  }
  const start_ = ordered ? Number.parseInt(first[2], 10) : 1;
  return { block: { type: 'list', ordered, start: start_, items }, next: i };
}

/**
 * Paragrafo: linhas ate uma em branco ou ate algo que abra outro bloco.
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ block: Block, next: number }}
 */
function parseParagraph(lines, start) {
  const body = [lines[start].trim()];
  let i = start + 1;
  while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])
    && !(lines[i].includes('|') && TABLE_SEP_RE.test(lines[i + 1] ?? ''))) {
    body.push(lines[i].trim());
    i += 1;
  }
  return { block: { type: 'paragraph', inlines: parseInline(body.join('\n')) }, next: i };
}

/**
 * Um bloco a partir da linha `i`, que nao esta em branco.
 * @param {string[]} lines
 * @param {number} i
 * @returns {{ block: Block, next: number }}
 */
function parseBlock(lines, i) {
  const line = lines[i];
  if (FENCE_RE.test(line)) return parseFence(lines, i);
  const heading = HEADING_RE.exec(line);
  if (heading) {
    return { block: { type: 'heading', level: heading[1].length, inlines: parseInline(heading[2]) }, next: i + 1 };
  }
  if (HR_RE.test(line)) return { block: { type: 'hr' }, next: i + 1 };
  if (QUOTE_RE.test(line)) return parseQuote(lines, i);
  if (LIST_RE.test(line)) return parseList(lines, i);
  return parseTable(lines, i) ?? parseParagraph(lines, i);
}

/**
 * @param {string[]} lines
 * @returns {Block[]}
 */
function parseBlocks(lines) {
  /** @type {Block[]} */
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i += 1;
    } else {
      const { block, next } = parseBlock(lines, i);
      blocks.push(block);
      i = next;
    }
  }
  return blocks;
}

/**
 * Le o texto inteiro como markdown.
 * @param {string} text
 * @returns {Block[]}
 */
export function parseMarkdown(text) {
  return parseBlocks(text.replace(/\r\n?/g, '\n').split('\n'));
}

/* ---------- Inline ---------- */

/** @param {string | undefined} char */
const isWordChar = (char) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

/**
 * Onde fecha o delimitador aberto em `from`, ou -1. O conteudo nao pode
 * comecar nem terminar em espaco, e o `*` simples pula os `**` do caminho.
 * @param {string} text
 * @param {number} from indice logo depois do delimitador de abertura
 * @param {string} delim
 * @returns {number}
 */
function findClose(text, from, delim) {
  if (text[from] === undefined || /\s/.test(text[from])) return -1;
  let j = from + 1;
  while (j < text.length) {
    if (text[j] === '`') {
      // Delimitador dentro de codigo inline nao fecha nada.
      const end = text.indexOf('`', j + 1);
      if (end < 0) return -1;
      j = end + 1;
    } else if (text.startsWith(delim, j)) {
      const doubled = delim.length === 1 && text[j + 1] === delim;
      if (!doubled && !/\s/.test(text[j - 1])
        && !(delim === '_' && isWordChar(text[j + 1]))) return j;
      j += doubled ? 2 : 1;
    } else {
      j += 1;
    }
  }
  return -1;
}

/**
 * `[rotulo](url)` a partir de `start`. Href fora de http(s)/mailto vira texto.
 * @param {string} text
 * @param {number} start
 * @returns {{ node: Inline | null, label: string, next: number } | null}
 */
function readLink(text, start) {
  const labelEnd = text.indexOf('](', start + 1);
  if (labelEnd < 0) return null;
  const urlEnd = text.indexOf(')', labelEnd + 2);
  if (urlEnd < 0) return null;
  const label = text.slice(start + 1, labelEnd);
  const href = text.slice(labelEnd + 2, urlEnd).trim().split(/\s+/)[0] ?? '';
  const node = SAFE_HREF_RE.test(href) ? { type: /** @type {const} */ ('link'), href, children: parseInline(label) } : null;
  return { node, label, next: urlEnd + 1 };
}

/** @type {Array<[string, 'strong' | 'em' | 'del']>} */
const EMPHASIS = [['**', 'strong'], ['__', 'strong'], ['~~', 'del'], ['*', 'em'], ['_', 'em']];

/** @typedef {{ nodes: Inline[], next: number } | null} InlineRead */

/**
 * Codigo inline: a mesma quantidade de crases abre e fecha.
 * @param {string} text
 * @param {number} i
 * @returns {InlineRead}
 */
function readCode(text, i) {
  const run = /^`+/.exec(text.slice(i))?.[0] ?? '`';
  const end = text.indexOf(run, i + run.length);
  if (end < 0) return null;
  return { nodes: [{ type: 'code', text: text.slice(i + run.length, end).trim() || ' ' }], next: end + run.length };
}

/**
 * URL solta no texto, sem a pontuacao que costuma vir colada no fim.
 * @param {string} text
 * @param {number} i
 * @returns {InlineRead}
 */
function readBareUrl(text, i) {
  const url = BARE_URL_RE.exec(text.slice(i))?.[0];
  if (!url || isWordChar(text[i - 1])) return null;
  return { nodes: [{ type: 'link', href: url, children: [{ type: 'text', text: url }] }], next: i + url.length };
}

/**
 * Negrito, italico ou riscado, se o delimitador tiver fechamento.
 * @param {string} text
 * @param {number} i
 * @returns {InlineRead}
 */
function readEmphasis(text, i) {
  for (const [delim, type] of EMPHASIS) {
    if (!text.startsWith(delim, i)) continue;
    // `snake_case` nao e italico: `_` colado em letra dos dois lados e texto.
    if (delim[0] === '_' && isWordChar(text[i - 1])) return null;
    const end = findClose(text, i + delim.length, delim);
    if (end < 0) continue;
    return { nodes: [{ type, children: parseInline(text.slice(i + delim.length, end)) }], next: end + delim.length };
  }
  return null;
}

/**
 * Um no inline comecando em `i`, ou null se ali for so texto.
 * @param {string} text
 * @param {number} i
 * @returns {InlineRead}
 */
function readInline(text, i) {
  const char = text[i];
  if (char === '\\' && /[!-/:-@[-`{-~]/.test(text[i + 1] ?? '')) {
    return { nodes: [{ type: 'text', text: text[i + 1] }], next: i + 2 };
  }
  if (char === '\n') return { nodes: [{ type: 'br' }], next: i + 1 };
  if (char === '`') return readCode(text, i);
  if (char === '[') {
    const link = readLink(text, i);
    if (!link) return null;
    return { nodes: link.node ? [link.node] : parseInline(link.label), next: link.next };
  }
  if (char === 'h') return readBareUrl(text, i);
  return readEmphasis(text, i);
}

/**
 * @param {string} text
 * @returns {Inline[]}
 */
export function parseInline(text) {
  /** @type {Inline[]} */
  const out = [];
  let buffer = '';
  let i = 0;
  while (i < text.length) {
    const read = readInline(text, i);
    if (read) {
      if (buffer) out.push({ type: 'text', text: buffer });
      buffer = '';
      out.push(...read.nodes);
      i = read.next;
    } else {
      buffer += text[i];
      i += 1;
    }
  }
  if (buffer) out.push({ type: 'text', text: buffer });
  return out;
}

/* ---------- DOM ---------- */

/**
 * @param {Document} doc
 * @param {Inline[]} inlines
 * @returns {Node[]}
 */
function inlineNodes(doc, inlines) {
  return inlines.map((node) => {
    if (node.type === 'text') return doc.createTextNode(node.text);
    if (node.type === 'br') return doc.createElement('br');
    if (node.type === 'code') {
      const code = doc.createElement('code');
      code.textContent = node.text;
      return code;
    }
    if (node.type === 'link') {
      const link = doc.createElement('a');
      link.href = node.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.append(...inlineNodes(doc, node.children));
      return link;
    }
    const tag = doc.createElement(node.type === 'strong' ? 'strong' : node.type === 'em' ? 'em' : 'del');
    tag.append(...inlineNodes(doc, node.children));
    return tag;
  });
}

/**
 * @param {Document} doc
 * @param {Extract<Block, { type: 'table' }>} block
 * @returns {HTMLElement}
 */
function tableNode(doc, block) {
  /**
   * @param {'th' | 'td'} tag
   * @param {Inline[][]} cells
   */
  const row = (tag, cells) => {
    const tr = doc.createElement('tr');
    cells.forEach((cell, index) => {
      const td = doc.createElement(tag);
      if (block.align[index]) td.style.textAlign = block.align[index];
      td.append(...inlineNodes(doc, cell));
      tr.append(td);
    });
    return tr;
  };
  const table = doc.createElement('table');
  const thead = doc.createElement('thead');
  thead.append(row('th', block.head));
  const tbody = doc.createElement('tbody');
  tbody.append(...block.rows.map((cells) => row('td', cells)));
  table.append(thead, tbody);

  // A coluna da conversa e estreita: tabela larga rola por dentro, nao estoura.
  const wrap = doc.createElement('div');
  wrap.className = 'md-table';
  wrap.append(table);
  return wrap;
}

/**
 * @param {Document} doc
 * @param {Block} block
 * @returns {HTMLElement}
 */
function blockNode(doc, block) {
  if (block.type === 'heading') {
    const heading = doc.createElement(`h${block.level}`);
    heading.append(...inlineNodes(doc, block.inlines));
    return heading;
  }
  if (block.type === 'paragraph') {
    const p = doc.createElement('p');
    p.append(...inlineNodes(doc, block.inlines));
    return p;
  }
  if (block.type === 'code') {
    const pre = doc.createElement('pre');
    const code = doc.createElement('code');
    if (block.lang) code.dataset.lang = block.lang;
    code.textContent = block.text;
    pre.append(code);
    return pre;
  }
  if (block.type === 'list') {
    const list = doc.createElement(block.ordered ? 'ol' : 'ul');
    if (block.ordered && block.start !== 1) list.setAttribute('start', String(block.start));
    for (const item of block.items) {
      const li = doc.createElement('li');
      li.append(...item.map((child) => blockNode(doc, child)));
      list.append(li);
    }
    return list;
  }
  if (block.type === 'quote') {
    const quote = doc.createElement('blockquote');
    quote.append(...block.blocks.map((child) => blockNode(doc, child)));
    return quote;
  }
  if (block.type === 'table') return tableNode(doc, block);
  return doc.createElement('hr');
}

/**
 * Troca o conteudo de `container` pelo markdown de `text` desenhado.
 * @param {HTMLElement} container
 * @param {string} text
 */
export function renderMarkdown(container, text) {
  const doc = container.ownerDocument;
  container.replaceChildren(...parseMarkdown(text).map((block) => blockNode(doc, block)));
}
