## MODIFIED Requirements

### Requirement: O board se reorganiza em volta do novo tamanho
Depois de um gesto no menu global — preset ou `Automatico` — o sistema SHALL
reposicionar as telas de modo que **nenhuma** fique sobreposta a outra por efeito da
mudança de tamanho, e SHALL gravar a organização resultante como o estado salvo do
board. Isso SHALL valer em todo gesto global, e não apenas no primeiro da sessão.

O sistema SHALL preservar a posição das telas que o **usuário** colocou onde estão —
por arrasto de título ou por posição salva de uma sessão anterior. Ter sido fixada por
um gesto global anterior NÃO conta como posição escolhida pelo usuário: essas telas
SHALL voltar a seguir o layout automático no gesto seguinte.

Quando ainda assim duas telas de posição escolhida pelo usuário colidirem por efeito
do crescimento, o sistema SHALL separá-las, deslocando o mínimo necessário, em vez de
deixá-las sobrepostas.

#### Scenario: Layout acomoda o novo tamanho
- **WHEN** o usuário aplica um preset global que aumenta as telas
- **THEN** as telas que não foram fixadas pelo usuário se reacomodam sem ficar
  sobrepostas

#### Scenario: A organização sobrevive à recarga
- **WHEN** o usuário aplica um preset global e em seguida recarrega o board
- **THEN** as telas reaparecem no tamanho e na posição em que estavam antes da
  recarga

#### Scenario: Trocar de preset global não sobrepõe nada
- **WHEN** o usuário aplica o preset `Mobile` a todas as telas e em seguida aplica
  `Desktop`
- **THEN** nenhuma tela do board fica sobreposta a outra
- **AND** todas as telas ficam com o tamanho do preset `Desktop` gravado

#### Scenario: Gesto global repetido preserva o arrasto do usuário
- **WHEN** o usuário arrasta uma tela para um ponto distante, aplica um preset global
  e em seguida aplica outro preset global
- **THEN** essa tela continua no ponto para onde o usuário a arrastou

#### Scenario: Telas arrastadas que colidiriam ao crescer são separadas
- **WHEN** o usuário arrasta duas telas para perto uma da outra e depois aplica um
  preset global que as faz crescer o bastante para uma invadir a outra
- **THEN** o board as separa e nenhuma das duas fica sobreposta

### Requirement: O tamanho de cada tela continua ajustável depois do global
O sistema SHALL manter o menu de tamanho de cada tela e o arrasto de borda
plenamente utilizáveis enquanto um preset global estiver ativo. Um ajuste individual
SHALL valer sobre o tamanho global para aquela tela, sem alterar as demais e sem
desfazer o preset global para as telas que ainda vierem.

Um ajuste individual — de tamanho ou de posição — SHALL passar a contar como escolha
do usuário para aquela tela, que a partir daí não é mais reacomodada pelos gestos
globais seguintes.

#### Scenario: Ajustar uma tela sozinha depois do global
- **WHEN** todas as telas estão no preset `Mobile` e o usuário escolhe `Desktop` no
  menu de tamanho de uma delas
- **THEN** apenas essa tela passa ao tamanho `Desktop`
- **AND** as demais continuam em `Mobile`

#### Scenario: Arrastar a borda de uma tela depois do global
- **WHEN** todas as telas estão num preset global e o usuário arrasta a borda de uma
  delas
- **THEN** essa tela assume o tamanho do arrasto e as demais não mudam

#### Scenario: Tela nova continua herdando o global depois de um ajuste individual
- **WHEN** o usuário aplicou `Mobile` global, ajustou uma tela individualmente e um
  arquivo `.html` novo aparece na pasta observada
- **THEN** a tela nova aparece no tamanho `Mobile`

## ADDED Requirements

### Requirement: "Reorganizar" devolve o board ao automático depois de um gesto global
O sistema SHALL fazer com que o controle "Reorganizar" volte a tratar como automáticas
todas as telas fixadas por um gesto global, do mesmo modo que já faz com as fixadas
pelo usuário.

#### Scenario: Reorganizar depois de um preset global
- **WHEN** o usuário aplica um preset global e em seguida aciona "Reorganizar"
- **THEN** todas as telas voltam ao layout automático e ao tamanho do próprio
  conteúdo
