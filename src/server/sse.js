// Canal SSE. Fluxo unidirecional: servidor avisa o board que algo mudou.

const HEARTBEAT_MS = 30000;

export class SseHub {
  constructor() {
    this.clients = new Set();

    // Comentario periodico para segurar a conexao viva atras de proxies
    // e detectar clientes que sumiram sem fechar o socket.
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) client.write(': ping\n\n');
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  handle(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      // Desliga o buffering caso exista um proxy no caminho.
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1000\n\n');

    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

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
