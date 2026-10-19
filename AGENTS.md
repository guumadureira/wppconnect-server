# Desenvolvimento da central

- O projeto ativo é a central Node.js 24+ em `server.mjs` e `public/index.html`. Leia `INICIO.md`. O README histórico do WPPConnect não descreve o código ativo.
- Cada tarefa de nuvem já é isolada. Use este checkout; não crie worktrees sem pedido explícito do usuário.
- Não sobrescreva o histórico Git, a licença, backups, `.env` ou o banco local. Não restaure o código legado removido para começar o projeto do zero.
- O padrão é `demo`. Não habilite `live`, contate clientes, altere a Meta, contrate provedores ou publique a aplicação como efeito colateral de testes.
- Execute `npm test`. Testes de integração usam bancos temporários e um transporte falso; não exigem credenciais reais.
- Não instale dependências só para iniciar o projeto: ele usa módulos nativos do Node.
- Mantenha valores de tokens, senhas e segredos fora dos arquivos versionados e logs. O diagnóstico da conexão deve mostrar apenas nomes/presença, nunca valores.
- Valide alterações na interface por requisições ao servidor e, quando disponível, por navegador com usuários e dados fictícios em um banco separado.
- Credenciais presentes não comprovam conexão com a Meta. Distinga testes simulados, requisições reais e publicação nos relatos.
