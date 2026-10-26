# Evolução da Central Domum

## Entrega 1 — atendimento e contatos

Implementados: identidade visual com logos originais, assinatura por sessão, Enter para enviar, seletor de emojis e cadastro de contatos com nome, telefone internacional, e-mail e observações. É possível salvar um contato a partir da conversa e abrir a conversa correspondente pelo cadastro. Cadastrar ou abrir um contato não envia mensagens nem altera a agenda do celular.

Os IDs dos contatos são estáveis e os telefones são normalizados. O histórico permanece vinculado ao número original; outro número exige outro cadastro. A tabela de contatos é acrescentada ao banco existente, sem recriação. Rascunhos de respostas sobrevivem às atualizações da interface enquanto a página está aberta; não são salvos após fechar ou recarregar a página.

Período atualmente implementado: **últimos 15 dias**. A preferência mais recente do usuário é reduzir para **últimos 7 dias**, na próxima etapa de ajustes após a validação do Notion; essa redução ainda não está implementada. A lista considera a data das mensagens registradas; editar o responsável ou o cadastro não torna um atendimento antigo recente. Conversas novas ainda sem mensagens usam sua data de criação. O seletor permite consultar todo o histórico disponível na central, e cada conversa oferece acesso às mensagens anteriores. Esse filtro não apaga registros nem altera alertas ou retornos. Abrir uma conversa antiga pelos contatos ou lembretes amplia a visualização para permitir o acesso.

Limite atual: não há importação do histórico do celular, tratamento dos eventos de sincronização de histórico nem suporte a grupos no código. Mensagens anteriores à integração e conversas que estavam em banco temporário não são recuperadas pelo filtro. Grupos e sincronização dos últimos 15 dias exigem avaliação separada da disponibilidade oficial para a conta; não foram ativados e não devem ser apresentados como já integrados. Nesta revisão, a documentação oficial da Meta sobre coexistência não pôde ser consultada por resposta HTTP 429, impedindo confirmar a elegibilidade e o alcance dessa importação.

## Entrega 2 — mídia e figurinhas

Implementados no código: recebimento e prévia de imagens e figurinhas, recebimento de documentos, download autenticado para o computador, preparação/revisão e envio de anexos, biblioteca compartilhada de figurinhas favoritas e reenvio. A confirmação de envio fica separada da preparação do arquivo e do recibo de entrega. Figurinhas não aceitam legenda; a autoria do atendente fica no registro da central. Imagens e documentos levam a assinatura da sessão na legenda.

Os bytes e metadados ficam em tabelas adicionais do mesmo SQLite das conversas, usando o caminho `DATABASE_PATH`. No Render com disco persistente, manter o banco em `/var/data/central.sqlite`. Não é necessário expor uma pasta pública nem contratar armazenamento nesta etapa. Limites iniciais: imagem JPEG/PNG de até 5 MB; documento PDF, Office ou TXT de até 20 MB; figurinha WebP 512 × 512, até 100 KB estática ou 500 KB animada. O limite lógico de todos os anexos é 500 MB, configurável para menos por `MEDIA_STORAGE_MAX_MB` (1 a 500). O SQLite, os demais registros e seus arquivos auxiliares também ocupam espaço no disco de 1 GB; esse teto não substitui o acompanhamento do espaço físico. Ampliação ou outro armazenamento precisam de confirmação de custo.

Arquivos são acessíveis somente com sessão autenticada. O recebimento registra primeiro a mensagem, depois tenta baixar o arquivo por ID pela API oficial. Há conferência de formato/tamanho/hash, bloqueio de redirecionamento ou endereço externo não autorizado e até cinco tentativas automáticas, além da opção de tentar novamente manualmente. Falha, tamanho excessivo ou falta de espaço mantêm a mensagem e informam o problema, sem apagar anexos existentes. A aplicação não expõe o token nem a URL temporária da Meta ao navegador. O modo demonstração não chama a Meta.

