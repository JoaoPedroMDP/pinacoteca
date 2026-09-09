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
 * @property {boolean} sized true quando o *tamanho* veio do usuario (arrasto de
 *   borda, preset ou localStorage). E para o tamanho o que `pinned` e para a
 *   posicao: enquanto vale, `resizeToContent` nao remede a tela, senao a
 *   proxima recarga do iframe desfaria a escolha do usuario.
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
 * - `openSizeMenuFile`: a unica tela com o menu de tamanho aberto. Um por vez,
 *   pelo mesmo motivo de `interactiveFile`.
 * - `snapToGrid`: liga o alinhamento a grade no arrasto de tela. Carregado do
 *   localStorage por `board.js` na carga inicial (`state.js` nao importa
 *   `storage.js` — a dependencia so anda numa direcao).
 * - `lastChangedFiles`: as telas atingidas pelo *ultimo* evento do servidor. Sao
 *   varias quando o evento foi um asset compartilhado. Ficam com contorno verde
 *   ate o proximo evento chegar.
 * - `activeTab`: qual painel da sidebar esta visivel — a arvore de telas ou a
 *   conversa. Trocado por `tabs.js`.
 *
 * @type {{
 *   mode: 'pan' | 'pointer',
 *   interactiveFile: string | null,
 *   openSizeMenuFile: string | null,
 *   snapToGrid: boolean,
 *   lastChangedFiles: string[],
 *   activeTab: 'screens' | 'chat',
 *   sidebarWidth: number,
 * }}
 */
export const ui = {
  mode: 'pan',
  interactiveFile: null,
  openSizeMenuFile: null,
  snapToGrid: false,
  lastChangedFiles: [],
  activeTab: 'screens',
  // Largura em px ja validada. Zero ate `board.js` aplicar a largura salva.
  sidebarWidth: 0,
};

/**
 * Uma mensagem ja montada no log. `text` e a fonte da verdade do que esta
 * escrito: a bolha do assistente cresce em streaming, e reescrever o
 * `textContent` a partir daqui evita remontar o no a cada delta.
 *
 * @typedef {Object} ChatMessage
 * @property {'user' | 'assistant'} role
 * @property {string} text
 * @property {HTMLElement} bubble o no correspondente dentro de `#chat-log`
 */

/**
 * Como a conversa chega ao servidor. `chat.js` nao faz `fetch`: ele so chama
 * estes callbacks, e quem os registra e o modulo de transporte.
 *
 * Todos sao opcionais porque o painel funciona sem nenhum — antes de haver
 * chave configurada, enviar apenas desenha a mensagem do usuario no log.
 *
 * @typedef {Object} ChatTransport
 * @property {(text: string) => void} [send] manda a mensagem e abre o stream
 * @property {() => void} [stop] interrompe o turno em andamento
 * @property {(requestId: string, allow: boolean) => void} [respondToPermission]
 * @property {(apiKey: string) => void} [saveKey] grava a chave no servidor
 * @property {(config: { model: string, effort: string, sendOnEnter: boolean,
 *   autoApprove: boolean }) => void} [saveConfig]
 */

/**
 * A conversa com o agente: o que ja foi dito, o que esta acontecendo agora e
 * quem leva os gestos ao servidor.
 *
 * - `sessionId`: a sessao devolvida pelo servidor, mandada de volta em cada
 *   mensagem seguinte para o agente continuar de onde parou.
 * - `running`: um turno esta em andamento (o botao Parar no lugar do Enviar).
 * - `autoApprove`: aprova as edicoes sem perguntar. E estado de conversa, e nao
 *   preferencia do navegador: quem o guarda entre sessoes e a config do
 *   servidor, junto da chave.
 * - `hasKey`: o servidor ja tem uma chave gravada. Enquanto for falso, o painel
 *   de configuracao fica a vista.
 * - `messages`: as bolhas montadas, na ordem em que entraram no log.
 * - `streaming`: a bolha de assistente que esta crescendo, ou `null` entre
 *   turnos. `thinking` e o corpo do bloco de raciocinio do mesmo turno.
 * - `tools` e `pending`: blocos ainda abertos, pelo id que o servidor mandou —
 *   e por eles que o resultado e a resposta de permissao acham o no certo.
 * - `draftTimer`: o debounce da gravacao do rascunho.
 *
 * @type {{
 *   sessionId: string | null,
 *   running: boolean,
 *   autoApprove: boolean,
 *   hasKey: boolean,
 *   hasAmbientCredential: boolean,
 *   messages: ChatMessage[],
 *   streaming: ChatMessage | null,
 *   thinking: HTMLElement | null,
 *   tools: Map<string, HTMLElement>,
 *   pending: Map<string, HTMLElement>,
 *   transport: ChatTransport | null,
 *   draftTimer: ReturnType<typeof setTimeout> | null,
 * }}
 */
export const chat = {
  sessionId: null,
  running: false,
  autoApprove: false,
  hasKey: false,
  hasAmbientCredential: false,
  messages: [],
  streaming: null,
  thinking: null,
  tools: new Map(),
  pending: new Map(),
  transport: null,
  draftTimer: null,
};

/**
 * Um comentário endereçado ao agente de IA, apontando para um nó do protótipo.
 *
 * @typedef {Object} CommentItem
 * @property {string} xpath XPath do nó no documento do iframe — chave dentro
 *   do arquivo, calculado por `computeXPath`/`resolveXPath` em `utils.js`.
 * @property {string} text o comentário, editado ao vivo na caixinha
 * @property {'draft' | 'confirmed' | 'sending' | 'unreferenced'} status
 * @property {{x: number, y: number} | null} anchorPoint última posição
 *   conhecida do nó, em coordenadas internas do iframe (`getBoundingClientRect`
 *   de dentro dele) — o balão/caixinha usa isso para se desenhar sem esperar o
 *   próximo hover, e continua correto sob pan/zoom porque a camada em que
 *   `anchorPoint` é desenhado já carrega o `transform` do canvas.
 */

/**
 * Fila local de comentários endereçados à IA, por tela e por XPath do nó —
 * chave dupla porque XPath só é único dentro do mesmo documento. Board
 * (`inspect.js`) e chat (`chat.js`) leem daqui direto e se inscrevem em
 * `onQueueChange` para redesenhar; nenhum dos dois guarda cópia própria.
 * @type {Map<string, Map<string, CommentItem>>}
 */
export const commentQueue = new Map();

/** @type {Array<() => void>} */
const queueListeners = [];

/**
 * Inscreve uma função para redesenhar sempre que `commentQueue` mudar.
 * @param {() => void} listener
 */
export function onQueueChange(listener) {
  queueListeners.push(listener);
}

/** Avisa quem se inscreveu em `onQueueChange` que a fila mudou. */
export function notifyQueueChange() {
  for (const listener of queueListeners) listener();
}
