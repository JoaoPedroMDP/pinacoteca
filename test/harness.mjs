// Ferramentas do teste ponta a ponta: pasta temporaria, servidor, Chrome
// headless via CDP e as asercoes.
//
// O arquivo de teste (`e2e.mjs`) so descreve *o que* deve acontecer. Toda a
// encanacao — WebSocket, protocolo, espera — mora aqui. Teste novo nao precisa
// entender CDP: importa `checkEventually` e escreve a condicao.
//
// Nao existe `sleep` fixo em teste: toda espera e uma condicao com prazo
// (`waitFor`). Numero magico de espera e o que deixa suite lenta e instavel.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 100;

/** @type {(ms: number) => Promise<void>} */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Espera uma condicao virar verdadeira, com prazo.
 *
 * @param {() => unknown | Promise<unknown>} predicate reavaliado a cada ciclo
 * @param {{ timeout?: number, interval?: number }} [options] `interval` maior
 *   serve para predicados que tambem *provocam* algo (reescrever um arquivo)
 * @returns {Promise<boolean>} false quando o prazo estourou
 */
export async function waitFor(predicate, { timeout = DEFAULT_TIMEOUT_MS, interval = POLL_INTERVAL_MS } = {}) {
  const deadline = Date.now() + timeout;

  for (;;) {
    try {
      if (await predicate()) return true;
    } catch {
      // Alvo ainda nao existe (Chrome subindo, iframe trocando de src): tenta de novo.
    }
    if (Date.now() >= deadline) return false;
    await sleep(interval);
  }
}

/* ---------- Assercoes ---------- */

/** @type {string[]} */
const failures = [];

/**
 * Verifica uma condicao ja conhecida.
 * @param {string} name o que deveria ser verdade
 * @param {unknown} condition
 * @param {string} [detail] contexto mostrado quando falha
 */
export function check(name, condition, detail = '') {
  if (!condition) failures.push(name);
  process.stdout.write(`  ${condition ? 'ok  ' : 'FALHOU'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
}

/**
 * Verifica uma condicao que leva um tempo indeterminado para valer — a recarga
 * de um iframe, um card aparecendo. Passa assim que ficar verdadeira.
 *
 * @param {string} name
 * @param {() => unknown | Promise<unknown>} predicate
 * @param {{ timeout?: number, interval?: number }} [options] repassado a `waitFor`
 */
export async function checkEventually(name, predicate, options) {
  const ok = await waitFor(predicate, options);
  check(name, ok, ok ? '' : 'prazo esgotado');
}

/** Imprime o resumo e devolve o codigo de saida do processo. */
export function report() {
  process.stdout.write(failures.length === 0
    ? '\nTodos os testes passaram.\n\n'
    : `\nFalhas: ${failures.join(' | ')}\n\n`);
  return failures.length === 0 ? 0 : 1;
}

/* ---------- Ambiente ---------- */

/** @returns {string | null} o primeiro Chrome/Chromium encontrado no PATH */
export function findChrome() {
  const candidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const candidate of candidates) {
    if (spawnSync('which', [candidate]).status === 0) return candidate;
  }
  return null;
}

/**
 * Pasta temporaria com os prototipos do teste.
 * @returns {{ dir: string, write: (relative: string, content: string) => void,
 *             remove: (relative: string) => void, cleanup: () => void }}
 */
export function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinacoteca-test-'));

  return {
    dir,
    write(relative, content) {
      const target = path.join(dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    },
    remove(relative) {
      fs.rmSync(path.join(dir, relative));
    },
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Sobra em /tmp e o sistema limpa depois. Nao e motivo para falhar.
      }
    },
  };
}

/**
 * Sobe o servidor de verdade e um Chrome headless apontado para ele.
 *
 * @param {{ dir: string, port: number, cdpPort: number, chromeBinary: string }} options
 * @returns {Promise<{ evaluate: (expression: string) => Promise<any>, stop: () => void }>}
 */
export async function startBoard({ dir, port, cdpPort, chromeBinary }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pinacoteca-chrome-'));

  const server = spawn(
    'node',
    [path.join(ROOT, 'bin/pinacoteca.js'), dir, '--port', String(port), '--no-open'],
    { stdio: 'ignore' },
  );

  const serverUp = await waitFor(async () => (await fetch(`http://localhost:${port}/api/screens`)).ok);
  if (!serverUp) throw new Error('Servidor nao subiu');

  const chrome = spawn(chromeBinary, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    `http://localhost:${port}`,
  ], { stdio: 'ignore' });

  const socket = new WebSocket(await debuggerUrl(cdpPort, port));
  await new Promise((resolve) => socket.on('open', resolve));

  // O CDP responde de forma assincrona: cada requisicao leva um id e a resposta
  // volta com o mesmo id, possivelmente fora de ordem.
  let nextId = 1;
  const pending = new Map();
  socket.on('message', (data) => {
    const message = JSON.parse(String(data));
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });

  /**
   * Roda a expressao dentro da pagina e devolve o valor.
   * @param {string} expression
   */
  async function evaluate(expression) {
    const id = nextId++;
    socket.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));

    const message = await new Promise((resolve) => pending.set(id, resolve));
    if (message.result?.exceptionDetails) {
      throw new Error(JSON.stringify(message.result.exceptionDetails));
    }
    return message.result.result.value;
  }

  function stop() {
    socket.close();
    chrome.kill();
    server.kill();
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      // O Chrome ainda pode estar escrevendo no perfil.
    }
  }

  return { evaluate, stop };
}

/**
 * Endereco de depuracao da aba aberta no board.
 * @param {number} cdpPort
 * @param {number} port porta do servidor, usada para achar a aba certa
 */
async function debuggerUrl(cdpPort, port) {
  let found = null;

  const ok = await waitFor(async () => {
    const response = await fetch(`http://localhost:${cdpPort}/json/list`);
    /** @type {any[]} */
    const targets = await response.json();
    const page = targets.find((target) => target.type === 'page' && target.url.includes(String(port)));
    found = page?.webSocketDebuggerUrl ?? null;
    return found !== null;
  });

  if (!ok) throw new Error('Alvo CDP nao encontrado');
  return found;
}
