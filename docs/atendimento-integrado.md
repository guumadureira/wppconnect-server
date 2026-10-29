# Atendimento integrado e liberação geral

## Ativação no Render

Depois de publicar esta versão, manter as credenciais existentes e configurar:

```
AI_ENABLED=true
AI_ALLOW_ALL_CONTACTS=true
AI_AUTO_REGISTER=true
AI_AUDIO_ENABLED=true
NOTION_ENABLED=true
NOTION_CLIENT_SUMMARY_ENABLED=true
```

`AI_ALLOW_ALL_CONTACTS` libera a IA para novos contatos individuais, mantendo o modo desligado por padrão. `AI_ALLOWED_PHONES` continua disponível para retornar ao piloto. Não amplia `CENTRAL_MCP_ALLOWED_PHONES`: a autorização de leitura/envio do agente externo permanece separada. Não inicia mensagens em massa nem habilita grupos. Conversas já humanas, assumidas pela equipe ou pausadas por erro/importação permanecem humanas; use **Permitir assistência** individualmente quando for adequado. Não reenvia mensagens antigas ao ativar.

Preservar o teto total já autorizado: `AI_TOTAL_BUDGET_USD=4.95` e `AI_MONTHLY_BUDGET_USD=5`. Texto e transcrição compartilham o teto total; os US$ 0,05 restantes do limite de US$ 5 ficam reservados às verificações anteriores. O teto não é renovado nem é reiniciado no deploy se o SQLite estiver no disco persistente. Não é um limite global da conta OpenAI: outras aplicações podem consumir saldo separado. O agente interno usa créditos do Notion; não ativar novos gastos/plano por consequência desta configuração.

## Resumo e cadastro

A cada resposta concluída, a Central atualiza resumo cumulativo, pendências e próximo passo. Usa a versão do contexto para não sobrescrever alterações humanas durante uma chamada. Falhas técnicas não substituem o resumo por texto genérico. O resumo anterior permanece no Histórico, com qualificação **Interpretado** quando produzido pela IA; não altera contratos, aprovação, preços ou situação de obras.

Ao localizar cadastro pelo telefone, encaminha também os eventos anteriores que aguardavam vínculo, sem incluir ofertas comerciais. Para criar novo cadastro, usa nome declarado pelo solicitante e necessidade apoiada em mensagem original; município pode ficar pendente. Nomes do perfil e de terceiros não viram cadastro. Identidade ambígua exige conferência. Fornecedores permanecem na base própria.

Em Clientes, a sincronização usa exclusivamente estes campos:

- Resumo do atendimento — Central (texto)
- Pendências — Central (texto)
- Próximo passo — Central (texto)
- Atualizado em — Central (data)
- Conversa — Central (URL privada da conversa)

A fila de resumo é independente dos eventos: guarda o estado mais recente por cliente e tenta novamente com atraso em caso de falha. Uma resposta perdida do PATCH é reconciliada pela leitura dos campos; não cria nova página. Não apaga conteúdo da página nem campos cadastrais preenchidos pela equipe. Estes cinco campos são mantidos pela Central; correções operacionais devem ser registradas em **Cliente e histórico**, preservando autoria. O painel Conexão exibe pendências e erros da fila.

## Assistente interno

Selecione **Cliente desta tarefa**, consulte o contexto e escreva o comando. O chat fixa esse destinatário, renova o contexto no servidor a cada comando e inclui somente a projeção operacional permitida e as últimas oito mensagens. Para mudar de cliente, abra novo chat. Os documentos relacionados podem ser buscados pelo cadastro ou por páginas dos trabalhos/propostas/projetos/atividades retornados; o operador confere destinatário, arquivo e texto antes de enviar.

O agente é software, não uma pessoa. Precisa de `NOTION_OPERATOR_CHAT_ENABLED=true`, `NOTION_OPERATOR_AGENT_ID` e credencial com acesso ao agente, além das páginas envolvidas. A conexão do agente personalizado com o MCP da Central também precisa estar habilitada nele. O chat não herda automaticamente permissões da conta humana. Arquivo que existe apenas no chat/sandbox do agente precisa ser anexado a uma página acessível antes do envio do original. Não transformar uma página vazia em substituto da proposta.

