# Áudio e atendimento contínuo

## O que esta versão entrega

- Recebimento e envio de áudio pela API da Meta, com arquivo persistente no banco da conversa, player autenticado, download e suporte a faixas de reprodução.
- Anexar OGG/Opus, MP3, M4A, AAC ou AMR, até 16 MB. Áudio é enviado sem legenda; texto deve ser enviado separadamente.
- Gravação com revisão antes do envio quando o navegador oferece MediaRecorder em OGG/Opus ou MP4. Limite de gravação de 2 minutos. O microfone é encerrado ao parar ou cancelar. Quando o navegador só oferece WebM, a gravação informa a incompatibilidade e orienta usar um arquivo suportado; não envia WebM à Meta nem instala conversor no servidor.
- Transcrição automática de mensagens de voz OGG/Opus de até 5 minutos no piloto autorizado, usando GPT-Transcribe. Outros formatos continuam disponíveis para a equipe ouvir; não são transcritos automaticamente nesta versão.
- O texto extraído fica separado do áudio original e aparece como Transcrição automática, sem substituir a mensagem ou afirmar que foi validado. A IA responde ao conteúdo e confirma um dado duvidoso quando necessário. O agente do Notion também pode consultar a transcrição pelo MCP.
- Respostas externas da IA com limite de 700 caracteres e orientação de 1 a 3 frases curtas, sem narrar suas tarefas internas nem recapitular o projeto toda vez. O resumo e as pendências continuam internos.
- Histórico inicial de 7 dias, mantendo opção de 15 dias e histórico completo. O filtro não apaga registros. Assinatura humana em negrito, também no texto enviado ao WhatsApp.
- Botão Nova conversa abre os contatos, onde é possível cadastrar e abrir uma conversa. Contatos e conversas permanecem no banco persistente. Primeiro envio pela API continua dependendo de modelo aprovado quando não há janela de 24 horas aberta. Abrir no WhatsApp permite iniciar pelo aplicativo; essa ação não envia mensagem automaticamente.

## Ativar a transcrição

No mesmo ambiente privado do Render, acrescente `AI_AUDIO_ENABLED=true` e faça deploy. A chave da OpenAI, a lista de telefones e os tetos existentes são reaproveitados. O exemplo versionado permanece desligado. A transcrição não exige uma chave nova, contratação automática ou nova autorização de gasto: compartilha o mesmo teto total já autorizado para o piloto.

Preço verificado em 27/10/2026: GPT-Transcribe US$ 0,0045 por minuto. Antes de chamar a API, a duração de OGG/Opus é contada pelos pacotes e arredondada para cima em minutos para reservar o custo. A reserva é mantida mesmo quando o resultado é incerto. O total inclui respostas de texto e transcrições, nos mesmos limites mensal e total persistidos. A reserva não é comprovante de cobrança. Taxas devem ser revistas se o fornecedor alterar a tabela.

Não há nova tentativa automática de uma transcrição incerta. Mensagem deduplicada ou transcrição já concluída não é cobrada de novo pela central. Assumir a conversa durante a transcrição impede resposta posterior da IA. O áudio que já foi despachado ao fornecedor não pode ser desfeito. Em erro, silêncio ou formato não interpretado, a equipe recebe a indicação para ouvir o áudio. Se depois o cliente continuar por texto, um áudio anterior indisponível não bloqueia para sempre as novas perguntas.

O cadastro automático exige fonte conferida em mensagens de texto. Nome, município e serviço que só vierem de áudio precisam de confirmação escrita antes da criação automática; a conversa pode continuar enquanto isso.

## Conhecimento e apoio humano

`attendance-knowledge.mjs` fornece apenas orientações breves verificadas em fontes oficiais: identificação do imóvel e ficha técnica em Maringá; distinção das normas de Sarandi; matrícula, registro e averbação. Não contém tabelas universais de recuos, taxas, prazos ou pareceres de viabilidade. As referências têm data de conferência e deixam de sustentar regra específica após 30 dias, até nova revisão.

A IA pode explicar o processo geral e continuar conversando com o cliente. Só deve passar à equipe quando precisar de decisão técnica/documental, compromisso comercial, ação que não consegue executar, ou quando o cliente pedir uma pessoa. Não precisa transferir só porque já coletou dados mínimos. Se o Notion estiver indisponível, pode seguir na orientação geral, sem apresentar andamento antigo como atual.

## Validação e limites

Testes usam áudio sintético, respostas falsas da OpenAI/Meta e bancos separados. Cobrem transcrição, conservação do original, custo conjunto, deduplicação, tomada humana, pedido humano por voz, erro incerto, player autenticado e reprodução parcial. Não consomem APIs pagas. O conteúdo acústico e a qualidade da conversa precisam de teste pelo telefone após o deploy; gravação depende de dispositivo, navegador, permissão do microfone e HTTPS.

Referências: [transcrição OpenAI](https://developers.openai.com/api/docs/guides/speech-to-text), [GPT-Transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe), [preços](https://developers.openai.com/api/docs/pricing), [Opus RFC 6716](https://www.rfc-editor.org/rfc/rfc6716), [Maringá](https://sapl.cmm.pr.gov.br/ta/130/text), [Sarandi](https://sapl.sarandi.pr.leg.br/ta/1422/text), [Lei de Registros Públicos](https://www.planalto.gov.br/ccivil_03/leis/l6015compilada.htm).
