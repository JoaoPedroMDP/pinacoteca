#!/usr/bin/env node
// @ts-check

// Entrypoint da CLI. So faz o que exige o processo: escrever na saida, definir
// codigo de saida e subir o servidor. A leitura dos argumentos vive em
// `src/cli.js` para poder ser testada isolada.

import fs from 'node:fs';
import { parseArgs, USAGE } from '../src/cli.js';
import { startServer } from '../src/server/index.js';

const result = parseArgs(process.argv.slice(2));

if (result.kind === 'help') {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

if (result.kind === 'error') {
  process.stderr.write(`${result.message}\n${USAGE}\n`);
  process.exit(1);
}

const { options } = result;

if (!fs.existsSync(options.dir) || !fs.statSync(options.dir).isDirectory()) {
  process.stderr.write(`Pasta nao encontrada: ${options.dir}\n`);
  process.exit(1);
}

startServer(options).catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
