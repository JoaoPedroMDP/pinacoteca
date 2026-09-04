// @ts-check
// Primitivas HTTP: tipo de conteudo, resolucao segura de caminho e envio de resposta.
//
// Este modulo nao conhece rotas nem o produto. Rota nova mora em `index.js`;
// aqui so entra coisa que qualquer rota poderia usar.

import fs from 'node:fs/promises';
import path from 'node:path';

/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */

/** @type {Record<string, string>} */
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

const FALLBACK_MIME_TYPE = 'application/octet-stream';

/**
 * Tipo de conteudo pela extensao do arquivo.
 * @param {string} filePath
 * @returns {string}
 */
export function mimeTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? FALLBACK_MIME_TYPE;
}

/**
 * Resolve um caminho vindo da URL dentro de `baseDir`.
 * Devolve null se escapar da pasta — protege contra path traversal.
 *
 * @param {string} baseDir pasta que limita o resultado (caminho absoluto)
 * @param {string} relativePath trecho da URL, ainda percent-encoded
 * @returns {string | null} caminho absoluto dentro de `baseDir`, ou null
 */
export function resolveInside(baseDir, relativePath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return null;
  }

  // O `.` a frente forca o caminho a ser tratado como relativo mesmo se a URL
  // trouxer uma barra inicial ou algo como `C:\` no Windows.
  const absolute = path.resolve(baseDir, `.${path.posix.sep}${decoded}`);
  const prefix = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;

  if (absolute !== baseDir && !absolute.startsWith(prefix)) return null;
  return absolute;
}

/**
 * Fecha a resposta respeitando HEAD: em HEAD o corpo e medido nos cabecalhos,
 * mas nunca enviado. Toda resposta deste servidor passa por aqui.
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {number} status
 * @param {Record<string, string | number>} headers
 * @param {string | Buffer} body
 */
function send(req, res, status, headers, body) {
  res.writeHead(status, headers);
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
export function sendJson(req, res, status, body) {
  const payload = JSON.stringify(body);
  send(req, res, status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  }, payload);
}

/**
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {number} status
 * @param {string} message
 */
export function sendText(req, res, status, message) {
  send(req, res, status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(message),
  }, message);
}

/**
 * Envia o arquivo do disco. Responde 404 se ele nao existir ou nao for legivel.
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {string} filePath caminho absoluto, ja validado por quem chamou
 * @param {{ noStore?: boolean }} [options] `noStore` proibe o cache do navegador
 */
export async function sendFile(req, res, filePath, { noStore = false } = {}) {
  let content;
  try {
    content = await fs.readFile(filePath);
  } catch {
    sendText(req, res, 404, 'Nao encontrado');
    return;
  }

  /** @type {Record<string, string | number>} */
  const headers = {
    'Content-Type': mimeTypeFor(filePath),
    'Content-Length': content.length,
  };
  // Prototipos nunca sao cacheados: o board conta com o disco ser a verdade.
  if (noStore) headers['Cache-Control'] = 'no-store';

  send(req, res, 200, headers, content);
}

/**
 * Le o corpo da requisicao e devolve o JSON. Recusa corpo maior que `limit`:
 * numa rota local um corpo sem limite ainda e um jeito bobo de travar o
 * processo.
 *
 * Lanca `Error` se estourar o limite ou se o JSON nao for valido — quem chama
 * traduz isso em 400.
 *
 * @param {IncomingMessage} req
 * @param {number} limit tamanho maximo do corpo, em bytes
 * @returns {Promise<unknown>}
 */
export function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Corpo grande demais'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON invalido'));
      }
    });
  });
}
