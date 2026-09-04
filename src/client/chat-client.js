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
  appendChatError, appendAssistantDelta, appendPermissionRequest, appendThinkingDelta,
  appendToolUse, applyServerConfig, setAutoApprove, setHasAmbientCredential, setHasKey, setSessionId,
  setTransport, setTurnRunning, updateToolResult,
} from './chat.js';
import { chat } from './state.js';

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
      setSessionId(asText(event.sessionId));
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

  setTransport({ send, stop, respondToPermission, saveKey, saveConfig });
}
