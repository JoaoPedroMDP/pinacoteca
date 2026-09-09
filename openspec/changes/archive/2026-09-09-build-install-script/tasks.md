## 1. Script

- [x] 1.1 Criar `scripts/build-install.sh` com `set -eu -o pipefail`, rodando
  `npm run check` primeiro; verificar que `chmod +x scripts/build-install.sh` foi
  aplicado e o arquivo existe
- [x] 1.2 No script, capturar a linha de saída de `npm pack` com o nome do `.tgz`
  gerado e instalar esse arquivo com `npm install -g "$PACKAGE_FILE"`; verificar
  rodando o script manualmente e conferindo que `pinacoteca --help` (global) reflete
  o código local atual
- [x] 1.3 Adicionar `trap 'rm -f "$PACKAGE_FILE"' EXIT` (ou equivalente) para apagar o
  `.tgz` gerado ao final, em sucesso ou falha; verificar que `git status` não mostra
  `.tgz` novo depois de uma execução completa
- [x] 1.4 Remover o `pinacoteca-0.9.0.tgz` esquecido na raiz do repo; verificar que o
  arquivo não existe mais

## 2. Integração com npm scripts

- [x] 2.1 Adicionar `"build-install": "bash scripts/build-install.sh"` em
  `package.json` → `scripts`; verificar que `npm run build-install` invoca o script

## 3. Verificação dos cenários da spec

- [x] 3.1 Simular falha de `npm run check` (ex.: quebrar um teste temporariamente) e
  confirmar que o script para antes de `npm pack`, sem gerar `.tgz` nem instalar nada;
  desfazer a quebra depois
- [x] 3.2 Simular falha de `npm install -g` (ex.: apontar para um `.tgz` inválido só
  para o teste manual) e confirmar que o script encerra com código de saída diferente
  de zero e ainda assim remove o `.tgz` gerado
- [x] 3.3 Rodar `npm run check` (o `check` real do projeto) e confirmar que passa com
  o script novo no lugar
