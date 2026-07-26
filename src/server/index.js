// @ts-check
// Servidor HTTP: serve o board, os prototipos e o stream de eventos.
//
// Rota nova entra em `createRequestHandler`. As primitivas de resposta
// (mime, caminho seguro, envio) moram em `http.js`.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { listScreens, isForbiddenPreviewPath } from './screens.js';
import { resolveInside, sendFile, sendJson, sendText } from './http.js';
import { startWatcher } from './watcher.js';
import { SseHub } from './sse.js';

/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(SERVER_DIR, '..', 'client');
const PKG_PATH = path.join(SERVER_DIR, '..', '..', 'package.json');

// Endereco fixo: a ferramenta serve pastas arbitrarias do disco e nunca deve
// ficar acessivel para fora da maquina.
const HOST = '127.0.0.1';

// Se a porta pedida estiver ocupada, tenta as seguintes. Morrer por porta
// ocupada seria atrito a toa numa maquina de desenvolvimento.
const PORT_ATTEMPTS = 10;

// Versao do pacote, lida uma vez, para o board mostrar no rodape.
const VERSION = await fs.readFile(PKG_PATH, 'utf8').then((raw) => JSON.parse(raw).version).catch(() => '');

/** @param {string} url */
function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
      : 'xdg-open';

  try {
    const child = spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Sem navegador disponivel: o usuario abre na mao pela URL impressa.
  }
}

/**
 * Sobe o servidor tentando a porta pedida e as seguintes se estiverem ocupadas.
 *
 * @param {import('node:http').Server} server
 * @param {number} port
 * @param {number} [attemptsLeft]
 * @returns {Promise<number>} a porta em que de fato subiu
 */
function listen(server, port, attemptsLeft = PORT_ATTEMPTS) {
  return new Promise((resolve, reject) => {
    /** @param {NodeJS.ErrnoException} error */
    function onError(error) {
      if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
        server.removeListener('error', onError);
        resolve(listen(server, port + 1, attemptsLeft - 1));
      } else {
        reject(error);
      }
    }

    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.removeListener('error', onError);
      resolve(port);
    });
  });
}

/**
 * Monta o roteador. Cada rota decide sozinha o que responder e retorna.
 *
 * | Rota            | Resposta                                          |
 * | --------------- | ------------------------------------------------- |
 * | `GET /`         | a pagina do board                                 |
 * | `GET /app/*`    | CSS e JS do board                                 |
 * | `GET /api/screens` | telas encontradas, raiz observada e versao     |
 * | `GET /events`   | stream SSE de mudancas                            |
 * | `GET /preview/*`| o arquivo cru do prototipo e seus assets          |
 *
 * @param {{ rootDir: string, hub: SseHub }} context
 * @returns {(req: IncomingMessage, res: ServerResponse) => Promise<void>}
 */
export function createRequestHandler({ rootDir, hub }) {
  return async function handleRequest(req, res) {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(req, res, 405, 'Metodo nao suportado');
      return;
    }

    if (pathname === '/') {
      await sendFile(req, res, path.join(CLIENT_DIR, 'index.html'), { noStore: true });
      return;
    }

    if (pathname === '/events') {
      hub.handle(req, res);
      return;
    }

    if (pathname === '/api/screens') {
      sendJson(req, res, 200, { root: rootDir, version: VERSION, screens: await listScreens(rootDir) });
      return;
    }

    // Arquivos do proprio board.
    if (pathname.startsWith('/app/')) {
      const target = resolveInside(CLIENT_DIR, pathname.slice('/app/'.length));
      if (!target) {
        sendText(req, res, 403, 'Caminho invalido');
        return;
      }
      await sendFile(req, res, target, { noStore: true });
      return;
    }

    // Prototipos e seus assets relativos (CSS, imagens, fontes).
    if (pathname.startsWith('/preview/')) {
      const target = resolveInside(rootDir, pathname.slice('/preview/'.length));
      if (!target || isForbiddenPreviewPath(rootDir, target)) {
        sendText(req, res, 403, 'Caminho invalido');
        return;
      }
      await sendFile(req, res, target, { noStore: true });
      return;
    }

    sendText(req, res, 404, 'Nao encontrado');
  };
}

/**
 * @param {{ dir: string, port: number, open?: boolean }} options
 * @returns {Promise<{ url: string, port: number, rootDir: string, shutdown: () => Promise<void> }>}
 */
export async function startServer({ dir, port, open = true }) {
  const rootDir = path.resolve(dir);
  const hub = new SseHub();

  const server = http.createServer(createRequestHandler({ rootDir, hub }));

  const actualPort = await listen(server, port);
  const url = `http://localhost:${actualPort}`;

  const watcher = startWatcher(rootDir, (event) => hub.broadcast(event));

  const screens = await listScreens(rootDir);
  process.stdout.write('\n  pinacoteca\n');
  process.stdout.write(`  pasta:  ${rootDir}\n`);
  process.stdout.write(`  telas:  ${screens.length}\n`);
  process.stdout.write(`  url:    ${url}\n\n`);

  if (open) openBrowser(url);

  async function shutdown() {
    await watcher.close();
    hub.close();
    server.close(() => process.exit(0));
    // Se algum socket travar, nao deixa o processo pendurado.
    setTimeout(() => process.exit(0), 500).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { url, port: actualPort, rootDir, shutdown };
}
