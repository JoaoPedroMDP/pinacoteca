# ARCHITECTURE.md

## Produto

**pinacoteca** — visualizador de protótipos HTML. Roda em uma pasta, encontra todos os
`.html` dela e mostra todos lado a lado num board com zoom e pan.

É **somente leitura sobre a pasta observada**: não edita, não cria e não apaga arquivo
nenhum lá dentro. O único trabalho da ferramenta é mostrar o estado atual do disco,
sempre atualizado. A única coisa que ela lembra é como o usuário organizou as telas no
canvas, e isso vive no `localStorage` do navegador — não em arquivo (veja
"Organização das telas").

Caso de uso: o usuário deixa o board aberto em um segundo monitor enquanto um agente
gera e reescreve os HTMLs. As telas se atualizam sozinhas, sem F5, sem clicar em nada.

## Decisões técnicas

### Servidor local + navegador (não Electron)

O app é um servidor Node que serve uma página em `localhost`. O usuário abre no Chrome.

Motivo: Electron seria Chromium + Node de qualquer forma, mas custa ~150MB de binário
e um passo de build. O servidor local roda via `npx`, e os protótipos são renderizados
pelo navegador real que o usuário já usa — mesmo motor que a tela final vai encontrar.

### HTTP, não `file://`

Os HTMLs são servidos por HTTP mesmo estando no disco local. Sob `file://` o navegador
bloqueia `fetch` e `EventSource`, e caminhos relativos de CSS/imagem ficam inconsistentes.

### SSE, não WebSocket

O fluxo é unidirecional: servidor avisa o navegador que um arquivo mudou. `EventSource`
resolve isso em poucas linhas e reconecta sozinho se o servidor reiniciar. WebSocket só
se justificaria se o board precisasse mandar comandos de volta — não precisa.

### Recarregar o iframe, nunca a página

Ao receber o evento de mudança, a página **não** recarrega. Apenas o `src` do iframe
correspondente é reatribuído, com um parâmetro de cache-busting:

```js
iframe.src = `/preview/${file}?t=${Date.now()}`;
```

Isso é o que preserva o estado do board: zoom, posição do pan e o scroll das outras
telas continuam intactos. Só o card alterado pisca.

### O map de assets vive no navegador, não no servidor

Uma tela também muda quando muda o CSS ou a imagem que ela usa. Para saber *quais*
telas recarregar quando um asset muda, é preciso um map de `asset → telas afetadas`.

Esse map **não** é construído por parsing no servidor. Como tudo é servido da mesma
origem, cada iframe é perguntado sobre o que ele realmente carregou:

```js
iframe.contentWindow.performance.getEntriesByType('resource');
```

Isso é o registro do que o navegador de fato buscou, não uma inferência sobre o que o
HTML parece usar. Sai de graça: `@import` encadeado, imagem referenciada de dentro do
CSS e asset injetado por JS em runtime. Um parser de HTML no servidor erraria nos três,
e ainda exigiria um parser de CSS junto, com invalidação de cache própria.

