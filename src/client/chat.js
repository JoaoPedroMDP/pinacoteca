// @ts-check
// Painel de conversa da sidebar: o compositor, o historico do que ja foi
// enviado e as bolhas do log.
//
// Este modulo nao fala com o servidor: quem faz rede e `chat-client.js`, que se
// registra aqui por `setTransport` — enquanto ninguem registra nada, os gestos
// so desenham a mensagem do usuario no log e avisam que falta a chave.
//
// O estado da conversa mora em `state.js` (`chat`). As unicas excecoes locais
// sao estados de um gesto: a pilha de desfazer do compositor e o indice de
// navegacao do historico, que morrem com o gesto.

import {
  CHAT_DRAFT_DEBOUNCE_MS, CHAT_INPUT_MAX_HEIGHT, CHAT_SCROLL_SLACK,
  CHAT_TOOL_INPUT_CHARS, CHAT_UNDO_GROUP_MS, CHAT_UNDO_LIMIT,
} from './constants.js';
import {
  chatAuto, chatComposer, chatEffort, chatEmpty, chatInput,
  chatLog, chatModel, chatQueue, chatQueueList, chatSend, chatSendMode, chatStop,
} from './dom.js';
import {
  chat, commentQueue, notifyQueueChange, onQueueChange,
} from './state.js';
import { removeCommentItem } from './inspect.js';
import {
  loadChatDraft, loadChatHistory, loadChatPrefs, pushChatHistory, saveChatDraft,
  saveChatPrefs,
} from './storage.js';
import { normalizeQuestions, serializeCommentQueue, toolTarget } from './utils.js';
import { showToast } from './feedback.js';

/* ---------- Elementos ---------- */

const input = /** @type {HTMLTextAreaElement} */ (chatInput);
const modelSelect = /** @type {HTMLSelectElement} */ (chatModel);
const effortSelect = /** @type {HTMLSelectElement} */ (chatEffort);
const sendMode = chatSendMode;

/* ---------- Estado do gesto ---------- */

/** @typedef {{ value: string, selectionStart: number, selectionEnd: number }} Snapshot */

/** Estados anteriores do compositor, do mais antigo ao mais recente.
 * @type {Snapshot[]} */
const undoStack = [];

/** @type {Snapshot[]} */
const redoStack = [];

/** O que esta escrito agora, ja capturado. E o proximo item da pilha.
 * @type {Snapshot} */
let previous = { value: '', selectionStart: 0, selectionEnd: 0 };

/** Quando foi a ultima digitacao, para agrupar o desfazer por pausa. */
let lastEditAt = 0;

/** Onde a seta pra cima parou no historico. -1 = nao esta navegando. */
let historyIndex = -1;

/** O que estava escrito quando a navegacao comecou, devolvido na volta. */
let historyDraft = '';

/* ---------- Compositor ---------- */

/**
 * Cresce com o conteudo ate o teto; dali em diante rola por dentro.
 *
 * Exportada porque `scrollHeight` da 0 com o elemento escondido (`display:
 * none` na aba Telas) — a primeira chamada, em `initChat`, sempre mede isso.
 * `tabs.js` chama de novo quando a aba Conversa aparece, com a medida certa.
 */
export function autoGrow() {
  input.style.height = 'auto';
  const height = Math.min(input.scrollHeight, CHAT_INPUT_MAX_HEIGHT);
  input.style.height = `${height}px`;
  input.style.overflowY = input.scrollHeight > CHAT_INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
}

/** @returns {Snapshot} */
function snapshot() {
  return {
    value: input.value,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd,
  };
}

/** Esquece o desfazer e recomeca do que esta escrito agora. */
function resetUndo() {
  undoStack.length = 0;
  redoStack.length = 0;
  previous = snapshot();
  lastEditAt = 0;
}

/**
 * A edicao que acabou de acontecer comeca um grupo novo de desfazer? Digitacao
 * continua fica num grupo so; pausa, espaco e remocao grande quebram.
 * @param {number} now
 * @returns {boolean}
 */
function startsNewGroup(now) {
  if (undoStack.length === 0) return true;
  if (now - lastEditAt > CHAT_UNDO_GROUP_MS) return true;

  const added = input.value.length - previous.value.length;
  // Remocao: uma tecla de cada vez continua o grupo, um corte inteiro quebra.
  if (added <= 0) return added < -1;

  const inserted = input.value.slice(Math.max(0, input.selectionStart - added), input.selectionStart);
  return /\s/.test(inserted);
}

/**
 * Devolve o compositor a um estado da pilha, com a selecao junto — restaurar
 * so o texto deixaria o cursor no fim, longe de onde o usuario estava.
 * @param {Snapshot} state
 */
