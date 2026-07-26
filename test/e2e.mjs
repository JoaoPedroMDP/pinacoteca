// Teste ponta a ponta: sobe o servidor de verdade e dirige o Chrome headless
// para conferir o comportamento real de recarga.
//
// Requer Chrome instalado. Rode com `npm test`.
//
// Toda a encanacao (CDP, esperas, asercoes) vive em `harness.mjs` — aqui so se
// descreve o comportamento observavel. Ao adicionar um comportamento novo no
// board, adicione um `check` correspondente aqui.

import {
  check, checkEventually, createFixture, findChrome, report, startBoard,
} from './harness.mjs';

const PORT = 5230 + Math.floor(Math.random() * 200);
const CDP_PORT = 9400 + Math.floor(Math.random() * 200);

const chromeBinary = findChrome();
if (!chromeBinary) {
  process.stdout.write('Chrome nao encontrado — teste ignorado.\n');
  process.exit(0);
}

/* ---------- Prototipos de teste ---------- */

const fixture = createFixture();

fixture.write('css/tokens.css', ':root{--c:#333}\n');
fixture.write('css/base.css', '@import "tokens.css";\nbody{background:#eee}\n');
fixture.write('login.html', '<!doctype html><meta charset=utf-8><link rel=stylesheet href="css/base.css"><h1>Login</h1>');
fixture.write('dashboard.html', '<!doctype html><meta charset=utf-8><link rel=stylesheet href="css/base.css"><h1>Dash</h1>');
fixture.write('solo.html', '<!doctype html><meta charset=utf-8><h1>Solo</h1>');
fixture.write('.env', 'SECRET=nao-deve-vazar\n');
fixture.write('node_modules/pkg/a.css', 'body{}\n');

const board = await startBoard({ dir: fixture.dir, port: PORT, cdpPort: CDP_PORT, chromeBinary });
process.on('exit', () => {
  board.stop();
  fixture.cleanup();
});

/* ---------- Leitura do board ---------- */

// Mapa tela -> timestamp do src. O timestamp muda a cada recarga, entao comparar
// dois retratos diz exatamente quais telas recarregaram.
const SNAPSHOT = `JSON.stringify(Object.fromEntries(
  [...document.querySelectorAll('.card iframe')].map((frame) => {
    const url = new URL(frame.src);
    return [decodeURIComponent(url.pathname.replace('/preview/', '')), url.searchParams.get('t')];
  })
))`;

const snapshot = async () => JSON.parse(await board.evaluate(SNAPSHOT));
const cardCount = () => board.evaluate("document.querySelectorAll('.card iframe').length");
const sidebarCount = () => board.evaluate("document.querySelectorAll('.screen-item').length");

/**
 * Todas essas telas recarregaram desde o retrato anterior?
 * @param {Record<string, string>} before
 * @param {Record<string, string>} now
 * @param {string[]} files
 */
const reloaded = (before, now, files) => files.every((file) => now[file] !== before[file]);

/* ---------- Carga inicial ---------- */

process.stdout.write('\nCarga inicial\n');

await checkEventually('board monta um card por HTML', async () => (await cardCount()) === 3);
await checkEventually('barra lateral lista as telas', async () => (await sidebarCount()) === 3);

const initial = await snapshot();
check('node_modules fica de fora', !Object.keys(initial).some((file) => file.includes('node_modules')));

/* ---------- Recarga por asset ---------- */

// O map de assets do board e montado a partir do que cada iframe realmente
// buscou, e a segunda passada so acontece um tempo depois do `load`. Em vez de
// esperar um numero magico, o proprio predicado reescreve o CSS a cada tentativa:
// assim o teste passa assim que a coleta terminar, sem depender de quando.
const STIMULUS = { interval: 800, timeout: 20000 };

process.stdout.write('\nAsset compartilhado\n');

let previous = initial;
await checkEventually('recarrega as telas que usam o CSS', async () => {
  fixture.write('css/base.css', `@import "tokens.css";\nbody{background:#fff}/*${Date.now()}*/\n`);
  const now = await snapshot();
  return reloaded(previous, now, ['login.html', 'dashboard.html']);
}, STIMULUS);

const afterBase = await snapshot();
check('nao mexe na tela que nao usa', afterBase['solo.html'] === initial['solo.html']);

process.stdout.write('\nAsset alcancado so por @import\n');

previous = afterBase;
await checkEventually('recarrega pela cadeia de @import', async () => {
  fixture.write('css/tokens.css', `:root{--c:#000}/*${Date.now()}*/\n`);
  const now = await snapshot();
  return reloaded(previous, now, ['login.html', 'dashboard.html']);
}, STIMULUS);

