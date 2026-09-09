## Why

Quando a máquina já tem sessão do Claude Code ativa (`hasAmbientCredential`), a
conversa funciona sem chave nenhuma, mas o campo de chave e o botão Salvar
continuam à vista do mesmo jeito que ficariam sem sessão nenhuma — competindo
por atenção com um aviso que já diz "você não precisa disso". O aviso
(`chat-credential-note`) também fica acima do campo, do mesmo tamanho e cor do
resto do texto do painel, sem ler como coisa secundária.

## What Changes

- Com `hasAmbientCredential` true, o campo `chat-key-input` e o botão
  `chat-key-save` ficam escondidos por padrão — a chave deixa de competir
  visualmente com um caminho que já funciona sem ela.
- O aviso de sessão detectada vira um link/toggle discreto ("usar chave de
  API"), que ao ser clicado revela o campo e o botão — preserva o caminho
  documentado de trocar sessão por crédito de API, só que atrás de uma ação
  extra em vez de sempre visível.
- O aviso muda de posição (abaixo do campo revelado, não acima) e de estilo:
  fonte menor e cor mais opaca, como um comentário no código — deixa de
  disputar peso visual com o campo.
- Sem `hasAmbientCredential` (sem sessão detectada), nada muda: o campo
  continua sempre visível, porque é o único caminho para conversar.

## Capabilities

### New Capabilities
- `chat-config-panel`: painel de configuração da aba Conversa (chave de API e
  aviso de sessão de ambiente detectada) — como e quando o campo de chave, o
  botão Salvar e o aviso de sessão aparecem. Ainda não existe
  `openspec/specs/chat-config-panel/spec.md`; nasce nesta mudança.

### Modified Capabilities
(nenhuma)

## Impact

- `src/client/chat.js`: `setHasKey` e `setHasAmbientCredential` passam a
  coordenar três estados (chave gravada, sessão detectada, toggle revelado)
  em vez de dois independentes; precisa de um novo pedaço de estado para "o
  usuário pediu para ver o campo".
- `src/client/index.html`: `chat-credential-note` sai de cima do campo e vira
  elemento clicável (ou ganha um irmão clicável); a ordem do markup dentro de
  `#chat-settings` muda.
- `src/client/board.css`: novo estilo para o aviso (fonte menor, cor mais
  opaca) e possivelmente uma classe para o toggle.
- `src/client/dom.js`: pode precisar de uma nova referência de elemento
  (o link/toggle), se ele não reusar `chat-credential-note`.
- `test/e2e.mjs`: os dois checks que hoje afirmam que o painel de chave
  "continua a vista" com sessão detectada precisam mudar de sentido — o
  padrão passa a ser escondido, revelado só depois do clique no toggle.