function applySnapshot(state) {
  input.value = state.value;
  input.setSelectionRange(state.selectionStart, state.selectionEnd);
  previous = state;
  lastEditAt = 0;
  autoGrow();
  scheduleDraftSave();
}

function undo() {
  const state = undoStack.pop();
  if (!state) return;
  redoStack.push(snapshot());
  applySnapshot(state);
}

function redo() {
  const state = redoStack.pop();
  if (!state) return;
  undoStack.push(snapshot());
  applySnapshot(state);
}

/**
 * Troca o texto do compositor sem passar pelo evento `input` (historico,
 * envio). Vale um passo de desfazer.
 * @param {string} text
 */
function commitValue(text) {
  undoStack.push(previous);
  redoStack.length = 0;
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  previous = snapshot();
  lastEditAt = 0;
  autoGrow();
  scheduleDraftSave();
}

function onInput() {
  const now = Date.now();

  if (startsNewGroup(now)) {
    undoStack.push(previous);
    while (undoStack.length > CHAT_UNDO_LIMIT) undoStack.shift();
  }
  redoStack.length = 0;
  previous = snapshot();
  lastEditAt = now;

  // Digitar sai da navegacao do historico: o que esta na tela virou texto novo.
  historyIndex = -1;

  autoGrow();
  scheduleDraftSave();
}

/* ---------- Rascunho ---------- */

function scheduleDraftSave() {
  if (chat.draftTimer) clearTimeout(chat.draftTimer);
  chat.draftTimer = setTimeout(() => {
    chat.draftTimer = null;
    saveChatDraft(input.value);
  }, CHAT_DRAFT_DEBOUNCE_MS);
}

/** @param {string} text */
function saveDraftNow(text) {
  if (chat.draftTimer) clearTimeout(chat.draftTimer);
  chat.draftTimer = null;
  saveChatDraft(text);
}

/* ---------- Log ---------- */

/** @returns {boolean} o usuario ainda esta olhando o fim do log? */
function isAtBottom() {
  return chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < CHAT_SCROLL_SLACK;
}

/**
 * Roda a mudanca segurando a rolagem: so acompanha o fim quem ja estava nele.
 * Quem rolou pra cima para ler nao tem a viewport arrastada.
 * @param {() => void} mutate
 */
function keepPinned(mutate) {
  const stick = isAtBottom();
  mutate();
  if (stick) chatLog.scrollTop = chatLog.scrollHeight;
}

/**
 * @param {string} className
 * @param {string} [text] sempre por `textContent`: o conteudo vem do modelo e
 *   dos arquivos do usuario, nunca de uma fonte confiavel
 * @returns {HTMLElement}
 */
