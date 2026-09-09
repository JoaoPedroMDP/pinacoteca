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
import { DEFAULT_CONFIG, mergeConfig, publicConfig } from '../src/server/config.js';
import {
  agentEnv, buildDiff, escapingPath, hasAmbientCredential, hasCredential, translateMessage,
} from '../src/server/agent.js';
import { commentQueue, source } from '../src/client/state.js';
import {
  loadChatHistory, loadChatPrefs, pushChatHistory, loadChatDraft, saveChatDraft,
} from '../src/client/storage.js';
import {
  assignColumns, buildTree, clamp, computeXPath, encodePath, findOverlaps,
  clampSidebarWidth, previewUrl, rectsOverlap, resizeZoneAt, resolveXPath,
  serializeCommentQueue, snapToGrid, sortNames,
} from '../src/client/utils.js';

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

/* ---------- server/config.js ---------- */

test('mergeConfig sem nada devolve os padroes', () => {
  assert.deepEqual(mergeConfig(undefined, undefined), DEFAULT_CONFIG);
  assert.deepEqual(mergeConfig('lixo', 42), DEFAULT_CONFIG);
});

test('mergeConfig mantem o campo que o patch nao cita', () => {
  const current = { apiKey: 'sk-ant-x', model: 'claude-sonnet-5', effort: 'low', autoApprove: true, sendOnEnter: false };
  assert.deepEqual(mergeConfig(current, { effort: 'max' }), { ...current, effort: 'max' });
});

test('mergeConfig troca modelo e esforco desconhecidos pelo padrao', () => {
  const merged = mergeConfig({ model: 'gpt-9', effort: 'turbo' }, undefined);
  assert.equal(merged.model, DEFAULT_CONFIG.model);
  assert.equal(merged.effort, DEFAULT_CONFIG.effort);
  // Patch invalido nao apaga uma escolha valida ja gravada.
  assert.equal(mergeConfig({ model: 'claude-sonnet-5' }, { model: 'gpt-9' }).model, 'claude-sonnet-5');
});

test('mergeConfig ignora campo de tipo errado', () => {
  const merged = mergeConfig({ autoApprove: 'sim', sendOnEnter: 0, apiKey: 12 }, undefined);
  assert.equal(merged.autoApprove, DEFAULT_CONFIG.autoApprove);
  assert.equal(merged.sendOnEnter, DEFAULT_CONFIG.sendOnEnter);
  assert.equal(merged.apiKey, '');
});

test('mergeConfig apara a chave e aceita string vazia como apagar', () => {
  assert.equal(mergeConfig(undefined, { apiKey: '  sk-ant-x  ' }).apiKey, 'sk-ant-x');
  assert.equal(mergeConfig({ apiKey: 'sk-ant-x' }, { apiKey: '' }).apiKey, '');
});

test('publicConfig troca a chave por hasKey', () => {
  const config = mergeConfig(undefined, { apiKey: 'sk-ant-x' });
  const shown = publicConfig(config);
  assert.equal(shown.hasKey, true);
  assert.equal('apiKey' in shown, false);
  assert.equal(publicConfig(mergeConfig(undefined, undefined)).hasKey, false);
});

/* ---------- server/agent.js ---------- */

test('buildDiff mostra o conteudo novo de um Write', () => {
  const diff = buildDiff('Write', { file_path: '/tmp/a.html', content: 'um\ndois' });
  assert.equal(diff, '--- /tmp/a.html\n+um\n+dois');
});

test('buildDiff mostra os dois lados de um Edit', () => {
  const diff = buildDiff('Edit', { file_path: '/tmp/a.html', old_string: 'velho', new_string: 'novo' });
  assert.equal(diff, '--- /tmp/a.html\n-velho\n+novo');
});

test('buildDiff devolve vazio para tool que nao escreve', () => {
  assert.equal(buildDiff('Read', { file_path: '/tmp/a.html' }), '');
  assert.equal(buildDiff('Write', { file_path: '/tmp/a.html' }), '');
});

test('escapingPath deixa passar o que esta dentro da raiz', () => {
  assert.equal(escapingPath('/tmp/proto', { file_path: '/tmp/proto/a.html' }), '');
  assert.equal(escapingPath('/tmp/proto', { file_path: 'sub/a.html' }), '');
  assert.equal(escapingPath('/tmp/proto', { command: 'ls' }), '');
});

