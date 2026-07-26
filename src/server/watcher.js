// @ts-check
// Observa a pasta e traduz eventos do sistema de arquivos em eventos do board.

import path from 'node:path';
import chokidar from 'chokidar';
import { isHtmlFile, isIgnoredDir } from './screens.js';

/**
 * Contrato de evento entre servidor e board. O espelho deste bloco vive em
 * `src/client/sse.js` — mudou aqui, muda la, e o e2e cobre os quatro tipos.
 *
 * - `add`    tela nova       — board insere card e item na sidebar
 * - `change` conteudo mudou  — board recarrega so aquele iframe
 * - `unlink` tela removida   — board tira card e item
 * - `asset`  arquivo nao-HTML mudou — board recarrega as telas que o carregaram
 *
 * O servidor nao sabe quais telas um asset afeta e nao tenta descobrir: quem
 * cruza isso com os recursos realmente carregados e o cliente.
 *
 * @typedef {'add' | 'change' | 'unlink' | 'asset'} BoardEventType
 * @typedef {{ type: BoardEventType, file: string }} BoardEvent
 *   `file` e sempre relativo a raiz observada, com barra normal.
 */

// Um unico salvamento costuma disparar varios eventos de fs. Agrupamos por
// arquivo antes de mandar para o cliente para o iframe recarregar so uma vez.
const DEBOUNCE_MS = 80;

/**
 * @param {string} rootDir raiz observada (caminho absoluto)
 * @param {(event: BoardEvent) => void} onEvent chamado ja com o debounce aplicado
 * @returns {{ close: () => Promise<void> }}
 */
export function startWatcher(rootDir, onEvent) {
  /** @type {Map<string, NodeJS.Timeout>} */
  const timers = new Map();

  /**
   * @param {BoardEventType} type
   * @param {string} absolutePath
   */
  function emit(type, absolutePath) {
    const file = path.relative(rootDir, absolutePath).split(path.sep).join('/');
    const key = `${type}:${file}`;

    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        onEvent({ type, file });
      }, DEBOUNCE_MS),
    );
  }

  // HTML vira tela no board; qualquer outro arquivo e um asset em potencial
  // (CSS, imagem, fonte, script). Quem decide se o asset importa e o cliente,
  // que conhece os recursos realmente carregados por cada tela.
  /**
   * @param {BoardEventType} fsEvent
   * @param {string} absolutePath
   */
  function handle(fsEvent, absolutePath) {
    if (isHtmlFile(path.basename(absolutePath))) emit(fsEvent, absolutePath);
    else emit('asset', absolutePath);
  }

  const watcher = chokidar.watch(rootDir, {
    ignoreInitial: true,
    ignored: (entryPath) => entryPath !== rootDir && isIgnoredDir(path.basename(entryPath)),
    // Espera o arquivo parar de crescer antes de avisar, para o board nunca
    // carregar um arquivo escrito pela metade.
    awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 20 },
  });

  watcher.on('add', (file) => handle('add', file));
  watcher.on('change', (file) => handle('change', file));
  watcher.on('unlink', (file) => handle('unlink', file));

  return {
    async close() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await watcher.close();
    },
  };
}
