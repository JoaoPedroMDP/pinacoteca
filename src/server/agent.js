// @ts-check
// Ponte com o Claude Agent SDK: uma conversa por sessao, traduzida nos eventos
// que o board entende.
//
// O estado das sessoes vive no `Map` deste modulo. E o equivalente servidor do
// `SseHub`: guarda o que precisa sobreviver entre requisicoes — o
// `AbortController` do turno em andamento e as permissoes ainda sem resposta.
//
// A traducao de mensagem do SDK para evento do stream (`translateMessage`) e o
// contrato com o cliente. Tipo novo de evento entra no `ChatEvent` daqui, em
// `applyEvent` (`chat-client.js`) e na tabela de eventos do ARCHITECTURE.md —
// os tres ou nenhum.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { readConfig } from './config.js';

/** @typedef {import('@anthropic-ai/claude-agent-sdk').SDKMessage} SDKMessage */
/** @typedef {import('@anthropic-ai/claude-agent-sdk').CanUseTool} CanUseTool */
/** @typedef {import('./config.js').ChatConfig} ChatConfig */

/**
 * Um evento do stream de conversa. Sai um JSON destes por linha `data:`.
 *
 * @typedef {{ type: 'session', sessionId: string }
 *  | { type: 'text', delta: string }
 *  | { type: 'thinking', delta: string }
 *  | { type: 'tool', id: string, name: string, input: Record<string, unknown> }
 *  | { type: 'tool-result', id: string, ok: boolean, summary: string }
 *  | { type: 'permission', requestId: string, toolName: string, input: Record<string, unknown>, diff: string }
 *  | { type: 'error', message: string }
 *  | { type: 'done', stopReason: string }} ChatEvent
 */

/**
 * @typedef {object} Session
 * @property {string} id
 * @property {AbortController | null} controller turno em andamento, se houver
 * @property {Map<string, (allow: boolean) => void>} pending permissoes esperando resposta
 */

/** Bloco de conteudo de uma mensagem do SDK, visto so pelo que usamos dele. */
/** @typedef {{ type: string, [key: string]: any }} Block */

/** Quanto do resultado de uma tool vai para o board. O resto e ruido no chat. */
const SUMMARY_MAX = 400;

// Quanto de um `content` novo entra no diff. Um Write de pagina inteira nao
// cabe num balao de conversa, e o usuario decide pela cabeca do arquivo.
const DIFF_MAX_LINES = 40;

// Campos de entrada de tool que carregam caminho de arquivo. Sao os que
// precisam ser conferidos contra a raiz observada.
const PATH_FIELDS = ['file_path', 'path', 'notebook_path'];

/** @type {Map<string, Session>} */
const sessions = new Map();

/**
 * @param {string} id
 * @returns {Session}
 */
function getSession(id) {
  let session = sessions.get(id);
  if (!session) {
    session = { id, controller: null, pending: new Map() };
    sessions.set(id, session);
  }
  return session;
}

/**
 * @param {unknown} content
 * @returns {Block[]}
 */
function blocksOf(content) {
  return Array.isArray(content) ? /** @type {Block[]} */ (content) : [];
}

/**
 * Texto legivel de um `content` de tool_result, que vem como string ou como
 * lista de blocos.
 *
 * @param {unknown} content
 * @returns {string}
 */
function textOf(content) {
  if (typeof content === 'string') return content;
  const parts = blocksOf(content)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => String(block.text));
  return parts.join('\n');
}

/**
 * @param {string} text
 * @returns {string}
 */
function truncate(text) {
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text;
}

/**
 * Diff legivel de uma tool de escrita, para o usuario decidir a permissao
 * olhando a mudanca e nao o JSON cru. Tool que nao escreve devolve string
 * vazia, e o cliente mostra so o nome e a entrada.
 *
 * Funcao pura.
 *
 * @param {string} toolName nome da tool (`Write`, `Edit`, ...)
 * @param {Record<string, unknown>} input entrada da tool, como o SDK a entregou
 * @returns {string} diff em texto, ou string vazia
 */
