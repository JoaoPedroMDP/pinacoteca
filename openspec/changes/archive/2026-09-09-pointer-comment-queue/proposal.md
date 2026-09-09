## Why

Hoje o modo ponteiro só serve para inspecionar e copiar o XPath de um elemento
(Alt+clique). Não há como o usuário apontar um nó específico do protótipo e
já deixar um comentário/sugestão endereçado ao agente de IA sem sair do board
para escrever tudo manualmente no chat, perdendo a referência exata do nó.

## What Changes

- No modo ponteiro (ativado pela toolbar ou segurando Alt), clicar num nó do
  iframe abre uma caixinha de comentário multi-linha para aquele nó.
- Enter confirma a caixinha e a transforma num balão fixado sobre o nó; o
  balão tem um badge "x" para remoção. Reclicar num nó que já tem balão
  reabre a caixinha para editar o comentário existente (chave = XPath, não
  duplica item por nó).
- A aba de chat mostra uma lista "a enviar" espelhando a fila em tempo real
  (balões confirmados e caixinhas ainda abertas/rascunho), cada linha com seu
  próprio "x" removível; remover em um lado remove no outro.
- Ao apertar Enviar no chat, todos os itens da fila (balões e rascunhos
  abertos) são serializados numa única mensagem, numerada, com XPath e
  comentário por item, e mandados como uma única chamada de
  `chat.transport.send`. A partir desse momento a fila fica travada (sem
  editar/remover) e os balões entram em estado de carregamento até a IA
  terminar o turno, quando somem.
- **BREAKING**: o gesto de copiar XPath deixa de ser Alt+clique e passa a ser
  Ctrl+Alt+clique, já que o clique simples em modo ponteiro passa a abrir a
  caixinha de comentário.
- Se o iframe do protótipo recarrega enquanto há balões pendentes, cada
  balão tenta se reancorar automaticamente buscando seu XPath salvo no novo
  documento. Se não encontrar, o balão vira "etéreo" e migra para uma
  bandeja fixa num canto do board; o usuário pode arrastá-lo até um nó para
  reancorar. Um balão ainda etéreo no momento do envio é descartado da
  mensagem.

## Capabilities

### New Capabilities
- `pointer-comment-queue`: seleção de nós em modo ponteiro para anexar
  comentários endereçados à IA, fila local desses comentários (rascunho,
  confirmado, reancoragem, envio) e sua serialização numa única mensagem de
  chat.

### Modified Capabilities
<!-- nenhuma capability existente documentada em openspec/specs ainda; o
     comportamento de Alt+clique para copiar XPath não tinha spec própria -->

## Impact

- `src/client/inspect.js`: gesto de clique em modo ponteiro, reancoragem por
  XPath, `copyXPathAt` passa a exigir Ctrl+Alt.
- `src/client/controls.js`: novo branch de gesto no `pointerdown` do
  viewport (hoje inerte para clique simples em modo ponteiro), gesto de
  arrastar balão etéreo.
- `src/client/chat.js`: lista "a enviar" no painel de chat, serialização da
  fila numa única mensagem no `submit()`, estados de loading dos balões
  ligados ao ciclo de vida do turno (`chat.running`).
- `src/client/state.js`: novo estado para a fila de comentários (por
  screen/arquivo, chave = XPath).
- Nenhuma mudança de servidor: a fila inteira é client-side e usa o
  `chat.transport.send(text)` existente, sem novo protocolo.
