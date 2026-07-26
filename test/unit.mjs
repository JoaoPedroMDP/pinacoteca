// Testes unitarios das funcoes puras.
//
// Aqui so entra funcao que decide algo sozinha, com entrada e saida: parsing de
// argumento, caminho seguro, arvore da sidebar, XPath. Comportamento que so
// existe com um navegador no meio (iframe recarregando, map de assets) e do
// `e2e.mjs` — mockar isso testaria a maquete, nao o produto.
//
// Rode com `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseArgs, DEFAULT_PORT } from '../src/cli.js';
import { mimeTypeFor, resolveInside } from '../src/server/http.js';
import { isForbiddenPreviewPath, isHtmlFile, isIgnoredDir, listScreens } from '../src/server/screens.js';
import { buildTree, clamp, computeXPath, encodePath, previewUrl, sortNames } from '../src/client/utils.js';

/* ---------- cli.js ---------- */

test('parseArgs sem argumento usa o diretorio atual e a porta padrao', () => {
  const result = parseArgs([], '/tmp/proto');
  assert.deepEqual(result, { kind: 'run', options: { dir: '/tmp/proto', port: DEFAULT_PORT, open: true } });
});

test('parseArgs resolve a pasta relativa contra o diretorio atual', () => {
  const result = parseArgs(['telas'], '/tmp/proto');
  assert.equal(result.kind === 'run' && result.options.dir, '/tmp/proto/telas');
});

test('parseArgs aceita as duas formas de porta', () => {
  for (const argv of [['--port', '8080'], ['-p', '8080'], ['--port=8080']]) {
    const result = parseArgs(argv, '/tmp');
    assert.equal(result.kind === 'run' && result.options.port, 8080, argv.join(' '));
  }
});

test('parseArgs desliga o navegador com --no-open', () => {
  const result = parseArgs(['--no-open'], '/tmp');
  assert.equal(result.kind === 'run' && result.options.open, false);
});

test('parseArgs pede ajuda sem encerrar o processo', () => {
  assert.equal(parseArgs(['--help'], '/tmp').kind, 'help');
  assert.equal(parseArgs(['-h'], '/tmp').kind, 'help');
});

test('parseArgs recusa opcao desconhecida', () => {
  const result = parseArgs(['--turbo'], '/tmp');
  assert.equal(result.kind, 'error');
});

test('parseArgs recusa porta fora da faixa', () => {
  for (const port of ['0', '70000', 'abc', '1.5']) {
    assert.equal(parseArgs(['--port', port], '/tmp').kind, 'error', port);
  }
});

/* ---------- server/http.js ---------- */

test('resolveInside aceita caminho abaixo da raiz', () => {
  assert.equal(resolveInside('/base', 'css/base.css'), '/base/css/base.css');
});

test('resolveInside decodifica percent-encoding', () => {
  assert.equal(resolveInside('/base', 'pasta%20com%20espaco/a.html'), '/base/pasta com espaco/a.html');
});

test('resolveInside recusa caminho que escapa da raiz', () => {
  for (const attempt of ['../etc/passwd', '..%2f..%2fetc/passwd', 'a/../../b']) {
    assert.equal(resolveInside('/base', attempt), null, attempt);
  }
});

test('resolveInside recusa percent-encoding invalido', () => {
  assert.equal(resolveInside('/base', '%zz'), null);
});

test('resolveInside nao confunde pasta irma de prefixo parecido', () => {
  assert.equal(resolveInside('/base', '../base-outro/a.html'), null);
});

test('mimeTypeFor conhece os tipos de prototipo e tem fallback', () => {
  assert.equal(mimeTypeFor('a.html'), 'text/html; charset=utf-8');
  assert.equal(mimeTypeFor('a.CSS'), 'text/css; charset=utf-8');
  assert.equal(mimeTypeFor('a.desconhecido'), 'application/octet-stream');
});

/* ---------- server/screens.js ---------- */

test('isIgnoredDir pega ocultas e pastas de build', () => {
  for (const name of ['.git', '.next', 'node_modules', 'dist', 'build', 'coverage']) {
    assert.equal(isIgnoredDir(name), true, name);
  }
  assert.equal(isIgnoredDir('telas'), false);
});

