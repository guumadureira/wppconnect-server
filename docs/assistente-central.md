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
