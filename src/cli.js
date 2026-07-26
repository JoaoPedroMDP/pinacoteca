// @ts-check
// Leitura dos argumentos da linha de comando.
//
// Funcao pura de proposito: nao escreve na saida, nao encerra o processo e nao
// toca no disco. Quem faz isso e `bin/pinacoteca.js`. Assim o parsing pode ser
// testado sem subir nada — veja `test/unit.mjs`.

import path from 'node:path';

export const DEFAULT_PORT = 5173;

export const USAGE = `
pinacoteca — board para os HTMLs de uma pasta

  pinacoteca [pasta] [opcoes]

  pasta            Pasta a observar (padrao: diretorio atual)

  --port, -p       Porta do servidor (padrao: ${DEFAULT_PORT})
  --no-open        Nao abrir o navegador automaticamente
  --help, -h       Mostra esta ajuda
`;

/**
 * @typedef {{ dir: string, port: number, open: boolean }} CliOptions
 *
 * @typedef {{ kind: 'run', options: CliOptions }
 *   | { kind: 'help' }
 *   | { kind: 'error', message: string }} CliResult
 *   Um dos tres desfechos possiveis. Quem chama decide o codigo de saida.
 */

/**
 * @param {string[]} argv argumentos depois do nome do programa
 * @param {string} [cwd] diretorio atual, usado como pasta padrao
 * @returns {CliResult}
 */
export function parseArgs(argv, cwd = process.cwd()) {
  /** @type {CliOptions} */
  const options = { dir: cwd, port: DEFAULT_PORT, open: true };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      return { kind: 'help' };
    } else if (arg === '--no-open') {
      options.open = false;
    } else if (arg === '--port' || arg === '-p') {
      i += 1;
      options.port = Number(argv[i]);
    } else if (arg.startsWith('--port=')) {
      options.port = Number(arg.slice('--port='.length));
    } else if (arg.startsWith('-')) {
      return { kind: 'error', message: `Opcao desconhecida: ${arg}` };
    } else {
      options.dir = path.resolve(cwd, arg);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    return { kind: 'error', message: 'Porta invalida.' };
  }

  return { kind: 'run', options };
}
