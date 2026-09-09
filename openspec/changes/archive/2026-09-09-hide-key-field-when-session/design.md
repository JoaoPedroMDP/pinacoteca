## Context

Ver proposal.md - Why. Hoje `chat-settings` tem dois estados só (visível/escondido,
via `hasKey`) mais um aviso independente (`hasAmbientCredential`) que liga e desliga
por cima, sem nunca esconder o campo. `chat.js` (`src/client/chat.js`) é quem já
possui os dois setters (`setHasKey`, `setHasAmbientCredential`); `state.js` é o único
lugar do cliente onde estado de escopo de módulo pode viver (regra do ARCHITECTURE.md,
seção "Cliente (board)").

## Goals / Non-Goals

**Goals:**
- Decidir onde mora o terceiro estado ("usuário pediu para revelar o campo") sem
  quebrar a regra de que só `state.js` guarda estado entre eventos.
- Decidir a interação mínima do controle que revela o campo (link de texto vs.
  botão), coerente com o resto do painel.

**Non-Goals:**
- Não muda a lógica de detecção de `hasAmbientCredential` em si (isso é
  `anthropic-credential-detection`, capability separada e já correta).
- Não introduz nenhuma persistência nova (o estado "revelado" não sobrevive a
  reload — reabrir a aba com sessão ativa volta ao padrão escondido).

## Decisions

### O terceiro estado vive em `chat.js`, junto dos outros dois

`chat.js` já é quem possui `chat.hasKey` e `chat.hasAmbientCredential` em
`state.js` (via os campos do objeto `chat`) e já recalcula a visibilidade do
painel a cada `setHasKey`/`setHasAmbientCredential`. Um terceiro campo,
`chat.keyFieldRevealed` (boolean, default `false`), soma-se aos outros dois sem
sair do módulo que já é dono da regra de visibilidade — nenhuma dependência
nova, nenhum módulo novo.

Alternativa descartada: guardar o "revelado" como estado local de DOM (uma
classe CSS lida na hora). Rejeitada porque a visibilidade já depende de três
fontes (`hasKey`, `hasAmbientCredential`, o clique) e calcular isso em três
lugares (CSS, clique, os dois setters existentes) é o tipo de duplicação que a
regra de "só `state.js`" existe para evitar.

### Visibilidade do campo é sempre recomputada, nunca setada direto

Os três setters (`setHasKey`, `setHasAmbientCredential`, e o novo handler de
clique do controle) chamam uma função interna só,
`updateKeyFieldVisibility()`, que aplica a regra:

```
campo visível = !hasKey && (!hasAmbientCredential || keyFieldRevealed)
```

Alternativa descartada: cada setter mexer direto em `chatKeyInput.hidden`.
Rejeitada porque a regra tem três entradas — deixá-la espalhada nos três
pontos de entrada é o jeito certo de os deixar dessincronizados depois que
alguém mexer só num deles (já quase aconteceu: `setHasAmbientCredential` hoje
mexe só no aviso, nunca no campo).

### O controle é o próprio texto do aviso, clicável, não um botão novo

`chat-credential-note` vira um elemento clicável (`role="button"` ou um
`<button>` com aparência de texto) em vez de nascer um elemento irmão novo.
Antes de revelar, seu texto continua o aviso normal; ao ficar visível o campo,
o texto do próprio aviso muda para indicar que ele agora é o toggle "usar
sessão detectada em vez da chave" (some) — não, na verdade: uma vez revelado
o campo fica revelado até a chave ser salva ou a página recarregar, então o
elemento não precisa de dois textos. Ele simplesmente deixa de ser necessário
como controle depois do primeiro clique (o campo já está à vista) e volta a
ser só o aviso, agora abaixo do campo.

Alternativa descartada: um link separado ("usar chave de API") ao lado do
aviso. Rejeitada por adicionar um segundo elemento textual pequeno no mesmo
canto do painel, quando o aviso já ocupa aquele espaço e já é a peça que
explica por que o campo normalmente nem aparece — reaproveitá-lo evita mais
um nó no DOM e mais um texto para manter em português.

### Estilo do aviso: reduzir tamanho e opacidade, não introduzir nova cor

O aviso passa a usar `font-size` menor (ex.: `12px`, abaixo do `14px` padrão do
painel) e a var CSS de texto existente com opacidade reduzida (`opacity` no
seletor, não uma cor hardcoded nova) — consistente com o resto do board, que já
usa a classe utilitária `.muted` (o aviso já a tem) para texto secundário;
aqui o ajuste é ficar ainda mais discreto que `.muted`, então ganha uma regra
própria em `board.css` em vez de mudar `.muted` globalmente (outros usos de
`.muted` no board não devem encolher).

## Risks / Trade-offs

- [Usuário revela o campo, digita metade de uma chave e clica em outro lugar
  sem salvar] → Aceito: nenhum estado de "chave em digitação" precisa
  sobreviver a isso; recarregar a aba volta ao padrão escondido, igual ao
  comportamento atual de qualquer campo não salvo.
- [Teste e2e existente afirma explicitamente que o painel "continua a vista"
  com sessão detectada] → Vira o comportamento oposto de propósito; os dois
  `check`s em `test/e2e.mjs` (por volta da linha 907) precisam ser reescritos
  para refletir a nova regra, não apenas ajustados.
- [Usuário clica no aviso por engano, sem querer revelar o campo] → Aceito: o
  clique não tem efeito destrutivo (não salva nada, não apaga a sessão) — o
  pior caso é o campo aparecer sem necessidade, reversível ao recarregar.