A lista é recoletada no evento `load` de cada iframe, então o map se auto-corrige a cada
recarregamento em vez de precisar ser invalidado. Uma segunda passada, `LATE_ASSET_SCAN_MS`
depois, pega
recursos que chegam tarde — e remede o card junto, pelo mesmo motivo (veja "O `load` não
é o fim").

Limite conhecido: se uma tela referencia um arquivo que ainda não existe, o recurso só
entra no map se o navegador registrar a tentativa falha. Quando não registra, aquela tela
fica de fora até o próximo recarregamento.

### Sem framework

Sem React, sem bundler. O board é DOM direto, CSS `transform` para zoom/pan e um punhado
de listeners. A superfície do produto é pequena demais para pagar o custo de build.

## Componentes

### CLI (`bin/pinacoteca.js` + `src/cli.js`)

A leitura dos argumentos vive em `src/cli.js` e é uma função pura: `parseArgs` devolve
`{ kind: 'run' | 'help' | 'error' }` e não escreve na saída, não encerra o processo e não
toca no disco. `bin/pinacoteca.js` é a casca que traduz esse resultado em texto e código
de saída. Assim o parsing é testável sem subir nada (`test/unit.mjs`).

A pasta é opcional e o padrão é o diretório atual — o caso comum é entrar na pasta dos
protótipos e rodar `pinacoteca` sem mais nada.

| Argumento | Efeito |
| --- | --- |
| `[pasta]` | Pasta a observar (padrão: diretório atual) |
| `--port N`, `-p N` | Porta do servidor (padrão `5173`) |
| `--no-open` | Não abre o navegador |
| `--help`, `-h` | Ajuda |

Se a porta estiver ocupada, o servidor tenta as dez seguintes antes de desistir. Deixar a
ferramenta morrer por causa de uma porta ocupada seria atrito à toa numa máquina de
desenvolvimento, onde sempre há algo escutando em porta redonda.

### Servidor (Node)

| Arquivo | O que possui |
| --- | --- |
| `src/server/index.js` | as rotas (`createRequestHandler`) e o ciclo de vida (`startServer`) |
| `src/server/http.js` | primitivas sem produto: mime, caminho seguro, envio de resposta |
| `src/server/screens.js` | descoberta das telas e a política de "o que é um protótipo" |
| `src/server/watcher.js` | `chokidar` traduzido em eventos do board |
| `src/server/sse.js` | o canal aberto com cada board |

Rota nova entra em `createRequestHandler`. Se ela precisar de algo que qualquer outra
rota também usaria, isso desce para `http.js`.

`screens.js` decide duas coisas com a mesma regra: o que a varredura ignora e o que
`/preview/` recusa servir. Elas moram juntas de propósito — se divergirem, a ferramenta
lista um arquivo que depois se recusa a mostrar.

`HEAD` é aceito junto com `GET`, e o corpo nunca é enviado nele. Isso é decidido num
lugar só, no `send` de `http.js`, e não em cada rota.

| Responsabilidade | Detalhe |
| --- | --- |
| Descobrir arquivos | Varre a pasta recursivamente atrás de `.html`, pulando pastas ocultas e de build |
| Observar mudanças | `chokidar` sobre a pasta, **todos os arquivos** — HTML vira tela, o resto vira asset em potencial |
| Servir os protótipos | `GET /preview/*` devolve o arquivo cru — HTML e também os assets que ele referencia — com `Cache-Control: no-store` |
| Servir o board | `GET /` devolve a aplicação; `GET /app/*` devolve o CSS e o JS dela |
| Listar telas | `GET /api/screens` devolve os arquivos encontrados, a raiz e a versão do pacote |
| Empurrar eventos | `GET /events` é o stream SSE |

Eventos SSE emitidos:

```
{ "type": "change",  "file": "login.html" }   // conteúdo mudou → recarrega só esse iframe
{ "type": "add",     "file": "signup.html" }  // arquivo novo  → insere card e item na sidebar
{ "type": "unlink",  "file": "old.html" }     // removido      → remove card e item da sidebar
{ "type": "asset",   "file": "css/base.css" } // asset mudou   → recarrega as telas que usam esse arquivo
{ "type": "settled", "file": "" }             // a pasta parou → confere o resultado final
```

O servidor não sabe quais telas um asset afeta, e não tenta descobrir: ele só avisa que
o arquivo mudou. Quem cruza isso com o map de recursos é o cliente.

Mudanças de arquivo chegam em rajada (um salvamento pode disparar vários eventos de
`fs`). Duas defesas: o `awaitWriteFinish` do chokidar espera o arquivo parar de crescer,
para o board nunca carregar um HTML escrito pela metade, e um debounce (`DEBOUNCE_MS`)
agrupa os eventos por arquivo antes de mandá-los ao cliente.

#### Escrita atômica

Gravar num temporário e renomear por cima chega ao `fs` como `unlink` seguido de `add`.
O chokidar junta o par de volta num `change` se os dois caírem dentro de uma janela — e é
isso que preserva o card: sem a junção, o board destruiria a tela e montaria outra no
lugar, perdendo o enquadramento e jogando a câmera para cima da recém-criada.

A janela padrão do chokidar é curta demais para um agente que reescreve um HTML inteiro,
então ela é alargada (`ATOMIC_WINDOW_MS`). O preço é que a remoção de verdade de uma tela
demora esse tanto a mais para sair do board — barato perto de um card destruído à toa.

#### Quando quem escreve para

O `awaitWriteFinish` compara **tamanho** de arquivo, e só. Um arquivo escrito em pedaços
pode ficar do mesmo tamanho tempo suficiente para o evento sair com conteúdo pela metade —
o board mostra um estado intermediário e fica nele até a próxima mudança.

Daí o `settled`: `QUIET_MS` sem *nenhum* evento na pasta inteira significa que quem estava
escrevendo parou. É um evento sobre a pasta, não sobre um arquivo, e por isso `file` vem
vazio. Ele não substitui a recarga imediata — o board recarrega na hora, para o usuário
ver a mudança acontecendo; o `settled` confere o resultado final depois.

### Cliente (board)

Sem framework e sem bundler, mas dividido em módulos ES nativos. `index.html` carrega só
`board.js`; o resto entra por `import`.

| Arquivo | O que possui |
| --- | --- |
| `src/client/board.js` | entrypoint: carga inicial e ligação do stream |
| `src/client/constants.js` | todos os números ajustáveis do board |
| `src/client/utils.js` | funções puras: sem DOM, sem estado |
| `src/client/dom.js` | as referências aos elementos de `index.html` |
| `src/client/state.js` | **todo** o estado mutável: telas, zoom/pan, modo, raiz observada |
| `src/client/storage.js` | organização das telas no `localStorage` |
| `src/client/view.js` | câmera: zoom, pan e layout dos cards |
| `src/client/cards.js` | criação, recarga e medida de cada tela |
| `src/client/sidebar.js` | árvore de telas por pasta |
| `src/client/inspect.js` | modo ponteiro e captura de XPath |
| `src/client/feedback.js` | toast e área de transferência |
| `src/client/controls.js` | listeners de mouse, teclado e toolbar |
| `src/client/sse.js` | eventos do servidor aplicados no board |

Duas regras seguram essa divisão:

1. **Nenhum módulo fora de `state.js` declara estado de escopo de módulo.** Quem precisa
   guardar algo entre eventos guarda lá. `state.js` exporta objetos mutáveis (`view`,
   `ui`), então `import { view }` dá uma referência viva e ninguém precisa de setter. As
   exceções são estados de *um gesto em andamento* (o acumulado da roda, o ponteiro do
   arrasto), que vivem no módulo do gesto e morrem com ele.
2. **As dependências apontam numa direção só**, de cima para baixo nesta lista. `view.js`
   não conhece `cards.js`, `sidebar.js` não conhece `view.js`. É o que impede ciclo de
   import — e é por isso que as constantes têm módulo próprio em vez de morar no arquivo
   que mais as usa.

- **Sidebar** — árvore de telas agrupadas por pasta. Cada pasta é um cabeçalho colapsável
  (o estado de colapso vive num `Set` no cliente e persiste entre re-renders de add/remove);
  a folha mostra só o nome do arquivo, já que o caminho vem do cabeçalho. Clicar numa folha
  centraliza o board naquele card. O rodapé mostra a raiz observada e, embaixo, o estado da
  conexão SSE à esquerda e a versão do pacote (lida do `package.json` e servida em
  `/api/screens`) à direita.
- **Board** — plano com zoom e pan. Cada tela é um card com título e um `iframe` dentro.
  O título é contra-escalado por `1/scale` (via a variável CSS `--inv-scale`, ajustada no
  `applyTransform`, com `transform-origin` na base): fica sempre 16px reais na tela, legível
  em qualquer nível de zoom, ancorado logo acima do frame. A **largura** dele leva a
  correção inversa — `calc(100% * var(--scale))` —, porque a contra-escala multiplica a
  caixa junto com a fonte: com `100%`, a caixa passaria a medir a largura do card em px de
  *tela* e, no zoom afastado, taparia os cards vizinhos e roubaria o clique deles (o título
  é a alça de arrasto, então isso arrastava a tela errada). Medida em `100% * scale`, a
  caixa contra-escalada volta a ter exatamente a largura do card desenhado, em qualquer
  zoom; o nome trunca com reticências quando o espaço aperta e o completo fica no `title`.
- **Cliente SSE** — assina `/events` e aplica os eventos no DOM.
- **Map de assets** — `tela → recursos carregados`, lido de cada iframe a cada `load`.
  Um evento `asset` recarrega apenas as telas cujo conjunto contém aquele arquivo.

Cada `iframe` começa com 1280px (referência de desktop), mas nem largura nem altura ficam
fixas: no `load` de cada iframe o conteúdo real é medido (possível porque tudo é mesma
origem) e o card se ajusta.

A **largura** é a caixa que envolve os elementos do topo do `body` — direita do mais à
direita menos esquerda do mais à esquerda, não o `scrollWidth` nem só a borda direita. Uma
tela mobile centralizada numa viewport de 1280px tem margem vazia dos dois lados, e só a
diferença dá a largura da tela em si; encolher o card recentra o conteúdo e a margem some.
Assim o card fica do tamanho da tela, não 1280px com faixas vazias. Limitada entre
`MIN_FRAME_WIDTH` e `CARD_WIDTH` — no redimensionamento manual o teto é `MAX_FRAME_WIDTH`,
maior, porque `CARD_WIDTH` é só a viewport de referência da medida (veja "Tamanho escolhido
pelo usuário").
A medição vem primeiro, porque encolher o card reflui o conteúdo e a altura precisa ser
lida já com a largura final.

**A medida sempre acontece com o card devolvido a `CARD_WIDTH`**, e essa é a parte que não
pode ser esquecida. Medir com o card já encolhido faz o próprio card virar a viewport do
protótipo: um layout responsivo troca de breakpoint, é medido mais estreito ainda, o card
encolhe de novo — e a tela desce um degrau por recarga até o `MIN_FRAME_WIDTH`, com o
conteúdo espremido e cortado. Com a viewport de referência sempre igual, a largura medida
é sempre a mesma, e uma recarga que não mudou o conteúdo não mexe no card.

A **altura** é medida por `scrollHeight`, limitada entre `MIN_FRAME_HEIGHT` e
`MAX_FRAME_HEIGHT`. Sem isso, uma landing page
longa apareceria cortada dentro de uma janelinha, que é o oposto do que se quer ver num board.

Essa altura é aplicada como `height` inline no `.card-frame`, e o frame precisa ficar com
`flex: 0 0 auto`. Com `flex: 1` o `flex-basis: 0%` vence a altura inline num card de altura
automática, e o frame colapsa para os 150px padrão de um `iframe` — todas as telas ficariam
cortadas logo abaixo do topo.

O zoom é aplicado via `transform: scale()` no container do board, não redimensionando os
iframes — assim o conteúdo não sofre reflow ao dar zoom, e o resultado é o comportamento
de canvas que se espera.

Os cards são distribuídos em colunas (`⌈√n⌉`), cada um indo para a coluna mais curta no
momento. Cada coluna tem a largura da tela mais larga **dela**, não a do card mais largo do
board: uma única tela desktop não espalha as estreitas por slots de 1280px. Daí a
distribuição (`assignColumns`, em `utils.js`) vir antes do posicionamento — a largura de uma
coluna só existe depois de se saber quem caiu nela. O layout é recalculado quando um card
muda de largura ou altura, ou quando uma tela entra ou sai.

#### Organização das telas

Arrastar o **título** de um card move a tela pelo canvas. O título é a alça porque é a
única parte do card que não disputa gesto com nada: o pan, o duplo clique de interação,
o Alt+clique de XPath e o modo ponteiro nascem todos sobre o frame.

Uma tela movida vira **fixa** (`pinned`): o layout automático não mexe mais nela, e as
telas ainda automáticas escorrem pelas colunas *desviando* das fixas — descem até caber
abaixo do obstáculo. Sem isso o automático cairia em cima do manual a cada recarga de
card. O botão **Reorganizar** desfixa tudo e volta ao layout em colunas.

**Sobreposição é posição inválida.** Depois de cada movimento o board compara as caixas
de todas as telas (o título conta na altura, porque ocupa espaço acima do frame) e marca
com contorno vermelho as que estão em cima de outra. Encostar não conta: o teste é
estrito, então dois cards colados lado a lado continuam válidos.

O usuário *pode* largar uma tela em cima de outra — o card fica lá, vermelho —, mas essa
posição nunca é gravada: a tela mantém no armazenamento o último lugar válido em que
esteve, e é para lá que ela volta no próximo carregamento. Gravar posição inválida seria
persistir um estado que o board não sabe desenhar direito.

A organização vive no `localStorage`, não em arquivo: a ferramenta é somente leitura
sobre a pasta observada, e gerar um arquivo de layout dentro da pasta dos protótipos
sujaria o diretório de trabalho do usuário. A chave leva a **raiz observada** — o mesmo
navegador abre boards de pastas diferentes, e a organização de uma não tem nada a ver com
a da outra. Toda leitura e escrita tolera falha (modo privado, JSON estragado): o pior
caso é o board voltar ao layout automático, nunca quebrar.

Limite conhecido: uma tela fixa pode virar inválida sozinha, quando o conteúdo dela cresce
e o card passa a invadir o vizinho. Ela fica vermelha, mas a posição já gravada continua
gravada — ela era válida quando foi salva.

#### Tamanho escolhido pelo usuário

O card também pode ser redimensionado à mão, por duas portas: arrastando a borda do frame
ou escolhendo uma dimensão no menu do título. Serve para conferir o protótipo numa viewport
conhecida sem ter de mexer no HTML.

Só as bordas **direita**, **de baixo** e a quina entre elas agarram (`RESIZE_EDGE_PX` de
folga, em px de tela para o alvo ter o mesmo tamanho em qualquer zoom). São as que crescem
o card sem mexer no canto de cima: o `x`/`y` da tela nunca muda durante o gesto, então não
há posição a recalcular junto. A faixa não é um elemento a mais no DOM — é o escudo que já
cobre o frame, comparando o cursor com a caixa dele; o cursor sob o mouse é o único aviso de
que ali se agarra.

Redimensionar **fixa** a tela, como mover fixa: a largura de uma coluna do layout automático
sai da tela mais larga dela, e devolver a tela ao fluxo logo depois de o usuário escolher o
tamanho a jogaria para outro lugar no mesmo gesto. E vale a mesma regra de posição inválida:
esticar por cima de outra tela deixa as duas vermelhas e o tamanho novo não é gravado.

Uma tela com tamanho próprio (`sized`) **não é mais remedida** — sem isso a próxima recarga
do iframe desfaria a escolha do usuário. O `localStorage` guarda `width`/`height` junto da
posição, e os dois campos são opcionais: um registro gravado antes disso continua válido, e
a tela sem eles volta a ser medida pelo conteúdo.

O menu do título traz as dimensões de `PRESET_FRAME_SIZES` e um **Automático**, que larga o
tamanho manual e remede. A altura volta ao padrão antes dessa medida, pelo mesmo motivo que
a largura volta a `CARD_WIDTH`: o `scrollHeight` de uma página curta é a altura do próprio
frame, então medir sem zerar apenas confirmaria o tamanho que o usuário quer descartar. O
"Reorganizar" faz isso com todas as telas — ele apaga a organização inteira, e o tamanho
manual faz parte dela.

O menu mora **dentro** do título, que já é contra-escalado: assim ele e o botão saem do
mesmo tamanho na tela em qualquer zoom, sem ninguém calcular posição em px de tela. O preço
é que o `transform` do título fecha um contexto de empilhamento — o `z-index` do menu só
vale lá dentro, então quem sobe acima do frame é o título inteiro, com o menu aberto.

Limite conhecido: uma tela liberada para interação não pode ser redimensionada pela borda —
o escudo sai do caminho para o protótipo receber os cliques, e é ele quem detecta a borda.
`Esc` devolve o controle ao board e a borda volta a agarrar.

#### Escudo sobre o iframe

Um iframe engole scroll e arrasto: sem tratamento, passar o mouse sobre um card mataria o
pan e o zoom do board. Por isso cada card tem uma `div` transparente por cima, e o board
fica com todos os eventos.

O pan usa `setPointerCapture` no viewport. Como a toolbar de zoom mora dentro do viewport,
o `pointerdown` ignora alvos dentro de `.toolbar` — senão a captura redirecionaria o
`click` para o viewport e os botões de zoom nunca disparariam. Pelo mesmo motivo a captura
só acontece depois que o ponteiro se move além de `PAN_DRAG_THRESHOLD`: capturar já no
`pointerdown` redireciona também o `click`/`dblclick` de um clique parado (mesmo depois de
liberada no `pointerup`, o navegador computa o alvo do clique pelo elemento que tinha a
captura durante o gesto) — e o duplo clique que libera um card nunca chegaria ao escudo.

Duplo clique num card libera aquele card específico — o escudo some e o protótipo passa a
receber cliques, para preencher formulário e navegar. `Esc` ou um clique fora devolve o
controle ao board. Um card interativo por vez.

**Alt+clique** num card copia o XPath do elemento sob o cursor. Como tudo é mesma origem,
o cliente lê o elemento pelo `elementFromPoint` do iframe — convertendo as coordenadas do
board (escaladas por `scale`) de volta ao espaço interno do iframe. O XPath usa `@id` quando
existe, senão é absoluto com índices por irmão de mesma tag. Serve para apontar ao agente de
IA exatamente qual pedaço da tela deve mudar. O `pointerdown` do pan ignora o evento quando
`altKey` está pressionada, para o clique chegar ao escudo em vez de virar arrasto.

Uma tela recém-detectada (evento `add`, ou `change` de arquivo ainda não montado) recebe o
foco: o board enquadra e centraliza nela automaticamente.

#### Modo ponteiro

A toolbar alterna entre dois modos, e cada um deles tem uma tecla que o segura enquanto
estiver pressionada: **`Alt`** segura o ponteiro e **espaço** segura o pan. Soltar volta ao
modo anterior (perder o foco da janela também solta, para não travar no modo segurado), e
só uma tecla segura por vez — com as duas ativas ao mesmo tempo, soltar uma restauraria o
modo errado. É o que evita a ida à toolbar para um pan rápido no meio da inspeção; o espaço
tem `preventDefault` sempre, senão rolaria a página e acionaria o botão da toolbar que
estivesse com o foco. No **pan** (padrão) o cursor é a mão e arrastar move o
board. No **ponteiro** o cursor é normal e arrastar com o botão esquerdo não move o board (o
do meio ainda move); ao passar o mouse sobre um card, o elemento sob o cursor fica em foco e
os demais daquele card recebem `.pina-dim` (blur). O alvo
em foco ainda recebe `.pina-focus` (outline azul), para deixar claro o limite do elemento.


Um iframe focado engole o teclado: enquanto o cursor do usuário está digitando dentro de uma
tela liberada, os listeners do board nunca disparam. Por isso `controls.js` expõe
`bindFrameKeys`, e `cards.js` a chama no `load` de cada iframe — documento novo, `contentWindow`
nova, nenhum listener duplicado a remover. Ali dentro só valem dois atalhos: **`Alt`** (segura o
ponteiro) e **`Esc`** (devolve o controle ao board). Espaço, `0`, `1`, `+` e `-` ficam de fora de
propósito — são caracteres que o usuário pode estar digitando num campo do protótipo, e
sequestrá-los quebraria justamente o que o modo interativo existe para permitir.

No modo ponteiro o escudo volta mesmo sobre a tela liberada (`#viewport.is-pointer
.card.is-interactive .card-shield`), senão segurar `Alt` de dentro do protótipo ligaria o modo
sem nada para destacar. Soltar a tecla esconde o escudo de novo e a tela continua interativa.

O destaque é feito dentro do iframe (mesma origem): um `<style>` é injetado no `load` de cada
tela, e a cada movimento o `elementFromPoint` do iframe — com as coordenadas do board
convertidas de volta ao espaço interno — diz qual elemento está sob o cursor. Esse é o alvo
_exato_ (nível 0). Para cada ancestral do alvo, os irmãos fora do caminho ganham `.pina-dim`;
o alvo e seus filhos ficam nítidos.

Como `<div>` também serve a layout (e não só a blocos semânticos), fixar a granularidade num
nível só é imprevisível. Por isso o **scroll do mouse** ajusta o nível: sobe (`+1`) ou desce
(`-1`) um ancestral a partir da base sob o cursor (`hover.level`, limitado ao `<body>`),
então dá para abrir do elemento exato até o bloco que interessa. O delta do scroll é acumulado
e só troca de nível a cada `WHEEL_STEP`, senão o touchpad — que dispara muitos deltas
pequenos — pularia vários níveis por toque. Um **tooltip** ao
lado do cursor mostra o alvo atual (`tag#id`/`tag.classe`) e a dica do scroll. Mover o cursor
para um novo elemento reinicia o nível em 0.

#### Recarregamento

`reloadCard` guarda o `scrollY` interno do iframe antes de trocar o `src` e o restaura no
`load` seguinte. Sem isso, uma edição no rodapé de uma página longa jogaria a tela de
volta para o topo a cada salvamento.

#### Última tela mexida

O caso de uso é o agente reescrevendo HTML enquanto o board está aberto num segundo
monitor: a tela pisca, muda um pouco e às vezes fica estranha por um instante. Sem uma
marca, não dá para saber se aquilo é bug do protótipo ou o agente ainda escrevendo.

As telas atingidas pelo **último** evento do servidor ganham um contorno verde esmeralda,
mais grosso que os outros — a pergunta que ele responde é "onde mudou?", vista de longe.
São várias telas quando o evento foi um asset compartilhado, porque um `@import` alterado
mexe em todas as telas que o carregam.

A marca é histórico, não estado atual: ela **perde** para o contorno de tela interativa e
para o de posição inválida, que falam do agora. Um evento que não atingiu tela nenhuma
(remoção, asset que ninguém carrega) deixa a marca anterior de pé — ela continua sendo a
última tela mexida.

A marca diz que aquele card *acabou de mudar*, não que ele está *pronto*. Quem responde a
segunda pergunta é o `settled`.

#### O `load` não é o fim

Fonte web, imagem tardia e conteúdo montado por JS chegam **depois** do `load` do iframe.
Um card medido só ali sai do tamanho errado e fica assim até o arquivo mudar de novo —
sintoma de "a tela ficou meio bugada" que nada tem a ver com o agente. Por isso a medida
acontece três vezes: no `load`, na segunda passada (`LATE_ASSET_SCAN_MS`) e no `settled`.

No `settled` toda tela é **remedida**, e a que recarregou mais de uma vez desde o silêncio
anterior **recarrega mais uma**: mais de um evento para o mesmo arquivo é o sintoma de
escrita em pedaços, e o que está desenhado pode ser um estado intermediário. Uma edição
atômica cai no caso barato — uma recarga só, sem segunda piscada.

## Estrutura de pastas

```
pinacoteca/
├─ bin/            # casca da CLI: saída e código de saída
├─ src/
│  ├─ cli.js       # leitura dos argumentos (pura, testável)
│  ├─ server/      # servidor HTTP, rotas, SSE, file watcher
│  └─ client/      # board: HTML, CSS e módulos ES servidos ao navegador
├─ test/
│  ├─ harness.mjs  # encanação do e2e: fixture, servidor, Chrome, asserções
│  ├─ e2e.mjs      # comportamento observável no navegador
│  └─ unit.mjs     # funções puras
├─ eslint.config.js
├─ jsconfig.json
├─ README.md
├─ CLAUDE.md
├─ CONSTITUTION.md
└─ ARCHITECTURE.md
```

O pacote publicado no npm chama-se `pinacoteca` e leva apenas `bin/`, `src/`, `README.md`
e `LICENSE`. Única dependência de runtime: `chokidar`. `ws`, `eslint`, `typescript` e
`@types/node` são dependências só de desenvolvimento.

## Testes

`npm test` roda duas suítes, nesta ordem: `test/unit.mjs` e `test/e2e.mjs`.

**Unitário** (`node:test`) cobre só função pura: leitura de argumentos, resolução de
caminho seguro, política de arquivo proibido, árvore da sidebar, XPath. São decisões que
cabem em entrada e saída, e testar cada uma custa milissegundos.

**Ponta a ponta** cobre o resto, que é quase todo o valor da ferramenta: comportamento
que só existe com um navegador de verdade no meio — o iframe recarregar sozinho, o map de
assets ser lido do `performance`, o board montar os cards. Mockar isso testaria a maquete,
não o produto. A suíte sobe o servidor real numa pasta temporária, abre o Chrome headless
e o dirige pelo CDP. Sem Chrome instalado, ela se declara ignorada em vez de falhar.

Duas regras mantêm o e2e rápido e estável:

- **Nenhum `sleep` de valor fixo.** Toda espera é uma condição com prazo
  (`checkEventually`), que passa assim que a condição vale. Número mágico de espera é o
  que deixa suíte lenta na máquina rápida e instável na máquina carregada.
- **Quando o instante da coleta importa, o próprio predicado provoca o estímulo.** O map
  de assets do board só fica completo depois da segunda passada; em vez de esperar esse
  prazo, o teste reescreve o CSS a cada tentativa. Assim ele passa assim que a coleta
  terminar, sem depender de quando ela terminou.

`harness.mjs` guarda toda a encanação — WebSocket, protocolo CDP, pasta temporária,
asserções. Teste novo não precisa entender CDP: importa `check`/`checkEventually` e
descreve a condição.

## Guardrails

O projeto não tem build, mas tem três verificações. `npm run check` roda as três.

| Comando | O que pega |
| --- | --- |
| `npm run lint` | `eslint .` — variável não usada, `var`, `==`, função que cresceu demais |
| `npm run typecheck` | `tsc` sobre o JSDoc (`jsconfig.json`, `checkJs` + `strict`) |
| `npm test` | unitário e ponta a ponta |

Todo arquivo `.js` começa com `// @ts-check` e descreve os parâmetros em JSDoc. Não há
TypeScript no código e não há passo de build: o editor e o `tsc` leem os comentários. É o
que faz um campo esquecido ou um `null` não tratado aparecer na hora de escrever, e não
no board.

O tipo `Screen` (em `state.js`) declara **todos** os campos de uma tela, e `createCard` os
inicializa todos — inclusive os que só ganham valor depois (`pendingScroll`, `lateScan`).
Campo que nasce no meio do código é campo que o leitor seguinte não sabe que existe.

### Documentação não repete número

Este arquivo explica *por quê*. O código diz *quanto*. Quando um valor tem nome
(`WHEEL_STEP`, `MIN_FRAME_HEIGHT`, `DEBOUNCE_MS`), a documentação cita o nome, nunca o
número — número copiado para cá vira mentira no primeiro ajuste. Os do cliente estão em
`src/client/constants.js`; os do servidor, no topo do módulo que os usa.

## Superfície exposta

O servidor escuta só em `127.0.0.1`. Como a ferramenta é apontada para pastas arbitrárias,
`/preview/` recusa três coisas: caminhos que escapam da raiz, arquivos e pastas ocultos
(`.env`, `.git/`) e diretórios de build. Sem isso, rodar na raiz de um projeto exporia
segredos a qualquer página aberta no mesmo navegador.

## Como adicionar uma feature

1. **Confira o escopo.** Se não ajuda a *ver* o HTML que já está no disco, pare aqui
   (veja "Fora de escopo").
2. **Ache o módulo dono.** Use a tabela do cliente ou a do servidor. Se a mudança couber
   em um módulo existente, ela vai lá — arquivo novo só quando o existente passou a fazer
   duas coisas.

   | O que você vai mexer | Onde |
   | --- | --- |
   | Um número (tamanho, prazo, limite) | `src/client/constants.js` |
   | Zoom, pan, posição dos cards | `src/client/view.js` |
   | O que o board lembra entre sessões | `src/client/storage.js` |
   | O que um card mostra ou mede | `src/client/cards.js` |
   | Atalho de teclado, botão, gesto | `src/client/controls.js` |
   | Destaque de elemento, XPath | `src/client/inspect.js` |
   | Uma rota nova | `src/server/index.js` |
   | Um tipo de evento novo | `src/server/watcher.js` **e** `src/client/sse.js` |
   | O que é ou não um protótipo | `src/server/screens.js` |

3. **Guarde estado em `state.js`**, não num `let` novo no meio do módulo. A exceção é
   estado de um gesto em andamento, que morre com o gesto.
4. **Escreva o teste.** Comportamento visível no navegador vira um `check` em
   `test/e2e.mjs`; função pura vira um teste em `test/unit.mjs`.
5. **Atualize este arquivo** se a mudança alterou uma decisão ou a estrutura. Cite o nome
   da constante, não o valor dela.
6. **Rode `npm run check`.** Lint, tipos e testes precisam passar antes de a tarefa ser
   dada como concluída.

## Fora de escopo

Editar arquivos, criar arquivos, contas de usuário, deploy remoto. Se uma 
funcionalidade não ajuda a *ver* o HTML que já está no disco, ela não pertence 
a este projeto.
