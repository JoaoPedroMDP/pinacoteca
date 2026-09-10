## Context

Ver proposal.md - Why. O padrão de troca de painel já existe em
[tabs.js](../../../src/client/tabs.js): botões com `data-tab`, um listener
delegado no container, e um mapa `PANELS` que alterna `hidden`. A modal de
Configurações reaproveita essa mesma forma para categorias e subcategorias,
em vez de inventar um mecanismo novo.

`chat.js` já mantém três setters (`setHasKey`, `setHasAmbientCredential`,
`updateKeyFieldVisibility`) que decidem a visibilidade do campo de chave a
partir de `hasKey`/`hasAmbientCredential`. Essa lógica de fold é removida —
não é reaproveitada — porque a subcategoria Claude não tem mais estado
condicional a decidir; o campo é sempre visível.

## Goals / Non-Goals

**Goals:**
- Modal acessível por teclado (Escape fecha, foco previsível) usando o
  elemento nativo `<dialog>`, sem reimplementar backdrop/foco à mão.
- Estrutura de categorias/subcategorias que não força um mapeamento 1:1
  arquivo-por-modelo: hoje só Claude existe, mas a segunda subcategoria de
  modelo não deve exigir refatorar a primeira.
- Isolar o novo código num módulo próprio (`settings.js`) em vez de inchar
  `chat.js`, que já mistura composer, stream e (até esta mudança) o painel
  de chave.

**Non-Goals:**
- Nenhuma configuração nova em General além do placeholder.
- Nenhuma mudança de contrato do endpoint `/config` ou do formato de
  `config.json`.
- Nenhuma persistência de "última categoria aberta" — a modal sempre abre
  em General (ver Decisions).

## Decisions

### `<dialog>` nativo em vez de overlay `div` construído à mão
`<dialog>` dá `showModal()`/`close()`, fechamento por Escape e um
pseudo-elemento `::backdrop` de graça — sem gerenciar foco-trap ou
`aria-modal` manualmente. Alternativa considerada: `div` com
`position: fixed` e `inert` no resto da página; descartada por reimplementar
o que `<dialog>` já resolve, sem ganho para este caso.

Clique fora fecha via checagem de `event.target === dialogElement` no
listener de `click` do próprio `<dialog>` (clique dentro do conteúdo não
propaga até o `<dialog>` porque o conteúdo tem seu próprio wrapper) — padrão
comum para `<dialog>` sem precisar de biblioteca.

### Categorias e subcategorias reaproveitam o padrão `data-tab` de `tabs.js`
Mesmo mecanismo: botão com `data-category` (General/Models) e, dentro de
Models, botão com `data-model-category` (Claude, e no futuro outros).
Reaproveitar a forma já validada em `tabs.js` em vez de outra abstração
(nenhuma dependência nova, nenhum framework de componentização).

Estrutura do DOM (`settings-category` decide o painel de General/Models;
dentro de Models, `settings-model-category` decide qual subcategoria de
modelo mostra):

```
#settings-dialog (dialog)
  #settings-nav
    [data-category="general"] General
    [data-category="models"] Models
      #settings-model-nav
        [data-model-category="claude"] Claude
  #settings-panels
    #settings-panel-general (placeholder)
    #settings-panel-models
      #settings-model-panel-claude
        chat-key-input, chat-key-save, chat-credential-note
```

### Módulo novo `settings.js`, chave/aviso migram sem mudar de forma
`setHasKey`/`setHasAmbientCredential` continuam existindo (o servidor ainda
reporta os mesmos campos), mas passam a viver em `settings.js` e a
apontar para os elementos dentro da subcategoria Claude, sem a ramificação
de `keyFieldRevealed`. `updateKeyFieldVisibility` é removida — com fold
fora do quadro, `chatKeyInput.hidden`/`chatKeySave.hidden` são sempre
`false` (a única visibilidade condicional que resta é a do
`chatCredentialNote`, por `hasAmbientCredential`, sem clique associado).

`chat.js` perde a posse desses elementos; `chat-client.js` importa os
setters de `settings.js` em vez de `chat.js` (mesmos nomes, novo lugar).

### Modal sempre abre na categoria General
Sem estado salvo entre aberturas. Simplicidade sobre a alternativa
(lembrar a última categoria via `localStorage`, seguindo o padrão de
`storage.js`) — para duas categorias e uma subcategoria, o custo de navegar
de novo é desprezível, e evita mais uma chave de cache de exibição para
manter sincronizada.

## Risks / Trade-offs

- [Remover `#chat-settings` da aba Conversa muda onde usuários existentes
  esperam encontrar o campo] → Mitigação: o ícone de engrenagem fica visível
  permanentemente no rodapé do sidebar, não escondido atrás de outro clique
  condicional — o mesmo problema de descoberta que motivou esta mudança.
- [`<dialog>` sem polyfill em navegadores muito antigos] → Aceito: a
  pinacoteca já roda como app local servido a um navegador moderno (mesma
  suposição de `SSE`/`fetch` já em uso no restante do cliente).

## Open Questions

Nenhuma — as decisões acima cobrem o necessário para a task breakdown.
