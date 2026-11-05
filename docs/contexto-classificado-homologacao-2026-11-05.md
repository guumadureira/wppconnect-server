# Contexto por identidade e assunto — homologação

## Escopo e estado

Preparação autorizada por Gustavo em 05/11/2026, separada da leitura completa publicada na PR #53. Esta branch não deve ser mesclada ou implantada sem autorização própria. Nenhum resumo, cadastro, permissão ou atendimento de produção foi modificado para esta homologação. Todos os testes usam SQLite temporário e respostas fictícias dos provedores.

O problema é um resumo comercial antigo parecer representar toda uma conversa interna que também contém consultas administrativas, simulações e intervenção humana. A correção preserva esse resumo como legado e apresenta uma classificação revisada, com assuntos separados e evidências do histórico. Não inventa uma nova consolidação a partir de texto livre.

## Habilitação isolada

`CONTEXT_CLASSIFICATION_ENABLED=false` por padrão. Quando desligado, não cria a tabela nova e conserva a apresentação e as regras legadas. Somente um ambiente isolado, com dados fictícios, deve habilitar `true` nesta etapa.

Quando habilitado, a inicialização cria `context_classifications`: revisões locais cumulativas por conversa, autoria administrativa, finalidade, assuntos, referências às mensagens e marca da última mensagem incorporada na revisão. Não altera as quatro tabelas OAuth. Desligar a flag conserva as revisões e volta ao comportamento legado; não restaura nem apaga registros.

## Revisão administrativa

`PATCH /api/conversations/:id/context/classification`, com sessão de administrador e a proteção de origem já existente. Não é uma ferramenta MCP, não pode ser chamado por mensagens nem pelo conector de leitura. O corpo contém:

- `version` e `requestId`: concorrência e idempotência; reutilizar uma ação com outro conteúdo é recusado.
- `identity`: `internal`, `external` ou `unknown`, confirmada pelo administrador, nunca inferida do nome, do conteúdo ou da permissão OAuth.
- `topics`: até 12 assuntos, cada um com `id`, `title`, `purpose`, `summary` e `messageIds` da própria conversa. Finalidades: `administrative`, `simulation`, `customer`, `undetermined`. Cada assunto exige ao menos uma mensagem de referência.
- `activeTopicId`: assunto ativo ou `null` para aguardar definição. A existência de outros assuntos não os torna ativos.

Exemplo de homologação: classificar um contato fictício como interno; separar uma consulta administrativa de duas simulações; deixar a consulta administrativa ativa. Referenciar mensagens reais do banco de teste, sem reproduzir contratos ou dados de clientes. Nenhuma classificação autoriza envio.

Cada revisão nova incrementa a versão do contexto e mantém o modo humano, invalidando respostas de IA em andamento. Repetir exatamente a mesma ação não duplica revisão nem renova a versão. A liberação de IA continua uma ação própria; a classificação não reabre conversa.

## Apresentação e atualização

O GET de contexto acrescenta `classification`, preservando os campos legados para auditoria. `consultar_conversa` apresenta `contextoEstruturado`, com identidade, assuntos, assunto ativo, revisão, resumo legado e situação operacional separados. O campo `resumo` contém somente o assunto revisado; fica `null` enquanto houver revisão pendente. Não reapresenta as pendências antigas como pendências atuais.

Qualquer mensagem nova após a revisão, inclusive uma resposta humana pelo aplicativo Business, marca necessidade de revisão. Alterar o modo ou a data do contexto, isoladamente, não finge que a mensagem foi incorporada ao resumo. A intervenção humana não troca automaticamente identidade ou assunto. Histórico, anexos e transcrições continuam consultáveis pelas regras existentes.

Na IA de atendimento, o resumo do assunto confirmado substitui o resumo misturado na entrada do modelo. A classificação é fornecida separadamente; os resumos legados locais/Notion não entram como resumo atual desse turno. As mensagens continuam dados não confiáveis. Não foi executada chamada paga para verificar qualidade semântica; os testes inspecionam a entrada com um provedor fictício.

## Guardas de cadastro e publicação

Com a funcionalidade habilitada, somente identidade externa com assunto ativo `customer` confirmado permite automação de clientes. Contatos internos, simulações, consultas administrativas e perfis não classificados ficam para revisão humana. Isso não altera o alcance de leitura do administrador no ChatGPT nem transforma os demais contatos em contatos internos.

As guardas cobrem criação de clientes, busca automática, gravação de resumo de IA e encaminhamento automático, eventos/resumos publicados no Notion e a validade de turnos da IA. Eventos novos isolados ficam locais, sem associação automática a cliente/trabalho; os vínculos e eventos antigos não são apagados. Trabalhos e registros reais não são gerados por esta funcionalidade. Escritas aguardando a fila da API conferem novamente a classificação antes do transporte; algo já despachado antes de uma revisão não pode ser desfeito por esta guarda.

## Evidências e limites para ativação

329 testes locais aprovados com Node 24.22.1: suíte original e nove cenários adicionais. Incluem autorização administrativa, origem, referências estrangeiras, revisões/idempotência, preservação do resumo anterior, intervenção humana, isolamento de filas, simulações, entrada do modelo e reclassificação durante consultas/espera da API.

Esta etapa entrega a camada administrativa por API e o consumo seguro no MCP/IA de atendimento. Não inclui editor visual de assuntos, reconsolidação automática por IA, correção retroativa de resumos reais ou revisão de todo o contexto do assistente interno do operador. O painel legado ainda edita o resumo anterior; editar esse campo não equivale a revisar os assuntos. Esses limites precisam ser tratados antes de uso operacional amplo.

Para uma ativação futura: revisar o fluxo administrativo com dados fictícios, avaliar os cenários reais de teste sem publicar seus dados no repositório, preparar a interface, decidir a revisão dos registros existentes e obter autorização específica para implantação/esquema/flag. Não habilitar a flag no serviço de produção nesta tarefa. A retomada automática da PR #48 permanece fora desta autorização.
