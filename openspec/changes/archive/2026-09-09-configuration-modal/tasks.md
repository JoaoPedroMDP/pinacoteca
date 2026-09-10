## 1. Markup e ícone de gatilho

- [x] 1.1 Adicionar `<dialog id="settings-dialog">` em `index.html` com a
  estrutura de `#settings-nav`/`#settings-panels` descrita em design.md
  (categorias General/Models, subcategoria Claude com
  `chat-key-input`/`chat-key-save`/`chat-credential-note` movidos para
  dentro dela) e verificar que o HTML valida (nenhum id duplicado)
- [x] 1.2 Adicionar o botão de engrenagem em `sidebar-footer`, ao lado de
  `connection`/`version`, e verificar visualmente que aparece nas duas abas
  (Telas e Conversa)
- [x] 1.3 Remover o markup antigo de `#chat-settings` da aba Conversa
  (input, botão Salvar, aviso — agora vivem dentro do `<dialog>`) e
  verificar que a aba Conversa renderiza só log e composer

## 2. Módulo `settings.js`

- [x] 2.1 Criar `src/client/settings.js` com `openSettings()`/
  `closeSettings()` usando `showModal()`/`close()` do `<dialog>`, e
  verificar que o ícone de engrenagem abre a modal e Escape a fecha
- [x] 2.2 Implementar troca de categoria (`data-category`) e de
  subcategoria de modelo (`data-model-category`) reaproveitando o padrão de
  `tabs.js`, e verificar que só um painel de cada nível fica visível por
  vez
- [x] 2.3 Implementar fechamento por clique fora (`event.target ===
  dialogElement`) e verificar que clicar dentro do conteúdo não fecha a
  modal
- [x] 2.4 Migrar `setHasKey`/`setHasAmbientCredential` de `chat.js` para
  `settings.js`, apontando para os elementos dentro da subcategoria Claude,
  sem a ramificação de `keyFieldRevealed`; remover
  `updateKeyFieldVisibility`, `keyFieldRevealed`, `revealKeyField` e o
  listener de clique em `chatCredentialNote` de `chat.js`
- [x] 2.5 Atualizar `dom.js` com os novos seletores (`settings-dialog`,
  `settings-nav`, painéis de categoria/subcategoria) e remover os que não
  existem mais nesse contexto
- [x] 2.6 Atualizar `chat-client.js` para importar os setters de
  `settings.js` em vez de `chat.js`, e verificar que salvar a chave
  continua atualizando `hasKey`/`hasAmbientCredential` corretamente

## 3. Estilos

- [x] 3.1 Adicionar estilos do `<dialog>` (tamanho, `::backdrop`, nav de
  categorias, painéis) em `board.css`, reaproveitando as variáveis de tema
  já usadas (`--bg`, `--border`, `--text`) e verificar visualmente em modo
  claro e escuro se o projeto já suporta ambos, senão no tema padrão
- [x] 3.2 Remover os estilos de `#chat-settings`, `#chat-credential-note`,
  `#chat-key-input`, `#chat-key-save` do local antigo em `board.css` e
  movê-los (ajustados aos novos seletores) para dentro dos estilos da
  modal

## 4. Verificação end-to-end

- [x] 4.1 Rodar a suíte de testes existente (`npm test` ou equivalente) e
  verificar que nada relacionado a `chat-config-panel` quebra sem
  atualização esperada
- [x] 4.2 Verificar manualmente os três estados de `hasKey`/
  `hasAmbientCredential` (nenhuma credencial, sessão de ambiente sem chave,
  chave gravada) dentro da subcategoria Claude, confirmando que o campo
  está sempre visível e o aviso aparece só quando há sessão de ambiente
- [x] 4.3 Verificar que a modal abre sempre em General e que trocar para
  Models > Claude e fechar/reabrir a modal volta para General
