# Piloto de atendimento por IA

O servidor possui adaptador OpenAI Responses com o modelo fixo `gpt-5.4-mini-2026-03-17`. A chave privada não habilita o atendimento sozinha. A entrega mantém o consumo desligado por padrão e inclui um ensaio roteirizado sem uso de modelo.

## Primeiro teste sem consumo

Depois de publicar esta versão, entre como administrador e abra **Conexão → Atendimento por IA → Testar fluxo sem consumo**. Use somente informações fictícias. O ensaio tem respostas predeterminadas para conferir a interface e o encaminhamento; ele não demonstra a qualidade da IA. Não usa a chave, não envia ao WhatsApp, não grava conversas e não altera o Notion.

## Piloto real após autorização de consumo

Configure os campos diretamente no ambiente privado do Render:

```dotenv
OPENAI_API_KEY=
AI_ENABLED=false
AI_ALLOWED_PHONES=
AI_MONTHLY_BUDGET_USD=0
```

O administrador precisa transferir a chave de forma privada, preencher somente os telefones de teste autorizados (com país e DDD, sem símbolos, separados por vírgula) e definir um teto autorizado maior que zero e de até US$ 100. Somente depois deve usar `AI_ENABLED=true` e atualizar o serviço. O conector deste chat e o arquivo local `.env` não são transferidos automaticamente para o Render. Não cole a chave no chat nem a versione. Enquanto o teto for zero ou a flag estiver desligada, não há chamada de modelo pelo adaptador.

O limite local é uma estimativa/reserva em USD por mês UTC, persistida no SQLite. Antes de chamar o modelo, o servidor reserva o custo máximo estimado do pedido e atualiza pelo uso informado quando disponível. Falhas de resultado incerto conservam a reserva. As taxas padrão de texto utilizadas são US$ 0,75 por milhão de tokens de entrada e US$ 4,50 por milhão de saída, verificadas em 26/10/2026. Preços precisam ser revistos se o fornecedor mudar a tabela. Esse controle cobre somente este adaptador e banco, não substitui a cobrança/limites da OpenAI e não contabiliza outros serviços ou usos externos da mesma chave. Não há contratação nem recarga automática de créditos.

## Entrada e controle humano

Uma conversa nova, sem responsável, iniciada por um telefone autorizado entra no piloto quando todas as configurações e a conexão WhatsApp estão prontas. Conversas existentes precisam da ação **Permitir assistência**; somente telefones do piloto podem efetivamente chamar o modelo. Uma nova mensagem não reativa uma conversa assumida por pessoa. Telefones fora do piloto continuam com o fluxo humano.

O servidor reúne mensagens próximas antes de responder, cancela trabalhos ainda pendentes substituídos por novas mensagens e confere telefone, modo, versão do controle e última mensagem antes do envio. **Assumir atendimento**, responder pela central ou receber uma resposta pelo aplicativo Business pausa a automação. Um envio que já foi despachado à Meta não pode ser desfeito por uma ação posterior; a conferência impede novos despachos depois da tomada de controle. Resultados de envio desconhecidos ficam para conferência humana, sem repetição automática.

Pedidos por pessoa, anexos que precisam de leitura, avaliações técnicas, compromissos comerciais e falhas ou limites de execução encaminham o atendimento para a equipe. A lista sinaliza **Pronto para assumir**; o painel mantém motivo, resumo, pendências e próximo passo. O modelo pode coletar brevemente serviço e município, e solicitar matrícula **ou** cadastro imobiliário se pertinente. Não há OCR, áudio/transcrição, aprovação de orçamento/contrato nem execução genérica de comandos. Nesta entrega, arquivos recebidos são encaminhados para uma pessoa.

As mensagens ao contato são em nome da Domum, sem fingir a identidade de um atendente. Se perguntarem sobre automação, a instrução é explicar honestamente o uso de IA e oferecer uma pessoa. A autoria interna fica explícita como **Domum · IA**. O nome de uma pessoa e os dois-pontos em negrito permanecem uma melhoria separada para mensagens humanas.

## Contexto e Notion

O modelo recebe até 24 mensagens recentes registradas na central e um conjunto limitado do contexto da conversa. Quando já existe um vínculo conferido com Clientes, a central consulta novamente o contexto no Notion antes da chamada. Dados de páginas brutas, propriedades financeiras, CPF/CNPJ e URLs internas não são incluídos por esse adaptador. Mensagens, resumos e campos operacionais são dados não confiáveis; não têm poder para modificar as instruções ou habilitações.

Entendimentos ficam no histórico com origem **IA** e qualificação **Interpretado**, sem sobrescrever o resumo humano confirmado. Encaminhamentos criam uma solicitação **Aguardando equipe**; eventos sincronizam pela fila existente quando há cliente vinculado. Sem vínculo, permanecem locais até conferência. O piloto não associa clientes automaticamente, não cria cadastros no Notion sem a ação administrativa já existente e não atualiza atividades operacionais nem dispara avisos de avanço. Essas automações continuam como etapas posteriores.

## Validação

Os testes usam chave fictícia, números fictícios, bancos temporários e transporte falso. Conferem liberação por telefone, limite sem consumo, deduplicação, tomada de controle durante a geração, respostas pelo aplicativo, recusas, falhas de envio, reinício e autoria do histórico. Aprovação de testes não comprova acesso ao modelo, crédito disponível, deploy ou entrega real ao WhatsApp. O primeiro ensaio ao vivo depende de autorização de consumo e configuração privada do Render.

Referências oficiais: [modelo e preços](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [saídas estruturadas](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