test('escapingPath pega o caminho que sai da raiz', () => {
  assert.equal(escapingPath('/tmp/proto', { file_path: '/etc/passwd' }), '/etc/passwd');
  assert.equal(escapingPath('/tmp/proto', { file_path: '../fora.html' }), '/tmp/fora.html');
  // Prefixo parecido nao e a mesma pasta.
  assert.equal(escapingPath('/tmp/proto', { path: '/tmp/proto2/a.html' }), '/tmp/proto2/a.html');
});

test('translateMessage vira text e thinking a partir dos eventos parciais', () => {
  /** @param {any} delta */
  const event = (delta) => translateMessage(/** @type {any} */ ({
    type: 'stream_event', event: { type: 'content_block_delta', delta },
  }));
  assert.deepEqual(event({ type: 'text_delta', text: 'oi' }), [{ type: 'text', delta: 'oi' }]);
  assert.deepEqual(event({ type: 'thinking_delta', thinking: 'hm' }), [{ type: 'thinking', delta: 'hm' }]);
  assert.deepEqual(event({ type: 'signature_delta', signature: 'x' }), []);
});

test('translateMessage pega so os tool_use da mensagem do assistente', () => {
  const events = translateMessage(/** @type {any} */ ({
    type: 'assistant',
    message: { content: [
      { type: 'text', text: 'ja mandei' },
      { type: 'tool_use', id: 'tu_1', name: 'Edit', input: { file_path: '/a.html' } },
    ] },
  }));
  assert.deepEqual(events, [{ type: 'tool', id: 'tu_1', name: 'Edit', input: { file_path: '/a.html' } }]);
});

test('translateMessage resume o tool_result e marca o erro', () => {
  const events = translateMessage(/** @type {any} */ ({
    type: 'user',
    message: { content: [
      { type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: 'pronto' }] },
      { type: 'tool_result', tool_use_id: 'tu_2', content: 'falhou', is_error: true },
    ] },
  }));
  assert.deepEqual(events, [
    { type: 'tool-result', id: 'tu_1', ok: true, summary: 'pronto' },
    { type: 'tool-result', id: 'tu_2', ok: false, summary: 'falhou' },
  ]);
});

test('translateMessage fecha o turno com done e avisa o resultado de erro', () => {
  assert.deepEqual(
    translateMessage(/** @type {any} */ ({ type: 'result', subtype: 'success', stop_reason: 'end_turn' })),
    [{ type: 'done', stopReason: 'end_turn' }],
  );
  assert.deepEqual(
    translateMessage(/** @type {any} */ ({
      type: 'result', subtype: 'error_max_turns', stop_reason: null, errors: ['acabou'],
    })),
    [{ type: 'error', message: 'acabou' }, { type: 'done', stopReason: 'error_max_turns' }],
  );
});

test('translateMessage ignora mensagem que nao interessa ao board', () => {
  assert.deepEqual(translateMessage(/** @type {any} */ ({ type: 'system', subtype: 'init' })), []);
});

/* ---------- server/agent.js: ambiente ---------- */

// `fileExists: () => false` em todo teste sem sessao de `claude login`: sem
// isso o default (`existsSync` de verdade) leria o disco de quem roda o
// teste, e a maquina do desenvolvedor poderia estar logada de verdade.
const noCredentialFile = () => false;

test('hasAmbientCredential pega qualquer credencial de ambiente aceita', () => {
  assert.equal(hasAmbientCredential({}, noCredentialFile), false);
  assert.equal(hasAmbientCredential({ ANTHROPIC_API_KEY: 'sk-ant-y' }, noCredentialFile), true);
  assert.equal(hasAmbientCredential({ CLAUDE_CODE_OAUTH_TOKEN: 'tok' }, noCredentialFile), true);
  assert.equal(hasAmbientCredential({ ANTHROPIC_AUTH_TOKEN: 'tok' }, noCredentialFile), true);
  assert.equal(hasAmbientCredential({ ANTHROPIC_PROFILE: 'work' }, noCredentialFile), true);
  assert.equal(hasAmbientCredential({ CLAUDE_CODE_OAUTH_TOKEN: '' }, noCredentialFile), false);
});

test('hasAmbientCredential tambem aceita a sessao gravada por `claude login`', () => {
  // Sem nenhuma variavel de ambiente — so o arquivo de credenciais, que e como
  // o login de verdade fica guardado.
  assert.equal(hasAmbientCredential({}, () => true), true);
});

