# Piloto de atendimento por IA

O servidor possui adaptador OpenAI Responses com o modelo fixo `gpt-5.4-mini-2026-03-17`. A chave privada não habilita o atendimento sozinha. A entrega mantém o consumo desligado por padrão e inclui um ensaio roteirizado sem uso de modelo.

## Primeiro teste sem consumo

**Critério de aceitação atualizado:** o usuário quer testar pelo próprio telefone, em uma conversa real no WhatsApp, um novo contato que informa sua necessidade, responde perguntas breves, fornece os dados mínimos de cadastro e envia um arquivo solicitado. A central deve conferir duplicidade, criar ou relacionar o cadastro no Notion, registrar necessidade/município/pendências e relacionar a evidência recebida, preparando a passagem para a equipe. O telefone de piloto fica somente na configuração privada. Um ensaio roteirizado não satisfaz esse teste integral.

O percurso foi implementado para o piloto com AI_AUTO_REGISTER=true: usa nome, município e serviço citados literalmente em mensagens identificadas, confere a declaração do nome do solicitante e consulta duplicidade. Um único cadastro com mesmo nome e telefone é reaproveitado; divergências, múltiplas correspondências e contatos comerciais são encaminhados à equipe. Arquivos recebidos são registrados no histórico com referência privada para a central. A IA confirma apenas o recebimento, sem leitura/validação de conteúdo. A comprovação do percurso real ainda depende do deploy, da configuração privada e do teste pelo telefone.

O usuário autorizou teste pela OpenAI com teto total de US$ 5, sem renovação mensal nem recarga automática. O telefone autorizado é configurado somente no ambiente privado. A consulta autenticada do modelo retornou HTTP 200; isso não confirma saldo ou crédito disponível para gerar respostas. A API pública de conteúdo do Notion e as capacidades de IA/agentes do Notion são serviços distintos.

Depois de publicar esta versão, entre como administrador e abra **Conexão → Atendimento por IA → Testar fluxo sem consumo**. Use somente informações fictícias. O ensaio tem respostas predeterminadas para conferir a interface e o encaminhamento; ele não demonstra a qualidade da IA. Não usa a chave, não envia ao WhatsApp, não grava conversas e não altera o Notion.

## Piloto real após autorização de consumo

Configure os campos diretamente no ambiente privado do Render:

```dotenv
OPENAI_API_KEY=
AI_ENABLED=false
AI_ALLOWED_PHONES=
AI_MONTHLY_BUDGET_USD=0
AI_TOTAL_BUDGET_USD=0
AI_AUTO_REGISTER=false
```

O administrador precisa transferir a chave de forma privada, preencher somente os telefones de teste autorizados (com país e DDD, sem símbolos, separados por vírgula) e definir um teto autorizado maior que zero e de até US$ 100. Somente depois deve usar `AI_ENABLED=true` e atualizar o serviço. O conector deste chat e o arquivo local `.env` não são transferidos automaticamente para o Render. Não cole a chave no chat nem a versione. Enquanto o teto for zero ou a flag estiver desligada, não há chamada de modelo pelo adaptador.

O limite mensal local e o teto total são estimativas/reservas em USD persistidas no SQLite. O teto total soma todos os meses e não é renovado: o piloto autorizado usa AI_MONTHLY_BUDGET_USD=5 e AI_TOTAL_BUDGET_USD=5. AI_TOTAL_BUDGET_USD=0 bloqueia as chamadas. Preservar o mesmo banco é necessário para manter os contadores. Antes de chamar o modelo, o servidor reserva o custo máximo estimado do pedido e atualiza pelo uso informado quando disponível. Falhas de resultado incerto conservam a reserva. As taxas padrão de texto utilizadas são US$ 0,75 por milhão de tokens de entrada e US$ 4,50 por milhão de saída, verificadas em 26/10/2026. Preços precisam ser revistos se o fornecedor mudar a tabela. Esse controle cobre somente este adaptador e banco, não substitui a cobrança/limites da OpenAI e não contabiliza outros serviços ou usos externos da mesma chave. Não há contratação nem recarga automática de créditos.

## Entrada e controle humano

