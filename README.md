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
| Centralizar uma tela | Clicar nela na barra lateral |

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

## Escopo

É **somente leitura**. Pinacoteca não edita, não cria e não apaga arquivo nenhum. O
único trabalho dela é mostrar o que já está no disco, sempre atualizado.

O servidor escuta apenas em `127.0.0.1` e recusa qualquer caminho fora da pasta indicada,
além de arquivos e pastas ocultos (`.env`, `.git/`) e diretórios de build.

## Requisitos

Node.js 18 ou superior.

## Desenvolvimento

```bash
npm install
npm start -- ./alguma-pasta
npm test
```

A suíte sobe o servidor de verdade, abre o Chrome em modo headless via CDP e verifica o
comportamento real de recarga — inclusive que uma mudança em CSS recarrega só as telas
que o usam. Precisa do Chrome instalado.

## Licença

MIT
