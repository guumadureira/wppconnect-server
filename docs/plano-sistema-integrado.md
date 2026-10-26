# Evolução da Central Domum

## Entrega 1 — atendimento e contatos

Implementados: identidade visual com logos originais, assinatura por sessão, Enter para enviar, seletor de emojis e cadastro de contatos com nome, telefone internacional, e-mail e observações. É possível salvar um contato a partir da conversa e abrir a conversa correspondente pelo cadastro. Cadastrar ou abrir um contato não envia mensagens nem altera a agenda do celular.

Os IDs dos contatos são estáveis e os telefones são normalizados. O histórico permanece vinculado ao número original; outro número exige outro cadastro. A tabela de contatos é acrescentada ao banco existente, sem recriação. Rascunhos de respostas sobrevivem às atualizações da interface enquanto a página está aberta; não são salvos após fechar ou recarregar a página.

## Entrega 2 — mídia e figurinhas

Pendente: receber e visualizar imagens, documentos, áudios e figurinhas, baixar os arquivos no computador e enviar anexos. Em seguida, biblioteca de figurinhas salvas/favoritas e reenvio. Usar os IDs de mídia e os endpoints oficiais da Meta; guardar arquivos em armazenamento privado e liberá-los por rotas autenticadas da central. Definir limites por arquivo, uso do disco e retenção antes da ativação. O disco atual é de 1 GB; ampliação ou outro armazenamento precisam de confirmação de custo.

## Entrega 3 — fotos e organização

Pendente: foto cadastrada no contato, arquivos associados ao cliente e arquivamento/limpeza de histórico. O objeto de perfil usado nos eventos de mensagem documenta o nome; a recuperação automática de fotos de perfil dos clientes não está confirmada. Oferecer foto manual enquanto isso. Prazos de retenção, itens protegidos e procedimento de exclusão dependem de escolha do usuário; nenhuma limpeza automática é ativada por este plano.

## Entrega 4 — Notion e avisos ao cliente

Base confirmada pelo usuário: **Gestão de Atividades**. Propriedades verificadas: `Atividade`, `Status`, `Cliente cadastrado`, `Projeto / contrato` e `Trabalho integrado`. A relação `Cliente cadastrado` aponta para **Clientes — Cadastro restrito**, cujo telefone está no campo `Telefone`.

Status existentes: `A fazer`, `Planejado`, `Em andamento`, `Aguardando cliente/terceiro` e `Concluído`. Os IDs específicos das fontes e credenciais devem ser configurados no ambiente privado da implantação, fora deste documento.

Vincular explicitamente o ID do cliente no Notion ao ID do contato e à conversa, com conferência do telefone. Não localizar destinatários apenas pelo nome. Ler apenas os campos necessários à integração; o cadastro restrito também possui dados que não devem ser copiados para conversas, mensagens automáticas ou logs.

Fluxo proposto: alteração no Notion → webhook verificado → consulta do estado atual da atividade → regra de status/cliente autorizada → prévia de mensagem → fila persistente → envio para a conversa vinculada → registro do resultado. Começar com revisão humana e ativar automação por regra somente após validação. Permitir também atualização de status a partir da central quando essa operação for configurada.

Antes de enviar automaticamente, definir quais transições avisam o cliente, o texto que pode sair, contato autorizado e preferência de recebimento. Evitar reenvio em eventos repetidos, notificações de tarefas internas e destinos ambíguos. Fora da janela de atendimento do WhatsApp, o envio exige o caminho de modelo aprovado. Se não houver vínculo válido, manter o aviso pendente para revisão.

Esta entrega ainda não contém cliente Notion, token no Render, webhook Notion nem envios de avisos. A conexão do Notion usada neste chat não é automaticamente disponibilizada ao servidor publicado. Não foram alterados registros no Notion.

## Entrega 5 — pré-atendimento com IA

Pendente: integração de IA no servidor para saudação, coleta inicial da necessidade, cidade e tipo de serviço, perguntas de triagem e resumo para a equipe. A IA deve ter acesso apenas ao contexto e aos documentos autorizados e pausar quando um atendente assumir a conversa. Questões que dependem de avaliação técnica, proposta ou compromisso comercial seguem para a equipe.

Definir instruções Domum, dados enviados, base de conhecimento e orçamento antes de preparar credenciais ou ativar consumo da API. A conversa atual e os conectores deste chat não são transferidos automaticamente ao atendimento. Nenhum serviço de IA é ativado por este plano.

## Referências verificadas

- Meta, mensagens e mídia: <https://www.postman.com/meta/whatsapp-business-platform/overview>.
- Notion, webhooks: <https://developers.notion.com/reference/webhooks>.
- OpenAI, Responses API: <https://developers.openai.com/api/reference/responses/overview>.
