# Coexistência WhatsApp Business + Central Domum

## Objetivo

Permitir que o atendimento continue pelo aplicativo oficial WhatsApp Business no celular, sem perder as respostas humanas que chegarem à Central pela Cloud API. A mesma conversa recebe entradas do cliente, respostas geradas na Central e respostas escritas diretamente no Business, sem atribuir a mensagem do celular a um atendente individual que a Meta não identificar.

A coexistência é diferente de compartilhar um número com um conector não oficial. Não remover a conta do WhatsApp Business nem tentar reativar o número como se fosse um número novo. Usar o cadastro e a autorização já existentes.

## Caminho do evento de saída pelo aplicativo

1. Um usuário autorizado responde no **aplicativo WhatsApp Business**.
2. Se a conta estiver em coexistência e a Meta entregar o evento `smb_message_echoes` para este aplicativo, a Central recebe um webhook com assinatura HMAC verificada e `metadata.phone_number_id` esperado.
3. O servidor verifica ID único e número de origem do Business, normaliza o destinatário, grava a mensagem como `out`, preserva a data original e registra autoria `Aplicativo Business (atendente não identificado)`. Uma nova entrega do mesmo ID não gera duplicidade.
4. A IA comercial é **pausada** para essa conversa, inclusive quando estiver gerando uma resposta. Não reiniciar IA sem ação explícita de atendimento autorizado.
5. A resposta entra no histórico local da Central e nos próximos turnos de IA. Ecos entregues fora de ordem são realocados apenas quando há atraso comprovado maior que dois segundos, sem reordenar todo o histórico pelas timestamps arredondadas da Meta.
6. No adaptador do Notion, o evento sai como `Mensagem enviada pelo WhatsApp Business`, com a mensagem efetivamente registrada, origem `Atendente`, qualificação `Confirmado` (quanto ao texto, **não quanto a uma decisão técnica**) e autor individual não identificado.
7. Se a conversa está vinculada a cliente no Notion, o evento entra na fila normal, com conciliação idempotente. Se não está vinculada, a Central consulta somente clientes **existentes** com telefone correspondente e não cria um cadastro novo com base exclusivamente na resposta enviada do Business. Sem correspondência confiável, aguarda associação manual.

A mensagem pode ser exibida mesmo quando a sincronização com o Notion falhar; o registro local e o estado pendente preservam a evidência e permitem reprocessamento seguro. O texto enviado pelo Business **não deve sobrescrever silenciosamente** campos de resumo e decisões do cliente. Uma análise/atualização humana pode consolidar o histórico em resumo posteriormente.

## O que verificar na conta Meta

- Conferir o **mesmo número** em Cloud API e aplicativo Business: `is_on_biz_app=true` e `platform_type=CLOUD_API`.
- Conferir WABA, aplicativo inscrito e o webhook efetivamente configurado. A inspeção administrativa `POST /api/coexistence/verify` executa leituras na Meta sem alterar configurações; não revela credenciais ou conteúdo das mensagens. Pode falhar se a credencial não tiver permissão de consulta.
- Inscrever/validar os campos relevantes `messages`, `smb_message_echoes` e, se disponíveis no processo de onboarding, `history` e `smb_app_state_sync`. Observar inscrição na WABA **não prova** que cada campo chegou ao webhook correto.
- Em **Conexão → Diagnosticar recebimento**, conferir contadores de eventos persistentes, respostas Business identificadas, eventos na fila do Notion, última data. Usar **Conferir coexistência na Meta** para inspeção de WABA e número, preservando a configuração.
- Fazer um teste com contato autorizado: enviar uma mensagem de entrada ao WhatsApp Domum, responder pelo Business no celular e verificar o eco na Central; repetir com mensagem do cliente, receber nova resposta, confirmar histórico ordenado, ausência de resposta automática duplicada e associação correta ao Notion. Realizar o teste com autorização, sem usar números de clientes reais involuntariamente.

## Reconciliação do histórico antigo

`smb_message_echoes` reflete **novas mensagens enviadas pelo Business** após a configuração correta; não recupera, por si só, mensagens que já foram trocadas antes da coexistência ou enquanto os eventos falharam. A Meta possui fluxos específicos de **histórico inicial de onboarding** (`history`) e sincronização de contatos (`smb_app_state_sync`), sujeitos a elegibilidade e janela de ativação. A Central agora identifica a **entrega de avisos desses tipos**, mas ainda **não importa automaticamente o conteúdo**; importar dados antigos exigiria deduplicação, reconciliação de participantes, consentimento, cuidados com grupos e validação específica.

Como alternativa operacional já existente, a Central pode inspecionar/importar TXT de conversa individual exportado do WhatsApp Business, no limite e condições definidos pela ferramenta; a importação manual não reabre janela de 24 horas, não comprova veracidade de decisões técnicas e não reativa a IA sem revisão.

## Escopo e limites

- Não há integração **bidirecional irrestrita**: exclusão, edição, reação e mensagens de dispositivos auxiliares podem não chegar ao evento de eco. A cobertura real precisa ser medida por um teste na conta Domum.
- A autoria específica do celular (Gustavo, Jonatan ou outro operador) **não é inferida** por número ou texto; o evento confirma apenas que saiu da conta Business.
- Quando a Central não recebe o evento da Meta, o código não consegue reconstruir a resposta que ficou apenas no aplicativo. Essas lacunas exigem reconciliação ou importação.
- Mensagens de clientes e arquivos enviados/recebidos preservam as regras de sigilo e de acesso da Central. O evento de eco não autoriza acesso a documentos.
- A janela de 24h da Cloud API permanece independente da sincronização de histórico; para retomar, usar modelos oficiais e consentimento, como na PR #42.

## Aceite e publicação

A implementação em GitHub é proposta em rascunho e depende da PR #38. Não foi feita mudança na Meta ou no Render, nem acionado teste real. Antes de publicar: revisar diff e testes, validar backup e persistência do SQLite, conferir credenciais privadas, revisar migração aditiva de `context_lookup_jobs.lookup_only` e o novo registro de observações, fazer deploy controlado com o número preservado, checar `/healthz.revision` e executar roteiro de prova na conta de teste autorizada.

**Não declarar sincronização completa enquanto não houver evidência de eco real, pausa da IA, contexto apresentado e registro no Notion.**

Registro central: [Tarefa de sincronização do WhatsApp Business](https://app.notion.com/p/40d9fdf2efb781e1a139ed4473ab35db).