test('hasCredential aceita a chave gravada antes de olhar o ambiente', () => {
  assert.equal(hasCredential('sk-ant-x', {}, noCredentialFile), true);
  assert.equal(hasCredential('', {}, noCredentialFile), false);
});

test('hasCredential aceita a credencial de ambiente quando nao ha chave gravada', () => {
  assert.equal(hasCredential('', { CLAUDE_CODE_OAUTH_TOKEN: 'tok' }, noCredentialFile), true);
  assert.equal(hasCredential('', { ANTHROPIC_API_KEY: 'sk-ant-y' }, noCredentialFile), true);
  // String vazia nao e credencial.
  assert.equal(hasCredential('', { ANTHROPIC_API_KEY: '' }, noCredentialFile), false);
  // Sessao de `claude login` (arquivo de credenciais) tambem basta.
  assert.equal(hasCredential('', {}, () => true), true);
});

test('agentEnv com chave configurada tira as credenciais de ambiente', () => {
  const before = { ...process.env };
  try {
    process.env.ANTHROPIC_AUTH_TOKEN = 'tok';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth';
    process.env.PATH_MARCADOR = 'preservado';

    const env = agentEnv('sk-ant-x');
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-x');
    assert.equal('ANTHROPIC_AUTH_TOKEN' in env, false);
    assert.equal('CLAUDE_CODE_OAUTH_TOKEN' in env, false);
    // So as credenciais saem: o resto do ambiente e o do processo.
    assert.equal(env.PATH_MARCADOR, 'preservado');
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, before);
  }
});

test('agentEnv sem chave configurada passa o ambiente inteiro', () => {
  const before = { ...process.env };
  try {
    process.env.ANTHROPIC_AUTH_TOKEN = 'tok';

    const env = agentEnv('');
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'tok');
    assert.equal('ANTHROPIC_API_KEY' in env, 'ANTHROPIC_API_KEY' in process.env);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, before);
  }
});

/* ---------- client/storage.js ----------

   As funcoes daqui nao sao puras: leem e escrevem `localStorage`, que nao
   existe no `node --test`. Em vez de extrair a decisao para outro modulo — ela
   e curta demais para pagar um arquivo novo —, o teste instala um
   `localStorage` de mentira. Sao dois: um que guarda de verdade, para a
   validacao e o limite, e um que so lanca, para o caminho tolerante a falha,
   que e o que segura o modo privado do navegador. */

/**
 * `localStorage` de mentira, em memoria.
 * @returns {Storage}
 */
function memoryStorage() {
  /** @type {Map<string, string>} */
  const items = new Map();
  return /** @type {Storage} */ ({
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
  });
}

/**
 * `localStorage` bloqueado: toda operacao lanca, como no modo privado com
 * cookies desligados.
 * @returns {Storage}
 */
function brokenStorage() {
  const boom = () => {
    throw new Error('bloqueado');
  };
  return /** @type {Storage} */ ({
    get length() {
      return boom();
    },
    clear: boom,
    key: boom,
    getItem: boom,
    setItem: boom,
    removeItem: boom,
  });
}

/**
 * Instala um `localStorage` e uma raiz observada para o teste seguinte.
 * @param {Storage} storage
 * @returns {Storage}
 */
function useStorage(storage) {
  /** @type {any} */ (globalThis).localStorage = storage;
  source.root = '/tmp/proto';
  return storage;
}

test('loadChatPrefs devolve o padrao quando nao ha nada gravado', () => {
  useStorage(memoryStorage());
  const prefs = loadChatPrefs();
  assert.equal(prefs.model, DEFAULT_CONFIG.model);
  assert.equal(prefs.effort, DEFAULT_CONFIG.effort);
  assert.equal(prefs.sendOnEnter, DEFAULT_CONFIG.sendOnEnter);
});

test('loadChatPrefs troca valor fora das listas pelo padrao', () => {
  const storage = useStorage(memoryStorage());
  storage.setItem('pinacoteca:chat-prefs', JSON.stringify({
    model: 'gpt-9', effort: 'turbo', sendOnEnter: 'talvez',
  }));

  const prefs = loadChatPrefs();
  assert.equal(prefs.model, DEFAULT_CONFIG.model);
  assert.equal(prefs.effort, DEFAULT_CONFIG.effort);
  assert.equal(prefs.sendOnEnter, DEFAULT_CONFIG.sendOnEnter);
});