function makeBlock(className, text = '') {
  const node = document.createElement('div');
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * Poe um bloco no fim do log.
 *
 * **Todo bloco novo fecha os blocos abertos do turno.** Sem isso a bolha do
 * assistente continuava aberta depois de um bloco de ferramenta, e o texto que
 * chegasse em seguida voltava a crescer *acima* do Edit/Bash que ja tinha
 * entrado — o log deixava de contar a historia na ordem em que ela aconteceu.
 * Fechar aqui, num lugar so, faz valer para bolha, raciocinio, ferramenta,
 * permissao, pergunta e erro sem cada um ter de lembrar. Quem abre um bloco
 * (`beginAssistantMessage`, `beginThinking`) registra o seu *depois* de chamar
 * esta funcao, entao o proprio bloco novo nao se fecha.
 *
 * @param {HTMLElement} node
 */
function appendBlock(node) {
  chat.streaming = null;
  chat.thinking = null;
  chat.lastTool = null;

  keepPinned(() => {
    chatEmpty.hidden = true;
    chatLog.append(node);
  });
}

/**
 * Entrada de uma tool em uma linha. Objeto vira JSON e o excesso e cortado —
 * o bloco e um resumo, nao o registro completo.
 * @param {unknown} value
 * @returns {string}
 */
function summarize(value) {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length > CHAT_TOOL_INPUT_CHARS ? `${text.slice(0, CHAT_TOOL_INPUT_CHARS)}…` : text;
}

/**
 * Diff em fonte monoespacada, uma linha por elemento para o CSS pintar
 * adicao e remocao.
 * @param {string} diff
 * @returns {HTMLElement}
 */
function renderDiff(diff) {
  const box = document.createElement('pre');
  box.className = 'chat-diff';

  for (const line of diff.split('\n')) {
    const row = document.createElement('span');
    row.className = 'chat-diff-line';
    if (line.startsWith('@@')) row.classList.add('is-meta');
    else if (line.startsWith('+')) row.classList.add('is-add');
    else if (line.startsWith('-')) row.classList.add('is-del');
    row.textContent = line;
    box.append(row);
  }
  return box;
}

/**
 * @param {string} label
 * @param {string} className
 * @returns {HTMLButtonElement}
 */
function makeButton(label, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

/* ---------- Mensagens ---------- */

/**
 * Bolha da mensagem que o usuario mandou.
 * @param {string} text
 * @returns {HTMLElement} a bolha montada
 */
function appendUserMessage(text) {
  const bubble = makeBlock('chat-msg is-user', text);
  appendBlock(bubble);
  chat.messages.push({ role: 'user', text, bubble });
  return bubble;
}

/**
 * Abre uma bolha de assistente vazia, que cresce com os deltas seguintes.
 * @returns {import('./state.js').ChatMessage}
 */
function beginAssistantMessage() {
  const bubble = makeBlock('chat-msg is-assistant');
  appendBlock(bubble);

  /** @type {import('./state.js').ChatMessage} */
  const message = { role: 'assistant', text: '', bubble };
  chat.messages.push(message);
  chat.streaming = message;
  return message;
}

/**
 * Acrescenta texto a resposta em andamento, abrindo a bolha se ainda nao houver.
 * @param {string} delta
 */
export function appendAssistantDelta(delta) {
  const message = chat.streaming ?? beginAssistantMessage();
  keepPinned(() => {
    message.text += delta;
    message.bubble.textContent = message.text;
  });
}

/** @returns {HTMLElement} o corpo do bloco de raciocinio deste turno */
function beginThinking() {
  const box = document.createElement('details');
  box.className = 'chat-thinking';

  const title = document.createElement('summary');
  title.textContent = 'Raciocinio';

  const body = document.createElement('pre');
  body.className = 'chat-thinking-body';

  box.append(title, body);
  appendBlock(box);
  chat.thinking = body;
  return body;
}

/**
 * Acrescenta texto ao bloco de raciocinio, que nasce colapsado.
 * @param {string} delta
 */
export function appendThinkingDelta(delta) {
  const body = chat.thinking ?? beginThinking();
  keepPinned(() => {
    body.textContent = `${body.textContent ?? ''}${delta}`;
  });
}

/**
 * Aglomera uma acao repetida no bloco que ja esta no fim do log, em vez de
 * empilhar uma linha igual embaixo da outra.
 *
 * So aglomera o que e *a mesma tool no mesmo arquivo* e *logo em seguida*: o
 * `chat.lastTool` vale enquanto aquele bloco for o ultimo do log, e qualquer
 * outro bloco o zera (`appendBlock`). Tres `Edit` seguidos em `login.html`
 * viram uma linha com `×3`; um `Edit` em outro arquivo, ou um texto do
 * assistente no meio, abre linha nova — a historia continua na ordem em que
 * aconteceu.
 *
 * O que se perde e a entrada de cada repeticao, e o contador e o que paga por
 * isso: o bloco e um resumo do que o agente fez, e "mexeu tres vezes neste
 * arquivo" e o que o usuario precisa ver. A entrada mostrada continua a da
 * primeira — trocar pela ultima faria a linha mudar de texto embaixo de quem
 * esta lendo, sem dizer mais nada.
 *
 * @param {string} id o id da chamada nova, que passa a achar o mesmo bloco
 * @param {string} name
 * @param {string} target o arquivo mirado; `''` nunca aglomera
 * @returns {boolean} `true` quando a repeticao foi absorvida
 */
function repeatToolUse(id, name, target) {
  const last = chat.lastTool;
  if (!last || !target || last.name !== name || last.target !== target) return false;

  last.count += 1;
  const { block } = last;

  keepPinned(() => {
    block.classList.remove('is-ok', 'is-error');
    block.classList.add('is-running');

    let counter = block.querySelector('.chat-tool-count');
    if (!counter) {
      counter = makeBlock('chat-tool-count');
      /** @type {HTMLElement} */ (block.querySelector('.chat-tool-name')).after(counter);
    }
    counter.textContent = `\u00d7${last.count}`;

    const status = block.querySelector('.chat-tool-status');
    if (status) status.textContent = 'rodando';
  });

  chat.tools.set(id, block);
  return true;
}

/**
 * Bloco de uso de ferramenta, em estado "rodando" ate o resultado chegar.
 * Repeticao da mesma tool no mesmo arquivo nao abre bloco novo: vira contador
 * no anterior (veja `repeatToolUse`).
 * @param {{ id: string, name: string, input?: unknown }} tool
 */
export function appendToolUse({ id, name, input: toolInput }) {
  const target = toolTarget(toolInput);
  if (repeatToolUse(id, name, target)) return;

  const block = makeBlock('chat-tool is-running');
  block.append(makeBlock('chat-tool-name', name));

  const summary = summarize(toolInput);
  if (summary) block.append(makeBlock('chat-tool-input', summary));
  block.append(makeBlock('chat-tool-status', 'rodando'));

  appendBlock(block);
  chat.tools.set(id, block);

  // Depois do `appendBlock`, que zera o anterior: e este bloco que passa a ser
  // o candidato a absorver a proxima acao igual.
  chat.lastTool = target ? { name, target, block, count: 1 } : null;
}

/**
 * Fecha o bloco daquela ferramenta em ok ou erro. Id desconhecido e ignorado —
 * o servidor pode reportar um resultado de um turno que ja saiu da tela.
 * @param {{ id: string, ok: boolean, summary?: string }} result
 */
export function updateToolResult({ id, ok, summary = '' }) {
  const block = chat.tools.get(id);
  if (!block) return;

  block.classList.remove('is-running');
  block.classList.add(ok ? 'is-ok' : 'is-error');

  const status = block.querySelector('.chat-tool-status');
  if (status) status.textContent = summary || (ok ? 'concluido' : 'erro');
  chat.tools.delete(id);
}

/**
 * Resposta a um pedido de permissao: fecha o bloco e avisa o transporte.
 *
 * Pedido desconhecido (ja respondido, ou de um turno que saiu da tela) e
 * ignorado — o veredito so pode ser dado uma vez.
 *
 * @param {string} requestId
 * @param {boolean} allow
 */
export function resolvePermission(requestId, allow) {
  const block = chat.pending.get(requestId);
  if (!block) return;
  chat.pending.delete(requestId);

  block.classList.add(allow ? 'is-approved' : 'is-rejected');
  for (const button of block.querySelectorAll('button')) button.disabled = true;

  const actions = block.querySelector('.chat-permission-actions');
  if (actions) actions.append(makeBlock('chat-permission-verdict', allow ? 'aprovado' : 'rejeitado'));

  chat.transport?.respondToPermission?.(requestId, allow);
}

/**
 * Pedido de permissao de escrita: nome da tool, o diff e os dois botoes.
 *
 * Com a aprovacao automatica ligada o pedido ja nasce aprovado. Nao e caso
 * impossivel: o servidor le a configuracao uma vez, no comeco do turno, entao
 * ligar o automatico no meio de um turno deixa os pedidos daquele turno
 * chegando aqui — e e aqui que eles sao respondidos sozinhos.
 * @param {{ requestId: string, toolName: string, input?: unknown, diff?: string }} request
 */
export function appendPermissionRequest({ requestId, toolName, input: toolInput, diff = '' }) {
  const block = makeBlock('chat-permission');

  const header = makeBlock('chat-permission-header');
  header.append(makeBlock('chat-permission-tool', toolName));

  const actions = makeBlock('chat-permission-actions');
  const approve = makeButton('Aprovar', 'chat-permission-approve');
  const reject = makeButton('Rejeitar', 'chat-permission-reject');
  approve.addEventListener('click', () => resolvePermission(requestId, true));
  reject.addEventListener('click', () => resolvePermission(requestId, false));
  actions.append(approve, reject);
  header.append(actions);
  block.append(header);

  const summary = summarize(toolInput);
  if (summary) block.append(makeBlock('chat-permission-input', summary));
  if (diff) block.append(renderDiff(diff));

  appendBlock(block);
  chat.pending.set(requestId, block);

  if (chat.autoApprove) resolvePermission(requestId, true);
}

/* ---------- Perguntas do agente ---------- */
//
// As vezes o agente nao quer escrever nada: ele quer *saber* de qual jeito
// seguir. Essa pergunta chega pelo evento `question` e para o turno do lado do
// servidor ate alguem responder — por isso ela vira um bloco com as opcoes
// clicaveis, e nao um texto solto que o usuario nao teria como responder.
//
// A resposta de cada pergunta e uma string, chaveada pelo enunciado: e o
// formato que a tool espera de volta (veja `answeredInput`, em `agent.js`).
// Opcao escolhida vira o rotulo dela; o campo livre vence a escolha, porque
// escrever ali e a acao mais recente do usuario.
//
// Uma chamada pode trazer ate quatro perguntas, e elas sao um bloco so: cada
// uma vira um item com os campos dela, e o Responder manda todas de uma vez.
// Sao um turno so do outro lado — mandar uma de cada vez destravaria o
// `canUseTool` antes de as outras terem resposta.
//
// O "x" cancela o bloco inteiro pelo mesmo motivo: e um pedido so. Ele nao e
// uma resposta vazia, e sim uma recusa (`allow: false`), e a tool volta ao
// modelo negada — que e como se diz "siga sem isto" em vez de "escolhi nada".

/**
 * Desenha as opcoes de uma pergunta e devolve como ler a resposta dela.
 *
 * `multiSelect` muda so o que um clique faz: numa pergunta de escolha unica ele
 * desmarca as irmas, numa de varias ele alterna a propria.
 *
 * @param {import('./utils.js').Question} question
 * @param {HTMLElement} item o bloco daquela pergunta, onde os campos entram
 * @returns {() => string} a resposta escrita agora
 */
function buildQuestionFields(question, item) {
  const options = makeBlock('chat-question-options');
  /** @type {HTMLButtonElement[]} */
  const buttons = [];

  const other = document.createElement('input');
  other.type = 'text';
  other.className = 'chat-question-other';
  other.placeholder = 'Outra resposta...';
  // Escrever aqui e a escolha mais recente: as opcoes marcadas saem do caminho
  // em vez de disputar a resposta com o texto. E vale o contrario: clicar numa
  // opcao limpa o campo livre.
  other.addEventListener('input', () => {
    if (other.value === '') return;
    for (const button of buttons) button.setAttribute('aria-pressed', 'false');
  });

  for (const option of question.options) {
    const button = makeButton('', 'chat-question-option');
    button.append(makeBlock('chat-question-option-label', option.label));
    if (option.description) {
      button.append(makeBlock('chat-question-option-description', option.description));
    }
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      const selected = button.getAttribute('aria-pressed') === 'true';
      if (!question.multiSelect) {
        for (const sibling of buttons) sibling.setAttribute('aria-pressed', 'false');
      }
      button.setAttribute('aria-pressed', String(!selected));
      other.value = '';
    });
    buttons.push(button);
    options.append(button);
  }

  if (question.options.length > 0) item.append(options);
  item.append(other);

  return () => {
    const free = other.value.trim();
    if (free) return free;
    return buttons
      .filter((button) => button.getAttribute('aria-pressed') === 'true')
      .map((button) => button.querySelector('.chat-question-option-label')?.textContent ?? '')
      .filter(Boolean)
      .join(', ');
  };
}

