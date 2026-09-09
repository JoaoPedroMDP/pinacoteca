## Purpose

Define o que o painel de configuração da aba Conversa mostra — campo de
chave, botão Salvar e aviso de sessão de ambiente — e em que condições cada
peça fica visível, escondida ou revelada sob demanda.

## ADDED Requirements

### Requirement: Painel escondido por inteiro quando há chave gravada
Quando o servidor reporta chave gravada (`hasKey`), o sistema SHALL esconder
o painel de configuração inteiro — campo de chave, botão Salvar e aviso de
sessão —, porque não há nada a decidir ali.

#### Scenario: Chave gravada esconde o painel
- **WHEN** `hasKey` é `true`
- **THEN** o painel de configuração (`chat-settings`) fica escondido

### Requirement: Sem chave e sem sessão de ambiente, campo de chave sempre visível
Quando não há chave gravada e não há sessão de ambiente detectada
(`hasAmbientCredential` é `false`), o sistema SHALL manter o campo de chave e
o botão Salvar visíveis por padrão, sem exigir nenhuma ação do usuário —
é o único caminho disponível para conversar.

#### Scenario: Sem chave, sem sessão detectada
- **WHEN** `hasKey` é `false` e `hasAmbientCredential` é `false`
- **THEN** o campo de chave e o botão Salvar ficam visíveis
- **THEN** o aviso de sessão fica escondido

### Requirement: Sem chave e com sessão de ambiente, campo de chave escondido por padrão
Quando não há chave gravada mas há sessão de ambiente detectada
(`hasAmbientCredential` é `true`), o sistema SHALL esconder o campo de chave
e o botão Salvar por padrão — a conversa já funciona pela sessão, e o campo
deixa de competir por atenção com um caminho que já é suficiente.

#### Scenario: Sem chave, com sessão detectada, estado inicial
- **WHEN** `hasKey` é `false` e `hasAmbientCredential` passa a `true`
- **THEN** o campo de chave e o botão Salvar ficam escondidos por padrão

### Requirement: Aviso de sessão detectada revela o campo de chave sob demanda
Quando o campo de chave está escondido por causa de sessão de ambiente
detectada, o sistema SHALL oferecer um controle discreto associado ao aviso
de sessão que, ao ser ativado, revela o campo de chave e o botão Salvar —
preservando a possibilidade de o usuário trocar a sessão por crédito de API
sem exigir edição manual de arquivo de configuração.

#### Scenario: Ativar o controle revela o campo
- **WHEN** o campo de chave está escondido por sessão detectada e o usuário
  ativa o controle do aviso
- **THEN** o campo de chave e o botão Salvar ficam visíveis

#### Scenario: Sessão deixa de existir enquanto o campo está revelado
- **WHEN** o campo foi revelado pelo controle e `hasAmbientCredential` passa
  a `false` (sem chave gravada)
- **THEN** o campo de chave e o botão Salvar continuam visíveis (é o único
  caminho disponível novamente) e o aviso de sessão fica escondido

### Requirement: Aviso de sessão detectada tem peso visual secundário
O sistema SHALL exibir o aviso de sessão detectada abaixo do campo de chave
(quando o campo está visível) e com estilo visualmente secundário — fonte
menor e cor mais opaca que o restante do texto do painel — para não competir
com o campo nem com o botão Salvar.

#### Scenario: Aviso abaixo do campo revelado
- **WHEN** o campo de chave está visível (revelado pelo controle) e há
  sessão de ambiente detectada
- **THEN** o aviso de sessão aparece posicionado abaixo do campo de chave e
  do botão Salvar, com estilo visualmente secundário