test('loadChatPrefs aceita o que esta nas listas', () => {
  const storage = useStorage(memoryStorage());
  storage.setItem('pinacoteca:chat-prefs', JSON.stringify({
    model: 'claude-haiku-4-5', effort: 'low', sendOnEnter: false,
  }));

  assert.deepEqual(loadChatPrefs(), {
    model: 'claude-haiku-4-5', effort: 'low', sendOnEnter: false,
  });
});

test('loadChatPrefs sobrevive a JSON estragado e a storage bloqueado', () => {
  const storage = useStorage(memoryStorage());
  storage.setItem('pinacoteca:chat-prefs', '{nao e json');
  assert.equal(loadChatPrefs().model, DEFAULT_CONFIG.model);

  useStorage(brokenStorage());
  assert.equal(loadChatPrefs().model, DEFAULT_CONFIG.model);
});

test('loadChatHistory descarta entrada estragada', () => {
  const storage = useStorage(memoryStorage());

  storage.setItem('pinacoteca:chat-history:/tmp/proto', JSON.stringify(['ola', 3, null, 'mundo']));
  assert.deepEqual(loadChatHistory(), ['ola', 'mundo']);

  // Nao e lista: nao ha historico nenhum a aproveitar.
  storage.setItem('pinacoteca:chat-history:/tmp/proto', JSON.stringify({ ola: 1 }));
  assert.deepEqual(loadChatHistory(), []);

  storage.setItem('pinacoteca:chat-history:/tmp/proto', 'nem json');
  assert.deepEqual(loadChatHistory(), []);

  useStorage(brokenStorage());
  assert.deepEqual(loadChatHistory(), []);
});

test('pushChatHistory nao repete a mensagem anterior nem grava vazio', () => {
  useStorage(memoryStorage());

  pushChatHistory('ola');
  pushChatHistory('ola');
  pushChatHistory('');
  assert.deepEqual(loadChatHistory(), ['ola']);

  // Repeticao nao seguida entra: e mensagem nova na conversa.
  pushChatHistory('mundo');
  pushChatHistory('ola');
  assert.deepEqual(loadChatHistory(), ['ola', 'mundo', 'ola']);
});

test('pushChatHistory para de crescer e mantem as mais recentes', () => {
  useStorage(memoryStorage());

  const sent = [];
  for (let i = 0; i < 200; i += 1) {
    const text = `mensagem ${i}`;
    sent.push(text);
    pushChatHistory(text);
  }

  const history = loadChatHistory();
  assert.ok(history.length < sent.length, 'o historico tem de ter um teto');
  // O que sobrou e o fim do que foi enviado, na ordem: as mais recentes.
  assert.deepEqual(history, sent.slice(sent.length - history.length));
});

test('pushChatHistory com storage bloqueado nao derruba o compositor', () => {
  useStorage(brokenStorage());
  assert.doesNotThrow(() => pushChatHistory('ola'));
});

