## Why

Testar a versão local mais recente do CLI hoje é manual: rodar `npm run check`,
`npm pack`, achar o `.tgz` gerado (há um `pinacoteca-0.9.0.tgz` esquecido na raiz do
repo, prova de que já foi feito à mão) e `npm install -g` nele. Passo a passo fácil de
esquecer ou fazer fora de ordem — instalar um `.tgz` de uma versão que não passou no
lint/teste, por exemplo. Um script único remove esse atrito e evita instalar código
quebrado.

## What Changes

- Novo script (`npm run build-install` ou script standalone em `scripts/`) que, em
  sequência: roda `npm run check` (lint + typecheck + test), empacota o projeto com
  `npm pack` e instala o `.tgz` gerado globalmente com `npm install -g`.
- Falha em qualquer etapa (check, pack ou install) interrompe o script antes da etapa
  seguinte — nunca instala um pacote que não passou no check, nem deixa o `.tgz` velho
  na raiz.
- O `.tgz` gerado é limpo do diretório do projeto após a instalação (sucesso ou falha),
  para não repetir o esquecimento do `pinacoteca-0.9.0.tgz` já presente no repo.

## Capabilities

### New Capabilities
- `build-install-script`: script de desenvolvimento que valida (`npm run check`),
  empacota (`npm pack`) e instala globalmente (`npm install -g`) a versão local mais
  recente do CLI `pinacoteca`.

### Modified Capabilities
(nenhuma — não há mudança de comportamento observável do produto, só uma ferramenta de
desenvolvimento nova)

## Impact

- Arquivo novo: script de build/install (local em `scripts/`, chamado por um novo
  script `npm run` no `package.json`).
- `package.json`: novo script em `"scripts"`.
- Sem mudança em `src/` nem no comportamento do board, do servidor ou do CLI em
  produção — afeta só o fluxo de desenvolvimento local.
- Efeito colateral assumido: instala/sobrescreve o pacote `pinacoteca` global do
  usuário que rodar o script.
