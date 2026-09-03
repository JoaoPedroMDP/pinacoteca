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

// O contorno verde marca a ultima tela mexida, e so ela: `solo.html` acabou de
// mudar, entao a marca saiu das telas que o CSS compartilhado tinha recarregado.
await checkEventually('so a ultima tela alterada fica marcada', () => board.evaluate(
  "[...document.querySelectorAll('.card.is-updated')].map((c) => c.dataset.file).join() === 'solo.html'"));

fixture.write('novo.html', '<!doctype html><h1>Novo</h1>');
await checkEventually('HTML novo vira card', async () => (await cardCount()) === 4);
await checkEventually('HTML novo entra na barra lateral', async () => (await sidebarCount()) === 4);

await checkEventually('tela nova nasce marcada', () => board.evaluate(
  "[...document.querySelectorAll('.card.is-updated')].map((c) => c.dataset.file).join() === 'novo.html'"));

fixture.remove('novo.html');
await checkEventually('HTML removido some do board', async () => (await cardCount()) === 3);
check('tela removida leva a marca junto',
  await board.evaluate("document.querySelectorAll('.card.is-updated').length === 0"));

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

const isPointerMode = "document.getElementById('viewport').classList.contains('is-pointer')";

await board.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))");
check('segurar espaco no modo ponteiro ativa o pan',
  (await board.evaluate(isPointerMode)) === false);

await board.evaluate("window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }))");
check('soltar o espaco volta ao modo ponteiro', await board.evaluate(isPointerMode));

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

/* ---------- Desfazer e refazer o arrasto ---------- */

process.stdout.write('\nDesfazer e refazer o arrasto\n');

/** @type {(file: string) => string} */
const cardLeft = (file) => `document.querySelector('.card[data-file="${file}"]').style.left`;

const beforeUndo = await board.evaluate(cardLeft('solo.html'));
const movedSolo = await board.evaluate(dragTitle('solo.html', 'box.width * 2', '0'));
check('arrasto de solo.html mudou a posicao', movedSolo.left !== beforeUndo);

await board.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))");
await checkEventually('Ctrl+Z desfaz o arrasto',
  async () => (await board.evaluate(cardLeft('solo.html'))) === beforeUndo);

await board.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }))");
await checkEventually('Ctrl+Shift+Z refaz o arrasto',
  async () => (await board.evaluate(cardLeft('solo.html'))) === movedSolo.left);

// Desfaz de novo para nao deixar solo.html arrastado atrapalhando os proximos testes.
await board.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))");
await checkEventually('estado volta ao original apos desfazer outra vez',
  async () => (await board.evaluate(cardLeft('solo.html'))) === beforeUndo);

// O arrasto fixa solo.html mesmo apos desfazer a posicao: Reorganizar devolve
// o layout automatico para os testes seguintes, que dependem dele.
await board.evaluate("document.querySelector('[data-action=\"rearrange\"]').click()");

/* ---------- Redimensionar telas ---------- */

// Arrasto de borda com os mesmos eventos que o navegador mandaria. O ponto de
// partida sai da caixa desenhada do frame, entao o teste nao depende do zoom em
// que o board parou; `dxExpr`/`dyExpr` sao px de *tela*, como o gesto real.
/** @type {(file: string, zone: string, dxExpr: string, dyExpr: string) => string} */
const dragFrameEdge = (file, zone, dxExpr, dyExpr) => `(() => {
  const card = document.querySelector('.card[data-file="${file}"]');
  const frame = card.querySelector('.card-frame');
  const shield = card.querySelector('.card-shield');
  const box = frame.getBoundingClientRect();
  const dx = ${dxExpr};
  const dy = ${dyExpr};

  const zone = ${JSON.stringify(zone)};
  const x = zone === 'bottom' ? box.left + box.width / 2 : box.right - 2;
  const y = zone === 'right' ? box.top + box.height / 2 : box.bottom - 2;
  const at = (clientX, clientY) => ({
    pointerId: 9, button: 0, bubbles: true, cancelable: true, clientX, clientY,
  });

  shield.dispatchEvent(new PointerEvent('pointerdown', at(x, y)));
  shield.dispatchEvent(new PointerEvent('pointermove', at(x + dx, y + dy)));
  shield.dispatchEvent(new PointerEvent('pointerup', at(x + dx, y + dy)));

  return {
    width: Number.parseFloat(card.style.width),
    height: Number.parseFloat(frame.style.height),
    invalid: card.classList.contains('is-invalid'),
  };
})()`;

/** @type {(file: string) => string} */
const cardSize = (file) => `(() => {
  const card = document.querySelector('.card[data-file="${file}"]');
  return {
    width: Number.parseFloat(card.style.width),
    height: Number.parseFloat(card.querySelector('.card-frame').style.height),
  };
})()`;

