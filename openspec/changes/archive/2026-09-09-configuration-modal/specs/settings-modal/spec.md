## Purpose

Define a modal de Configurações — abertura, categorias (General, Models) e
a subcategoria Claude, que hospeda o campo de chave de API, o botão Salvar
e o aviso de sessão de ambiente detectada, sempre visíveis, sem fold.

## ADDED Requirements

### Requirement: Ícone de engrenagem no rodapé do sidebar abre a modal
O sistema SHALL exibir um ícone de engrenagem no rodapé do sidebar, visível
independentemente da aba ativa (Telas ou Conversa), que abre a modal de
Configurações ao ser ativado.

#### Scenario: Ativar o ícone com a aba Telas ativa
- **WHEN** o usuário ativa o ícone de engrenagem enquanto a aba Telas está
  selecionada
- **THEN** a modal de Configurações abre

#### Scenario: Ativar o ícone com a aba Conversa ativa
- **WHEN** o usuário ativa o ícone de engrenagem enquanto a aba Conversa
  está selecionada
- **THEN** a modal de Configurações abre

### Requirement: Modal fecha sem perder o restante do estado da aplicação
O sistema SHALL permitir fechar a modal de Configurações — por um controle
de fechar explícito, pela tecla Escape, ou clicando fora da modal — sem
afetar a aba ativa do sidebar, a conversa em andamento ou o estado do board.

#### Scenario: Fechar pelo controle explícito
- **WHEN** o usuário ativa o controle de fechar da modal
- **THEN** a modal fecha e a aba do sidebar ativa antes de abrir a modal
  permanece a mesma

#### Scenario: Fechar pela tecla Escape
- **WHEN** a modal está aberta e o usuário pressiona Escape
- **THEN** a modal fecha

### Requirement: Navegação por categorias General e Models
O sistema SHALL exibir, dentro da modal de Configurações, uma navegação com
as categorias General e Models. Ativar uma categoria SHALL mostrar seu
conteúdo e ocultar o das demais.

#### Scenario: Abrir a modal mostra uma categoria por padrão
- **WHEN** a modal de Configurações abre
- **THEN** exatamente uma categoria (General ou Models) está com seu
  conteúdo visível

#### Scenario: Trocar de categoria
- **WHEN** a categoria Models está com conteúdo visível e o usuário ativa
  General
- **THEN** o conteúdo de General fica visível e o de Models fica escondido

### Requirement: Categoria Models expande em subcategorias por modelo
O sistema SHALL exibir, dentro da categoria Models, uma subcategoria por
modelo suportado. Por ora, a única subcategoria é Claude.

#### Scenario: Categoria Models lista a subcategoria Claude
- **WHEN** a categoria Models está com conteúdo visível
- **THEN** a subcategoria Claude aparece na navegação de Models

### Requirement: Subcategoria Claude hospeda o campo de chave, sempre visível
O sistema SHALL exibir, na subcategoria Claude, o campo de chave de API da
Anthropic e o botão Salvar, sempre visíveis quando essa subcategoria está
selecionada — sem condição de fold ou revelação sob demanda associada a
sessão de ambiente detectada.

#### Scenario: Sem chave gravada e sem sessão de ambiente
- **WHEN** a subcategoria Claude está selecionada, não há chave gravada
  (`hasKey` é `false`) e não há sessão de ambiente (`hasAmbientCredential`
  é `false`)
- **THEN** o campo de chave e o botão Salvar estão visíveis

#### Scenario: Sem chave gravada e com sessão de ambiente
- **WHEN** a subcategoria Claude está selecionada, não há chave gravada e
  há sessão de ambiente detectada (`hasAmbientCredential` é `true`)
- **THEN** o campo de chave e o botão Salvar estão visíveis

#### Scenario: Com chave gravada
- **WHEN** a subcategoria Claude está selecionada e há chave gravada
  (`hasKey` é `true`)
- **THEN** o campo de chave e o botão Salvar continuam visíveis, permitindo
  substituir a chave gravada

### Requirement: Aviso de sessão de ambiente detectada na subcategoria Claude
Quando há sessão de ambiente detectada (`hasAmbientCredential` é `true`), o
sistema SHALL exibir, na subcategoria Claude, um aviso informando que a
conversa já funciona com essa sessão, com peso visual secundário — fonte
menor e cor mais opaca que o restante do painel —, sem exigir nenhuma ação
para revelar outra coisa.

#### Scenario: Sessão detectada exibe o aviso
- **WHEN** a subcategoria Claude está selecionada e `hasAmbientCredential`
  é `true`
- **THEN** o aviso de sessão aparece com estilo visualmente secundário

#### Scenario: Sem sessão detectada, sem aviso
- **WHEN** a subcategoria Claude está selecionada e `hasAmbientCredential`
  é `false`
- **THEN** o aviso de sessão não aparece

### Requirement: Categoria General existe com um placeholder
O sistema SHALL exibir a categoria General com um conteúdo de placeholder,
já que não há nenhuma configuração de propósito geral definida ainda.

#### Scenario: Selecionar General
- **WHEN** o usuário ativa a categoria General
- **THEN** o conteúdo exibido é um placeholder, sem nenhum controle de
  configuração funcional
