// Teste ponta a ponta: sobe o servidor de verdade e dirige o Chrome headless
// pelo CDP para conferir o comportamento real de recarga.
//
// Requer Chrome instalado. Rode com `npm test`.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5230 + Math.floor(Math.random() * 200);
const CDP_PORT = 9400 + Math.floor(Math.random() * 200);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const candidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const candidate of candidates) {
    if (spawnSync('which', [candidate]).status === 0) return candidate;
  }
  return null;
}

const chromeBinary = findChrome();
if (!chromeBinary) {
  process.stdout.write('Chrome nao encontrado — teste ignorado.\n');
  process.exit(0);
}

// --- pasta temporaria com os prototipos de teste ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinacoteca-test-'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pinacoteca-chrome-'));
const write = (relative, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
  fs.writeFileSync(path.join(dir, relative), content);
};

write('css/tokens.css', ':root{--c:#333}\n');
write('css/base.css', '@import "tokens.css";\nbody{background:#eee}\n');
write('login.html', '<!doctype html><meta charset=utf-8><link rel=stylesheet href="css/base.css"><h1>Login</h1>');
write('dashboard.html', '<!doctype html><meta charset=utf-8><link rel=stylesheet href="css/base.css"><h1>Dash</h1>');
write('solo.html', '<!doctype html><meta charset=utf-8><h1>Solo</h1>');
write('.env', 'SECRET=nao-deve-vazar\n');
write('node_modules/pkg/a.css', 'body{}\n');

const failures = [];
function check(name, condition, detail = '') {
  if (!condition) failures.push(name);
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHOU'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
}

const server = spawn('node', [path.join(ROOT, 'bin/pinacoteca.js'), dir, '--port', String(PORT), '--no-open'],
  { stdio: 'ignore' });

const chrome = spawn(chromeBinary, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  `http://localhost:${PORT}`,
], { stdio: 'ignore' });

function cleanup() {
  chrome.kill();
  server.kill();
  for (const target of [dir, profile]) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // O Chrome ainda pode estar escrevendo no perfil: sobra em /tmp e o
      // sistema limpa depois. Nao e motivo para o teste falhar.
    }
  }
}
process.on('exit', cleanup);

async function cdpTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://localhost:${CDP_PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.url.includes(String(PORT)));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome ainda subindo.
    }
    await sleep(250);
  }
  throw new Error('Alvo CDP nao encontrado');
}

const socket = new WebSocket(await cdpTarget());
await new Promise((resolve) => socket.on('open', resolve));

let nextId = 1;
const pending = new Map();
socket.on('message', (data) => {
  const message = JSON.parse(data);
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  }
});

async function evaluate(expression) {
  const id = nextId++;
  socket.send(JSON.stringify({
    id,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  }));
  const message = await new Promise((resolve) => pending.set(id, resolve));
  if (message.result?.exceptionDetails) throw new Error(JSON.stringify(message.result.exceptionDetails));
  return message.result.result.value;
}

// Mapa tela -> timestamp do src, para detectar quem recarregou.
const SNAPSHOT = `JSON.stringify(Object.fromEntries(
  [...document.querySelectorAll('.card iframe')].map((frame) => {
    const url = new URL(frame.src);
    return [decodeURIComponent(url.pathname.replace('/preview/', '')), url.searchParams.get('t')];
  })
))`;
const cardCount = () => evaluate(`document.querySelectorAll('.card iframe').length`);

for (let attempt = 0; attempt < 60; attempt += 1) {
  if ((await cardCount()) === 3) break;
  await sleep(250);
}
await sleep(1500); // deixa os iframes carregarem e o map de assets ser coletado

process.stdout.write('\nCarga inicial\n');
const initial = JSON.parse(await evaluate(SNAPSHOT));
check('board monta um card por HTML', Object.keys(initial).length === 3, Object.keys(initial).join(', '));
check('barra lateral lista as telas', (await evaluate(`document.querySelectorAll('.screen-item').length`)) === 3);
check('node_modules fica de fora', !Object.keys(initial).some((file) => file.includes('node_modules')));

process.stdout.write('\nAsset compartilhado\n');
write('css/base.css', '@import "tokens.css";\nbody{background:#fff}\n');
await sleep(2000);
const afterBase = JSON.parse(await evaluate(SNAPSHOT));
check('recarrega as telas que usam o CSS', afterBase['login.html'] !== initial['login.html'] && afterBase['dashboard.html'] !== initial['dashboard.html']);
check('nao mexe na tela que nao usa', afterBase['solo.html'] === initial['solo.html']);

process.stdout.write('\nAsset alcancado so por @import\n');
write('css/tokens.css', ':root{--c:#000}\n');
await sleep(2000);
const afterTokens = JSON.parse(await evaluate(SNAPSHOT));
check('recarrega pela cadeia de @import', afterTokens['login.html'] !== afterBase['login.html'] && afterTokens['dashboard.html'] !== afterBase['dashboard.html']);
check('nao mexe na tela que nao usa', afterTokens['solo.html'] === initial['solo.html']);

process.stdout.write('\nHTML alterado, criado e removido\n');
write('solo.html', '<!doctype html><meta charset=utf-8><h1>Solo v2</h1>');
await sleep(1500);
check('HTML alterado recarrega o card', JSON.parse(await evaluate(SNAPSHOT))['solo.html'] !== initial['solo.html']);

write('novo.html', '<!doctype html><h1>Novo</h1>');
await sleep(1500);
check('HTML novo vira card', (await cardCount()) === 4);

fs.rmSync(path.join(dir, 'novo.html'));
await sleep(1500);
check('HTML removido some do board', (await cardCount()) === 3);

process.stdout.write('\nServidor\n');
check('conexao SSE ao vivo', (await evaluate(`document.getElementById('connection').dataset.state`)) === 'live');

const status = async (url) => (await fetch(url)).status;
check('serve o prototipo', (await status(`http://localhost:${PORT}/preview/login.html`)) === 200);
check('serve o CSS do prototipo', (await status(`http://localhost:${PORT}/preview/css/base.css`)) === 200);
check('recusa arquivo oculto', (await status(`http://localhost:${PORT}/preview/.env`)) === 403);
check('recusa pasta ignorada', (await status(`http://localhost:${PORT}/preview/node_modules/pkg/a.css`)) === 403);
check('recusa path traversal', (await status(`http://localhost:${PORT}/preview/%2e%2e%2f%2e%2e%2fetc/passwd`)) === 403);

socket.close();
process.stdout.write(failures.length === 0
  ? '\nTodos os testes passaram.\n\n'
  : `\nFalhas: ${failures.join(' | ')}\n\n`);
process.exit(failures.length === 0 ? 0 : 1);