/**
 * Fecha o bloco de uma pergunta: os campos travam e o veredito fica escrito.
 * Pergunta desconhecida (ja respondida, ou de um turno que saiu da tela) e
 * ignorada — a resposta so pode ser dada uma vez.
 *
 * @param {string} requestId
 * @param {string} verdict o que escrever no rodape do bloco
 */
function closeQuestion(requestId, verdict) {
  const block = chat.questions.get(requestId);
  if (!block) return;
  chat.questions.delete(requestId);

  block.classList.add('is-answered');
  for (const field of block.querySelectorAll('button, input')) {
    /** @type {HTMLButtonElement | HTMLInputElement} */ (field).disabled = true;
  }
  block.append(makeBlock('chat-question-verdict', verdict));
}

/**
 * O que ficou escrito no rodape depois de responder. Com mais de uma pergunta
 * o rotulo sozinho nao diz nada — `Lista · Escuro` nao lembra qual foi qual —,
 * entao cada linha leva o enunciado (ou o chip, quando ele existe) junto.
 *
 * @param {Array<{ question: string, header: string }>} fields
 * @param {Record<string, string>} answers
 * @returns {string}
 */
function describeAnswers(fields, answers) {
  const lines = fields
    .filter((field) => answers[field.question])
    .map((field) => `${field.header || field.question}: ${answers[field.question]}`);

  return lines.join('\n') || 'sem resposta';
}

