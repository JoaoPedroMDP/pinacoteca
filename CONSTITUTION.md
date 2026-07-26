1. Nunca commite código
2. Sempre crie um TODO antes de executar tarefas
3. Código sempre em inglês, comentários e documentação em português
4. Sempre atualize ARCHITECTURE.md para que ele reflita o estado atual do projeto
5. Rode `npm run check` antes de declarar uma tarefa concluída — lint, tipos e
   testes precisam passar. Se algo falhar, conserte antes de reportar; nunca
   reporte "pronto" com verificação vermelha ou não executada
6. Todo comportamento novo que se possa observar no navegador ganha um `check`
   em `test/e2e.mjs`; toda função pura nova ganha um teste em `test/unit.mjs`
7. Não invente estrutura nova sem necessidade: arquivo novo só quando o
   existente passou a fazer duas coisas. Antes de criar, leia a seção
   "Como adicionar uma feature" do ARCHITECTURE.md e siga o módulo indicado
8. Lembre o usuário de commitar depois que uma tarefa for concluída.
9. Quando for gerar mensagens de commit, não ultrapasse 50 palavras. 
   Não precisamos explicar as alterações na mensagem.
