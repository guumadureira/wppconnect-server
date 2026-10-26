# Evolução da Central Domum

## Entrega 1 — atendimento e contatos

Implementados: identidade visual com logos originais, assinatura por sessão, Enter para enviar, seletor de emojis e cadastro de contatos com nome, telefone internacional, e-mail e observações. É possível salvar um contato a partir da conversa e abrir a conversa correspondente pelo cadastro. Cadastrar ou abrir um contato não envia mensagens nem altera a agenda do celular.

Os IDs dos contatos são estáveis e os telefones são normalizados. O histórico permanece vinculado ao número original; outro número exige outro cadastro. A tabela de contatos é acrescentada ao banco existente, sem recriação. Rascunhos de respostas sobrevivem às atualizações da interface enquanto a página está aberta; não são salvos após fechar ou recarregar a página.

Período inicial escolhido pelo usuário: **últimos 15 dias**. A lista considera a data das mensagens registradas; editar o responsável ou o cadastro não torna um atendimento antigo recente. Conversas novas ainda sem mensagens usam sua data de criação. O seletor permite consultar todo o histórico disponível na central, e cada conversa oferece acesso às mensagens anteriores. Esse filtro não apaga registros nem altera alertas ou retornos. Abrir uma conversa antiga pelos contatos ou lembretes amplia a visualização para permitir o acesso.

Limite atual: não há importação do histórico do celular, tratamento dos eventos de sincronização de histórico nem suporte a grupos no código. Mensagens anteriores à integração e conversas que estavam em banco temporário não são recuperadas pelo filtro. Grupos e sincronização dos últimos 15 dias exigem avaliação separada da disponibilidade oficial para a conta; não foram ativados e não devem ser apresentados como já integrados. Nesta revisão, a documentação oficial da Meta sobre coexistência não pôde ser consultada por resposta HTTP 429, impedindo confirmar a elegibilidade e o alcance dessa importação.

## Entrega 2 — mídia e figurinhas

Pendente: receber e visualizar imagens, documentos, áudios e figurinhas, baixar os arquivos no computador e enviar anexos. Em seguida, biblioteca de figurinhas salvas/favoritas e reenvio. Usar os IDs de mídia e os endpoints oficiais da Meta; guardar arquivos em armazenamento privado e liberá-los por rotas autenticadas da central. Definir limites por arquivo, uso do disco e retenção antes da ativação. O disco atual é de 1 GB; ampliação ou outro armazenamento precisam de confirmação de custo.

## Entrega 3 — fotos e organização

Pendente: foto cadastrada no contato, arquivos associados ao cliente e arquivamento/limpeza de histórico. O objeto de perfil usado nos eventos de mensagem documenta o nome; a recuperação automática de fotos de perfil dos clientes não está confirmada. Oferecer foto manual enquanto isso. Prazos de retenção, itens protegidos e procedimento de exclusão dependem de escolha do usuário; nenhuma limpeza automática é ativada por este plano.

## Entrega 4 — jornada do cliente no Notion e comunicação

O vínculo principal é o **cadastro único do cliente e seu telefone confirmado**, desde a elaboração da proposta até execução e entregas, com contrato quando aplicável. Gestão de Atividades é uma fonte complementar dos eventos, dentro dessa jornada. Um cliente pode ter várias propostas e trabalhos; cada aviso deve identificar a frente correspondente e chegar à conversa autorizada. O contrato é opcional por contratação/trabalho: sua ausência não interrompe o cadastro, o atendimento ou as entregas. Não confundir contrato ainda não cadastrado com a decisão explícita de seguir sem contrato.

### Estrutura existente conferida

| Fonte | Papel e vínculos disponíveis |
| --- | --- |
| Clientes — Cadastro restrito | Cadastro progressivo, com `Telefone` e demais informações do cliente. É a referência para vincular o contato da central. |
| Controle de Propostas e Contratos | Contém `Cliente cadastrado`, `Link da Proposta`, `Status`, `Situação do contrato`, datas de envio/assinatura e `Trabalhos vinculados`. |
| Trabalhos — Obras, projetos e serviços | Conecta cliente, frente contratada, projeto beta, painel interno, pasta de entregas e portal do cliente. É um índice de integração; preserva os painéis existentes. |
| Projetos e Serviços — Beta | Contém o cadastro de Projetos e contratos — Beta, com `Cliente cadastrado`, `Trabalho integrado`, `Situação`, `Próximo marco` e pasta de documentos. |
| Obras/Acompanhamentos/Reformas | Mantém páginas específicas e modelos de painel interno e portal, vinculados ao cliente e ao Trabalho. |
| Gestão de Atividades | Eventos de execução vinculados por `Cliente cadastrado`, `Projeto / contrato` e `Trabalho integrado`. |

