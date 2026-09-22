## Context

Ver proposal.md — Why. O que o desenho precisa levar em conta do código de hoje:

- O log da conversa não tem modelo: [chat.js](../../../src/client/chat.js) monta nó por
  nó e guarda só `chat.messages` com referência ao DOM. Não existe "a conversa" como
  dado, em lugar nenhum.
- O servidor já vê todos os eventos de um turno passarem por um ponto só — o `onEvent`
  de `streamTurn`, em [index.js:133-139](../../../src/server/index.js#L133-L139) —, e já
  intercepta ali o `session` para saber qual sessão interromper.
- O Agent SDK já guarda o transcript *dele* e retoma por `resume`
  ([agent.js:564](../../../src/server/agent.js#L564)). O que falta é o transcript *da
  interface*: a UI não é reconstruível do que o SDK guarda sem depender do formato
  interno dele.
- `~/.config/pinacoteca/` já existe e já é do servidor
  ([config.js](../../../src/server/config.js)), com `700`/`600` porque guarda a chave.
- Nem toda decisão da conversa vira evento: aprovar uma permissão e responder uma
  pergunta hoje destravam uma promessa no servidor e mudam o DOM no cliente, sem passar
  pelo stream.

## Goals / Non-Goals

**Goals:**

- Uma origem única do transcript (o servidor), com o cliente sendo só quem redesenha.
- Replay pelo mesmo caminho do vivo: um evento gravado entra pela mesma porta que um
  evento recém-chegado, para não haver dois jeitos de desenhar a mesma coisa.
- Nenhum arquivo novo dentro da pasta observada.

**Non-Goals:**

- Reatar o stream de um turno que ficou órfão por um reload. O turno continua rodando e
  continua sendo gravado; o board só não o acompanha ao vivo.
- Busca, renomear, exportar ou compartilhar conversa.
- Sincronizar duas abas abertas na mesma raiz em tempo real.
- Migrar qualquer coisa que hoje vive no `localStorage` (rascunho, histórico da seta pra
  cima, posições, preferências) para disco.

## Decisions

### Onde o transcript mora: `~/.config/pinacoteca/history/<slug>/`

`<slug>` é o nome da pasta observada mais um hash curto do caminho absoluto
(`basename-a1b2c3d4`): o nome dá para achar na mão, o hash resolve duas pastas de mesmo
nome em lugares diferentes.

Alternativas descartadas:

- **Dentro da pasta observada** (`.pinacoteca/`), que foi a primeira ideia do usuário: é
  metadado que o usuário não pediu, ele teria de lembrar de não commitar, e — o que pesa
  mais — o `cwd` do agente é a raiz observada, então o agente passaria a ver, grepar e
  poder reescrever o próprio transcript. O ARCHITECTURE.md já recusa isso para o layout,
  pelo mesmo motivo.
- **`localStorage`**: o teto de ~5 MB por origem não serve para transcript com entrada de
  tool e diff, e some quando o usuário limpa os dados do navegador.

### Um arquivo por conversa, JSONL, mais um índice

`<sessionId>.jsonl` por conversa — o id da sessão do SDK já é o identificador natural,
é ele que `resume` usa — e um `index.json` com `{ id, title, updatedAt, messageCount }`.
O índice existe para a subaba `Conversas` abrir sem ler todo `.jsonl`; ele é cache, e é
reconstruível a partir dos arquivos quando estiver ilegível. Escrita atômica (arquivo
temporário + `rename`), porque ele é reescrito inteiro a cada turno.

JSONL, e não um JSON único, porque o caso comum é acrescentar no fim enquanto o turno
acontece; reescrever o array inteiro a cada evento seria O(n²) de IO numa conversa longa.

### O que é gravado: os eventos do stream, mais dois que só existem no disco

Vão para o arquivo os mesmos eventos que já vão para o navegador, e mais:

- `user`: o texto que o usuário mandou, escrito no começo do turno. Ele **não** entra no
  stream — o cliente já desenha a bolha do usuário localmente no `submit`, e mandá-lo
  pelo stream criaria uma bolha duplicada.
- `permission-result`: o que o usuário respondeu a um pedido de permissão. Sem ele, um
  reload mostraria como pendente algo que já foi aprovado. Também só no disco, pelo mesmo
  motivo: ao vivo, quem pinta o veredito é o próprio clique.

O gancho de gravação é o `onEvent` de `streamTurn`, que já é o funil por onde tudo passa;
o `permission-result` sai de onde a resposta é resolvida, no `agent.js`.

### Deltas coalescidos na escrita

`text` e `thinking` chegam caractere a caractere. Gravar delta por delta daria milhares
de linhas por turno e uma leitura cara. O gravador mantém o bloco aberto em memória e
escreve uma linha só quando o tipo de evento muda ou quando o turno acaba. A coalescência
é função pura (`coalesce`), testável sem IO — é onde mora a regra.

Alternativa descartada: gravar cru e coalescer na leitura. É mais resistente a uma queda
do processo no meio do turno, mas paga o custo em toda carga do board, e a perda que ela
evita é a de um bloco de texto que o usuário está vendo na tela naquele instante.

### Replay pela mesma porta do vivo

O cliente busca os eventos e os passa por `applyEvent`, em
[chat-client.js](../../../src/client/chat-client.js), com um sinalizador `replay`. Assim
não existem duas rotinas de desenho para divergir. O sinalizador muda três coisas:

- `done` não chama `setTurnRunning(false)` como fim de turno de verdade — a restauração
  nunca ligou turno nenhum;
- `permission` sem um `permission-result` correspondente e `question` sem resposta são
  desenhadas e imediatamente fechadas no estado **expirado**, reaproveitando o
  `closeQuestion` que já existe para "o turno terminou sem resposta"; o bloco de
  permissão ganha esse terceiro estado ao lado de aprovada e negada;
- `user` vira a bolha do usuário — no vivo esse evento não existe.

### Subabas dentro de `tabs.js`

[tabs.js](../../../src/client/tabs.js) hoje faz uma coisa: troca qual painel está
visível. Subaba é essa mesma coisa num segundo nível, então o módulo é generalizado para
grupos (`showTab(group, name)`) em vez de ganhar um arquivo novo — a regra 7 da
constituição só autoriza arquivo novo quando o existente passou a fazer duas coisas.
Estado em `state.js`: `ui.activeChatTab`, ao lado do `ui.activeTab` que já existe.

### Qual conversa está aberta é do navegador, não do servidor

O id da conversa aberta vai para o `localStorage`, por raiz, em
[storage.js](../../../src/client/storage.js) — é exatamente "o que o board lembra entre
sessões", e é por aba: duas janelas na mesma pasta podem estar em conversas diferentes
sem uma arrastar a outra. O conteúdo da conversa é do servidor; qual delas você está
olhando é seu.

### Troca de conversa bloqueada durante um turno

Com turno rodando, os itens da lista ficam desabilitados. A alternativa — interromper
sozinho ao trocar — joga fora uma resposta já paga sem o usuário pedir. O botão Parar
continua sendo o único jeito de encerrar um turno.

### Teto de tamanho

Entrada de tool e diff gravados são truncados na mesma régua que a interface já usa para
mostrá-los, e o arquivo tem teto de bytes: ao estourar, os eventos mais antigos saem e
uma marca de corte fica no lugar. Não há poda automática de conversas inteiras — apagar
conversa é gesto do usuário.

## Risks / Trade-offs

- **Reload no meio de um turno** → O turno continua no servidor e continua sendo gravado;
  o board reabre a conversa até o último evento já escrito e não acompanha o resto ao
  vivo. Reabrir a conversa depois mostra o turno completo.
- **Duas abas na mesma raiz e na mesma conversa** → Os dois processos escrevem no mesmo
  arquivo por append e reescrevem o índice; o índice é último-a-escrever-vence. O log de
  uma aba não se atualiza com o que a outra fez até ser reaberto. Aceito: a ferramenta é
  de uma pessoa numa máquina.
- **Transcript é dado sensível** → Ele carrega o que o usuário disse e trechos dos
  arquivos dele. Nasce com as mesmas permissões restritas do `config.json` (`700`/`600`),
  e nunca sai da máquina.
- **Fidelidade do replay** → Nem tudo o que a UI mostra hoje vira evento; `user` e
  `permission-result` cobrem o que falta, mas qualquer estado futuro que só viva no DOM
  volta a sumir no reload. Regra a seguir: estado que precisa sobreviver vira evento.
- **Índice é cache** → Se ele divergir dos arquivos, a lista mente. Mitigado por ser
  reconstruível a partir dos `.jsonl` quando estiver ilegível ou faltando.

## Migration Plan

Não há dado antigo para migrar: hoje nada é gravado. Pasta ausente é o estado normal da
primeira execução. Quem não quiser o recurso apaga
`~/.config/pinacoteca/history/<slug>/`; o board volta a abrir na subaba `Conversas`
vazia.
