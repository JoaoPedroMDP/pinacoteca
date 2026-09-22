# ARCHITECTURE.md

## Produto

**pinacoteca** — visualizador de protótipos HTML. Roda em uma pasta, encontra todos os
`.html` dela e mostra todos lado a lado num board com zoom e pan.

O board é a maneira de **ver** o que está no disco. Essa parte não escreve nada, e isso
continua valendo inteiro: a varredura só lê a pasta, o watcher só observa, e `/preview/`
só devolve o arquivo cru. Olhar nunca muda o que está sendo olhado.

O que mudou é que existe um segundo modo, na aba **Conversa**: o usuário pede algo a um
agente, e é *ele* quem escreve na pasta observada — cria e reescreve os HTMLs que o board
mostra logo em seguida. Escrever nunca é efeito colateral de olhar; é sempre consequência
de uma frase que o usuário digitou, cada edição passa por uma aprovação (veja "Aprovação
por edição"), e nem com a aprovação automática ligada o agente escreve fora da raiz
observada.

A **ferramenta** continua não sujando a pasta: o que ela própria guarda fica fora dali. A
organização das telas, o rascunho e o histórico da conversa vivem no `localStorage` do
navegador (veja "Organização das telas"); a chave da API e as preferências do agente
vivem em `~/.config/pinacoteca/config.json` (veja "A chave fora da pasta e fora do
navegador"). Nenhum arquivo de metadado nasce no diretório dos protótipos.

Caso de uso: o usuário deixa o board aberto em um segundo monitor enquanto um agente
gera e reescreve os HTMLs. As telas se atualizam sozinhas, sem F5, sem clicar em nada. O
agente pode ser o da aba Conversa ou outro qualquer rodando no terminal ao lado — o board
não distingue os dois, porque só observa o disco.

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

O fluxo do board é unidirecional: servidor avisa o navegador que um arquivo mudou.
`EventSource` resolve isso em poucas linhas e reconecta sozinho se o servidor reiniciar.
WebSocket só se justificaria se esse canal precisasse levar comandos de volta — não
precisa. A conversa, que de fato manda coisas ao servidor, não usa este canal: ela vai por
`POST`, e a resposta de cada turno é o stream dele (veja "O stream da conversa é SSE
escrito à mão sobre `POST`"). Dois fluxos separados continuam mais simples do que um
socket que serve aos dois.

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

### Claude Agent SDK, não um loop de tools na mão

A conversa roda sobre `@anthropic-ai/claude-agent-sdk` — o Claude Code usado como
biblioteca —, e não sobre o `@anthropic-ai/sdk` com um laço de tool-use escrito aqui.

O que se compraria escrevendo o laço: nada que este produto queira. O agente precisa ler
arquivo, escrever arquivo, editar trecho, listar pasta, rodar comando, continuar de onde
parou numa segunda mensagem e ainda pedir permissão antes de cada escrita. Isso é o
Claude Code inteiro; reimplementá-lo daria um segundo produto para manter dentro deste.

O preço é real e vale ser dito: **a segunda dependência de runtime**, ao lado do
`chokidar`, num pacote que se orgulhava de ter uma só. Ela é grande, traz o binário do
Claude Code junto e é a única coisa pesada de um `npx pinacoteca`. Foi aceito porque a
alternativa não era "sem dependência", era "com o `@anthropic-ai/sdk` mais o laço, as
tools de arquivo e a máquina de permissão escritos e testados aqui".

Uma consequência de fronteira: `agent.js` é a única parte do servidor que conhece o SDK.
Tudo que sai dele são os eventos de `ChatEvent`, que são nossos. Trocar de motor
reescreveria `agent.js` e mais nada.

### A chave fora da pasta e fora do navegador

A chave da API vive em `~/.config/pinacoteca/config.json`, com o diretório em `700` e o
arquivo em `600`. Os dois lugares óbvios foram recusados:

- **na pasta observada**, um `.pinacoteca.json` com a chave dentro seria um segredo no
  diretório de trabalho do usuário — commitado sem querer no primeiro `git add .`, e
  servido por engano se o `/preview/` algum dia deixasse passar um arquivo oculto;
- **no `localStorage`**, a chave ficaria em texto claro em um armazenamento que qualquer
  coisa rodando naquela origem lê, e precisaria ser mandada em cada requisição. Além
  disso, a preferência seria por navegador: o mesmo servidor, aberto em duas máquinas,
  teria duas chaves e nenhuma verdade.

O caminho respeita `XDG_CONFIG_HOME` (e `APPDATA` no Windows) — é o que permite ao e2e
apontar a configuração para uma pasta temporária e nunca tocar na do usuário.

A chave **nunca volta ao navegador**. As rotas de configuração respondem `publicConfig`,
uma projeção em que `apiKey` foi trocada por um booleano `hasKey`. O board sabe se existe
uma chave — é disso que ele precisa para decidir se mostra o painel de configuração —, e
não sabe qual é. Vale para `GET` e também para a resposta do `POST` que acabou de gravá-la:
uma projeção que só existisse num dos caminhos vazaria no outro.

Do mesmo arquivo saem `model`, `effort`, `autoApprove` e `sendOnEnter`. Eles ficam lá, e
não no navegador, porque **o servidor é o dono da configuração**: dois boards abertos na
mesma pinacoteca têm de ver a mesma escolha, e só o servidor pode saber qual é. O
`localStorage` guarda uma cópia com um papel menor — é o valor mostrado nos seletores
enquanto o `GET /api/chat/config` não responde, para eles não piscarem vazios na carga.
Quando a resposta chega, `applyServerConfig` corrige o que divergir e regrava a cópia.

`mergeConfig` é pura e é onde a validação acontece: campo ausente mantém o valor atual,
valor de tipo errado ou fora de `MODELS`/`EFFORTS` cai no valor atual e só então no padrão
— um patch estragado não apaga uma escolha boa que já estava gravada. Ler é tolerante a
falha pelo mesmo motivo que o `storage.js` do cliente é: arquivo ausente, JSON estragado
ou permissão negada devolvem os padrões em vez de derrubar o servidor.

### O stream da conversa é SSE escrito à mão sobre `POST`

O turno chega ao navegador como `text/event-stream`, escrito linha a linha na resposta de
um `POST /api/chat/message`, e é lido com `fetch` + o reader do corpo. Duas recusas
explicadas:

- **`EventSource` não serve** porque não faz `POST`. A mensagem do usuário pode ser
  longa e o turno precisa do `sessionId`; enfiar isso numa query string seria contorcer o
  transporte para caber na API do navegador.
- **O `SseHub` não serve** porque ele é *broadcast*: existe para avisar todos os boards
  abertos que um arquivo mudou. Este stream pertence a **uma requisição** — é a resposta
  daquele `POST`, para aquela aba, e morre com ela. Empurrá-lo pelo hub obrigaria a
  endereçar destinatário dentro de um canal que foi feito para não ter destinatário.

O corte dos eventos é feito por `parseSseChunk`, que é pura: recebe o resto do pedaço
anterior mais o pedaço novo e devolve os eventos fechados e o novo resto. Um JSON cortado
no meio de um chunk fica guardado até o terminador chegar, em vez de virar erro de parse.

Fechar a aba no meio do turno interrompe o agente (`req.on('close')`): sem isso o modelo
continuaria trabalhando e gastando dinheiro com ninguém do outro lado. Pelo mesmo motivo
o botão Parar avisa o servidor **e** aborta a leitura local — só abortar aqui deixaria o
turno vivo lá.

### Aprovação por edição, e o cadeado que não tem toggle

Toda tool passa pelo `canUseTool` do SDK. O padrão é **aprovar por edição**: o servidor
emite um evento `permission` com o nome da tool e um diff legível, e a Promise daquele
`canUseTool` só resolve quando o usuário clicar. É o preço de um agente que escreve na
pasta de trabalho de alguém — a primeira vez que ele reescrever a tela errada, o usuário
quer ter visto o diff antes.

O toggle **automático** desliga a pergunta, e existe porque a alternativa é pior: numa
sessão de vinte edições seguidas, um usuário que precisa clicar vinte vezes aprende a
clicar sem ler, e a aprovação vira teatro. Ele é preferência da conversa e vive na
configuração do servidor, junto da chave — não no `localStorage` —, porque quem decide se
uma escrita acontece é o lado que escreve.

**`escapingPath` é o cadeado, e ele nega escrita fora da raiz mesmo com o automático
ligado.** Ele roda *antes* de qualquer aprovação, compara os campos de caminho da entrada
da tool (`file_path`, `path`, `notebook_path`) com a raiz observada, e uma tool que
aponte para fora é recusada sem perguntar a ninguém.

O motivo é concreto: o `cwd` do SDK *orienta* o agente — é dele que o Bash parte —, mas
não o **limita**. O `Write` monta caminho absoluto sozinho, e isso aconteceu de verdade
num teste: o modelo escreveu num caminho absoluto fora da pasta observada, achando que
estava dentro dela. Um `cwd` não é uma jaula, e tratar como se fosse era o bug.

Duas consequências assumidas: uma permissão que ninguém responde não pode segurar o
processo do SDK para sempre, então abortar o turno resolve as pendentes como recusa; e o
agente não consegue ler nada fora da raiz — inclusive quando o usuário queria, o que é
uma limitação real e é preferível ao contrário.

### A pergunta do agente passa pela mesma porta, mas não é uma aprovação

Às vezes o agente não quer escrever nada: ele quer *saber* de qual jeito seguir, e chama
a tool `AskUserQuestion` com uma lista de perguntas e opções. Ela cai no mesmo
`canUseTool` das escritas — é por ali que toda tool passa —, e é só isso que as duas têm
em comum.

A diferença é o que volta. Uma permissão devolve sim ou não; uma pergunta devolve
**conteúdo**: o `canUseTool` responde `allow` com um `updatedInput` em que o campo
`answers` carrega a escolha do usuário, chaveada pelo enunciado de cada pergunta
(`answeredInput`, pura e testada). É assim que a resposta chega ao modelo — a tool roda
com essa entrada e o resultado dela é o que ele lê.

Daí a ordem dentro do `canUseTool`: o cadeado da raiz primeiro, **a pergunta em seguida,
antes do `autoApprove`**, e a aprovação de edição por último. O automático existe para
não perguntar "posso escrever?" vinte vezes seguidas; aprovar sozinho uma *pergunta*
responderia por quem ela queria ouvir, e o modelo receberia um `answers` vazio — o
oposto do que a tool foi chamada para conseguir.

No navegador ela vira um bloco com as opções clicáveis e um campo de resposta livre por
pergunta. O campo livre vence a opção marcada, e marcar uma opção limpa o campo: são duas
formas de responder a mesma pergunta, e a mais recente é a que vale. Numa pergunta
`multiSelect` o clique alterna a própria opção e as escolhas se acumulam (juntadas por
vírgula); numa de escolha única ele desmarca as irmãs. `normalizeQuestions` (`utils.js`,
pura) descarta o que o painel não saberia desenhar — pergunta sem enunciado, opção sem
rótulo —, porque essa lista foi escrita pelo modelo e o board a trata como trata qualquer
texto vindo de fora. Evento em que não sobra pergunta nenhuma vira um bloco de erro **e**
responde na mesma hora: o turno do outro lado está parado esperando, e sumir calado o
deixaria pendurado até o usuário apertar Parar.

**Uma chamada traz até quatro perguntas, e elas são um bloco só.** Cada uma vira um item
com os campos dela, e há um único Responder, que manda todas juntas. Não é escolha de
layout: do outro lado é *um* `canUseTool`, e responder uma de cada vez o destravaria antes
de as outras terem resposta. Pelo mesmo motivo o **"x" cancela o bloco inteiro** — é um
pedido só. O rodapé de um bloco respondido escreve uma linha por pergunta, com o chip (ou
o enunciado) na frente: com mais de uma, `Lista · Escuro` não diria qual foi qual.

O "x" **não é uma resposta vazia**: ele responde `allow: false`, e a tool volta ao modelo
negada. É a diferença entre "siga sem isto" e "escolhi, e escolhi nada" — a segunda é o
que um `allow: true` com `answers` vazio diria, e não é o que o usuário fez ao cancelar.
Por isso o que o painel manda ao transporte tem o mesmo formato do `Reply` do servidor,
`{ allow, answers }`, em vez de só o mapa de respostas.

A resposta volta pela rota da permissão (`POST /api/chat/permission`, com `answers`), e
não por uma rota nova: do ponto de vista do servidor as duas são o mesmo gesto — alguém
respondeu o pedido que estava esperando —, e `session.pending` já é o lugar onde esse
alguém é aguardado.

### `agentEnv`: a chave escolhida tem de ser a chave usada

O processo do SDK recebe o ambiente do servidor. Se há chave configurada na pinacoteca,
`agentEnv` a coloca em `ANTHROPIC_API_KEY` e **apaga as credenciais de ambiente** que o
Claude Code também aceita (`ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`,
`ANTHROPIC_PROFILE`).

O motivo é diagnóstico, não segurança: numa máquina já logada no Claude Code, o SDK
autenticaria por aquela credencial e a chave escolhida aqui nunca seria usada. Uma chave
errada colada na interface funcionaria — até o usuário rodar em outra máquina e a conversa
parar sem explicação. Apagando, o que ele escolheu é o que vale, e um erro de chave
aparece na primeira mensagem.

Sem chave configurada, ao contrário, o ambiente **passa inteiro**, de propósito: numa
máquina já autenticada no Claude Code a conversa funciona sem o usuário colar chave
nenhuma, e limpar essas variáveis ali removeria a única credencial que existe.
`hasCredential` reconhece esse caso — o turno só recusa começar quando não há nem chave
gravada nem credencial no ambiente, e aí a mensagem de erro diz o que fazer em vez de
deixar o SDK morrer com um erro de autenticação.

Essa mesma detecção (`hasAmbientCredential`) chega ao navegador: `GET`/`POST
/api/chat/config` devolvem um campo `hasAmbientCredential` ao lado de `hasKey`. Sem ele, um
usuário com plano Pro/Max já logado no Claude Code veria o campo de chave vazio e assumiria
que precisa colar uma — e, com ela, pagaria por crédito de API que a assinatura já cobre. O
painel de configuração mostra um aviso (`chat.js`, `setHasAmbientCredential`) explicando que
a sessão já basta. Com sessão detectada, o campo de chave e o botão Salvar começam
escondidos por padrão — nada para o usuário decidir ali, o aviso já resolve a dúvida —, mas
não desaparecem de vez: o próprio aviso é um botão (`#chat-credential-note`) que, clicado,
revela o campo. É a forma de escolher crédito de API mesmo tendo sessão — por exemplo, para
não gastar a cota do plano —, só que atrás de uma ação extra em vez de sempre à vista. Essa
regra de três fontes (`hasKey`, `hasAmbientCredential`, o clique guardado em
`chat.keyFieldRevealed`) é recalculada por `updateKeyFieldVisibility`, chamada pelos dois
setters e pelo clique — nunca setada direto em nenhum dos três, para não dessincronizar. O
aviso também é visualmente secundário (fonte menor, mais opaco que o resto do painel) e
mora abaixo do campo, não acima — a ordem antiga o deixava competindo com o campo pela
primeira leitura.

`hasAmbientCredential` não olha só variável de ambiente: o `claude login` de verdade não
exporta nenhuma das de cima, ele grava a sessão em disco — mas onde depende da plataforma.
Fora do macOS é `~/.claude/.credentials.json` (ou `$CLAUDE_CONFIG_DIR/.credentials.json`),
e é de lá que o SDK autentica quando não há `ANTHROPIC_API_KEY` no ambiente — mesma
resolução de caminho nos dois lados. Por isso a função checa esse arquivo além das
variáveis; a versão que só olhava o ambiente relatava "sem credencial" numa máquina logada
de verdade, e o turno morria com o erro genérico da falta de chave antes até de tentar.
`fileExists` entra como parâmetro injetável (padrão `existsSync`) só para o teste de
unidade não depender do disco real; os testes ponta a ponta isolam a sessão real do
desenvolvedor apontando `CLAUDE_CONFIG_DIR` para uma pasta temporária vazia, do mesmo jeito
que já isolam `XDG_CONFIG_HOME`.

No macOS o `claude login` nunca cria esse arquivo: a sessão vai para o Keychain do sistema,
sob o serviço `Claude Code-credentials` e a conta do usuário do sistema operacional — mesmo
lugar e mesmo comando (`security find-generic-password`) que o próprio CLI usa para ler a
própria sessão. `hasAmbientCredential` recebe `platform` (padrão `os.platform()`) e, no
ramo `'darwin'`, chama `hasKeychainCredential` em vez de `fileExists` — checar o arquivo ali
não adiantaria, ele nunca existe nessa plataforma. Qualquer falha do `security` (sem
entrada, Keychain bloqueado, binário ausente) vira "sem credencial", nunca lança: mesma
semântica de "arquivo não existe" que já valia para o `fileExists`. `platform` e a função de
Keychain (`hasKeychain`) também são injetáveis, pelo mesmo motivo do `fileExists`: o teste
de unidade não pode depender da plataforma nem do Keychain de quem roda o teste.

Esse campo não entra em `publicConfig`: ele não é gravado em `config.json`, é uma
capacidade do **processo do servidor** naquele instante. Por isso é composto na rota
(`src/server/index.js`), não em `config.js` — `config.js` continua sabendo só do que está
em disco.

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
| `src/server/config.js` | `~/.config/pinacoteca/config.json`: chave, modelo, esforço e preferências |
| `src/server/agent.js` | a ponte com o Claude Agent SDK: um turno, as tools e as permissões |

Rota nova entra em `createRequestHandler`. Se ela precisar de algo que qualquer outra
rota também usaria, isso desce para `http.js` — foi assim que `readJsonBody` (com teto de
corpo, porque corpo sem limite é um jeito bobo de travar o processo) nasceu lá e não numa
rota.

`config.js` e `agent.js` não se conhecem pela metade: `agent.js` importa a configuração,
e `config.js` não sabe que existe um agente. As duas funções que decidem algo sozinhas
(`mergeConfig`, `escapingPath`, `buildDiff`, `answeredInput`, `translateMessage`,
`agentEnv`, `hasCredential`) são puras e estão no `test/unit.mjs`; o resto é IO e stream.

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
| Guardar a configuração | `GET`/`POST /api/chat/config` leem e gravam o arquivo de configuração — sempre pela projeção `publicConfig`, sem a chave |
| Conversar | `POST /api/chat/message` roda um turno e escreve os eventos dele na própria resposta |
| Obedecer ao Parar | `POST /api/chat/interrupt` aborta o turno em andamento daquela sessão |
| Responder a permissão | `POST /api/chat/permission` destrava o `canUseTool` que estava esperando — a aprovação de uma edição ou a resposta a uma pergunta do agente |

Rotas, na íntegra:

| Rota | Corpo | Resposta |
| --- | --- | --- |
| `GET /` | — | a página do board |
| `GET /app/*` | — | CSS e JS do board |
| `GET /api/screens` | — | `{ root, version, screens }` |
| `GET /events` | — | stream SSE das mudanças da pasta |
| `GET /preview/*` | — | o arquivo cru do protótipo ou de um asset dele |
| `GET /api/chat/config` | — | `{ hasKey, model, effort, autoApprove, sendOnEnter }` — nunca a chave |
| `POST /api/chat/config` | `{ apiKey?, model?, effort?, autoApprove?, sendOnEnter? }` | igual ao `GET` |
| `POST /api/chat/message` | `{ sessionId, text }` | `text/event-stream` com os eventos da conversa |
| `POST /api/chat/interrupt` | `{ sessionId }` | `{ ok: true }` |
| `POST /api/chat/permission` | `{ sessionId, requestId, allow, answers? }` | `{ ok: true }` |

**`POST` existe só embaixo de `/api/chat/`.** O resto do servidor continua respondendo
apenas `GET` e `HEAD`, e o roteador separa os dois mundos na primeira linha: quem não
começa com o prefixo da conversa passa pelo guarda de método de sempre.

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

#### Os eventos da conversa

O stream de `POST /api/chat/message` é outro contrato, com outro formato: um JSON por
linha `data:`. Ele é gerado em `agent.js` (`ChatEvent`) e consumido em `chat-client.js`
(`applyEvent`); tipo novo entra nos dois e nesta tabela, ou em nenhum.

```
{ "type": "session",     "sessionId": "..." }                       // sempre o primeiro
{ "type": "text",        "delta": "..." }                           // resposta, em pedaços
{ "type": "thinking",    "delta": "..." }                           // raciocínio, em pedaços
{ "type": "tool",        "id": "...", "name": "Edit", "input": { } }
{ "type": "tool-result", "id": "...", "ok": true, "summary": "..." }
{ "type": "permission",  "requestId": "...", "toolName": "Edit", "input": { }, "diff": "..." }
{ "type": "question",    "requestId": "...", "questions": [ ] }
{ "type": "error",       "message": "..." }
{ "type": "done",        "stopReason": "end_turn" }                 // sempre o último, sempre um
```

Duas garantias que o cliente pode assumir: o `session` vem antes de tudo (é ele que dá o
`sessionId` de uma conversa nova), e sai **exatamente um** `done` por turno — por
resposta, por erro ou por interrupção. É o que permite ao board fechar o balão sem contar
casos. Um evento desconhecido é ignorado pelo cliente em vez de virar erro no log: um
board mais velho conversando com um servidor mais novo perde o recurso, não a conversa.

O texto e o raciocínio saem dos eventos parciais do SDK, e por isso a mensagem
`assistant` completa contribui só com os `tool_use` — sem esse cuidado cada resposta
apareceria duas vezes.

### Cliente (board)

Sem framework e sem bundler, mas dividido em módulos ES nativos. `index.html` carrega só
`board.js`; o resto entra por `import`.

| Arquivo | O que possui |
| --- | --- |
| `src/client/board.js` | entrypoint: carga inicial e ligação do stream |
| `src/client/constants.js` | todos os números ajustáveis do board |
| `src/client/utils.js` | funções puras: sem DOM, sem estado |
| `src/client/dom.js` | as referências aos elementos de `index.html` |
| `src/client/state.js` | **todo** o estado mutável: telas, zoom/pan, modo, raiz observada, conversa |
| `src/client/storage.js` | o que o board lembra entre sessões, no `localStorage` |
| `src/client/view.js` | câmera: zoom, pan e layout dos cards |
| `src/client/cards.js` | criação, recarga e medida de cada tela |
| `src/client/sidebar.js` | árvore de telas por pasta |
| `src/client/inspect.js` | modo ponteiro e captura de XPath |
| `src/client/feedback.js` | toast e área de transferência |
| `src/client/controls.js` | listeners de mouse, teclado, toolbar e a largura da sidebar |
| `src/client/sse.js` | eventos do servidor aplicados no board |
| `src/client/tabs.js` | as abas da sidebar: qual painel está visível |
| `src/client/chat.js` | o painel de conversa: compositor, histórico, log e as bolhas |
| `src/client/chat-client.js` | o transporte da conversa: as rotas `/api/chat/` |

Os três últimos entram no fim da ordem de dependência de propósito. `tabs.js` conhece só
`dom.js` e `state.js` — trocar de aba não pode depender de haver conversa. `chat.js`
conhece `constants`, `dom`, `state`, `storage` e `feedback`, e **não faz rede**.
`chat-client.js` é o único que fala com o servidor, e é o único que importa `chat.js`: a
seta aponta do transporte para o desenho, nunca ao contrário, e é isso que deixa o painel
funcionar (desenhando) antes de haver chave configurada.

O acordo entre os dois é o `ChatTransport` de `state.js`, com todos os campos opcionais:
`chat.js` chama `chat.transport?.send?.(...)` e segue a vida se ninguém tiver se
registrado.

Duas regras seguram essa divisão:

1. **Nenhum módulo fora de `state.js` declara estado de escopo de módulo.** Quem precisa
   guardar algo entre eventos guarda lá. `state.js` exporta objetos mutáveis (`view`,
   `ui`), então `import { view }` dá uma referência viva e ninguém precisa de setter. As
   exceções são estados de *um gesto em andamento* (o acumulado da roda, o ponteiro do
   arrasto, a pilha de desfazer do compositor, o índice de navegação do histórico, o
   `AbortController` do turno em andamento), que vivem no módulo do gesto e morrem com
   ele.
2. **As dependências apontam numa direção só**, de cima para baixo nesta lista. `view.js`
   não conhece `cards.js`, `sidebar.js` não conhece `view.js`. É o que impede ciclo de
   import — e é por isso que as constantes têm módulo próprio em vez de morar no arquivo
   que mais as usa.

- **Sidebar** — duas abas, **Telas** e **Conversa**, com um painel visível por vez
  (`tabs.js`; a aba ativa é `ui.activeTab`). Ela virou o lugar das duas coisas que se faz
  com o board — ver o que existe e pedir uma mudança — e o canvas continua inteiro para os
  protótipos. Nenhum dos dois painéis sabe da existência do outro.
- **Aba Telas** — árvore de telas agrupadas por pasta. Cada pasta é um cabeçalho colapsável
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
- **Aba Conversa** — o log das mensagens, o compositor e os seletores de modelo, esforço,
  aprovação automática e modo de envio. Todo texto que vem do modelo ou dos arquivos do
  usuário entra por `textContent`, nunca por `innerHTML`: é conteúdo de fora, e o board o
  trata como tal. O log acompanha o fim só para quem já estava no fim — quem rolou para
  cima para ler não tem a viewport arrastada. O painel inteiro usa uma fonte menor que a
  do resto do board, e os tamanhos de dentro dele são relativos a ela (`em`): a coluna é
  estreita e empilha bolha, ferramenta, diff e permissão coladas, então o corpo do board
  aperta ali. Mexer no `font-size` do painel mexe no painel todo.
- **Compositor** — cresce com o conteúdo até `CHAT_INPUT_MAX_HEIGHT` e daí rola por
  dentro; tem pilha de desfazer própria (`CHAT_UNDO_LIMIT`, agrupada por pausa de
  `CHAT_UNDO_GROUP_MS`) porque o desfazer nativo do textarea brigaria com as trocas de
  texto que o histórico faz; grava o rascunho com um debounce de
  `CHAT_DRAFT_DEBOUNCE_MS`; e a seta pra cima percorre as mensagens já enviadas, mas só
  quando o cursor está na ponta certa do texto, para não roubar a navegação de dentro do
  campo.

#### O log é linear

Todo bloco novo do log **fecha os blocos abertos do turno**, e isso é decidido num lugar
só: o `appendBlock` de `chat.js`. Sem essa regra a bolha do assistente continuava aberta
depois de um bloco de ferramenta, e o texto que chegasse em seguida voltava a crescer
*acima* do Edit ou do Bash que já tinha entrado embaixo dela — o log deixava de contar a
história na ordem em que ela aconteceu, que é justamente o que se lê nele.

Quem abre um bloco (`beginAssistantMessage`, `beginThinking`) registra o seu **depois** de
chamar o `appendBlock`, então o bloco recém-criado não se fecha sozinho. É o que permite a
resposta continuar crescendo em streaming numa bolha só enquanto nada entra entre os
deltas.

#### Ação repetida é uma linha com contador

Um agente que reescreve uma tela chama `Edit` no mesmo arquivo várias vezes seguidas, e
cada chamada virava um bloco igual embaixo do outro — três linhas dizendo "Edit
login.html" empurravam o resto do log para fora da coluna estreita da sidebar. Quando a
ação seguinte é **a mesma tool no mesmo arquivo e logo em seguida**, ela não abre bloco
novo: o bloco que já está lá ganha um contador (`×3`) e volta a "rodando".

O alvo sai de `toolTarget` (`utils.js`, pura): os mesmos campos de caminho que
`escapingPath` confere no servidor (`file_path`, `path`, `notebook_path`). **Entrada sem
arquivo nunca aglomera** — dois `Bash` seguidos quase nunca são o mesmo comando, e contá-los
juntos esconderia duas coisas diferentes numa linha só.

"Logo em seguida" é o que `chat.lastTool` guarda, e ele segue a mesma regra do log linear:
`appendBlock` o zera, então qualquer coisa que entre no meio — um texto do assistente, um
diff de permissão, uma pergunta — quebra a sequência e o próximo `Edit` abre bloco novo. O
log continua contando a história na ordem em que ela aconteceu; o que mudou é que a mesma
frase repetida é dita uma vez, com quantas.

O que se perde é a entrada de cada repetição, e o contador é o que paga por isso: o bloco
sempre foi um resumo, e "mexeu três vezes neste arquivo" é o que o usuário precisa ver. A
entrada mostrada continua a da **primeira** chamada — trocá-la pela última faria a linha
mudar de texto embaixo de quem está lendo sem dizer mais nada.

Limite conhecido: com duas chamadas da mesma tool no mesmo arquivo em paralelo, o resultado
da primeira fecha o bloco em ok/erro enquanto a segunda ainda roda, e o estado visível é o
da última a responder.

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

#### A sidebar: largura e altura

A sidebar é uma coluna flex, e cada aba é um item que ocupa a altura toda abaixo da barra
de abas. Trocar de aba é só `hidden` no painel — mas `hidden` é regra da folha do agente, e
os dois painéis têm `display: flex` no `board.css`, que a vence. Por isso cada painel
precisa do seu par `[hidden] { display: none }`; sem ele os dois ficam desenhados, dividem
a altura pelo flex e a conversa abre só até a metade da barra.

A **largura** é arrastável por um puxador de 5px entre a sidebar e o board. Ele é um item
flex de verdade, e não uma borda sobreposta ao painel: sobreposto, ele cobriria o conteúdo
e roubaria o clique de qualquer botão colado na beirada. O gesto escreve a variável CSS
`--sidebar-width` que o `#sidebar` já lia — o layout continua sendo do `board.css`, e o
`controls.js` só escolhe o número. Como a sidebar começa na borda esquerda da janela, o X
do ponteiro *é* a largura pedida, e não há origem de gesto a guardar.

Duas larguras convivem, e a diferença importa: `ui.sidebarWidth` guarda a **escolhida** e o
CSS recebe a **aplicada**. Numa janela estreita elas divergem, porque o board tem um piso
de espaço (`SIDEBAR_MIN_CANVAS`) que vence até o mínimo da própria sidebar — ver o
protótipo é o ponto da ferramenta. Se o valor guardado fosse o aplicado, encolher a janela
encolheria a sidebar *de vez*: devolvida ao tamanho de antes, ela não voltaria. Por isso o
`resize` da janela recalcula a aplicada sem gravar nada.

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

A organização vive no `localStorage`, não em arquivo. O motivo não é mais "a ferramenta
não escreve na pasta" — o agente da conversa escreve —, e continua valendo assim mesmo: um
arquivo de layout dentro da pasta dos protótipos sujaria o diretório de trabalho do
usuário com um metadado que ele não pediu, que não é um protótipo e que ele teria de
lembrar de não commitar. O que o agente grava lá é o que foi pedido; o que a ferramenta
grava sozinha fica de fora.

A chave leva a **raiz observada** — o mesmo navegador abre boards de pastas diferentes, e
a organização de uma não tem nada a ver com a da outra. Toda leitura e escrita tolera
falha (modo privado, JSON estragado): o pior caso é o board voltar ao layout automático,
nunca quebrar.

O `storage.js` guarda hoje três famílias, e a divisão entre elas é o que a chave carrega:

| O que | Chave | Por quê |
| --- | --- | --- |
| Posições e tamanhos das telas | por raiz observada | é a organização *daquela* pasta |
| Rascunho do compositor | por raiz observada | conversa em andamento é sobre aquela pasta; o texto não enviado de uma não deve vazar para o board de outra |
| Histórico de mensagens enviadas | por raiz observada | a seta pra cima só deve trazer o que foi pedido àquele board |
| Snap-to-grid | por navegador | é jeito de trabalhar, não conteúdo de pasta |
| Largura da sidebar | por navegador | o tamanho confortável do painel depende do monitor, não da pasta |
| `model`, `effort`, `sendOnEnter` | por navegador | **cópia de exibição**: a verdade é a configuração do servidor, e `applyServerConfig` sobrescreve quando ela chega |

`autoApprove` de propósito **não** está nessa lista: quem decide se uma escrita acontece é
o lado que escreve, então ele mora só na configuração do servidor.

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

#### Tamanho de todas as telas ao mesmo tempo

A toolbar tem o mesmo menu, aplicado ao board inteiro: as opções saem de
`PRESET_FRAME_SIZES` — a lista continua vindo de um lugar só — e escolher uma põe **todas**
as telas naquele tamanho. Ver o protótipo inteiro em mobile é uma das perguntas mais comuns
sobre um board, e abrir o menu de cada tela para isso era o mesmo gesto repetido *n* vezes.
O menu de cada card continua valendo por cima depois: o global é um atalho, não uma trava.

A escolha vive em `ui.globalSize` e **não** vai para o `localStorage`. O que ela produz — o
tamanho de cada tela — já persiste no registro de posições; guardar as duas coisas daria
duas fontes da verdade para o mesmo número, e a carga teria de decidir qual vence. O
"Automático" é o próprio `null`, e não um valor sentinela: não é um tamanho, é a ausência
de tamanho fixo, e assim todo leitor distingue dois casos em vez de três.

Enquanto a escolha vale, ela alcança as telas que **entram depois** — `createCard` a
consulta em `initialSize`, e ela vence o tamanho salvo de uma sessão anterior por ser a
escolha mais recente do usuário. Só o tamanho: a posição continua vindo do registro salvo.

`applyGlobalSize` mexe em `pinned` no meio do caminho, e o motivo é um aperto entre duas
coisas que o gesto precisa entregar. Tela fixa não escorre, então deixar todas fixas durante
o layout poria as que cresceram em cima das vizinhas; mas `persistPositions` só grava tela
fixa, então deixar todas soltas faria a recarga devolver o tamanho do conteúdo.

É por isso que existe `autoPinned` ao lado de `pinned`: ele guarda a **procedência**. Uma
tela com `autoPinned` está fixa só porque um gesto global a fixou, e não porque o usuário a
colocou ali. Sem essa distinção o segundo gesto global encontrava tudo fixo, o layout não
tinha o que acomodar, e as telas cresciam umas por cima das outras — todas vermelhas e, por
tabela, sem gravar o tamanho, já que tela sobreposta não persiste. `autoPinned` não é um
segundo `pinned`: o significado de `pinned` ("o layout não mexe nesta") continua o mesmo em
todos os pontos que o leem, e o campo novo só responde de quem foi a decisão. Qualquer gesto
do usuário sobre a tela — arrastar o título, arrastar a borda, escolher um tamanho no menu
do card — desliga `autoPinned`; "Reorganizar" desliga em todas.

A ordem do gesto, então: solta o que ele mesmo fixou da vez anterior, aplica o tamanho
preservando quem é do usuário, deixa o layout acomodar quem escorre, **separa o que ainda
colide**, e só então fixa tudo onde parou. O que pode colidir depois do layout são duas
telas que o usuário posicionou e que cresceram uma dentro da outra: `separateCollisions`
desce a de baixo o mínimo que resolve. Ele mirou aqueles pontos, mas não mirou a colisão —
e deixá-la de pé custaria também o tamanho das duas. Isso não vale para o arrasto à mão:
largar uma tela em cima de outra continua sendo posição inválida do usuário, marcada e não
gravada.

A conta de quem desce é `separateOverlaps`, em `utils.js`, pura e testada em `unit.mjs`.
Ela só desce, nunca desvia para o lado, pelo mesmo motivo que `belowPinned` também só desce:
o board é lido em colunas, e uma tela saltando para o lado embaralha mais do que uma
descendo.

No "Automático" nada disso é preciso: não há tamanho a preservar, então ele só solta o que o
gesto anterior fixou, remede, reorganiza e grava.

O menu abre para **cima** (`bottom: 100%`), e essa é a única diferença real de estilo contra
o menu do card: a toolbar mora colada na borda de baixo do viewport, e um menu descendo dali
sairia da tela.

Limite conhecido, que o controle novo não criou mas torna mais visível: com a sidebar
esticada perto do máximo o board sobra estreito, a toolbar inteira fica mais larga do que
ele e transborda por baixo da sidebar. Atinge os botões que já existiam tanto quanto o novo.

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

**Ctrl+Alt+clique** num card copia o XPath do elemento sob o cursor. Como tudo é mesma
origem, o cliente lê o elemento pelo `elementFromPoint` do iframe — convertendo as
coordenadas do board (escaladas por `scale`) de volta ao espaço interno do iframe. O XPath
usa `@id` quando existe, senão é absoluto com índices por irmão de mesma tag. Serve para
apontar ao agente de IA exatamente qual pedaço da tela deve mudar. **Alt sozinho** (sem
Ctrl), em vez de copiar, ativa o modo ponteiro e abre a caixinha de comentário do gesto
abaixo — os dois gestos disputam o mesmo clique, e é o `ctrlKey` que decide qual dos dois
roda. O `pointerdown` do pan devolve o clique ao escudo sempre que o modo já é ponteiro (com
o botão esquerdo), para nenhum dos dois gestos virar arrasto do board.

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

#### Fila de comentários endereçados à IA

No modo ponteiro, clicar num nó sem nenhum modificador abre uma caixinha de comentário
multi-linha ancorada nele — o `pointerdown` do pan chama `openCommentBoxAt` em vez de
seguir para o `click` do escudo. Enter (sem Shift) confirma: a caixinha fecha e vira um
balão sobre o nó; Shift+Enter só quebra linha. Reclicar um nó que já tem balão reabre a
caixinha pré-preenchida, editando o mesmo item — a chave é o XPath do nó dentro do
arquivo, então não há como duplicar item no mesmo lugar. Clicar fora da caixinha aberta
não a fecha nem descarta o rascunho: só o Enter (confirma) ou o badge "x" (remove)
mudam o item.

A fila vive em `commentQueue` (`state.js`), `Map<arquivo, Map<xpath, CommentItem>>`; quem
muta é só `inspect.js`, e tanto o board quanto o painel de chat se inscrevem em
`onQueueChange` para redesenhar a partir dela — nenhum dos dois guarda cópia própria.

**O redesenho não pode remontar a caixinha aberta.** Digitar nela muta o item e notifica a
fila, então o redesenho acontece a cada tecla; e tirar o `<textarea>` do DOM no meio disso
tira junto o foco e **cancela a composição do teclado** — uma tecla morta de acento (`´`
seguido de `a`) nunca fechava em `á`, e o cursor ainda voltava para o fim. Por isso a
caixinha aberta é guardada por chave e reaproveitada (`mountedBoxes`): ela só é
reposicionada, nunca reconstruída, e o layer remove apenas os nós que saíram da fila em
vez de trocar todos de uma vez. A ordem dentro do layer não importa — balão e caixinha são
posicionados em absoluto —, então o que entra depois pode ser anexado no fim. Uma caixinha
que saiu da tela fica desconectada do documento, e é esse o sinal de que o nó guardado não
vale mais. O
painel de chat espelha a fila numa lista "a enviar" (`chat.js`), com o mesmo botão "x" por
item; removê-lo em qualquer um dos dois lados chama o mesmo `removeCommentItem` e some dos
dois. Ao apertar Enviar com algo na fila, `serializeCommentQueue` (`utils.js`, função pura)
numera XPath e comentário de cada item numa única mensagem, que vai concatenada com o texto
do compositor (fila primeiro) numa única chamada a `chat.transport.send`. A partir daí a
fila entra em `sending`: os balões mostram carregamento e perdem o "x" até `chat.running`
voltar a `false`, quando o turno termina e eles somem da fila.

Se o iframe recarrega com itens pendentes, o `load` de `cards.js` chama `tryReanchor`, que
tenta `resolveXPath` (inverso de `computeXPath`, em `utils.js`) no documento novo para cada
item daquele arquivo. Achou, atualiza a âncora; não achou, o item vira `unreferenced` e sai
do card para uma bandeja fixa num canto do board (visível só quando há algum item nesse
estado) — arrastá-lo dali até um nó válido (mesma tela ou outra) recalcula o XPath e o
devolve a `confirmed`. Um item ainda `unreferenced` no momento do Enviar é descartado da
mensagem e sai da fila.

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
├─ scripts/
│  └─ build-install.sh  # check + npm pack + npm install -g da versão local
├─ eslint.config.js
├─ jsconfig.json
├─ README.md
├─ CLAUDE.md
├─ CONSTITUTION.md
└─ ARCHITECTURE.md
```

Nada de novo nasceu fora dessas pastas: a conversa é dois arquivos em `src/server/` e
três em `src/client/`. O único estado da ferramenta que vive fora do repositório e fora
da pasta observada é `~/.config/pinacoteca/config.json`.

O pacote publicado no npm chama-se `pinacoteca` e leva apenas `bin/`, `src/`, `README.md`
e `LICENSE` — o `files` do `package.json` não precisou mudar, porque o código novo é todo
`src/`. São **duas** dependências de runtime: `chokidar` e
`@anthropic-ai/claude-agent-sdk` (veja "Claude Agent SDK, não um loop de tools na mão").
`ws`, `eslint`, `typescript` e `@types/node` continuam só de desenvolvimento.

## Testes

`npm test` roda duas suítes, nesta ordem: `test/unit.mjs` e `test/e2e.mjs`.

**Unitário** (`node:test`) cobre função que decide algo sozinha: leitura de argumentos,
resolução de caminho seguro, política de arquivo proibido, árvore da sidebar, XPath,
validação da configuração (`mergeConfig`, `publicConfig`), e do lado do agente
`escapingPath`, `buildDiff`, `answeredInput`, `translateMessage`, `agentEnv` e
`hasCredential`, mais a validação das perguntas que chegam do modelo
(`normalizeQuestions`). São decisões que cabem em entrada e saída, e testar cada uma custa
milissegundos.

O `storage.js` do cliente é a exceção que precisou de um arranjo: ele lê e escreve
`localStorage`, que não existe no `node --test`. Em vez de extrair a decisão para um
módulo novo — ela é curta demais para pagar um arquivo —, o teste **instala um
`localStorage` de mentira**. São dois: um que guarda de verdade, para exercitar a
validação das preferências, o descarte de histórico estragado e o teto do histórico; e um
que **lança em toda operação**, porque o caminho tolerante a falha é justamente o que
segura o modo privado do navegador, e um caminho de erro que nunca é percorrido não está
testado.

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

Duas regras a mais entraram com a conversa, e as duas são para manter:

- **Nenhum teste chama a API da Anthropic.** O turno inteiro é exercitado com um `fetch`
  forjado na página: ele responde `/api/chat/message` com um corpo de stream escrito à
  mão, e o resto das requisições segue para o servidor de verdade. É o que permite testar
  o texto crescendo em streaming, o bloco de tool fechando em ok, o `done` destravando o
  botão Parar e o stream cortado no meio virando erro — sem chave, sem rede e sem custo.
  Suíte que gasta dinheiro é suíte que ninguém roda.
- **O e2e não toca no `~/.config` do usuário.** Antes de o servidor subir, a suíte aponta
  `XDG_CONFIG_HOME` para uma pasta temporária (removida na saída do processo) e o servidor
  a herda. Assim ela pode gravar uma chave falsa pela própria interface — que é como se
  exercita o `saveKey` — sem chegar perto da configuração real da máquina.

## Guardrails

O projeto não tem build, mas tem três verificações. `npm run check` roda as três.

| Comando | O que pega |
| --- | --- |
| `npm run lint` | `eslint .` — variável não usada, `var`, `==`, função que cresceu demais |
| `npm run typecheck` | `tsc` sobre o JSDoc (`jsconfig.json`, `checkJs` + `strict`) |
| `npm test` | unitário e ponta a ponta |
| `npm run build-install` | roda `check`, empacota com `npm pack` e instala o `.tgz` globalmente — testa a versão local mais recente do CLI como se publicada fosse |

O lint separa os globais do servidor dos do navegador, e o cliente não ganha global novo
à toa: `chat-client.js` usa `globalThis.TextDecoder` e `globalThis.AbortController`
justamente para não precisar declarar mais nada na lista do navegador.

`scripts/build-install.sh` fica fora de `src/` de propósito: não é código do produto,
é ferramenta de desenvolvimento. Ele para antes de gerar o `.tgz` se `check` falhar, e
o `trap` de limpeza remove o `.tgz` gerado tanto no sucesso quanto quando a instalação
global falha depois do empacotamento — nenhuma execução deixa artefato para trás no
repositório.

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

Essa superfície mudou de natureza com a conversa: o servidor local agora tem rotas que
**gastam dinheiro** e **escrevem arquivos**. O que segura isso:

| Guarda | O que ele impede |
| --- | --- |
| Só `127.0.0.1` | ninguém de fora da máquina alcança as rotas de conversa |
| `POST` só embaixo de `/api/chat/` | o resto do servidor continua somente leitura, e o roteador separa os dois na primeira linha |
| `cwd` preso à raiz observada | o agente parte de dentro da pasta — é o que orienta o Bash e os caminhos relativos |
| `escapingPath` | nega qualquer tool cujo caminho caia fora da raiz, **antes** da aprovação e **inclusive** com o automático ligado |
| Aprovação por edição | nenhuma escrita acontece sem um clique, enquanto o automático estiver desligado |
| Teto de corpo (`readJsonBody`) | um `POST` gigante não trava o processo |

E o que **fica por conta do usuário**, dito sem rodeio:

- **O gasto.** Cada mensagem é uma chamada paga com a chave dele. A ferramenta não tem
  orçamento, cota nem aviso de custo; o que ela oferece é o botão Parar, que interrompe o
  turno dos dois lados, e a interrupção automática quando a aba fecha.
- **A aprovação automática.** Ligando o toggle, ele aceita que o agente escreva na pasta
  observada sem perguntar. O cadeado da raiz continua valendo, o resto é escolha dele.
- **A pasta que ele aponta.** `pinacoteca` na raiz de um projeto de verdade dá ao agente
  a raiz daquele projeto para escrever. A pasta observada é a fronteira, então ela deve
  ser a pasta dos protótipos.
- **Qualquer outra página aberta no navegador.** As rotas não têm autenticação, como
  antes: quem roda código na mesma máquina alcança `localhost`. Isso já valia para
  `/preview/`; agora vale também para uma conversa.

## Como adicionar uma feature

1. **Confira o escopo.** Se não ajuda a *ver* o HTML que já está no disco, nem a chegar
   nele por um pedido explícito do usuário na conversa, pare aqui (veja "Fora de
   escopo").
2. **Ache o módulo dono.** Use a tabela do cliente ou a do servidor. Se a mudança couber
   em um módulo existente, ela vai lá — arquivo novo só quando o existente passou a fazer
   duas coisas.

   | O que você vai mexer | Onde |
   | --- | --- |
   | Um número (tamanho, prazo, limite) | `src/client/constants.js` |
   | Zoom, pan, posição dos cards | `src/client/view.js` |
   | O que o board lembra entre sessões | `src/client/storage.js` |
   | O que um card mostra ou mede | `src/client/cards.js` |
   | O tamanho de todas as telas de uma vez | `src/client/cards.js` (`applyGlobalSize`), `src/client/controls.js` (o menu da toolbar) |
   | Tela sobreposta: marcar ou separar | `src/client/view.js` (`refreshOverlaps`, `separateCollisions`), `src/client/utils.js` (a conta) |
   | Atalho de teclado, botão, gesto | `src/client/controls.js` |
   | Largura da sidebar | `src/client/controls.js` |
   | Destaque de elemento, XPath | `src/client/inspect.js` |
   | Fila de comentários endereçados à IA (caixinha, balão, reancoragem) | `src/client/inspect.js` (fila e gesto), `src/client/chat.js` (lista "a enviar" e envio) |
   | Uma rota nova | `src/server/index.js` |
   | Um tipo de evento novo do watcher | `src/server/watcher.js` **e** `src/client/sse.js` |
   | O que é ou não um protótipo | `src/server/screens.js` |
   | O painel da conversa: bolha, bloco, atalho do compositor | `src/client/chat.js` |
   | Falar com `/api/chat/`: requisição, stream, evento aplicado | `src/client/chat-client.js` |
   | Um tipo de evento novo da conversa | `src/server/agent.js` **e** `src/client/chat-client.js` (e a tabela deste arquivo) |
   | Uma aba nova na sidebar | `src/client/tabs.js` + `index.html` |
   | Uma preferência ou credencial do agente | `src/server/config.js` |
   | O que o agente pode fazer: tool, permissão, limite | `src/server/agent.js` |
   | Uma pergunta do agente ao usuário: bloco, opções, resposta, cancelamento | `src/server/agent.js` (`canUseTool` e `answeredInput`), `src/client/chat.js` (o bloco), `src/client/utils.js` (`normalizeQuestions`) |

3. **Guarde estado em `state.js`**, não num `let` novo no meio do módulo. A exceção é
   estado de um gesto em andamento, que morre com o gesto.
4. **Escreva o teste.** Comportamento visível no navegador vira um `check` em
   `test/e2e.mjs`; função pura vira um teste em `test/unit.mjs`.
5. **Atualize este arquivo** se a mudança alterou uma decisão ou a estrutura. Cite o nome
   da constante, não o valor dela.
6. **Rode `npm run check`.** Lint, tipos e testes precisam passar antes de a tarefa ser
   dada como concluída.

## Fora de escopo

**Ser um editor.** Não há campo de texto sobre o HTML, não há "salvar" no board, não há
menu de arquivo. Quem escreve na pasta é o agente, a pedido, em uma conversa — e o board
continua sendo só a janela para o resultado.

**Escrever fora da raiz observada.** Isso não é uma funcionalidade que falta, é uma
recusa: `escapingPath` nega, e essa negativa não tem toggle.

**Outro provedor de modelo.** Só Anthropic. Um seletor de provedor multiplicaria formatos
de credencial e de streaming por um ganho que este produto não persegue.

**Contas de usuário, deploy remoto, servir para fora de `127.0.0.1`.** A ferramenta é de
uma pessoa na máquina dela.

A régua continua a mesma, agora com uma ponta a mais: se não ajuda a *ver* o HTML que
está no disco, nem a *chegar* nele por um pedido explícito do usuário, não pertence a
este projeto.
