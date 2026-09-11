# Global Screen Size Specification

## Purpose

Define o controle de tamanho global da toolbar: um único gesto que coloca todas as
telas do board no mesmo tamanho de referência (Mobile, Tablet, Laptop, Desktop) ou
devolve todas ao tamanho do próprio conteúdo, sem tirar de cada tela a liberdade de
ser ajustada sozinha depois.

## Requirements

### Requirement: Controle de tamanho global na toolbar
O sistema SHALL exibir na toolbar do board, à esquerda dos controles de zoom, um
controle de tamanho que abre um menu com as opções `Automatico`, `Mobile`, `Tablet`,
`Laptop` e `Desktop` — as mesmas opções, nos mesmos tamanhos, que o menu de tamanho
de uma tela individual oferece.

#### Scenario: Abrir o menu global
- **WHEN** o usuário ativa o controle de tamanho da toolbar
- **THEN** o menu abre listando `Automatico`, `Mobile`, `Tablet`, `Laptop` e
  `Desktop`

#### Scenario: Fechar o menu ativando o controle de novo
- **WHEN** o menu global está aberto e o usuário ativa o controle de tamanho da
  toolbar
- **THEN** o menu fecha e nenhum tamanho é aplicado

#### Scenario: Fechar o menu clicando fora
- **WHEN** o menu global está aberto e o usuário clica em qualquer ponto do board
  fora do controle e do menu
- **THEN** o menu fecha e nenhum tamanho é aplicado

### Requirement: Escolher um preset global redimensiona todas as telas
Ao escolher um preset (`Mobile`, `Tablet`, `Laptop` ou `Desktop`) no menu global, o
sistema SHALL aplicar a largura e a altura desse preset a **todas** as telas do
board, e o menu SHALL fechar.

#### Scenario: Aplicar Mobile a um board com várias telas
- **WHEN** o board tem duas ou mais telas e o usuário escolhe `Mobile` no menu
  global
- **THEN** todas as telas do board passam a ter a largura e a altura do preset
  `Mobile`
- **AND** o menu global fecha

#### Scenario: Trocar de preset global
- **WHEN** todas as telas já estão no preset `Mobile` e o usuário escolhe `Desktop`
  no menu global
- **THEN** todas as telas passam a ter a largura e a altura do preset `Desktop`

#### Scenario: Preset global alcança telas ajustadas à mão
- **WHEN** o usuário redimensionou uma tela arrastando a borda dela e em seguida
  escolhe um preset no menu global
- **THEN** essa tela também passa ao tamanho do preset, junto com as demais

### Requirement: `Automatico` global devolve todas as telas ao tamanho do conteúdo
Ao escolher `Automatico` no menu global, o sistema SHALL devolver todas as telas ao
tamanho medido do próprio conteúdo, desfazendo tanto o preset global quanto qualquer
tamanho escolhido tela a tela, e o menu SHALL fechar.

#### Scenario: Voltar tudo ao automático
- **WHEN** as telas estão num preset global e o usuário escolhe `Automatico` no
  menu global
- **THEN** todas as telas voltam ao tamanho medido do próprio conteúdo

#### Scenario: `Automatico` global também desfaz ajuste individual
- **WHEN** uma tela foi redimensionada individualmente e o usuário escolhe
  `Automatico` no menu global
- **THEN** essa tela também volta ao tamanho medido do próprio conteúdo

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

### Requirement: Tela que aparece depois nasce no tamanho global da sessão
Enquanto um preset global estiver ativo na sessão, o sistema SHALL aplicar esse
mesmo tamanho a qualquer tela que passe a existir no board depois da escolha — por
exemplo, um arquivo `.html` novo na pasta observada — em vez de medi-la pelo próprio
conteúdo. Com `Automatico` ativo, ou sem nenhuma escolha global na sessão, a tela
nova SHALL nascer medida pelo próprio conteúdo, como hoje.

#### Scenario: Arquivo novo com preset global ativo
- **WHEN** o usuário escolheu `Mobile` no menu global e depois um arquivo `.html`
  novo aparece na pasta observada
- **THEN** a tela nova aparece no board já com a largura e a altura do preset
  `Mobile`

#### Scenario: Arquivo novo sem preset global
- **WHEN** nenhuma escolha foi feita no menu global nesta sessão e um arquivo
  `.html` novo aparece na pasta observada
- **THEN** a tela nova aparece medida pelo próprio conteúdo

#### Scenario: Arquivo novo com `Automatico` global ativo
- **WHEN** o usuário escolheu `Automatico` no menu global e depois um arquivo
  `.html` novo aparece na pasta observada
- **THEN** a tela nova aparece medida pelo próprio conteúdo

### Requirement: A escolha global não persiste entre sessões
O sistema SHALL manter o preset global apenas enquanto a página do board estiver
aberta. Recarregar o board SHALL zerar a escolha global, sem apagar os tamanhos que
as telas já ganharam — esses continuam vindo da organização salva.

#### Scenario: Recarregar zera a escolha global
- **WHEN** o usuário escolheu `Mobile` no menu global, recarrega o board e em
  seguida um arquivo `.html` novo aparece na pasta observada
- **THEN** a tela nova aparece medida pelo próprio conteúdo, e não no tamanho
  `Mobile`

#### Scenario: Recarregar preserva os tamanhos já aplicados
- **WHEN** o usuário escolheu `Mobile` no menu global e recarrega o board
- **THEN** as telas que existiam no momento da escolha reaparecem no tamanho
  `Mobile`

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

### Requirement: "Reorganizar" devolve o board ao automático depois de um gesto global
O sistema SHALL fazer com que o controle "Reorganizar" volte a tratar como automáticas
todas as telas fixadas por um gesto global, do mesmo modo que já faz com as fixadas
pelo usuário.

#### Scenario: Reorganizar depois de um preset global
- **WHEN** o usuário aplica um preset global e em seguida aciona "Reorganizar"
- **THEN** todas as telas voltam ao layout automático e ao tamanho do próprio
  conteúdo
