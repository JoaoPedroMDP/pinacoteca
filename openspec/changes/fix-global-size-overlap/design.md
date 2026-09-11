## Context

Ver `proposal.md` — Why para o defeito e a causa, e `specs/global-screen-size/spec.md`
para os requisitos.

O que condiciona a correção, tudo já no código:

- `Screen.pinned` é um booleano só. Ele quer dizer "o layout automático não mexe nesta
  tela", e hoje três coisas diferentes o ligam: o arrasto de título (`moveScreen`), o
  redimensionamento (`resizeScreen`), a posição vinda do `localStorage`
  (`createCard`) — e, desde o tamanho global, o próprio `applyGlobalSize`, no fim do
  gesto. É essa última que não deveria valer como escolha do usuário.
- `layout()` (`view.js`) separa `pinned` de `flowing`: as fixas são desenhadas onde
  estão e viram `blockers`; as que escorrem são distribuídas em colunas e desviadas
  para baixo dos blockers por `belowPinned`. Nenhum caminho move uma tela fixa.
- `refreshOverlaps()` apenas *marca* (`findOverlaps` + classe `is-invalid`); não
  corrige. `persistPositions` pula as marcadas, que é por que o gesto quebrado também
  perde o tamanho.
- `resetPositions()` (o "Reorganizar") zera `pinned` de todas e roda `layout()`.
- `rectsOverlap` e `findOverlaps` estão em `utils.js` e são funções puras — o lugar
  natural para uma resolução de colisão testável por `test/unit.mjs`.

## Goals / Non-Goals

**Goals:**

- Nenhuma tela sobreposta depois de qualquer gesto global, em qualquer repetição.
- O arranjo manual do usuário preservado através dos gestos globais.
- A correção da colisão entre telas do usuário como função pura, testável sem
  navegador.

**Non-Goals:**

- Mudar o que acontece quando o *usuário* larga uma tela em cima de outra à mão: isso
  continua marcando as duas de vermelho e não gravando. A resolução automática é do
  gesto global, que não foi o usuário quem mirou.
- Mudar o formato do `localStorage`, o menu global, as opções ou a regra de
  persistência do preset entre sessões.
- Repensar a decisão de fixar tudo no fim do gesto global — ela continua sendo o que
  faz o tamanho sobreviver à recarga. O que muda é o board passar a lembrar *quem*
  fixou.

## Decisions

### `Screen` ganha `autoPinned`, e não um terceiro estado de `pinned`

Um campo booleano novo ao lado de `pinned`: verdadeiro quando aquela tela está fixa
**apenas** porque um gesto global a fixou. `applyGlobalSize` o consulta no começo do
gesto seguinte para soltar o que ela mesma prendeu.

Alternativa considerada: trocar `pinned` por um enum (`'auto' | 'global' | 'user'`).
Recusada porque `pinned` é lido em muitos pontos (`layout`, `persistPositions`,
`resetPositions`, `moveScreen`, `resizeScreen`, `createCard`) e todos querem a mesma
pergunta binária — "o layout pode mexer nesta?". Um enum obrigaria a reescrever todos
eles para responder de novo a mesma coisa. O campo separado deixa o significado de
`pinned` intacto e acrescenta só a procedência.

Alternativa considerada: um `Set` de arquivos em `state.js`, fora do `Screen`.
Recusada porque o dado é por tela e já há um objeto por tela; o `Set` teria de ser
limpo à mão quando uma tela sai do board.

Quem liga e quem desliga:

- `applyGlobalSize` liga, no fim do gesto, só para as telas que não eram do usuário.
- Qualquer gesto do usuário sobre aquela tela — arrastar o título, arrastar a borda,
  escolher um tamanho no menu do card — desliga: a partir dali a tela é dele. É o que
  o requisito "um ajuste individual passa a contar como escolha do usuário" pede.
- `resetPositions` ("Reorganizar") desliga em todas, junto com `pinned`.

### A colisão entre telas do usuário é resolvida empurrando para baixo

Depois de o layout acomodar as que escorrem, sobra o caso do requisito novo: duas
telas que o *usuário* posicionou e que cresceram uma dentro da outra. O board as
separa deslocando no eixo `y`, a de baixo para baixo, o mínimo que resolve — a mesma
direção e o mesmo critério que `belowPinned` já usa para desviar uma tela que escorre
de um obstáculo, então o board não ganha um segundo jeito de pensar colisão.

Alternativa considerada: empurrar no eixo de menor deslocamento (`x` ou `y`, o que
for mais barato). Recusada por ser menos previsível — o board é lido em colunas, e uma
tela saltando para o lado embaralha mais a leitura do que uma descendo.

A função vai para `utils.js`, pura: recebe as caixas e devolve os deslocamentos.
Assim ela ganha teste em `test/unit.mjs` sem navegador, como `assignColumns` e
`findOverlaps` já têm.

### O momento certo é entre o `layout()` e a fixação final

A ordem dentro de `applyGlobalSize` passa a ser:

1. soltar o que o gesto anterior fixou (`autoPinned`);
2. aplicar o tamanho novo, preservando `pinned` de quem é do usuário;
3. `layout()` — as que escorrem se acomodam em volta das do usuário, já no tamanho
   novo;
4. separar o que ainda colide — só pode ser tela do usuário, porque o passo 3 já
   resolveu as outras;
5. fixar tudo e marcar `autoPinned` em quem não era do usuário;
6. `persistPositions()`.

O passo 4 vem depois do 3 de propósito: resolver colisão antes do layout resolveria
contra posições que ainda vão mudar.

## Risks / Trade-offs

- **Empurrar uma tela do usuário mexe no arranjo que ele fez.** → É o que ele escolheu
  ao pedir que a sobreposição fosse corrigida de qualquer jeito, e o deslocamento é o
  mínimo. A alternativa era deixá-la vermelha e não gravar o tamanho, que é o defeito
  de hoje.
- **Empurrar em cascata pode afastar bastante uma tela num board apertado.** → O
  deslocamento é sempre para baixo e sempre o mínimo por colisão; "Reorganizar"
  continua devolvendo tudo ao automático.
- **`autoPinned` é mais um campo a manter em sincronia com `pinned`.** → Os pontos que
  o desligam são poucos e nomeados acima; o teste de "gesto global repetido preserva o
  arrasto do usuário" é o que trava a regressão.
- **Um board onde o usuário fixou *todas* as telas à mão vira só o passo 4.** → É o
  comportamento pedido: nada se reacomoda, mas nada fica sobreposto.

## Migration Plan

Não se aplica: correção de comportamento no cliente, sem formato de dado novo. Um
board com posições salvas pela versão anterior carrega normalmente — `autoPinned`
nasce falso, e a primeira consequência disso é que o primeiro gesto global depois da
atualização trata as telas salvas como escolha do usuário, que é o comportamento
conservador correto.
