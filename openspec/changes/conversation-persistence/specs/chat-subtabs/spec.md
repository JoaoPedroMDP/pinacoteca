## Purpose

Dá à aba Conversa dois estados explícitos — escolher em qual conversa trabalhar e
trabalhar nela — por meio de subabas, para que a existência de várias conversas por pasta
tenha um lugar visível na interface em vez de ficar escondida atrás de um único log.

## ADDED Requirements

### Requirement: Subabas Conversas e Chat
A aba Conversa SHALL conter duas subabas, `Conversas` e `Chat`, com exatamente um painel
visível por vez. A subaba `Conversas` SHALL mostrar a lista das conversas da raiz
observada; a subaba `Chat` SHALL mostrar o log, a fila de comentários e o compositor.
Trocar de subaba SHALL NOT interromper nenhum turno em andamento nem descartar o
rascunho do compositor.

#### Scenario: Alternar entre as subabas
- **WHEN** o usuário clica em `Conversas` e depois em `Chat`
- **THEN** só o painel correspondente fica visível a cada clique

#### Scenario: Rascunho sobrevive à troca
- **WHEN** o usuário escreve no compositor, vai para `Conversas` e volta para `Chat`
- **THEN** o texto continua no compositor

#### Scenario: Turno segue rodando na outra subaba
- **WHEN** o usuário vai para `Conversas` com um turno em andamento
- **THEN** o turno continua, e ao voltar para `Chat` a resposta está lá

### Requirement: Subaba inicial ao carregar
Ao carregar o board, a aba Conversa SHALL abrir em `Chat` quando existe uma conversa
aberta a restaurar, e em `Conversas` quando não existe nenhuma.

#### Scenario: Havia conversa aberta
- **WHEN** o usuário recarrega a página depois de conversar
- **THEN** a aba Conversa abre na subaba `Chat`, com a conversa restaurada

#### Scenario: Primeira vez naquela pasta
- **WHEN** o usuário abre a pinacoteca numa pasta que nunca teve conversa
- **THEN** a aba Conversa abre na subaba `Conversas`

### Requirement: Lista de conversas
A subaba `Conversas` SHALL listar as conversas daquela raiz, da mais recente para a mais
antiga, mostrando para cada uma o título e quando foi usada pela última vez, e SHALL
marcar qual delas está aberta. Sem conversa nenhuma, SHALL mostrar um estado vazio que
explique como começar.

#### Scenario: Conversas listadas em ordem
- **WHEN** o usuário abre a subaba `Conversas` com mais de uma conversa gravada
- **THEN** elas aparecem da mais recente para a mais antiga, com título e data

#### Scenario: Estado vazio
- **WHEN** a raiz não tem conversa nenhuma
- **THEN** a lista mostra um aviso de que ainda não há conversas, com o botão de criar uma

### Requirement: Abrir uma conversa da lista
Selecionar uma conversa na lista SHALL substituir o conteúdo do log pelo transcript dela,
apontar o compositor para essa conversa e trocar para a subaba `Chat`. O log SHALL NOT
misturar mensagens de duas conversas.

#### Scenario: Trocar de conversa
- **WHEN** o usuário seleciona uma conversa diferente da que está aberta
- **THEN** o board vai para `Chat` mostrando só as mensagens da conversa escolhida

#### Scenario: Próxima mensagem vai para a conversa aberta
- **WHEN** o usuário manda uma mensagem logo depois de trocar de conversa
- **THEN** ela entra na conversa escolhida, e o agente responde no contexto dela

### Requirement: Criar conversa nova
A subaba `Conversas` SHALL oferecer criar uma conversa nova, que abre o `Chat` com o log
vazio e sem sessão. A conversa nova SHALL passar a existir na lista quando a primeira
mensagem for enviada, não antes.

#### Scenario: Começar do zero
- **WHEN** o usuário clica em criar conversa nova
- **THEN** a subaba `Chat` abre com o log vazio e o compositor pronto

#### Scenario: Conversa vazia não polui a lista
- **WHEN** o usuário cria uma conversa nova e volta para `Conversas` sem mandar nada
- **THEN** nenhuma conversa nova aparece na lista

### Requirement: Apagar conversa pela lista
Cada item da lista SHALL oferecer apagar aquela conversa, com confirmação antes. Depois
de confirmada, a conversa SHALL sumir da lista; se era a conversa aberta, o `Chat` SHALL
ficar vazio e sem sessão.

#### Scenario: Apagar com confirmação
- **WHEN** o usuário aciona apagar em uma conversa e confirma
- **THEN** ela some da lista

#### Scenario: Desistir de apagar
- **WHEN** o usuário aciona apagar e cancela a confirmação
- **THEN** a conversa continua na lista, intacta

### Requirement: Troca de conversa bloqueada durante um turno
Enquanto um turno estiver em andamento, abrir outra conversa, criar uma nova e apagar
qualquer uma SHALL ficar indisponível, com a interface dizendo que é preciso parar o
turno antes. A subaba `Conversas` SHALL continuar acessível para leitura.

#### Scenario: Lista desabilitada com turno rodando
- **WHEN** o usuário abre `Conversas` enquanto o agente responde
- **THEN** vê a lista, mas não consegue abrir, criar nem apagar conversa, e lê o aviso de
  parar o turno antes

#### Scenario: Liberado quando o turno termina
- **WHEN** o turno termina, por resposta ou pelo botão Parar
- **THEN** os itens da lista voltam a responder
