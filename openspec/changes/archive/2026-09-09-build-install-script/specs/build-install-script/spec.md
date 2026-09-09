## Purpose

Automatiza validar, empacotar e instalar globalmente a versão local mais recente do
CLI `pinacoteca`, para quem desenvolve testar o pacote real sem repetir os passos à
mão nem instalar código que não passou no `check`.

## ADDED Requirements

### Requirement: Validação antes de empacotar
O sistema SHALL rodar `npm run check` (lint, typecheck e testes) antes de gerar
qualquer pacote. Uma falha em `check` SHALL interromper o processo sem gerar nem
instalar um pacote.

#### Scenario: Check falha
- **WHEN** `npm run check` termina com código de saída diferente de zero
- **THEN** o processo para imediatamente
- **THEN** nenhum arquivo `.tgz` é gerado
- **THEN** nenhuma instalação global é tentada

#### Scenario: Check passa
- **WHEN** `npm run check` termina com código de saída zero
- **THEN** o processo segue para o empacotamento

### Requirement: Empacotamento reflete o pacote publicável
Depois do check passar, o sistema SHALL gerar o pacote com `npm pack`, produzindo o
mesmo conteúdo que seria publicado no npm (respeitando o campo `files` do
`package.json`).

#### Scenario: Pacote gerado a partir do código atual
- **WHEN** o check passou
- **THEN** o sistema roda `npm pack` na raiz do projeto
- **THEN** um arquivo `.tgz` correspondente à versão atual de `package.json` é criado

### Requirement: Instalação global do pacote gerado
Depois do empacotamento, o sistema SHALL instalar o `.tgz` gerado globalmente via
`npm install -g`, substituindo qualquer instalação global anterior do pacote
`pinacoteca`.

#### Scenario: Instalação bem-sucedida
- **WHEN** o `.tgz` foi gerado com sucesso
- **THEN** o sistema roda `npm install -g` apontando para esse arquivo
- **THEN** o comando `pinacoteca` global passa a refletir a versão recém-empacotada

#### Scenario: Instalação falha
- **WHEN** `npm install -g` termina com código de saída diferente de zero
- **THEN** o sistema reporta a falha e encerra com código de saída diferente de zero

### Requirement: Nenhum artefato de empacotamento permanece no repositório
Ao final da execução — com sucesso ou com falha na etapa de instalação —, o sistema
SHALL remover o arquivo `.tgz` gerado do diretório do projeto.

#### Scenario: Limpeza após sucesso
- **WHEN** a instalação global termina com sucesso
- **THEN** o arquivo `.tgz` gerado nesta execução não permanece na raiz do projeto

#### Scenario: Limpeza após falha na instalação
- **WHEN** o empacotamento teve sucesso mas a instalação global falha
- **THEN** o arquivo `.tgz` gerado nesta execução ainda assim não permanece na raiz
  do projeto