/**
 * Pergunta do agente: enunciado, opcoes e um campo de resposta livre por
 * pergunta, mais um botao que manda todas de uma vez e um "x" que cancela o
 * bloco inteiro.
 *
 * Uma chamada traz ate quatro perguntas e elas viram um bloco so — sao um
 * pedido so do outro lado (veja o cabecalho desta secao).
 *
 * Pergunta sem enunciado nao chega a ser desenhada (`normalizeQuestions`); um
 * evento em que nenhuma sobrou vira um bloco de erro, porque o turno do outro
 * lado esta parado esperando e o usuario precisa saber disso.
 *
 * @param {{ requestId: string, questions: unknown }} request
 */
export function appendQuestionRequest({ requestId, questions: raw }) {
  const questions = normalizeQuestions(raw);
  if (questions.length === 0) {
    appendChatError('O agente fez uma pergunta que este board nao soube desenhar.');
    chat.transport?.respondToQuestion?.(requestId, { allow: false, answers: {} });
    return;
  }

  const block = makeBlock('chat-question');

  // O "x" e o primeiro filho para ficar no canto de cima sem depender da ordem
  // de nenhuma pergunta — o bloco reserva a faixa dele no proprio padding.
  const cancel = makeButton('×', 'chat-question-cancel');
  cancel.title = 'Cancelar a pergunta';
  cancel.addEventListener('click', () => {
    closeQuestion(requestId, 'cancelada');
    chat.transport?.respondToQuestion?.(requestId, { allow: false, answers: {} });
  });
  block.append(cancel);

  /** @type {Array<{ question: string, header: string, read: () => string }>} */
  const fields = [];

  for (const question of questions) {
    const item = makeBlock('chat-question-item');
    if (question.header) item.append(makeBlock('chat-question-header', question.header));
    item.append(makeBlock('chat-question-text', question.question));
    fields.push({
      question: question.question,
      header: question.header,
      read: buildQuestionFields(question, item),
    });
    block.append(item);
  }

  const actions = makeBlock('chat-question-actions');
  const answer = makeButton('Responder', 'chat-question-send');
  answer.addEventListener('click', () => {
    /** @type {Record<string, string>} */
    const answers = {};
    for (const field of fields) {
      const value = field.read();
      if (value) answers[field.question] = value;
    }

    closeQuestion(requestId, describeAnswers(fields, answers));
    chat.transport?.respondToQuestion?.(requestId, { allow: true, answers });
  });
  actions.append(answer);
  block.append(actions);

  appendBlock(block);
  chat.questions.set(requestId, block);
}

