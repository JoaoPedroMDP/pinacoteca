## REMOVED Requirements

### Requirement: Painel escondido por inteiro quando há chave gravada
**Reason**: O painel `#chat-settings` sai da aba Conversa; a configuração de
chave de API passa a viver na modal de Configurações (Models > Claude), veja
`settings-modal`.
**Migration**: Nenhuma ação do usuário — a chave já gravada continua válida.
A UI que a controla passa a ficar acessível pelo ícone de engrenagem no
rodapé do sidebar.

### Requirement: Sem chave e sem sessão de ambiente, campo de chave sempre visível
**Reason**: Mesma remoção do painel `#chat-settings`; o campo de chave
sempre visível (independente de sessão de ambiente) passa a ser regra da
subcategoria Claude em `settings-modal`, não mais da aba Conversa.
**Migration**: Nenhuma ação do usuário — o campo continua sempre visível,
agora dentro da modal de Configurações.

### Requirement: Sem chave e com sessão de ambiente, campo de chave escondido por padrão
**Reason**: O comportamento de fold condicional (campo escondido por padrão
quando há sessão de ambiente) é removido por inteiro — era a origem do bug
em que o campo, uma vez revelado, não tinha como ser escondido de novo. Na
subcategoria Claude em `settings-modal`, o campo é sempre visível, sem essa
condição.
**Migration**: Nenhuma ação do usuário. Quem contava com o campo escondido
por padrão passa a vê-lo sempre, dentro da modal de Configurações.

### Requirement: Aviso de sessão detectada revela o campo de chave sob demanda
**Reason**: Sem fold condicional, não há nada para o aviso revelar; o
aviso de sessão detectada em `settings-modal` é puramente informativo, sem
controle de clique associado.
**Migration**: Nenhuma ação do usuário — o campo de chave está sempre
acessível na subcategoria Claude, sem precisar ativar o aviso.

### Requirement: Aviso de sessão detectada tem peso visual secundário
**Reason**: O aviso, com o mesmo peso visual secundário, passa a viver na
subcategoria Claude em `settings-modal`, não mais no painel `#chat-settings`
da aba Conversa.
**Migration**: Nenhuma ação do usuário.
