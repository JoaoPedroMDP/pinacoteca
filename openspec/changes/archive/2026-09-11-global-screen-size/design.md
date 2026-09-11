## Context

Ver `proposal.md` — Why para a motivação, e `specs/global-screen-size/spec.md` para
os requisitos.

O que já existe e condiciona o desenho:

- `PRESET_FRAME_SIZES` em `src/client/constants.js` é a lista única de tamanhos
  (Mobile/Tablet/Laptop/Desktop). O menu por card já lê dela.
- `applyPresetSize(file, w, h)` em `src/client/view.js` aplica um preset a uma tela:
  chama `resizeScreen` (que marca `pinned` e `sized` e escreve o tamanho no DOM) e
  logo em seguida `finishResize()`, que roda `layout()` + `persistPositions()`.
- `autoSizeCard(file)` e `resetSizes()` em `src/client/cards.js` já fazem o caminho
  inverso, individual e em massa respectivamente. `resetSizes()` hoje é chamado
  apenas junto do botão "Reorganizar", e de propósito **não** roda `layout()` nem
  grava — quem chama faz isso.
- O menu por card é montado dentro do `<header>` do card (`buildTitle`), porque o
  título é contra-escalado por `1/scale` e assim o menu sai do tamanho certo em
  qualquer zoom. A toolbar não tem esse problema: ela é `position: absolute` sobre o
  viewport, fora do `transform` do canvas.
- A toolbar despacha por `data-action` num único listener de clique em
  `src/client/controls.js`. Esse mesmo módulo já fecha o menu de card no clique fora,
  no listener de `click` do viewport.
- `createCard(file)` em `src/client/cards.js` é a única porta de entrada de tela
  nova, vinda de dois lugares: a carga inicial (`board.js`) e o evento `add` do
  watcher (`sse.js`). Ele já lê `savedPosition(file)` para nascer no tamanho salvo.
- `ui` em `src/client/state.js` guarda o estado de interação do board, incluindo
  `openSizeMenuFile` (um menu de card por vez).

## Goals / Non-Goals

**Goals:**

- Um gesto de toolbar que aplique tamanho a todas as telas reaproveitando o caminho
  de redimensionamento que já existe, sem uma segunda maneira de medir ou posicionar.
- O preset global alcançar telas que entram depois, dentro da mesma sessão.
- Não fechar nenhuma porta: menu por card e arrasto de borda continuam intactos.

**Non-Goals:**

- Persistir a escolha global entre sessões — decisão do usuário, registrada abaixo.
- Refletir na toolbar qual preset está ativo em cada tela (estado "misto"). O
  controle é um gesto, não um indicador de estado do board.
- Qualquer mudança em zoom, pan, layout automático ou no formato do `localStorage`
  de posições.

## Decisions

### O preset global vive em `ui`, não no `localStorage`

Novo campo em `ui` (`state.js`), com a forma `{ label, width, height } | null`, ou
`null` para "sem escolha global / Automatico". Fica em memória: recarregar zera.

Alternativa considerada: uma chave de navegador no `storage.js`, como
`pinacoteca:snap-to-grid`. Recusada porque o usuário pediu explicitamente que a
escolha não sobreviva à sessão, e porque o efeito dela — os tamanhos das telas — já
persiste pelo registro de posições. Guardar os dois seria duas fontes da verdade
para o mesmo tamanho, e na carga teríamos de decidir qual vence.

Consequência a manter à vista: como o preset global não é salvo, `createCard` só o
consulta para telas que nascem *depois* da escolha. Na carga inicial o campo é
`null`, e cada tela continua vindo de `savedPosition(file)` — que é exatamente o que
o requisito "recarregar preserva os tamanhos já aplicados" pede.

### `Automatico` global zera o campo em vez de guardar um valor "auto"

`Automatico` não é um tamanho; é a ausência de tamanho fixo. Guardá-lo como um valor
sentinela obrigaria todo leitor a distinguir três casos (`null`, `'auto'`, preset)
quando dois bastam. Escolher `Automatico` grava `null`, e daí o comportamento de
tela nova cai sozinho no que já existe.

### Aplicar em massa reaproveita `applyPresetSize` / `resetSizes`, sem duplicar layout

Duas funções novas em `cards.js`, ao lado de `resetSizes()` que já mora lá:

- aplicar um preset a todas as telas: percorre `screens`, usa o mesmo caminho de
  `resizeScreen` que o menu por card usa, e fecha com **um** `layout()` +
  `persistPositions()` no fim — não um por tela.
- voltar todas ao automático: `resetSizes()` como está, seguido de `layout()` +
  `persistPositions()`.

Alternativa considerada: chamar `applyPresetSize(file, …)` em laço. Recusada porque
`applyPresetSize` já embute `finishResize()`, e o board inteiro seria reorganizado e
regravado uma vez por tela — N layouts e N escritas no `localStorage` para um gesto
só. O laço fica por fora do fechamento.

### O preset global solta `pinned` durante o layout e fixa tudo no fim

