## 1. Detecção via Keychain no macOS

- [x] 1.1 Adicionar `hasKeychainCredential(env, execFileSyncFn)` em
      `src/server/agent.js`, rodando `security find-generic-password -a
      "<usuário do SO>" -w -s "Claude Code-credentials"` (timeout curto,
      qualquer erro/exit != 0 vira `false`) e verificar com teste de unidade
      isolado (fake `execFileSync` sucesso/erro/timeout).
- [x] 1.2 Atualizar `hasAmbientCredential` para, quando `os.platform() ===
      'darwin'` (platform injetável), consultar `hasKeychainCredential` além
      do arquivo/variáveis atuais, e verificar com teste de unidade que uma
      falsa credencial de Keychain conta como sessão presente.
- [x] 1.3 Verificar que em plataforma diferente de `darwin` o Keychain nunca é
      consultado (teste de unidade com um fake que lança se for chamado).

## 2. Cobertura e documentação

- [x] 2.1 Atualizar os testes existentes de `hasAmbientCredential`/
      `hasCredential` em `test/unit.mjs` para cobrir os três cenários do spec
      (Linux com arquivo, macOS com Keychain, macOS sem sessão) e confirmar
      que `npm run check` passa.
- [x] 2.2 Atualizar o comentário/doc de `hasAmbientCredential` em
      `src/server/agent.js` para descrever a checagem de Keychain no macOS, e
      registrar a decisão em ARCHITECTURE.md conforme a regra 4 da
      CONSTITUTION.md.
