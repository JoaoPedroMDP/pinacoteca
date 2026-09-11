## Why

Hoje só existe tamanho de tela por card: o menu `⤡` no título de cada um aplica um
preset (Mobile, Tablet, Laptop, Desktop) ou devolve a tela ao tamanho do conteúdo.
Conferir um protótipo inteiro em largura de celular exige abrir o menu de cada tela,
uma por uma — num board com dez telas são dez menus para o mesmo gesto.

O board existe para *ver* o que está no disco, e ver em mobile é uma das perguntas
mais frequentes sobre um protótipo. O gesto merece um controle único.

## What Changes

- Um novo controle de tamanho na toolbar, à esquerda dos controles de zoom, com as
  mesmas opções do menu por card: `Automatico`, `Mobile`, `Tablet`, `Laptop`,
  `Desktop`.
- Escolher uma opção aplica o tamanho a **todas** as telas do board de uma vez.
  `Automatico` devolve todas ao tamanho do próprio conteúdo.
- O tamanho global escolhido vale para a sessão: uma tela que **aparecer depois**
  (arquivo `.html` novo na pasta observada) nasce nesse tamanho, em vez de medir o
  próprio conteúdo.
- O tamanho global **não** persiste entre sessões. Recarregar o board zera a escolha;
  os tamanhos que as telas ganharam continuam salvos individualmente, pelo mecanismo
  de posições que já existe.
- O menu de tamanho de cada card continua valendo por cima: depois de aplicar o
  global, qualquer tela pode ser ajustada sozinha por menu ou por arrasto de borda.
  Nada é bloqueado.
- Não há mudança em zoom, pan, layout automático ou na persistência de posições.

## Capabilities

### New Capabilities
- `global-screen-size`: o controle de toolbar que aplica um tamanho de tela a todas
  as telas do board de uma vez, e como esse tamanho alcança telas que entram depois.

### Modified Capabilities

Nenhuma. Não há spec publicada cobrindo o menu de tamanho por card ou a toolbar —
o comportamento existente fica como está e não tem requisito a alterar.

## Impact

- `src/client/index.html` — o controle novo na toolbar.
- `src/client/controls.js` — o handler do controle e o fechamento do menu ao clicar
  fora, junto com o que já existe para o menu de card.
- `src/client/cards.js` — aplicar o preset a todas as telas; herdar o preset ativo
  em `createCard`.
- `src/client/state.js` — o preset global ativo, em `ui` (memória da sessão, sem
  `localStorage`).
- `src/client/board.css` — estilo do controle e do menu suspenso na toolbar.
- `test/e2e.mjs` — checks do comportamento visível no navegador.
- `ARCHITECTURE.md` — a decisão do preset global e o lugar dele na tabela de módulos.

Sem impacto no servidor, em rotas, no watcher ou no agente.
