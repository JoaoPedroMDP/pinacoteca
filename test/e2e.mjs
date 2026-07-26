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

/* ---------- Reorganizacao das telas ---------- */

// Arrasto do titulo com os mesmos eventos que o navegador mandaria. `dxExpr` e
// `dyExpr` sao avaliados na pagina, com `box` (a caixa do card na tela) e
// `other(arquivo)` a disposicao — assim o alvo do arrasto e calculado a partir
// do que esta desenhado, sem depender do zoom em que o board parou.
/** @type {(file: string, dxExpr: string, dyExpr: string) => string} */
const dragTitle = (file, dxExpr, dyExpr) => `(() => {
  const cards = [...document.querySelectorAll('.card')];
  const card = cards.find((c) => c.dataset.file === ${JSON.stringify(file)});
  const other = (name) => cards.find((c) => c.dataset.file === name).getBoundingClientRect();
  const box = card.getBoundingClientRect();
  const dx = ${dxExpr};
  const dy = ${dyExpr};

  const title = card.querySelector('.card-title');
  const handle = title.getBoundingClientRect();
  const x = handle.left + 8;
  const y = handle.top + handle.height / 2;
  const at = (clientX, clientY) => ({
    pointerId: 9, button: 0, bubbles: true, cancelable: true, clientX, clientY,
  });

  title.dispatchEvent(new PointerEvent('pointerdown', at(x, y)));
  title.dispatchEvent(new PointerEvent('pointermove', at(x + dx, y + dy)));
  title.dispatchEvent(new PointerEvent('pointerup', at(x + dx, y + dy)));

  return { left: card.style.left, top: card.style.top, invalid: card.classList.contains('is-invalid') };
})()`;

/** A organizacao salva no navegador, ja decodificada. */
const stored = async () => JSON.parse(await board.evaluate(`(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('pinacoteca:positions:'));
  return JSON.stringify(key ? JSON.parse(localStorage.getItem(key)) : null);
})()`));

process.stdout.write('\nReorganizacao das telas\n');

const moved = await board.evaluate(dragTitle('login.html', 'box.width * 3', '0'));
check('arrastar o titulo move o card', moved.left !== '0px', `left=${moved.left}`);
check('posicao livre nao fica marcada como invalida', moved.invalid === false);

const afterMove = await stored();
check('posicao valida vai para o localStorage',
  afterMove?.['login.html']?.x === Number.parseFloat(moved.left),
  JSON.stringify(afterMove));

const dropped = await board.evaluate(
  dragTitle('login.html', "other('dashboard.html').left - box.left + 10", "other('dashboard.html').top - box.top + 10"),
);
check('tela largada em cima de outra fica com contorno vermelho', dropped.invalid === true);
check('posicao invalida nao e salva',
  (await stored())?.['login.html']?.x === afterMove?.['login.html']?.x);

await board.evaluate("document.querySelector('[data-action=\"rearrange\"]').click()");
check('Reorganizar apaga a organizacao salva', (await stored()) === null);
check('Reorganizar desfaz a sobreposicao',
  (await board.evaluate("document.querySelectorAll('.card.is-invalid').length")) === 0);

/* ---------- Titulo e colunas no zoom afastado ---------- */

// Duas telas estreitas e altas entram no board ao lado das largas: e a mistura
// de larguras que revela o layout por coluna, e o zoom que o `Enquadrar` escolhe
// para caber tudo e o que revela a caixa do titulo.
const MOBILE = `<!doctype html><meta charset=utf-8>
<style>body{margin:0}div{width:300px;height:1800px;background:#cfe;margin:0 auto}</style><div></div>`;

fixture.write('a-mobile-1.html', MOBILE);
fixture.write('a-mobile-2.html', MOBILE);

process.stdout.write('\nTitulo e colunas no zoom afastado\n');

// As duas precisam ter chegado *e* medido: `every` sobre lista vazia passaria
// antes das telas existirem, e o resto da secao testaria o board antigo.
await checkEventually('telas estreitas entram medindo a propria largura', () => board.evaluate(`(() => {
  const narrow = [...document.querySelectorAll('.card')].filter((c) => c.dataset.file.startsWith('a-mobile'));
  return narrow.length === 2 && narrow.every((c) => c.style.width === '300px');
})()`));

// Uma coluna nunca reserva mais espaco do que a sua tela mais larga: a coluna
// seguinte comeca no fim da anterior + GAP.
/** @type {() => Promise<{ xs: number[], widths: number[] }>} */
const columnLayout = async () => JSON.parse(await board.evaluate(`(() => {
  const widthByX = new Map();
  for (const card of document.querySelectorAll('.card')) {
    const x = Math.round(card.offsetLeft);
    widthByX.set(x, Math.max(widthByX.get(x) ?? 0, card.offsetWidth));
  }
  const xs = [...widthByX.keys()].sort((a, b) => a - b);
  return JSON.stringify({ xs, widths: xs.map((x) => widthByX.get(x)) });
})()`));

const { xs, widths } = await columnLayout();
const GAP = 72;
check('coluna estreita nao herda a largura da tela desktop',
  xs.length > 1 && xs.every((x, i) => i === 0 || x - xs[i - 1] === widths[i - 1] + GAP),
  `x=${xs.join(',')} larguras=${widths.join(',')}`);

await board.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))");

// A caixa do titulo e a alca de arrasto. Se ela passar da largura do card na
// tela, tapa o vizinho e rouba o clique dele — era o bug do titulo largo.
/** @type {() => Promise<Array<{ file: string, excess: number, owner: string | null }>>} */
const titleBoxes = async () => JSON.parse(await board.evaluate(`(() => {
  const cards = [...document.querySelectorAll('.card')];
  return JSON.stringify(cards.map((card) => {
    const box = card.querySelector('.card-title').getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      file: card.dataset.file,
      excess: Math.round(box.width - card.getBoundingClientRect().width),
      owner: hit?.closest('.card')?.dataset.file ?? null,
    };
  }));
})()`));

const boxes = await titleBoxes();
const widest = boxes.reduce((worst, box) => (box.excess > worst.excess ? box : worst));
check('titulo nao passa da largura do card na tela', widest.excess <= 1,
  `${widest.file} sobra ${widest.excess}px`);

const stolen = boxes.filter((box) => box.owner !== box.file);
check('clique em cima do titulo pega a propria tela', stolen.length === 0,
  stolen.map((box) => `${box.file} -> ${box.owner}`).join(' | '));

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
