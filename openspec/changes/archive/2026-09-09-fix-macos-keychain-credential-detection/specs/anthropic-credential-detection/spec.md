## Purpose

Define como a pinacoteca decide se há uma credencial Anthropic utilizável antes
de abrir uma conversa, olhando tanto a chave configurada pelo usuário quanto uma
sessão de ambiente já autenticada (`claude login`), seja qual for a plataforma
onde essa sessão foi gravada em disco.

## ADDED Requirements

### Requirement: Detecção de sessão gravada por `claude login`
O sistema SHALL considerar que existe uma sessão de ambiente quando o
`claude login` gravou credenciais no local nativo da plataforma atual, mesmo
sem nenhuma variável de ambiente de credencial exportada.

#### Scenario: Linux com `.credentials.json` presente
- **WHEN** a plataforma não é macOS e `~/.claude/.credentials.json` (ou
  `$CLAUDE_CONFIG_DIR/.credentials.json`) existe
- **THEN** o sistema reporta que há credencial de ambiente disponível

#### Scenario: macOS com credencial no Keychain
- **WHEN** a plataforma é macOS e o Keychain do usuário tem uma entrada de
  senha genérica para o serviço `Claude Code-credentials` com a conta do
  usuário do sistema operacional
- **THEN** o sistema reporta que há credencial de ambiente disponível, mesmo
  sem `~/.claude/.credentials.json` no disco

#### Scenario: macOS sem sessão nenhuma
- **WHEN** a plataforma é macOS, não há entrada no Keychain para
  `Claude Code-credentials` e nenhuma variável de credencial está exportada
- **THEN** o sistema reporta que não há credencial de ambiente disponível

### Requirement: Variáveis de ambiente continuam tendo prioridade
O sistema SHALL continuar aceitando `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`CLAUDE_CODE_OAUTH_TOKEN` ou `ANTHROPIC_PROFILE` não vazias como credencial de
ambiente, independente de plataforma, sem precisar consultar disco ou Keychain.

#### Scenario: Variável de ambiente exportada em qualquer plataforma
- **WHEN** qualquer uma das variáveis aceitas está definida e não vazia
- **THEN** o sistema reporta que há credencial de ambiente disponível sem
  checar arquivo de credenciais nem Keychain

### Requirement: Chave configurada na pinacoteca tem prioridade sobre sessão de ambiente
O sistema SHALL considerar que há credencial para conversar quando existe uma
chave configurada na pinacoteca, sem precisar consultar sessão de ambiente
nenhuma; na ausência dela, cai para a detecção de sessão de ambiente.

#### Scenario: Chave configurada presente
- **WHEN** o usuário configurou uma chave da Anthropic na pinacoteca
- **THEN** o sistema reporta que há credencial para conversar, mesmo sem
  sessão de ambiente detectável

#### Scenario: Sem chave configurada, com sessão de ambiente
- **WHEN** não há chave configurada na pinacoteca mas há credencial de
  ambiente detectável (variável ou sessão gravada em disco/Keychain)
- **THEN** o sistema reporta que há credencial para conversar
