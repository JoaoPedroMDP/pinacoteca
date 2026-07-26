// @ts-check
// Canal SSE. Fluxo unidirecional: servidor avisa o board que algo mudou.

/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */
/** @typedef {import('./watcher.js').BoardEvent} BoardEvent */

const HEARTBEAT_MS = 30000;

// Quanto o navegador espera antes de tentar reconectar. Curto de proposito: o
// caso comum de queda e o servidor reiniciando na mao do usuario.
const RETRY_MS = 1000;

export class SseHub {
  constructor() {
    /** @type {Set<ServerResponse>} */
    this.clients = new Set();

    // Comentario periodico para segurar a conexao viva atras de proxies
    // e detectar clientes que sumiram sem fechar o socket.
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) client.write(': ping\n\n');
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /**
   * Assina um cliente no stream. A resposta fica aberta ate o navegador sair.
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   */
  handle(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      // Desliga o buffering caso exista um proxy no caminho.
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: ${RETRY_MS}\n\n`);

    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  /**
   * Manda o evento para todos os boards abertos.
   * @param {BoardEvent} event
   */
  broadcast(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) client.write(payload);
  }

  close() {
    clearInterval(this.heartbeat);
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