check('nao mexe na tela que nao usa', (await snapshot())['solo.html'] === initial['solo.html']);

/* ---------- Ciclo de vida das telas ---------- */

process.stdout.write('\nHTML alterado, criado e removido\n');

fixture.write('solo.html', '<!doctype html><meta charset=utf-8><h1>Solo v2</h1>');
await checkEventually('HTML alterado recarrega o card',
  async () => (await snapshot())['solo.html'] !== initial['solo.html']);

fixture.write('novo.html', '<!doctype html><h1>Novo</h1>');
await checkEventually('HTML novo vira card', async () => (await cardCount()) === 4);
await checkEventually('HTML novo entra na barra lateral', async () => (await sidebarCount()) === 4);

fixture.remove('novo.html');
await checkEventually('HTML removido some do board', async () => (await cardCount()) === 3);

/* ---------- Interacao com um card ---------- */

// Gestos disparados na mao, do jeito que o navegador dispararia. O escudo sobre
// o iframe e quem recebe todos eles.
/** @type {(type: string, extra?: string) => string} */
const gesture = (type, extra = '') => `(() => {
  const card = [...document.querySelectorAll('.card')]
    .find((c) => c.querySelector('iframe').src.includes('login.html'));
  const shield = card.querySelector('.card-shield');
  const rect = shield.getBoundingClientRect();
  shield.dispatchEvent(new ${type}, {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + 12,
    bubbles: true,
    ${extra}
  }));
  return true;
})()`;

/** @type {(selector: string) => string} */
const loginCardHas = (selector) => `[...document.querySelectorAll('.card')]
  .find((c) => c.querySelector('iframe').src.includes('login.html'))
  .querySelector('iframe').contentDocument.querySelector('${selector}') !== null`;

process.stdout.write('\nModo ponteiro\n');

await board.evaluate("document.querySelector('[data-action=\"toggle-mode\"]').click()");
check('toolbar marca o modo ponteiro',
  await board.evaluate("document.getElementById('viewport').classList.contains('is-pointer')"));

await board.evaluate(gesture("PointerEvent('pointermove'"));
await checkEventually('hover destaca o elemento sob o cursor',
  () => board.evaluate(loginCardHas('.pina-focus')));

await board.evaluate("document.querySelector('[data-action=\"toggle-mode\"]').click()");
await checkEventually('sair do modo ponteiro limpa o destaque',
  async () => (await board.evaluate(loginCardHas('.pina-focus'))) === false);

process.stdout.write('\nXPath e modo interativo\n');

await board.evaluate(gesture("MouseEvent('click'", 'altKey: true,'));
await checkEventually('Alt+clique avisa que copiou o XPath', async () => {
  const toast = await board.evaluate(
    "document.getElementById('toast')?.classList.contains('is-visible') && document.getElementById('toast').textContent");
  return typeof toast === 'string' && toast.startsWith('XPath copiado');
});

await board.evaluate(gesture("MouseEvent('dblclick'"));
await checkEventually('duplo clique libera o card para interagir',
  () => board.evaluate("document.querySelectorAll('.card.is-interactive').length === 1"));

await board.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
await checkEventually('Esc devolve o controle ao board',
  () => board.evaluate("document.querySelectorAll('.card.is-interactive').length === 0"));

/* ---------- Servidor ---------- */

process.stdout.write('\nServidor\n');

await checkEventually('conexao SSE ao vivo',
  async () => (await board.evaluate("document.getElementById('connection').dataset.state")) === 'live');

/** @type {(url: string, method?: string) => Promise<number>} */
const status = async (url, method = 'GET') => (await fetch(url, { method })).status;
const base = `http://localhost:${PORT}`;

check('serve o prototipo', (await status(`${base}/preview/login.html`)) === 200);
check('serve o CSS do prototipo', (await status(`${base}/preview/css/base.css`)) === 200);
check('responde HEAD sem corpo', (await status(`${base}/preview/login.html`, 'HEAD')) === 200);
check('recusa metodo nao suportado', (await status(`${base}/preview/login.html`, 'POST')) === 405);
check('recusa arquivo oculto', (await status(`${base}/preview/.env`)) === 403);
check('recusa pasta ignorada', (await status(`${base}/preview/node_modules/pkg/a.css`)) === 403);
check('recusa path traversal', (await status(`${base}/preview/%2e%2e%2f%2e%2e%2fetc/passwd`)) === 403);

process.exit(report());