Uma conversa nova, sem responsável, iniciada por um telefone autorizado entra no piloto quando todas as configurações e a conexão WhatsApp estão prontas. Conversas existentes precisam da ação **Permitir assistência**; somente telefones do piloto podem efetivamente chamar o modelo. Uma nova mensagem não reativa uma conversa assumida por pessoa. Telefones fora do piloto continuam com o fluxo humano.

O servidor reúne mensagens próximas antes de responder, cancela trabalhos ainda pendentes substituídos por novas mensagens e confere telefone, modo, versão do controle e última mensagem antes do envio. **Assumir atendimento**, responder pela central ou receber uma resposta pelo aplicativo Business pausa a automação. Um envio que já foi despachado à Meta não pode ser desfeito por uma ação posterior; a conferência impede novos despachos depois da tomada de controle. Resultados de envio desconhecidos ficam para conferência humana, sem repetição automática.

Pedidos por pessoa, anexos que precisam de leitura, avaliações técnicas, compromissos comerciais e falhas ou limites de execução encaminham o atendimento para a equipe. A lista sinaliza **Pronto para assumir**; o painel mantém motivo, resumo, pendências e próximo passo. O modelo pode coletar brevemente serviço e município, e solicitar matrícula **ou** cadastro imobiliário se pertinente. Não há OCR, aprovação de orçamento/contrato nem execução genérica de comandos. A transcrição de mensagens de voz OGG/Opus pode ser habilitada no mesmo piloto com AI_AUDIO_ENABLED=true; detalhes em [Áudio e atendimento contínuo](audio-e-atendimento.md). Imagens/documentos recebidos podem gerar uma confirmação de recebimento e o encaminhamento à equipe, sem enviar o conteúdo binário ao modelo. Áudios sem transcrição disponível e outros formatos não interpretados precisam de conferência pela equipe.

As mensagens ao contato são em nome da Domum, sem fingir a identidade de um atendente. Se perguntarem sobre automação, a instrução é explicar honestamente o uso de IA e oferecer uma pessoa, sem encerrar por essa pergunta isolada. A autoria interna fica explícita como **Domum · IA**. Mensagens humanas recebem nome e dois-pontos em negrito, mantendo o nome da sessão como origem.

## Linguagem e continuidade

As orientações ficam em `ai-attendance-guide.mjs`, separado dos controles de acesso, consumo e envio. São instruções explícitas de atendimento da Domum; o modelo da central não recebe automaticamente a memória do ChatGPT, e-mails ou conversas de outros clientes.

O guia orienta a responder à dúvida antes de coletar dados, escrever de forma simples e acolhedora, perguntar somente o que ajuda no próximo passo e retirar pendências já respondidas. Não exige pergunta em toda mensagem, saudação repetida nem entrevista cômodo a cômodo. Quando a pessoa quer desenvolver a ideia, a IA pode continuar dentro dos limites de orientação geral. Cadastro concluído, arquivo recebido ou pedido de resumo não impõem encerramento. Decisão técnica, leitura de arquivo, compromisso de preço/prazo, pedido humano ou próxima ação que dependa da equipe continuam exigindo passagem para uma pessoa.

O contexto identifica separadamente se há cadastro vinculado e qual é a etapa de cadastro. `Inicial` não comprova contratação nem existência de projeto. Os relatos e interpretações mantêm origem e qualificação; a IA não deve transformar seu resumo anterior em confirmação da equipe.

As 24 mensagens enviadas ao modelo seguem a ordem de registro na central, a mesma usada pelo controle da última mensagem recebida. Isso evita inverter uma resposta e uma nova mensagem do contato quando o horário da Meta tem precisão de segundos e o servidor registra milissegundos. Os horários originais das mensagens no banco são preservados.

### Conferência pelo telefone após publicar

No contato autorizado do piloto, use **Permitir assistência** caso a equipe tenha assumido e envie uma mensagem nova. Não é preciso recriar o cadastro. Confira:

