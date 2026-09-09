## Why

`hasAmbientCredential` (`src/server/agent.js`) só detecta sessão do `claude login`
lendo `~/.claude/.credentials.json`. No Linux é onde a sessão fica; no macOS o
`claude login` grava a mesma credencial (JSON com `claudeAiOauth`) no Keychain do
sistema, sob o serviço `Claude Code-credentials` e conta = usuário do SO — o
arquivo nunca existe lá. Resultado: numa máquina Mac já logada num plano Pro/Max,
a pinacoteca relata "sem credencial" e não consegue distinguir isso de uma máquina
sem sessão nenhuma.

## What Changes

- `hasAmbientCredential` passa a também consultar o Keychain quando rodando em
  `darwin`: chama `security find-generic-password -a "$(usuário do SO)" -w -s
  "Claude Code-credentials"` e considera credencial presente se o comando sair
  com sucesso e stdout não vazio.
- Fora do macOS o comportamento não muda: arquivo `.credentials.json` continua
  sendo a única fonte de sessão de disco.
- A consulta ao Keychain é injetável (como `fileExists` hoje) para o teste de
  unidade não depender de Keychain real nem de plataforma.

## Capabilities

### New Capabilities
- `anthropic-credential-detection`: como a pinacoteca decide se há credencial
  Anthropic disponível (chave configurada, variáveis de ambiente, sessão gravada
  em disco pelo `claude login` — arquivo no Linux, Keychain no macOS).

### Modified Capabilities
(nenhuma — capability nova, comportamento nunca foi coberto por spec)

## Impact

- `src/server/agent.js`: `hasAmbientCredential`, nova função de leitura do
  Keychain, `os.platform()` para escolher a estratégia.
- `test/unit.mjs`: novos casos para `hasAmbientCredential` em macOS (com e sem
  credencial no Keychain) e garantia de que outras plataformas ignoram o
  Keychain.
- Sem mudança de API pública nem de rota — `hasCredential`/`agentEnv` continuam
  com a mesma assinatura.