test('o rascunho e por raiz observada e a string vazia o apaga', () => {
  const storage = useStorage(memoryStorage());

  saveChatDraft('meio escrito');
  assert.equal(loadChatDraft(), 'meio escrito');

  source.root = '/tmp/outro';
  assert.equal(loadChatDraft(), '');

  source.root = '/tmp/proto';
  saveChatDraft('');
  assert.equal(loadChatDraft(), '');
  assert.equal(storage.getItem('pinacoteca:chat-draft:/tmp/proto'), null);

  useStorage(brokenStorage());
  assert.doesNotThrow(() => saveChatDraft('x'));
  assert.equal(loadChatDraft(), '');
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

/* ---------- Colunas do layout ---------- */

const SIDEBAR_LIMITS = { min: 200, max: 720, minCanvas: 320 };

test('clampSidebarWidth respeita os limites fixos', () => {
  assert.equal(clampSidebarWidth(400, 1600, SIDEBAR_LIMITS), 400);
  assert.equal(clampSidebarWidth(50, 1600, SIDEBAR_LIMITS), 200);
  assert.equal(clampSidebarWidth(5000, 1600, SIDEBAR_LIMITS), 720);
});

test('clampSidebarWidth guarda o espaco minimo do board', () => {
  // Janela de 900: o teto vira 900 - 320 = 580, abaixo do maximo fixo.
  assert.equal(clampSidebarWidth(720, 900, SIDEBAR_LIMITS), 580);
  assert.equal(clampSidebarWidth(300, 900, SIDEBAR_LIMITS), 300);
});

test('clampSidebarWidth deixa o board vencer na janela estreita', () => {
  // Janela de 400: nem o minimo da sidebar cabe junto do piso do board.
  assert.equal(clampSidebarWidth(300, 400, SIDEBAR_LIMITS), 80);
  // Janela menor que o proprio piso do board: a sidebar some em vez de negativa.
  assert.equal(clampSidebarWidth(300, 200, SIDEBAR_LIMITS), 0);
});

test('clampSidebarWidth arredonda e recusa numero invalido', () => {
  assert.equal(clampSidebarWidth(300.6, 1600, SIDEBAR_LIMITS), 301);
  assert.equal(clampSidebarWidth(NaN, 1600, SIDEBAR_LIMITS), 200);
});

test('snapToGrid arredonda para a celula mais proxima', () => {
  assert.equal(snapToGrid(0, 20), 0);
  assert.equal(snapToGrid(9, 20), 0);
  assert.equal(snapToGrid(11, 20), 20);
  assert.equal(snapToGrid(-11, 20), -20);
});

test('assignColumns manda cada item para a coluna mais curta', () => {
  assert.deepEqual(assignColumns([100, 100, 300, 100], 2), [[0, 2], [1, 3]]);
});

test('assignColumns preserva a ordem dentro da coluna', () => {
  assert.deepEqual(assignColumns([10, 10, 10, 10], 1), [[0, 1, 2, 3]]);
});

test('assignColumns nunca devolve menos de uma coluna', () => {
  assert.deepEqual(assignColumns([10], 0), [[0]]);
  assert.deepEqual(assignColumns([10], -3), [[0]]);
});

test('assignColumns aceita board vazio', () => {
  assert.deepEqual(assignColumns([], 3), [[], [], []]);
});

/* ---------- Sobreposicao de telas ---------- */

test('rectsOverlap pega tela em cima de tela', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(rectsOverlap(a, { x: 50, y: 50, width: 100, height: 100 }), true);
  assert.equal(rectsOverlap(a, { x: 10, y: 10, width: 10, height: 10 }), true, 'uma dentro da outra');
});

test('rectsOverlap deixa telas encostadas passarem', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(rectsOverlap(a, { x: 100, y: 0, width: 100, height: 100 }), false, 'lado a lado');
  assert.equal(rectsOverlap(a, { x: 0, y: 100, width: 100, height: 100 }), false, 'uma sob a outra');
  assert.equal(rectsOverlap(a, { x: 200, y: 200, width: 10, height: 10 }), false, 'longe');
});

test('findOverlaps marca as duas telas envolvidas e ignora as demais', () => {
  const invalid = findOverlaps([
    { file: 'a.html', x: 0, y: 0, width: 100, height: 100 },
    { file: 'b.html', x: 50, y: 50, width: 100, height: 100 },
    { file: 'c.html', x: 400, y: 0, width: 100, height: 100 },
  ]);

  assert.deepEqual([...invalid].sort(), ['a.html', 'b.html']);
});

test('findOverlaps devolve conjunto vazio quando esta tudo valido', () => {
  assert.equal(findOverlaps([
    { file: 'a.html', x: 0, y: 0, width: 100, height: 100 },
    { file: 'b.html', x: 172, y: 0, width: 100, height: 100 },
  ]).size, 0);
});

/* ---------- Bordas que redimensionam ---------- */

// Frame de 100x100 na tela, com folga de agarre de 8px.
const frame = { x: 0, y: 0, width: 100, height: 100 };

test('resizeZoneAt pega a quina quando as duas bordas estao perto', () => {
  assert.equal(resizeZoneAt(98, 98, frame, 8), 'corner');
  assert.equal(resizeZoneAt(103, 103, frame, 8), 'corner', 'um pouco alem da quina');
});

test('resizeZoneAt separa a borda direita da de baixo', () => {
  assert.equal(resizeZoneAt(98, 50, frame, 8), 'right');
  assert.equal(resizeZoneAt(50, 98, frame, 8), 'bottom');
});