/**
 * Bloco de erro no log.
 * @param {string} message
 */
export function appendChatError(message) {
  appendBlock(makeBlock('chat-error', message));
}

/* ---------- Estados do turno ---------- */

/**
 * Liga e desliga o estado "turno em andamento": some o Enviar, aparece o Parar.
 * O compositor continua editavel de proposito — da pra escrever a proxima
 * mensagem enquanto o agente trabalha.
 * @param {boolean} running
 */
export function setTurnRunning(running) {
  chat.running = running;
  chatSend.hidden = running;
  chatStop.hidden = !running;

  // Turno novo, bolha nova: o proximo delta nao cai no texto do turno anterior.
  chat.streaming = null;
  chat.thinking = null;
  chat.lastTool = null;

  if (running) return;

  // Turno terminou: os baloes em carregamento ja cumpriram seu papel, somem.
  sweepSentQueue();

  // E a pergunta que ficou sem resposta nao tem mais para onde ir — o turno que
  // a esperava acabou. Travar o bloco e dizer isso; deixa-lo clicavel
  // prometeria um envio que nao acontece mais.
  for (const requestId of [...chat.questions.keys()]) {
    closeQuestion(requestId, 'o turno terminou sem resposta');
  }
}

/**
 * Sessao devolvida pelo servidor no primeiro evento do stream.
 * @param {string | null} sessionId
 */
export function setSessionId(sessionId) {
  chat.sessionId = sessionId;
}

/**
 * Aprovacao automatica das edicoes.
 * @param {boolean} enabled
 */
export function setAutoApprove(enabled) {
  chat.autoApprove = enabled;
  /** @type {HTMLSelectElement} */ (chatAuto).value = enabled ? 'auto' : 'manual';
}

/**
 * Registra quem leva os gestos ao servidor. Sem transporte registrado, enviar
 * so desenha a mensagem do usuario e avisa que falta a chave.
 * @param {import('./state.js').ChatTransport | null} transport
 */
export function setTransport(transport) {
  chat.transport = transport;
}

/* ---------- Preferencias ---------- */

/**
 * Grava a preferencia e avisa o transporte, que e quem leva ao servidor.
 * `autoApprove` nao cabe no `ChatPrefs` do localStorage — quem guarda ele entre
 * sessoes e a config do servidor.
 * @param {Partial<import('./storage.js').ChatPrefs>} partial
 */
function updatePrefs(partial) {
  const prefs = { ...loadChatPrefs(), ...partial };
  saveChatPrefs(prefs);
  chat.transport?.saveConfig?.({ ...prefs, autoApprove: chat.autoApprove });
}

/**
 * O badge (⇧⏎) fica aceso quando so Shift+Enter envia — o inverso de
 * `sendOnEnter`, que e "Enter sozinho envia".
 * @param {boolean} enabled
 */
function setSendOnEnter(enabled) {
  sendMode.setAttribute('aria-pressed', String(!enabled));
  sendMode.title = enabled
    ? 'Enter envia, Shift+Enter quebra linha (clique para exigir Shift+Enter)'
    : 'Shift+Enter envia, Enter quebra linha (clique para voltar ao Enter)';
}

/**
 * @param {HTMLSelectElement} select
 * @param {unknown} value
 * @returns {boolean} o seletor oferece essa opcao?
 */
function offers(select, value) {
  return [...select.options].some((option) => option.value === value);
}

