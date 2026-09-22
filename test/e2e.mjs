// Teste ponta a ponta: sobe o servidor de verdade e dirige o Chrome headless
// para conferir o comportamento real de recarga.
//
// Requer Chrome instalado. Rode com `npm test`.
//
// Toda a encanacao (CDP, esperas, asercoes) vive em `harness.mjs` — aqui so se
// descreve o comportamento observavel. Ao adicionar um comportamento novo no
// board, adicione um `check` correspondente aqui.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  check, checkEventually, createFixture, findChrome, report, startBoard,
} from './harness.mjs';
import { historyDir } from '../src/server/history.js';

// A configuracao da conversa (chave da API inclusa) mora em
// `~/.config/pinacoteca`. O teste grava uma chave falsa nela, entao o XDG e
// apontado para uma pasta temporaria antes de o servidor subir — ele herda o
// ambiente deste processo. Rodar a suite nao pode sujar a config real da
// maquina.
const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pinacoteca-config-'));
process.env.XDG_CONFIG_HOME = configHome;

// O servidor tambem herda estas: se a maquina que roda o teste estiver logada
// no Claude Code (ou tiver uma chave solta no ambiente), `hasAmbientCredential`
// veria uma sessao que o teste nao gravou. Zera para o board nascer sem
// credencial nenhuma, e cada teste que precisar de uma a declara na mao.
for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_PROFILE']) {
  delete process.env[name];
}

// `hasAmbientCredential` tambem olha o `.credentials.json` do `claude login`
// (veja `agent.js`) — sem apontar para uma pasta vazia, uma maquina de
// desenvolvedor logada de verdade vazaria essa sessao para os testes.
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pinacoteca-claude-config-'));

process.on('exit', () => {
  try {
    fs.rmSync(configHome, { recursive: true, force: true });
  } catch {
    // Sobra em /tmp e o sistema limpa depois. Nao e motivo para falhar.
  }
});

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

/**
 * Mesmo gesto de `gesture`, mas mirando o card de um arquivo qualquer — usado
 * pela fila de comentarios, que precisa de mais de uma tela.
 * @type {(file: string, type: string, extra?: string) => string}
 */
const gestureOn = (file, type, extra = '') => `(() => {
  const card = [...document.querySelectorAll('.card')]
    .find((c) => c.querySelector('iframe').src.includes(${JSON.stringify(file)}));
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

await board.evaluate(gesture("MouseEvent('click'", 'ctrlKey: true, altKey: true,'));
await checkEventually('Ctrl+Alt+clique avisa que copiou o XPath', async () => {
  const toast = await board.evaluate(
    "document.getElementById('toast')?.classList.contains('is-visible') && document.getElementById('toast').textContent");
  return typeof toast === 'string' && toast.startsWith('XPath copiado');
});

await board.evaluate("document.getElementById('toast').textContent = ''");
await board.evaluate(gesture("MouseEvent('click'", 'altKey: true,'));
check('Alt+clique sozinho nao copia o XPath (o gesto de abrir a caixinha e testado a parte)',
  (await board.evaluate("document.getElementById('toast').textContent")) === '');

await board.evaluate(gesture("MouseEvent('dblclick'"));
await checkEventually('duplo clique libera o card para interagir',
  () => board.evaluate("document.querySelectorAll('.card.is-interactive').length === 1"));

// Teclado de dentro do iframe: com o foco no prototipo, os listeners do board
// nao disparam — quem atende sao os registrados na `contentWindow`.
/** @type {(expr: string) => string} */
const inLoginFrame = (expr) => `[...document.querySelectorAll('.card')]
  .find((c) => c.querySelector('iframe').src.includes('login.html'))
  .querySelector('iframe').contentWindow.${expr}`;

await board.evaluate(inLoginFrame("dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }))"));
check('Alt de dentro do card interativo segura o ponteiro', await board.evaluate(isPointerMode));
check('no ponteiro o escudo volta sobre a tela liberada',
  await board.evaluate(
    "getComputedStyle(document.querySelector('.card.is-interactive .card-shield')).display !== 'none'"));

await board.evaluate(inLoginFrame("dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }))"));
check('soltar o Alt dentro do card volta ao modo anterior',
  (await board.evaluate(isPointerMode)) === false);

await board.evaluate(inLoginFrame("dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))"));
await checkEventually('Esc de dentro do card devolve o controle ao board',
  () => board.evaluate("document.querySelectorAll('.card.is-interactive').length === 0"));

// De novo interativo, agora para conferir o mesmo Esc vindo do board.
await board.evaluate(gesture("MouseEvent('dblclick'"));
await checkEventually('duplo clique libera o card de novo',
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

/* ---------- Abas da sidebar ---------- */

process.stdout.write('\nAbas da sidebar\n');

check('comeca na aba Telas', await board.evaluate(
  "!document.getElementById('tab-screens').hidden && document.getElementById('tab-chat').hidden"));

await board.evaluate("document.querySelector('[data-tab=\"chat\"]').click()");
await checkEventually('clicar em Conversa esconde a lista de telas e mostra o compositor', async () => (
  await board.evaluate(
    "document.getElementById('tab-screens').hidden && !document.getElementById('tab-chat').hidden "
    + "&& getComputedStyle(document.getElementById('chat-composer')).display !== 'none'")));
check('a aba Conversa fica marcada selecionada', await board.evaluate(
  "document.querySelector('[data-tab=\"chat\"]').getAttribute('aria-selected') === 'true'"));

// A lista de telas tem `display: flex` no CSS, que vence o `hidden` da folha do
// agente. Sem o par `#tab-screens[hidden]` os dois paineis dividem a altura e a
// conversa abre so ate a metade — por isso a medida, e nao so o `hidden`.
//
// O footer (`.sidebar-footer`) mora fora dos dois paineis, para ficar visivel
// nas duas abas — entao a conversa ocupa o que resta abaixo das abas *e*
// acima do footer, nao a sidebar inteira.
check('a conversa ocupa a sidebar abaixo das abas e acima do footer', await board.evaluate(`(() => {
  const screensHeight = document.getElementById('tab-screens').getBoundingClientRect().height;
  const chat = document.getElementById('tab-chat').getBoundingClientRect().height;
  const tabs = document.getElementById('sidebar-tabs').getBoundingClientRect().height;
  const footer = document.querySelector('.sidebar-footer').getBoundingClientRect().height;
  const sidebar = document.getElementById('sidebar').getBoundingClientRect().height;
  return screensHeight === 0 && Math.abs(chat - (sidebar - tabs - footer)) < 1;
})()`));

check('o icone de engrenagem continua visivel na aba Conversa', await board.evaluate(
  "!!document.getElementById('settings-open').offsetHeight"));

await board.evaluate("document.querySelector('[data-tab=\"screens\"]').click()");
await checkEventually('voltar para Telas mostra a lista de novo e esconde a conversa', async () => (
  await board.evaluate(
    "!document.getElementById('tab-screens').hidden && document.getElementById('tab-chat').hidden")));

/* ---------- Largura da sidebar ---------- */

process.stdout.write('\nLargura da sidebar\n');

/**
 * Arrasta o puxador ate `x` px da borda esquerda da janela.
 * @type {(x: number) => string}
 */
const dragResizer = (x) => `(() => {
  const grip = document.getElementById('sidebar-resizer');
  const box = grip.getBoundingClientRect();
  const y = box.top + box.height / 2;
  const at = (clientX) => ({
    pointerId: 7, button: 0, bubbles: true, cancelable: true, clientX, clientY: y,
  });

  grip.dispatchEvent(new PointerEvent('pointerdown', at(box.left)));
  grip.dispatchEvent(new PointerEvent('pointermove', at(${x})));
  grip.dispatchEvent(new PointerEvent('pointerup', at(${x})));

  return document.getElementById('sidebar').getBoundingClientRect().width;
})()`;

const widened = await board.evaluate(dragResizer(420));
check('arrastar o puxador alarga a sidebar', widened === 420, `largura=${widened}`);

check('a largura escolhida vai para o localStorage',
  (await board.evaluate("localStorage.getItem('pinacoteca:sidebar-width')")) === '420');

const clamped = await board.evaluate(dragResizer(40));
check('o puxador nao encolhe a sidebar abaixo do minimo', clamped === 200, `largura=${clamped}`);

