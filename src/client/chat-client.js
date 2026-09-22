// @ts-check
// Transporte da conversa: e o unico modulo do cliente que fala com as rotas
// `/api/chat/`.
//
// `chat.js` desenha e nao faz rede; este arquivo faz rede e nao desenha. Cada
// evento que chega do servidor vira uma chamada daquele modulo, e cada gesto do
// usuario vira um `fetch` daqui.
//
// Todo `fetch` daqui trata falha. O board fica aberto o dia todo: erro de rede
// vira um bloco de erro no log, nunca uma promessa rejeitada solta no console.

import {
  appendChatError, appendAssistantDelta, appendPermissionRequest, appendQuestionRequest,
  appendThinkingDelta, appendToolUse, appendUserMessage, applyServerConfig, closeQuestion,
  expirePermission, markPermission, resetChatLog, setAutoApprove, setSessionId,
  setTransport, setTurnRunning, updateToolResult,
} from './chat.js';
import { renderConversations } from './conversations.js';
import { setHasAmbientCredential, setHasKey } from './settings.js';
import { chat } from './state.js';
import { loadOpenConversation, saveOpenConversation } from './storage.js';
import { showTab } from './tabs.js';

/** Rotas da conversa. O servidor so aceita `POST` embaixo deste prefixo. */
const CHAT_API = '/api/chat';

/* ---------- Estado do gesto ---------- */

/**
 * O turno em andamento. E estado de *um gesto*, como o acumulado da roda em
 * `controls.js`: nasce no envio e morre no `done`. Serve para o Parar abortar o
 * `fetch` que ainda esta lendo o stream.
 * @type {AbortController | null}
 */
let turn = null;

/* ---------- Parser de SSE ---------- */

/**
 * Corta um pedaco do stream em eventos completos. Funcao pura: recebe o que
 * sobrou do pedaco anterior e devolve os eventos fechados mais o novo resto.
 *
 * O protocolo separa eventos por linha em branco e permite varias linhas
 * `data:` no mesmo evento (juntadas por `\n`). Linha que comeca com `:` e
 * comentario — o servidor manda isso como batimento — e some aqui. O ultimo
 * bloco so vira evento quando o terminador chegar; ate la ele continua no
 * `rest`, senao um JSON cortado no meio do chunk viraria erro de parse.
 *
 * @param {string} pending o que sobrou da chamada anterior
 * @param {string} chunk texto recem-decodificado do corpo da resposta
 * @returns {{ events: string[], rest: string }} `events` sao os payloads `data:`
 *   ja juntados, um por evento
 */
export function parseSseChunk(pending, chunk) {
  // `\r\n` e `\r` sao terminadores validos no protocolo; normalizar aqui deixa
  // o resto da funcao com um caso so.
  const buffer = `${pending}${chunk}`.replace(/\r\n?/g, '\n');
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';

  /** @type {string[]} */
  const events = [];
  for (const block of blocks) {
    /** @type {string[]} */
    const data = [];
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;
      // Um unico espaco depois dos dois-pontos e separador, nao conteudo.
      data.push(line.slice('data:'.length).replace(/^ /, ''));
    }
    if (data.length > 0) events.push(data.join('\n'));
  }

  return { events, rest };
}

/* ---------- Aplicacao dos eventos ---------- */

/**
 * Um evento ja decodificado. O contrato esta em `src/server/agent.js`; aqui ele
 * chega como objeto solto, porque veio de JSON.
 * @typedef {Record<string, unknown>} RawEvent
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asObject(value) {
  return (typeof value === 'object' && value !== null && !Array.isArray(value))
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * Passa a tratar `sessionId` como a conversa aberta: o estado, a marca no
 * `localStorage` e a lista, que so entao sabe qual linha esta aberta.
 *
 * @param {string | null} sessionId
 */
function openHere(sessionId) {
  setSessionId(sessionId);
  saveOpenConversation(sessionId ?? '');
  renderConversations();
}

