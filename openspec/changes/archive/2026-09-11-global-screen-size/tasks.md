## 1. Estado

- [x] 1.1 Em `src/client/state.js`, acrescentar a `ui` o preset global ativo
  (`{ label, width, height } | null`, começando em `null`) e o booleano de menu
  global aberto, ambos documentados no bloco de comentário de `ui`; verificar que
  `npm run typecheck` passa com a tipagem do objeto atualizada

## 2. Marcação e estilo

- [x] 2.1 Em `src/client/index.html`, acrescentar à toolbar, antes dos botões de
  zoom, o botão `data-action="global-size"` com `aria-expanded="false"` e o
  contêiner do menu, seguido de um `.toolbar-divider`; verificar no board que o
  botão aparece à esquerda do `−` sem quebrar a linha da toolbar
- [x] 2.2 Em `src/client/board.css`, estilizar o menu global reaproveitando as
  regras de `.card-size-menu` e abrindo para cima (`bottom: 100%`), já que a
  toolbar está colada na borda inferior; verificar no board que o menu aberto
  aparece acima da toolbar, inteiro e por cima dos cards

## 3. Montagem e gesto do menu

- [x] 3.1 Em `src/client/controls.js`, montar as opções do menu global a partir de
  `PRESET_FRAME_SIZES` (mais `Automatico` na frente), de modo que a lista de
  tamanhos continue vindo de `constants.js`; verificar no board que o menu lista
  `Automatico`, `Mobile`, `Tablet`, `Laptop` e `Desktop` com os mesmos números do
  menu de card
- [x] 3.2 Em `src/client/controls.js`, tratar `global-size` no listener de clique da
  toolbar que já existe, alternando o menu e o `aria-expanded`; verificar que ativar
  o botão abre o menu e ativá-lo de novo fecha sem aplicar tamanho
- [x] 3.3 Em `src/client/controls.js`, estender o listener de `click` do viewport
  que já fecha o menu de card para fechar também o global quando o clique cai fora
  do botão e do menu; verificar que clicar no vazio do board fecha o menu global sem
  aplicar tamanho

## 4. Aplicar a todas as telas

- [x] 4.1 Em `src/client/cards.js`, acrescentar a função que aplica um preset a
  todas as telas de `screens` pelo mesmo caminho de `resizeScreen`, fechando com um
  único `layout()` + `persistPositions()` no fim do laço; verificar que escolher um
  preset global deixa todas as telas com a largura e a altura do preset e grava uma
  vez só
- [x] 4.2 Em `src/client/cards.js`, acrescentar a função de `Automatico` global que
  chama `resetSizes()` e fecha com `layout()` + `persistPositions()`; verificar que
  todas as telas voltam ao tamanho do conteúdo, inclusive uma que tinha sido
  redimensionada individualmente
- [x] 4.3 Ligar as duas funções às opções do menu global em `controls.js`, gravando
  o preset escolhido em `ui` (`null` para `Automatico`) e fechando o menu depois de
  aplicar; verificar que o menu fecha no mesmo gesto e que trocar de preset
  redimensiona todas as telas de novo

## 5. Telas que entram depois

- [x] 5.1 Em `createCard` (`src/client/cards.js`), fazer o preset global ativo
  definir `frameWidth`/`frameHeight` com `sized: true` quando não for `null`,
  vencendo a medida automática e o tamanho salvo, e deixando `x`/`y`/`pinned`
  como vêm de `savedPosition`; verificar que, com um preset global ativo, um `.html`
  novo na pasta observada aparece já nesse tamanho
- [x] 5.2 Verificar o outro lado: sem escolha global na sessão, ou com `Automatico`
  ativo, uma tela nova continua medida pelo próprio conteúdo

## 6. Testes

- [x] 6.1 Em `test/e2e.mjs`, cobrir o gesto do menu global — abre, fecha ao ativar de
  novo, fecha no clique fora — e verificar que `npm run test:e2e` passa
- [x] 6.2 Em `test/e2e.mjs`, cobrir a aplicação em massa: um preset global leva
  **todas** as telas ao tamanho dele (incluindo uma redimensionada à mão antes), e
  `Automatico` global devolve todas ao tamanho do conteúdo
- [x] 6.3 Em `test/e2e.mjs`, cobrir a herança: com preset global ativo, um arquivo
  `.html` novo na pasta observada nasce nesse tamanho; e uma tela ajustada
  individualmente depois do global não arrasta as outras junto
- [x] 6.4 Em `test/e2e.mjs`, cobrir a não-persistência: depois de recarregar o board,
  as telas que existiam continuam no tamanho aplicado (vem do `localStorage` de
  posições), mas uma tela nova nasce em automático

## 7. Fechamento

- [x] 7.1 Atualizar `ARCHITECTURE.md` com a decisão do preset global (por que fica em
  `ui` e não no `localStorage`, e por que `Automatico` é `null`), citando os nomes
  das constantes e campos, não os valores
- [x] 7.2 Rodar `npm run check` e verificar que lint, tipos e testes passam