O envio usa os controles existentes de assinatura, idempotência, janela de 24 horas e manutenção da pendência em caso de falha. Preparar um arquivo ou selecionar uma figurinha não envia mensagem. Tirar o arquivo da prévia ou retirar uma figurinha dos favoritos não apaga o arquivo do histórico. Os favoritos são compartilhados pela equipe; as prévias de envio pertencem à conversa e à página aberta, e devem ser selecionadas novamente após recarregar a página. Anexos preparados mas não enviados também ocupam espaço. Ainda não há limpeza automática, importação de anexos antigos nem suporte a áudio/vídeo nesta entrega. A validação real com um contato autorizado e a publicação no Render permanecem separadas dos testes locais simulados.

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

### Primeira entrega implementada — contexto e histórico

Implementados no código: adaptador próprio para a API do Notion, vínculo conferido entre conversa e cliente, cadastro inicial por administrador com reconciliação de tentativas, consulta operacional de trabalhos/propostas/projetos/atividades, resumo interno com pendências e próximo passo, solicitações por assunto e histórico persistente com fila de sincronização. O painel **Cliente e histórico** permite usar esses registros localmente antes de configurar o Notion. As referências de conversa abrem o atendimento correto, inclusive fora do período inicial de 15 dias; um ID ausente não seleciona outro cliente.

O botão **Assumir atendimento** registra controle humano e responsável; **Permitir assistência** prepara o estado para a fase seguinte, sem ativar IA ou respostas. Novas mensagens não desfazem o controle humano. Eventos de recebimento de imagem/documento são registrados como recebidos, não como documentos validados. A autoria dos lançamentos manuais vem da sessão, não do conteúdo enviado pelo navegador.

Criada no Notion a base privada **Histórico de atendimentos — Central Domum**, com relação de retorno **Histórico de atendimentos** no cadastro de Clientes e uma visão por cliente. Acrescentada também a chave **ID de criação na central** para reconciliar a criação de cadastros após resultados incertos. Nenhum cliente foi criado, nenhum atendimento fictício foi lançado, nenhum conteúdo existente foi substituído e nenhum compartilhamento foi ampliado nesta implantação.

A ativação do servidor depende de credencial própria e IDs das fontes no ambiente privado, com `NOTION_ENABLED=true`. A conexão usada neste chat não é automaticamente disponibilizada ao aplicativo. Os testes usam transporte falso; publicação e acesso real pelo servidor ainda exigem verificação. Esta entrega não envia avisos ao cliente, não altera status técnicos/comerciais no Notion, não interpreta documentos por IA e não tem webhook de atualização do Notion. Alterações feitas no Notion aparecem na próxima consulta explícita, com data de referência.

O histórico é acrescentado por ID de evento, sem reescrever confirmações humanas anteriores. Uma criação incerta é pesquisada antes de outra tentativa; se não for possível determinar o resultado, fica para conferência, sem repetição automática. Cadastros ambíguos, nomes já existentes sem telefone correspondente e associação por telefone diferente exigem revisão. Orientações de ativação estão em `docs/notion-integracao.md`; os IDs reais das fontes são mantidos fora do Git.

## Entrega 5 — assistente geral de atendimento do WhatsApp

Estado do piloto: adaptador OpenAI, controle humano, limite local de consumo, liberação por telefone e histórico com autoria IA implementados no código. O ensaio gratuito é roteirizado e não chama modelo. O piloto real permanece desligado até a configuração privada do Render e a autorização de consumo. Cadastro automático, interpretação de documentos e avisos de avanço continuam como etapas posteriores. Consulte [atendimento-ia.md](atendimento-ia.md).

Pendente: integração de IA no servidor para **assistência geral às demandas recebidas pelo WhatsApp da Domum**, incluindo clientes existentes, novos contatos, pedidos de orçamento, acompanhamento de trabalhos e contatos comerciais. Orçamento é um dos caminhos, não o objetivo obrigatório de todo atendimento. A preferência do usuário é uma conversa natural, sem apresentação inicial padronizada como “assistente virtual” e sem formulário de triagem. A IA não deve se passar por Gustavo ou por outro atendente específico; se perguntarem sobre a automação, deve responder com clareza. A autoria automática deve continuar identificada no registro interno, separada das assinaturas de pessoas por sessão.

### Ciclo de entendimento, contexto, ação e retorno

Para cada demanda, seguir **entender o pedido → identificar o contexto → consultar a situação pertinente → decidir a próxima ação permitida → executar/registrar → dar um retorno adequado → acompanhar ou encaminhar**. Não conduzir todo contato ao cadastro de cliente, à coleta de documentos de imóvel ou a um orçamento. A classificação é da demanda atual: uma mesma pessoa pode ser cliente em um assunto e fornecedor em outro, e um cliente existente pode abrir uma demanda nova.

