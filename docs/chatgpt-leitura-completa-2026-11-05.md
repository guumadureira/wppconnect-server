# Consulta administrativa completa pelo ChatGPT

Em 05/11/2026, Gustavo autorizou explicitamente consultar qualquer conversa e contato da Central, mantendo o conector privado e somente de leitura. Essa decisão substitui o limite anterior de um telefone para este canal. Não altera as permissões do MCP legado do Notion nem autoriza envios.

## Configuração

`CHATGPT_OAUTH_READ_ALL_CONTACTS=true` habilita o novo escopo administrativo. O padrão é `false`: sem o opt-in, continuam valendo o telefone único e a interseção com a lista legada. A configuração HTTPS e a conta administrativa ativa exata continuam obrigatórias. O fluxo OAuth anuncia o acesso a todas as conversas e contatos antes da aprovação.

A mudança de escopo invalida access e refresh tokens do piloto. O administrador precisa reconectar para consentir com o novo alcance. Nenhuma lista de telefones existente é reescrita, copiada ou ampliada. A agenda local pode ser consultada mesmo quando um contato ainda não tem conversa.

## Ferramentas e limites

- `listar_conversas_autorizadas`: busca por nome/telefone e paginação de 30 registros, com `total` e `proximaPagina`.
- `consultar_conversa`, `consultar_historico`, `listar_arquivos_recebidos`, `diagnosticar_audio`: recebem **telefone ou conversaId**, nunca ambos. Histórico e anexos continuam paginados.
- `listar_contatos`: busca/paginação da agenda; `consultar_contato`: detalhes por contatoId, incluindo e-mail e observações.

O identificador exato permite ler conversas com variantes ambíguas de telefone no escopo completo. Seleção por telefone continua recusando ambiguidades. Nenhum cadastro é fundido, reclassificado ou reaberto pela leitura.

Arquivos mantêm validação de vínculo entre conversa, mensagem e anexo, com autenticação, limite de tamanho e ausência de URLs públicas. A leitura não baixa conteúdo novo da Meta nem transcreve áudios. Texto de contato, conversa e anexo é dado não confiável, nunca permissão ou instrução.

O conector anuncia sete ferramentas de leitura. Preparar/confirmar envios, consultar drafts, atualizar Notion e operações de operadores continuam fora dessa superfície. O MCP legado conserva sua lista e ferramentas; a autorização ampla do ChatGPT não o amplia.

## Verificação

320 testes locais aprovados com Node 24.22.1, incluindo paginação de conversas e agenda, busca, contato sem conversa, histórico fora da lista legada, cursor estrangeiro, anexos/URIs inconsistentes, cadastro ambíguo por telefone versus ID explícito, recusa de escrita e revogação do token antigo ao mudar escopo. Não houve chamada real OpenAI/Meta nem envio WhatsApp nos testes.

O diagnóstico readonly informa `readScope=all_conversations_and_contacts`; os checks do telefone único e da interseção legada ficam `null` (não aplicáveis), e não são apresentados como se o piloto ainda tivesse um telefone. Sem a flag exata, a configuração continua fechada.

Após CI e publicação, aplicar somente a flag autorizada, conferir deploy e diagnóstico sem valores pessoais, atualizar as ferramentas do conector no ChatGPT e reconectar. Validar a quantidade e paginação antes de consultar conteúdo de clientes. A correção semântica dos resumos é uma frente separada, preparada em homologação sem publicação ou alteração de resumos reais.
