## Why

O tamanho global funciona na primeira vez e quebra na segunda. Aplicar `Mobile` a um
board recém-aberto acomoda tudo direitinho; trocar em seguida para `Desktop` deixa
**todas** as telas sobrepostas e vermelhas, nas posições apertadas do tamanho anterior.
Reproduzido com quatro telas:

```
depois de Mobile:   invalidas=0/4   largura=375    0,0 / 447,0 / 0,775 / 447,775
depois de Desktop:  invalidas=4/4   largura=1920   (as mesmas posicoes)
```

Pior que o vermelho: tela sobreposta não é gravada, então o tamanho escolhido nem
chega ao `localStorage` — o gesto falha inteiro, não só visualmente.

A causa é conhecida e está documentada em `ARCHITECTURE.md`: para o tamanho sobreviver
à recarga, `applyGlobalSize` fixa todas as telas no fim do gesto. Só que o board não
distingue "fixa porque o usuário arrastou" de "fixa porque o gesto global fixou". No
segundo gesto já está tudo fixo, o layout automático não move nada, e as telas crescem
umas por cima das outras.

## What Changes

- O board passa a distinguir a tela que o **usuário** fixou (arrasto de título,
  posição salva de uma sessão anterior) da que o **gesto global** fixou. Só a segunda
  volta a escorrer no gesto seguinte.
- Trocar o tamanho global deixa de sobrepor: as telas fixadas pelo gesto anterior se
  reacomodam pelo layout automático em volta do novo tamanho.
- As telas que o usuário arrastou continuam onde ele as deixou.
- **Novo**: quando duas telas que o usuário arrastou colidirem por efeito do
  crescimento, o board desfaz a colisão empurrando o mínimo necessário, em vez de
  deixar as duas vermelhas. Depois de um gesto global o board não fica com nenhuma
  tela sobreposta, em nenhum caso.
- "Reorganizar" continua limpando tudo, agora inclusive a marca de quem foi fixado
  pelo gesto global.
- Sem mudança no formato do `localStorage`, no menu, nas opções ou no que persiste.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities
- `global-screen-size`: o requisito "O board se reorganiza em volta do novo tamanho"
  passa a valer em **todo** gesto global, e não só no primeiro, e passa a garantir
  ausência de sobreposição inclusive entre telas que o usuário arrastou. O requisito
  "O tamanho de cada tela continua ajustável depois do global" ganha a contrapartida
  de que fixar pelo gesto global não conta como arranjo manual do usuário.

## Impact

- `src/client/state.js` — a marca que separa tela fixada pelo usuário de tela fixada
  pelo gesto global.
- `src/client/cards.js` — `applyGlobalSize` solta o que ela mesma fixou antes de
  reorganizar.
- `src/client/view.js` — a separação de telas colididas, e o ponto em que
  "Reorganizar" limpa a marca nova.
- `test/e2e.mjs` — o caso que hoje passa despercebido: um segundo gesto global, e um
  gesto global com telas arrastadas à mão que colidiriam.
- `openspec/specs/global-screen-size/spec.md` — via delta desta change.
- `ARCHITECTURE.md` — a seção "Tamanho de todas as telas ao mesmo tempo" descreve hoje
  o comportamento que está sendo corrigido.

Sem impacto no servidor, em rotas, no watcher ou no agente.