Os IDs específicos das fontes e credenciais devem ficar no ambiente privado da implantação, fora deste documento. Não criar um cadastro de cliente diferente para cada etapa. Preservar as relações e o histórico já existentes; associações antigas ainda precisam de conferência antes de ativar avisos.

### Eventos propostos

| Evento de negócio | Ação proposta no WhatsApp | Condição de liberação |
| --- | --- | --- |
| Proposta pronta | Enviar o PDF final ou acesso aprovado ao documento. | Autorização expressa de envio no Notion, destinatário conferido e versão final identificada. |
| Minuta liberada para aprovação do cliente | Enviar a versão identificada da minuta ou seu acesso aprovado, com pedido de revisão. | Liberação expressa no Notion, versão e destinatário conferidos. Deixar claro que é uma minuta para aprovação. |
| Cliente aprova ou solicita ajustes na minuta | Registrar aprovação ou pedido de revisão vinculado à versão, com evidência da resposta. | Conferência pela equipe; envio, entrega ou silêncio não comprovam aprovação. Nova versão precisa de nova aprovação. |
| Assinatura concluída, quando aplicável | Informar a confirmação e disponibilizar a via assinada quando liberada. | Registro no Notion da forma de assinatura, data e comprovante conferido pela equipe. Aprovação da minuta não equivale a assinatura. |
| Contratação/frente aberta | Associar ou preparar a página de projeto/serviço/obra e informar o início correspondente. | Marcos de contratação e início confirmados conforme o fluxo aplicável, inclusive contratação registrada sem contrato. Aceite da proposta, aprovação da minuta, assinatura, início e recebimento são eventos distintos. |
| Documento ou entrega técnica liberada | Enviar o arquivo ou link permitido ao cliente. | Versão aprovada, trabalho correto e liberação explícita; geração ou arquivamento isolados não autorizam envio. |
| Marco/atividade publicável atualizado | Informar o avanço referente ao trabalho. | Regra de comunicação escolhida e conteúdo revisado para o cliente. Edições internas não geram mensagens indiscriminadamente. |

O procedimento existente de propostas arquiva o PDF e registra o link sem enviá-lo ao cliente. Preservar esse comportamento. O status `A enviar`, sozinho, não comprova aprovação da proposta ou autorização de envio. Propor um controle próprio de liberação no Notion, com documento, versão e destinatário, antes de implementar os gatilhos. Nenhuma propriedade nova foi criada por esta especificação.

### Vínculo e registro dos envios

1. Associar o ID do cliente no Notion ao ID estável do contato na central e conferir o telefone. Não localizar destinatários apenas pelo nome.
2. Relacionar proposta, Trabalho, página específica e contrato quando houver ao mesmo cliente. A criação de páginas deve reutilizar as existentes e seguir seus modelos; não duplicar painéis ou consolidar históricos automaticamente.
3. Ao autorizar uma comunicação, registrar origem do evento, trabalho, versão do documento, conteúdo liberado e destinatário. Mudança de telefone ou arquivo deve exigir nova conferência do envio pendente.
4. Receber o evento pelo webhook verificado, consultar o registro atual, aplicar a regra de liberação e colocar o aviso em fila persistente, sem duplicação por repetição de evento.
5. Começar com prévia/revisão humana e um piloto autorizado. Registrar envio aceito, entrega confirmada ou falha separadamente; enfileirar ou arquivar um arquivo não equivale a entregá-lo ao cliente.
6. Usar anexos ou acesso aprovado especificamente para o destinatário. O portal do cliente é separado do painel interno; não enviar links da central administrativa nem ampliar compartilhamentos automaticamente.

Ler apenas os campos necessários. Informações internas, margens e dados restritos não entram automaticamente nos avisos. Os contatos que assinam um contrato e que recebem atualizações podem ser diferentes; o destinatário de cada comunicação precisa ser explícito. Fora da janela de atendimento do WhatsApp, usar o caminho de modelo aprovado. Se vínculo, liberação, arquivo ou destinatário forem ambíguos, manter o envio pendente para revisão.

### Contratos opcionais, minutas e registro da assinatura no Notion

A prioridade é o acompanhamento pelo Notion, independente do serviço de assinatura. Reutilizar os campos existentes e propor apenas os complementos necessários, sem modificar a base nesta etapa:

| Informação proposta | Registro esperado |
| --- | --- |
| Aplicabilidade do contrato por contratação/trabalho | A definir, com contrato ou sem contrato. A opção sem contrato dispensa as etapas de minuta/assinatura dessa frente; os demais marcos continuam independentes. |
| Minuta e versão em revisão | Arquivo ou link restrito, versão identificada e histórico das versões anteriores preservado. |
| Liberação do envio da minuta | Documento, destinatário e autorização da equipe para enviar; registrar o resultado separado da aprovação do cliente. |
| Revisão pelo cliente | Aguardando aprovação, ajustes solicitados ou aprovado, com versão, data e referência da resposta conferida. |
| Forma de assinatura | A definir, física ou eletrônica; quando eletrônica, registrar o provedor utilizado, sem obrigatoriedade de integração. Para frente sem contrato, não se aplica. |
| Situação e comprovação da assinatura | Reutilizar `Situação do contrato` e `Data da assinatura`, acrescentando referência à via assinada e responsável pela conferência quando necessário. |

Aprovação de minuta e assinatura são controles separados. Não marcar como assinado com base apenas em uma mensagem de aprovação, no envio do arquivo ou na assinatura de uma única parte quando outras ainda forem necessárias. Assinatura física pode ser registrada pela equipe com a cópia digitalizada conferida; assinatura eletrônica pode ser registrada manualmente com a evidência correspondente. A via assinada preserva a referência à versão final aprovada.

O envio de minutas exige o mesmo vínculo cliente/conversa, conferência de destinatário e registro de entrega dos demais documentos. A resposta do cliente deve ficar associada à versão enviada. Pedidos de alteração retornam à revisão; uma nova versão não herda automaticamente a aprovação anterior. Não criar nem enviar contratos reais como efeito desta especificação.

### Autentique — integração opcional em etapa posterior

A Domum utiliza o Autentique, mas a integração com sua API e o envio automático de links ficam adiados por orientação do usuário. Não são dependências do acompanhamento de contratos, da aprovação de minutas, da assinatura física ou da jornada de clientes sem contrato.

Quando essa etapa for retomada, avaliar a utilidade e o acesso da conta antes de implementar. Vincular documentos existentes por ID, tratar links por signatário e confirmar a conclusão de todas as etapas exigidas. Eventos devem ser autenticados, persistidos e deduplicados, com consulta do estado atual; uma assinatura individual não comprova a conclusão de todo o documento. Não duplicar convites pela central e pelo provedor. A confirmação pode então alimentar os mesmos campos de acompanhamento já usados manualmente no Notion. Nenhuma credencial, webhook, documento ou assinatura foi criado por este plano.

### Ordem de implementação desta integração

1. Vínculo cliente ↔ contato/conversa, com consulta das propostas, contratos e trabalhos relacionados, sem envio automático.
2. Liberação e envio da proposta final e das minutas pelo Notion, com documento/versão, confirmação na conversa e registro do resultado.
3. Acompanhamento da aprovação das minutas e registro manual da forma e comprovação de assinatura, com opção explícita de contratação sem contrato.
4. Preparação/vínculo dos painéis e comunicação das entregas de projeto, serviço ou obra, sem dependência do Autentique.
5. Automação dos marcos escolhidos e acompanhamento das falhas, após validar o piloto.
6. Avaliação posterior da integração opcional com o Autentique.

Essa integração ainda não contém cliente Notion no servidor, token no Render, webhook Notion nem envios de avisos. A conexão usada neste chat não é automaticamente disponibilizada ao aplicativo. Não foram alterados registros, páginas, permissões ou automações do Notion.

## Entrega 5 — pré-atendimento com IA

Pendente: integração de IA no servidor para saudação, coleta inicial da necessidade, cidade e tipo de serviço, perguntas de triagem e resumo para a equipe. A IA deve ter acesso apenas ao contexto e aos documentos autorizados e pausar quando um atendente assumir a conversa. Questões que dependem de avaliação técnica, proposta ou compromisso comercial seguem para a equipe.

Definir instruções Domum, dados enviados, base de conhecimento e orçamento antes de preparar credenciais ou ativar consumo da API. A conversa atual e os conectores deste chat não são transferidos automaticamente ao atendimento. Nenhum serviço de IA é ativado por este plano.

## Referências verificadas

- Meta, mensagens e mídia: <https://www.postman.com/meta/whatsapp-business-platform/overview>.
- Notion, webhooks: <https://developers.notion.com/reference/webhooks>.
- Autentique, criação de documentos e links individuais: <https://docs.autentique.com.br/api/2/mutations/criando-um-documento>.
- Autentique, eventos, conclusão e validação dos webhooks: <https://docs.autentique.com.br/api/integration-basics/webhooks>.
- Autentique, opções de envio: <https://ajuda.autentique.com.br/pt-BR/articles/9718602-opcoes-de-envio>.
- OpenAI, Responses API: <https://developers.openai.com/api/reference/responses/overview>.
