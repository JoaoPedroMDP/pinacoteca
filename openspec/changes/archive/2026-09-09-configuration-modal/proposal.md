## Why

O campo de chave de API na aba Conversa tem um bug de fold: clicar no aviso
de sessão detectada revela o campo, mas nada o esconde de volta
([chat.js:886-889](../../../src/client/chat.js#L886-L889)). Além disso, o
controle que revela o campo é um botão sem nenhuma affordance visual — texto
discreto, opacidade reduzida — então um usuário novo não tem como inferir que
ali existe um campo escondido. Por cima disso, a pinacoteca não tem tela de
configurações nenhuma: a única configuração hoje é essa, espremida dentro da
aba Conversa.

## What Changes

- **BREAKING**: remove o painel `#chat-settings` da aba Conversa por
  inteiro — campo de chave, botão Salvar e aviso de sessão de ambiente saem
  de lá. O código morto do fold (`keyFieldRevealed`, `revealKeyField`, o
  listener de clique em `chatCredentialNote`) é removido junto.
- Adiciona um ícone de engrenagem no rodapé do sidebar (`sidebar-footer`,
  ao lado de connection/version), visível nas duas abas, que abre uma modal
  de Configurações.
- Cria a modal de Configurações: duas categorias na navegação (General,
  Models); Models expande em subcategorias, uma por modelo suportado — por
  ora só Claude. A categoria General nasce com um placeholder (nenhuma
  configuração para colocar ali ainda).
- Move o campo de chave de API, o botão Salvar e o aviso de sessão de
  ambiente para dentro de Models > Claude, sempre visíveis ali — sem fold,
  sem revelação condicional.
- Preferências de modelo/esforço/auto-approve/envio no Enter continuam no
  composer da aba Conversa; fora de escopo desta mudança.

## Capabilities

### New Capabilities
- `settings-modal`: modal de Configurações — abertura/fechamento pelo ícone
  do sidebar, navegação por categorias (General, Models) e subcategorias de
  modelo (Claude), e a subcategoria Claude hospedando campo de chave, botão
  Salvar e aviso de sessão de ambiente.

### Modified Capabilities
- `chat-config-panel`: o painel `#chat-settings` da aba Conversa deixa de
  existir; todos os requisitos de visibilidade condicional e fold do campo
  de chave (hoje nessa capability) são removidos dessa localização e
  reaparecem, sem fold, em `settings-modal`.

## Impact

- Frontend: [index.html](../../../src/client/index.html) (remove
  `#chat-settings`, adiciona gear icon + markup da modal), `chat.js`
  (remove `keyFieldRevealed`/`revealKeyField`/listener de
  `chatCredentialNote`, adiciona lógica da modal), `dom.js` (novos
  seletores), `board.css` (remove estilos de `#chat-settings` etc., adiciona
  estilos da modal), possivelmente novo arquivo de módulo para a modal.
- Backend: nenhum. Rota `/config` já serve `apiKey`, `hasKey`,
  `hasAmbientCredential`; nenhuma mudança de contrato.
- Specs: `chat-config-panel` perde seus requisitos atuais; `settings-modal`
  nasce com os equivalentes, sem a lógica de fold.
