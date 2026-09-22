// @ts-check
// A subaba `Conversas`: a lista das conversas gravadas daquela pasta, o botao
// de comecar uma nova e o de apagar.
//
// Mora fora do `chat.js` porque e outro painel: aquele desenha *a* conversa —
// bolhas, blocos, compositor —, este desenha as *outras*, e o gesto dele e
// trocar qual esta aberta. Sem rede, como o `chat.js`: quem busca e apaga no
// servidor e o `chat-client.js`, por `chat.transport`.
//
// A lista em si vive em `chat.conversations` (`state.js`), e quem esta aberta
// se sabe pelo `chat.sessionId` — nao ha copia local de nenhum dos dois.

import {
  chatConversationsEmpty, chatConversationsList, chatConversationsNote, chatNew,
} from './dom.js';
import { chat } from './state.js';

// O que se diz quando um turno esta rodando. Trocar de conversa no meio de um
// turno jogaria fora uma resposta ja paga, entao a lista fica olhavel e
// intocavel ate o turno acabar — pelo Parar ou pela resposta.
const RUNNING_NOTE = 'O agente esta respondendo. Pare o turno para trocar de conversa.';

/**
 * Quando a conversa foi usada pela ultima vez, em texto curto.
 * @param {number} updatedAt milissegundos
 * @returns {string}
 */
function whenLabel(updatedAt) {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return '';

  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString();
}

/**
 * Uma linha da lista: o titulo, quando foi, e o botao de apagar.
 *
 * @param {import('./state.js').ConversationSummary} entry
 * @returns {HTMLElement}
 */
function buildRow(entry) {
  const row = document.createElement('div');
  row.className = 'chat-conversation';
  row.dataset.id = entry.id;
  if (entry.id === chat.sessionId) row.classList.add('is-open');

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'chat-conversation-open';
  open.dataset.action = 'open';
  open.disabled = chat.running;

  const title = document.createElement('span');
  title.className = 'chat-conversation-title';
  // Sempre por `textContent`: o titulo e a primeira mensagem do usuario.
  title.textContent = entry.title || 'Conversa sem titulo';
  open.append(title);

  const when = document.createElement('span');
  when.className = 'chat-conversation-when';
  when.textContent = whenLabel(entry.updatedAt);
  open.append(when);
  row.append(open);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'chat-conversation-delete';
  remove.dataset.action = 'delete';
  remove.title = 'Apagar esta conversa';
  remove.textContent = '×';
  remove.disabled = chat.running;
  row.append(remove);

  return row;
}

/** Redesenha a lista inteira a partir de `chat.conversations`. */
export function renderConversations() {
  chatConversationsList.replaceChildren(...chat.conversations.map(buildRow));

  chatConversationsEmpty.hidden = chat.conversations.length > 0;
  chatNew.disabled = chat.running;
  chatConversationsNote.hidden = !chat.running;
  chatConversationsNote.textContent = chat.running ? RUNNING_NOTE : '';
}

/**
 * Apagar e definitivo e nao tem desfazer: o transcript sai do disco.
 *
 * @param {HTMLElement} row
 * @param {string} id
 */
function askToDelete(row, id) {
  const title = row.querySelector('.chat-conversation-title')?.textContent ?? '';
  if (!globalThis.confirm(`Apagar a conversa "${title}"? Isso nao tem desfazer.`)) return;
  chat.transport?.deleteConversation?.(id);
}

/**
 * Liga os gestos da lista. Chamado por `board.js` na carga.
 */
export function initConversations() {
  chatNew.addEventListener('click', () => {
    if (chat.running) return;
    chat.transport?.newConversation?.();
  });

  chatConversationsList.addEventListener('click', (event) => {
    if (chat.running) return;

    const target = /** @type {Element | null} */ (event.target);
    const button = target?.closest('[data-action]');
    const row = target?.closest('.chat-conversation');
    if (!button || !(row instanceof HTMLElement)) return;

    const id = row.dataset.id ?? '';
    if (!id) return;

    if (button.getAttribute('data-action') === 'open') chat.transport?.openConversation?.(id);
    else askToDelete(row, id);
  });
}