/**
 * Leva um evento do servidor para o modulo que desenha.
 *
 * `done` e `error` sao os unicos que destravam a interface — quem liga o turno
 * e o proprio `chat.js`, no envio, mas desliga-lo e daqui.
 *
 * @param {RawEvent} event
 */
function applyEvent(event) {
  switch (event.type) {
    case 'session':
      openHere(asText(event.sessionId));
      break;

    case 'text':
      appendAssistantDelta(asText(event.delta));
      break;

    case 'thinking':
      appendThinkingDelta(asText(event.delta));
      break;

    case 'tool':
      appendToolUse({ id: asText(event.id), name: asText(event.name), input: event.input });
      break;

    case 'tool-result':
      updateToolResult({
        id: asText(event.id),
        ok: event.ok === true,
        summary: asText(event.summary),
      });
      break;

    case 'permission':
      appendPermissionRequest({
        requestId: asText(event.requestId),
        toolName: asText(event.toolName),
        input: event.input,
        diff: asText(event.diff),
      });
      break;

    case 'question':
      appendQuestionRequest({ requestId: asText(event.requestId), questions: event.questions });
      break;

    case 'error':
      appendChatError(asText(event.message) || 'Erro na conversa.');
      setTurnRunning(false);
      break;

    case 'done':
      setTurnRunning(false);
      break;

    default:
      // Evento de um contrato mais novo que este board: ignorar e melhor do que
      // sujar o log com algo que o usuario nao pode resolver.
      break;
  }
}

/**
 * @param {string} payload o texto de um evento, ainda em JSON
 * @returns {boolean} o evento era um `done`?
 */
function applyPayload(payload) {
  /** @type {RawEvent} */
  let event;
  try {
    event = asObject(JSON.parse(payload));
  } catch {
    appendChatError('Evento invalido recebido do servidor.');
    return false;
  }
  applyEvent(event);
  return event.type === 'done';
}

/**
 * Le o corpo da resposta ate o fim, aplicando cada evento assim que fecha.
 *
 * @param {Response} response
 * @returns {Promise<boolean>} true se um `done` chegou
 */
async function readStream(response) {
  const body = response.body;
  if (!body) return false;

  const reader = body.getReader();
  const decoder = new globalThis.TextDecoder();
  let pending = '';
  let sawDone = false;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    const { events, rest } = parseSseChunk(pending, decoder.decode(value, { stream: true }));
    pending = rest;
    for (const payload of events) {
      if (applyPayload(payload)) sawDone = true;
    }
  }

  // O que sobrou sem linha em branco no fim ainda pode ser um evento inteiro.
  const { events } = parseSseChunk(pending, '\n\n');
  for (const payload of events) {
    if (applyPayload(payload)) sawDone = true;
  }

  return sawDone;
}

/* ---------- Replay do transcript ---------- */

/**
 * O que o usuario respondeu a cada pedido, pelo transcript. Sem isso um pedido
 * ja aprovado voltaria pendente na tela.
 *
 * @param {RawEvent[]} events
 * @returns {Map<string, { allow: boolean, answers: Record<string, unknown> }>}
 */
function permissionResults(events) {
  /** @type {Map<string, { allow: boolean, answers: Record<string, unknown> }>} */
  const results = new Map();

  for (const event of events) {
    if (event.type !== 'permission-result') continue;
    results.set(asText(event.requestId), {
      allow: event.allow === true,
      answers: asObject(event.answers),
    });
  }
  return results;
}

/**
 * O rodape de uma pergunta ja respondida, montado do que ficou gravado.
 *
 * @param {{ allow: boolean, answers: Record<string, unknown> }} result
 * @returns {string}
 */
function answeredVerdict(result) {
  if (!result.allow) return 'cancelado';

  const lines = Object.entries(result.answers)
    .filter(([, value]) => typeof value === 'string' && value !== '')
    .map(([question, value]) => `${question}: ${value}`);

  return lines.join('\n') || 'respondido';
}

