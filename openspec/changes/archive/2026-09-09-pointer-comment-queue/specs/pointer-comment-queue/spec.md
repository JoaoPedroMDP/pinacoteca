## Purpose

Permite ao usuário, em modo ponteiro, selecionar nós do protótipo e anexar
comentários endereçados ao agente de IA, acumulando-os numa fila local que é
enviada como uma única mensagem de chat quando o usuário decide.

## ADDED Requirements

### Requirement: Abrir caixinha de comentário ao clicar em modo ponteiro
Quando o modo ponteiro está ativo (via toolbar ou segurando Alt) e o usuário
clica com o botão esquerdo sobre um nó dentro de um iframe de protótipo, o
sistema SHALL abrir uma caixinha de comentário multi-linha ancorada naquele
nó, sem exigir nenhum modificador de teclado adicional.

#### Scenario: Clique simples em modo ponteiro abre a caixinha
- **WHEN** o usuário está em modo ponteiro e clica (botão esquerdo, sem
  modificadores) sobre um nó do protótipo
- **THEN** uma caixinha de comentário vazia e multi-linha abre ancorada
  naquele nó

#### Scenario: Clique fora do modo ponteiro não abre caixinha
- **WHEN** o usuário clica sobre um nó do protótipo enquanto o modo é "pan"
  (ponteiro inativo)
- **THEN** nenhuma caixinha de comentário abre

### Requirement: Copiar XPath exige Ctrl+Alt+clique
O gesto de copiar o XPath do elemento sob o cursor para a área de
transferência SHALL exigir Ctrl+Alt+clique. Alt+clique sozinho SHALL NOT
copiar o XPath — em vez disso, ativa o modo ponteiro e abre a caixinha de
comentário conforme o requisito acima.

#### Scenario: Ctrl+Alt+clique copia o XPath
- **WHEN** o usuário segura Ctrl e Alt e clica sobre um nó do protótipo
- **THEN** o XPath do nó é copiado para a área de transferência e nenhuma
  caixinha de comentário abre

#### Scenario: Alt+clique sem Ctrl abre a caixinha, não copia XPath
- **WHEN** o usuário segura apenas Alt e clica sobre um nó do protótipo
- **THEN** o modo ponteiro é ativado, a caixinha de comentário abre para
  aquele nó, e nada é copiado para a área de transferência

### Requirement: Confirmar comentário como balão editável
Ao apertar Enter dentro da caixinha de comentário (sem Shift), o sistema
SHALL fechar a caixinha e criar, ou atualizar, um balão fixado sobre o nó
correspondente, identificado pelo XPath do nó. Clicar novamente num nó que
já possui um balão SHALL reabrir a caixinha de comentário pré-preenchida com
o texto existente, em vez de criar um segundo item para o mesmo XPath.

#### Scenario: Enter confirma e cria o balão
- **WHEN** o usuário digita um comentário na caixinha e aperta Enter
- **THEN** a caixinha fecha e um balão aparece sobre o nó, contendo um
  resumo do comentário e um badge de remoção

#### Scenario: Shift+Enter quebra linha sem confirmar
- **WHEN** o usuário aperta Shift+Enter dentro da caixinha de comentário
- **THEN** uma nova linha é inserida no texto e a caixinha permanece aberta

#### Scenario: Reclique num nó já comentado edita o comentário existente
- **WHEN** o usuário clica em modo ponteiro sobre um nó cujo XPath já tem um
  balão na fila
- **THEN** a caixinha de comentário reabre com o texto já salvo daquele
  item, e confirmar com Enter atualiza o mesmo item em vez de criar outro

#### Scenario: Clicar fora da caixinha não descarta o rascunho
- **WHEN** a caixinha de comentário está aberta e o usuário clica em
  qualquer outro lugar do board sem apertar Enter ou o badge de remoção
- **THEN** a caixinha permanece aberta com o texto digitado preservado

### Requirement: Remover item da fila
Cada balão no board, e cada linha correspondente na lista "a enviar" do
painel de chat, SHALL exibir um badge "x". Acionar o badge em qualquer um
dos dois lugares SHALL remover aquele item da fila (balão e caixinha aberta
inclusos) em ambos os lugares, enquanto a fila não estiver travada por um
envio em andamento.

#### Scenario: Remover pelo balão no board
- **WHEN** o usuário aciona o "x" de um balão no board
- **THEN** o item some do board e da lista "a enviar" no chat

#### Scenario: Remover pela lista do chat
- **WHEN** o usuário aciona o "x" de um item na lista "a enviar" do painel
  de chat
- **THEN** o item correspondente some da lista e o balão some do board

### Requirement: Lista "a enviar" espelha a fila em tempo real
O painel de chat SHALL exibir uma lista "a enviar" contendo todos os itens
da fila, incluindo caixinhas ainda abertas (rascunhos, com o texto
atualizado em tempo real enquanto o usuário digita) e balões já confirmados.

#### Scenario: Rascunho aparece na lista enquanto o usuário digita
- **WHEN** uma caixinha de comentário está aberta e o usuário está digitando
  nela
- **THEN** a lista "a enviar" no painel de chat mostra esse item com o texto
  atualizado a cada alteração