/**
 * Pinta na interface o que o servidor respondeu sobre `model`, `effort` e
 * `sendOnEnter`, e regrava o `localStorage` com esses valores.
 *
 * **Quem ganha e o disco.** Essas tres preferencias vivem no
 * `~/.config/pinacoteca/config.json`, que e do servidor: dois navegadores
 * apontados para a mesma pinacoteca tem de ver a mesma escolha, e so o servidor
 * pode saber qual e. O `localStorage` daqui e cache de exibicao — o `initChat`
 * pinta com ele para os seletores nao piscarem vazios enquanto o
 * `GET /api/chat/config` nao volta, e esta funcao corrige assim que a resposta
 * chega. `autoApprove` nao passa por aqui: quem o desenha e `setAutoApprove`.
 *
 * Valor que este board nao oferece (config gravada por uma versao mais nova) e
 * ignorado em vez de esvaziar o seletor.
 *
 * @param {{ model?: unknown, effort?: unknown, sendOnEnter?: unknown }} config
 *   a projecao publica devolvida pelo servidor, ainda como JSON solto
 */
export function applyServerConfig(config) {
  const current = loadChatPrefs();

  /** @type {import('./storage.js').ChatPrefs} */
  const prefs = {
    model: offers(modelSelect, config.model) ? String(config.model) : current.model,
    effort: offers(effortSelect, config.effort) ? String(config.effort) : current.effort,
    sendOnEnter: typeof config.sendOnEnter === 'boolean' ? config.sendOnEnter : current.sendOnEnter,
  };

  modelSelect.value = prefs.model;
  effortSelect.value = prefs.effort;
  setSendOnEnter(prefs.sendOnEnter);
  saveChatPrefs(prefs);
}

/* ---------- Fila de comentarios ---------- */
//
// Espelha `commentQueue` (state.js) numa lista "a enviar": cada linha e um
// item da fila, incluindo rascunhos ainda abertos no board, com "x" removivel
// que chama o mesmo removedor do balao (`inspect.js`). Nenhuma copia propria —
// redesenha inteira a cada `onQueueChange`, como o board faz do lado dele.

/**
 * @param {string} file
 * @param {import('./state.js').CommentItem} item
 * @returns {HTMLElement}
 */
function buildQueueRow(file, item) {
  const row = document.createElement('div');
  row.className = 'chat-queue-item';
  if (item.status === 'sending') row.classList.add('is-sending');
  if (item.status === 'unreferenced') row.classList.add('is-unreferenced');

  const text = document.createElement('span');
  text.className = 'chat-queue-item-text';
  text.textContent = `${file} — ${item.text || item.xpath}`;
  row.append(text);

  if (item.status !== 'sending') {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'chat-queue-item-remove';
    remove.title = 'Remover';
    remove.textContent = '×';
    remove.addEventListener('click', () => removeCommentItem(file, item.xpath));
    row.append(remove);
  }

  return row;
}

/** Redesenha a lista "a enviar" inteira a partir de `commentQueue`. */
function renderQueueList() {
  chatQueueList.replaceChildren();

  let count = 0;
  for (const [file, items] of commentQueue) {
    for (const item of items.values()) {
      count += 1;
      chatQueueList.append(buildQueueRow(file, item));
    }
  }

  chatQueue.hidden = count === 0;
}

onQueueChange(renderQueueList);

/**
 * Move todo item referenciado para `sending` (trava edicao/remocao ate o
 * turno terminar) e descarta os itens `unreferenced` — quem ainda nao
 * resolveu o no no momento do envio fica de fora da mensagem e sai da fila.
 */
function lockQueueForSending() {
  let changed = false;

  for (const [file, items] of commentQueue) {
    for (const [xpath, item] of items) {
      if (item.status === 'unreferenced') {
        items.delete(xpath);
      } else {
        item.status = 'sending';
      }
      changed = true;
    }
    if (items.size === 0) commentQueue.delete(file);
  }

  if (changed) notifyQueueChange();
}

/** Remove da fila todo item `sending`: o turno que os carregava terminou. */
function sweepSentQueue() {
  let changed = false;

  for (const [file, items] of commentQueue) {
    for (const [xpath, item] of items) {
      if (item.status !== 'sending') continue;
      items.delete(xpath);
      changed = true;
    }
    if (items.size === 0) commentQueue.delete(file);
  }

  if (changed) notifyQueueChange();
}

/* ---------- Envio ---------- */

function submit() {
  const text = input.value.trim();
  const queueMessage = serializeCommentQueue(commentQueue);
  if (!text && !queueMessage) return;

  // A fila vai primeiro, o texto livre do compositor depois — os dois se
  // misturam num turno so, que e o comportamento desejado (uma mensagem).
  const combined = queueMessage ? [queueMessage, text].filter(Boolean).join('\n\n') : text;

  appendUserMessage(combined);
  if (text) pushChatHistory(text);

  input.value = '';
  resetUndo();
  historyIndex = -1;
  autoGrow();
  saveDraftNow('');

  const send = chat.transport?.send;
  if (!send) {
    appendChatError('Nenhuma chave de API configurada: a conversa ainda nao esta ligada ao servidor.');
    return;
  }

  if (queueMessage) lockQueueForSending();
  setTurnRunning(true);
  send(combined);
}

