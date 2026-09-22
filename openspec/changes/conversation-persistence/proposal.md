## Why

Recarregar a aba apaga a conversa inteira. O transcript só existe como DOM em
[chat.js](../../../src/client/chat.js) — não há modelo de mensagens —, e o
`chat.sessionId` vive em memória ([state.js:195](../../../src/client/state.js#L195)),
então um F5 no meio de um trabalho joga fora o que foi dito, o que o agente fez e a
própria sessão que o SDK sabe retomar (`resume`, em
[agent.js:564](../../../src/server/agent.js#L564)). O usuário fica sem jeito de voltar a
um trabalho de ontem: hoje existe uma conversa só, a que está na tela, e ela morre com a
aba.

## What Changes

- O servidor passa a gravar o transcript de cada conversa em disco, fora da pasta
  observada: `~/.config/pinacoteca/history/<slug-da-raiz>/`, com um `index.json` (a
  lista) e um `<sessionId>.jsonl` por conversa. A pasta observada continua intocada pela
  ferramenta — quem escreve lá é só o agente, a pedido.
- Os eventos gravados são os mesmos que já vão para o navegador
  (`session`, `text`, `thinking`, `tool`, `tool-result`, `permission`, `question`,
  `error`, `done`), com os deltas de `text`/`thinking` coalescidos num bloco por
  mensagem, mais um evento `user` que o servidor passa a registrar no início do turno.
- Na carga, o board reconstrói o log reaplicando os eventos gravados pelo mesmo caminho
  do stream ao vivo (`applyEvent`, em
  [chat-client.js](../../../src/client/chat-client.js)). Bloco de `permission` e de
  `question` volta expirado, nunca clicável: a promessa que os esperava morreu com o
  processo ou com o turno.
- A aba Conversa ganha duas **subabas**: `Conversas` (lista das conversas daquela raiz,
  com "Nova conversa" e apagar) e `Chat` (o log, a fila e o compositor de hoje, sem
  mudança). [tabs.js](../../../src/client/tabs.js) passa a servir os dois níveis em vez
  de só o de cima.
- Três rotas novas: `GET /api/chat/conversations` (o índice),
  `GET /api/chat/conversations/<id>` (os eventos de uma) e
  `POST /api/chat/conversations/delete` (apagar). O `DELETE` não entra para preservar a
  invariante já documentada: `POST` só embaixo de `/api/chat/`, e o resto do servidor é
  somente leitura.
- Trocar de conversa com um turno rodando fica bloqueado: os itens da lista ficam
  desabilitados enquanto `chat.running`, com a dica de parar o turno antes.

Não muda: o `localStorage` continua dono do rascunho, do histórico da seta pra cima, das
posições e das preferências do painel — nada disso migra para disco.

## Capabilities

### New Capabilities
- `conversation-history`: gravação do transcript por raiz observada, o índice de
  conversas, as rotas que servem e apagam, e o replay na carga (incluindo o estado
  expirado dos blocos que esperavam resposta).
- `chat-subtabs`: as subabas `Conversas`/`Chat` dentro da aba Conversa — qual abre na
  carga, a lista de conversas, criar conversa nova, apagar, e o bloqueio da troca
  enquanto um turno roda.

### Modified Capabilities
<!-- Nenhuma: os specs em openspec/specs/ (settings-modal, pointer-comment-queue,
     anthropic-credential-detection, global-screen-size, build-install-script) não
     descrevem requisito nenhum de transcript nem das abas da sidebar. -->

## Impact

- Backend: novo `src/server/history.js` (dono da pasta `history/`, do índice e da
  coalescência); `src/server/index.js` (as três rotas, e gravar cada evento no laço de
  `streamTurn` que já intercepta `session`); `src/server/agent.js` sem mudança de
  contrato.
- Frontend: `src/client/index.html` (tablist e painel da lista dentro de `#tab-chat`);
  `src/client/dom.js` (seletores novos); `src/client/tabs.js` (dois níveis de aba);
  `src/client/state.js` (`ui.activeChatTab`, e a lista carregada);
  `src/client/chat-client.js` (buscar índice, buscar uma conversa, apagar, replay);
  `src/client/chat.js` (limpar o log ao trocar de conversa, blocos expirados);
  `src/client/board.css` (estilos das subabas e da lista).
- Disco: passa a existir `~/.config/pinacoteca/history/`, com as mesmas permissões
  restritas do `config.json` (`700`/`600`) — o transcript carrega o que o usuário disse e
  trechos dos arquivos dele.
- Testes: `test/unit.mjs` para as funções puras (coalescência, slug da raiz, projeção do
  índice); `test/e2e.mjs` para reload que preserva a conversa, troca de conversa e
  criação de conversa nova.
- Docs: `ARCHITECTURE.md` — a seção que hoje explica por que a organização vive no
  `localStorage` passa a explicar também por que o transcript vive em
  `~/.config/pinacoteca/`, e as tabelas de rotas e de "onde mexer" ganham as entradas
  novas.
