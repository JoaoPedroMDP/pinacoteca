// @ts-check
// Dono do `~/.config/pinacoteca/config.json`: a chave da API, o modelo, o
// esforco e as preferencias da conversa.
//
// O arquivo guarda uma chave de API em disco, entao o diretorio nasce `700` e o
// arquivo `600`. A leitura e tolerante a falha pelo mesmo motivo que o
// `storage.js` do cliente e: arquivo ausente, JSON estragado ou permissao
// negada devolvem os padroes, nunca derrubam o servidor.
//
// A validacao e a mescla vivem em `mergeConfig`, que e pura e nao toca no
// disco — e a unica parte testavel sem IO, e e onde um `model` desconhecido
// vira o padrao em vez de virar um 400 da API la na frente.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * @typedef {object} ChatConfig
 * @property {string} apiKey chave da Anthropic; string vazia significa "sem chave"
 * @property {string} model um de `MODELS`
 * @property {string} effort um de `EFFORTS`
 * @property {boolean} autoApprove aprova as edicoes sem perguntar
 * @property {boolean} sendOnEnter Enter envia a mensagem (Shift+Enter quebra linha)
 */

/**
 * Projecao segura da configuracao para o navegador: a chave nunca sai daqui,
 * so o fato de existir uma.
 *
 * @typedef {object} PublicChatConfig
 * @property {boolean} hasKey
 * @property {string} model
 * @property {string} effort
 * @property {boolean} autoApprove
 * @property {boolean} sendOnEnter
 */

/** Modelos oferecidos na conversa. @type {readonly string[]} */
export const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];

/** Niveis de esforco aceitos pelo Agent SDK. @type {readonly string[]} */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** @type {ChatConfig} */
export const DEFAULT_CONFIG = {
  apiKey: '',
  model: 'claude-opus-5',
  effort: 'high',
  autoApprove: false,
  sendOnEnter: true,
};

// Permissoes de quem guarda segredo: so o dono le e escreve.
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Pasta de configuracao do usuario, na convencao de cada sistema.
 * @returns {string}
 */
export function configDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, 'pinacoteca');
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'pinacoteca');
  }
  return path.join(os.homedir(), '.config', 'pinacoteca');
}

/**
 * Caminho do arquivo de configuracao.
 * @returns {string}
 */
export function configPath() {
  return path.join(configDir(), 'config.json');
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
 * Primeiro valor que for um dos aceitos; senao o padrao.
 * @param {readonly string[]} allowed
 * @param {unknown[]} candidates
 * @param {string} fallback
 * @returns {string}
 */
function firstAllowed(allowed, candidates, fallback) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && allowed.includes(candidate)) return candidate;
  }
  return fallback;
}

/**
 * Primeiro booleano de verdade; senao o padrao.
 * @param {unknown[]} candidates
 * @param {boolean} fallback
 * @returns {boolean}
 */
function firstBoolean(candidates, fallback) {
  for (const candidate of candidates) {
    if (typeof candidate === 'boolean') return candidate;
  }
  return fallback;
}

/**
 * Mescla `patch` sobre `current` e devolve uma configuracao sempre valida.
 * Funcao pura: nao le nem escreve disco.
 *
 * Campo ausente no patch mantem o valor atual. Valor de tipo errado ou fora das
 * listas (`MODELS`, `EFFORTS`) nunca e propagado: cai no valor atual, se ele for
 * valido, e so entao no padrao — um patch estragado nao apaga uma escolha boa
 * que ja estava gravada. A chave e
 * gravada sem espacos em volta, e uma string vazia no patch a apaga — e o unico
 * jeito de o usuario tirar a chave do disco pela interface.
 *
 * @param {unknown} current configuracao atual (pode ser lixo vindo do disco)
 * @param {unknown} [patch] campos a alterar
 * @returns {ChatConfig}
 */
export function mergeConfig(current, patch) {
  const base = asObject(current);
  const next = asObject(patch);

  const currentKey = typeof base.apiKey === 'string' ? base.apiKey.trim() : DEFAULT_CONFIG.apiKey;
  const apiKey = typeof next.apiKey === 'string' ? next.apiKey.trim() : currentKey;

  return {
    apiKey,
    model: firstAllowed(MODELS, [next.model, base.model], DEFAULT_CONFIG.model),
    effort: firstAllowed(EFFORTS, [next.effort, base.effort], DEFAULT_CONFIG.effort),
    autoApprove: firstBoolean([next.autoApprove, base.autoApprove], DEFAULT_CONFIG.autoApprove),
    sendOnEnter: firstBoolean([next.sendOnEnter, base.sendOnEnter], DEFAULT_CONFIG.sendOnEnter),
  };
}

/**
 * A configuracao como o navegador pode ve-la: a chave vira um booleano.
 * @param {ChatConfig} config
 * @returns {PublicChatConfig}
 */
export function publicConfig(config) {
  return {
    hasKey: config.apiKey.length > 0,
    model: config.model,
    effort: config.effort,
    autoApprove: config.autoApprove,
    sendOnEnter: config.sendOnEnter,
  };
}

/**
 * Le a configuracao do disco. Qualquer falha devolve os padroes.
 * @returns {Promise<ChatConfig>}
 */
export async function readConfig() {
  try {
    const raw = await fs.readFile(configPath(), 'utf8');
    return mergeConfig(JSON.parse(raw), undefined);
  } catch {
    return mergeConfig(undefined, undefined);
  }
}

/**
 * Aplica `patch` sobre o que esta no disco e regrava o arquivo inteiro.
 * Devolve a configuracao resultante mesmo se a gravacao falhar — o servidor
 * segue funcionando na sessao, so nao lembra na proxima.
 *
 * @param {unknown} patch
 * @returns {Promise<ChatConfig>}
 */
export async function writeConfig(patch) {
  const merged = mergeConfig(await readConfig(), patch);
  try {
    await fs.mkdir(configDir(), { recursive: true, mode: DIR_MODE });
    await fs.writeFile(configPath(), `${JSON.stringify(merged, null, 2)}\n`, { mode: FILE_MODE });
    // `writeFile` so aplica o modo ao criar: um arquivo que ja existia com
    // permissao frouxa continuaria frouxo.
    await fs.chmod(configPath(), FILE_MODE);
  } catch {
    // Disco cheio, home somente leitura: a conversa ainda funciona nesta sessao.
  }
  return merged;
}
