// @ts-check
// O que o board lembra entre sessoes: onde cada tela ficou no canvas, o
// rascunho e o historico da conversa e as preferencias do painel.
//
// Fica no localStorage do navegador, e nao em arquivo. O agente da conversa
// escreve na pasta observada, mas a *ferramenta* nao: um arquivo de layout
// dentro da pasta dos prototipos sujaria o diretorio de trabalho do usuario com
// algo que ele nao pediu e que nao e um prototipo.
//
// Duas familias de chave, por motivos diferentes:
//
//   por raiz observada  posicoes, rascunho e historico — o mesmo navegador abre
//                       boards de pastas diferentes, e uma coisa nao tem nada a
//                       ver com a outra
//   por navegador       snap-to-grid, largura da sidebar e as preferencias da
//                       conversa — sao jeito de trabalhar, nao conteudo de uma
//                       pasta
//
// As preferencias da conversa (`model`, `effort`, `sendOnEnter`) sao a excecao
// que confirma isso: quem manda nelas e a configuracao do servidor, em disco.
// O que fica aqui e o valor *mostrado* ate o `GET /api/chat/config` responder
// (veja `applyServerConfig`, em `chat.js`).
//
// Toda leitura e escrita e tolerante a falha: localStorage bloqueado (modo
// privado, cookies desligados) ou JSON estragado apenas devolve o board ao
// padrao, nunca derruba a pagina.

import { source } from './state.js';

const KEY_PREFIX = 'pinacoteca:positions:';

/**
 * Onde a tela ficou e, quando o usuario redimensionou, o tamanho que ele
 * escolheu. `width`/`height` sao opcionais de proposito: uma entrada gravada
 * antes do redimensionamento existir continua valendo, e a tela sem eles volta
 * a ser medida pelo conteudo.
 * @typedef {{ x: number, y: number, width?: number, height?: number }} Position
 */

/** @returns {string} */
function storageKey() {
  return `${KEY_PREFIX}${source.root}`;
}

/**
 * Posicoes salvas, por caminho relativo da tela.
 * @returns {Record<string, Position>} vazio quando nao ha nada utilizavel
 */
export function loadPositions() {
  /** @type {Record<string, Position>} */
  const positions = {};

  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return positions;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return positions;

    for (const [file, value] of Object.entries(parsed)) {
      // Descarta entrada estragada em vez de deixar um NaN chegar ao layout.
      if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) continue;

      /** @type {Position} */
      const position = { x: value.x, y: value.y };
      // Tamanho so entra se os dois lados vierem sadios: meio tamanho salvo
      // deixaria o card com uma dimensao do usuario e outra medida.
      if (Number.isFinite(value.width) && Number.isFinite(value.height)) {
        position.width = value.width;
        position.height = value.height;
      }
      positions[file] = position;
    }
  } catch {
    return {};
  }
  return positions;
}

/**
 * Posicao salva de uma tela so.
 * @param {string} file
 * @returns {Position | null}
 */
export function savedPosition(file) {
  return loadPositions()[file] ?? null;
}

/**
 * Grava a organizacao inteira. Quem chama ja filtrou o que e valido — aqui so
 * se escreve.
 * @param {Record<string, Position>} positions
 */
export function savePositions(positions) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(positions));
  } catch {
    // Sem espaco ou sem permissao: o board segue funcionando, so nao lembra.
  }
}

/** Esquece a organizacao deste board e volta ao layout automatico. */
export function clearPositions() {
  try {
    localStorage.removeItem(storageKey());
  } catch {
    // Idem: nada a fazer se o navegador nao deixa escrever.
  }
}

// O snap-to-grid e preferencia do navegador, nao da pasta observada: ao
// contrario das posicoes, uma chave so serve todo board aberto nele.
const SNAP_KEY = 'pinacoteca:snap-to-grid';

/** @returns {boolean} */
export function loadSnapToGrid() {
  try {
    return localStorage.getItem(SNAP_KEY) === '1';
  } catch {
    return false;
  }
}

/** @param {boolean} enabled */
export function saveSnapToGrid(enabled) {
  try {
    localStorage.setItem(SNAP_KEY, enabled ? '1' : '0');
  } catch {
    // Sem espaco ou sem permissao: segue funcionando, so nao lembra.
  }
}

// A largura da sidebar e preferencia do navegador, como o snap-to-grid: o
// tamanho confortavel do painel depende do monitor, nao da pasta observada.
const SIDEBAR_WIDTH_KEY = 'pinacoteca:sidebar-width';

/**
 * Largura salva da sidebar.
 * @returns {number} zero quando nao ha nada utilizavel — quem chama cai no padrao
 */
export function loadSidebarWidth() {
  try {
    const value = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    // Zero e negativo tambem caem aqui: nao sao largura de painel nenhum.
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** @param {number} width largura em px, ja validada por quem chama */
export function saveSidebarWidth(width) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    // Sem espaco ou sem permissao: segue funcionando, so nao lembra.
  }
}

// O rascunho do compositor e por raiz observada, como as posicoes: cada board
// aberto no navegador tem sua propria conversa em andamento, e o texto nao
// enviado de uma pasta nao faz sentido vazar para o board de outra.
const CHAT_DRAFT_KEY_PREFIX = 'pinacoteca:chat-draft:';

/** @returns {string} */
function chatDraftKey() {
  return `${CHAT_DRAFT_KEY_PREFIX}${source.root}`;
}

/**
 * Texto ainda nao enviado do compositor desta raiz.
 * @returns {string} vazio quando nao ha rascunho utilizavel
 */
export function loadChatDraft() {
  try {
    return localStorage.getItem(chatDraftKey()) ?? '';
  } catch {
    return '';
  }
}