// A restauracao na carga nao entra aqui: o harness nao recarrega a pagina, e
// so o que se pode observar e a gravacao (checada acima) mais o clamp, que tem
// teste de unidade proprio.
await board.evaluate(dragResizer(420));

/* ---------- Conversa ---------- */

process.stdout.write('\nConversa\n');

await board.evaluate("document.querySelector('[data-tab=\"chat\"]').click()");

/* ---------- Subabas da conversa ---------- */

const chatSubtab = () => board.evaluate(
  "document.querySelector('#chat-tabs [aria-selected=\"true\"]').dataset.chatTab");
const listVisible = async () => !(await board.evaluate(
  "document.getElementById('chat-conversations').hidden"));
const panelVisible = async () => !(await board.evaluate(
  "document.getElementById('chat-panel').hidden"));
/** @type {(name: string) => Promise<any>} */
const showSubtab = (name) => board.evaluate(
  `document.querySelector('#chat-tabs [data-chat-tab="${name}"]').click()`);

// A pasta de teste nasce sem conversa gravada nenhuma, entao a aba Conversa
// abre onde se escolhe uma, e nao num log vazio.
check('sem conversa gravada, a aba abre na subaba Conversas', (await chatSubtab()) === 'list');
check('e a lista aparece no lugar do compositor',
  (await listVisible()) && !(await panelVisible()));
check('a lista vazia explica como comecar', await board.evaluate(
  "!document.getElementById('chat-conversations-empty').hidden"));

await showSubtab('chat');
check('clicar em Chat mostra o log e esconde a lista',
  (await panelVisible()) && !(await listVisible()));
check('e a subaba Chat fica marcada selecionada', (await chatSubtab()) === 'chat');

/**
 * Digita caractere a caractere, como o compositor ve o usuario escrevendo: e o
 * evento `input` que alimenta o auto-crescimento e a pilha de desfazer.
 * @param {string} text
 */
const type = (text) => board.evaluate(`(() => {
  const input = document.getElementById('chat-input');
  input.focus();
  for (const char of ${JSON.stringify(text)}) {
    input.value += char;
    input.selectionStart = input.selectionEnd = input.value.length;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
})()`);

/**
 * @param {string} key
 * @param {Record<string, boolean>} [modifiers]
 */
const press = (key, modifiers = {}) => board.evaluate(`(() => {
  const input = document.getElementById('chat-input');
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', Object.assign(
    { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true },
    ${JSON.stringify(modifiers)},
  )));
})()`);

