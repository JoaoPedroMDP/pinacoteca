// @ts-check
// Todos os numeros ajustaveis do board, num lugar so.
//
// Se um valor precisa ser explicado, o comentario fica aqui — o ARCHITECTURE.md
// conta o *porque* da decisao, nunca repete o *quanto*.

/** Largura maxima e viewport de referencia de cada prototipo (desktop). */
export const CARD_WIDTH = 1280;
export const MIN_FRAME_WIDTH = 200;

/** Altura do rotulo acima do frame: 28px de linha + 8px de margin (veja `board.css`). */
export const CARD_TITLE_HEIGHT = 36;

export const DEFAULT_FRAME_HEIGHT = 800;
export const MIN_FRAME_HEIGHT = 400;
export const MAX_FRAME_HEIGHT = 3200;

/** Espaco entre cards, em px de canvas. */
export const GAP = 72;

/** Tamanho da celula da grade quando o snap-to-grid esta ligado, em px de canvas. */
export const GRID_SIZE = 20;

/** Folga em volta do conteudo ao enquadrar (`fit`) e ao centralizar numa tela. */
export const FIT_PADDING = 64;
export const CENTER_PADDING = 48;

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 2;

/** Quanto cada clique no `+`/`-` (e as teclas correspondentes) multiplica o zoom. */
export const ZOOM_STEP = 1.2;

/**
 * Divisor do `deltaY` no zoom por scroll (Ctrl/Cmd + roda). Quanto maior, mais
 * suave — o fator vira `exp(-deltaY / WHEEL_ZOOM_DAMPING)`.
 */
export const WHEEL_ZOOM_DAMPING = 200;

/**
 * Scroll acumulado necessario para trocar um nivel no modo ponteiro. Sem esse
 * limiar o touchpad — que dispara muitos deltas pequenos — pularia varios
 * niveis por toque.
 */
export const WHEEL_STEP = 100;

/**
 * Segunda passada no map de assets depois do `load`, para pegar recursos que
 * chegam tarde (JS que injeta imagem, CSS pedido em runtime).
 */
export const LATE_ASSET_SCAN_MS = 1200;

/** Quanto o toast fica visivel. */
export const TOAST_MS = 2400;