Cada decisão relevante deve ter uma consequência útil: responder, esclarecer, solicitar uma informação/arquivo pertinente, consultar um andamento liberado, registrar uma solicitação, executar uma ação já autorizada, encerrar o assunto resolvido ou avisar o atendente. Registrar internamente o contexto usado, a ação e seu resultado. A mensagem ao contato deve ser natural e orientada ao próximo passo, sem expor classificações internas ou produzir uma nova mensagem para cada classificação feita em segundo plano.

Consultar o contexto atual da central e do Notion, quando houver vínculo confirmado. Para um cliente existente, verificar se o assunto diz respeito a proposta em análise, documentação pendente, contratação com ou sem contrato, projeto/obra em andamento, trabalho suspenso ou concluído, entre outras situações realmente registradas. A resposta e a ação dependem dessa situação e da pergunta atual; não presumir que todo cliente está pedindo orçamento ou repetir o cadastro inicial.

Confirmar a conclusão de uma ação somente após o sistema de destino confirmar. Se a consulta estiver indisponível ou não houver informação atual, reconhecer a solicitação, registrar a pendência e encaminhar quando necessário, sem inventar andamento. Recebimento de arquivo, aceite comercial, assinatura, conclusão técnica e entrega são fatos distintos. Um documento recebido não altera automaticamente a situação de um trabalho.

### Conversa e identificação progressiva

1. Começar pelo que a pessoa disse, reconhecer sua necessidade e fazer uma pergunta pertinente por vez. Evitar pedir nome, telefone e endereço em sequência ou repetir dados já fornecidos. Usar mensagens curtas e permitir que o cliente explique o caso livremente.
2. Aproveitar o telefone recebido pela integração, normalizado com país e DDD, sem pedir que o contato o digite novamente. Em clientes existentes, usar o vínculo confirmado para consultar a situação antes de avançar. Para uma nova demanda de imóvel, a associação ao cadastro também pode acontecer depois da conversa inicial e do recebimento dos documentos-chave. Telefone, nome de perfil ou endereço isolados não são comprovação absoluta de identidade nem autorização para revelar todos os dados vinculados.
3. Fazer perguntas conforme a intenção. Para um novo interessado em serviço ligado a imóvel, entender o serviço e o município, pedir endereço quando ajudar e solicitar um documento-chave conforme a seção abaixo. Para um cliente existente, retomar o assunto e a situação registrada; para uma oferta comercial, entender a oferta e a empresa. Perguntar como prefere ser chamado quando isso faltar e for útil. Cadastro incompleto ou ausência de documentos não devem bloquear o atendimento geral.
4. Cruzar os dados pertinentes com os registros existentes para associar o atendimento ou criar o cadastro progressivo adequado ao tipo de contato quando não houver correspondência. Não criar um cliente de engenharia para todo vendedor que entrar em contato. Telefone novo, cadastro compartilhado, vários trabalhos possíveis ou divergência de nome/endereço ficam para conferência da equipe; não fundir cadastros, trocar telefones ou escolher o projeto por aproximação automaticamente. Não revelar dados de um cadastro candidato para tentar confirmar quem está falando.
5. A consulta ao Notion deve ser limitada no servidor ao cliente/trabalho já vinculado e aos campos liberados para comunicação. Endereço ajuda a distinguir a demanda, mas não funciona como senha para acessar documentos ou informações restritas. Antes de uma confirmação adequada, a IA pode continuar com orientações gerais e coleta do pedido.

### Caminho específico: nova demanda de imóvel ou pedido de orçamento

Aplicar esta coleta quando o pedido realmente envolver uma nova demanda de imóvel/projeto ou orçamento. O assistente deve avançar automaticamente até entender a demanda real e organizar os dados mínimos para avaliação comercial. Não encerrar a conversa ao primeiro pedido de orçamento; fazer a coleta breve que ajude a equipe a orçar, sem transformar o atendimento em uma entrevista documental detalhada. Este caminho não deve ser aplicado indiscriminadamente a clientes com outros assuntos ou a contatos comerciais recebidos.

