## 1. Armazenamento no servidor

- [x] 1.1 Criar `src/server/history.js` com as funções puras `historySlug(rootDir)`
  (basename + hash curto do caminho absoluto) e `coalesce(events)` (junta deltas
  seguidos de `text`/`thinking` num evento só, trunca entrada de tool e diff no teto),
  e verificar com testes novos em `test/unit.mjs` cobrindo deltas intercalados com
  `tool`, delta único, lista vazia e truncamento
- [x] 1.2 Implementar em `history.js` a escrita: `openConversation(rootDir, sessionId)`
  devolvendo um gravador com `record(event)` e `close()`, que acumula o bloco aberto e
  só escreve linha JSONL na troca de tipo de evento e no fim, criando
  `~/.config/pinacoteca/history/<slug>/` com `700` e os arquivos com `600`; verificar
  com teste de unidade que grava num diretório temporário e relê o `.jsonl`
- [x] 1.3 Implementar em `history.js` o índice: `readIndex(rootDir)` (ordenado do mais
  recente para o mais antigo, reconstruído a partir dos `.jsonl` quando o `index.json`
  faltar ou estiver ilegível) e a atualização atômica (tmp + `rename`) com título tirado
  do primeiro evento `user`; verificar por teste de unidade que duas conversas voltam na
  ordem certa e que um `index.json` corrompido não lança
- [x] 1.4 Implementar em `history.js` a leitura de uma conversa
  (`readConversation(rootDir, id)`, descartando linha ilegível) e a remoção
  (`deleteConversation(rootDir, id)`, apagando `.jsonl` e entrada do índice); verificar
  por teste de unidade com um arquivo que tem uma linha corrompida no meio e com um id
  inexistente
- [x] 1.5 Aplicar o teto de bytes por arquivo, cortando os eventos mais antigos e
  deixando a marca de corte no lugar, e verificar por teste de unidade que o arquivo
  para de crescer e que a leitura ainda devolve eventos válidos

## 2. Gravar o que acontece no turno

- [x] 2.1 Em `src/server/index.js`, abrir o gravador no começo de `streamTurn`, registrar
  o evento `user` com o texto recebido antes de chamar `runTurn`, gravar cada evento no
  `onEvent` que já existe e fechar o gravador no fim; verificar por teste de unidade (ou
  e2e) que um turno completo deixa `user`, `text` e `done` no `.jsonl`
- [x] 2.2 Em `src/server/agent.js`, emitir `permission-result` para o gravador quando uma
  permissão é resolvida (aprovada ou negada), sem mandá-lo pelo stream, e verificar que
  o `.jsonl` registra o veredito e que o cliente não recebe evento novo
- [x] 2.3 Garantir que o gravador fecha também quando o turno morre por erro, por
  interrupção ou por aba fechada (`req.on('close')`), e verificar que o `.jsonl` termina
  com o `done` correspondente em cada um dos três casos

## 3. Rotas

- [x] 3.1 Adicionar `GET /api/chat/conversations` devolvendo o índice da raiz observada,
  e verificar com uma requisição no e2e que a lista vem vazia numa pasta nova e com uma
  entrada depois de um turno
- [x] 3.2 Adicionar `GET /api/chat/conversations/<id>` devolvendo `{ sessionId, events }`
  e `404` para id desconhecido, e verificar os dois casos no e2e
- [x] 3.3 Adicionar `POST /api/chat/conversations/delete` apagando a conversa, e
  verificar que ela some do índice e que pedi-la depois responde `404`
- [x] 3.4 Atualizar a tabela de rotas no cabeçalho de `createRequestHandler` com as três
  rotas novas e verificar que `npm run lint` continua limpo

## 4. Subabas e lista de conversas

- [x] 4.1 Adicionar em `src/client/index.html`, dentro de `#tab-chat`, a `role="tablist"`
  com `Conversas` e `Chat`, o painel `#chat-conversations` (lista, estado vazio e botão
  "Nova conversa") e envolver o log/fila/compositor de hoje no painel do `Chat`;
  verificar que a página carrega sem id duplicado
- [x] 4.2 Registrar os seletores novos em `src/client/dom.js` e verificar que a carga
  falha com nome de id claro se algum sumir do HTML
- [x] 4.3 Generalizar `src/client/tabs.js` para grupos de abas (`showTab(group, name)`),
  mantendo o comportamento atual da sidebar, e verificar por e2e que Telas/Conversa
  continuam alternando como antes
- [x] 4.4 Adicionar `ui.activeChatTab` em `src/client/state.js` e ligar a troca de
  subaba, verificando por e2e que só um painel fica visível por vez e que o rascunho do
  compositor sobrevive à ida e volta
- [x] 4.5 Renderizar a lista de conversas (título, data, marca de qual está aberta,
  estado vazio) a partir do índice buscado do servidor, e verificar por e2e a ordem da
  mais recente para a mais antiga e o texto do estado vazio
- [x] 4.6 Estilizar as subabas e a lista em `src/client/board.css` reaproveitando o
  padrão visual das abas da sidebar, e verificar na tela que a lista rola sem quebrar a
  sidebar estreita

## 5. Replay e troca de conversa

- [x] 5.1 Em `src/client/chat.js`, adicionar `resetChatLog()` (limpa nós, `chat.messages`,
  `tools`, `pending`, `questions`, volta o aviso de log vazio) e verificar por e2e que
  trocar de conversa não mistura mensagens das duas
- [x] 5.2 Em `src/client/chat.js`, adicionar o estado **expirado** do bloco de permissão,
  ao lado de aprovada e negada, e verificar por unidade/e2e que ele não tem botão
  clicável
- [x] 5.3 Em `src/client/chat-client.js`, aceitar o sinalizador `replay` em `applyEvent`:
  `user` vira bolha do usuário, `done` não encerra turno nenhum, `permission` sem
  `permission-result` e `question` sem resposta entram já fechadas como expiradas;
  verificar por e2e que recarregar com um pedido de permissão aberto traz o bloco
  expirado
- [x] 5.4 Guardar e ler o id da conversa aberta por raiz em `src/client/storage.js`
  (mesmo padrão tolerante a falha das outras chaves) e verificar por teste de unidade com
  o `localStorage` de mentira que já existe em `test/unit.mjs`
- [x] 5.5 Em `connectChat()`, buscar o índice, restaurar a conversa aberta pelo replay e
  abrir na subaba `Chat` quando há conversa e em `Conversas` quando não há; verificar por
  e2e que recarregar preserva o log e que a pasta nova abre em `Conversas`
- [x] 5.6 Ligar os gestos da lista — abrir conversa (replay + ir para `Chat`), criar
  conversa nova (log vazio, sem sessão, sem entrada no índice até a primeira mensagem) e
  apagar com confirmação — e verificar cada um por e2e
- [x] 5.7 Desabilitar abrir, criar e apagar enquanto `chat.running`, com a dica de parar
  o turno antes, e verificar por e2e que os itens voltam a responder quando o turno
  termina

## 6. Fechamento

- [x] 6.1 Atualizar `ARCHITECTURE.md`: por que o transcript vive em
  `~/.config/pinacoteca/` e não na pasta observada, o contrato dos eventos gravados
  (incluindo `user` e `permission-result`), a tabela de rotas, a tabela de "onde mexer" e
  as subabas; verificar lendo que nenhuma seção descreve o estado antigo
- [x] 6.2 Rodar `npm run check` e deixar lint, tipos e testes verdes
- [x] 6.3 Lembrar o usuário de commitar
