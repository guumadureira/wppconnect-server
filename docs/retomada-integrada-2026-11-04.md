# Retomada integrada da Central — 04/11/2026

## Versão preparada

A branch `codex/retomada-integrada-20261104` reúne as PRs #38–43, preservando seus commits: separação de contatos internos; conciliação dos ecos Business com o Notion; contexto geral de serviços; fila e painel de decisões da direção; retomadas manuais com modelos aprovados.

Os conflitos no servidor, nas opções do atendimento IA e nos testes foram resolvidos mantendo os recursos em conjunto. A tela Conexão apresenta as ferramentas administrativas conforme o acesso da sessão. A conta que pode revisar decisões continua sendo definida privadamente; nenhum número ganha autorização administrativa por constar no cadastro.

Foram corrigidos no fluxo de retomadas: duplicidade após estados delivered/read, mudança da janela durante a consulta Meta, colisão de identificador sem exclusão de mensagens, recuperação de envio interrompido como unknown e rejeição de parâmetros nomeados em modelos estáticos. Uma retomada incerta permanece bloqueando outra intenção mesmo após 24 horas. Resposta HTTP bem-sucedida sem identificador válido também é incerta; não provoca reenvio automático.

## Persistência e configuração

O serviço Render verificado nesta conversa usa Starter, uma instância e disco de 1 GB em `/var/data`. A revisão publicada na auditoria era `7e97ea5ef8fbdf6e55d08f666a46c40a09e11292`. O `render.yaml` é uma configuração de demonstração; não o reaplicar sobre produção.

Preservar `DATABASE_PATH=/var/data/central.sqlite`, credenciais e limites financeiros existentes. Não zerar o consumo registrado nem ampliar a lista MCP.

- `DIRECTION_CONTACT_PHONES`: lista privada de contatos internos, apenas para roteamento; vazia não muda a classificação existente.
- `DIRECTION_ESCALATION_ENABLED=false` e `DIRECTION_APPROVER_EMAIL=`: manter desligado até conferir a conta administrativa responsável.
- `NOTION_GLOBAL_CONTEXT_PAGE_ID=`: UUID com hífens da página explicitamente autorizada. Usa o token Notion existente; não herda o acesso do ChatGPT. Cache padrão de 60 segundos.
- `WHATSAPP_REENGAGEMENT_ENABLED=false`: manter desligado até revisão do modelo, conta Meta, consentimento e autorização do teste real. Não alterar WABA, número ou credenciais como efeito do deploy.

As migrações são aditivas: coluna `context_lookup_jobs.lookup_only`, observações de coexistência, tabelas de decisões e auditoria, consentimentos e retomadas. O teste de atualização verifica que contas, mensagens, vínculos e consumo anterior permanecem preservados.

## Inspeção e backup antes da publicação

`scripts/banco-central.mjs` usa apenas módulos nativos do Node 24. Não inicia o servidor, não lê `.env`, não faz chamadas de rede e não imprime conteúdos de conversas.

Executar no ambiente que possui acesso ao banco real, antes de implantar. Se o script ainda não estiver no deploy antigo, transferir o arquivo revisado por um canal autenticado; não fazer deploy apenas para obtê-lo.

```sh
node scripts/banco-central.mjs inspecionar --database /var/data/central.sqlite
node scripts/banco-central.mjs backup --database /var/data/central.sqlite --backup-dir /var/data/backups
```

A inspeção abre o banco existente somente para leitura, verifica integridade e chaves estrangeiras e mostra tamanho, WAL, espaço e contagens sem dados pessoais. O backup usa a API nativa SQLite para incluir alterações do WAL, verifica integridade completa, abre uma cópia independente de recuperação e registra SHA-256 e contagens em manifesto. Os nomes são únicos; backups existentes não são substituídos. A cópia nova é convertida para journal DELETE para ser independente do WAL; o modo do banco original não muda.

`restoreVerified=true` comprova o ensaio local dessa cópia; `externalCopyVerified=false` permanece até conferir uma cópia protegida fora do Render. Não tratar a rotina testada com dados fictícios como prova de backup do banco de produção.

## Validação e publicação

Os testes usam bancos separados, credenciais fictícias e transporte falso. O cenário integrado verifica que uma resposta pelo Business durante a consulta geral cancela a IA antes de qualquer chamada de modelo; após liberação explícita, o contexto inclui a resposta humana e a referência geral; contatos internos continuam isolados.

Antes de publicar: rodada completa de `npm test` no CI, revisão da combinação, backup real recuperável e cópia externa. Após deploy autorizado: comparar `/healthz.revision` ao SHA escolhido, conferir login e fontes Notion e testar os fluxos habilitados com contato autorizado. Não enviar mensagens, contratar serviços nem mudar permissões como efeito de teste.

Permanece fora desta versão: Microsoft Graph/SharePoint, monitoramento documental contínuo, importação automática de todo o histórico e autorização administrativa por mensagem WhatsApp. Eventos ausentes da Meta não são reconstruídos. Os painéis e testes não comprovam coexistência ou entrega real.

## Acesso ao navegador

Foi encontrada incompatibilidade entre componentes antigos `26.1016.62342` e o aplicativo instalado, que exige `26.1027.51404`. Foram acrescentadas ao cache cópias idênticas dos quatro plugins correspondentes à instalação oficial atual; 782 arquivos conferidos por SHA-256, sem remover a versão anterior. O carregamento voltou a funcionar após reiniciar a sessão de controle.

O diagnóstico de extensão encontrou Chrome em execução e extensão instalada/habilitada no Profile 1, mas ausência da chave de registro do native host `com.openai.codexextension`. O procedimento oficial da integração orienta reinstalar pelo aplicativo e proíbe reparo manual do native host. A ligação com o Chrome e o acesso ao Shell Render ainda não estão comprovados.
