// @ts-check
// Dono do `~/.config/pinacoteca/history/`: o transcript de cada conversa, por
// raiz observada.
//
// O board nao tem modelo de mensagens — `chat.js` monta no por no — entao quem
// sabe o que aconteceu numa conversa e este arquivo. Ele grava os mesmos
// eventos que ja vao para o navegador e mais dois que so existem em disco:
// `user` (a mensagem que o usuario mandou, que ao vivo o proprio cliente
// desenha) e `permission-result` (o que ele respondeu a uma permissao ou a uma
// pergunta, que ao vivo e o clique que pinta). Sem esses dois, um reload
// perderia a pergunta e mostraria como pendente o que ja foi aprovado.
//
// Fica fora da pasta observada de proposito. O `cwd` do agente e a raiz: um
// transcript la dentro seria um metadado que o usuario nao pediu, que ele teria
// de lembrar de nao commitar, e que o proprio agente poderia ler e reescrever.
//
// O arquivo guarda o que o usuario disse e trechos dos arquivos dele, entao o
// diretorio nasce `700` e os arquivos `600`, como o `config.json`.
//
// Toda leitura e tolerante a falha, pelo mesmo motivo do `config.js`: transcript
// truncado, linha estragada ou indice ilegivel degradam a conversa, nunca
// derrubam o servidor.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { configDir } from './config.js';

/** @typedef {import('./agent.js').ChatEvent} ChatEvent */

/**
 * Um evento gravado: os do stream, mais os dois que so existem aqui.
 *
 * @typedef {ChatEvent
 *  | { type: 'user', text: string }
 *  | { type: 'permission-result', requestId: string, allow: boolean, answers: Record<string, unknown> }
 *  | { type: 'truncated', dropped: number }} RecordedEvent
 */

/**
 * Uma conversa como a lista da subaba `Conversas` a mostra.
 *
 * @typedef {{ id: string, title: string, updatedAt: number, messageCount: number }} ConversationSummary
 */

// Permissoes de quem guarda o que foi dito: so o dono le e escreve.
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

// Quanto de uma entrada de tool vai para o disco. Mesma regua do balao no
// board (`CHAT_TOOL_INPUT_CHARS`): o bloco e um resumo, e guardar o argumento
// inteiro de um Write encheria o arquivo com a copia de um arquivo que ja esta
// na pasta.
const INPUT_CHARS = 140;

// Quanto de um diff vai para o disco, em linhas. O board ja corta o diff em
// `DIFF_MAX_LINES` antes de manda-lo; este teto e a garantia deste lado.
const DIFF_LINES = 40;

// Teto do arquivo de uma conversa. Ao estourar, os eventos mais antigos saem e
// uma marca de corte fica no lugar deles.
const FILE_MAX_BYTES = 2 * 1024 * 1024;

// Quantos caracteres da primeira mensagem viram o titulo da conversa na lista.
const TITLE_CHARS = 80;

// Tamanho do sufixo que separa duas pastas de mesmo nome em lugares diferentes.
const SLUG_HASH_CHARS = 8;

/**
 * Nome da pasta de historico de uma raiz observada: o nome dela, para achar na
 * mao, mais um hash curto do caminho absoluto, para duas pastas de mesmo nome
 * em lugares diferentes nao caírem uma em cima da outra.
 *
 * Funcao pura: nao le nem escreve disco.
 *
 * @param {string} rootDir caminho absoluto da raiz observada
 * @returns {string}
 */
export function historySlug(rootDir) {
  const hash = crypto.createHash('sha256').update(rootDir).digest('hex').slice(0, SLUG_HASH_CHARS);
  // O basename vem do disco: qualquer coisa fora de letra, numero, `-` e `_`
  // vira `-` para nao montar caminho com separador nem com nome reservado.
  const name = path.basename(rootDir).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return name ? `${name}-${hash}` : hash;
}

/**
 * Corta um texto longo, marcando o corte.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * A entrada de uma tool como ela vai para o disco: cada campo de texto cortado
 * na mesma regua que o board usa para mostra-lo.
 *
 * @param {unknown} input
 * @returns {Record<string, unknown>}
 */