test('resizeZoneAt ignora o miolo e o lado de fora', () => {
  assert.equal(resizeZoneAt(50, 50, frame, 8), null, 'miolo');
  assert.equal(resizeZoneAt(140, 50, frame, 8), null, 'longe a direita');
  assert.equal(resizeZoneAt(50, 140, frame, 8), null, 'longe abaixo');
  assert.equal(resizeZoneAt(-4, 50, frame, 8), null, 'a esquerda nao agarra');
  assert.equal(resizeZoneAt(50, -4, frame, 8), null, 'o topo nao agarra');
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

/* ---------- commentQueue ---------- */

test('commentQueue cria, atualiza e remove um item pela chave (file, xpath)', () => {
  commentQueue.clear();

  let items = commentQueue.get('a.html');
  assert.equal(items, undefined, 'comeca vazio');

  items = new Map();
  commentQueue.set('a.html', items);
  items.set('//*[@id="x"]', { xpath: '//*[@id="x"]', text: 'primeiro', status: 'draft', anchorPoint: null });
  assert.equal(commentQueue.get('a.html')?.get('//*[@id="x"]')?.text, 'primeiro');

  // Reclicar o mesmo XPath atualiza o mesmo item, nao cria um segundo.
  const existing = commentQueue.get('a.html')?.get('//*[@id="x"]');
  if (existing) existing.text = 'editado';
  assert.equal(commentQueue.get('a.html')?.size, 1);
  assert.equal(commentQueue.get('a.html')?.get('//*[@id="x"]')?.text, 'editado');

  // Outro arquivo com o mesmo XPath e um item independente.
  const others = new Map();
  commentQueue.set('b.html', others);
  others.set('//*[@id="x"]', { xpath: '//*[@id="x"]', text: 'outro arquivo', status: 'draft', anchorPoint: null });
  assert.equal(commentQueue.get('b.html')?.get('//*[@id="x"]')?.text, 'outro arquivo');
  assert.equal(commentQueue.get('a.html')?.get('//*[@id="x"]')?.text, 'editado');

  commentQueue.get('a.html')?.delete('//*[@id="x"]');
  assert.equal(commentQueue.get('a.html')?.size, 0);

  commentQueue.clear();
});

/* ---------- resolveXPath ---------- */

// Documento falso: `resolveXPath` so chama `doc.evaluate` e le `singleNodeValue`.
/** @param {unknown} value */
const fakeDoc = (value) => /** @type {any} */ ({ evaluate: () => ({ singleNodeValue: value }) });

test('resolveXPath devolve o elemento quando o XPath resolve', () => {
  const el = { nodeType: 1 };
  assert.equal(resolveXPath(fakeDoc(el), '//*[@id="x"]'), el);
});

test('resolveXPath devolve null quando o XPath nao resolve', () => {
  assert.equal(resolveXPath(fakeDoc(null), '//*[@id="sumiu"]'), null);
});

test('resolveXPath devolve null quando doc.evaluate lanca', () => {
  const doc = /** @type {any} */ ({ evaluate: () => { throw new Error('documento trocou de src'); } });
  assert.equal(resolveXPath(doc, '//*[@id="x"]'), null);
});

/* ---------- serializeCommentQueue ---------- */

/** @param {Array<[string, string, string, import('../src/client/state.js').CommentItem['status']]>} rows [file, xpath, text, status] */
function queueOf(rows) {
  /** @type {Map<string, Map<string, any>>} */
  const queue = new Map();
  for (const [file, xpath, text, status] of rows) {
    if (!queue.has(file)) queue.set(file, new Map());
    queue.get(file)?.set(xpath, { xpath, text, status, anchorPoint: null });
  }
  return queue;
}

test('serializeCommentQueue numera XPath e comentario por item', () => {
  const queue = queueOf([
    ['a.html', '/html[1]/body[1]/button[1]', 'ajusta a cor desse botao pra verde', 'confirmed'],
    ['a.html', '//*[@id="card-principal"]', 'aumenta o espacamento em baixo', 'draft'],
  ]);
  assert.equal(
    serializeCommentQueue(queue),
    '1. XPath: /html[1]/body[1]/button[1]\n   Comentário: ajusta a cor desse botao pra verde'
    + '\n\n2. XPath: //*[@id="card-principal"]\n   Comentário: aumenta o espacamento em baixo',
  );
});

test('serializeCommentQueue descarta itens sem referencia', () => {
  const queue = queueOf([
    ['a.html', '//*[@id="sumiu"]', 'texto perdido', 'unreferenced'],
    ['a.html', '//*[@id="fica"]', 'texto valido', 'confirmed'],
  ]);
  assert.equal(serializeCommentQueue(queue), '1. XPath: //*[@id="fica"]\n   Comentário: texto valido');
});

test('serializeCommentQueue devolve vazio sem item elegivel', () => {
  assert.equal(serializeCommentQueue(new Map()), '');
  assert.equal(serializeCommentQueue(queueOf([['a.html', '//*[@id="x"]', 'sumiu', 'unreferenced']])), '');
});
