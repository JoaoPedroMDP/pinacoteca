## 1. Estado da fila

- [x] 1.1 Adicionar `commentQueue: Map<string, Map<string, CommentItem>>` e o
      typedef `CommentItem` em `src/client/state.js`, e verificar com teste
      unitário que criar/atualizar/remover um item pela chave (file, xpath)
      funciona como esperado
- [x] 1.2 Implementar `resolveXPath(doc, xpath)` em `src/client/utils.js`
      (inverso de `computeXPath`) e cobrir com teste unitário: XPath de nó
      existente resolve para o elemento certo; XPath de nó inexistente
      retorna `null`

## 2. Gesto de clique -> caixinha -> balão

- [x] 2.1 Em `src/client/controls.js`, substituir o branch inerte
      `ui.mode === 'pointer' && event.button === 0` por chamada a
      `openCommentBoxAt(file, event)`, e verificar manualmente que clique
      simples em modo ponteiro abre a caixinha (não faz mais nada)
- [x] 2.2 Implementar `openCommentBoxAt` em `src/client/inspect.js`: resolve
      o nó sob o cursor, cria/reabre item `draft` no `commentQueue` chaveado
      pelo XPath do nó, e renderiza a caixinha multi-linha ancorada nele
- [x] 2.3 Cablear Enter (sem Shift) para confirmar — status `draft` ->
      `confirmed`, fecha caixinha, mostra balão — e Shift+Enter para
      quebra de linha sem confirmar; checar em `test/e2e.mjs`
- [x] 2.4 Cablear reclique num nó com item `confirmed` para reabrir a
      caixinha pré-preenchida com o texto salvo, editando o mesmo item
      (mesma chave XPath, sem duplicar); checar em `test/e2e.mjs`
- [x] 2.5 Clicar fora da caixinha aberta não fecha nem descarta o rascunho;
      checar em `test/e2e.mjs`

## 3. Remoção

- [x] 3.1 Adicionar badge "x" no balão (board) e no item da lista "a
      enviar" (chat), ambos chamando um removedor único que apaga a chave
      do `commentQueue`; checar em `test/e2e.mjs` que remover de um lado
      reflete no outro

## 4. Ctrl+Alt+clique para copiar XPath

- [x] 4.1 Atualizar `copyXPathAt` em `src/client/inspect.js` e o guard em
      `src/client/controls.js` para exigir `event.ctrlKey && event.altKey`
      em vez de só `event.altKey`; checar em `test/e2e.mjs` que Alt+clique
      sozinho não copia XPath (abre a caixinha) e Ctrl+Alt+clique copia sem
      abrir caixinha

## 5. Lista "a enviar" no chat

- [x] 5.1 Renderizar em `src/client/chat.js` a lista "a enviar" a partir de
      `commentQueue`, incluindo itens `draft` com texto ao vivo, e
      verificar manualmente que digitar na caixinha atualiza a lista sem
      precisar confirmar

## 6. Envio único e ciclo de carregamento

- [x] 6.1 Serializar os itens com referência a um nó da fila no formato
      numerado (XPath em linha própria + bloco de comentário) dentro de
      `submit()` em `src/client/chat.js`, concatenando com o texto do
      compositor quando houver; checar em `test/unit.mjs` a função pura de
      serialização isolada
- [x] 6.2 Ao disparar o envio, mover os itens com referência para status
      `sending` (trava edição/remoção) e os itens `unreferenced` para
      descarte (removidos do Map, fora da mensagem); checar em
      `test/e2e.mjs`
- [x] 6.3 Balões em `sending` mostram estado de carregamento; quando
      `chat.running` volta a `false`, remover do `commentQueue` todos os
      itens em `sending` (some balão e linha da lista); checar em
      `test/e2e.mjs`

## 7. Reancoragem após reload do iframe

- [x] 7.1 No handler de `load` do iframe em `src/client/inspect.js`, para
      cada item do `commentQueue` daquele arquivo, tentar `resolveXPath` no
      novo documento; se resolver, atualizar `anchorPoint`; se não, marcar
      `unreferenced`; checar em `test/e2e.mjs`
- [x] 7.2 Renderizar bandeja fixa num canto do board para itens
      `unreferenced` e implementar o gesto de arrastar um item da bandeja
      até um nó válido (`pointerdown`/`pointerup` reaproveitando
      `elementUnderCursor`), recalculando o XPath e voltando o item a
      `confirmed`; checar em `test/e2e.mjs`

## 8a. Tamanho fixo sob zoom

- [x] 8a.1 Contra-escalar `.pina-comment-balloon`/`.pina-comment-box` em
      `src/client/board.css` (`transform: scale(var(--inv-scale, 1))`,
      mesma técnica de `.card-title`) para que caixinha e balão não
      encolham/cresçam com o zoom do board; verificado com `npm run check`
- [x] 8a.2 Mover `.pina-queue-layer` de dentro do `.card-frame` (que corta
      com `overflow: hidden`) para dentro do `.card`, compensando o offset
      do título em `src/client/board.css`/`ensureQueueLayer` em
      `src/client/inspect.js`, para que caixinha/balão perto da borda da
      tela não sejam cortados; verificado com `npm run check`

## 8b. Bandeja de itens sem referência

- [x] 8b.1 Renomear em todo o código (`src/client/*.js`, `src/client/board.css`,
      `test/*.mjs`) o status `ethereal` e os identificadores derivados
      (`renderEtherealTray`, `startEtherealDrag`, `reanchorEtherealItem`,
      `pina-ethereal-tray`, `is-ethereal`) para `unreferenced`/`Unreferenced`;
      verificado com `npm run check`
- [x] 8b.2 Corrigir a bandeja de pendentes de reancoragem para ficar
      oculta por completo quando não há nenhum item sem referência —
      `display: flex` do próprio autor vencia o `[hidden]` do agente de
      usuário mesmo com `tray.hidden = count === 0` já certo em JS; adicionar
      `.pina-unreferenced-tray[hidden] { display: none; }` em
      `src/client/board.css`; verificado com `npm run check`

## 8. Documentação e checagem final

- [x] 8.1 Atualizar a tabela "Como adicionar uma feature" e a seção de modo
      ponteiro em `ARCHITECTURE.md` para refletir o novo gesto, a fila de
      comentários e o Ctrl+Alt+clique
- [x] 8.2 Rodar `npm run check` (lint, tipos, testes) e garantir saída
      limpa antes de declarar a mudança concluída
