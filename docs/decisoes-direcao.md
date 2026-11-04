# Fila de decisões da direção — entrega inicial

A Central agora dispõe de uma fila **interna** para decisões que exigem autoridade de direção. Esta implementação é opt-in e **não** envia WhatsApp ou notificações, não lê SharePoint por conta própria e não executa a decisão aprovada no atendimento do cliente. É um mecanismo de captura, revisão e auditoria, não uma autorização genérica.

## Ativação restrita

- `DIRECTION_ESCALATION_ENABLED=false` por padrão. Mudar para `true` somente após revisar o código e os testes.
- `DIRECTION_APPROVER_EMAIL=` permanece vazio por padrão. Definir no ambiente privado do Render o email exato da **conta administrativa da Central** que pode consultar e decidir; não usar o email fornecido pelo cliente ou texto no Notion para definir autorização.
- A fila usa as sessões já existentes da Central, com cookies HttpOnly, proteção de origem e sessão ativa. Um atendente comum, usuário não autenticado ou administrador diferente do email permitido recebe acesso negado. Não exige novo plano nem chave externa.
- O reconhecimento do número em `DIRECTION_CONTACT_PHONES` (PR #38) é **somente roteamento**, não autenticação da direção. A senha/sessão autenticada da Central é requisito para aprovar decisões.
- O banco SQLite precisa ser persistente e ter backup antes de implantação. As duas novas tabelas são aditivas.

## Painel administrativo (entrega seguinte)

Acesse `/direcao` no domínio da Central, com a sessão previamente autenticada na conta administrativa cujo email corresponde à variável privada. A página HTML é protegida pelo mesmo controle de autorização da API. A interface mostra pendências por categoria, pergunta, justificativa e vínculos existentes, permite responder ou cancelar com confirmação expressa e atualiza a lista após salvar. Não inclui os dados pessoais de clientes em listas de outras pessoas nem possui botão de envio ao WhatsApp.

A tela também consulta a quantidade de pendências a cada 30 segundos enquanto estiver aberta. O administrador pode solicitar permissão do navegador para avisos de novas decisões, sem incluir nomes, telefones, conteúdo de documentos ou perguntas técnicas na notificação do sistema operacional. A primeira consulta apenas estabelece uma referência e não notifica sobre pendências antigas. Esses avisos dependem do navegador e podem parar quando a aba não estiver ativa; não são notificações remotas por WhatsApp nem substituem uma fila persistente.

A tela não cria credenciais, não concede acesso ao Microsoft 365, não permite consultar documentos restritos e não permite aprovar em nome de terceiros. A autenticação por número de WhatsApp e notificações automáticas são etapas diferentes. Para acesso negado ou fila desativada, a Central deve ser configurada primeiro pelo administrador do servidor.

## API autenticada disponível apenas para a direção

- `GET /api/direction/decisions?status=pending` lista até cem pendências; filtros: `pending`, `answered`, `cancelled`, `all`.
- `GET /api/direction/decisions/:id` mostra uma decisão.
- `POST /api/direction/decisions` recebe `{conversationId,requestId,category,question,basis}`. As categorias permitidas são `tecnica`, `comercial` ou `administrativa`. O identificador de solicitação impede duplicação e não pode ser reutilizado com conteúdo diferente.
- `PATCH /api/direction/decisions/:id` recebe `{action:"answer"|"cancel",answer,version,requestId,confirmed:true}`. Exige versão atual, confirmação explícita e mantém auditoria imutável por ação.

As referências ao cliente e trabalho são capturadas **do vínculo da conversa no banco da Central**, nunca de IDs arbitrários fornecidos pela IA ou pelo cliente. A resposta administrativa é armazenada com autoria autenticada. Não é enviada automaticamente a ninguém e **não atualiza, por si só, o status do projeto no Notion**.

## A IA e o escalonamento

A resposta estruturada do modelo inclui `directorDecision` com `required`, `category`, `question` e `basis`. Só registrar decisão quando o modelo indicar explicitamente uma escolha técnica, comercial ou administrativa dependente de autoridade e simultaneamente pedir `handoff=true`. Uma dúvida genérica, oferta comercial não solicitada ou informação já confirmada não deve criar uma decisão. Se houver interrupção ou mudança de contexto durante o turno, não registrar uma decisão antiga como atual.

A Central mantém o atendimento em modo humano após o handoff. No futuro, uma interface poderá mostrar decisões pendentes e permitir que Gustavo as responda autenticado, com fluxo separado de envio aprovado ao cliente. O uso do WhatsApp para solicitar documentos administrativos exige autenticação adicional por operação, controle do acervo do SharePoint e trilha de envio, ainda não implementados.

## Segurança e critérios de verificação

- O módulo não envia mensagens, anexos ou modelos de retomada; respeita o bloqueio existente de mensagens livres fora da janela oficial de 24 horas.
- Não configura números, preços, tokens, dados financeiros ou emails reais no repositório. A proteção da fila é independente da IA comercial e do token do Notion.
- Confirmar CI `npm test` e revisar alterações antes do merge; em produção, verificar backup e `/healthz.revision`. Depois testar login como diretor, rejeição de operadores, criação idempotente, aprovação sem envio e persistência após reinício.
- Revisar risco de exposição no painel de operadores antes de disponibilizar os dados internos na UI. Uma decisão aprovada não equivale a autorização para comunicar ao cliente uma solução de engenharia sem análise técnica.

Requisitos no [Notion — decisões da IA à direção](https://app.notion.com/p/40d9fdf2efb781db9810fcceb2a26c70).