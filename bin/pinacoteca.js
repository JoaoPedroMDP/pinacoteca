#!/usr/bin/env node

// Entrypoint da CLI. Resolve os argumentos e sobe o servidor.

import path from 'node:path';
import fs from 'node:fs';
import { startServer } from '../src/server/index.js';

const USAGE = `
pinacoteca — board para os HTMLs de uma pasta

  pinacoteca [pasta] [opcoes]

  pasta            Pasta a observar (padrao: diretorio atual)

  --port, -p       Porta do servidor (padrao: 5173)
  --no-open        Nao abrir o navegador automaticamente
  --help, -h       Mostra esta ajuda
`;

function parseArgs(argv) {
  const options = { dir: process.cwd(), port: 5173, open: true };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (arg === '--no-open') {
      options.open = false;
    } else if (arg === '--port' || arg === '-p') {
      i += 1;
      options.port = Number(argv[i]);
    } else if (arg.startsWith('--port=')) {
      options.port = Number(arg.slice('--port='.length));
    } else if (arg.startsWith('-')) {
      process.stderr.write(`Opcao desconhecida: ${arg}\n${USAGE}\n`);
      process.exit(1);
    } else {
      options.dir = path.resolve(arg);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    process.stderr.write('Porta invalida.\n');
    process.exit(1);
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));

if (!fs.existsSync(options.dir) || !fs.statSync(options.dir).isDirectory()) {
  process.stderr.write(`Pasta nao encontrada: ${options.dir}\n`);
  process.exit(1);
}

startServer(options).catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