- Confirmar o serviço pretendido e o **município do imóvel/projeto**. Não confundir a cidade onde o cliente mora com a cidade do serviço. Se o dado já estiver na conversa ou legível no documento, aproveitar essa informação e esclarecer apenas inconsistências.
- Para uma demanda de imóvel em que isso ajude, fazer uma solicitação curta de **matrícula do imóvel ou cadastro imobiliário do lote**. Começar por um documento-chave disponível; não exigir ambos por padrão, uma lista extensa de arquivos, documentos pessoais ou uma documentação completa para preparar o pedido de orçamento. Outras demandas e ofertas de fornecedores seguem sua própria condução.
- Se o cliente não tiver o arquivo, não souber encontrá-lo ou quiser avançar diretamente ao orçamento, continuar com município, descrição do serviço e informações básicas do imóvel que ele conseguir fornecer. Registrar a pendência e encaminhar uma solicitação preliminar, sem insistência repetida nem promessa de que já existe informação suficiente para um preço definitivo.
- Receber o PDF ou imagem pela central, guardar a referência ao arquivo original e extrair os dados úteis para a demanda, como município, endereço, identificação do lote/quadra, matrícula ou inscrição imobiliária quando presentes e legíveis. Não inventar campos ausentes ou tratar extração incerta como informação conferida. Dúvidas devem aparecer no resumo da equipe.
- Separar **quem está pedindo o serviço**, **qual é o imóvel** e **quem aparece como proprietário no documento**. O nome de proprietário extraído não deve substituir automaticamente o nome do contato nem criar outra pessoa como cliente do atendimento. Um cliente pode ter vários imóveis e trabalhos.
- Assim que houver contexto útil para a equipe preparar o orçamento, avisar o responsável e entregar o resumo. A coleta de documentos pode ser concluída pela IA antes da passagem, mas não pode prolongar a triagem sem necessidade. Definição de preço, escopo técnico e prazo continua com a equipe.

### Associação e cadastro automático no Notion

Associar a demanda conforme seu contexto. Para cliente existente, aproveitar o vínculo e a situação já registrados; para uma nova demanda, usar os dados mínimos disponíveis, incluindo documentos-chave quando pertinentes e recebidos. O sistema deverá:

1. Pesquisar o cadastro existente usando telefone normalizado e os demais dados realmente fornecidos. Relacionar os dados do imóvel à solicitação correspondente; endereço ou matrícula identificam um imóvel, não necessariamente o solicitante.
2. Quando houver vínculo seguro e único, associar conversa e solicitação ao cliente/contato existente. Reutilizar a solicitação em andamento quando se tratar da mesma demanda. Um cliente existente pode ter um assunto de acompanhamento e outro de novo orçamento simultaneamente; separar as solicitações sem duplicar o cliente.
3. Quando não houver correspondência e o contexto for de cliente/novo interessado, criar automaticamente um **cadastro progressivo** em Clientes e registrar a demanda relacionada, seguindo a estrutura existente. Criar solicitação de orçamento apenas quando esse for o assunto. Levar nome informado, telefone do atendimento, município/endereço do serviço quando pertinentes, descrição da demanda, origem da conversa e referências privadas aos documentos recebidos. Não exigir dados de contrato para cadastrar um interessado; não preencher nome civil, CPF ou outras informações com suposições. Para fornecedores e outros contatos, manter o registro da central e usar o destino correspondente no Notion quando esse mapeamento for definido, sem inseri-los automaticamente em Clientes.
4. Se a correspondência for ambígua ou o nome do solicitante não estiver definido, manter a solicitação vinculada à conversa e sinalizar conferência, sem criar clientes duplicados ou sobrescrever um cadastro. Essa pendência de associação não impede o encaminhamento comercial.
5. Guardar IDs estáveis da conversa, cliente e solicitação no banco da central. Repetições de mensagens, reenvio do mesmo arquivo, retomada de conversa ou nova tentativa da integração não devem criar outra pessoa ou repetir a mesma solicitação. Um pedido diferente do mesmo cliente pode gerar outra solicitação, preservando a anterior.
6. Registrar o que veio da conversa, o que foi extraído do arquivo e o que foi confirmado pela equipe. Manter o documento original em armazenamento restrito e disponibilizar ao Notion uma referência autenticada ou permitida para a equipe, sem criar links públicos automaticamente. Uma URL privada da central não deve ser tratada como arquivo já copiado ao Notion.
7. Usar fila persistente para falhas de integração. Se o Notion estiver indisponível, preservar documentos e solicitação na central, informar a pendência internamente e sincronizar depois sem duplicação.

