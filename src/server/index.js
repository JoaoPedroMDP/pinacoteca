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
import { readJsonBody, resolveInside, sendFile, sendJson, sendText } from './http.js';
import { startWatcher } from './watcher.js';
import { SseHub } from './sse.js';
import { publicConfig, readConfig, writeConfig } from './config.js';
import { hasAmbientCredential, interrupt, resolvePermission, runTurn } from './agent.js';

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

// Teto do corpo das rotas de conversa. Local ou nao, corpo sem limite e um
// jeito bobo de travar o processo.
const BODY_LIMIT_BYTES = 1024 * 1024;

// Prefixo das unicas rotas que aceitam POST.
const CHAT_PREFIX = '/api/chat/';

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
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asObject(value) {
  return (typeof value === 'object' && value !== null && !Array.isArray(value))
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * Um turno da conversa, escrito como `text/event-stream` na propria resposta.
 *
 * O `SseHub` nao serve aqui: ele e broadcast para todos os boards abertos, e
 * este stream pertence a uma requisicao so.
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} rootDir
 * @param {Record<string, unknown>} body
 */
async function streamTurn(req, res, rootDir, body) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text === '') {
    sendText(req, res, 400, 'Mensagem vazia');
    return;
  }
  const sessionId = typeof body.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : null;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // A sessao so tem id depois do primeiro evento quando o cliente mandou null.
  let current = sessionId;
  // Aba fechada no meio do turno nao pode deixar o agente gastando sozinho.
  req.on('close', () => {
    if (current) interrupt(current);
  });

  await runTurn({
    rootDir,
    sessionId,
    text,
    onEvent(event) {
      if (event.type === 'session') current = event.sessionId;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
  });
  res.end();
}

/**
 * As rotas de `/api/chat/`. Devolve false se `pathname` nao for uma delas —
 * ai o roteador segue para o 404.
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} pathname
 * @param {string} rootDir
 * @returns {Promise<boolean>}
 */
async function handleChat(req, res, pathname, rootDir) {
  if (pathname === `${CHAT_PREFIX}config`) {
    const config = req.method === 'POST'
      ? await writeConfig(await readJsonBody(req, BODY_LIMIT_BYTES))
      : await readConfig();
    // Nao entra em `publicConfig`: e capacidade do processo do servidor, nao
    // um campo gravado no config.json — por isso e composta aqui, na rota.
    sendJson(req, res, 200, {
      ...publicConfig(config),
      hasAmbientCredential: hasAmbientCredential(process.env),
    });
    return true;
  }

  // O resto so existe em POST; um GET neles cai no 404.
  if (req.method !== 'POST') return false;
  const body = asObject(await readJsonBody(req, BODY_LIMIT_BYTES));
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';

  if (pathname === `${CHAT_PREFIX}message`) {
    await streamTurn(req, res, rootDir, body);
    return true;
  }

  if (pathname === `${CHAT_PREFIX}interrupt`) {
    interrupt(sessionId);
    sendJson(req, res, 200, { ok: true });
    return true;
  }

  // A mesma rota destrava os dois pedidos que param no `canUseTool`: a
  // aprovacao de uma edicao (`allow`) e a resposta a uma pergunta do agente
  // (`answers`). Sao o mesmo gesto do ponto de vista do servidor — alguem
  // respondeu o que estava esperando —, e uma rota so evita duas que fariam a
  // mesma coisa com nomes diferentes.
  if (pathname === `${CHAT_PREFIX}permission`) {
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    resolvePermission(sessionId, requestId, body.allow === true, asObject(body.answers));
    sendJson(req, res, 200, { ok: true });
    return true;
  }

  return false;
}

/**
 * Casca das rotas de conversa: e o unico ramo do servidor que aceita `POST`, e
 * o unico que precisa traduzir corpo invalido em 400.
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} pathname
 * @param {string} rootDir
 */
async function routeChat(req, res, pathname, rootDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    sendText(req, res, 405, 'Metodo nao suportado');
    return;
  }

  try {
    if (await handleChat(req, res, pathname, rootDir)) return;
  } catch (error) {
    // Se o stream ja comecou nao ha status a mandar: so fecha a resposta.
    if (res.headersSent) res.end();
    else sendText(req, res, 400, error instanceof Error ? error.message : 'Requisicao invalida');
    return;
  }

  sendText(req, res, 404, 'Nao encontrado');
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
 * | `GET /api/chat/config` | a configuracao da conversa, sem a chave    |
 * | `POST /api/chat/config` | grava a configuracao e devolve o mesmo    |
 * | `POST /api/chat/message` | um turno, em `text/event-stream`         |
 * | `POST /api/chat/interrupt` | aborta o turno em andamento            |
 * | `POST /api/chat/permission` | responde uma permissao ou pergunta    |
 *
 * @param {{ rootDir: string, hub: SseHub }} context
 * @returns {(req: IncomingMessage, res: ServerResponse) => Promise<void>}
 */
export function createRequestHandler({ rootDir, hub }) {
  return async function handleRequest(req, res) {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');

    // `POST` existe so na conversa; o resto do servidor continua somente leitura.
    if (pathname.startsWith(CHAT_PREFIX)) {
      await routeChat(req, res, pathname, rootDir);
      return;
    }

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
