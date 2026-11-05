# Homologação — pausa de 60 minutos após resposta do WhatsApp Business

**Status:** proposta implementada somente em branch de homologação. Não realizar merge nem deploy sem revisão, testes e autorização separada. Referência de acompanhamento: [Central Domum — comprovar sincronização com WhatsApp Business](https://app.notion.com/p/40d9fdf2efb781e1a139ed4473ab35db).

## Escopo

A chegada de uma resposta humana pelo aplicativo WhatsApp Business (`smb_message_echoes`) interrompe imediatamente a IA e invalida respostas pendentes/em geração. Apenas quando a IA estava atendendo antes do eco, ou já existia pausa temporária por eco, grava-se no SQLite um prazo de **60 minutos** depois desse evento. Novo eco legítimo renova a janela; mensagens duplicadas por `provider_id` não renovam.

A expiração do prazo **nunca aciona uma resposta sozinha**. Somente uma nova mensagem do cliente, recebida depois do prazo, pode reativar a assistência. Mensagens de clientes que chegaram durante a pausa permanecem no histórico e entram no contexto da próxima resposta quando ela for permitida.

## Configuração de homologação

```dotenv
AI_BUSINESS_ECHO_AUTO_RESUME_ENABLED=true
AI_BUSINESS_ECHO_RESUME_MINUTES=60
```

As variáveis têm efeito apenas onde forem configuradas. **O padrão é `false`**, inclusive quando a nova versão do código estiver presente. Não definir variáveis no ambiente de produção como parte desta PR.

## Limites de segurança

- Handoffs manuais, pedidos expressos de atendimento humano, mudanças de responsável durante a pausa, bloqueios internos, contatos da direção e conversas encerradas não podem ser reativados pelo temporizador. Um responsável já atribuído **antes da pausa**, quando a conversa estava em modo assistido, não é por si só um handoff e pode continuar no fluxo. O identificador do responsável original é preservado para detectar mudanças.
- O recurso depende de `AI_ENABLED`, números autorizados, orçamento, elegibilidade do atendimento e janela de 24 horas da Meta; não contorna esses requisitos.
- Quando a IA está pausada, a chegada de pedido explícito por humano torna a pausa permanente até liberação manual, inclusive se o tempo ainda não venceu.
- Repostas enviadas pela Central por um atendente permanecem em modo humano e exigem liberação explícita (fora do escopo deste piloto, que trata ecos do Business).
- O prazo e o responsável vigente no momento da pausa ficam em `ai_control.resume_after` e `ai_control.resume_owner_id`, colunas nullable adicionadas na inicialização sem sobrescrever estados anteriores. O prazo usa a data real da mensagem humana, não o instante de entrega do webhook. Estados nulos não autorizam retomada.
- Não utilizar timers de processo para envio. As verificações acontecem somente no recebimento de nova mensagem do cliente, com validação de época e versão para invalidar execuções antigas.
- Sem alterações de assinatura de webhook na Meta; `smb_message_echoes` foi confirmado em teste anterior. Não mover nem duplicar registros no Notion automaticamente por conta deste recurso.

## Critérios de aceitação (testes isolados)

1. Eco cancela resposta pendente e muda para `human`, com prazo aproximadamente 60 minutos adiante.
2. Durante a janela, nova mensagem do cliente é registrada sem criar resposta automática.
3. Após vencimento, não ocorre envio espontâneo; uma **nova mensagem posterior** pode liberar a IA e usar histórico anterior, desde que a conversa seja elegível.
4. Eco duplicado não gera novo registro nem novo prazo; eco distinto reinicia 60 minutos.
5. Pedido por humano, atendimento designado e pausa manual não são revertidos pelo prazo, mesmo se chegar novo eco.
6. Webhook atrasado com data da mensagem anterior ao prazo não provoca retomada indevida.
7. Após reiniciar o processo, prazo e bloqueio continuam persistidos; testes usam banco isolado e transporte falso.
8. Conversa previamente assistida e atribuída a um responsável pode retomar se a atribuição permanecer igual; se o responsável for alterado durante a pausa, a retomada é bloqueada.
9. A interface mostra o modo atual do servidor, priorizando-o sobre cache antigo da tela, e comunica explicitamente quando a IA está pausada.
10. Com flag desligada, permanece o comportamento anterior: pausa até liberação explícita.

## Homologação antes de qualquer deploy

Executar `npm test` (Node.js 24+) e conferir os cenários adicionais de `test/ai-attendance.test.mjs`; revisar proteção de contexto e gravação de mensagens duplicadas; auditar backup SQLite; comparar alteração da branch com a versão publicada; obter autorização explícita de Gustavo antes de merge, ativação de flag ou deploy. Não habilitar a IA para todos os contatos como efeito da homologação.

**Fora do escopo:** transcrição de áudios enviados, sincronização automática dos grupos do Business App e migração do histórico antigo — requisitos acompanhados separadamente no Notion.
