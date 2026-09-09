## Context

`hasAmbientCredential` (`src/server/agent.js:353`) hoje só olha variáveis de
ambiente e `credentialsFilePath` (`~/.claude/.credentials.json` ou
`$CLAUDE_CONFIG_DIR/.credentials.json`). Essa é a forma como o CLI oficial do
Claude Code grava a sessão do `claude login` no Linux. No macOS o mesmo login
grava a credencial (JSON com `claudeAiOauth`, mesmo formato do arquivo) no
Keychain do sistema — service `Claude Code-credentials`, account = usuário do
SO — lida pelo CLI via `security find-generic-password -a "$USER" -w -s
"Claude Code-credentials"`. Ver proposal.md - Why.

## Goals / Non-Goals

**Goals:**
- Detectar a sessão do `claude login` também no macOS, sem exigir que o
  usuário exporte variável nenhuma.
- Manter o comportamento atual em toda plataforma que não seja macOS.
- Manter `hasAmbientCredential`/`hasCredential` testáveis sem depender de um
  Keychain real nem do `process.platform` da máquina que roda o teste.

**Non-Goals:**
- Suportar Windows Credential Manager (`isWindowsCredManagerAvailable` no CLI
  oficial é outro mecanismo, fora de escopo aqui — pinacoteca hoje roda em
  Linux/macOS).
- Ler ou decodificar o conteúdo da credencial (token, `claudeAiOauth`) — só
  interessa se ela existe, igual ao `fileExists` de hoje.
- Cache do resultado do Keychain entre chamadas — `hasAmbientCredential` já
  roda por request, mesmo padrão do `fileExists` atual.

## Decisions

**Consultar o Keychain via `security find-generic-password`, replicando o
comando do CLI oficial, em vez de uma dependência nativa (`keytar` e
equivalentes).** O binário `security` já vem com todo macOS, então zero
dependência nova; uma lib nativa exigiria compilação por plataforma para um
projeto que roda numa única máquina do usuário. Chamada:
`security find-generic-password -a "<usuário do SO>" -w -s "Claude Code-credentials"`.
Sucesso (`exit code 0` e stdout não vazio) = há sessão; qualquer falha (não
achou a entrada, Keychain bloqueado, `security` ausente) = sem sessão — mesma
semântica de "arquivo não existe" que `fileExists` já tem hoje, então nenhum
erro sobe para o chamador.

**Consulta ao Keychain entra como uma segunda função injetável
(`hasKeychainCredential`), paralela a `fileExists`, não um branch dentro
dela.** `fileExists` tem assinatura `(path: string) => boolean`; o Keychain
não é consultado por caminho, é por `execFileSync`/`execFile`. Forçar as duas
formas atrás da mesma assinatura obrigaria um wrapper artificial. Separar
mantém cada parâmetro simples de fakear no teste de unidade e deixa
`hasAmbientCredential` decidir qual delas chamar a partir de `os.platform()`
(também injetável, mesmo padrão do `env` que a função já recebe).

**Chamada síncrona (`execFileSync`), não `execFile` assíncrono.** O restante
de `hasAmbientCredential`/`hasCredential` é síncrono (o próprio `fileExists` é
síncrono) e é chamado de `runTurn` antes de abrir a conversa — não há
paralelismo a ganhar aqui, e manter síncrono evita mudar a assinatura de
`hasCredential`/`hasAmbientCredential` para `Promise`, o que se propagaria
para `runTurn` e para o teste de unidade inteiro sem necessidade.

## Risks / Trade-offs

- **Prompt de permissão do Keychain.** Dependendo da política do item salvo
  pelo `claude login`, o macOS pode pedir para o usuário autorizar o acesso na
  primeira consulta. Mitigação: like o CLI oficial faz a mesma chamada
  rotineiramente sem esse prompt aparecer em uso normal (o item é salvo com
  ACL liberando o processo `security`), o comportamento esperado é idêntico
  aqui; se aparecer, é um pedido do próprio SO, não uma trava da pinacoteca.
- **Nome do serviço/formato do comando é comportamento não documentado
  publicamente do CLI, sujeito a mudar em versão futura.** Mitigação: falha
  aqui degrada para "sem sessão detectada" (mesmo caminho de erro de hoje),
  nunca quebra a pinacoteca — na pior hipótese volta a pedir a chave, que já é
  o fallback atual.
- **`security` ausente ou demorado.** Mitigação: `execFileSync` com timeout
  curto (mesma ordem de grandeza do `srg=1e4` — 10s — que o próprio CLI usa) e
  qualquer exceção tratada como "sem credencial", nunca propagada.

## Migration Plan

Mudança aditiva e local a uma função pura; sem dado persistido, sem rota nova.
Deploy é o próprio `npm run check` + commit; nada a migrar nem reverter além
de git revert.