process.stdout.write('\nRedimensionar telas\n');

const autoSize = await board.evaluate(cardSize('solo.html'));

// Tira a tela de perto das outras antes de estica-la: assim o que o teste mede
// e o redimensionamento, e nao a colisao com o vizinho.
await board.evaluate(dragTitle('solo.html', 'box.width * 4', '0'));

const wider = await board.evaluate(dragFrameEdge('solo.html', 'right', '120', '0'));
check('arrastar a borda direita alarga o card', wider.width > autoSize.width,
  `${autoSize.width} -> ${wider.width}`);
check('borda direita nao mexe na altura', wider.height === autoSize.height);
check('tamanho livre nao fica marcado como invalido', wider.invalid === false);

const taller = await board.evaluate(dragFrameEdge('solo.html', 'corner', '40', '90'));
check('arrastar a quina muda as duas dimensoes',
  taller.width > wider.width && taller.height > wider.height,
  JSON.stringify(taller));

const afterResize = await stored();
check('tamanho valido vai para o localStorage',
  afterResize?.['solo.html']?.width === taller.width
  && afterResize?.['solo.html']?.height === taller.height,
  JSON.stringify(afterResize?.['solo.html']));

// A vizinha precisa estar fixa: uma tela ainda no fluxo automatico escorreria
// para longe no `layout()` do fim do gesto, e nao haveria sobreposicao nenhuma.
await board.evaluate(dragTitle('dashboard.html', '0', '0'));

// Encosta solo.html a esquerda de dashboard.html e depois estica por cima dela.
await board.evaluate(dragTitle('solo.html',
  "other('dashboard.html').left - box.left - box.width - 20",
  "other('dashboard.html').top - box.top"));
const overlapping = await board.evaluate(dragFrameEdge('solo.html', 'right', '200', '0'));
check('tela esticada por cima de outra fica com contorno vermelho', overlapping.invalid === true);
check('tamanho invalido nao e salvo',
  (await stored())?.['solo.html']?.width === taller.width,
  JSON.stringify((await stored())?.['solo.html']));

await board.evaluate("document.querySelector('[data-action=\"rearrange\"]').click()");

/* ---------- Menu de tamanho ---------- */

process.stdout.write('\nMenu de tamanho\n');

const openMenu = () => board.evaluate(
  "document.querySelector('.card[data-file=\"solo.html\"] .card-resize-btn').click()");

await openMenu();
check('botao do titulo abre o menu de tamanho', (await board.evaluate(
  "document.querySelectorAll('.card.has-open-menu').length")) === 1);

// O menu abre por cima do frame, que vem depois dele no DOM: quem esta no ponto
// e a prova de que da para clicar nas opcoes, e nao no vidro da tela.
const menuOnTop = await board.evaluate(`(() => {
  const menu = document.querySelector('.card[data-file="solo.html"] .card-size-menu');
  const box = menu.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return Boolean(hit?.closest('.card-size-menu'));
})()`);
check('menu aberto fica por cima do frame', menuOnTop === true);

await board.evaluate(
  "document.querySelector('.card[data-file=\"solo.html\"] .card-size-option[data-size=\"375x667\"]').click()");

const preset = await board.evaluate(cardSize('solo.html'));
check('preset redimensiona a tela', preset.width === 375 && preset.height === 667,
  JSON.stringify(preset));
check('menu fecha depois de escolher',
  (await board.evaluate("document.querySelectorAll('.card.has-open-menu').length")) === 0);

await openMenu();
await board.evaluate(
  "document.querySelector('.card[data-file=\"solo.html\"] .card-size-option[data-size=\"auto\"]').click()");

await checkEventually('Automatico devolve a tela a medida do conteudo', async () => {
  const size = await board.evaluate(cardSize('solo.html'));
  return size.width === autoSize.width && size.height === autoSize.height;
});
check('tamanho automatico sai do localStorage',
  (await stored())?.['solo.html']?.width === undefined);

// O cursor e o unico aviso de que aquela faixa agarra: sem ele o usuario nao
// descobre que a borda redimensiona.
const cursors = await board.evaluate(`(() => {
  const card = document.querySelector('.card[data-file="solo.html"]');
  const shield = card.querySelector('.card-shield');
  const box = card.querySelector('.card-frame').getBoundingClientRect();
  const move = (clientX, clientY) => {
    shield.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 9, bubbles: true, cancelable: true, clientX, clientY,
    }));
    return shield.style.cursor;
  };

  return {
    corner: move(box.right - 2, box.bottom - 2),
    right: move(box.right - 2, box.top + box.height / 2),
    bottom: move(box.left + box.width / 2, box.bottom - 2),
    middle: move(box.left + box.width / 2, box.top + box.height / 2),
  };
})()`);
check('cursor avisa a borda sob o mouse',
  cursors.corner === 'nwse-resize' && cursors.right === 'ew-resize'
  && cursors.bottom === 'ns-resize' && cursors.middle === '',
  JSON.stringify(cursors));