Decidido durante a implementação, com o usuário: o caminho acima, sozinho, não
entrega os dois requisitos ao mesmo tempo. `resizeScreen` fixa a tela, tela fixa
não escorre no `layout()`, e `persistPositions` só grava tela fixa. Ou seja:
deixar todas fixas põe as que cresceram em cima das vizinhas (e a sobreposta nem
é gravada); deixar todas soltas faz a recarga devolver o tamanho do conteúdo.

A ordem que resolve: aplicar o tamanho preservando quem já estava fixo, rodar o
`layout()` para quem ainda escorre se acomodar em volta do novo tamanho, e só
então marcar tudo como fixo antes de gravar. O arranjo manual do usuário
sobrevive, nada fica sobreposto e tudo persiste.

Alternativa considerada: o preset global se comportar como o "Reorganizar",
descartando as posições arrastadas e redistribuindo do zero. Recusada por ser
destrutiva — o usuário perderia o arranjo a cada troca de tamanho.

O `Automatico` não passa por isso: não há tamanho a preservar na recarga, então
fixar tudo ali só congelaria o board sem ganho.

Isso satisfaz "o board se reorganiza em volta do novo tamanho" e "a organização
sobrevive à recarga" pelo mesmo mecanismo que o menu por card já usa; nenhuma regra
nova de persistência entra em cena.

### O menu global mora na toolbar, com o mesmo padrão de abrir/fechar do menu de card

Um `<button data-action="global-size">` no início da toolbar, à esquerda do zoom, com
`aria-expanded`, e um `<div>` de opções logo ao lado, ancorado nele. Vai direto no
`index.html` (a toolbar já é estática lá) em vez de ser montado em JS, exceto as
opções de preset, que seguem `PRESET_FRAME_SIZES` — a lista de tamanhos continua com
uma fonte só.

O menu abre para **cima** (`bottom: 100%`), porque a toolbar está colada na borda
inferior do viewport. É a única diferença visual real contra `.card-size-menu`; o
resto do estilo pode reaproveitar as mesmas regras.

Estado de aberto/fechado: um campo booleano em `ui`, e o `data-action` cai no
listener de toolbar que já existe em `controls.js`. O clique fora reaproveita o
listener de `click` do viewport que já fecha o menu de card — mesma checagem de
`closest`, agora com os seletores do controle global também. Um detalhe a respeitar:
`controls.js:196` faz a toolbar inteira escapar do `pointerdown` do pan, então o
menu, por morar dentro dela, já não rouba o gesto do board.

Alternativa considerada: um `<select>` nativo. Recusada por consistência — o menu de
card já é um popover de botões, e um `select` na toolbar destoaria do resto dos
controles.

### `createCard` lê o preset global uma vez, depois de `savedPosition`

Dentro de `createCard`, o preset global (quando não for `null`) vence a medida
automática e define `frameWidth`/`frameHeight` com `sized: true`. Contra uma posição
salva a ordem importa pouco na prática — uma tela que acabou de nascer raramente tem
registro salvo — mas a regra fica explícita: o preset global, sendo a escolha mais
recente do usuário nesta sessão, vence o tamanho salvo de uma sessão anterior. A
posição (`x`/`y`/`pinned`) continua vindo do registro salvo, intocada.

## Risks / Trade-offs

- **Preset global aplicado a um board grande faz muitas telas mudarem de tamanho de
  uma vez, e o `layout()` pode empurrar telas fixas para longe do que o usuário
  arrumou.** → É o mesmo efeito que aplicar preset tela a tela já tem hoje, só
  concentrado num gesto; e `Automatico` global devolve tudo. Nada é destruído que o
  menu por card não destruísse também.
- **"Não persiste entre sessões" pode surpreender:** o usuário aplica Mobile, fecha o
  board, reabre e uma tela nova nasce em automático enquanto as antigas continuam em
  Mobile. → É o comportamento pedido, e o gesto para reaplicar é um clique. Está
  escrito no spec como cenário explícito para não virar bug depois.
- **A toolbar ganha um controle mais largo e pode apertar em janela estreita.** →
  Confirmado na implementação: com a sidebar esticada perto do máximo, a toolbar já
  ficava mais larga que o board e transbordava por baixo da sidebar — atinge os
  botões que já existiam tanto quanto o novo. O controle ficou só com o ícone `⤡`,
  como o do card, para não piorar. O transbordo em si é anterior a esta mudança e
  fica registrado como limite conhecido no `ARCHITECTURE.md`.
- **Duas listas de opções desenhadas a partir de `PRESET_FRAME_SIZES` (card e
  toolbar).** → É duplicação de markup, não de dado: a lista de tamanhos continua num
  lugar só. Extrair uma função de montagem compartilhada só se pagaria se surgisse um
  terceiro menu.

## Migration Plan

Não se aplica: mudança puramente aditiva no cliente, sem formato de dado novo no
`localStorage`, sem rota nova e sem alteração no servidor. Um board carregado com a
versão anterior continua lendo e escrevendo o mesmo registro de posições.