### Requirement: Envio único da fila
Ao acionar o botão de enviar no painel de chat com pelo menos um item na
fila, o sistema SHALL serializar todos os itens da fila — balões
confirmados e caixinhas ainda abertas — como uma única mensagem de texto,
numerada, contendo o XPath e o comentário de cada item, e enviá-la como uma
única chamada ao transporte de chat. A partir desse momento a fila SHALL
ficar travada: nenhum item pode ser editado ou removido até a resposta do
agente terminar.

#### Scenario: Itens viram uma mensagem numerada
- **WHEN** o usuário tem dois ou mais itens na fila (confirmados ou
  rascunho) e aciona Enviar
- **THEN** uma única mensagem é enviada ao agente, numerando cada item com
  seu XPath e o texto do comentário correspondente

#### Scenario: Fila trava durante o envio
- **WHEN** o envio da fila foi disparado e a resposta do agente ainda não
  terminou
- **THEN** nenhum item da fila pode ser editado ou removido

### Requirement: Estado de carregamento e limpeza pós-envio
Ao disparar o envio, todo balão da fila SHALL entrar em estado de
carregamento. Quando o turno do agente terminar, todo balão em
carregamento SHALL ser removido do board e da lista "a enviar".

#### Scenario: Balões entram em carregamento ao enviar
- **WHEN** o usuário aciona Enviar com itens na fila
- **THEN** todos os balões da fila mudam visualmente para um estado de
  carregamento

#### Scenario: Balões somem quando o agente termina o turno
- **WHEN** o agente termina de responder ao turno disparado pelo envio da
  fila
- **THEN** todos os balões em carregamento, e seus itens na lista "a
  enviar", são removidos

### Requirement: Reancoragem após recarregar o protótipo
Quando o iframe de um protótipo recarrega enquanto há itens na fila para
aquele arquivo, o sistema SHALL tentar reencontrar automaticamente, no novo
documento, o nó de cada item pelo XPath salvo. Um item cujo nó não for
encontrado SHALL ficar sem referência a um nó do protótipo, exibido numa
bandeja fixa num canto do board — visível somente enquanto houver ao menos
um item nessa condição — até o usuário arrastá-lo sobre um nó válido para
reancorá-lo (recalculando seu XPath a partir do novo alvo).

#### Scenario: Reancoragem automática bem-sucedida
- **WHEN** o iframe recarrega e um XPath salvo ainda resolve para um nó no
  novo documento
- **THEN** o balão correspondente permanece na fila, agora ancorado nesse
  nó, sem intervenção do usuário

#### Scenario: Item sem referência quando o XPath não resolve mais
- **WHEN** o iframe recarrega e um XPath salvo não resolve para nenhum nó
  no novo documento
- **THEN** o item correspondente fica sem referência a um nó e aparece na
  bandeja fixa de pendentes de reancoragem, que passa a ficar visível

#### Scenario: Arrastar reancora um item sem referência
- **WHEN** o usuário arrasta um item sem referência da bandeja até um nó
  válido do protótipo
- **THEN** o item é reancorado nesse nó, seu XPath é recalculado, e ele sai
  da bandeja — que volta a ficar oculta se não sobrar nenhum outro item nela

#### Scenario: Item sem referência no envio é descartado
- **WHEN** o usuário aciona Enviar enquanto algum item da fila ainda está
  sem referência a um nó
- **THEN** esse item é descartado da mensagem enviada e removido da fila

#### Scenario: Bandeja fica oculta sem itens sem referência
- **WHEN** não há nenhum item sem referência a um nó na fila (nenhum nunca
  existiu, ou o último foi reancorado, removido, ou descartado no envio)
- **THEN** a bandeja de pendentes de reancoragem não aparece no board

### Requirement: Caixinha e balão têm tamanho fixo, independente do zoom
A caixinha de comentário e o balão SHALL manter o mesmo tamanho na tela em
qualquer nível de zoom do board, da mesma forma que o título de cada card já
se comporta. Apenas a posição da caixinha/balão SHALL acompanhar o pan/zoom
do canvas — não sua escala.

#### Scenario: Zoom out não encolhe a caixinha nem o balão
- **WHEN** o usuário dá zoom out no board com uma caixinha ou balão aberto
- **THEN** a caixinha/balão mantém o mesmo tamanho em pixels de tela, só
  mudando de posição para acompanhar o nó ancorado

#### Scenario: Zoom in não amplia a caixinha nem o balão
- **WHEN** o usuário dá zoom in no board com uma caixinha ou balão aberto
- **THEN** a caixinha/balão mantém o mesmo tamanho em pixels de tela, só
  mudando de posição para acompanhar o nó ancorado

### Requirement: Caixinha e balão não são cortados pela borda da tela
A caixinha de comentário e o balão SHALL ser desenhados no espaço do canvas,
não presos ao recorte (`overflow: hidden`) do frame do card. Um item ancorado
perto da borda de uma tela SHALL permanecer inteiramente visível, mesmo
quando isso significa desenhar por cima da área do board fora da tela.

#### Scenario: Item perto da borda da tela não é cortado
- **WHEN** o nó comentado fica perto da borda de uma tela e a caixinha ou
  balão correspondente extrapola os limites do card
- **THEN** a caixinha/balão aparece inteira, sem ser cortada pelo contorno do
  card