Esse cadastro inicial não equivale a proposta aprovada, contrato assinado ou autorização para iniciar o serviço. Páginas formais de projeto/obra e comunicações de avanço continuam seguindo os marcos da Entrega 4. Este fluxo é requisito da integração; as consultas, criações e a extração por IA ainda não estão implementadas nem ativadas no servidor.

### Tratamento conforme a intenção

| Demanda e contexto | Ação e retorno adequados |
| --- | --- |
| Cliente existente pedindo andamento | Identificar o trabalho e consultar a situação atual liberada. Responder sobre o ponto solicitado e indicar o próximo passo conhecido. Sem informação suficiente/atual, registrar a pergunta para o responsável. |
| Cliente existente com documentação pendente | Conferir a pendência real, pedir ou receber o arquivo correspondente e registrar o recebimento. Distinguir arquivo recebido de documentação validada pela equipe. |
| Cliente existente com nova solicitação, alteração ou problema | Entender o pedido no contexto do trabalho, registrar uma solicitação relacionada e responder sobre o encaminhamento. Alterações técnicas, comerciais ou compromissos dependem da equipe. |
| Cliente com proposta em análise | Entender se deseja esclarecimento, revisão, aceite ou outro assunto; consultar a proposta correta e encaminhar a decisão que exigir a equipe. Não reiniciar toda a triagem de novo cliente. |
| Cliente com trabalho concluído | Identificar se é dúvida sobre entrega, pedido de documento, problema ou nova contratação, e seguir o caminho correspondente. Trabalho concluído não significa que toda mensagem seja nova venda. |
| Novo contato com dúvida geral | Responder com informação aprovada e entender o próximo passo desejado. Criar solicitação/cadastro apenas quando necessário ao atendimento, sem obrigar pedido de orçamento. |
| Novo interessado pedindo serviço/orçamento | Entender o serviço, realizar a coleta breve pertinente e registrar o cadastro progressivo/solicitação. Avisar a equipe quando houver contexto para avaliação comercial. |
| Fornecedor, vendedor, parceiro ou oferta comercial recebida | Entender empresa, assunto e material ofertado, registrar a demanda no contexto comercial adequado, responder sobre seu recebimento e encaminhar ao responsável quando necessário. Não assumir compromisso de compra ou criar uma oportunidade de cliente automaticamente. |
| Assunto administrativo ou financeiro | Entender a solicitação e encaminhar ao responsável; consultar ou enviar apenas dados/documentos autorizados para aquele contato. Não confirmar pagamento ou quitação apenas por imagem de comprovante. |
| Intenção ainda incerta ou várias demandas na mesma mensagem | Fazer uma pergunta breve de esclarecimento ou separar os assuntos em solicitações vinculadas. Permitir correção da classificação pela pessoa ou pelo atendente. |

### Regras de decisão para implementação

Configurar por tipo de demanda quais fontes podem ser consultadas, quais campos/documentos podem ser devolvidos, quais registros a IA pode criar ou atualizar, qual retorno corresponde ao resultado e quando avisar a equipe. Usar ferramentas limitadas a essas operações; o entendimento do modelo não deve dar permissão genérica para alterar o Notion ou enviar documentos. Reutilizar os controles de liberação da Entrega 4 para comunicações e arquivos que exigem aprovação.

O registro interno da demanda deve conter contexto do contato, assunto atual, vínculo com cliente/trabalho quando confirmado, situação consultada e fonte/data, dados pendentes, próximo passo, resultado da ação e responsável quando encaminhada. Esse registro é um resumo operacional verificável, sem expor raciocínio interno do modelo. A IA deve reconhecer correções, mudança de assunto e pedidos já resolvidos, evitando perguntas ou cadastros repetidos.

### Histórico integrado por cliente e continuidade do atendimento

