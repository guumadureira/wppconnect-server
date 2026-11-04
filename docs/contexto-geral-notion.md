# Contexto geral de serviços da Domum vindo do Notion

## O que muda

O atendimento externo continua tendo como fonte primária o histórico da conversa, o cadastro de cliente vinculado e as fontes operacionais disponíveis. Além disso, agora poderá consultar, **somente para referências gerais de serviços**, uma página específica do Notion autorizada na configuração do servidor.

A página de referência já existe: [Contexto geral de serviços — Atendimento Domum](https://app.notion.com/p/ad11ace27e114749b52d683d46be2007). Esta entrega não altera o conteúdo dessa página, não sincroniza automaticamente todos os arquivos da Domum nem concede acesso a dados financeiros.

## Configuração privada e teste

1. Preservar o banco SQLite e fazer backup antes de qualquer atualização da Central.
2. Usar o `NOTION_TOKEN` do servidor, com permissão **de leitura** ao conteúdo dessa página, e manter `NOTION_ENABLED=true`.
3. Definir `NOTION_GLOBAL_CONTEXT_PAGE_ID` com o ID exato da página no Render, somente pelo painel privado do serviço. Não copiar tokens para GitHub ou Notion.
4. Usar `NOTION_GLOBAL_CONTEXT_TTL_SECONDS=60` (intervalo permitido entre 30 e 3600 segundos).
5. Após publicar o código aprovado, fazer login administrativo e acionar `POST /api/notion/global-context/refresh` para uma consulta imediata, seguida de `GET /api/notion/global-context/status` para conferir disponibilidade, data e erro. Nenhum endpoint envia mensagens.
6. Testar uma pergunta sobre serviços no telefone autorizado, respeitando os limites de IA e WhatsApp, sem afirmar que uma operação do Notion foi concluída sem o diagnóstico correspondente.
7. Editar uma seção permitida da página no Notion, fazer nova consulta e confirmar que a próxima resposta da IA recebe a revisão atualizada.

## Escopo lido e limites

O leitor só extrai conteúdo da página permitida sob os títulos `Serviços identificados nos documentos` e `Identificação e encaminhamento`. Suporta parágrafos, listas, citações e tabelas simples (até 25 linhas de 3 colunas). Não lê outros títulos, subpáginas, anexos, links temporários, dados de clientes ou páginas não configuradas. Limite de 7.000 caracteres, até duas páginas de blocos e leitura restrita de uma tabela por consulta.

Se o Notion recusar acesso, o conteúdo não é reutilizado silenciosamente como se fosse atual: o campo de referência da IA indica indisponibilidade. Não há webhook de atualização; uma nova consulta ocorre após o intervalo do cache ou pelo endpoint administrativo de atualização.

Esse texto é **dado de referência**, não instrução do modelo, autorização para divulgar documentos ou prova de contratos, valores, prazos, garantias ou situação de cliente. A IA deve continuar consultando o cadastro vinculado e o estado confirmado do trabalho.

## Segurança e entrega

- Funcionalidade opt-in: sem `NOTION_GLOBAL_CONTEXT_PAGE_ID`, não realiza requisições externas.
- Não exige assinatura adicional e usa o Notion já integrado, com as permissões próprias do Render.
- Testes locais simulam a API Notion e comprovam leitura restrita, atualização de conteúdo e inclusão no turno seguinte da IA. Testes não comprovam produção; validar a conexão real depois de publicação controlada.
- A página não concede acesso ao SharePoint/OneDrive. A integração Microsoft Graph permanece etapa separada.

Requisitos: [Sistema integrado — Clientes e trabalhos](https://app.notion.com/p/c08cfea9082d448c8e2067d2e8fee2c1).