export function buildDiff(toolName, input) {
  const file = typeof input.file_path === 'string' ? input.file_path : '';

  if (toolName === 'Write' && typeof input.content === 'string') {
    const lines = input.content.split('\n');
    const shown = lines.slice(0, DIFF_MAX_LINES).map((line) => `+${line}`);
    if (lines.length > DIFF_MAX_LINES) shown.push(`+… (${lines.length - DIFF_MAX_LINES} linhas)`);
    return [`--- ${file}`, ...shown].join('\n');
  }

  if (toolName === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    const removed = input.old_string.split('\n').map((line) => `-${line}`);
    const added = input.new_string.split('\n').map((line) => `+${line}`);
    return [`--- ${file}`, ...removed, ...added].join('\n');
  }

  return '';
}

/**
 * Caminho da entrada de uma tool que cai fora da raiz observada, ou string
 * vazia se tudo estiver dentro dela.
 *
 * O `cwd` do SDK diz onde o agente comeca, nao onde ele pode escrever: o modelo
 * monta caminho absoluto sozinho e ja se viu errar a pasta. Este e o cadeado —
 * ele vale inclusive com o `autoApprove` ligado.
 *
 * Funcao pura.
 *
 * @param {string} rootDir raiz observada (caminho absoluto)
 * @param {Record<string, unknown>} input entrada da tool
 * @returns {string} o caminho ofensor, ou string vazia
 */
export function escapingPath(rootDir, input) {
  const prefix = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;

  for (const field of PATH_FIELDS) {
    const value = input[field];
    if (typeof value !== 'string' || value === '') continue;
    const absolute = path.resolve(rootDir, value);
    if (absolute !== rootDir && !absolute.startsWith(prefix)) return absolute;
  }
  return '';
}

/**
 * @param {Block} event evento de streaming da Messages API
 * @returns {ChatEvent[]}
 */
function translateStreamEvent(event) {
  if (event.type !== 'content_block_delta') return [];
  const delta = event.delta;
  if (!delta || typeof delta !== 'object') return [];
  if (delta.type === 'text_delta' && typeof delta.text === 'string') {
    return [{ type: 'text', delta: delta.text }];
  }
  if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
    return [{ type: 'thinking', delta: delta.thinking }];
  }
  return [];
}

/**
 * Traduz uma mensagem do SDK nos eventos do stream de conversa. Mensagem que
 * nao interessa ao board devolve lista vazia.
 *
 * O texto e o raciocinio saem dos eventos parciais (`stream_event`), por isso a
 * mensagem `assistant` completa contribui so com os `tool_use` — sem isso cada
 * resposta apareceria duas vezes.
 *
 * Funcao pura.
 *
 * @param {SDKMessage} message
 * @returns {ChatEvent[]}
 */
export function translateMessage(message) {
  if (message.type === 'stream_event') {
    return translateStreamEvent(/** @type {Block} */ (/** @type {unknown} */ (message.event)));
  }

  if (message.type === 'assistant') {
    return blocksOf(message.message.content)
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        type: 'tool',
        id: String(block.id),
        name: String(block.name),
        input: /** @type {Record<string, unknown>} */ (block.input ?? {}),
      }));
  }

  if (message.type === 'user') {
    return blocksOf(message.message.content)
      .filter((block) => block.type === 'tool_result')
      .map((block) => ({
        type: 'tool-result',
        id: String(block.tool_use_id),
        ok: block.is_error !== true,
        summary: truncate(textOf(block.content)),
      }));
  }

  if (message.type === 'result') {
    /** @type {ChatEvent[]} */
    const events = [];
    if (message.subtype !== 'success') {
      events.push({ type: 'error', message: message.errors.join('\n') || 'A conversa terminou com erro.' });
    }
    events.push({ type: 'done', stopReason: message.stop_reason ?? message.subtype });
    return events;
  }

  return [];
}

