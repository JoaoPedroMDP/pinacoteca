// Servidor HTTP: serve o board, os prototipos e o stream de eventos.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { listScreens, isIgnoredDir } from './screens.js';
import { startWatcher } from './watcher.js';
import { SseHub } from './sse.js';

const CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client');
const PKG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');

// Versao do pacote, lida uma vez, para o board mostrar no rodape.
const VERSION = await fs.readFile(PKG_PATH, 'utf8').then((raw) => JSON.parse(raw).version).catch(() => '');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
};

function mimeTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve um caminho vindo da URL dentro de `baseDir`.
 * Devolve null se escapar da pasta — protege contra path traversal.
 */
function resolveInside(baseDir, relativePath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return null;
  }

  const absolute = path.resolve(baseDir, `.${path.posix.sep}${decoded}`);
  const prefix = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;

  if (absolute !== baseDir && !absolute.startsWith(prefix)) return null;
  return absolute;
}

/**
 * Recusa o que nao faz parte de um prototipo: arquivos e pastas ocultos
 * (`.env`, `.git/config`, `.ssh`) e pastas de build.
 *
 * A ferramenta e apontada para pastas arbitrarias, entao servir tudo que esta
 * abaixo da raiz nao basta ser "so localhost": qualquer pagina aberta no mesmo
 * navegador consegue disparar requisicoes para ca.
 */
function isForbiddenPreviewPath(rootDir, absolutePath) {
  const relative = path.relative(rootDir, absolutePath);
  if (relative === '') return true;

  return relative.split(path.sep).some((segment) => segment.startsWith('.') || isIgnoredDir(segment));
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendText(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

async function sendFile(res, filePath, { noStore = false } = {}) {
  let content;
  try {
    content = await fs.readFile(filePath);
  } catch {
    sendText(res, 404, 'Nao encontrado');
    return;
  }

  const headers = {
    'Content-Type': mimeTypeFor(filePath),
    'Content-Length': content.length,
  };
  // Prototipos nunca sao cacheados: o board conta com o disco ser a verdade.
  if (noStore) headers['Cache-Control'] = 'no-store';

  res.writeHead(200, headers);
  res.end(content);
}

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

/** Sobe o servidor tentando a porta pedida e as seguintes se estiverem ocupadas. */
function listen(server, port, attemptsLeft = 10) {
  return new Promise((resolve, reject) => {
    function onError(error) {
      if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
        server.removeListener('error', onError);
        resolve(listen(server, port + 1, attemptsLeft - 1));
      } else {
        reject(error);
      }
    }

    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve(port);
    });
  });
}

export async function startServer({ dir, port, open = true }) {
  const rootDir = path.resolve(dir);
  const hub = new SseHub();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Metodo nao suportado');
      return;
    }

    if (pathname === '/') {
      await sendFile(res, path.join(CLIENT_DIR, 'index.html'), { noStore: true });
      return;
    }

    if (pathname === '/events') {
      hub.handle(req, res);
      return;
    }

    if (pathname === '/api/screens') {
      sendJson(res, 200, { root: rootDir, version: VERSION, screens: await listScreens(rootDir) });
      return;
    }

    // Arquivos do proprio board.
    if (pathname.startsWith('/app/')) {
      const target = resolveInside(CLIENT_DIR, pathname.slice('/app/'.length));
      if (!target) {
        sendText(res, 403, 'Caminho invalido');
        return;
      }
      await sendFile(res, target, { noStore: true });
      return;
    }

    // Prototipos e seus assets relativos (CSS, imagens, fontes).
    if (pathname.startsWith('/preview/')) {
      const target = resolveInside(rootDir, pathname.slice('/preview/'.length));
      if (!target || isForbiddenPreviewPath(rootDir, target)) {
        sendText(res, 403, 'Caminho invalido');
        return;
      }
      await sendFile(res, target, { noStore: true });
      return;
    }

    sendText(res, 404, 'Nao encontrado');
  });

  const actualPort = await listen(server, port);
  const url = `http://localhost:${actualPort}`;

  const watcher = startWatcher(rootDir, (event) => hub.broadcast(event));

  const screens = await listScreens(rootDir);
  process.stdout.write(`\n  pinacoteca\n`);
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