function clipInput(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {};

  /** @type {Record<string, unknown>} */
  const clipped = {};
  for (const [key, value] of Object.entries(input)) {
    clipped[key] = typeof value === 'string' ? clip(value, INPUT_CHARS) : value;
  }
  return clipped;
}

/**
 * @param {string} diff
 * @returns {string}
 */
function clipDiff(diff) {
  const lines = diff.split('\n');
  if (lines.length <= DIFF_LINES) return diff;
  return `${lines.slice(0, DIFF_LINES).join('\n')}\n…`;
}

/**
 * O evento como ele vai para o disco. O que nao cabe num transcript — a sessao,
 * que ja e o nome do arquivo — devolve `null` e nao e gravado.
 *
 * @param {RecordedEvent} event
 * @returns {RecordedEvent | null}
 */
function forDisk(event) {
  if (event.type === 'session') return null;
  if (event.type === 'tool') return { ...event, input: clipInput(event.input) };
  if (event.type === 'permission') {
    return { ...event, input: clipInput(event.input), diff: clipDiff(event.diff) };
  }
  return event;
}

/**
 * Junta os deltas seguidos de `text` e `thinking` num evento so e apara o que
 * for grande demais para um transcript.
 *
 * Os deltas chegam caractere a caractere: gravar um por linha daria milhares de
 * linhas por turno e uma leitura cara em toda carga do board. Dois blocos do
 * mesmo tipo separados por outro evento continuam separados — a ordem em que as
 * coisas aconteceram e o que o log conta.
 *
 * Funcao pura: nao le nem escreve disco.
 *
 * @param {RecordedEvent[]} events
 * @returns {RecordedEvent[]}
 */
export function coalesce(events) {
  /** @type {RecordedEvent[]} */
  const out = [];

  for (const event of events) {
    const ready = forDisk(event);
    if (!ready) continue;

    const last = out[out.length - 1];
    if ((ready.type === 'text' || ready.type === 'thinking') && last && last.type === ready.type) {
      out[out.length - 1] = { type: ready.type, delta: last.delta + ready.delta };
      continue;
    }
    out.push(ready);
  }

  return out;
}

/**
 * Titulo de uma conversa: a primeira mensagem do usuario, em uma linha.
 * Funcao pura.
 *
 * @param {RecordedEvent[]} events
 * @returns {string} vazio quando ninguem falou ainda
 */
export function conversationTitle(events) {
  const first = events.find((event) => event.type === 'user');
  if (!first || first.type !== 'user') return '';
  return clip(first.text.replace(/\s+/g, ' ').trim(), TITLE_CHARS);
}

/**
 * Quantas mensagens o usuario mandou nesta conversa. Funcao pura.
 * @param {RecordedEvent[]} events
 * @returns {number}
 */
export function messageCount(events) {
  return events.filter((event) => event.type === 'user').length;
}

/* ---------- Caminhos ---------- */

/**
 * Pasta de historico da raiz observada.
 * @param {string} rootDir
 * @returns {string}
 */
export function historyDir(rootDir) {
  return path.join(configDir(), 'history', historySlug(rootDir));
}

/**
 * @param {string} rootDir
 * @param {string} id
 * @returns {string | null} null quando o id nao e nome de arquivo aceitavel
 */
function conversationPath(rootDir, id) {
  // O id vem do navegador. So o formato que este modulo cria passa: sem ponto,
  // sem barra, sem nada que saia da pasta de historico.
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return null;
  return path.join(historyDir(rootDir), `${id}.jsonl`);
}

/**
 * @param {string} rootDir
 * @returns {string}
 */
function indexPath(rootDir) {
  return path.join(historyDir(rootDir), 'index.json');
}

/* ---------- Leitura ---------- */

/**
 * @param {unknown} value
 * @returns {RecordedEvent | null}
 */
function asEvent(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const type = /** @type {Record<string, unknown>} */ (value).type;
  return typeof type === 'string' ? /** @type {RecordedEvent} */ (value) : null;
}

/**
 * Os eventos gravados de uma conversa, na ordem em que aconteceram. Linha
 * ilegivel — arquivo truncado por uma queda, escrita pela metade — e descartada
 * em silencio: mostrar o que da para mostrar vale mais do que recusar a
 * conversa inteira.
 *
 * @param {string} rootDir
 * @param {string} id
 * @returns {Promise<RecordedEvent[] | null>} null quando a conversa nao existe
 */
