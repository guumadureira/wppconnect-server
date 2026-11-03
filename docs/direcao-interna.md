# Direção interna: roteamento protegido (primeira entrega)

## Situação

Esta alteração é **parcial e opt-in**. Não habilita comandos administrativos via WhatsApp, pesquisa irrestrita de documentos, respostas de IA internas, envios ao cliente ou novas permissões. Não modifica o número da Meta, os modelos de mensagem ou o banco de dados existente.

### Comportamento

- Uma lista privada `DIRECTION_CONTACT_PHONES`, vazia por padrão, identifica números de contatos internos para **roteamento**, não como prova suficiente de identidade/autoridade.
- Um contato dessa lista não recebe respostas da **IA comercial** mesmo se `AI_ALLOW_ALL_CONTACTS=true` ou estiver no piloto; a aplicação pausa a assistência automática. Também impede a reativação comercial do mesmo contato e invalida jobs antigos.
- Uma mensagem do contato interno continua no histórico local da conversa. Se `NOTION_AUTO_REGISTER_CONTACTS=true`, ela não é registrada como evento de cliente, não vira resumo automático de um cadastro de cliente e não cria um novo cliente quando o telefone interno não é encontrado.
- Cadastros já existentes e relacionamentos Notion são preservados. O acesso a fontes do Notion permanece restrito à integração e seus permissões, sem elevar privilégios ao WhatsApp.
- Não envia mensagens ao número interno por este novo código. O atendimento humano na Central permanece disponível.

### Configuração e ativação

1. Revisar testes, riscos e requisitos de privacidade.
2. Validar banco persistente, backup e revisão do Render antes de considerar deploy.
3. No Render, configurar **apenas em ambiente privado** `DIRECTION_CONTACT_PHONES` com telefones internacionais autorizados (DDI+DDD+número, somente dígitos, separados por vírgula). Não gravar telefones, senhas ou tokens no Git, no Notion ou em logs.
4. Publicar o commit revisado e comparar `/healthz.revision`; verificar mensagens novas internas com um teste autorizado, sem envio automático nem duplicação do cadastro.
5. Caso o número não esteja configurado, o comportamento existente permanece. Para retirar o guard, remover o número do ambiente privado e aplicar a mudança, após revisar os efeitos.

### Segurança e continuidade

Número recebido por webhook legítimo não é autenticação suficiente para consultar contratos, dados financeiros, documentos pessoais ou enviar arquivos da empresa. Para autorizar operações administrativas, implementar uma sessão interna autenticada, níveis de permissão por ação, confirmação adicional para documentos sensíveis, auditoria, limitação de escopo e revogação.

A fila de **perguntas da IA para Gustavo** ainda precisa ser implementada com controle de acesso, cliente/trabalho, fontes, estado pendente/resolvido, notificações e revalidação de contexto; não enviar automaticamente decisões ao cliente.

A retomada fora das 24 horas deve usar **modelos aprovados pela Meta** quando couber. Este commit não altera o bloqueio de mensagens livres pela Cloud API.

Referência do escopo no Notion: [Sistema integrado — Clientes e trabalhos](https://app.notion.com/p/c08cfea9082d448c8e2067d2e8fee2c1).