## 1. Estado

- [x] 1.1 Adicionar `chat.keyFieldRevealed` (default `false`) ao objeto `chat`
      em `src/client/state.js`, e verificar que o campo existe no objeto
      exportado
- [x] 1.2 Em `src/client/chat.js`, extrair `updateKeyFieldVisibility()` que
      aplica `!hasKey && (!hasAmbientCredential || keyFieldRevealed)` sobre
      `chatKeyInput` e `chatKeySave`, e chamá-la a partir de `setHasKey` e
      `setHasAmbientCredential`; verificar com `npm run check`

## 2. Markup e controle

- [x] 2.1 Em `src/client/index.html`, mover `chat-credential-note` para
      depois do campo `chat-key-input`/botão `chat-key-save` dentro de
      `#chat-settings`, e torná-lo um elemento clicável (`<button>` com
      classe própria, ou `role="button"` + `tabindex="0"`)
- [x] 2.2 Adicionar handler de clique/`Enter` no aviso que seta
      `chat.keyFieldRevealed = true` e chama `updateKeyFieldVisibility()`,
      só quando o campo está escondido por sessão (não faz nada quando o
      campo já está visível ou quando não há sessão detectada)
- [x] 2.3 Verificar manualmente (ou via e2e, tarefa 4) que: sem sessão, o
      campo aparece direto; com sessão e sem revelar, campo some e aviso
      mostra; clicar no aviso revela campo e botão — coberto pelos checks
      da tarefa 4.1, todos verdes

## 3. Estilo

- [x] 3.1 Em `src/client/board.css`, reduzir `font-size` do
      `#chat-credential-note` (abaixo do padrão de `.muted`) e aplicar
      `opacity` reduzida, mantendo a regra de layout (`flex: 1 1 100%`) já
      existente
- [x] 3.2 Conferir visualmente nos dois temas (claro/escuro, se aplicável ao
      board) que o aviso lê como texto secundário, não como o campo
      principal — board.css só define um tema (`:root` fixo, sem
      `prefers-color-scheme`/`data-theme`), então `opacity: 0.6` sobre
      `var(--text)` cobre o único tema existente

## 4. Testes

- [x] 4.1 Reescrever em `test/e2e.mjs` (por volta da linha 887-916) os
      checks que hoje afirmam "o painel de chave continua a vista" com
      sessão detectada, para afirmar o oposto: campo escondido por padrão
      com `hasAmbientCredential = true`, revelado só depois de simular o
      clique no aviso
- [x] 4.2 Adicionar check cobrindo: sem sessão e sem chave, campo sempre
      visível (comportamento inalterado) — `npm run check` passando
- [x] 4.3 Adicionar check cobrindo: campo revelado permanece visível se
      `hasAmbientCredential` volta a `false` sem chave gravada (cenário do
      design.md, "Sessão deixa de existir enquanto o campo está revelado")

## 5. Verificação final

- [x] 5.1 Rodar `npm run check` (lint, tipos, testes) e confirmar tudo
      verde antes de reportar a tarefa concluída
