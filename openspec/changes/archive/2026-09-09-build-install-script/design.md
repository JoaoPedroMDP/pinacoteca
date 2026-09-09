## Context

Repositório não tem passo de build (ver ARCHITECTURE.md, "Guardrails": "O projeto não
tem build"). `npm run check` já existe e cobre lint, typecheck e teste. `package.json`
já declara `files` corretamente para `npm pack`. Não há script de empacotamento hoje —
o `.tgz` na raiz do repo é evidência de que isso foi feito manualmente, uma vez, e
esquecido. Ver proposal.md - Why.

## Goals / Non-Goals

**Goals:**
- Um comando único (`npm run build-install`) que sai com erro antes de instalar
  qualquer coisa quebrada.
- Nenhum artefato de empacotamento (`.tgz`) sobra no repositório depois da execução,
  em nenhum dos dois desfechos (sucesso ou falha na instalação).

**Non-Goals:**
- Não publica no npm (isso continua manual, via `npm publish`).
- Não bump de versão — o script empacota o `package.json` como está; subir a versão
  continua sendo decisão separada de quem desenvolve.
- Não precisa rodar em Windows: o projeto já assume ambiente Unix-like para
  desenvolvimento (scripts existentes usam `node --test` e chokidar/CDP em CI Linux).

## Decisions

**Shell script (`scripts/build-install.sh`), não um `.mjs`.** A tarefa é só orquestrar
três comandos de CLI (`npm run check`, `npm pack`, `npm install -g`) e limpar um
arquivo — não há lógica de decisão que precise de teste unitário. Um script Node
adicionaria only boilerplate de `child_process` para o que `set -e` e `&&` já resolvem
em shell. Fica fora de `src/` de propósito: não é código do produto, é ferramenta de
desenvolvimento (mesma razão de `test/harness.mjs` não estar em `src/`).

**`set -eu -o pipefail` mais `trap` para limpeza, não `&&` encadeado.** `npm pack`
imprime o nome do arquivo gerado (`pinacoteca-X.Y.Z.tgz`) na última linha da saída
padrão — o script captura essa linha para saber exatamente qual arquivo apagar, em vez
de assumir o nome a partir de `package.json` (evita divergência se o nome do pacote
mudar). O `trap 'rm -f "$PACKAGE_FILE"' EXIT` garante a limpeza tanto no caminho feliz
quanto quando `npm install -g` falha depois do `pack` ter succeeded — é o requirement
"Nenhum artefato de empacotamento permanece no repositório".

**Chamado via `npm run build-install`, não invocado direto.** Consistente com como o
projeto já expõe `check`, `lint`, `typecheck` — quem desenvolve não precisa saber o
caminho do script, só o nome do comando.

**Alternativa descartada: `npm link`.** Foi perguntada ao usuário e recusada: `link`
cria um symlink para o repo, então não exercita o pacote do jeito que `npm install -g`
+ `files` do `package.json` exercitam — um arquivo esquecido fora de `files` passaria
despercebido com `link` e apareceria só depois de publicado de verdade.

## Risks / Trade-offs

- **`npm install -g` pode pedir sudo/permissão dependendo de como o Node foi
  instalado na máquina de quem desenvolve** → fora de controle do script; a falha
  aparece com a mensagem de erro normal do npm, e o script encerra com código
  diferente de zero sem mascarar a causa.
- **Sobrescreve a instalação global existente de `pinacoteca` sem confirmar** → aceito
  de propósito (ver proposal.md - Impact): é exatamente o comportamento pedido, e é um
  script de desenvolvimento, não algo que roda sem intenção explícita de quem o chama.