function interrupt() {
  const stop = chat.transport?.stop;
  if (stop) stop();
  else setTurnRunning(false);
}

/* ---------- Teclado ---------- */

/** @returns {boolean} o cursor esta na primeira linha do compositor? */
function atFirstLine() {
  return !input.value.slice(0, input.selectionStart).includes('\n');
}

/** @returns {boolean} o cursor esta na ultima linha do compositor? */
function atLastLine() {
  return !input.value.slice(input.selectionEnd).includes('\n');
}

/**
 * Ctrl+Z desfaz, Ctrl+Shift+Z e Ctrl+Y refazem (Cmd no macOS). Sempre com
 * `preventDefault`, senao o desfazer nativo do textarea brigaria com a pilha
 * daqui e os dois ficariam fora de sincronia.
 * @param {KeyboardEvent} event
 * @returns {boolean} o evento era do desfazer?
 */
function handleUndoKeys(event) {
  if (!event.ctrlKey && !event.metaKey) return false;
  const key = event.key.toLowerCase();

  if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    undo();
    return true;
  }
  if ((key === 'z' && event.shiftKey) || key === 'y') {
    event.preventDefault();
    redo();
    return true;
  }
  return false;
}

/**
 * Com `sendOnEnter` ligado Enter envia e Shift+Enter quebra linha; desligado, o
 * inverso. A tecla que nao envia nao e tocada — quebrar linha e o padrao do
 * proprio textarea.
 * @param {KeyboardEvent} event
 */
function handleEnter(event) {
  if (event.isComposing) return;

  const { sendOnEnter } = loadChatPrefs();
  const sends = sendOnEnter ? !event.shiftKey : event.shiftKey;
  if (!sends) return;

  event.preventDefault();
  submit();
}

/**
 * Seta pra cima percorre o historico de tras pra frente; pra baixo volta e
 * devolve o rascunho que estava sendo escrito. So quando o cursor esta na
 * ponta certa do texto, para nao roubar a navegacao dentro do compositor.
 * @param {KeyboardEvent} event
 */
function handleHistoryKeys(event) {
  const history = loadChatHistory();
  if (history.length === 0) return;

  if (event.key === 'ArrowUp') {
    if (!atFirstLine()) return;
    if (historyIndex === -1) {
      historyDraft = input.value;
      historyIndex = history.length;
    }
    if (historyIndex === 0) return;

    event.preventDefault();
    historyIndex -= 1;
    commitValue(history[historyIndex]);
    return;
  }

  if (historyIndex === -1 || !atLastLine()) return;

  event.preventDefault();
  historyIndex += 1;
  if (historyIndex >= history.length) {
    historyIndex = -1;
    commitValue(historyDraft);
  } else {
    commitValue(history[historyIndex]);
  }
}

/** @param {KeyboardEvent} event */
function onKeyDown(event) {
  if (handleUndoKeys(event)) return;
  if (event.key === 'Enter') {
    handleEnter(event);
    return;
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') handleHistoryKeys(event);
}

/* ---------- Ligacao ---------- */

function bindComposer() {
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeyDown);

  chatComposer.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  chatStop.addEventListener('click', interrupt);

  chatAuto.addEventListener('change', () => {
    setAutoApprove(/** @type {HTMLSelectElement} */ (chatAuto).value === 'auto');
    updatePrefs({});
  });
  sendMode.addEventListener('click', () => {
    const enabled = !loadChatPrefs().sendOnEnter;
    setSendOnEnter(enabled);
    updatePrefs({ sendOnEnter: enabled });
    showToast(enabled ? 'Envio com Enter ativado' : 'Envio com Shift+Enter ativado');
  });

  modelSelect.addEventListener('change', () => updatePrefs({ model: modelSelect.value }));
  effortSelect.addEventListener('change', () => updatePrefs({ effort: effortSelect.value }));
}

/**
 * Monta o painel: preferencias nos seletores, rascunho de volta no compositor e
 * os listeners. Chamada uma vez por `board.js`, depois da carga — o rascunho e
 * o historico sao por raiz observada, e a raiz so existe depois dela.
 *
 * As preferencias saem do `localStorage` porque ele responde na hora; sao o
 * valor *mostrado* ate o servidor dizer o dele, e `applyServerConfig` corrige
 * o que divergir.
 */
export function initChat() {
  const prefs = loadChatPrefs();
  modelSelect.value = prefs.model;
  effortSelect.value = prefs.effort;
  setSendOnEnter(prefs.sendOnEnter);
  setAutoApprove(chat.autoApprove);
  setTurnRunning(false);

  input.value = loadChatDraft();
  resetUndo();
  autoGrow();

  bindComposer();
}