Quando o agente concluir mas a leitura falhar, o chat continua buscando a resposta, com pausa após erros. **Atualizar** consulta a mesma execução e não reenvia o comando. A interface informa quando uma execução terminou sem texto e identifica arquivos produzidos pelo agente; esses arquivos ainda precisam estar em página acessível para o envio original. O contexto enviado respeita o limite de 10.000 caracteres da API, preservando a identidade do cliente e reduzindo o material mais antigo.

O resumo em Clientes compara datas com precisão de minuto, compatível com o retorno do Notion. Um horário arredondado não mantém o registro em erro; divergências de conteúdo continuam identificadas pelo nome do campo.

## Condução do atendimento

A IA responde primeiro à dúvida e usa o contexto para fazer uma pergunta útil ao serviço. Uma resposta curta não deve deixar o cliente sem caminho; quando ele combina de mandar documentos depois, o atendimento aguarda. As últimas respostas da equipe ajudam a evitar cumprimentos e explicações repetidos. Dados pessoais incidentais não devem compor o resumo operacional.

A orientação de Maringá, Sarandi e Registro de Imóveis fica em `attendance-knowledge.mjs`, com fonte oficial, assunto, data de conferência e validade de 30 dias. É apoio à identificação da demanda; não substitui consulta municipal, análise do imóvel ou promessa de aprovação. Referências vencidas pedem nova conferência antes de afirmar regras específicas. A jurisdição informada recentemente prevalece sobre o resumo anterior.

Fontes conferidas em 28/10/2026: [Código de Maringá](https://sapl.cmm.pr.gov.br/ta/130/text), [Código de Sarandi](https://sapl.sarandi.pr.leg.br/ta/1422/text), [Lei de Registros Públicos](https://www2.camara.leg.br/legin/fed/lei/1970-1979/lei-6015-31-dezembro-1973-357511-normaatualizada-pl.html).

## Histórico anterior e grupos

A importação manual já existente permite revisar o TXT exportado de uma conversa individual, selecionar o período de sete dias e confirmar os participantes. O histórico importado contextualiza a IA; não provoca respostas a pedidos antigos nem comprova andamento atual. Esta versão não recupera automaticamente o arquivo anterior do telefone.

Grupos existentes no aplicativo não são sincronizados por esta Central. A documentação de coexistência do [provedor 8x8](https://developer.8x8.com/connect/docs/whatsapp/whatsapp-business-app-coexistence/) também os exclui da sincronização; isso não valida a elegibilidade desta conta para outros produtos de grupos da Meta. Não trocar o número, refazer cadastro ou contratar provedor para tentar contornar essa limitação sem verificar o caso.

## Áudio

Mensagens de voz OGG/Opus de até cinco minutos são transcritas dentro do mesmo teto, antes da resposta. A IA recebe texto marcado como transcrição automática e conserva o arquivo original. Um áudio seguido por texto antes da resposta também é considerado; falha desse áudio não é ignorada. Áudios antigos já respondidos não provocam nova transcrição. Transcrições concluídas são reaproveitadas; falhas com consumo incerto não são repetidas automaticamente.

A resposta continua em texto. Nomes, números e dados essenciais ouvidos podem exigir confirmação breve; transcrição não prova identidade nem análise de documento. Outros formatos de áudio recebidos continuam disponíveis à equipe, mas não são convertidos automaticamente por esta versão.

## Verificação em produção

1. Aguardar deploy Live, atualizar a Central e consultar Conexão.
2. Verificar acesso às seis fontes. Clientes/Histórico acessíveis não comprovam acesso a Trabalhos, Propostas, Projetos ou Atividades. Adicionar a conexão interna usada no Render às bases corretas, mantendo permissões restritas.
3. Com contato autorizado para o teste, enviar texto e voz, conferir resposta e controle humano.
4. Conferir cadastro único, resumo atualizado e eventos vinculados no Notion.
5. Selecionar cliente no assistente interno, consultar contexto, preparar arquivo e revisar a prévia. Envio aceito pela Meta ainda não comprova entrega.

Testes locais usam SQLite isolado, modelos e Notion simulados. Não comprovam a qualidade de uma resposta real, as permissões do agente ou a publicação no Render.

Referências: [atualização de propriedades do Notion](https://developers.notion.com/reference/patch-page), [transcrição da OpenAI](https://developers.openai.com/api/docs/guides/speech-to-text).
