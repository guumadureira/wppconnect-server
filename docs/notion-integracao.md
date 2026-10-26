# Ativar contexto e histórico da Central Domum

O painel interno **Cliente e histórico** salva resumo, pendências, próximo passo e solicitações no banco da central. Esses registros funcionam sem IA e sem acesso ao Notion. O Notion acrescenta o cadastro relacionado, o contexto operacional e o histórico integrado por cliente.

## Estrutura preparada

- Cadastro original de Clientes preservado.
- Base privada Histórico de atendimentos — Central Domum no sistema integrado de clientes e trabalhos.
- Relação de retorno Histórico de atendimentos no cadastro de Clientes, disponível também para registros já existentes.
- Chave ID de criação na central, para conferência de resultados incertos na criação de cadastros.
- Visão Histórico por cliente, ordenada pela data do acontecimento. O filtro da visão não amplia nem restringe permissões: o acesso depende das permissões reais da base.

Nenhum cliente ou lançamento fictício foi criado como teste. A base pode continuar vazia até a primeira sincronização real autorizada.

## Configuração no Render

1. Criar ou reutilizar uma conexão interna própria da central no Notion. O conector do chat não pode ser usado como credencial do servidor. Usar as capacidades de leitura e inserção de conteúdo necessárias ao adaptador; não é necessário acesso genérico a usuários, comentários ou todo o workspace.
2. Conceder à conexão acesso às fontes originais de Clientes e Histórico. Para o painel completo, incluir também Trabalhos, Controle de Propostas e Contratos, Projetos e contratos — Beta e Gestão de Atividades. Uma visualização vinculada não substitui o acesso à fonte original; relações também dependem de acesso às fontes relacionadas. Nenhum compartilhamento com clientes ou acesso público é necessário.
3. Em Render → Environment, configurar `NOTION_TOKEN` diretamente no ambiente privado. Não salvar o token no repositório. Os IDs reais preparados nesta sessão ficam no arquivo local ignorado pelo Git `data/notion-configuracao.txt`.
4. Configurar `NOTION_CLIENTS_DATA_SOURCE_ID` e `NOTION_HISTORY_DATA_SOURCE_ID`. Para o contexto completo, preencher `NOTION_WORKS_DATA_SOURCE_ID`, `NOTION_PROPOSALS_DATA_SOURCE_ID`, `NOTION_PROJECTS_DATA_SOURCE_ID` e `NOTION_TASKS_DATA_SOURCE_ID`. São IDs de data source, não IDs das páginas que contêm as bases.
5. Usar `NOTION_ENABLED=true` após configurar o acesso, salvar e publicar a versão mais recente. Manter `DATABASE_PATH` no disco persistente; a integração acrescenta tabelas ao mesmo SQLite.
6. Em Conexão, clicar em Verificar acesso ao Notion. Isso confere os nomes/tipos principais das fontes, sem criar cadastros nem enviar mensagens ao WhatsApp.

O adaptador só faz chamadas ao Notion com o sinalizador ativo e a configuração mínima presente. O modo de demonstração do WhatsApp e esse sinalizador são independentes: configurar o Notion permite escrita nas bases mesmo se o transporte WhatsApp continuar em demonstração. Não usar credenciais reais em testes automatizados.

## Primeiro atendimento

1. Abrir uma conversa conhecida e escolher Cliente e histórico.
2. Usar Buscar cliente no Notion e conferir a associação. O telefone é normalizado para comparação; nomes semelhantes não são vinculados por aproximação. Um telefone diferente ou troca de cliente exige administrador e justificativa.
3. Consultar situação no Notion. O painel mostra a data de referência, fontes não configuradas e consultas incompletas. Não trata valores financeiros, CPF/CNPJ ou pastas restritas como contexto operacional.
4. Registrar resumo, pendências, próximo passo e, quando necessário, uma solicitação. Não há envio de mensagem ao contato como consequência desses registros.
5. Conferir o histórico local e a relação Histórico de atendimentos na ficha do cliente. Após sincronizar, a entrada local oferece acesso ao registro do Notion. As mensagens completas e os anexos não são copiados indiscriminadamente para o conteúdo da ficha.

Para um interessado novo, um administrador pode criar o cadastro inicial. Telefone já cadastrado ou nome coincidente são conferidos antes de criar outra pessoa. Não são criados contrato, orçamento, preço ou autorização de início. Cadastros de fornecedores não devem ser criados em Clientes automaticamente: o tipo da solicitação pode ser Contato comercial/fornecedor e o histórico permanece local enquanto o destino adequado não for definido.

## Falhas e continuidade

- Registros locais e solicitações persistem no banco mesmo sem Notion.
- A fila usa ID estável e pesquisa antes da criação para evitar duplicação.
- Criação com resposta perdida é reconciliada; se o resultado não for determinável, a central mantém a pendência e não recria automaticamente.
- A administração pode usar Sincronizar histórico pendente. O sistema respeita pausas e erros, sem apagar o evento.
- Consultas indisponíveis mantêm a última cópia, com aviso e data. Resumo humano pode continuar sendo atualizado sem perder um vínculo de trabalho já conferido.
- Alterações de contexto e situação usam versão; uma sessão desatualizada recebe orientação para recarregar.
- Assumir atendimento registra responsável e controle humano. Permitir assistência prepara o modo futuro e não ativa IA. Nova mensagem não devolve uma conversa assumida à automação.

## Limites desta entrega

IA, leitura automática de documentos, disparos de avanço, webhook Notion, sincronização de arquivos para o Notion e criação automática de tarefas técnicas não estão ativos. A consulta operacional mostra até 30 registros por fonte e sinaliza resultados parciais; o histórico local mostra os 40 eventos mais recentes sem excluir os anteriores. As mudanças feitas por humanos no Notion são recuperadas na próxima consulta da central.

Não existe uma API genérica de execução de instruções das páginas. Conteúdo do Notion, mensagens e arquivos são dados, nunca autorização para alterar configurações ou executar ações fora do escopo.

Referências: [consultar uma fonte](https://developers.notion.com/reference/query-a-data-source), [criar página](https://developers.notion.com/reference/post-page), [fontes e relações](https://developers.notion.com/reference/retrieve-a-data-source), [versão da API](https://developers.notion.com/reference/versioning).