/**
 * Redesenha um evento gravado.
 *
 * Ele passa pelos mesmos desenhadores do stream ao vivo — dois caminhos de
 * desenho divergiriam no primeiro bloco novo. O que muda e so o que nao faz
 * sentido fora do turno: nada e respondido sozinho, nada e mandado ao servidor,
 * e o pedido que ficou sem resposta volta expirado, porque o turno que o
 * esperava acabou faz tempo.
 *
 * @param {RawEvent} event
 * @param {Map<string, { allow: boolean, answers: Record<string, unknown> }>} results
 */
function replayEvent(event, results) {
  const requestId = asText(event.requestId);
  const result = results.get(requestId);

  switch (event.type) {
    case 'user':
      appendUserMessage(asText(event.text));
      break;

    case 'permission':
      appendPermissionRequest({
        requestId,
        toolName: asText(event.toolName),
        input: event.input,
        diff: asText(event.diff),
        replay: true,
      });
      if (result) markPermission(requestId, result.allow);
      else expirePermission(requestId);
      break;

    case 'question':
      appendQuestionRequest({ requestId, questions: event.questions, replay: true });
      closeQuestion(requestId, result ? answeredVerdict(result) : 'o turno terminou sem resposta');
      break;

    // `done`, `session` e `permission-result` nao tem o que desenhar: o turno
    // deles ja acabou, a sessao veio da propria rota e o veredito ja foi
    // pintado no bloco acima.
    case 'done':
    case 'session':
    case 'permission-result':
      break;

    default:
      applyEvent(event);
  }
}

/**
 * Redesenha a conversa inteira a partir do que o servidor gravou.
 * @param {RawEvent[]} events
 */
function replay(events) {
  const results = permissionResults(events);
  for (const event of events) replayEvent(event, results);
}

/* ---------- Requisicoes ---------- */

/**
 * `POST` de JSON numa rota da conversa.
 *
 * @param {string} route caminho depois de `/api/chat`
 * @param {unknown} body
 * @param {AbortSignal} [signal]
 * @returns {Promise<Response>}
 */
