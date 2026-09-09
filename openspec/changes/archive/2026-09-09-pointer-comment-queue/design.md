## Context

Ver `proposal.md` - Why/What Changes. Pontos relevantes já existentes no
código, base para as decisões abaixo:

- `src/client/inspect.js` já mantém `hover` (elemento sob o cursor em modo
  ponteiro) e `copyXPathAt`, que usa `computeXPath`/`elementUnderCursor`.
- `src/client/controls.js` despacha gestos de `pointerdown` no `viewport`;
  hoje `if (ui.mode === 'pointer' && event.button === 0) return;` não faz
  nada — é o slot livre para o novo clique-abre-caixinha.
- `src/client/chat.js` não faz I/O de rede; `submit()` chama
  `chat.transport?.send(text)` com uma string só. `chat.running` indica se
  um turno está em andamento; vira `false` quando o turno termina — esse é
  o sinal de "IA terminou", usado tanto para destravar a fila quanto para
  remover os balões em carregamento.
- Segundo "Como adicionar uma feature" do ARCHITECTURE.md, gesto/atalho vai
  em `controls.js`, destaque/XPath em `inspect.js`, painel de chat em
  `chat.js`. Não existe hoje nenhum módulo de estado "de negócio" fora de
  `state.js` para dados que cruzam board e chat — a fila de comentários é o
  primeiro caso disso.

## Goals / Non-Goals

**Goals:**
- Definir o formato de dado da fila de comentários e onde ele mora em
  `state.js`.
- Definir os pontos de integração exatos nos três módulos de cliente
  (`inspect.js`, `controls.js`, `chat.js`) sem introduzir módulo novo.
- Definir o algoritmo de reancoragem e o formato da mensagem serializada.

**Non-Goals:**
- Persistência da fila entre reloads de página inteira (F5) ou entre
  sessões — a fila vive em memória, como o resto do estado do board.
- Qualquer mudança de protocolo servidor/SSE — a fila usa o `send(text)`
  existente sem alterações.
- Suporte a múltiplos comentários no mesmo nó (decidido: 1 item por XPath).

## Decisions

### Estado: `Map` por arquivo, chave = XPath

```
/** @type {Map<string, Map<string, CommentItem>>} */
// screenFile -> xpath -> item
const commentQueue = new Map();

/**
 * @typedef {Object} CommentItem
 * @property {string} xpath
 * @property {string} text
 * @property {'draft' | 'confirmed' | 'sending' | 'unreferenced'} status
 * @property {{x:number, y:number} | null} anchorPoint - ultima posicao de tela
 *   conhecida (para desenhar o balao/caixinha antes do proximo hover)
 */
```

Chave dupla (arquivo -> XPath) porque cada protótipo tem seu próprio
documento; XPath só é único dentro do mesmo documento. Reclicar um XPath já
presente atualiza o mesmo `CommentItem` em vez de criar outro, cumprindo o
requisito de 1 item por nó.

Alternativa descartada: array de itens com XPath repetível — rejeitada
porque o usuário já confirmou "1 balão por nó, reclique edita" (Map cumpre
isso de graça, array exigiria checar duplicata manualmente a cada clique).

### Onde cada pedaço mora

- **`state.js`**: exporta `commentQueue` (o Map acima) e talvez um helper
  `getQueueSize()` usado pelo chat para desabilitar/habilitar UI.
- **`inspect.js`**: ganha as funções de fila que dependem de DOM/XPath —
  `openCommentBoxAt(file, event)` (substitui o slot inerte do clique
  simples), `tryReanchor(file, doc)` (chamado no `load` do iframe, ao lado
  de `injectInspectStyle`), e a lógica de arrastar um item sem referência até um nó
  (`elementUnderCursor` já resolve nó-sob-cursor, reaproveitado no drop).
  `copyXPathAt` passa a checar `event.ctrlKey && event.altKey` em vez de só
  `event.altKey` — o guard de quem chama `copyXPathAt` (em `controls.js`)
  precisa mudar também.
