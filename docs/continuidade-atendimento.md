# Continuidade do atendimento

O atendimento automático do WhatsApp usa a API OpenAI com o histórico e o contexto consultado no Notion. O chat interno de operadores usa um agente do Notion. São caminhos diferentes: editar o agente do Notion não muda as instruções do atendimento automático.

Não é necessário webhook do Notion para dar continuidade a uma conversa. Webhooks notificam alterações em páginas e bases; não definem tom, perguntas ou memória do atendimento. A Central consulta o Notion antes da resposta e mantém o histórico local. Nenhuma assinatura de webhook ou mudança de permissão faz parte desta alteração.

## Comportamento esperado

- Responder ao pedido e, quando o cliente espera condução, fazer uma pergunta simples que avance o assunto. Não recitar cadastro, pendências ou procedimentos internos.
- Usar a resposta do cliente para continuar, sem repetir a pergunta ou o cumprimento. Distinguir primeira resposta, continuação no mesmo dia em São Paulo e retomada em outro dia.
- Aguardar quando o cliente disser que vai enviar algo ou voltar. Não acrescentar pergunta automática a um agradecimento ou acordo.
- Não prolongar a coleta de dados opcionais quando já é possível encaminhar o pedido para análise da equipe. Manter os limites de preço, prazo, análise técnica e identidade.

O modelo recebe a última resposta aceita pelo WhatsApp, mesmo quando uma rajada de mensagens a remove do trecho recente de 24 mensagens. A Central informa quais mensagens desse trecho chegaram depois da resposta. Esse trecho continua limitado; não é todo o histórico nem sincronização de mensagens antigas do celular. Envios falhos/incertos e importações não comprovam resposta enviada. Uma saudação inicial com pontuação é removida de uma resposta de continuação quando sobra texto útil; citações e frases nas quais a expressão integra o conteúdo são preservadas.

## Revisão do piloto depois da publicação no Render

| Situação | Critério de avaliação |
| --- | --- |
| “Quero regularizar minha casa”, sem cidade conhecida | Pergunta curta e pertinente para entender o caso. |
| Resposta à cidade já perguntada | Usa a cidade e continua pelo ponto útil seguinte; sem novo cumprimento. |
| “Sim”, depois de perguntar se tem terreno | Entende o “sim” pela pergunta anterior, sem recomeçar a triagem. |
| “Vou procurar o projeto e te mando” | Reconhecimento breve, sem nova coleta. |
| Cliente faz uma dúvida no meio da coleta | Responde à dúvida antes de retomar uma pendência realmente necessária. |
| Município/serviço já presentes no histórico | Não repete a pergunta respondida nem inventa confirmação documental. |
| Pedido de preço definitivo ou análise de documento | Não inventa conclusão ou valor; encaminha a necessidade real. |
| Oferta comercial não solicitada | Mantém o tratamento de fornecedor e o encerramento cordial existente. |

Os testes automatizados usam respostas e transportes simulados: verificam histórico, continuidade, proteção de escopo e a mensagem efetivamente despachada. Não comprovam a qualidade de novas respostas reais do modelo. A revisão do piloto deve usar o contato já autorizado, respeitando o orçamento existente. Esta alteração não faz chamadas pagas de avaliação, não altera modelo, limites ou números autorizados. Código/CI e publicação no Render devem ser conferidos separadamente.

Referências: [estado de conversação na API OpenAI](https://developers.openai.com/api/docs/guides/conversation-state), [webhooks do Notion](https://developers.notion.com/reference/webhooks).