/**
 * Grava o rascunho do compositor. Quem envia a mensagem deve apagar o
 * rascunho (`saveChatDraft('')`) para nao reaparecer na proxima carga.
 * @param {string} text
 */
export function saveChatDraft(text) {
  try {
    if (text) {
      localStorage.setItem(chatDraftKey(), text);
    } else {
      // String vazia nao precisa ocupar espaco no localStorage.
      localStorage.removeItem(chatDraftKey());
    }
  } catch {
    // Sem espaco ou sem permissao: segue funcionando, so nao lembra.
  }
}

// O historico de mensagens enviadas tambem e por raiz observada, pelo mesmo
// motivo do rascunho: e conversa de uma pasta especifica, e a seta pra cima
// so deve recuperar o que foi mandado para aquele board.
const CHAT_HISTORY_KEY_PREFIX = 'pinacoteca:chat-history:';

// Tamanho maximo do historico guardado. Alem disso, a entrada mais antiga cai
// para abrir espaco pra nova.
const CHAT_HISTORY_LIMIT = 50;

/** @returns {string} */
function chatHistoryKey() {
  return `${CHAT_HISTORY_KEY_PREFIX}${source.root}`;
}

/**
 * Mensagens ja enviadas nesta raiz, da mais antiga pra mais recente.
 * @returns {string[]} vazio quando nao ha historico utilizavel
 */
export function loadChatHistory() {
  try {
    const raw = localStorage.getItem(chatHistoryKey());
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Descarta qualquer entrada que nao seja texto, em vez de deixar lixo
    // chegar ao compositor.
    return parsed.filter((entry) => typeof entry === 'string');
  } catch {
    return [];
  }
}

/**
 * Acrescenta uma mensagem enviada ao historico desta raiz, respeitando
 * `CHAT_HISTORY_LIMIT`. Repeticao em sequencia (a mesma mensagem mandada duas
 * vezes seguidas) nao gera entrada nova.
 * @param {string} text
 */
export function pushChatHistory(text) {
  if (!text) return;

  try {
    const history = loadChatHistory();
    if (history[history.length - 1] === text) return;

    history.push(text);
    while (history.length > CHAT_HISTORY_LIMIT) history.shift();

    localStorage.setItem(chatHistoryKey(), JSON.stringify(history));
  } catch {
    // Sem espaco ou sem permissao: segue funcionando, so nao lembra.
  }
}

// Qual conversa esta aberta e por raiz observada, como as posicoes e o
// rascunho: o *conteudo* das conversas mora no servidor, mas qual delas se esta
// olhando e do navegador — duas janelas abertas na mesma pasta podem estar em
// conversas diferentes sem uma arrastar a outra.
const CHAT_OPEN_KEY_PREFIX = 'pinacoteca:chat-open:';

/** @returns {string} */
function chatOpenKey() {
  return `${CHAT_OPEN_KEY_PREFIX}${source.root}`;
}

/**
 * Id da conversa aberta nesta raiz.
 * @returns {string} vazio quando nenhuma esta aberta
 */
export function loadOpenConversation() {
  try {
    return localStorage.getItem(chatOpenKey()) ?? '';
  } catch {
    return '';
  }
}

/**
 * Grava qual conversa esta aberta. String vazia apaga a marca — e o que uma
 * conversa nova, ainda sem sessao, deixa gravado.
 * @param {string} id
 */
export function saveOpenConversation(id) {
  try {
    if (id) localStorage.setItem(chatOpenKey(), id);
    else localStorage.removeItem(chatOpenKey());
  } catch {
    // Sem espaco ou sem permissao: segue funcionando, so nao lembra.
  }
}

// As preferencias do painel de conversa sao preferencia do navegador, como o
// snap-to-grid: modelo, esforco e o atalho de envio nao mudam de pasta pra
// pasta, entao uma chave so serve todo board aberto nele.
const CHAT_PREFS_KEY = 'pinacoteca:chat-prefs';

// Espelham as listas de `src/server/config.js` (o cliente nao pode importar do
// servidor) e as opcoes de `index.html`. Um valor fora delas (config antiga,
// storage adulterado) vira o padrao em vez de vazar pra UI.
const CHAT_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
const CHAT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const DEFAULT_CHAT_MODEL = 'claude-opus-5';
const DEFAULT_CHAT_EFFORT = 'high';
const DEFAULT_CHAT_SEND_ON_ENTER = true;

/**
 * @typedef {{ model: string, effort: string, sendOnEnter: boolean }} ChatPrefs
 */

/** @returns {ChatPrefs} */
function defaultChatPrefs() {
  return {
    model: DEFAULT_CHAT_MODEL,
    effort: DEFAULT_CHAT_EFFORT,
    sendOnEnter: DEFAULT_CHAT_SEND_ON_ENTER,
  };
}

/**
 * Preferencias do painel de conversa.
 * @returns {ChatPrefs} o padrao sadio quando nao ha nada utilizavel
 */
export function loadChatPrefs() {
  const defaults = defaultChatPrefs();

  try {
    const raw = localStorage.getItem(CHAT_PREFS_KEY);
    if (!raw) return defaults;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;

    return {
      model: CHAT_MODELS.includes(parsed.model) ? parsed.model : defaults.model,
      effort: CHAT_EFFORTS.includes(parsed.effort) ? parsed.effort : defaults.effort,
      sendOnEnter:
        typeof parsed.sendOnEnter === 'boolean' ? parsed.sendOnEnter : defaults.sendOnEnter,
    };
  } catch {
    return defaults;
  }
}

/**
 * Grava as preferencias do painel de conversa.
 * @param {ChatPrefs} prefs
 */
export function saveChatPrefs(prefs) {
  try {
    localStorage.setItem(CHAT_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Sem espaco ou sem permissao: segue funcionando, so nao lembra.
  }
}