export async function readConversation(rootDir, id) {
  const file = conversationPath(rootDir, id);
  if (!file) return null;

  /** @type {string} */
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }

  /** @type {RecordedEvent[]} */
  const events = [];
  for (const line of raw.split('\n')) {
    if (line === '') continue;
    try {
      const event = asEvent(JSON.parse(line));
      if (event) events.push(event);
    } catch {
      // Linha estragada: segue para a proxima.
    }
  }
  return events;
}

/**
 * @param {string} rootDir
 * @returns {Promise<Record<string, { title: string, messageCount: number }>>}
 */
async function readIndexFile(rootDir) {
  try {
    const raw = await fs.readFile(indexPath(rootDir), 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.conversations) ? parsed.conversations : [];

    /** @type {Record<string, { title: string, messageCount: number }>} */
    const byId = {};
    for (const entry of list) {
      if (typeof entry?.id !== 'string') continue;
      byId[entry.id] = {
        title: typeof entry.title === 'string' ? entry.title : '',
        messageCount: Number.isFinite(entry.messageCount) ? entry.messageCount : 0,
      };
    }
    return byId;
  } catch {
    // Indice ausente ou estragado: e cache, e cache se refaz.
    return {};
  }
}

/**
 * A lista de conversas da raiz, da mais recente para a mais antiga.
 *
 * Os arquivos sao a verdade e o `index.json` e so o atalho para o titulo: a
 * varredura sempre parte deles, e o que o indice nao souber dizer e lido do
 * proprio transcript. Assim um indice ilegivel custa uma leitura a mais, nunca
 * uma conversa some da lista.
 *
 * @param {string} rootDir
 * @returns {Promise<ConversationSummary[]>}
 */
export async function readIndex(rootDir) {
  /** @type {string[]} */
  let names;
  try {
    names = await fs.readdir(historyDir(rootDir));
  } catch {
    return [];
  }

  const known = await readIndexFile(rootDir);

  /** @type {ConversationSummary[]} */
  const list = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const id = name.slice(0, -'.jsonl'.length);

    /** @type {number} */
    let updatedAt;
    try {
      updatedAt = (await fs.stat(path.join(historyDir(rootDir), name))).mtimeMs;
    } catch {
      continue;
    }

    let entry = known[id];
    if (!entry) {
      const events = (await readConversation(rootDir, id)) ?? [];
      entry = { title: conversationTitle(events), messageCount: messageCount(events) };
    }

    // Conversa sem nenhuma mensagem do usuario nunca aconteceu de verdade: e um
    // arquivo aberto por um turno que morreu antes de escrever. Fora da lista.
    if (entry.messageCount === 0) continue;

    list.push({ id, title: entry.title, updatedAt, messageCount: entry.messageCount });
  }

  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

/* ---------- Escrita ---------- */

/**
 * Regrava o `index.json` inteiro, atomicamente. Ele e reescrito a cada turno, e
 * uma queda no meio deixaria um arquivo pela metade — o `rename` troca o arquivo
 * de uma vez ou nao troca.
 *
 * So a conversa que acabou de mexer (`id`) e relida do disco; as outras vem do
 * proprio indice. Reler todas a cada turno faria o atalho custar o que ele
 * existe para evitar. Ids cujo arquivo sumiu caem fora.
 *
 * @param {string} rootDir
 * @param {string} [id] a conversa que mudou agora
 * @returns {Promise<void>}
 */
