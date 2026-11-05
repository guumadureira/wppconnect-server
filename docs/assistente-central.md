# Assistente interno e homologação semanal

## Implementado nesta branch

Assistente opcional da Central via OpenAI, independente dos créditos dos agentes Notion. Consulta o contexto atualizado do cliente selecionado em cada comando, lista documentos das páginas vinculadas e pode consultar texto dessas páginas. Mantém fontes para abrir a preparação de documentos existente. Respostas sugeridas passam por revisão no rascunho. Não envia mensagens nem altera cadastros pelo texto do modelo.

Histórico separado por operador e assinatura, cliente fixo por tarefa e prevenção de repetição. O consumo é somado aos limites mensal e total existentes, incluindo reservas de chamadas incertas. OPERATOR_AI_ENABLED=false é o padrão; após publicação autorizada, habilitar explicitamente para usar a chave OpenAI existente. Não requer assinatura nova. Não há teste pago nesta revisão.

O agente Notion anterior permanece disponível como opção. SharePoint direto e leitura dos bytes de PDF pelo novo assistente não estão implementados. Listar anexo não significa ler seu conteúdo. Texto consultado é limitado e pode ser parcial.

## Prioridades de teste com contatos autorizados

1. Documentos: selecionar cliente, pedir documento da proposta, conferir fonte, abrir Documentos, revisar destinatário e anexo, confirmar explicitamente e conferir resultado. Repetir com conversa concluída e com janela WhatsApp vencida; esta última deve exigir o fluxo permitido pela Meta.
2. Contexto: alterar informação fictícia no cadastro Notion, pedir atualização em nova mensagem da mesma tarefa e conferir mudança; não confundir falha de consulta com cadastro ausente. Conferir registro do resumo de uma conversa nova no Notion e ausência de duplicatas de telefone.
3. Celular: responder pelo Business durante atendimento IA; conferir autoria, mensagem única, contexto e pausa da IA. Isso depende dos eventos de coexistência entregues pela Meta. A presença do código não comprova assinatura nem entrega dos eventos.
4. Gustavo: usar sua sessão autenticada no assistente interno; pedir situação de um cliente, sugestão de resposta e documento. A troca de assinatura/conta não deve exibir tarefas privadas de outro operador. Roteamento de contato interno por DIRECTION_CONTACT_PHONES não concede poderes administrativos por WhatsApp. Assistente pessoal administrativo pelo WhatsApp permanece pendente de autenticação própria.
5. Falhas: indisponibilidade Notion, orçamento esgotado, resposta incerta e mudança de vínculo durante consulta devem aparecer claramente e não gerar repetição automática ou envio.

## Limites da homologação

Os testes locais usam transportes simulados e bancos separados. Não comprovam entrega Meta, qualidade de atendimento em conversas reais, atualização contínua de todos os documentos, recuperação retroativa de todo o histórico ou acesso corporativo SharePoint. Publicação e habilitação dependem de aprovação. Preservar backup antes da publicação.

## Exclusão e interface — complemento de 04/11

Excluir chat remove mensagens, fontes e sugestões da cópia local do operador, com confirmação. Mantém identificadores técnicos de comandos para impedir reexecução e o consumo contabilizado. Não exclui sessão remota Notion, backups nem conversas dos clientes. Tarefas ativas e ações pendentes precisam terminar antes da exclusão. Outros operadores não podem excluir o chat. A rota DELETE usa sessão, origem e confirmação explícita.

Títulos redundantes das páginas Conversas, Assistente interno e Contatos deixam de ocupar espaço e permanecem acessíveis a leitores de tela. Fontes de mensagens e composição aumentadas para 16 px, controles e metadados para 12–14 px, preservando cores.

## Custos e bloqueios

O assistente OpenAI consome API, assim como atendimento e transcrição, com reserva e limite compartilhado. Não foi aumentado o teto autorizado nem comprado saldo. Créditos ChatGPT são separados da API. O agente Notion mantém seu próprio bloqueio de créditos; consulta direta de páginas não executa esse agente. Limites, permissões, tamanho de contexto e falhas de integração também podem impedir uma operação: aumentar o orçamento não corrige essas causas.

Não foi consultado o faturamento privado nem comprovado o saldo atual em produção nesta etapa.

## SharePoint: dependência externa identificada

Perfil corporativo diretoria@domumenge.com.br confirmado pelo conector deste ChatGPT em 04/11. Essa autenticação pertence ao conector, não pode ser copiada para o Render. Não há adaptador Microsoft Graph na aplicação. O usuário informou não saber se existe cadastro Entra para a Central.

Para conexão servidor a servidor:
1. Conferir aplicativos existentes no Entra antes de criar um cadastro de locatário único para a Central.
2. Configurar Microsoft Graph com permissão de aplicação Sites.Selected e conceder leitura somente ao site Domum escolhido. Consentimento administrativo e concessão ao site são etapas distintas; sem ambos não há acesso.
3. Guardar credencial exclusivamente no ambiente seguro do servidor; não enviar em chats nem versionar. Não reaproveitar tokens de sessão do conector ChatGPT.
4. Implementar o adaptador com seleção explícita de biblioteca/pasta vinculada ao cliente, paginação e download autenticado limitado; integrar o arquivo ao fluxo existente de prévia e confirmação. Bloquear pesquisa ampla ou cruzamento de pastas de outros clientes.
5. Testar acesso permitido e negado, indisponibilidade, expiração, tamanho de arquivo e destinatário antes de liberar envio.

Até essas etapas estarem concluídas, não anunciar busca SharePoint como funcional. O MCP /mcp existente da Central já atende consulta de conversas, preparação/confirmação de envios e recursos de anexos autenticados; ele deve ser ampliado, não duplicado. Habilitação em um cliente ChatGPT depende da configuração desse cliente e não ocorre por disponibilizar uma rota apenas.

Fontes: https://learn.microsoft.com/en-us/graph/permissions-selected-overview e https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
