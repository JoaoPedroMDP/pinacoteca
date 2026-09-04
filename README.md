# Pinacoteca

Board para os protótipos HTML de uma pasta. Todas as telas lado a lado,
num canvas com zoom e pan, recarregando sozinhas quando os arquivos mudam.

```bash
npx pinacoteca
```

Feito para quem prototipa em HTML puro — sozinho ou com um agente gerando as telas — e
quer deixar o resultado aberto num segundo monitor sem precisar de reload manual.

## Uso

```bash
npx pinacoteca              # usa a pasta atual
npx pinacoteca ./telas      # ou uma pasta específica
```

Encontra todos os `.html` recursivamente, monta um card por tela e abre o navegador.

| Opção | Efeito |
| --- | --- |
| `--port N`, `-p N` | Porta do servidor (padrão `5173`; sobe para a próxima livre se ocupada) |
| `--no-open` | Não abre o navegador |
| `--help`, `-h` | Ajuda |

## Controles

| Ação | Como |
| --- | --- |
| Mover o board | Scroll, ou arrastar com o mouse |
| Zoom | `Ctrl` + scroll (amplia no ponto sob o cursor) |
| Enquadrar tudo | Tecla `0` |
| Zoom 100% | Tecla `1` |
| Interagir com um protótipo | Duplo clique no card |
| Sair do modo de interação | `Esc`, ou clicar fora |
| Centralizar uma tela | Clicar nela na barra lateral (aba `Telas`) |
| Reorganizar as telas | Arrastar o card pelo título |
| Voltar ao layout automático | Botão `Reorganizar` |

Por padrão os cards não recebem cliques — é isso que deixa o scroll e o arrasto
pertencerem ao board. O duplo clique libera um card por vez para você clicar em botões,
preencher formulários e navegar dentro do protótipo.

## Recarga automática

- **HTML alterado** — Apenas o card recarrega.
- **HTML criado ou removido** — o card e o item da barra lateral entram ou saem.
- **CSS, imagem, fonte ou script alterado** — recarregam apenas as telas que usam aquele
  arquivo.

Para saber quais telas um asset afeta, Pinacoteca não faz parsing do HTML: ela pergunta
a cada iframe quais recursos ele de fato carregou (`performance.getEntriesByType`). Isso
acerta `@import` encadeado, imagem referenciada de dentro do CSS e asset injetado por JS
em runtime — casos em que um parser erraria.

## Organização das telas

Arraste um card pelo título para colocá-lo onde quiser no canvas. A organização fica
salva e volta igual no próximo `npx pinacoteca` — por pasta, para cada projeto ter a sua.
O título nunca passa da largura do próprio card: em zoom bem afastado o nome trunca, e o
completo aparece no hover.

Telas não podem ficar uma em cima da outra: você até consegue largar um card sobre outro,
mas ele fica com **contorno vermelho** e essa posição não é salva. No próximo
carregamento a tela volta para o último lugar válido em que esteve.

O botão `Reorganizar` esquece tudo e devolve as telas ao layout automático em colunas.

## Conversa com o agente

A barra lateral tem duas abas: **Telas**, com a lista dos protótipos, e **Conversa**, onde
você pede mudanças a um agente que edita os arquivos da pasta observada. O board mostra o
resultado na hora, como faria com qualquer outro editor.

Para usar, cole uma chave de API da Anthropic no campo que aparece no topo da aba. Ela é
gravada em `~/.config/pinacoteca/config.json` (só o seu usuário lê o arquivo), nunca na
pasta dos protótipos e nunca no navegador. Numa máquina já autenticada no Claude Code, a
conversa funciona sem colar chave nenhuma.

O agente lê, cria e edita arquivos **dentro da pasta observada** e roda comandos a partir
dela. Fora dessa pasta ele não escreve, em nenhuma hipótese.

| Ação | Como |
| --- | --- |
| Enviar a mensagem | `Enter` (o botão `Enter envia` inverte para `Shift+Enter`) |
| Quebrar linha | `Shift+Enter` |
| Repetir uma mensagem anterior | Seta pra cima no campo de texto |
| Desfazer no campo de texto | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Interromper o agente | Botão `Parar` |
| Escolher modelo e esforço | Seletores embaixo do campo |

**Aprovação por edição.** Antes de cada escrita o agente para e mostra o diff: você
aprova ou rejeita. O botão `Auto` desliga a pergunta e deixa o agente escrever direto —
útil numa sequência longa de edições, e a fronteira da pasta continua valendo mesmo com
ele ligado.

> ⚠️ Conversar **consome créditos da API** da sua chave, a cada mensagem. Não há limite de
> gasto embutido: fechar a aba ou clicar em `Parar` interrompe o turno em andamento.

## Escopo

Ver o que está no disco é o trabalho principal, e essa parte **não escreve nada**: a
varredura só lê a pasta, o watcher só observa e o board só mostra. Escrever acontece em um
lugar só — quando você pede na aba Conversa, e o agente edita os arquivos da pasta
observada. Pinacoteca não é um editor: não há "salvar" no board.

O que a ferramenta guarda sozinha fica fora da pasta dos protótipos: a organização das
telas, o rascunho e o histórico da conversa vão para o `localStorage` do navegador; a
chave e as preferências do agente, para `~/.config/pinacoteca/config.json`.

O servidor escuta apenas em `127.0.0.1` e recusa qualquer caminho fora da pasta indicada,
além de arquivos e pastas ocultos (`.env`, `.git/`) e diretórios de build.

## Requisitos

Node.js 18 ou superior.

## Desenvolvimento

```bash
npm install
npm start -- ./alguma-pasta

npm run check      # lint + tipos + testes
npm run lint
npm run typecheck  # tsc sobre o JSDoc, sem build
npm test           # unitário + ponta a ponta
```

O teste unitário cobre as funções puras. O ponta a ponta sobe o servidor de verdade, abre
o Chrome em modo headless via CDP e verifica o comportamento real de recarga — inclusive
que uma mudança em CSS recarrega só as telas que o usam. Precisa do Chrome instalado; sem
ele, essa suíte se declara ignorada em vez de falhar.

Nenhum teste chama a API da Anthropic: o turno da conversa é exercitado com um stream
forjado, e a configuração vai para uma pasta temporária (`XDG_CONFIG_HOME`) em vez da sua.

O código e as decisões estão documentados em [ARCHITECTURE.md](ARCHITECTURE.md).

## Licença

MIT