Requisito do usuário: a central e o Notion devem se retroalimentar para que uma retomada, mesmo depois de algum tempo, aproveite o que já foi informado, recebido, feito e confirmado. A finalidade inclui **entender e preparar o atendimento humano**, mesmo quando não houver resposta automática ao contato.

Conferência inicial: Clientes — Cadastro restrito já continha `Telefone`, `Etapa do Atendimento`, `Etapa do cadastro`, `Atividades do cliente` e `Projetos e serviços`. Na fonte consultada e na amostra de página de cliente, não foi identificado um registro estruturado próprio de atendimentos/ações da IA. A busca foi limitada à estrutura integrada, aos termos de atendimento e a uma página de cliente; não comprova ausência de estruturas equivalentes em todo o workspace. Na implantação autorizada, foi criada a base privada de histórico e acrescentadas a relação de retorno e a chave de criação, preservando as propriedades e os registros anteriores.

#### Organização proposta na página privada do cliente

- **Resumo atual do atendimento:** assuntos em aberto, situação confirmada dos trabalhos pertinentes, documentos recebidos/pendentes, responsável e próximo passo, com fonte e data da atualização.
- **Histórico de atendimentos e ações:** linha do tempo relacionada ao cliente e, quando couber, à proposta, trabalho e demanda específicos. Reutilizar uma fonte equivalente se descoberta na implantação; caso contrário, criar uma fonte privada de registros de atendimento e mostrar seus registros relacionados na página de cada cliente. Não criar uma base independente para cada pessoa nem copiar o cadastro completo a cada atendimento.
- **Pendências e solicitações:** acesso às solicitações em aberto e às atividades já existentes. Uma entrada de histórico registra um fato/ação; uma atividade representa o trabalho a fazer. Relacioná-las quando necessário, sem duplicar tarefas na Gestão de Atividades.

Essa seção deve ser incluída no modelo utilizado pela integração para novos clientes e acrescentada aos existentes sem substituir seu conteúdo. Páginas com vários trabalhos devem permitir distinguir os assuntos por frente. Fornecedores e outros contatos que ainda não pertencem a Clientes mantêm a continuidade na central e recebem o vínculo adequado quando o destino comercial for definido; não criar clientes fictícios para registrar ofertas.

#### Unidade de registro e informações úteis

Uma entrada de histórico corresponde a um acontecimento relevante: solicitação identificada, documento solicitado/recebido, dado confirmado/corrigido, ação efetivamente executada, retorno enviado, encaminhamento humano, pendência resolvida ou mudança de situação confirmada na fonte. Não gerar uma entrada para cada classificação intermediária do modelo nem replicar toda mensagem do WhatsApp no corpo da página.

| Informação do registro | Uso |
| --- | --- |
| ID estável do evento, conversa e demanda | Vincular as fontes e impedir repetição por reenvio ou nova tentativa. |
| Data do acontecimento e data de sincronização | Distinguir quando algo ocorreu de quando chegou ao Notion. |
| Cliente/contato e trabalho/proposta relacionados | Recuperar o contexto correto sem misturar frentes. |
| Tipo e resumo objetivo do acontecimento | Mostrar o que aconteceu e o que o contato pediu. |
| Autor/origem: IA, atendente, cliente ou sistema | Distinguir quem informou ou realizou cada ação. |
| Qualificação: informado, extraído, interpretado, confirmado ou corrigido | Evitar tratar uma interpretação da IA como fato verificado. |
| Fonte/evidência e resultado da ação | Referenciar mensagem, arquivo ou registro atual, distinguindo intenção, tentativa, sucesso, falha e entrega confirmada. |
| O que falta, próximo passo e responsável | Preparar continuidade e encaminhamento humano. |

Manter as referências aos originais em local privado e acessível à equipe autorizada. O histórico deve conter apenas o necessário ao atendimento; não replicar CPF, dados financeiros completos ou outros dados restritos em resumos operacionais. Uma visualização filtrada por cliente não é controle de acesso: o histórico interno fica separado do portal do cliente e do material liberado para envio.

#### Consulta na retomada e retorno para o atendente

