# Retomadas de atendimento com modelos Meta — entrega inicial

## Objetivo e limites

A janela de atendimento do WhatsApp Business Platform permanece em vigor. Após 24 horas da última mensagem recebida do cliente, mensagens livres da empresa continuam bloqueadas. Esta entrega acrescenta **envio manual de um modelo de mensagem estático e aprovado pela Meta**, com consentimento documentado, proteção contra duplicidade e auditoria. Não permite driblar as regras da plataforma, não muda a API oficial e não envia automaticamente lembretes ou notificações.

## Segurança e ativação

Por padrão `WHATSAPP_REENGAGEMENT_ENABLED=false`: não é possível enviar, mesmo se o código for publicado. Para ativar, o administrador deve conferir no WhatsApp Manager que existe um **modelo aprovado** para a conta e registrar seu nome e idioma exatos no ambiente privado do Render:

- `WHATSAPP_REENGAGEMENT_ENABLED=true`
- `WHATSAPP_BUSINESS_ACCOUNT_ID=` (ID da conta Meta da empresa)
- `WHATSAPP_REENGAGEMENT_TEMPLATE_NAME=` (nome exato do modelo, apenas letras minúsculas, números e underscore)
- `WHATSAPP_REENGAGEMENT_TEMPLATE_LANGUAGE=pt_BR` (idioma e região do modelo aprovado)

O servidor usa a credencial Meta já configurada e consulta a API de modelos da conta para verificar a aprovação atual, nome, idioma e categoria (`UTILITY` ou `MARKETING`) antes de enviar. Essa leitura pode exigir permissões administrativas da Meta não presentes na credencial atual; não ampliar permissões ou contratos automaticamente. Modelos com variáveis ou cabeçalhos de mídia são rejeitados neste estágio.

## Registro de autorização e uso

A tela fica em `/retomadas`, protegida por login com perfil administrador. Somente esse perfil pode registrar, revogar ou consultar consentimento; o registro exige referência verificável e origem da autorização (`whatsapp`, `formulario`, `contrato`, `outro`). Não inferir consentimento a partir de uma conversa existente, contrato não revisado ou cadastro no Notion. Um registro de autorização pelo operador **não significa que o cliente de fato consentiu**; o administrador responde pela evidência e pelo atendimento à política Meta e à legislação aplicável.

Após verificar nome/idioma e destinatário, a tela exige duas confirmações antes da solicitação. O servidor confere novamente a aprovação na Meta, consentimento por categoria e janela fechada, e evita retomada repetida em menos de 24 horas. Não existe campo para texto livre, parâmetros arbitrários, arquivos ou destinatário diferente do telefone vinculado à conversa.

Uma solicitação recebe um identificador único. Em caso de falha de rede ou resultado incerto, o sistema não reenvia automaticamente: mantém o registro pendente de conferência. As notificações de entrega do webhook atualizam estados quando associadas a um ID enviado confirmado. A janela de mensagens livres só abre novamente após uma nova mensagem do cliente.

## Auditoria e dados

O servidor adiciona três tabelas SQLite, sem alterar linhas antigas: `template_consents`, `template_consent_audit` e `template_resumptions`. Registra autor, categoria, evidência, data, estado do envio e identificador Meta; o conteúdo do template não é duplicado no banco e não são salvos tokens. O painel `/retomadas` permite conferir o histórico, a revogação e o resultado.

Os dados são restritos ao administrador da Central. Modelos de marketing devem ter autorização compatível com marketing; modelos utilitários exigem autorização compatível com utilidade. A aprovação do modelo **não substitui** consentimento nem garante entrega. Custos e regras da Meta devem ser conferidos no painel oficial da conta.

## Verificações antes de produção

1. Revisar PR, código e CI com testes `npm test` verdes no commit final.
2. Garantir backup e persistência do banco SQLite do Render.
3. Confirmar WABA, aprovação, idioma, categoria, permissões e token do servidor — sem expor credenciais.
4. Implantar com `WHATSAPP_REENGAGEMENT_ENABLED=false`; conferir `/healthz.revision`, painel e acesso administrativo.
5. Fazer teste no ambiente de homologação com transporte falso; depois, se houver autorização, habilitar somente para um teste real consentido e verificar status na Meta e no histórico.
6. Não usar a retomada para anúncios não solicitados, contato sem evidência ou envio em massa.

No Notion: [Retomadas fora de 24 horas](https://app.notion.com/p/40d9fdf2efb781f5aeb3c8d9ed467220).

Esta PR não integra Microsoft Graph, não autentica Gustavo pelo telefone e não envia consultas internas da IA para ele automaticamente. Esses temas têm atividades próprias.
