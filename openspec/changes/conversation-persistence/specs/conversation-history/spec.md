## Purpose

Guarda em disco, fora da pasta observada, o que aconteceu em cada conversa de uma raiz —
as mensagens, o raciocínio, as ferramentas e os erros — para que recarregar o board, ou
voltar dias depois, reencontre a conversa como ela estava e o agente continue de onde
parou.

## ADDED Requirements

### Requirement: Transcript persistido por raiz observada
O sistema SHALL gravar em disco, fora da pasta observada, os eventos de cada conversa,
agrupados pela raiz que o board está exibindo. Duas raízes diferentes SHALL ter conjuntos
de conversas independentes, e nenhum arquivo do transcript SHALL ser criado dentro da
pasta observada.

#### Scenario: Turno gravado enquanto acontece
- **WHEN** o usuário manda uma mensagem e o agente responde
- **THEN** a mensagem do usuário e os eventos da resposta ficam gravados na conversa
  daquela raiz, e nenhum arquivo novo aparece na pasta observada

#### Scenario: Raízes diferentes não se misturam
- **WHEN** o usuário abre a pinacoteca em uma pasta A, conversa, e depois abre em uma
  pasta B
- **THEN** a lista de conversas de B não mostra nenhuma conversa de A

#### Scenario: Permissões restritas
- **WHEN** o transcript é gravado pela primeira vez
- **THEN** o diretório e os arquivos criados ficam legíveis e graváveis apenas pelo dono

### Requirement: Índice de conversas de uma raiz
O sistema SHALL expor a lista das conversas gravadas para a raiz observada, cada uma com
um identificador estável, um título derivado da primeira mensagem do usuário e o instante
da última atividade. A lista SHALL vir ordenada da mais recente para a mais antiga.

#### Scenario: Conversa nova aparece na lista
- **WHEN** um turno termina em uma conversa que ainda não existia
- **THEN** a lista passa a incluir aquela conversa, com título tirado da primeira
  mensagem do usuário, no topo

#### Scenario: Conversa usada volta ao topo
- **WHEN** o usuário manda uma mensagem em uma conversa antiga
- **THEN** aquela conversa passa a ser a primeira da lista

#### Scenario: Sem conversa nenhuma
- **WHEN** a raiz nunca teve conversa
- **THEN** a lista vem vazia, sem erro

### Requirement: Recuperar uma conversa gravada
O sistema SHALL devolver, para um identificador de conversa, os eventos gravados dela na
ordem em que aconteceram, junto do identificador de sessão que permite ao agente
continuar aquela conversa. Identificador desconhecido SHALL resultar em erro de "não
encontrado", nunca em conversa vazia apresentada como válida.

#### Scenario: Conversa existente
- **WHEN** o board pede uma conversa que existe naquela raiz
- **THEN** recebe os eventos dela em ordem e o identificador da sessão

#### Scenario: Conversa inexistente
- **WHEN** o board pede um identificador que não existe naquela raiz
- **THEN** recebe uma resposta de "não encontrado"

### Requirement: Restaurar a conversa ao carregar o board
Ao carregar, o board SHALL redesenhar a conversa aberta a partir dos eventos gravados,
com as mensagens do usuário, as respostas do agente, os blocos de raciocínio, as
ferramentas e os erros na mesma ordem e com o mesmo aspecto do stream ao vivo. A conversa
restaurada SHALL ficar pronta para receber a próxima mensagem sem que o usuário precise
fazer mais nada.

#### Scenario: Recarregar preserva a conversa
- **WHEN** o usuário conversa com o agente e recarrega a página
- **THEN** o log volta com as mesmas mensagens, na mesma ordem, e o compositor aceita a
  próxima mensagem naquela mesma conversa

#### Scenario: Continuação mantém o contexto do agente
- **WHEN** o usuário manda uma mensagem logo depois de recarregar
- **THEN** o agente responde no contexto da conversa restaurada, e não como se fosse uma
  conversa nova

#### Scenario: Restauração não dispara turno
- **WHEN** o board termina de restaurar a conversa
- **THEN** nenhuma chamada ao modelo é feita e o botão Parar não aparece

### Requirement: Blocos que esperavam resposta voltam expirados
Pedido de permissão e pergunta do agente que ficaram sem resposta SHALL ser redesenhados
na restauração como expirados: visíveis no log, com a indicação de que o turno terminou
sem resposta, e sem nenhum controle que prometa responder. Clicar neles SHALL NOT enviar
nada ao servidor.

#### Scenario: Permissão pendente na hora do reload
- **WHEN** o usuário recarrega a página com um pedido de permissão aberto no log
- **THEN** o bloco reaparece marcado como expirado, sem os botões de aprovar e negar

#### Scenario: Pergunta pendente na hora do reload
- **WHEN** o usuário recarrega a página com uma pergunta do agente aberta no log
- **THEN** o bloco reaparece marcado como encerrado sem resposta, sem campos editáveis

### Requirement: Transcript estragado não derruba o board
Arquivo de transcript ausente, truncado ou com linha ilegível SHALL degradar a conversa,
nunca a carga do board: o que for legível SHALL ser mostrado e o que não for SHALL ser
descartado em silêncio no log da conversa.

#### Scenario: Linha ilegível no meio do transcript
- **WHEN** o transcript tem uma linha que não pode ser interpretada
- **THEN** o board carrega, mostra os eventos legíveis e ignora a linha ruim

#### Scenario: Índice ilegível
- **WHEN** o índice das conversas não pode ser interpretado
- **THEN** a aba de conversas abre sem quebrar, reconstruindo o que for possível a partir
  dos transcripts existentes

### Requirement: Apagar uma conversa
O sistema SHALL permitir apagar uma conversa gravada daquela raiz, removendo seu
transcript e sua entrada no índice. Apagar SHALL NOT tocar em nenhum arquivo da pasta
observada.

#### Scenario: Conversa some da lista
- **WHEN** o usuário apaga uma conversa
- **THEN** ela desaparece da lista e pedir aquele identificador passa a responder "não
  encontrado"

#### Scenario: Apagar a conversa aberta
- **WHEN** o usuário apaga a conversa que está aberta no Chat
- **THEN** o log é esvaziado e o board fica sem conversa aberta

### Requirement: Rotas de leitura e de escrita separadas
As rotas de conversa SHALL manter a divisão já existente do servidor: ler o índice e ler
uma conversa SHALL ser `GET`; apagar SHALL ser `POST` embaixo do prefixo de conversa.
Nenhuma rota fora desse prefixo SHALL aceitar método de escrita.

#### Scenario: Leitura por GET
- **WHEN** o board pede o índice ou uma conversa
- **THEN** a resposta vem de uma rota `GET`

#### Scenario: Apagar por POST no prefixo de conversa
- **WHEN** o board apaga uma conversa
- **THEN** a requisição é um `POST` embaixo do prefixo das rotas de conversa
