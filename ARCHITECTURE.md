# ARCHITECTURE.md

## Produto

**pinacoteca** — visualizador de protótipos HTML. Roda em uma pasta, encontra todos os
`.html` dela e mostra todos lado a lado num board com zoom e pan.

É **somente leitura**. Não edita, não salva, não gera arquivo. O único trabalho da
ferramenta é mostrar o estado atual do disco, sempre atualizado.

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
recarregamento em vez de precisar ser invalidado. Uma segunda passada ~1,2s depois pega
recursos que chegam tarde.

Limite conhecido: se uma tela referencia um arquivo que ainda não existe, o recurso só
entra no map se o navegador registrar a tentativa falha. Quando não registra, aquela tela
fica de fora até o próximo recarregamento.

### Sem framework

Sem React, sem bundler. O board é DOM direto, CSS `transform` para zoom/pan e um punhado
de listeners. A superfície do produto é pequena demais para pagar o custo de build.

## Componentes

### CLI (`bin/pinacoteca.js`)

Resolve os argumentos e entrega tudo para `startServer`. A pasta é opcional e o padrão é
o diretório atual — o caso comum é entrar na pasta dos protótipos e rodar `pinacoteca`
sem mais nada.

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

| Responsabilidade | Detalhe |
| --- | --- |
| Descobrir arquivos | Varre a pasta recursivamente atrás de `.html`, pulando pastas ocultas e de build |
| Observar mudanças | `chokidar` sobre a pasta, **todos os arquivos** — HTML vira tela, o resto vira asset em potencial |
| Servir os protótipos | `GET /preview/*` devolve o arquivo cru — HTML e também os assets que ele referencia — com `Cache-Control: no-store` |
| Servir o board | `GET /` devolve a aplicação; `GET /app/*` devolve o CSS e o JS dela |
| Listar telas | `GET /api/screens` devolve os arquivos encontrados |
| Empurrar eventos | `GET /events` é o stream SSE |

Eventos SSE emitidos:

```
{ "type": "change", "file": "login.html" }   // conteúdo mudou → recarrega só esse iframe
{ "type": "add",    "file": "signup.html" }  // arquivo novo  → insere card e item na sidebar
{ "type": "unlink", "file": "old.html" }     // removido      → remove card e item da sidebar
{ "type": "asset",  "file": "css/base.css" } // asset mudou   → recarrega as telas que usam esse arquivo
```

O servidor não sabe quais telas um asset afeta, e não tenta descobrir: ele só avisa que
o arquivo mudou. Quem cruza isso com o map de recursos é o cliente.

Mudanças de arquivo chegam em rajada (um salvamento pode disparar vários eventos de
`fs`). Duas defesas: o `awaitWriteFinish` do chokidar espera o arquivo parar de crescer,
para o board nunca carregar um HTML escrito pela metade, e um debounce de 80ms agrupa os
eventos por arquivo antes de mandá-los ao cliente.

### Cliente (board)

- **Sidebar** — lista as telas. Clicar centraliza o board naquele card.
- **Board** — plano com zoom e pan. Cada tela é um card com título e um `iframe` dentro.
- **Cliente SSE** — assina `/events` e aplica os eventos no DOM.
- **Map de assets** — `tela → recursos carregados`, lido de cada iframe a cada `load`.
  Um evento `asset` recarrega apenas as telas cujo conjunto contém aquele arquivo.

Cada `iframe` tem largura fixa (1280px, referência de desktop) para que os cards tenham
tamanho previsível no board. A altura **não** é fixa: no `load` de cada iframe o conteúdo
real é medido (`scrollHeight`, possível porque tudo é mesma origem) e o card se ajusta,
limitado a 400–3200px. Sem isso, uma landing page longa apareceria cortada dentro de uma
janelinha, que é o oposto do que se quer ver num board.

O zoom é aplicado via `transform: scale()` no container do board, não redimensionando os
iframes — assim o conteúdo não sofre reflow ao dar zoom, e o resultado é o comportamento
de canvas que se espera.

Os cards são distribuídos em colunas (`⌈√n⌉`), cada um indo para a coluna mais curta no
momento. O layout é recalculado quando um card muda de altura ou quando uma tela entra ou
sai.

#### Escudo sobre o iframe

Um iframe engole scroll e arrasto: sem tratamento, passar o mouse sobre um card mataria o
pan e o zoom do board. Por isso cada card tem uma `div` transparente por cima, e o board
fica com todos os eventos.

Duplo clique num card libera aquele card específico — o escudo some e o protótipo passa a
receber cliques, para preencher formulário e navegar. `Esc` ou um clique fora devolve o
controle ao board. Um card interativo por vez.

#### Recarregamento

`reloadCard` guarda o `scrollY` interno do iframe antes de trocar o `src` e o restaura no
`load` seguinte. Sem isso, uma edição no rodapé de uma página longa jogaria a tela de
volta para o topo a cada salvamento.

## Estrutura de pastas

```
pinacoteca/
├─ bin/          # entrypoint da CLI
├─ src/
│  ├─ server/    # servidor HTTP, rotas, SSE, file watcher
│  └─ client/    # board: HTML, CSS e JS servidos ao navegador
├─ test/         # suite ponta a ponta (Chrome headless via CDP)
├─ README.md
├─ CLAUDE.md
├─ CONSTITUTION.md
└─ ARCHITECTURE.md
```

O pacote publicado no npm chama-se `pinacoteca` e leva apenas `bin/`, `src/`, `README.md`
e `LICENSE`. Única dependência de runtime: `chokidar`. `ws` é dependência só de teste.

## Testes

`test/e2e.mjs`, rodado com `npm test`. Não há teste unitário: quase todo o valor da
ferramenta está em comportamento que só existe com um navegador de verdade no meio —
o iframe recarregar sozinho, o map de assets ser lido do `performance`, o board montar
os cards. Mockar isso testaria a maquete, não o produto.

A suíte sobe o servidor real numa pasta temporária, abre o Chrome headless e o dirige
pelo CDP, verificando o comportamento observável: cards montados, recarga por CSS
compartilhado, recarga pela cadeia de `@import`, criação e remoção de tela, estado da
conexão SSE e os acessos que devem ser recusados. Sem Chrome instalado, a suíte se
declara ignorada em vez de falhar.

## Superfície exposta

O servidor escuta só em `127.0.0.1`. Como a ferramenta é apontada para pastas arbitrárias,
`/preview/` recusa três coisas: caminhos que escapam da raiz, arquivos e pastas ocultos
(`.env`, `.git/`) e diretórios de build. Sem isso, rodar na raiz de um projeto exporia
segredos a qualquer página aberta no mesmo navegador.

## Fora de escopo

Editar arquivos, criar arquivos, contas de usuário, deploy remoto. Se uma 
funcionalidade não ajuda a *ver* o HTML que já está no disco, ela não pertence 
a este projeto.