const clearComposer = () => board.evaluate(`(() => {
  const input = document.getElementById('chat-input');
  input.value = '';
  input.selectionStart = input.selectionEnd = 0;
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

const composerValue = () => board.evaluate("document.getElementById('chat-input').value");
const composerHeight = () => board.evaluate("document.getElementById('chat-input').offsetHeight");
const sentCount = () => board.evaluate("document.querySelectorAll('#chat-log .chat-msg.is-user').length");
// O badge fica aceso (aria-pressed=true) no modo Shift+Enter, o inverso de "Enter envia".
const sendsOnEnter = () => board.evaluate(
  "document.getElementById('chat-send-mode').getAttribute('aria-pressed') === 'false'");
const toggleSendMode = () => board.evaluate("document.getElementById('chat-send-mode').click()");

// `initChat` mede o compositor com a aba escondida (`scrollHeight` da 0 sem
// layout) — sem recalcular ao trocar de aba, o campo fica travado em 0px ate
// o primeiro evento `input`, e parece cortado pela metade.
const heightOnTabShow = await composerHeight();
check('o compositor ja nasce com altura normal ao abrir a aba Conversa',
  heightOnTabShow > 20, `altura=${heightOnTabShow}`);

check('a conversa comeca vazia', !(await board.evaluate("document.getElementById('chat-empty').hidden")));

if (!(await sendsOnEnter())) await toggleSendMode();

await type('ola');
await press('Enter', { shiftKey: true });
check('com Enter enviando, Shift+Enter nao envia', (await sentCount()) === 0);

await press('Enter');
await checkEventually('Enter envia e a bolha do usuario aparece no log',
  async () => (await sentCount()) === 1 && (await composerValue()) === '');
check('o aviso de log vazio some na primeira mensagem',
  await board.evaluate("document.getElementById('chat-empty').hidden"));

await toggleSendMode();
await checkEventually('alternar o badge de envio avisa por toast', async () => {
  const toast = await board.evaluate(
    "document.getElementById('toast')?.classList.contains('is-visible') && document.getElementById('toast').textContent");
  return toast === 'Envio com Shift+Enter ativado';
});
await type('mundo');
await press('Enter');
check('com Enter desligado, Enter nao envia', (await sentCount()) === 1);
check('e o texto continua no compositor', (await composerValue()) === 'mundo');

await press('Enter', { shiftKey: true });
await checkEventually('com Enter desligado, Shift+Enter envia',
  async () => (await sentCount()) === 2 && (await composerValue()) === '');
await toggleSendMode();

await type('um dois');
await press('z', { ctrlKey: true });
check('Ctrl+Z devolve o texto anterior', (await composerValue()) === 'um');

await clearComposer();
await press('ArrowUp');
check('seta pra cima traz a ultima mensagem enviada', (await composerValue()) === 'mundo');

await clearComposer();
const spaceNotPanned = await board.evaluate(`(() => {
  const input = document.getElementById('chat-input');
  input.focus();
  return input.dispatchEvent(new KeyboardEvent('keydown', {
    key: ' ', bubbles: true, cancelable: true,
  }));
})()`);
check('espaco no compositor nao vira atalho de pan (evento nao cancelado)', spaceNotPanned === true);
await type('um espaco');
check('e digitar espaco no compositor funciona', (await composerValue()) === 'um espaco');

await clearComposer();
const oneLine = await composerHeight();
await type('a\nb\nc\nd\ne');
await checkEventually('o compositor cresce com varias linhas',
  async () => (await composerHeight()) > oneLine);
await clearComposer();

// Trocar de subaba nao pode custar o que o usuario estava escrevendo: o
// rascunho e do compositor daquela pasta, e nao de uma conversa.
await type('rascunho que nao pode sumir');
await showSubtab('list');
await showSubtab('chat');
check('o rascunho sobrevive a ida e volta entre as subabas',
  (await composerValue()) === 'rascunho que nao pode sumir');
await clearComposer();

// Os blocos do log so aparecem quando o transporte existe, e ele e da tarefa
// seguinte. O modulo ja esta carregado pelo board, entao o `import` devolve a
// mesma instancia e as funcoes desenham no `#chat-log` de verdade.
await board.evaluate(`(async () => {
  const chat = await import('/app/chat.js');
  chat.appendAssistantDelta('res');
  chat.appendAssistantDelta('posta');
  chat.appendToolUse({ id: 't1', name: 'Edit', input: { file: 'login.html' } });
  chat.updateToolResult({ id: 't1', ok: true, summary: 'gravado' });
  chat.appendPermissionRequest({
    requestId: 'p1', toolName: 'Write', input: { file: 'novo.html' },
    diff: '@@ -1 +1 @@\\n-antigo\\n+novo',
  });
})()`);

await checkEventually('a resposta do assistente cresce em streaming numa bolha so', async () => (
  await board.evaluate(
    "document.querySelectorAll('#chat-log .chat-msg.is-assistant').length === 1"
    + " && document.querySelector('#chat-log .chat-msg.is-assistant').textContent === 'resposta'")));

check('o bloco de ferramenta fecha em ok', await board.evaluate(
  "document.querySelector('#chat-log .chat-tool.is-ok .chat-tool-status').textContent === 'gravado'"));

check('o diff do pedido de permissao pinta adicao e remocao', await board.evaluate(
  "document.querySelectorAll('#chat-log .chat-diff-line.is-add').length === 1"
  + " && document.querySelectorAll('#chat-log .chat-diff-line.is-del').length === 1"));

await board.evaluate("document.querySelector('#chat-log .chat-permission-reject').click()");
await checkEventually('rejeitar fecha o pedido de permissao', async () => (
  await board.evaluate(
    "!!document.querySelector('#chat-log .chat-permission.is-rejected')"
    + " && document.querySelector('#chat-log .chat-permission-approve').disabled")));

// O log conta a historia na ordem em que ela aconteceu: texto que chega depois
// de um bloco de ferramenta abre bolha nova no fim, em vez de voltar a crescer
// na bolha que estava aberta antes dele.
await board.evaluate("import('/app/chat.js').then((m) => m.appendAssistantDelta('depois da tool'))");

await checkEventually('texto depois de uma ferramenta abre bolha nova no fim do log', async () => (
  await board.evaluate(`(() => {
    const bubbles = document.querySelectorAll('#chat-log .chat-msg.is-assistant');
    return bubbles.length === 2
      && bubbles[0].textContent === 'resposta'
      && bubbles[1].textContent === 'depois da tool'
      && document.getElementById('chat-log').lastElementChild === bubbles[1];
  })()`)));

// Acao igual, mesmo arquivo, logo em seguida: uma linha so com contador. Um
// arquivo diferente abre linha nova.
await board.evaluate(`(async () => {
  const chat = await import('/app/chat.js');
  chat.appendToolUse({ id: 'r1', name: 'Edit', input: { file_path: 'login.html' } });
  chat.updateToolResult({ id: 'r1', ok: true, summary: 'gravado' });
  chat.appendToolUse({ id: 'r2', name: 'Edit', input: { file_path: 'login.html' } });
  chat.updateToolResult({ id: 'r2', ok: true, summary: 'gravado' });
  chat.appendToolUse({ id: 'r3', name: 'Edit', input: { file_path: 'login.html' } });
  chat.updateToolResult({ id: 'r3', ok: true, summary: 'gravado' });
  chat.appendToolUse({ id: 'r4', name: 'Edit', input: { file_path: 'signup.html' } });
  chat.updateToolResult({ id: 'r4', ok: true, summary: 'gravado' });
})()`);

await checkEventually('tres edits seguidos no mesmo arquivo viram um bloco com contador',
  async () => await board.evaluate(`(() => {
    const blocks = [...document.querySelectorAll('#chat-log .chat-tool')];
    const repeated = blocks[blocks.length - 2];
    const other = blocks[blocks.length - 1];
    return repeated.querySelector('.chat-tool-count').textContent === '\u00d73'
      && repeated.querySelector('.chat-tool-input').textContent.includes('login.html')
      && !other.querySelector('.chat-tool-count')
      && other.querySelector('.chat-tool-input').textContent.includes('signup.html');
  })()`));

// Bloco no meio quebra a sequencia: o Edit seguinte nao pode ser contado no
// que ficou acima do texto.
await board.evaluate(`(async () => {
  const chat = await import('/app/chat.js');
  chat.appendAssistantDelta('no meio');
  chat.appendToolUse({ id: 'r5', name: 'Edit', input: { file_path: 'signup.html' } });
})()`);

await checkEventually('um bloco no meio quebra a aglomeracao',
  async () => await board.evaluate(`(() => {
    const blocks = [...document.querySelectorAll('#chat-log .chat-tool')];
    const last = blocks[blocks.length - 1];
    return !last.querySelector('.chat-tool-count')
      && last.previousElementSibling.classList.contains('chat-msg');
  })()`));

/* ---------- Transporte da conversa ---------- */

process.stdout.write('\nTransporte da conversa\n');

const settingsOpen = () => board.evaluate("document.getElementById('settings-dialog').open");
const keyFieldVisible = () => board.evaluate(
  "!document.getElementById('chat-key-input').hidden "
  + "&& !document.getElementById('chat-key-save').hidden");
const stopVisible = () => board.evaluate("!document.getElementById('chat-stop').hidden");
/** @type {(selector: string) => Promise<string>} */
const lastOf = (selector) => board.evaluate(
  `([...document.querySelectorAll(${JSON.stringify(selector)})].pop() || {}).textContent`);
const lastAssistant = () => lastOf('#chat-log .chat-msg.is-assistant');
const errorCount = () => board.evaluate("document.querySelectorAll('#chat-log .chat-error').length");
const sessionId = () => board.evaluate("import('/app/state.js').then((m) => m.chat.sessionId)");

check('sem chave nem sessao logada, a rota nao aponta credencial de ambiente',
  (await (await fetch(`http://localhost:${PORT}/api/chat/config`)).json()).hasAmbientCredential === false);

/* ---------- Transcript da conversa ---------- */

// Sem chave configurada, o turno morre no comeco, com um erro — e e justamente
// por isso que ele serve aqui: exercita o caminho inteiro da gravacao (abrir o
// arquivo, registrar a mensagem do usuario, fechar no `done`) sem chamar a API
// da Anthropic. O historico mora no `XDG_CONFIG_HOME` temporario deste teste.
const chatApi = `http://localhost:${PORT}/api/chat`;

/** @type {(route: string, body: unknown) => Promise<Response>} */
const postChat = (route, body) => fetch(`${chatApi}${route}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const conversationList = async () => (await (await fetch(`${chatApi}/conversations`)).json()).conversations;

// A lista ja pode ter o que as secoes anteriores conversaram, entao o que se
// afere aqui e sempre a *entrada desta* conversa, nunca o tamanho da lista.
/** @type {(list: any[], id: string) => any} */
const entryOf = (list, id) => list.find((entry) => entry.id === id);
const listBefore = await conversationList();
check('a lista de conversas vem como lista', Array.isArray(listBefore));

const turnBody = await (await postChat('/message', { text: 'grave este turno' })).text();
const recordedSession = (turnBody.match(/"sessionId":"([^"]+)"/) || [])[1];
check('o turno sem chave termina em erro e em `done`',
  turnBody.includes('"type":"error"') && turnBody.includes('"type":"done"'));

await checkEventually('a conversa aparece na lista, com o titulo da primeira mensagem', async () => {
  const entry = entryOf(await conversationList(), recordedSession);
  return entry?.title === 'grave este turno' && entry.messageCount === 1;
});
check('e ela entra no topo, como a mais recente',
  (await conversationList())[0].id === recordedSession);

const recorded = await (await fetch(`${chatApi}/conversations/${recordedSession}`)).json();
const recordedTypes = recorded.events.map(/** @param {any} event */ (event) => event.type);
check('o transcript guarda a mensagem do usuario, o erro e o fim do turno',
  recordedTypes.join(',') === 'user,error,done', recordedTypes.join(','));
check('e a mensagem gravada e a que foi mandada',
  recorded.events[0].text === 'grave este turno' && recorded.sessionId === recordedSession);
check('a sessao nao vira linha do transcript: ela ja e o nome do arquivo',
  !recordedTypes.includes('session'));

check('conversa que nao existe responde 404',
  (await fetch(`${chatApi}/conversations/sessao-que-nao-existe`)).status === 404);

// Um segundo turno na mesma sessao continua o mesmo arquivo, em vez de abrir
// outro — e o que faz a conversa ser uma so entre recarregamentos.
await postChat('/message', { sessionId: recordedSession, text: 'segunda mensagem' });
await checkEventually('o turno seguinte continua a mesma conversa', async () => {
  const list = await conversationList();
  return list.length === listBefore.length + 1 && entryOf(list, recordedSession)?.messageCount === 2;
});

check('apagar responde que apagou',
  (await (await postChat('/conversations/delete', { id: recordedSession })).json()).ok === true);
check('a conversa apagada some da lista', !entryOf(await conversationList(), recordedSession));
check('e pedi-la depois responde 404',
  (await fetch(`${chatApi}/conversations/${recordedSession}`)).status === 404);

/* ---------- Fila de comentarios em modo ponteiro ---------- */

process.stdout.write('\nFila de comentarios\n');

const commentBoxTextarea = () => board.evaluate("document.querySelector('.pina-comment-box textarea')?.value ?? null");
const balloonCount = () => board.evaluate("document.querySelectorAll('.pina-comment-balloon').length");
const sendingBalloonCount = () => board.evaluate("document.querySelectorAll('.pina-comment-balloon.is-sending').length");
const queueListText = () => board.evaluate("document.getElementById('chat-queue-list').textContent");
const queueHidden = () => board.evaluate("document.getElementById('chat-queue').hidden");

/** @param {string} text */
const typeInBox = (text) => board.evaluate(`(() => {
  const textarea = document.querySelector('.pina-comment-box textarea');
  textarea.value = ${JSON.stringify(text)};
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

/** @param {Record<string, boolean>} [modifiers] */
const pressInBox = (modifiers = {}) => board.evaluate(`(() => {
  document.querySelector('.pina-comment-box textarea').dispatchEvent(new KeyboardEvent('keydown', Object.assign(
    { key: 'Enter', bubbles: true, cancelable: true },
    ${JSON.stringify(modifiers)},
  )));
})()`);

await board.evaluate("document.querySelector('[data-action=\"toggle-mode\"]').click()"); // liga o ponteiro

await board.evaluate(gestureOn('login.html', "PointerEvent('pointerdown'", 'button: 0,'));
await checkEventually('clique simples em modo ponteiro abre a caixinha', async () => (await commentBoxTextarea()) === '');

// Digitar muta o item e redesenha a fila inteira. Se o redesenho remontasse o
// `<textarea>`, a composicao de uma tecla morta (`\u00b4` seguido de `a`) seria
// cancelada no meio e o acento nunca fecharia em `\u00e1` — o no precisa ser o
// mesmo, e ainda com o foco, depois da tecla.
await board.evaluate(`(() => {
  const textarea = document.querySelector('.pina-comment-box textarea');
  textarea.dataset.marca = 'antes';
  textarea.focus();
})()`);

await typeInBox('linha 1');
await checkEventually('a lista "a enviar" acompanha o rascunho ao vivo',
  async () => (await queueListText()).includes('linha 1'));

check('digitar nao remonta a caixinha: o mesmo textarea continua na tela',
  (await board.evaluate("document.querySelector('.pina-comment-box textarea')?.dataset.marca ?? null")) === 'antes');
check('e ele nao perde o foco, que e o que preserva a composicao do acento',
  await board.evaluate("document.activeElement === document.querySelector('.pina-comment-box textarea')"));

await pressInBox({ shiftKey: true });
check('Shift+Enter nao confirma: a caixinha continua aberta', (await balloonCount()) === 0);

await typeInBox('linha 1\nlinha 2 — ajusta a cor pra verde');
await pressInBox();
await checkEventually('Enter (sem Shift) confirma e mostra o balao', async () => (await balloonCount()) === 1);
check('a caixinha fecha ao confirmar', (await commentBoxTextarea()) === null);

await board.evaluate(gestureOn('login.html', "PointerEvent('pointerdown'", 'button: 0,'));
await checkEventually('reclicar o no ja comentado reabre a caixinha com o texto salvo',
  async () => (await commentBoxTextarea()) === 'linha 1\nlinha 2 — ajusta a cor pra verde');
check('nao duplica item: so um balao/caixinha para aquele no',
  (await board.evaluate("document.querySelectorAll('.pina-comment-balloon, .pina-comment-box').length")) === 1);

await pressInBox();
await checkEventually('confirmar de novo devolve ao balao', async () => (await balloonCount()) === 1);

await board.evaluate("document.querySelector('.pina-comment-balloon .pina-comment-remove').click()");
await checkEventually('remover pelo balao tira o item do board', async () => (await balloonCount()) === 0);
await checkEventually('e da lista "a enviar" do chat', async () => await queueHidden());

// Recria o item para testar a remocao pelo outro lado (lista do chat).
await board.evaluate(gestureOn('login.html', "PointerEvent('pointerdown'", 'button: 0,'));
await typeInBox('de novo');
await pressInBox();
await checkEventually('item recriado para o teste de remocao pelo chat', async () => (await balloonCount()) === 1);

await board.evaluate("document.querySelector('.chat-queue-item-remove').click()");
await checkEventually('remover pela lista do chat tira o balao do board', async () => (await balloonCount()) === 0);
check('e a lista "a enviar" esconde', await queueHidden());

// Alt sozinho (sem Ctrl): ativa o ponteiro e abre a caixinha, nao copia XPath.
await board.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' }))");
await board.evaluate(gestureOn('dashboard.html', "PointerEvent('pointerdown'", 'button: 0, altKey: true,'));
await checkEventually('Alt+clique sozinho abre a caixinha em vez de copiar o XPath',
  async () => (await commentBoxTextarea()) === '');
await board.evaluate("window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }))");
await board.evaluate("document.querySelector('.pina-comment-box .pina-comment-remove').click()");

/* ---------- Envio da fila e ciclo de carregamento ---------- */

process.stdout.write('\nEnvio da fila e ciclo de carregamento\n');

await board.evaluate("import('/app/chat.js').then((m) => { window.__sentTexts = []; m.setTransport({ send: (text) => window.__sentTexts.push(text) }); })");

await board.evaluate(gestureOn('solo.html', "PointerEvent('pointerdown'", 'button: 0,'));
await typeInBox('envia isso');
await pressInBox();
await checkEventually('item confirmado em solo.html, pronto para o envio', async () => (await balloonCount()) === 1);

await board.evaluate("document.querySelector('[data-tab=\"chat\"]').click()");
await board.evaluate("document.getElementById('chat-send').click()");

await checkEventually('enviar serializa XPath e comentario numa unica mensagem', async () => {
  const texts = await board.evaluate('window.__sentTexts');
  return Array.isArray(texts) && texts.length === 1
    && texts[0].startsWith('1. XPath:') && texts[0].includes('envia isso');
});

check('o balao entra em carregamento ao enviar', (await sendingBalloonCount()) === 1);
check('a fila trava: balao em carregamento perde o "x"',
  (await board.evaluate("document.querySelector('.pina-comment-balloon.is-sending .pina-comment-remove')")) === null);

await board.evaluate("import('/app/chat.js').then((m) => m.setTurnRunning(false))");
await checkEventually('turno terminado remove o balao em carregamento', async () => (await balloonCount()) === 0);
check('e some da lista "a enviar"', await queueHidden());

/* ---------- Perguntas do agente ---------- */

process.stdout.write('\nPerguntas do agente\n');

await board.evaluate(`(async () => {
  const chat = await import('/app/chat.js');
  window.__answers = [];
  chat.setTransport({
    respondToQuestion: (requestId, reply) => window.__answers.push({ requestId, reply }),
  });
  chat.appendQuestionRequest({
    requestId: 'q1',
    questions: [{
      question: 'Qual layout?',
      header: 'Layout',
      options: [
        { label: 'Grade', description: 'cards lado a lado' },
        { label: 'Lista', description: 'um embaixo do outro' },
      ],
    }],
  });
})()`);

await checkEventually('a pergunta do agente vira um bloco com as opcoes clicaveis', async () => (
  await board.evaluate("document.querySelectorAll('#chat-log .chat-question .chat-question-option').length === 2")));

await board.evaluate("document.querySelectorAll('.chat-question-option')[1].click()");
check('clicar numa opcao a marca', await board.evaluate(
  "document.querySelectorAll('.chat-question-option')[1].getAttribute('aria-pressed') === 'true'"));

await board.evaluate("document.querySelector('.chat-question-send').click()");
await checkEventually('responder leva a escolha ao transporte, chaveada pelo enunciado', async () => {
  const sent = await board.evaluate('window.__answers');
  return Array.isArray(sent) && sent.length === 1 && sent[0].requestId === 'q1'
    && sent[0].reply.allow === true
    && sent[0].reply.answers['Qual layout?'] === 'Lista';
});

check('o bloco trava depois de respondido', await board.evaluate(
  "!!document.querySelector('.chat-question.is-answered')"
  + " && document.querySelector('.chat-question-send').disabled"));

// Uma chamada traz ate quatro perguntas, e elas sao um pedido so: um bloco, um
// Responder, todas as respostas juntas. `multiSelect` acumula escolhas na mesma
// pergunta; a de escolha unica troca.
await board.evaluate(`(async () => {
  const chat = await import('/app/chat.js');
  chat.appendQuestionRequest({
    requestId: 'q3',
    questions: [
      {
        question: 'Qual layout?',
        header: 'Layout',
        options: [{ label: 'Grade', description: '' }, { label: 'Lista', description: '' }],
      },
      {
        question: 'Quais telas?',
        header: 'Telas',
        multiSelect: true,
        options: [
          { label: 'Login', description: '' },
          { label: 'Dashboard', description: '' },
          { label: 'Perfil', description: '' },
        ],
      },
    ],
  });
})()`);

const lastQuestionBlock = "[...document.querySelectorAll('#chat-log .chat-question')].at(-1)";

await checkEventually('as duas perguntas entram no mesmo bloco, com os campos de cada uma', async () => (
  await board.evaluate(`(() => {
    const block = ${lastQuestionBlock};
    return block.querySelectorAll('.chat-question-item').length === 2
      && block.querySelectorAll('.chat-question-other').length === 2
      && block.querySelectorAll('.chat-question-option').length === 5
      && block.querySelectorAll('.chat-question-send').length === 1;
  })()`)));

await board.evaluate(`(() => {
  const block = ${lastQuestionBlock};
  const options = [...block.querySelectorAll('.chat-question-option')];
  options[0].click();          // Grade, escolha unica
  options[2].click();          // Login, multipla
  options[3].click();          // Dashboard, multipla
})()`);

check('multiSelect acumula escolhas e a escolha unica nao e afetada', await board.evaluate(
  `(() => {
    const block = ${lastQuestionBlock};
    const pressed = [...block.querySelectorAll('.chat-question-option[aria-pressed="true"]')]
      .map((option) => option.textContent);
    return pressed.length === 3 && pressed.includes('Grade')
      && pressed.includes('Login') && pressed.includes('Dashboard');
  })()`));

await board.evaluate(`${lastQuestionBlock}.querySelector('.chat-question-send').click()`);
await checkEventually('as duas respostas vao juntas, cada uma na chave dela', async () => {
  const sent = await board.evaluate('window.__answers');
  const last = Array.isArray(sent) ? sent.at(-1) : null;
  return Boolean(last) && last.requestId === 'q3' && last.reply.allow === true
    && last.reply.answers['Qual layout?'] === 'Grade'
    && last.reply.answers['Quais telas?'] === 'Login, Dashboard';
});

// O "x" nao e uma resposta vazia: ele recusa a tool, e o modelo segue sem ela.
await board.evaluate(`(async () => {
  const chat = await import('/app/chat.js');
  chat.appendQuestionRequest({
    requestId: 'q4',
    questions: [{
      question: 'Prossigo?',
      header: 'Rumo',
      options: [{ label: 'Sim', description: '' }, { label: 'Nao', description: '' }],
    }],
  });
})()`);

await checkEventually('a pergunta traz um "x" para cancelar', async () => (
  await board.evaluate(`!!${lastQuestionBlock}.querySelector('.chat-question-cancel')`)));

await board.evaluate(`${lastQuestionBlock}.querySelector('.chat-question-cancel').click()`);
await checkEventually('o "x" recusa a pergunta em vez de responde-la vazia', async () => {
  const sent = await board.evaluate('window.__answers');
  const last = Array.isArray(sent) ? sent.at(-1) : null;
  return Boolean(last) && last.requestId === 'q4' && last.reply.allow === false
    && Object.keys(last.reply.answers).length === 0;
});

check('e o bloco cancelado trava junto com o proprio "x"', await board.evaluate(
  `(() => {
    const block = ${lastQuestionBlock};
    return block.classList.contains('is-answered')
      && block.querySelector('.chat-question-cancel').disabled
      && block.querySelector('.chat-question-send').disabled;
  })()`));

// Pergunta sem nada que o painel saiba desenhar nao pode sumir calada: o turno
// do outro lado esta parado esperando resposta.
await board.evaluate(`(async () => {
  const chat = await import('/app/chat.js');
  chat.appendQuestionRequest({ requestId: 'q2', questions: ['nao e pergunta'] });
})()`);

await checkEventually('pergunta indesenhavel vira erro no log e e respondida vazia', async () => {
  const sent = await board.evaluate('window.__answers');
  const last = Array.isArray(sent) ? sent.at(-1) : null;
  return Boolean(last) && last.requestId === 'q2' && last.reply.allow === false
    && Object.keys(last.reply.answers).length === 0;
});

/* ---------- Reancoragem apos reload do prototipo ---------- */

process.stdout.write('\nReancoragem apos reload do prototipo\n');

await board.evaluate(gestureOn('dashboard.html', "PointerEvent('pointerdown'", 'button: 0,'));
await typeInBox('ainda existe?');
await pressInBox();
await checkEventually('item confirmado em dashboard.html antes do reload', async () => (await balloonCount()) === 1);

fixture.write('dashboard.html', '<!doctype html><meta charset=utf-8><link rel=stylesheet href="css/base.css"><p>Sem H1</p>');
await checkEventually('XPath que sumiu vira item sem referencia na bandeja', async () => (
  await board.evaluate("document.getElementById('pina-unreferenced-tray')?.hidden === false")));
check('o balao some do card quando o item fica sem referencia', (await balloonCount()) === 0);

fixture.write('dashboard.html', '<!doctype html><meta charset=utf-8><link rel=stylesheet href="css/base.css"><h1>Dash</h1>');
await checkEventually('XPath que volta reancora sozinho e o balao reaparece',
  async () => (await balloonCount()) === 1);
check('a bandeja de sem referencia esvazia', await board.evaluate("document.getElementById('pina-unreferenced-tray').hidden"));

await board.evaluate("document.querySelector('.pina-comment-balloon .pina-comment-remove').click()");

// Sem referencia de novo, agora para testar o arrasto manual da bandeja ate
// outro no (inclusive noutra tela) reancorando o item.
await board.evaluate(gestureOn('dashboard.html', "PointerEvent('pointerdown'", 'button: 0,'));
await typeInBox('reancora na mao');
await pressInBox();
await checkEventually('item confirmado de novo, para o teste de arrasto', async () => (await balloonCount()) === 1);

fixture.write('dashboard.html', '<!doctype html><meta charset=utf-8><link rel=stylesheet href="css/base.css"><p>Sem H1</p>');
await checkEventually('fica sem referencia, pronto para o arrasto', async () => (
  await board.evaluate("document.getElementById('pina-unreferenced-tray')?.hidden === false")));

/** @param {string} file */
const dragUnreferencedTo = (file) => board.evaluate(`(() => {
  const entry = document.querySelector('.pina-tray-entry');
  const card = [...document.querySelectorAll('.card')]
    .find((c) => c.querySelector('iframe').src.includes(${JSON.stringify(file)}));
  const shield = card.querySelector('.card-shield');
  const rect = shield.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + 12;
  entry.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 11, button: 0, bubbles: true, cancelable: true, clientX, clientY,
  }));
  window.dispatchEvent(new PointerEvent('pointerup', {
    pointerId: 11, bubbles: true, cancelable: true, clientX, clientY,
  }));
})()`);

await dragUnreferencedTo('solo.html');
await checkEventually('arrastar o item sem referencia ate um no valido reancora',
  async () => (await balloonCount()) === 1);
check('a bandeja de sem referencia esvazia depois do arrasto',
  await board.evaluate("document.getElementById('pina-unreferenced-tray').hidden"));

await board.evaluate("document.querySelector('.pina-comment-balloon .pina-comment-remove').click()");
await board.evaluate("document.querySelector('[data-action=\"toggle-mode\"]').click()"); // desliga o ponteiro
await board.evaluate("import('/app/chat.js').then((m) => m.setTransport(null))");
await board.evaluate("document.querySelector('[data-tab=\"screens\"]').click()");

/* ---------- Tamanho global ---------- */

// Fica por ultimo entre os testes de board de proposito: o bloco recarrega a
// pagina para conferir o que sobrevive a sessao, e uma recarga no meio zeraria o
// estado de que os testes seguintes dependem.

process.stdout.write('\nTamanho global\n');

// Os testes acima deixaram telas fixas e arrastadas; aqui o que se mede e o
// efeito do gesto global, entao o board volta ao layout automatico primeiro.
await board.evaluate("document.querySelector('[data-action=\"rearrange\"]').click()");

// E deixaram a sidebar esticada perto do maximo. Com ela assim o board sobra
// estreito, a toolbar inteira fica mais larga do que ele e transborda por baixo
// da sidebar — o que atinge os botoes que ja existiam tanto quanto o novo.
// Medir o encaixe do menu ali seria medir esse aperto, e nao o gesto.
await board.evaluate("import('/app/controls.js').then((m) => m.setSidebarWidth(240))");

const toggleGlobalMenu = () => board.evaluate(
  "document.querySelector('[data-action=\"global-size\"]').click()");
const globalMenuOpen = () => board.evaluate(
  "document.getElementById('global-size-menu').classList.contains('is-open')");
/** @type {(size: string) => Promise<unknown>} */
const chooseGlobalSize = (size) => board.evaluate(
  `document.querySelector('#global-size-menu .card-size-option[data-size="${size}"]').click()`);

/**
 * Tamanho de *todas* as telas do board — as asercoes daqui sao em massa.
 * @type {() => Promise<Array<{ file: string, width: number, height: number }>>}
 */
const allSizes = async () => JSON.parse(await board.evaluate(`JSON.stringify(
  [...document.querySelectorAll('.card')].map((card) => ({
    file: card.dataset.file,
    width: Number.parseFloat(card.style.width),
    height: Number.parseFloat(card.querySelector('.card-frame').style.height),
  }))
)`));

/** @type {(sizes: Array<{ width: number, height: number }>, w: number, h: number) => boolean} */
const allAt = (sizes, w, h) => sizes.length > 1 && sizes.every((s) => s.width === w && s.height === h);

await toggleGlobalMenu();
check('botao da toolbar abre o menu global', (await globalMenuOpen()) === true);

check('menu global lista Automatico e os quatro presets',
  (await board.evaluate("document.querySelectorAll('#global-size-menu .card-size-option').length")) === 5);

// A toolbar mora colada na borda de baixo: o menu tem de subir, e o ponto do
// meio dele precisa ser dele mesmo — senao as opcoes nao recebem clique.
const globalMenuPlacement = await board.evaluate(`(() => {
  const menu = document.getElementById('global-size-menu');
  const box = menu.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return {
    aboveToolbar: box.bottom <= document.querySelector('.toolbar').getBoundingClientRect().top,
    clickable: Boolean(hit?.closest('#global-size-menu')),
    hit: hit ? hit.tagName + '.' + hit.className : null,
    box: { left: box.left, top: box.top, width: box.width, height: box.height },
  };
})()`);
check('menu global abre acima da toolbar', globalMenuPlacement.aboveToolbar === true);
check('menu global recebe o clique nas opcoes', globalMenuPlacement.clickable === true,
  JSON.stringify(globalMenuPlacement));

await toggleGlobalMenu();
check('ativar o botao de novo fecha o menu global', (await globalMenuOpen()) === false);

await toggleGlobalMenu();
await board.evaluate("document.getElementById('viewport').click()");
check('clique fora fecha o menu global', (await globalMenuOpen()) === false);

// Uma tela esticada a mao antes do gesto: o preset global tem de alcancar ela
// tambem, e nao so as que estavam no tamanho do conteudo.
await board.evaluate(dragFrameEdge('solo.html', 'right', '120', '0'));

await toggleGlobalMenu();
await chooseGlobalSize('375x667');
check('menu global fecha depois de escolher', (await globalMenuOpen()) === false);

const mobileAll = await allSizes();
check('preset global leva todas as telas ao mesmo tamanho', allAt(mobileAll, 375, 667),
  JSON.stringify(mobileAll));
check('nenhuma tela fica sobreposta depois do gesto global',
  (await board.evaluate("document.querySelectorAll('.card.is-invalid').length")) === 0);

const storedGlobal = await stored();
check('o preset global vai para o localStorage em todas as telas',
  mobileAll.every((s) => storedGlobal?.[s.file]?.width === 375 && storedGlobal[s.file]?.height === 667),
  JSON.stringify(storedGlobal));

await toggleGlobalMenu();
await chooseGlobalSize('1920x1080');
check('trocar de preset global redimensiona tudo de novo', allAt(await allSizes(), 1920, 1080));

// O segundo gesto e o que quebrava: o primeiro fixava todas as telas, entao o
// layout nao tinha mais o que acomodar e elas cresciam umas por cima das outras
// — vermelhas, e sem gravar o tamanho, porque tela sobreposta nao persiste.
check('trocar de preset global nao sobrepoe nada',
  (await board.evaluate("document.querySelectorAll('.card.is-invalid').length")) === 0);

const storedSecond = await stored();
check('o segundo preset global tambem vai para o localStorage',
  (await allSizes()).every((s) => storedSecond?.[s.file]?.width === 1920
    && storedSecond[s.file]?.height === 1080),
  JSON.stringify(storedSecond));

// O global e um atalho, nao uma trava: o menu de cada card continua valendo.
await board.evaluate("document.querySelector('.card[data-file=\"solo.html\"] .card-resize-btn').click()");
await board.evaluate(
  "document.querySelector('.card[data-file=\"solo.html\"] .card-size-option[data-size=\"768x1024\"]').click()");

const afterOverride = await allSizes();
check('menu de card vale por cima do global naquela tela',
  afterOverride.find((s) => s.file === 'solo.html')?.width === 768);
check('o ajuste de uma tela nao arrasta as outras',
  afterOverride.filter((s) => s.file !== 'solo.html').every((s) => s.width === 1920),
  JSON.stringify(afterOverride));

// O arranjo manual atravessa os gestos globais: ser fixada por um gesto global
// nao conta como o usuario ter escolhido aquele ponto, mas arrastar conta.
await board.evaluate(dragTitle('login.html', 'box.width * 3', 'box.height'));
const draggedTo = await board.evaluate(cardLeft('login.html'));

await toggleGlobalMenu();
await chooseGlobalSize('375x667');
await toggleGlobalMenu();
await chooseGlobalSize('1920x1080');

check('dois gestos globais seguidos preservam o arrasto do usuario',
  (await board.evaluate(cardLeft('login.html'))) === draggedTo,
  `${draggedTo} -> ${await board.evaluate(cardLeft('login.html'))}`);

// Duas telas que o usuario encostou uma perto da outra enquanto estavam
// estreitas, e que so colidem depois de crescer: ele mirou os pontos, mas nao
// mirou a colisao.
await toggleGlobalMenu();
await chooseGlobalSize('375x667');

await board.evaluate(dragTitle('dashboard.html', '0', '0'));
await board.evaluate(dragTitle('solo.html',
  "other('dashboard.html').left - box.left + 500",
  "other('dashboard.html').top - box.top"));
check('lado a lado em mobile as duas ainda sao validas',
  (await board.evaluate("document.querySelectorAll('.card.is-invalid').length")) === 0);

await toggleGlobalMenu();
await chooseGlobalSize('1920x1080');
check('telas arrastadas que colidiriam ao crescer sao separadas',
  (await board.evaluate("document.querySelectorAll('.card.is-invalid').length")) === 0);

fixture.write('global-novo.html', '<!doctype html><meta charset=utf-8><h1>Novo sob o global</h1>');
await checkEventually('tela que aparece depois nasce no tamanho global', async () => {
  const novo = (await allSizes()).find((s) => s.file === 'global-novo.html');
  return novo?.width === 1920 && novo.height === 1080;
});

await toggleGlobalMenu();
await chooseGlobalSize('auto');
await checkEventually('Automatico global devolve todas ao tamanho do conteudo', async () => {
  const sizes = await allSizes();
  // A medida do conteudo nunca passa da viewport de referencia (`CARD_WIDTH`),
  // entao nenhuma tela pode ter sobrado no preset de 1920 — nem a que tinha sido
  // ajustada sozinha, em 768.
  return sizes.length > 1 && sizes.every((s) => s.width <= 1280);
});

fixture.write('global-auto-novo.html', '<!doctype html><meta charset=utf-8><h1>Novo sob o automatico</h1>');
await checkEventually('com Automatico ativo a tela nova e medida pelo conteudo', async () => {
  const novo = (await allSizes()).find((s) => s.file === 'global-auto-novo.html');
  return novo !== undefined && novo.width <= 1280;
});

// A escolha global e da sessao. O que ela produziu — o tamanho de cada tela —
// persiste; a escolha em si, nao.
await toggleGlobalMenu();
await chooseGlobalSize('375x667');
check('preset global reaplicado antes da recarga', allAt(await allSizes(), 375, 667));

// O `setTimeout` deixa o `Runtime.evaluate` responder antes de a navegacao
// destruir o contexto; recarregar direto perderia a resposta.
await board.evaluate('setTimeout(() => location.reload(), 0)');

await checkEventually('telas reaparecem no tamanho aplicado depois da recarga',
  async () => allAt(await allSizes(), 375, 667));

fixture.write('pos-recarga.html', '<!doctype html><meta charset=utf-8><h1>Depois da recarga</h1>');
await checkEventually('depois da recarga a escolha global nao vale para tela nova', async () => {
  const novo = (await allSizes()).find((s) => s.file === 'pos-recarga.html');
  return novo !== undefined && novo.width !== 375;
});

// "Reorganizar" limpa tambem o que o gesto global fixou — senao o board ficaria
// manual para sempre depois do primeiro preset.
await board.evaluate("document.querySelector('[data-action=\"rearrange\"]').click()");
check('Reorganizar depois de um preset global apaga a organizacao salva',
  (await stored()) === null);
await checkEventually('Reorganizar depois de um preset global devolve o tamanho do conteudo',
  async () => {
    const sizes = await allSizes();
    return sizes.length > 1 && sizes.every((s) => s.width <= 1280);
  });

/* ---------- Conversas: lista, replay e troca ----------

   Esta secao vai por ultimo de proposito: ela recarrega a pagina, e um reload
   no meio da suite apagaria o estado que as secoes seguintes montaram (fila de
   comentarios, modo ponteiro, posicoes). */

// Daqui pra frente a conversa e de verdade: a mensagem sai da interface, passa
// pelo servidor e volta gravada. A chave falsa gravada la atras sai antes, para
// o turno morrer aqui mesmo, sem nenhuma chamada a API da Anthropic — o que se
// afere e a persistencia, nao a resposta do modelo.
await fetch(`${chatApi}/config`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ apiKey: '' }),
});
await board.evaluate("import('/app/chat-client.js').then((m) => m.connectChat())");

/** @type {() => Promise<Array<{ id: string, title: string, open: boolean, disabled: boolean }>>} */
const conversationRows = () => board.evaluate(
  "[...document.querySelectorAll('.chat-conversation')].map((row) => ({"
  + " id: row.dataset.id,"
  + " title: row.querySelector('.chat-conversation-title').textContent,"
  + " open: row.classList.contains('is-open'),"
  + " disabled: row.querySelector('.chat-conversation-open').disabled }))");
const logText = () => board.evaluate("document.getElementById('chat-log').textContent");

/** @type {(text: string) => Promise<void>} */
const sendForReal = async (text) => {
  await showSubtab('chat');
  await clearComposer();
  await type(text);
  await press('Enter');
  await checkEventually(`o turno de "${text}" termina`, async () => !(await stopVisible()));
};

await board.evaluate("document.getElementById('chat-new').click()");
await sendForReal('primeira conversa de verdade');

await checkEventually('a conversa enviada pela interface entra na lista, marcada como aberta',
  async () => {
    const rows = await conversationRows();
    return rows.some((row) => row.title === 'primeira conversa de verdade' && row.open);
  });

const firstId = await board.evaluate("import('/app/state.js').then((m) => m.chat.sessionId)");

// Recarregar e o motivo de tudo isto existir.
await board.reload();
await board.evaluate("document.querySelector('[data-tab=\"chat\"]').click()");

await checkEventually('depois do reload a aba volta na subaba Chat', async () => (await chatSubtab()) === 'chat');
await checkEventually('e a conversa volta com a mensagem que foi mandada',
  async () => (await logText()).includes('primeira conversa de verdade'));
check('a sessao volta com ela, para o agente continuar de onde parou',
  (await board.evaluate("import('/app/state.js').then((m) => m.chat.sessionId)")) === firstId);
check('o replay nao liga turno nenhum', !(await stopVisible()));

// Conversa nova: log vazio, sem sessao, e nada na lista ate a primeira mensagem.
await showSubtab('list');
const rowsBeforeNew = (await conversationRows()).length;
await board.evaluate("document.getElementById('chat-new').click()");
check('a conversa nova abre o Chat vazio e sem sessao',
  (await panelVisible())
  && !(await logText()).includes('primeira conversa de verdade')
  && (await board.evaluate("import('/app/state.js').then((m) => m.chat.sessionId)")) === null);
await showSubtab('list');
check('e conversa vazia nao entra na lista', (await conversationRows()).length === rowsBeforeNew);

await sendForReal('segunda conversa de verdade');
await checkEventually('a segunda conversa entra na lista', async () => (
  (await conversationRows()).some((row) => row.title === 'segunda conversa de verdade')));

// Voltar para a primeira nao pode misturar as duas.
await showSubtab('list');
await board.evaluate(
  `[...document.querySelectorAll('.chat-conversation')]
    .find((row) => row.dataset.id === ${JSON.stringify(firstId)})
    .querySelector('.chat-conversation-open').click()`);

await checkEventually('abrir outra conversa troca o log inteiro', async () => {
  const text = await logText();
  return text.includes('primeira conversa de verdade') && !text.includes('segunda conversa de verdade');
});
check('e a subaba volta para o Chat', (await chatSubtab()) === 'chat');

// Turno em andamento: a lista fica olhavel e intocavel.
await board.evaluate("import('/app/chat.js').then((m) => m.setTurnRunning(true))");
await showSubtab('list');
check('com um turno rodando, a lista aparece mas nao responde',
  (await conversationRows()).every((row) => row.disabled)
  && (await board.evaluate("document.getElementById('chat-new').disabled"))
  && !(await board.evaluate("document.getElementById('chat-conversations-note').hidden")));

await board.evaluate("import('/app/chat.js').then((m) => m.setTurnRunning(false))");
check('e volta a responder quando o turno termina',
  (await conversationRows()).every((row) => !row.disabled)
  && !(await board.evaluate("document.getElementById('chat-new').disabled")));

// Apagar: a confirmacao e trocada por um "sim" automatico, senao o dialogo
// nativo trava o headless.
await board.evaluate('window.confirm = () => true');
await board.evaluate(
  `[...document.querySelectorAll('.chat-conversation')]
    .find((row) => row.dataset.id === ${JSON.stringify(firstId)})
    .querySelector('.chat-conversation-delete').click()`);

await checkEventually('apagar tira a conversa da lista', async () => (
  !(await conversationRows()).some((row) => row.id === firstId)));
await checkEventually('e esvazia o Chat, que mostrava justamente ela', async () => (
  !(await logText()).includes('primeira conversa de verdade')
  && (await board.evaluate("import('/app/state.js').then((m) => m.chat.sessionId)")) === null));
check('a conversa apagada some do disco tambem',
  (await fetch(`${chatApi}/conversations/${firstId}`)).status === 404);

// Pedido de permissao e pergunta que ficaram sem resposta: o transcript e
// escrito na mao porque provoca-los de verdade exigiria o modelo do outro lado.
// O que importa e como eles voltam — visiveis, e sem nada clicavel, porque o
// turno que esperava por eles acabou.
const pendingLines = [
  { type: 'user', text: 'conversa com pedidos pendurados' },
  { type: 'permission', requestId: 'p-respondida', toolName: 'Write', input: { file_path: 'a.html' }, diff: '+novo' },
  { type: 'permission-result', requestId: 'p-respondida', allow: true, answers: {} },
  { type: 'permission', requestId: 'p-pendente', toolName: 'Edit', input: { file_path: 'b.html' }, diff: '-velho' },
  { type: 'question', requestId: 'q-pendente', questions: [{ question: 'Qual paleta?', options: [{ label: 'clara' }] }] },
  { type: 'done', stopReason: 'end_turn' },
].map((event) => JSON.stringify(event)).join('\n');

fs.mkdirSync(historyDir(fixture.dir), { recursive: true });
fs.writeFileSync(path.join(historyDir(fixture.dir), 'sessao-pendurada.jsonl'), `${pendingLines}\n`);

await board.evaluate("import('/app/chat-client.js').then((m) => m.connectChat())");
await checkEventually('a conversa escrita em disco aparece na lista', async () => (
  (await conversationRows()).some((row) => row.id === 'sessao-pendurada')));

await showSubtab('list');
await board.evaluate(
  `[...document.querySelectorAll('.chat-conversation')]
    .find((row) => row.dataset.id === 'sessao-pendurada')
    .querySelector('.chat-conversation-open').click()`);

await checkEventually('o pedido ja respondido volta com o veredito que teve', async () => (
  await board.evaluate(`(() => {
    const block = document.querySelector('#chat-log .chat-permission.is-approved');
    return !!block && block.querySelector('.chat-permission-verdict').textContent === 'aprovado';
  })()`)));

check('o pedido que ficou sem resposta volta expirado e sem botao vivo',
  await board.evaluate(`(() => {
    const block = document.querySelector('#chat-log .chat-permission.is-expired');
    return !!block
      && block.querySelector('.chat-permission-verdict').textContent === 'expirado'
      && [...block.querySelectorAll('button')].every((button) => button.disabled);
  })()`));

check('a pergunta sem resposta volta encerrada, dizendo por que',
  await board.evaluate(`(() => {
    const block = document.querySelector('#chat-log .chat-question.is-answered');
    return !!block
      && block.querySelector('.chat-question-verdict').textContent.includes('sem resposta')
      && [...block.querySelectorAll('button, input')].every((field) => field.disabled);
  })()`));

// A modal comeca fechada; o icone de engrenagem no rodape do sidebar a abre.
check('a modal de configuracoes comeca fechada', !(await settingsOpen()));
await board.evaluate("document.getElementById('settings-open').click()");
check('o icone de engrenagem abre a modal', await settingsOpen());
check('a modal abre na categoria General', await board.evaluate(
  "!document.getElementById('settings-panel-general').hidden "
  + "&& document.getElementById('settings-panel-models').hidden"));

// Trocar para Models > Claude mostra o campo de chave, sempre visivel — sem
// fold, diferente do painel antigo da aba Conversa.
await board.evaluate("document.querySelector('[data-category=\"models\"]').click()");
check('sem credencial de ambiente, o aviso de sessao fica escondido',
  await board.evaluate("document.getElementById('chat-credential-note').hidden"));
check('sem chave e sem sessao, o campo de chave fica sempre a vista', await keyFieldVisible());

// `setHasAmbientCredential` (agora em `settings.js`) e a mesma funcao que
// `chat-client.js` chama com o que a rota devolveu — aqui ela e exercitada
// direto, simulando a maquina que tem uma sessao do Claude Code mas nenhuma
// chave gravada na pinacoteca.
await board.evaluate(
  "import('/app/settings.js').then((m) => m.setHasAmbientCredential(true))");
check('sessao detectada acende o aviso mesmo sem chave', await board.evaluate(
  "!document.getElementById('chat-credential-note').hidden "
  + "&& document.getElementById('chat-credential-note').textContent.length > 0"));
check('e o campo de chave continua a vista, sem fold', await keyFieldVisible());

await board.evaluate(
  "import('/app/settings.js').then((m) => m.setHasAmbientCredential(false))");
check('tirar a sessao apaga o aviso', await board.evaluate(
  "document.getElementById('chat-credential-note').hidden"));
check('e o campo de chave continua a vista sem a sessao', await keyFieldVisible());

// Fechar a modal (controle explicito) nao afeta o resto da interface.
await board.evaluate("document.getElementById('settings-close').click()");
check('o controle de fechar fecha a modal', !(await settingsOpen()));

// Clique fora do conteudo (no `<dialog>`, fora do wrapper interno) fecha a
// modal tambem.
await board.evaluate("document.getElementById('settings-open').click()");
await board.evaluate(
  "document.getElementById('settings-dialog').dispatchEvent(new MouseEvent('click'))");
check('clicar fora do conteudo fecha a modal', !(await settingsOpen()));

// A chave falsa vai pela propria interface: e o caminho que o usuario percorre,
// e e ele que exercita `saveKey`. Nenhuma chamada a API da Anthropic acontece —
// so a gravacao no `XDG_CONFIG_HOME` temporario.
await board.evaluate("document.getElementById('settings-open').click()");
await board.evaluate("document.querySelector('[data-category=\"models\"]').click()");
await board.evaluate(`(() => {
  const input = document.getElementById('chat-key-input');
  input.value = 'sk-ant-teste-falsa';
  document.getElementById('chat-key-save').click();
})()`);

await checkEventually('o servidor passa a responder que tem chave', async () => (
  await (await fetch(`http://localhost:${PORT}/api/chat/config`)).json()).hasKey === true);
check('o campo de chave continua a vista mesmo com chave gravada', await keyFieldVisible());
await board.evaluate("document.getElementById('settings-close').click()");

// O parser de SSE, sozinho: comentario ignorado, varias linhas `data:` do mesmo
// evento juntadas e o bloco sem terminador guardado para o proximo pedaco.
const parsed = JSON.parse(await board.evaluate(`(async () => {
  const { parseSseChunk } = await import('/app/chat-client.js');
  const first = parseSseChunk('', ': batimento\\ndata: {"a":1}\\n\\ndata: linha1\\ndata: linha2\\n\\ndata: {"b"');
  const second = parseSseChunk(first.rest, ':2}\\n\\n');
  return JSON.stringify({ first, second });
})()`));

check('o parser junta varias linhas data: do mesmo evento',
  parsed.first.events.length === 2 && parsed.first.events[1] === 'linha1\nlinha2');
check('o parser ignora comentario e guarda o evento cortado no fim do pedaco',
  parsed.first.events[0] === '{"a":1}' && parsed.first.rest === 'data: {"b"');
check('o evento cortado fecha no pedaco seguinte',
  parsed.second.events.length === 1 && parsed.second.events[0] === '{"b":2}');

/**
 * Troca o `fetch` da pagina por um que responde `/api/chat/message` com um
 * stream forjado. E o unico jeito de exercitar o turno inteiro sem chamar a API
 * da Anthropic de verdade.
 * @param {string[]} chunks pedacos crus do corpo, na ordem
 */
const fakeStream = (chunks) => board.evaluate(`(() => {
  const real = window.__realFetch || window.fetch;
  window.__realFetch = real;
  window.fetch = (url, options) => {
    if (String(url).includes('/api/chat/message')) {
      const encoder = new TextEncoder();
      const parts = ${JSON.stringify(chunks)};
      const body = new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(encoder.encode(part));
          controller.close();
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }
    return real(url, options);
  };
})()`);

const restoreFetch = () => board.evaluate(
  '(() => { if (window.__realFetch) window.fetch = window.__realFetch; })()');

await fakeStream([
  'data: {"type":"session","sessionId":"sessao-1"}\n\n',
  ': batimento\ndata: {"type":"text","delta":"res"}\n\n',
  'data: {"type":"text","delta":"posta ',
  'do agente"}\n\ndata: {"type":"tool","id":"t9","name":"Write","input":{"file_path":"novo.html"}}\n\n',
  'data: {"type":"tool-result","id":"t9","ok":true,"summary":"criado"}\n\n',
  'data: {"type":"done","stopReason":"end_turn"}\n\n',
]);

await type('faca algo');
await press('Enter');

await checkEventually('o stream monta a resposta do assistente',
  async () => (await lastAssistant()) === 'resposta do agente');
check('a sessao devolvida pelo servidor e guardada', (await sessionId()) === 'sessao-1');
check('o bloco da ferramenta do stream fecha em ok',
  (await lastOf('#chat-log .chat-tool.is-ok .chat-tool-status')) === 'criado');
await checkEventually('o `done` destrava o botao Parar', async () => !(await stopVisible()));

// Servidor caido no meio do turno: sem `done`, a interface tem de destravar
// mesmo assim — botao Parar preso e a pior falha possivel aqui.
const errorsBefore = await errorCount();
await fakeStream(['data: {"type":"text","delta":"cortado"}\n\n']);
await type('de novo');
await press('Enter');

await checkEventually('stream cortado sem `done` vira erro no log',
  async () => (await errorCount()) === errorsBefore + 1);
await checkEventually('e destrava o botao Parar do mesmo jeito',
  async () => !(await stopVisible()));

await restoreFetch();

// A configuracao do servidor manda: ela vem do disco, e dois navegadores
// abertos na mesma pinacoteca tem de ver a mesma escolha. O `localStorage`
// daqui e so o que se mostra ate a resposta chegar.
await board.evaluate(`(() => {
  localStorage.setItem('pinacoteca:chat-prefs', JSON.stringify({
    model: 'claude-opus-5', effort: 'max', sendOnEnter: true,
  }));
})()`);
await fetch(`http://localhost:${PORT}/api/chat/config`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'claude-sonnet-5', effort: 'low', sendOnEnter: false }),
});

await board.evaluate("import('/app/chat-client.js').then((m) => m.connectChat())");
await checkEventually('a config do servidor vence o localStorage nos seletores', async () => (
  await board.evaluate(
    "document.getElementById('chat-model').value === 'claude-sonnet-5'"
    + " && document.getElementById('chat-effort').value === 'low'"
    + " && document.getElementById('chat-send-mode').getAttribute('aria-pressed') === 'true'")));
check('e o localStorage passa a mostrar o que o servidor disse', await board.evaluate(
  "JSON.parse(localStorage.getItem('pinacoteca:chat-prefs')).effort === 'low'"));

await board.evaluate("document.querySelector('[data-tab=\"screens\"]').click()");


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