1. Identificar o contato e recuperar os vínculos confirmados. Usar o assunto atual para selecionar o trabalho/demanda pertinente, sem carregar indiscriminadamente todos os documentos do cliente.
2. Ler o resumo atual, as solicitações abertas, os registros relevantes do histórico e os estados atuais das fontes do Notion. A informação atual confirmada pode substituir um resumo antigo; manter a origem e a data de cada informação.
3. Comparar a nova solicitação ao que já existe: o que foi pedido, o que chegou, o que foi resolvido, o que falta e qual é a próxima ação permitida. Pedir esclarecimento apenas para o que estiver ausente, ambíguo ou desatualizado.
4. Produzir um resumo interno para o atendente com **situação atual, nova solicitação, itens já disponíveis, pendências, próximo passo e referências**. A preparação desse contexto não obriga o envio de uma mensagem ao cliente. Respostas externas continuam dependentes do modo IA/humano e das regras de ação/liberação.
5. Registrar a ação ou encaminhamento ocorrido. A confirmação/correção humana deve alimentar o mesmo contexto para o próximo atendimento; manter o registro anterior e a correção, em vez de apagar ou perpetuar uma interpretação equivocada.

#### Sincronização e atualização confiáveis

Persistir primeiro o evento na central e sincronizá-lo com o Notion por fila, usando o mesmo ID em novas tentativas. Guardar no banco os IDs retornados pelo Notion e conferir o destino antes de repetir uma criação após resultado incerto. Registrar a origem das alterações e não transformar o espelhamento de um evento em outro evento idêntico, evitando ciclos entre central e Notion.

Alterações humanas ou automações autorizadas no Notion precisam ser consultadas na retomada ou reconciliadas por evento. Não confiar exclusivamente no último resumo escrito pela IA. Interpretações e extrações não confirmadas não podem sobrescrever dados validados nem virar fonte de verdade apenas por terem sido registradas anteriormente. O histórico é memória operacional consultável, com evidências e correções, e não uma autorização para a IA mudar suas próprias regras.

O filtro de 15 dias na central organiza a visualização inicial; não elimina o contexto relevante de atendimentos anteriores. Prazos de retenção e eventual exclusão continuam sendo uma decisão separada. A fonte privada de registros e a relação no cadastro foram criadas. O painel da central, os registros e a fila estão implementados no código, com ativação dependente da configuração do servidor. A recuperação e interpretação por IA, inclusão de blocos personalizados em todos os clientes e criação automática de atividades técnicas permanecem para etapas seguintes.

### Aviso para a equipe e momento de assumir

A IA deve resolver os assuntos que estiverem dentro das ações e informações aprovadas e sinalizar **pronto para assumir** quando o próximo passo exigir uma pessoa, sem exigir que todas as perguntas possíveis tenham sido respondidas. Entender uma demanda não exige encaminhá-la sempre: o retorno pode ser uma resposta suficiente, a confirmação de uma ação concluída, uma pergunta pertinente ou a passagem à equipe. O aviso interno deve conter tipo de contato, necessidade, situação atual consultada, trabalho vinculado ou dúvida de identificação, informações já fornecidas, ação realizada e motivo do encaminhamento. Notificações fora da central serão definidas separadamente; este plano não ativa envio de alertas por outros canais.

Encaminhar antes disso quando houver pedido por uma pessoa, avaliação técnica, necessidade de definir ou confirmar preço/prazo/condição comercial, negociação, reclamação, urgência, identidade ambígua, resposta incerta ou conversa que não esteja avançando. O pedido inicial de orçamento pode ser conduzido pela IA até a coleta breve descrita acima; definir o valor é outra etapa. Situações que exigem uma pessoa não devem esperar a conclusão de uma triagem rígida. Valores e compromissos não aprovados não podem ser inventados nem confirmados pela IA.

Estados propostos por demanda: **em atendimento pela IA, aguardando contato, aguardando equipe, em atendimento humano ou resolvida**. Manter o controle de IA/humano por conversa para evitar respostas simultâneas quando houver vários assuntos. O botão **Assumir atendimento** deve estar disponível a qualquer momento. Ao assumir, pausar a IA e cancelar respostas automáticas em preparação ou na fila; conferir novamente o estado imediatamente antes de qualquer envio. Uma nova mensagem do cliente não reativa a IA em uma conversa assumida. O retorno exige uma ação explícita de **Devolver à IA**, com o contexto atualizado. A passagem à equipe não deve prometer presença imediata ou um horário de resposta que não esteja configurado.

