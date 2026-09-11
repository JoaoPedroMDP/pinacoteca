## 1. A procedência do `pinned`

- [x] 1.1 Em `src/client/state.js`, acrescentar `autoPinned` ao typedef `Screen` —
  verdadeiro quando a tela está fixa apenas porque um gesto global a fixou —
  documentando ao lado de `pinned` o que separa um do outro; verificar que
  `npm run typecheck` passa
- [x] 1.2 Em `createCard` (`src/client/cards.js`), inicializar `autoPinned: false`:
  uma tela que nasce com posição salva conta como escolha do usuário; verificar pelo
  typecheck que nenhum ponto de criação de `Screen` ficou sem o campo
- [x] 1.3 Desligar `autoPinned` em todo gesto do usuário sobre uma tela — `moveScreen`
  e `resizeScreen` em `src/client/view.js`, que são por onde passam o arrasto de
  título, o arrasto de borda e o preset do menu do card; verificar que depois de
  arrastar uma tela ela deixa de ser tratada como fixada pelo gesto global
- [x] 1.4 Em `resetPositions` (`src/client/view.js`), zerar `autoPinned` junto com
  `pinned`, para o "Reorganizar" devolver o board inteiro ao automático; verificar
  que depois de um preset global seguido de "Reorganizar" nenhuma tela fica fixa

## 2. Separar o que colide

- [x] 2.1 Em `src/client/utils.js`, acrescentar a função pura que recebe as caixas das
  telas e devolve o deslocamento em `y` que desfaz cada sobreposição, sempre para
  baixo e sempre o mínimo, no mesmo critério que `belowPinned` usa; verificar com
  testes em `test/unit.mjs` cobrindo: nenhuma colisão (devolve vazio), duas caixas
  sobrepostas (a de baixo desce o bastante para encostar sem invadir) e três em
  cascata
- [x] 2.2 Em `src/client/view.js`, expor a aplicação desse deslocamento às telas —
  lendo as caixas por `screenRect` e escrevendo a posição pelo mesmo caminho que o
  layout já usa; verificar que rodá-la sobre um board com duas telas sobrepostas
  deixa `refreshOverlaps()` sem nenhuma tela marcada

## 3. O gesto global corrigido

- [x] 3.1 Em `applyGlobalSize` (`src/client/cards.js`), soltar `pinned` das telas com
  `autoPinned` antes de aplicar o tamanho novo, para que voltem a escorrer no
  `layout()`; verificar que aplicar `Mobile` e depois `Desktop` reacomoda as telas em
  vez de mantê-las nas posições do preset anterior
- [x] 3.2 Ainda em `applyGlobalSize`, chamar a separação de colisões depois do
  `layout()` e antes de fixar tudo, e marcar `autoPinned` nas telas que não eram do
  usuário ao fixá-las; verificar que depois do gesto nenhuma tela está com
  `is-invalid` e que o tamanho de todas foi gravado
- [x] 3.3 Verificar o caso do `Automatico` global no mesmo caminho: ele não fixa nada,
  então só precisa soltar o que o gesto anterior fixou antes de remedir

## 4. Testes

- [x] 4.1 Em `test/e2e.mjs`, cobrir o defeito relatado: aplicar `Mobile` a todas as
  telas, aplicar `Desktop` em seguida, e verificar que nenhuma tela fica com
  `is-invalid` e que o `localStorage` recebeu 1920×1080 para todas
- [x] 4.2 Em `test/e2e.mjs`, cobrir a preservação do arrasto: arrastar uma tela para
  longe, aplicar dois presets globais em sequência, e verificar que ela continua no
  ponto para onde foi arrastada
- [x] 4.3 Em `test/e2e.mjs`, cobrir a separação: arrastar duas telas para perto uma da
  outra, aplicar um preset global que as faça crescer o bastante para colidirem, e
  verificar que nenhuma das duas fica sobreposta
- [x] 4.4 Em `test/e2e.mjs`, cobrir o "Reorganizar" depois de um preset global: todas
  as telas voltam ao layout automático e ao tamanho do conteúdo

## 5. Fechamento

- [x] 5.1 Atualizar a seção "Tamanho de todas as telas ao mesmo tempo" do
  `ARCHITECTURE.md`: ela descreve hoje o comportamento defeituoso, e precisa contar a
  procedência do `pinned` e a separação de colisões, citando os nomes dos campos e das
  funções, não os valores
- [x] 5.2 Rodar `npm run check` e verificar que lint, tipos e testes passam