await board.evaluate("document.querySelector('[data-action=\"rearrange\"]').click()");

/* ---------- Pan nao seleciona texto ---------- */

// O sintoma era a selecao nativa do navegador: o arrasto do board grifava os
// titulos das telas em ordem de DOM. Quem impede isso e o `preventDefault` no
// pointerdown do pan, e `defaultPrevented` e a marca observavel dele.
process.stdout.write('\nPan nao seleciona texto\n');

const panPointerCancelled = await board.evaluate(`(() => {
  const viewport = document.getElementById('viewport');
  const at = (type) => new PointerEvent(type, {
    pointerId: 9, button: 0, bubbles: true, cancelable: true, clientX: 300, clientY: 300,
  });

  const down = at('pointerdown');
  viewport.dispatchEvent(down);
  viewport.dispatchEvent(at('pointerup')); // encerra o gesto: nao sobra pan pela metade
  return down.defaultPrevented;
})()`);
check('pointerdown do pan cancela o padrao do navegador', panPointerCancelled === true);

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

/* ---------- Silencio da pasta e medida tardia ---------- */

// O `load` do iframe nao e o fim da historia: conteudo montado por JS chega
// depois dele. Sem a segunda passada, este card ficaria com a altura medida no
// `load` — a do documento ainda vazio — ate o arquivo mudar de novo.
process.stdout.write('\nSilencio da pasta e medida tardia\n');

fixture.write('tardio.html', `<!doctype html><meta charset=utf-8><style>body{margin:0}</style>
<script>setTimeout(() => {
  const tall = document.createElement('div');
  tall.style.cssText = 'width:600px;height:2000px;background:#fed';
  document.body.append(tall);
}, 100);</script>`);

/** @type {() => Promise<number>} */
const cardHeight = async () => board.evaluate(
  "document.querySelector('.card[data-file=\"tardio.html\"]')?.querySelector('.card-frame').offsetHeight ?? 0");

await checkEventually('conteudo montado por JS ainda ajusta o card',
  async () => (await cardHeight()) > 1000);

// O `settled` e sobre a pasta inteira, nao sobre um arquivo: e o sinal de que
// quem estava escrevendo parou. Uma segunda conexao ao stream le o contrato
// direto, sem depender de como o board reage a ele.
await board.evaluate(`(() => {
  window.__settled = 0;
  const stream = new EventSource('/events');
  stream.addEventListener('message', (event) => {
    if (JSON.parse(event.data).type === 'settled') window.__settled += 1;
  });
  return true;
})()`);

await checkEventually('servidor avisa quando a pasta silencia', async () => {
  fixture.write('solo.html', `<!doctype html><meta charset=utf-8><h1>Solo ${Date.now()}</h1>`);
  return (await board.evaluate('window.__settled')) > 0;
}, { interval: 900, timeout: 20000 });

/* ---------- Largura nao encolhe a cada recarga ---------- */

// O bug era um degrau por recarga: o card media a propria largura, encolhia, e
// na recarga seguinte media dentro da largura ja encolhida. Um layout
// responsivo troca de breakpoint nessa hora e e medido mais estreito ainda, e a
// tela desce ate o minimo, espremida. A medida tem de acontecer sempre na
// viewport de referencia.
process.stdout.write('\nLargura nao encolhe a cada recarga\n');

/** @type {(tag: number) => string} */
const RESPONSIVE = (tag) => `<!doctype html><meta charset=utf-8>
<style>body{margin:0}div{width:600px;height:900px;margin:0 auto;background:#dfe}
@media (max-width: 700px){div{width:250px}}</style><div>v${tag}</div>`;

const responsiveWidth = async () => board.evaluate(
  "document.querySelector('.card[data-file=\"responsivo.html\"]')?.offsetWidth ?? 0");

fixture.write('responsivo.html', RESPONSIVE(1));
await checkEventually('tela responsiva entra medindo o breakpoint largo',
  async () => (await responsiveWidth()) === 600);

for (const round of [2, 3, 4]) {
  const before = await snapshot();
  fixture.write('responsivo.html', RESPONSIVE(round));

  await checkEventually(`recarga ${round} nao encolhe a tela responsiva`, async () => {
    const now = await snapshot();
    return reloaded(before, now, ['responsivo.html']) && (await responsiveWidth()) === 600;
  });
}

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
