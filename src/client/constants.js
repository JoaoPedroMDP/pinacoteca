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
export const MAX_FRAME_HEIGHT = 6400;

/**
 * Teto da largura no redimensionamento manual. Maior que `CARD_WIDTH`, que e
 * so a viewport de referencia da medida automatica: pela mao do usuario faz
 * sentido esticar o card ate uma tela ultra-wide.
 */
export const MAX_FRAME_WIDTH = 3840;

/**
 * Folga de agarre das bordas redimensionaveis, em px de tela. Em px de tela e
 * nao de canvas de proposito: a faixa que o cursor precisa acertar tem de ter
 * o mesmo tamanho em qualquer nivel de zoom.
 */
export const RESIZE_EDGE_PX = 8;

/**
 * Cursor de cada borda redimensionavel. Unico lugar que faz esse mapa: o hover
 * do escudo e o arrasto em andamento leem daqui.
 * @type {Record<import('./utils.js').ResizeZone, string>}
 */
export const RESIZE_CURSORS = {
  right: 'ew-resize',
  bottom: 'ns-resize',
  corner: 'nwse-resize',
};

/**
 * Dimensoes do menu de tamanho do card. Sao viewports de dispositivo comuns —
 * a ideia e conferir o prototipo num tamanho conhecido sem ter de arrastar a
 * borda ate acertar o numero. "Automatico" nao entra aqui: nao tem tamanho
 * fixo, devolve a tela a medida do proprio conteudo.
 * @type {Array<{ label: string, width: number, height: number }>}
 */
export const PRESET_FRAME_SIZES = [
  { label: 'Mobile', width: 375, height: 667 },
  { label: 'Tablet', width: 768, height: 1024 },
  { label: 'Laptop', width: 1366, height: 768 },
  { label: 'Desktop', width: 1920, height: 1080 },
];

/**
 * Limites da largura da sidebar, em px. O minimo e a largura em que o
 * compositor da conversa ainda cabe com os seletores lado a lado; o maximo
 * existe so para o arrasto nao virar tela cheia por acidente.
 */
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 720;

/** Largura de partida, antes de o usuario arrastar (espelha `board.css`). */
export const SIDEBAR_DEFAULT_WIDTH = 240;

/**
 * Quanto de viewport a sidebar nunca pode comer. Numa janela estreita este
 * piso vence o `SIDEBAR_MAX_WIDTH`: sobrar board para ver o prototipo importa
 * mais do que respeitar a largura pedida.
 */
export const SIDEBAR_MIN_CANVAS = 320;

/** Espaco entre cards, em px de canvas. */
export const GAP = 72;

/**
 * Deslocamento minimo, em px de tela, para o pointerdown do pan virar arrasto
 * de fato (e so entao capturar o ponteiro). Abaixo disso e tratado como
 * clique: sem o limiar, capturar no pointerdown redireciona o click/dblclick
 * seguinte para o viewport em vez do escudo sob o cursor, e o duplo clique
 * que libera um card pra interagir nunca chega ao listener dele.
 */
export const PAN_DRAG_THRESHOLD = 4;

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

/* ---------- Conversa ---------- */

/** Altura maxima do compositor, em px. Passando disso ele rola por dentro. */
export const CHAT_INPUT_MAX_HEIGHT = 220;

/** Quantos passos de desfazer o compositor guarda. */
export const CHAT_UNDO_LIMIT = 100;

/** Pausa de digitacao que fecha um grupo de desfazer, em ms. */
export const CHAT_UNDO_GROUP_MS = 600;

/** Espera antes de gravar o rascunho no localStorage, em ms. */
export const CHAT_DRAFT_DEBOUNCE_MS = 400;

/** Folga, em px, para o log ainda contar como "no fim". */
export const CHAT_SCROLL_SLACK = 24;

/** Quantos caracteres da entrada de uma tool cabem no bloco resumido. */
export const CHAT_TOOL_INPUT_CHARS = 140;