/**
 * O `canUseTool` da sessao. Com `autoApprove` ligado aprova na hora; senao
 * publica um evento `permission` e devolve uma Promise que so resolve quando
 * `resolvePermission` chegar.
 *
 * O abort do turno resolve a Promise como recusa: uma permissao que ninguem
 * responde nao pode segurar o processo do SDK para sempre.
 *
 * @param {{ session: Session, config: ChatConfig, rootDir: string,
 *          emit: (event: ChatEvent) => void }} params
 * @returns {CanUseTool}
 */
function permissionGate({ session, config, rootDir, emit }) {
  return async (toolName, input, { signal }) => {
    // Antes de qualquer aprovacao: a raiz observada e o limite do agente.
    const outside = escapingPath(rootDir, input);
    if (outside) {
      return { behavior: 'deny', message: `Fora da pasta observada da pinacoteca: ${outside}` };
    }

    if (config.autoApprove) return { behavior: 'allow', updatedInput: input };

    const requestId = randomUUID();
    emit({ type: 'permission', requestId, toolName, input, diff: buildDiff(toolName, input) });

    const allowed = await new Promise((resolve) => {
      if (signal.aborted) {
        resolve(false);
        return;
      }
      session.pending.set(requestId, resolve);
      signal.addEventListener('abort', () => {
        session.pending.delete(requestId);
        resolve(false);
      }, { once: true });
    });

    return allowed
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'O usuario recusou esta acao.' };
  };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Responde uma permissao pendente.
 *
 * @param {string} sessionId
 * @param {string} requestId
 * @param {boolean} allow
 * @returns {boolean} false se ninguem estava esperando por esse pedido
 */
export function resolvePermission(sessionId, requestId, allow) {
  const session = sessions.get(sessionId);
  const resolve = session?.pending.get(requestId);
  if (!session || !resolve) return false;
  session.pending.delete(requestId);
  resolve(allow);
  return true;
}

/**
 * Aborta o turno em andamento da sessao.
 *
 * @param {string} sessionId
 * @returns {boolean} false se nao havia turno rodando
 */
export function interrupt(sessionId) {
  const controller = sessions.get(sessionId)?.controller;
  if (!controller) return false;
  controller.abort();
  return true;
}

// Credenciais de ambiente que o Claude Code aceita alem da chave. Quando o
// usuario configurou uma chave na pinacoteca, elas saem do ambiente do SDK:
// senao, numa maquina ja logada no Claude Code, o agente autenticaria por
// aquela credencial e a chave escolhida aqui nunca seria usada — inclusive
// quando ela esta errada, o que esconderia o erro do usuario.
const AMBIENT_CREDENTIAL_VARS = ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_PROFILE'];

/**
 * Onde o `claude login` grava a sessao no Linux — `~/.claude/.credentials.json`,
 * ou `$CLAUDE_CONFIG_DIR/.credentials.json` quando essa variavel existe. Mesma
 * resolucao que o proprio SDK usa por baixo. No macOS o login nunca cria esse
 * arquivo: a sessao vai para o Keychain (veja `hasKeychainCredential`).
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
function credentialsFilePath(env) {
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(configDir, '.credentials.json');
}

// Servico sob o qual o `claude login` grava a sessao no Keychain do macOS —
// mesmo nome usado pelo proprio CLI.
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

/**
 * Conta do Keychain que guarda a sessao: o CLI usa o usuario do sistema
 * operacional, com `$USER` como atalho quando ele esta definido.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
function keychainAccount(env) {
  return env.USER || os.userInfo().username;
}

/**
 * Ha sessao do `claude login` gravada no Keychain do macOS? E la que essa
 * plataforma guarda a sessao — o CLI nunca cria `.credentials.json` nela.
 * Roda `security find-generic-password` (mesmo comando que o CLI usa para
 * ler a propria sessao) e considera credencial presente quando ele sai com
 * sucesso e devolve algo. Qualquer falha — sem entrada, Keychain bloqueado,
 * `security` ausente — vira `false`, nunca lanca: mesma semantica de
 * "arquivo nao existe" que o `fileExists` de `hasAmbientCredential` ja tem.
 *
 * `execFileSyncFn` e injetavel para o teste de unidade nao depender de
 * Keychain real nem da plataforma de quem roda o teste.
 *
 * @param {Record<string, string | undefined>} env
 * @param {(file: string, args: string[], options: import('node:child_process').ExecFileSyncOptionsWithStringEncoding) => string} [execFileSyncFn]
 * @returns {boolean}
 */