A primeira versão deve atender os diferentes tipos de demanda recebida, com acolhimento, entendimento de contexto, consulta à situação existente, respostas aprovadas, registro/associação de solicitações e retornos adequados a cada resultado. Solicitação de documentos-chave, extração de dados e organização de orçamento/cadastro progressivo são caminhos específicos dentro desse assistente geral. A definição e aprovação de orçamento, orientações técnicas, aprovação de minutas e compromissos comerciais permanecem com a equipe. A consulta de andamento e as notificações do Notion dependem da integração e das liberações descritas na Entrega 4. O piloto do assistente está implementado no código com as limitações descritas acima; ainda não foi ativado no serviço publicado.

Definir instruções Domum, dados enviados, base de conhecimento e orçamento antes de preparar credenciais ou ativar consumo da API. A conversa atual e os conectores deste chat não são transferidos automaticamente ao atendimento. Nenhum serviço de IA é ativado por este plano.

## Ajustes solicitados para depois da validação do Notion

- **Continuidade entre celular e central:** a preferência atual é pelos últimos **7 dias**, substituindo o pedido anterior de 15 dias, incluindo mensagens recebidas e respostas enviadas pelo aplicativo WhatsApp Business, além das mensagens enviadas pela central. O filtro existente organiza apenas mensagens já registradas; ele não importa o histórico do celular. O adaptador já processa `smb_message_echoes`, mas a entrega desses eventos pelo número real ainda precisa ser conferida. A recuperação de mensagens anteriores exige uma etapa própria, com verificação da elegibilidade e disponibilidade de sincronização na Meta; não prometer recuperação integral nem incluir grupos sem confirmar suporte. Deduplicar mensagens por identificador da Meta e preservar data e origem. O período recente não autoriza apagar mensagens antigas nem reduzir a memória operacional relevante do cliente no Notion.
- **Histórico compartilhado da equipe:** manter uma única conversa por contato, visível aos atendentes autorizados, com as respostas de todos. A assinatura identifica a sessão que enviou pela central. Uma resposta recebida como eco do aplicativo não permite identificar automaticamente qual pessoa usou o celular.
- **Áudio:** implementar recebimento, reprodução e download de áudio e envio de arquivo de áudio. Incluir gravação pelo microfone com prévia, cancelamento e confirmação de envio, conforme formatos compatíveis com a API e o navegador. Manter anexos privados no armazenamento persistente e aplicar os limites de espaço e de envio. Transcrição e análise pela IA ficam separadas desta entrega. O suporte atual ainda se limita a imagens, documentos e figurinhas.
- **Assinatura em negrito:** formato confirmado pelo usuário: **Gustavo:** Olá! Como podemos ajudar? Nas próximas mensagens de texto e legendas enviadas pela central, formatar o nome do atendente e os dois-pontos em negrito no WhatsApp e na visualização interna; manter o restante da mensagem em texto normal. Preservar mensagens anteriores, autoria por sessão e limites de tamanho. Áudios e figurinhas mantêm a autoria interna, sem inserir legenda não suportada nem enviar mensagem extra automaticamente.

## Referências verificadas

- Meta, mensagens e mídia: <https://www.postman.com/meta/whatsapp-business-platform/overview>.
- Meta, carregamento de figurinhas: <https://www.postman.com/meta/whatsapp-business-platform/request/fd2syvj/upload-sticker>.
- Meta, download de mídia: <https://www.postman.com/meta/whatsapp-business-platform/request/zsq66eh/download-media>.
- Notion, webhooks: <https://developers.notion.com/reference/webhooks>.
- Notion, consulta de fontes: <https://developers.notion.com/reference/query-a-data-source>.
- Notion, criação de páginas: <https://developers.notion.com/reference/post-page>.
- Notion, versão da API: <https://developers.notion.com/reference/versioning>.
- Autentique, criação de documentos e links individuais: <https://docs.autentique.com.br/api/2/mutations/criando-um-documento>.
- Autentique, eventos, conclusão e validação dos webhooks: <https://docs.autentique.com.br/api/integration-basics/webhooks>.
- Autentique, opções de envio: <https://ajuda.autentique.com.br/pt-BR/articles/9718602-opcoes-de-envio>.
- OpenAI, Responses API: <https://developers.openai.com/api/reference/responses/overview>.