1. **Continuidade:** “Quero continuar explicando minha ideia.” A resposta deve acolher e usar o que já foi dito, sem encaminhar só por haver dados mínimos.
2. **Orientação:** “O que preciso fazer agora?” Deve explicar o próximo passo possível, sem apenas devolver outra pergunta nem prometer aprovação ou prazo.
3. **Resumo:** “Pode resumir o que já contei?” Deve preservar os detalhes conhecidos sem repetir perguntas resolvidas nem anunciar um contrato inexistente.
4. **Documento indisponível:** “Não tenho a matrícula agora.” Deve permitir seguir, sem cobrança repetida do documento. Um arquivo enviado não foi lido pela IA.
5. **Passagem humana:** “Quero falar com uma pessoa.” Deve pausar a automação e deixar motivo e contexto para a equipe. Mensagem posterior não a reativa sozinha.

Os testes de transporte falso conferem continuidade, vínculo único e preservação de contexto; não comprovam qualidade de linguagem. A avaliação do tom ocorre na conversa real, dentro do teto já autorizado. Não executar avaliações pagas adicionais sem contabilizar o orçamento restante do mesmo piloto.

## Contexto e Notion

O modelo recebe até 24 mensagens recentes registradas na central e um conjunto limitado do contexto da conversa. Quando já existe um vínculo conferido com Clientes, a central consulta novamente o contexto no Notion antes da chamada. Dados de páginas brutas, propriedades financeiras, CPF/CNPJ e URLs internas não são incluídos por esse adaptador. Mensagens, resumos e campos operacionais são dados não confiáveis; não têm poder para modificar as instruções ou habilitações.

Entendimentos ficam no histórico com origem **IA** e qualificação **Interpretado**, sem sobrescrever o resumo humano confirmado. Encaminhamentos criam uma solicitação **Aguardando equipe**; eventos sincronizam pela fila existente quando há cliente vinculado. Sem vínculo, permanecem locais até conferência. Com AI_AUTO_REGISTER=true e todos os controles do piloto atendidos, o cadastro inicial pode ser criado ou reaproveitado após a conferência da fonte dos dados e de duplicidade. A origem é IA; os dados citados do solicitante ficam como Informado e os entendimentos do modelo como Interpretado. O nome do perfil do WhatsApp ou de um proprietário mencionado não é suficiente para cadastrar o solicitante. A configuração padrão é false. O piloto não atualiza atividades operacionais nem dispara avisos de avanço.

## Validação

Os testes usam chave fictícia, números fictícios, bancos temporários e transporte falso. Conferem liberação por telefone, limite sem consumo, deduplicação, tomada de controle durante a geração, respostas pelo aplicativo, recusas, falhas de envio, reinício e autoria do histórico. Aprovação de testes não comprova acesso ao modelo, crédito disponível, deploy ou entrega real ao WhatsApp. A autorização de consumo do piloto foi recebida, com teto total de US$ 5. O primeiro ensaio ao vivo depende da configuração privada do Render e da disponibilidade de crédito da conta OpenAI; não se compra nem recarrega crédito automaticamente.

Referências oficiais: [modelo e preços](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [saídas estruturadas](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## Diagnóstico inicial e orçamento deste piloto

No diagnóstico inicial, a chave foi aceita na consulta de disponibilidade do modelo (HTTP 200), mas a geração retornou HTTP 429 com credit_balance_exhausted e insufficient_quota. Nenhuma resposta foi gerada, nenhum WhatsApp foi enviado e nenhum registro foi criado no Notion por essas verificações. Esse resultado histórico não descreve necessariamente o estado atual do piloto. O contador local retém uma reserva conservadora, que não comprova cobrança.

Para respeitar os US$ 5 totais autorizados, a configuração privada separa até US$ 0,05 para o diagnóstico local e até US$ 4,95 para o teste pelo telefone (AI_TOTAL_BUDGET_USD=4.95 no Render, mantendo AI_MONTHLY_BUDGET_USD=5). Não há renovação automática desse teto total. A autorização não foi usada para comprar créditos ou habilitar recarga automática.

O cadastro automático é interrompido se houver tomada humana antes da chamada ao Notion. Se a criação externa já tiver sido despachada quando alguém assumir, ela não pode ser desfeita automaticamente: o ID retornado é preservado para conferência, sem vincular o cliente ou enviar a resposta antiga.