- **`controls.js`**: o branch em `pointerdown` que hoje faz
  `if (ui.mode === 'pointer' && event.button === 0) return;` passa a
  chamar `openCommentBoxAt`. O branch que hoje decide Alt+clique ->
  `copyXPathAt` passa a exigir `event.ctrlKey` também. Novo gesto de drag
  para reancorar item sem referência: `pointerdown` num balão sem referência na bandeja
  entra em modo de arraste até `pointerup` sobre um nó válido.
- **`chat.js`**: renderiza a lista "a enviar" (itera `commentQueue`,
  incluindo itens em `draft`), com botão "x" por item chamando um
  removedor exportado de `inspect.js`/`state.js`. `submit()` ganha um
  branch: se `commentQueue` não está vazio, serializa e concatena com (ou
  substitui) o texto do compositor antes de chamar `send`; senão comporta-se
  como hoje.

### Formato da mensagem serializada

```
1. XPath: /html/body/div[2]/button[1]
   Comentário: ajusta a cor desse botao pra verde

2. XPath: //*[@id="card-principal"]
   Comentário: aumenta o espacamento em baixo
```

Um item por número, XPath em linha própria (fácil de copiar/usar
programaticamente pelo agente), comentário em bloco abaixo (suporta
multi-linha sem ambiguidade de formatação). Itens `unreferenced` são
descartados antes de serializar; itens `draft` participam com o texto que
tinham no momento do clique em Enviar.

### Ciclo de vida / transições de status

```
click no no vazio -> draft
   Enter            -> confirmed
   (nada, so texto)  -> permanece draft (nao descarta em blur)

confirmed
   reclique no msm no -> volta a abrir caixinha (edita, permanece confirmed
                          apos novo Enter)
   x                  -> remove do Map

reload do iframe (draft ou confirmed)
   XPath resolve      -> mantem status, atualiza anchorPoint
   XPath nao resolve  -> unreferenced

unreferenced
   drag solto num no  -> recalcula xpath, volta a confirmed
   Enviar disparado    -> remove do Map (descartado, nao entra na mensagem)

Enviar disparado (draft/confirmed remanescentes)
   -> sending (fila trava: chat.js ignora x/click ate turno terminar)
   turno termina (chat.running vira false) -> remove do Map inteiro
```

### Reancoragem automática

No handler de `load` do iframe (onde hoje `injectInspectStyle` já roda),
para cada `CommentItem` da fila daquele `file`: tenta
`doc.evaluate(item.xpath, doc, ...)` (mesma primitiva inversa de
`computeXPath`, que hoje só vai num sentido elemento->string; precisa de um
`resolveXPath(doc, xpath)` novo, simétrico). Se resolve para um elemento,
atualiza `anchorPoint` a partir do `getBoundingClientRect` do achado; senão
marca `unreferenced`.

## Risks / Trade-offs

- [Risco] XPath por índice de irmãos (sem `@id`) é frágil a qualquer
  mudança de estrutura, mesmo pequena → Mitigação: é exatamente o caso que
  o fluxo de reancoragem/sem referência cobre; o usuário já validou esse
  comportamento como aceitável (arrasto manual como fallback).
- [Risco] Lista "a enviar" no chat e balões no board são duas renderizações
  do mesmo Map — divergirem por bug de sincronização é fácil se cada lado
  mantiver cópia própria → Mitigação: nenhum dos dois lados guarda cópia;
  ambos leem `commentQueue` diretamente e re-renderizam a partir dele nos
  eventos de mudança (mesmo padrão que `chat.js` já usa para `chat.tools`).
- [Risco] `chat.running` como único sinal de "turno terminou" assume que a
  fila só é enviada como parte de um turno que a UI já rastreia — se o
  usuário digitar algo manualmente no compositor *e* tiver itens na fila,
  os dois se misturam num turno só, o que é o comportamento desejado (uma
  mensagem), mas exige decidir a ordem (fila antes ou depois do texto
  livre) — este documento assume fila primeiro, texto livre do compositor
  depois, mas fica como decisão de implementação de baixo risco.

## Open Questions

- Nenhuma pendente que mude specs, abordagem ou tasks — detalhes de
  posicionamento pixel-a-pixel da bandeja de sem referência e do popover da
  caixinha ficam a critério da implementação, dentro do que as specs já
  fixam.