export function hasKeychainCredential(env, execFileSyncFn = execFileSync) {
  try {
    const stdout = execFileSyncFn(
      'security',
      ['find-generic-password', '-a', keychainAccount(env), '-w', '-s', KEYCHAIN_SERVICE],
      { encoding: 'utf-8', timeout: 10_000, windowsHide: true },
    );
    return typeof stdout === 'string' && stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Ha sessao do Claude Code no ambiente? E o que autentica de graca numa
 * maquina ja logada num plano Pro/Max (`claude login`), sem gastar credito de
 * API nenhum — so entra crédito quando a pinacoteca usa uma chave propria.
 *
 * O login por si so nao passa por variavel de ambiente nenhuma: ele grava a
 * sessao em disco, e e de la que o SDK autentica quando nao ha
 * `ANTHROPIC_API_KEY` no ambiente. Onde exatamente depende da plataforma —
 * `.credentials.json` (veja `credentialsFilePath`) em toda parte menos no
 * macOS, que usa o Keychain (veja `hasKeychainCredential`). As variaveis em
 * `AMBIENT_CREDENTIAL_VARS` cobrem so o caso de alguem exportar a credencial
 * manualmente — a maioria das maquinas logadas nao tem nenhuma delas.
 *
 * `fileExists`, `platform` e `hasKeychain` sao injetaveis para o teste de
 * unidade nao depender do disco, do Keychain nem da plataforma reais.
 *
 * @param {Record<string, string | undefined>} env
 * @param {(path: string) => boolean} [fileExists]
 * @param {string} [platform]
 * @param {(env: Record<string, string | undefined>) => boolean} [hasKeychain]
 * @returns {boolean}
 */
export function hasAmbientCredential(
  env,
  fileExists = existsSync,
  platform = os.platform(),
  hasKeychain = hasKeychainCredential,
) {
  const hasEnvCredential = ['ANTHROPIC_API_KEY', ...AMBIENT_CREDENTIAL_VARS]
    .some((name) => typeof env[name] === 'string' && env[name] !== '');
  if (hasEnvCredential) return true;
  return platform === 'darwin' ? hasKeychain(env) : fileExists(credentialsFilePath(env));
}

/**
 * Ha credencial para conversar? A chave gravada na pinacoteca vem primeiro;
 * sem ela vale a sessao de ambiente (veja `hasAmbientCredential`).
 *
 * @param {string} apiKey chave gravada na configuracao; vazia quando nao ha
 * @param {Record<string, string | undefined>} env
 * @param {(path: string) => boolean} [fileExists] injetavel, ver `hasAmbientCredential`
 * @param {string} [platform] injetavel, ver `hasAmbientCredential`
 * @param {(env: Record<string, string | undefined>) => boolean} [hasKeychain] injetavel, ver `hasAmbientCredential`
 * @returns {boolean}
 */
export function hasCredential(apiKey, env, fileExists = existsSync, platform = os.platform(), hasKeychain = hasKeychainCredential) {
  return apiKey.length > 0 || hasAmbientCredential(env, fileExists, platform, hasKeychain);
}

/**
 * Ambiente do processo do SDK. Sem chave configurada o ambiente passa inteiro,
 * de proposito: e o mesmo caso do `hasCredential` — numa maquina ja autenticada
 * no Claude Code a conversa funciona sem o usuario colar chave nenhuma, e
 * apagar as credenciais de ambiente ali tiraria a unica que existe.
 *
 * @param {string} apiKey chave gravada na configuracao; vazia quando nao ha
 * @returns {Record<string, string | undefined>}
 */
export function agentEnv(apiKey) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env };
  if (!apiKey) return env;

  env.ANTHROPIC_API_KEY = apiKey;
  for (const name of AMBIENT_CREDENTIAL_VARS) delete env[name];
  return env;
}