async function writeIndex(rootDir, id) {
  const known = await readIndexFile(rootDir);

  if (id) {
    const events = (await readConversation(rootDir, id)) ?? [];
    known[id] = { title: conversationTitle(events), messageCount: messageCount(events) };
  }

  /** @type {string[]} */
  let names = [];
  try {
    names = await fs.readdir(historyDir(rootDir));
  } catch {
    // Pasta sumiu embaixo do processo: o indice sai vazio, e esta certo.
  }
  const alive = new Set(
    names.filter((name) => name.endsWith('.jsonl')).map((name) => name.slice(0, -'.jsonl'.length)),
  );

  const conversations = Object.entries(known)
    .filter(([key]) => alive.has(key))
    .map(([key, entry]) => ({ id: key, ...entry }));

  const target = indexPath(rootDir);
  const temporary = `${target}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify({ conversations }, null, 2)}\n`, { mode: FILE_MODE });
    await fs.rename(temporary, target);
  } catch {
    // Sem indice, `readIndex` refaz tudo pelos arquivos. Nada a fazer aqui.
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

/**
 * Corta o comeco do arquivo quando ele passa do teto, deixando no lugar a marca
 * de quantos eventos sairam. Conversa longa nao pode crescer sem fim, e o que
 * interessa num transcript e o fim dele.
 *
 * @param {string} file
 * @returns {Promise<void>}
 */
async function trim(file) {
  /** @type {string} */
  let raw;
  try {
    const stat = await fs.stat(file);
    if (stat.size <= FILE_MAX_BYTES) return;
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return;
  }

  const lines = raw.split('\n').filter((line) => line !== '');
  // Corta pela metade em vez de tirar linha a linha: senao toda escrita
  // seguinte reescreveria o arquivo inteiro de novo.
  const keep = lines.slice(Math.ceil(lines.length / 2));
  const dropped = lines.length - keep.length;
  const marker = JSON.stringify({ type: 'truncated', dropped });

  try {
    await fs.writeFile(file, `${[marker, ...keep].join('\n')}\n`, { mode: FILE_MODE });
  } catch {
    // Arquivo segue grande; e o pior caso aceitavel.
  }
}

/**
 * Um gravador de conversa: recebe os eventos do turno na ordem em que
 * acontecem e escreve no `.jsonl` da conversa.
 *
 * O bloco de `text`/`thinking` fica aberto em memoria e so vira linha quando o
 * tipo de evento muda ou quando o turno fecha. Escrever delta a delta faria um
 * arquivo com milhares de linhas por turno.
 *
 * As escritas sao encadeadas numa promessa so: `record` e sincrono para quem
 * chama (o `onEvent` do stream nao pode esperar o disco), mas os `append`
 * chegam ao arquivo em ordem.
 *
 * @typedef {{ record: (event: RecordedEvent) => void, close: () => Promise<void> }} ConversationWriter
 */

/**
 * Abre o gravador da conversa `sessionId` daquela raiz, criando a pasta de
 * historico se ainda nao existir.
 *
 * @param {string} rootDir
 * @param {string} sessionId
 * @returns {ConversationWriter}
 */
export function openConversation(rootDir, sessionId) {
  const file = conversationPath(rootDir, sessionId);

  /** @type {RecordedEvent[]} */
  let buffer = [];
  /** @type {Promise<void>} */
  let chain = Promise.resolve();
  let touched = false;

  /** @param {() => Promise<void>} step */
  function queue(step) {
    chain = chain.then(step).catch(() => {});
  }

  function flush() {
    if (buffer.length === 0) return;
    const lines = coalesce(buffer).map((event) => JSON.stringify(event));
    buffer = [];
    if (lines.length === 0) return;

    queue(async () => {
      if (!file) return;
      await fs.mkdir(historyDir(rootDir), { recursive: true, mode: DIR_MODE });
      await fs.appendFile(file, `${lines.join('\n')}\n`, { mode: FILE_MODE });
      // `appendFile` so aplica o modo ao criar; um arquivo que ja existia com
      // permissao frouxa continuaria frouxo.
      await fs.chmod(file, FILE_MODE).catch(() => {});
      await trim(file);
    });
  }

  return {
    record(event) {
      if (!file) return;
      touched = true;
      buffer.push(event);
      // Delta fica esperando o proximo para se juntar a ele; qualquer outro
      // evento fecha o bloco e leva o proprio evento junto.
      if (event.type !== 'text' && event.type !== 'thinking') flush();
    },

    async close() {
      flush();
      await chain;
      if (touched) await writeIndex(rootDir, sessionId);
    },
  };
}

/**
 * Apaga uma conversa: o transcript e a entrada dela no indice.
 *
 * @param {string} rootDir
 * @param {string} id
 * @returns {Promise<boolean>} false quando nao havia o que apagar
 */
export async function deleteConversation(rootDir, id) {
  const file = conversationPath(rootDir, id);
  if (!file) return false;

  try {
    await fs.rm(file);
  } catch {
    return false;
  }
  await writeIndex(rootDir);
  return true;
}