test('isHtmlFile aceita .html e .htm, em qualquer caixa', () => {
  assert.equal(isHtmlFile('a.html'), true);
  assert.equal(isHtmlFile('a.HTM'), true);
  assert.equal(isHtmlFile('a.htmlx'), false);
  assert.equal(isHtmlFile('a.css'), false);
});

test('isForbiddenPreviewPath recusa a raiz, ocultos e pastas de build', () => {
  assert.equal(isForbiddenPreviewPath('/base', '/base'), true);
  assert.equal(isForbiddenPreviewPath('/base', '/base/.env'), true);
  assert.equal(isForbiddenPreviewPath('/base', '/base/.git/config'), true);
  assert.equal(isForbiddenPreviewPath('/base', '/base/node_modules/pkg/a.css'), true);
  assert.equal(isForbiddenPreviewPath('/base', '/base/css/base.css'), false);
});

test('listScreens varre recursivamente e pula o que nao e prototipo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinacoteca-unit-'));
  /** @type {(relative: string) => void} */
  const write = (relative) => {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '<h1>x</h1>');
  };

  write('b.html');
  write('a.html');
  write('telas/login.html');
  write('estilo.css');
  write('node_modules/pkg/index.html');
  write('.oculta/segredo.html');

  try {
    assert.deepEqual(await listScreens(dir), ['a.html', 'b.html', 'telas/login.html']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------- client/utils.js ---------- */

test('clamp prende o valor na faixa', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('encodePath escapa cada segmento e preserva as barras', () => {
  assert.equal(encodePath('pasta com espaco/a b.html'), 'pasta%20com%20espaco/a%20b.html');
  assert.equal(encodePath('a/b/c.html'), 'a/b/c.html');
});

test('previewUrl aponta para /preview com cache-busting', () => {
  assert.match(previewUrl('a b.html'), /^\/preview\/a%20b\.html\?t=\d+$/);
});

test('sortNames devolve copia ordenada sem mexer na entrada', () => {
  const input = ['b', 'a', 'C'];
  assert.deepEqual(sortNames(input), ['a', 'b', 'C']);
  assert.deepEqual(input, ['b', 'a', 'C']);
});

test('buildTree agrupa por pasta e guarda o caminho de cada nivel', () => {
  const root = buildTree(['a.html', 'telas/login.html', 'telas/admin/painel.html']);

  assert.deepEqual(root.files, ['a.html']);
  assert.deepEqual([...root.dirs.keys()], ['telas']);

  const telas = root.dirs.get('telas');
  assert.ok(telas);
  assert.equal(telas.path, 'telas');
  assert.deepEqual(telas.files, ['telas/login.html']);

  const admin = telas.dirs.get('admin');
  assert.ok(admin);
  assert.equal(admin.path, 'telas/admin');
  assert.deepEqual(admin.files, ['telas/admin/painel.html']);
});

/* ---------- computeXPath ---------- */

// Elementos falsos: `computeXPath` so le nodeName, id e a ligacao com pai e
// irmaos. Um objeto com esses campos basta — nao ha DOM envolvido.
/** @returns {Record<string, any>} */
function fakeTree() {
  /** @param {string} nodeName @param {{ id?: string, children?: any[] }} options */
  const el = (nodeName, { id = '', children = [] } = {}) => {
    const node = { nodeType: 1, nodeName, id, children, parentElement: null, previousElementSibling: null };
    children.forEach((child, index) => {
      child.parentElement = node;
      child.previousElementSibling = index > 0 ? children[index - 1] : null;
    });
    return node;
  };

  const first = el('P');
  const second = el('P');
  const marked = el('SPAN', { id: 'alvo' });
  const body = el('BODY', { children: [first, second, marked] });
  const html = el('HTML', { children: [body] });

  return { html, body, first, second, marked };
}

test('computeXPath usa @id quando existe', () => {
  assert.equal(computeXPath(fakeTree().marked), '//*[@id="alvo"]');
});

test('computeXPath conta so os irmaos de mesma tag', () => {
  const tree = fakeTree();
  assert.equal(computeXPath(tree.first), '/html[1]/body[1]/p[1]');
  assert.equal(computeXPath(tree.second), '/html[1]/body[1]/p[2]');
});

test('computeXPath para no <html>', () => {
  assert.equal(computeXPath(fakeTree().html), '/html[1]');
});