function postJson(route, body, signal) {
  return fetch(`${CHAT_API}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Mensagem de erro de uma resposta que nao foi 2xx. O servidor responde texto
 * cru nesses casos; se nem isso der para ler, sobra o status.
 *
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function failureMessage(response) {
  const text = await response.text().catch(() => '');
  return text.trim() || `O servidor respondeu ${response.status}.`;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  return error instanceof Error && error.message ? error.message : String(error);
}

/* ---------- Turno ---------- */

/**
 * Manda a mensagem e consome o stream do turno inteiro.
 *
 * Sai sempre com o turno destravado: stream cortado no meio (servidor caiu, rede
 * caiu) e tratado como erro, senao o botao Parar ficaria preso para sempre.
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
async function runTurn(text) {
  const controller = new globalThis.AbortController();
  turn = controller;

  try {
    const response = await postJson('/message', { sessionId: chat.sessionId, text }, controller.signal);

    if (!response.ok) {
      appendChatError(await failureMessage(response));
      setTurnRunning(false);
      return;
    }

    if (!(await readStream(response))) {
      appendChatError('A conversa com o servidor terminou no meio do turno.');
      setTurnRunning(false);
    }
  } catch (error) {
    // Abortar e o Parar do usuario, nao uma falha: o `done` do servidor pode
    // nem chegar, mas a interface tem de voltar ao normal do mesmo jeito.
    if (!controller.signal.aborted) appendChatError(describeError(error));
    setTurnRunning(false);
  } finally {
    if (turn === controller) turn = null;
    // O turno mudou a conversa: ela pode ter acabado de nascer, mudado de
    // titulo ou subido para o topo da lista.
    void loadConversations();
  }
}

/**
 * @param {string} text
 */
function send(text) {
  void runTurn(text);
}

/**
 * Interrompe o turno: avisa o servidor **e** aborta a leitura local. So abortar
 * aqui deixaria o agente rodando do outro lado, gastando dinheiro sem ninguem
 * lendo a resposta.
 */
function stop() {
  const controller = turn;
  turn = null;

  if (chat.sessionId) {
    postJson('/interrupt', { sessionId: chat.sessionId })
      .catch(() => appendChatError('Nao foi possivel avisar o servidor para parar.'));
  }

  // Abortar cai no `catch` do turno, que e quem destrava a interface. Sem turno
  // em andamento (o botao ficou visivel por engano) resta destravar aqui.
  if (controller) controller.abort();
  else setTurnRunning(false);
}

/**
 * Resposta do usuario a um pedido de permissao. O desenho ja aconteceu em
 * `chat.js`; aqui so o servidor e avisado.
 *
 * @param {string} requestId
 * @param {boolean} allow
 */
function respondToPermission(requestId, allow) {
  postJson('/permission', { sessionId: chat.sessionId, requestId, allow })
    .then(async (response) => {
      if (!response.ok) appendChatError(await failureMessage(response));
    })
    .catch((error) => appendChatError(describeError(error)));
}

/**
 * Resposta do usuario a uma pergunta do agente. Vai pela mesma rota da
 * permissao: os dois destravam o mesmo `canUseTool` parado do outro lado.
 *
 * `allow: false` e o cancelamento — o "x" do bloco. A tool volta negada ao
 * modelo, que e como se diz "siga sem isto"; mandar `allow: true` com um
 * `answers` vazio diria outra coisa, que houve escolha e ela foi nenhuma.
 *
 * @param {string} requestId
 * @param {{ allow: boolean, answers: Record<string, string> }} reply
 */
function respondToQuestion(requestId, { allow, answers }) {
  postJson('/permission', { sessionId: chat.sessionId, requestId, allow, answers })
    .then(async (response) => {
      if (!response.ok) appendChatError(await failureMessage(response));
    })
    .catch((error) => appendChatError(describeError(error)));
}

/* ---------- Conversas gravadas ---------- */

/**
 * Relê a lista de conversas desta pasta e redesenha a subaba `Conversas`.
 *
 * Falha de rede aqui nao vira bloco de erro no log: a lista e um painel
 * lateral, e derrubar a conversa aberta por causa dela seria pior do que
 * mostra-la desatualizada.
 *
 * @returns {Promise<void>}
 */
async function loadConversations() {
  try {
    const response = await fetch(`${CHAT_API}/conversations`);
    if (!response.ok) return;

    const body = asObject(await response.json());
    chat.conversations = Array.isArray(body.conversations) ? body.conversations : [];
    renderConversations();
  } catch {
    // Servidor fora do ar: a lista fica como estava.
  }
}

/**
 * Abre a conversa `id`: troca o log pelo transcript dela e vai para o `Chat`.
 *
 * @param {string} id
 * @param {{ quiet?: boolean }} [options] `quiet` e a restauracao da carga —
 *   conversa que sumiu do disco nao e erro do usuario, e so uma marca velha
 * @returns {Promise<boolean>} conseguiu abrir?
 */
async function openConversation(id, { quiet = false } = {}) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(`${CHAT_API}/conversations/${encodeURIComponent(id)}`);
  } catch (error) {
    if (!quiet) appendChatError(describeError(error));
    return false;
  }

  if (!response.ok) {
    // Conversa apagada por outra aba: a marca no navegador e que esta velha.
    if (response.status === 404) saveOpenConversation('');
    else if (!quiet) appendChatError(await failureMessage(response));
    return false;
  }

  const body = asObject(await response.json());
  resetChatLog();
  replay(Array.isArray(body.events) ? /** @type {RawEvent[]} */ (body.events) : []);
  openHere(asText(body.sessionId) || id);
  showTab('chat', 'chat');
  return true;
}

/**
 * Comeca uma conversa do zero: log vazio e nenhuma sessao. Ela so passa a
 * existir no disco quando a primeira mensagem for enviada — ate la nao ha
 * transcript nenhum para listar.
 */
function newConversation() {
  resetChatLog();
  openHere(null);
  showTab('chat', 'chat');
}

/**
 * Apaga uma conversa gravada. Se era a aberta, o `Chat` fica vazio: o que ele
 * mostrava nao existe mais.
 *
 * @param {string} id
 */
function removeConversation(id) {
  postJson('/conversations/delete', { id })
    .then(async (response) => {
      if (!response.ok) {
        appendChatError(await failureMessage(response));
        return;
      }
      if (chat.sessionId === id) {
        resetChatLog();
        openHere(null);
      }
      await loadConversations();
    })
    .catch((error) => appendChatError(describeError(error)));
}

/* ---------- Configuracao ---------- */

/**
 * Pinta na interface a projecao publica da configuracao.
 *
 * Ela e a verdade: a configuracao mora em disco, do lado do servidor, e este
 * board apenas a mostra. Duas abas abertas na mesma pinacoteca chegam ao mesmo
 * estado por aqui, e o `localStorage` do navegador nao passa de cache de
 * exibicao (veja `applyServerConfig`, em `chat.js`).
 *
 * @param {Record<string, unknown>} config
 */
function showConfig(config) {
  setHasKey(config.hasKey === true);
  setHasAmbientCredential(config.hasAmbientCredential === true);
  setAutoApprove(config.autoApprove === true);
  applyServerConfig(config);
}

/**
 * Aplica na interface a configuracao devolvida por uma rota de `/config`.
 *
 * @param {Response} response
 * @returns {Promise<void>}
 */
async function applyConfig(response) {
  if (!response.ok) {
    appendChatError(await failureMessage(response));
    return;
  }

  showConfig(asObject(await response.json()));
}

/**
 * Grava a chave da API no servidor. A chave nunca volta: a resposta so diz que
 * existe uma.
 *
 * @param {string} apiKey
 */
function saveKey(apiKey) {
  postJson('/config', { apiKey })
    .then(applyConfig)
    .catch((error) => appendChatError(describeError(error)));
}

/**
 * Grava as preferencias da conversa no servidor.
 *
 * @param {{ model: string, effort: string, sendOnEnter: boolean, autoApprove: boolean }} config
 */
function saveConfig(config) {
  postJson('/config', config)
    .then(applyConfig)
    .catch((error) => appendChatError(describeError(error)));
}

/* ---------- Ligacao ---------- */

/**
 * Le a configuracao do servidor, pinta a interface com ela e registra o
 * transporte. Chamada por `board.js` depois de `initChat`: e esta leitura que
 * decide o modelo, o esforco e o modo de envio mostrados, por cima do que o
 * `initChat` tirou do `localStorage`.
 *
 * Servidor fora do ar nao derruba a carga do board: o transporte fica
 * registrado do mesmo jeito, e a primeira mensagem e que vai reclamar.
 *
 * @returns {Promise<void>}
 */
export async function connectChat() {
  try {
    const response = await fetch(`${CHAT_API}/config`);
    if (response.ok) showConfig(asObject(await response.json()));
  } catch {
    // Sem a configuracao, o painel da chave continua a vista — que e o estado
    // inicial. Nao ha nada a fazer aqui alem de nao quebrar a carga.
  }

  setTransport({
    send, stop, respondToPermission, respondToQuestion, saveKey, saveConfig,
    openConversation: (id) => void openConversation(id),
    newConversation,
    deleteConversation: removeConversation,
  });

  await loadConversations();

  // Havia uma conversa aberta nesta pasta: ela volta como estava, na subaba
  // `Chat`. Sem conversa nenhuma — primeira vez aqui, ou a ultima foi apagada —
  // a aba abre na lista, que e onde se escolhe ou se comeca uma.
  const openId = loadOpenConversation();
  if (!openId || !(await openConversation(openId, { quiet: true }))) showTab('chat', 'list');
}
