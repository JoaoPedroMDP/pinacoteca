// @ts-check
// Observa a pasta e traduz eventos do sistema de arquivos em eventos do board.

import path from 'node:path';
import chokidar from 'chokidar';
import { isHtmlFile, isIgnoredDir } from './screens.js';

/**
 * Contrato de evento entre servidor e board. O espelho deste bloco vive em
 * `src/client/sse.js` — mudou aqui, muda la, e o e2e cobre os quatro tipos.
 *
 * - `add`     tela nova       — board insere card e item na sidebar
 * - `change`  conteudo mudou  — board recarrega so aquele iframe
 * - `unlink`  tela removida   — board tira card e item
 * - `asset`   arquivo nao-HTML mudou — board recarrega as telas que o carregaram
 * - `settled` a pasta inteira silenciou — board remede os cards e recarrega os
 *   que chegaram em pedacos. `file` vem vazio: o evento e sobre a pasta, nao
 *   sobre um arquivo.
 *
 * O servidor nao sabe quais telas um asset afeta e nao tenta descobrir: quem
 * cruza isso com os recursos realmente carregados e o cliente.
 *
 * @typedef {'add' | 'change' | 'unlink' | 'asset' | 'settled'} BoardEventType
 * @typedef {{ type: BoardEventType, file: string }} BoardEvent
 *   `file` e sempre relativo a raiz observada, com barra normal.
 */

// Um unico salvamento costuma disparar varios eventos de fs. Agrupamos por
// arquivo antes de mandar para o cliente para o iframe recarregar so uma vez.
const DEBOUNCE_MS = 80;

// Silencio na pasta *inteira* que conta como "quem estava escrevendo parou".
// Precisa ser bem maior que o DEBOUNCE_MS, senao o `settled` chegaria ao board
// antes do `change` que o provocou.
const QUIET_MS = 500;

// Janela em que o chokidar junta um `unlink` seguido de `add` no mesmo caminho
// e trata os dois como um `change`. E o que acontece numa escrita atomica
// (grava temporario, renomeia por cima). O padrao do chokidar sao 100ms, curto
// demais para um agente que escreve um HTML inteiro: passando disso, o board
// destruiria o card e montaria outro no lugar — perdendo o enquadramento e
// jogando a camera para cima da tela recem-criada.
const ATOMIC_WINDOW_MS = 300;

/**
 * @param {string} rootDir raiz observada (caminho absoluto)
 * @param {(event: BoardEvent) => void} onEvent chamado ja com o debounce aplicado
 * @returns {{ close: () => Promise<void> }}
 */
export function startWatcher(rootDir, onEvent) {
  /** @type {Map<string, NodeJS.Timeout>} */
  const timers = new Map();

  /** @type {NodeJS.Timeout | null} */
  let quietTimer = null;

  /**
   * Reinicia a contagem de silencio. Enquanto chegar evento, nada e anunciado;
   * quando a pasta para de se mexer por `QUIET_MS`, o board e avisado de que
   * pode conferir o resultado final.
   */
  function armSettled() {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      quietTimer = null;
      onEvent({ type: 'settled', file: '' });
    }, QUIET_MS);
  }

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
    armSettled();
  }

  const watcher = chokidar.watch(rootDir, {
    ignoreInitial: true,
    ignored: (entryPath) => entryPath !== rootDir && isIgnoredDir(path.basename(entryPath)),
    // Espera o arquivo parar de crescer antes de avisar, para o board nunca
    // carregar um arquivo escrito pela metade. So compara tamanho, entao nao e
    // garantia: quem fecha essa fresta e o `settled`.
    awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 20 },
    atomic: ATOMIC_WINDOW_MS,
  });

  watcher.on('add', (file) => handle('add', file));
  watcher.on('change', (file) => handle('change', file));
  watcher.on('unlink', (file) => handle('unlink', file));

  return {
    async close() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      if (quietTimer) clearTimeout(quietTimer);
      await watcher.close();
    },
  };
}