/**
 * Monta as opcoes do `query()`. A chave da API entra pelo ambiente do processo
 * do SDK e nunca e registrada em log nem devolvida ao navegador.
 *
 * @param {{ rootDir: string, config: ChatConfig, isNew: boolean, sessionId: string,
 *          controller: AbortController, canUseTool: CanUseTool }} params
 * @returns {import('@anthropic-ai/claude-agent-sdk').Options}
 */
function buildOptions({ rootDir, config, isNew, sessionId, controller, canUseTool }) {
  return {
    // O agente so enxerga a pasta observada.
    cwd: rootDir,
    model: config.model,
    effort: /** @type {import('@anthropic-ai/claude-agent-sdk').EffortLevel} */ (config.effort),
    env: agentEnv(config.apiKey),
    abortController: controller,
    canUseTool,
    // Toda tool passa pelo `canUseTool`; a decisao de aprovar sozinho e nossa,
    // nao do modo de permissao do SDK.
    permissionMode: 'default',
    // Sem isso o texto so chegaria em blocos fechados, e o board mostraria a
    // resposta de uma vez em vez de digitando.
    includePartialMessages: true,
    ...(isNew ? { sessionId } : { resume: sessionId }),
  };
}

/**
 * Roda um turno da conversa, publicando cada evento em `onEvent`.
 *
 * Resolve quando o turno acaba — por resposta, erro ou interrupcao. Sempre sai
 * exatamente um evento `done`, para o cliente poder fechar o balao sem contar
 * casos.
 *
 * @param {{ rootDir: string, sessionId: string | null, text: string,
 *          onEvent: (event: ChatEvent) => void }} params
 * @returns {Promise<void>}
 */
export async function runTurn({ rootDir, sessionId, text, onEvent }) {
  let done = false;
  /** @param {ChatEvent} event */
  const emit = (event) => {
    if (done) return;
    if (event.type === 'done') done = true;
    onEvent(event);
  };

  const config = await readConfig();
  const isNew = typeof sessionId !== 'string' || sessionId.length === 0;
  const id = isNew ? randomUUID() : sessionId;
  emit({ type: 'session', sessionId: id });

  // Sem credencial nenhuma o SDK sobe so para morrer com um erro de
  // autenticacao; a mensagem daqui diz ao usuario o que fazer.
  if (!hasCredential(config.apiKey, process.env)) {
    emit({ type: 'error', message: 'Nenhuma chave da Anthropic configurada.' });
    emit({ type: 'done', stopReason: 'error' });
    return;
  }

  const session = getSession(id);
  const controller = new AbortController();
  session.controller = controller;

  try {
    const stream = query({
      prompt: text,
      options: buildOptions({
        rootDir, config, isNew, sessionId: id, controller,
        canUseTool: permissionGate({ session, config, rootDir, emit }),
      }),
    });
    for await (const message of stream) {
      for (const event of translateMessage(message)) emit(event);
    }
  } catch (error) {
    if (!controller.signal.aborted) emit({ type: 'error', message: describeError(error) });
  } finally {
    session.controller = null;
    // Permissao que ficou pendurada morre com o turno.
    for (const resolve of session.pending.values()) resolve(false);
    session.pending.clear();
    emit({ type: 'done', stopReason: controller.signal.aborted ? 'interrupted' : 'end_turn' });
  }
}
