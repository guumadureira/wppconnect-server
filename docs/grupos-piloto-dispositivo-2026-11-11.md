# Piloto privado de leitura de grupos existentes

Estado: preparação em branch isolada, **sem deploy, sem aparelho vinculado e sem teste real**. Requisito autorizado por Gustavo em 11/11/2026: preparar piloto WPPConnect para grupos selecionados, sem respostas automáticas. A validação de contexto Notion e o envio pelo ChatGPT/Notion continuam frentes separadas.

## O que está incluído

- Reaproveita o leitor TXT e a tela `/grupos` da PR #51, integrados à main atual. Acesso **somente administrativo**, habilitação explícita e nenhuma tabela criada com as flags desligadas.
- Coletor externo ao processo oficial, sem chave Meta ou token Notion, observando `onAnyMessage` apenas para grupos selecionados. Mensagens particulares são descartadas antes da fila.
- Recepção HMAC do corpo bruto + timestamp, sessão fixa, grupo externo vinculado a ID local, deduplicação e rejeição de ID reaproveitado com conteúdo diferente.
- Fila SQLite privada no computador coletor. Falha, timeout ou confirmação perdida conserva o evento para nova tentativa do mesmo ID. Até 1.000 eventos na fila; atingir capacidade interrompe a captura e registra lacuna persistente. Receptor limitado a 10.000 mensagens por grupo e 120 requisições/minuto.
- Texto, autor observado, origem e horário; imagens/documentos/áudios/vídeos ficam como **marcadores de conteúdo não coletado**. Nenhum download de mídia, transcrição, envio, leitura de documento ou escrita no Notion.
- Estado de conexão, fila e lacunas. Sinal ausente por 90 segundos indica desconexão; SDK `isConnected` não garante estado instantâneo nem cobertura integral.

## Limites essenciais

O código do coletor não chama operações de envio, mas uma sessão de dispositivo vinculado **não é uma credencial nativa limitada a leitura**. O SDK/browser poderá tecnicamente acessar a conta vinculada; o filtro limita o que este código persiste e encaminha. O emparelhamento exige revisão e confirmação explícita na hora, além da escolha do grupo e computador. Não abrir QR em painel público, gravar QR em logs, enviar tokens em chat ou expor o perfil do navegador.

Não há coleta retroativa automática. Eventos marcados pelo SDK como histórico de sincronização são ignorados. Períodos desconectados, reinícios e limitações do SDK podem deixar lacunas sem contagem exata. `observedGaps=0` não significa zero mensagens perdidas. Importação TXT e dispositivo usam chaves diferentes; não importar o mesmo período por ambos presumindo deduplicação entre fontes. Não interpreta edições/revogações como substituição do original; divergência de ID exige revisão, sem descarte/reenvio automático.

O piloto **não fornece contexto de grupos à IA nem sincroniza Notion**. Validar primeiro a captura e a separação por trabalho; só depois definir vínculos grupo ↔ trabalho ↔ cliente e integrar às PRs #54/#55 com fontes e revisão. Não anunciar garantia de resumo atualizado com esta entrega.

## Configuração do ensaio

1. Escolher **um grupo fictício ou interno** e um computador privado que possa permanecer ligado. Antes de usar grupos com terceiros, definir explicitamente escopo e acesso. Não usar banco de produção.
2. Iniciar uma cópia isolada da Central em modo demo, banco próprio e `GROUP_HISTORY_ENABLED=true`. Criar administrador fictício pela interface e cadastrar o grupo em `/grupos`. Guardar o ID local retornado por `/api/groups`.
3. No diretório `pilot/wppconnect`, instalar a dependência isolada fixada em `2.3.6` (`npm install`) apenas no computador escolhido, com Node 24 e Chrome/Chromium compatível. A raiz da Central continua sem dependências. Registrar lockfile e versões resolvidas após validar a instalação; nesta preparação o SDK **não foi instalado nem executado**.
4. Preparar `.env` privado nesse diretório, com permissões restritas. Valores privados não pertencem a este documento:

| Variável | Uso |
| --- | --- |
| `GROUP_COLLECTOR_ENABLED` | `true` somente no computador piloto |
| `GROUP_PILOT_SESSION` | Nome exclusivo e idêntico no receptor e coletor |
| `GROUP_PILOT_EXPECTED_ACCOUNT` | WID exato da conta autorizada, como identificador `@c.us` ou `@lid`; comparar antes de coletar |
| `GROUP_PILOT_KEY` | Credencial aleatória exclusiva de pelo menos 32 caracteres, entregue por canal privado |
| `GROUP_PILOT_TARGET` | URL HTTPS do ensaio terminada em `/webhooks/group-pilot`; HTTP somente loopback |
| `GROUP_PILOT_BINDINGS_JSON` | Array de objetos `jid` e `groupId`; no máximo 20, começar com 1 |

5. Para descobrir o ID externo após autorização do pareamento, executar no diretório privado `node --env-file=.env collector.mjs --discover`. Esse modo lê somente os nomes/IDs dos grupos para `private/groups.json`, não começa captura nem envia ao receptor. QR temporário em `private/pairing.png`, somente local, removido ao concluir. Escolher o JID do grupo autorizado; não copiar a lista inteira ao Notion ou ao chat. `getAllGroups` é API documentada mas depreciada no SDK atual; validar compatibilidade no ensaio.
6. Configurar a mesma lista e credencial no **receptor isolado**, mais `GROUP_PILOT_ENABLED=true` e a sessão. O grupo local precisa existir no banco do ensaio. Reiniciar apenas a instância do ensaio.
7. Iniciar `npm start` dentro de `pilot/wppconnect` e acompanhar `/grupos`. Para apenas importar TXT, manter `GROUP_PILOT_ENABLED` desligado. O início padrão da raiz nunca inicia o SDK nem solicita QR.

## Aceite do piloto

- Mensagem fictícia de entrada e saída pelo aplicativo aparece uma vez no grupo correto, com fonte e autor/horário preservados.
- Conversa particular e grupo fora da lista não são persistidos pelo coletor/receptor.
- Arquivo aparece como pendência de conteúdo; não afirmar interpretação ou disponibilidade do original.
- Desligar o coletor torna a desconexão visível; confirmar recuperação da fila sem duplicidade. Ausência de backfill fica explícita.
- Nenhuma linha nova nas conversas individuais, jobs IA ou eventos Notion por causa de mensagem do grupo. Atendimento oficial continua independente.
- Encerrar com SIGINT/SIGTERM fecha browser e sinaliza desconexão. Se houver falha abrupta, o estado envelhece em 90 segundos.
- Registrar somente contagens, horários, versões e resultados, sem conversas integrais nem segredos.

## Desativação e próximos passos

Validação desta preparação: `npm test`, **330 testes aprovados, zero falhas**, com bancos temporários, SDK/eventos e transporte simulados. Casos incluem filtro de particulares, assinatura inválida, sessão/grupo não autorizado, conflito de ID, recuperação da fila após resposta perdida e ausência de escrita nas conversas individuais/IA/Notion. Sintaxe do runner verificada com `node --check`. A tentativa de QA visual por Playwright foi impedida pelo ambiente: Chromium instalado abortou ao criar o socket local (`Operation not permitted`). Rotas/autenticação do painel foram verificadas por HTTP; não declarar inspeção visual aprovada. Instalação do SDK e pareamento continuam pendentes no computador escolhido.

Parar o coletor, desligar `GROUP_PILOT_ENABLED` na instância de ensaio e manter arquivos privados para revisão. Desvincular o aparelho pelo WhatsApp quando autorizado; não excluir histórico/bancos como rollback automático. Nada nesta branch altera Meta, OAuth, permissões Notion, retomada da IA ou serviço Render existente.

Para implantação futura: testar instalação real do SDK/browser, confirmar conta/grupo, revisar dependências resolvidas e permissões, backup restaurável do banco e avaliar hospedagem isolada. Aprovação desta preparação não equivale a habilitar produção ou dar acesso a todos os grupos.

Referências primárias lidas em 11/11/2026: [SDK WPPConnect](https://github.com/wppconnect-team/wppconnect), [CreateOptions](https://wppconnect.io/wppconnect/interfaces/CreateOptions.html), [Whatsapp](https://wppconnect.io/wppconnect/classes/Whatsapp.html), [Message](https://wppconnect.io/wppconnect/interfaces/Message.html). A [Groups API oficial](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups) não atende números do aplicativo Business na documentação consultada.
