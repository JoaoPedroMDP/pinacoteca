// @ts-check
// Todo o estado mutavel do board. Nenhum outro modulo declara `let` de escopo
// de modulo — quem precisa guardar algo entre eventos guarda aqui.
//
// Sao objetos mutaveis de proposito: `import { view }` da uma referencia viva,
// entao `view.scale = 2` num modulo e visto por todos, sem setter nenhum.

/**
 * Uma tela do board: o card no canvas, o item na sidebar e o que ja se sabe
 * sobre o conteudo dela.
 *
 * @typedef {Object} Screen
 * @property {string} file caminho relativo, o mesmo que vem do servidor
 * @property {HTMLElement} card o `<article>` posicionado no canvas
 * @property {HTMLElement} frame a caixa de altura medida em volta do iframe
 * @property {HTMLIFrameElement} iframe
 * @property {HTMLButtonElement} item a folha correspondente na sidebar
 * @property {Set<string>} assets recursos que o iframe de fato buscou
 * @property {number} frameWidth largura medida do conteudo, em px de canvas
 * @property {number} frameHeight altura medida do conteudo, em px de canvas
 * @property {number} x posicao no canvas, definida pelo layout ou pelo arrasto
 * @property {number} y posicao no canvas, definida pelo layout ou pelo arrasto
 * @property {boolean} pinned true quando a posicao veio do usuario (arrasto ou
 *   localStorage). Tela fixa nao e movida pelo layout automatico.
 * @property {number} pendingScroll scroll interno a restaurar apos recarregar
 * @property {ReturnType<typeof setTimeout> | null} lateScan segunda passada de
 *   assets e de medida do conteudo
 * @property {number} reloadsSinceSettle quantas vezes esta tela recarregou desde
 *   o ultimo silencio da pasta. Mais de uma significa que o arquivo chegou em
 *   pedacos, e o `settled` recarrega de novo para garantir o conteudo final.
 */

/**
 * Telas montadas, por caminho relativo. E a fonte da verdade do board: sidebar,
 * layout e eventos do servidor leem daqui.
 * @type {Map<string, Screen>}
 */
export const screens = new Map();

/** Pastas colapsadas na sidebar. Persiste entre re-renders de add/remove.
 * @type {Set<string>} */
export const collapsedDirs = new Set();

/**
 * De onde este board le. `root` e a pasta observada, preenchida na carga a
 * partir de `/api/screens`; e ela que identifica o board no localStorage, senao
 * duas pastas abertas no mesmo navegador embaralhariam as posicoes salvas.
 * @type {{ root: string }}
 */
export const source = { root: '' };

/**
 * Zoom e pan do canvas. Aplicado por `view.applyTransform`.
 * @type {{ scale: number, x: number, y: number }}
 */
export const view = { scale: 1, x: 0, y: 0 };

/**
 * Estado de interacao.
 *
 * - `mode`: `'pan'` arrasta o board (cursor de mao); `'pointer'` deixa o cursor
 *   normal e destaca o elemento sob ele.
 * - `interactiveFile`: a unica tela que esta recebendo cliques do usuario
 *   (duplo clique libera; `Esc` ou clique fora devolve o controle ao board).
 * - `snapToGrid`: liga o alinhamento a grade no arrasto de tela. Carregado do
 *   localStorage por `board.js` na carga inicial (`state.js` nao importa
 *   `storage.js` — a dependencia so anda numa direcao).
 * - `lastChangedFiles`: as telas atingidas pelo *ultimo* evento do servidor. Sao
 *   varias quando o evento foi um asset compartilhado. Ficam com contorno verde
 *   ate o proximo evento chegar.
 *
 * @type {{
 *   mode: 'pan' | 'pointer',
 *   interactiveFile: string | null,
 *   snapToGrid: boolean,
 *   lastChangedFiles: string[],
 * }}
 */
export const ui = {
  mode: 'pan', interactiveFile: null, snapToGrid: false, lastChangedFiles: [],
};
