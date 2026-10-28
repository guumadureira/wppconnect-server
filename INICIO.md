# Central de atendimento WhatsApp

Central para evitar clientes sem resposta, identificar cada atendente e organizar retornos. O projeto recupera a demonstração da conversa “Criar integração WhatsApp para CRM”. O final do servidor e da interface foi reconstituído porque os registros disponíveis estavam truncados.

## Desenvolvimento local

Requer Node.js 24 ou superior; este ambiente foi validado com 24.19.0. A aplicação não tem dependências externas para instalar.

```sh
cd /workspace/wppconnect-server
npm test
npm start
```

O servidor inicia na porta 3000, restrito à máquina local. A verificação de saúde é `GET /healthz`; `GET /api/session` informa se o primeiro administrador precisa ser cadastrado. A interface do servidor oferece esse cadastro, depois o login e a criação da equipe. Não há conta, senha ou cliente pré-cadastrado no banco deste ambiente.

O padrão é **demonstração**: mensagens não são enviadas ao WhatsApp. Depois de entrar, use **Simular cliente**, responda e cadastre mais atendentes em **Equipe**. Para uma prévia sem servidor, `public/index.html` também possui um modo com dados fictícios; a abertura de arquivos locais pode ser bloqueada pelo navegador gerenciado.

Se aparecer **Central indisponível**, a página não conseguiu acessar a API da central. Use **Tentar novamente** para repetir a conexão, ou **Explorar demonstração** para abrir explicitamente uma prévia com dados fictícios neste navegador. Essa opção não acessa o banco do servidor nem envia mensagens ao WhatsApp. Uma prévia HTML servida por outro endereço não oferece, por si só, as rotas da API.

Na execução local, as contas, mensagens, retornos e alertas persistem em `data/central.sqlite`. Preserve o diretório `data` e faça backups consistentes com SQLite. No Render gratuito, o blueprint usa `/tmp/central-demo.sqlite`: o banco é temporário e pode desaparecer quando o serviço reiniciar, atualizar ou entrar em suspensão. Use somente dados fictícios nessa avaliação. Testes automatizados usam bancos separados e transporte simulado. O README original do WPPConnect permanece preservado, mas seus comandos não se aplicam à nova central.

## Configuração privada

Use `.env.example` como referência e crie `.env` somente quando precisar alterar as configurações. Não coloque valores de credenciais no código, Git ou chat.

| Configuração | Função |
| --- | --- |
| `WHATSAPP_MODE` | `demo` por padrão; `live` habilita o adaptador real. |
| `WHATSAPP_PHONE_NUMBER_ID` | Identificador do número autorizado na Meta. |
| `WHATSAPP_ACCESS_TOKEN` | Token com acesso ao número e permissão de mensagens. |
| `META_APP_SECRET` | Segredo original do aplicativo para validar o HMAC dos eventos. |
| `WEBHOOK_VERIFY_TOKEN` | Valor privado de verificação, igual no servidor e no cadastro do webhook. |
| `META_GRAPH_VERSION` | Versão suportada pelo aplicativo, no formato `vNN.N`. |
| `META_APP_ID` | Identificador público do aplicativo usado no cadastro de coexistência. |
| `META_LOGIN_CONFIG_ID` | Identificador público da configuração de Login do Facebook para Empresas. |
| `META_COEXISTENCE_PHONE_NUMBER` | Número do Business esperado, com país e DDD, somente dígitos conforme a Meta; não altera `WHATSAPP_PHONE_NUMBER_ID`. |
| `PUBLIC_ORIGIN` | Origem HTTPS pública da central, sem caminho nem barra final. |
| `SETUP_TOKEN` | Código privado para cadastrar o administrador em uma instalação remota. |
| `MEDIA_STORAGE_MAX_MB` | Limite lógico de anexos no SQLite, de 1 a 500 MB; padrão 500. Não apaga arquivos automaticamente. |
| `ALERT_WEBHOOK_URL` | Destino opcional, sob seu controle, para entregar lembretes fora do navegador. |
| `ALERT_WEBHOOK_TOKEN` | Credencial opcional do destino de alertas. |

Em **Conexão → Verificar configuração**, o administrador vê os nomes das configurações pendentes, sem seus valores. O diagnóstico não faz requisições à Meta. Credenciais preenchidas não comprovam conexão real.

`META_APP_SECRET` e `WEBHOOK_VERIFY_TOKEN` precisam estar disponíveis como valores originais no processo do servidor, pois são comparados localmente. Marcadores de credenciais substituídos somente por um proxy de rede não servem para essa validação. Configure-os pelo gerenciador de segredos da hospedagem ou por arquivo privado, com acesso restrito.

## Imagens, documentos, figurinhas e áudios

Em uma conversa, use **Anexar arquivo**, escolha o tipo e prepare o arquivo. A prévia permite revisar antes de clicar em **Enviar**. Imagens JPEG/PNG aceitam até 5 MB; documentos PDF, Office e TXT, até 20 MB. Figurinhas devem ser WebP 512 × 512, com até 100 KB estáticas ou 500 KB animadas, e são enviadas sem legenda. Use **Salvar figurinha** em uma mensagem para adicioná-la à biblioteca compartilhada da equipe e **Figurinhas salvas** para preparar seu reenvio. O botão **Baixar arquivo** salva o original no computador; documentos são servidos como download.

Anexos ficam em tabelas adicionais no mesmo banco `DATABASE_PATH`, sem recriar contas ou conversas. Em produção, esse banco precisa estar no disco persistente, por exemplo `/var/data/central.sqlite`. O limite inicial de 500 MB deixa espaço para outros dados no disco de 1 GB, mas acompanhe também o uso físico do disco no Render. Em **Conexão**, a central mostra o uso lógico de anexos. Ao atingir o limite, mantém os arquivos e registra a falha; não há exclusão automática. Arquivos preparados sem envio também consomem espaço.

O recebimento primeiro registra a mensagem e depois baixa o arquivo pela API oficial, com tentativas limitadas e opção manual de tentar novamente. A central não recupera anexos de mensagens antigas que não tenham sido registrados pela integração. Áudios OGG/Opus, MP3, M4A, AAC e AMR têm limite de 16 MB; a reprodução depende dos formatos suportados pelo navegador. Não há suporte a vídeo nesta entrega. Testes usam arquivos fictícios e transporte simulado; a publicação e a entrega real ao WhatsApp devem ser verificadas separadamente.

Ao ouvir um áudio, a atualização automática da conversa preserva o mesmo player, sua posição, pausa, velocidade e volume. Em navegadores com suporte, o elemento é movido sem reiniciar a reprodução; há retomada de compatibilidade nos demais. Trocar de conversa ou sair da tela interrompe o áudio antigo. **Baixar arquivo** permite ouvir o original fora da Central. A correção da interface não altera arquivos, permissões, transcrição ou consumo de IA. A técnica de preservação de estado está descrita na [documentação do Chrome](https://developer.chrome.com/blog/movebefore-api).

## Retomar a conexão à Meta

A avaliação gratuita está em [docs/hospedagem-render.md](docs/hospedagem-render.md), com configuração em `render.yaml`: plano Free, modo demonstração e banco temporário. A central foi publicada em `https://central-atendimento-znn0.onrender.com`; a configuração do serviço foi posteriormente colocada em modo real com o número de teste da Meta, preservando o número Business da empresa. No Render, a aplicação usa `RENDER_EXTERNAL_URL` como origem quando `PUBLIC_ORIGIN` não estiver definido. Hospedagem online e credenciais preenchidas não comprovam conexão efetiva com o número Business.

1. Para uso real pela equipe, definir hospedagem com Node.js 24+, processo sempre ativo, disco persistente, HTTPS público e backup. O plano gratuito com SQLite temporário serve para avaliação, pois pode perder contas e conversas. Configurar `HOST` e `PORT` conforme a hospedagem e `PUBLIC_ORIGIN` com o domínio público. Configurar `SETUP_TOKEN` antes de expor o cadastro inicial. O proxy reverso deve preservar a origem das requisições e servir HTTPS.
2. Inspecionar o portfólio empresarial e a conta WhatsApp corretos, preservando número, conta Business e conversas. O aplicativo antigo “Chatwoot Domum” não foi reutilizado nem excluído. Sua configuração ainda precisa ser verificada antes de qualquer remoção.
3. Verificar elegibilidade e um fluxo de cadastro de **coexistência** compatível com manter o Business ativo. Em **Conexão → Preparar conexão com WhatsApp Business**, administradores podem abrir o cadastro incorporado e conferir a autorização. A ativação do número continua separada; nenhum provedor foi contratado. Uma chave de provedor pode exigir um adaptador diferente; este código chama diretamente a Cloud API da Meta.
4. Configurar as credenciais de forma privada. Cadastrar `https://SEU-DOMINIO/webhooks/whatsapp` e a assinatura dos eventos de mensagens. Para coexistência, verificar também a disponibilidade/configuração de `smb_message_echoes`.
5. Com um contato de teste autorizado, validar entrada de mensagem, resposta assinada por dois usuários, recibos, ecos de respostas pelo aplicativo e entrega efetiva de um lembrete. Só então abrir o atendimento à equipe.

O webhook verifica HMAC do corpo bruto e restringe o recebimento ao identificador de número configurado. Mensagens duplicadas são deduplicadas. Envios recusados ou não confirmados mantêm a pendência, e uma mensagem nova recebida durante o envio continua pendente.

### Preparar coexistência

Configure os identificadores `META_APP_ID` e `META_LOGIN_CONFIG_ID`, o número esperado `META_COEXISTENCE_PHONE_NUMBER` e as credenciais `META_APP_SECRET` e `META_GRAPH_VERSION`. O modo deve ser `live` e a origem pública HTTPS. Na configuração de Login do Facebook para Empresas, autorize essa mesma origem para o SDK JavaScript. As verificações/habilitações exigidas pela Meta permanecem necessárias; IDs preenchidos não comprovam elegibilidade.

O botão administrativo abre uma página separada que carrega o SDK oficial somente após verificar a sessão. Ela solicita `whatsapp_business_app_onboarding` com sessão `3` e fluxo `v4`, recebe código e evento de conclusão em qualquer ordem e envia o código uma única vez ao servidor. O servidor restringe a tentativa à sessão, por até dez minutos, e consulta pela Graph API os números da conta escolhida, usando o token recém-autorizado. Só registra uma conferência quando a Meta retorna `is_on_biz_app: true` e `platform_type: CLOUD_API` e o telefone real coincide com `META_COEXISTENCE_PHONE_NUMBER`. Essa comparação aceita identificadores de ativos novos durante o cadastro, mantendo o telefone físico restrito ao autorizado. Respostas do navegador, sozinhas, não comprovam a conexão.

Esse recurso **prepara e confere a autorização**: não registra/migra/exclui o número, não assina webhooks de outra conta, não envia mensagens e não troca `WHATSAPP_PHONE_NUMBER_ID` nem `WHATSAPP_ACCESS_TOKEN`. O token retornado é usado apenas na consulta e não fica guardado, nem é enviado ao navegador. O banco registra apenas identificadores, telefone de exibição e data da conferência. A ativação posterior requer uma nova autorização, armazenamento adequado das credenciais e validação efetiva de recebimento/envio. O SQLite temporário do Render Free continua sendo apenas para avaliação.

Se apenas o login do Facebook retornar, a tela informa que ainda aguarda a confirmação do cadastro WhatsApp. Quando falta um dos dois retornos por mais de 30 segundos, a tentativa é encerrada com orientação e acesso à configuração na Meta. Isso não comprova a causa do retorno incompleto; confira a variação de login e as habilitações do aplicativo. Um retorno tardio não conclui a tentativa encerrada.

Referência do protocolo: [exemplo oficial da Meta](https://github.com/fbsamples/business-messaging-sample-tech-provider-app/tree/14703a3e1fdba9bcf75b2360b00817b6fcc9f79b), em especial `app/components/ClientDashboard.tsx`, `Fbl4bLauncher.tsx` e `app/publicConfig.ts`. Os testes locais simulam a Meta e não usam o número real.

## Contexto, solicitações e histórico no Notion

Em uma conversa, abra **Cliente e histórico**. O painel interno permite salvar resumo, pendências, próximo passo e solicitações por assunto, incluindo acompanhamento, documentos, contatos comerciais e pedidos de orçamento. Esses registros ficam no SQLite persistente, mesmo sem Notion configurado. Arquivos novos recebidos geram registro de recebimento, sem afirmar que a documentação foi validada. Não há importação automática das conversas antigas.

**Assumir atendimento** registra a pessoa da sessão como responsável e mantém o controle humano. **Permitir assistência** apenas prepara o controle para a etapa seguinte; não ativa modelo de IA, consumo de API ou resposta automática. Uma nova mensagem não retira o controle humano. As solicitações têm situação própria e podem ser atualizadas sem fechar a conversa inteira.

Para conectar o servidor, configure `NOTION_TOKEN`, `NOTION_CLIENTS_DATA_SOURCE_ID` e `NOTION_HISTORY_DATA_SOURCE_ID`, depois `NOTION_ENABLED=true`. O token deve ser configurado diretamente no ambiente privado do Render e ter acesso próprio às bases necessárias. O conector do chat não é transferido para a aplicação. As fontes opcionais `NOTION_WORKS_DATA_SOURCE_ID`, `NOTION_PROPOSALS_DATA_SOURCE_ID`, `NOTION_PROJECTS_DATA_SOURCE_ID` e `NOTION_TASKS_DATA_SOURCE_ID` permitem consultar a situação operacional atual. Use os IDs de **data source**, não os IDs das páginas que contêm as bases. A implementação usa a versão fixa `2026-03-11` da API do Notion, sem dependências externas.

Em **Conexão → Histórico integrado com o Notion**, use **Verificar acesso ao Notion**. Na conversa, **Buscar cliente no Notion** localiza candidatos e exige confirmação do vínculo. Telefones diferentes e troca de cliente exigem justificativa de administrador; nomes semelhantes não são associados automaticamente. **Criar cadastro inicial**, disponível ao administrador, reaproveita telefone coincidente único ou cria apenas o cadastro inicial com nome informado e telefone; cadastros com nome já existente exigem conferência. Não cria contrato, preço ou autorização de início. O município informado na criação fica no conteúdo da página, sem alterar opções existentes da base.

**Consultar situação no Notion** traz cliente, trabalhos, propostas/contratos, projetos, atividades e os últimos registros de histórico. O painel inclui data da consulta e avisa fontes ausentes, erros ou resultados parciais. Valores, CPF/CNPJ, dados bancários e pastas restritas não são retornados pelo adaptador à interface. As consultas não enviam mensagem ao cliente nem modificam seus status operacionais. Abrir um cache de contexto não substitui uma nova consulta à fonte para confirmar a situação atual.

O histórico é sincronizado em fila, por ID estável de evento, usando a base privada criada para atendimento e a relação com Clientes. Ao ocorrer falha, o registro permanece na central. Se uma criação no Notion ficar sem resposta, a aplicação pesquisa seu ID antes de tentar outra operação; resultados incertos sem correspondência visível ficam para conferência, sem recriar automaticamente. **Sincronizar histórico pendente** permite ao administrador antecipar a fila. Uma alteração humana no Notion aparece na próxima consulta; esta entrega não tem webhook de atualização do Notion.

As alterações de contexto e situação usam versões para evitar sobrescrita por sessões simultâneas. O cliente vinculado, os eventos, as solicitações e a fila sobrevivem ao reinício. Campos recebidos de páginas e mensagens são dados, não instruções de execução. O adaptador possui operações específicas; não oferece ao navegador uma API genérica de leitura/escrita do workspace. A IA, interpretação automática de documentos e respostas autônomas permanecem para a próxima etapa.

## Limites atuais

O piloto opcional de IA e o ensaio sem consumo estão descritos em [docs/atendimento-ia.md](docs/atendimento-ia.md). A configuração padrão permanece desligada e sem consumo; a existência de uma chave não ativa respostas. A liberação real exige telefone de teste, limite de gasto autorizado e configuração privada no servidor. O cadastro inicial automático pode ser habilitado com AI_AUTO_REGISTER, somente no piloto e com fonte dos dados e duplicidade conferidas. A interpretação de documentos continua com a equipe.

As regras de continuidade, cumprimentos e condução breve estão em [docs/continuidade-atendimento.md](docs/continuidade-atendimento.md), com critérios para revisar o piloto depois do deploy. O comportamento do atendimento WhatsApp é definido na Central; alterar o agente de operadores ou configurar webhooks do Notion não muda essas regras.

- A assinatura automática se aplica às mensagens enviadas pela central. Ecos do aplicativo Business não identificam automaticamente o atendente.
- O prazo de alerta usa tempo corrido, sem calendário de horário comercial. O padrão é 30 minutos.
- Notificações do navegador exigem permissão e a central aberta. Avisos com a página fechada dependem de um destino externo de alertas; nenhum está configurado neste ambiente.
- Mensagens livres são bloqueadas após a janela de 24 horas. Modelos aprovados, recuperação de senha, importação do histórico e respostas automáticas de IA ainda não estão implementados. Anexos e contexto de atendimento têm suas próprias seções acima.
- O fluxo local foi validado com API simulada. No serviço publicado, o webhook foi cadastrado e o campo `messages` assinado; o usuário optou por adiar o teste de recebimento na central. O envio do número de teste retornou `130497`, restrição informada pela Meta para o país do destinatário. A coexistência e a ativação do número Business real permanecem pendentes.

Mais detalhes da versão anterior estão em [docs/projeto-original.md](docs/projeto-original.md). O código legado do WPPConnect foi removido por solicitação do usuário; o nome do repositório não define o adaptador usado pela nova central.

## Personalização da central

### Identidade Domum e assinatura por sessão

A central usa os logos originais de `DOCUMENTOS-DOMUM/DOMUM-IDENTIDADE VISUAL` no OneDrive: `APENAS NOME PRETO.png`, `APENAS NOME BRANCO.png` e `APENAS LOGO PRETO.png`, copiados sem edição. As cores-base `#EE935C` e `#201E1E` foram extraídas desses arquivos. O laranja é usado como destaque; textos e controles usam tons com contraste adequado.

No login, **Quem está atendendo?** permite escolher a assinatura desta sessão. **Trocar atendente** altera esse nome sem mudar a conta, as demais sessões ou o histórico. Se nenhum nome for escolhido, a assinatura usa o nome cadastrado na conta. Pessoas em dispositivos, perfis ou navegadores diferentes podem usar o mesmo e-mail com nomes distintos. Abas do mesmo perfil compartilham o cookie e, portanto, a sessão. A seleção do nome é uma declaração de quem está atendendo; a autenticação continua sendo a da conta compartilhada. As mensagens guardam o ID da conta e uma cópia do nome usado no envio.

A atualização acrescenta uma coluna à tabela de sessões existente; não recria o banco nem importa conversas. Nomes personalizados duram enquanto a respectiva sessão existir. Arquivos, exclusão de histórico, Notion e IA não são adicionados por esta mudança.

No campo de resposta, **Enter envia** e **Shift+Enter quebra a linha**. O controle **Enter envia** permite desligar o atalho. Essa preferência é salva neste navegador; não sincroniza entre dispositivos. A composição de caracteres e as combinações Ctrl/Alt/Meta não disparam o envio.

### Emojis e contatos

O botão **Emojis** insere símbolos na posição do cursor, sem disparar o envio. Os rascunhos de cada conversa permanecem durante as atualizações da interface na página aberta, mas não sobrevivem ao fechamento ou recarregamento do navegador.

Em **Contatos**, cadastre nome, telefone com país e DDD, e-mail e observações. **Salvar contato** dentro de uma conversa preenche o número recebido. Alterar o nome do contato atualiza a identificação da conversa sem editar mensagens anteriores. **Abrir conversa** reaproveita o histórico daquele número, sem iniciar um envio. Telefones salvos são normalizados e duplicados são recusados. O cadastro pertence à central e não sincroniza com a agenda do celular. A criação da tabela é aditiva e preserva contas, sessões e conversas existentes.

Os próximos pacotes e o vínculo de atividades do Notion estão detalhados em [plano-sistema-integrado.md](docs/plano-sistema-integrado.md).

## Informações públicas do aplicativo

`/privacidade` e `/exclusao-de-dados` são páginas públicas, sem login e sem SDK da Meta. Identificam a Domum Engenharia (Rodrigues & Madureira LTDA), com o contato público informado pela empresa: `domumenge@outlook.com`. Atualize esses textos se mudarem o responsável, o contato, os fornecedores, a retenção ou as funcionalidades. A exclusão é solicitada por e-mail e tratada pela empresa; não há exclusão automática implementada.

O ícone provisório da central está em `/assets/app-icon.png` (1024 × 1024); o original vetorial é `public/app-icon.svg`. Ele não substitui o logotipo oficial da empresa. Para a análise do app na Meta, use a URL HTTPS pública de `/privacidade` e, no campo de instruções de exclusão, `/exclusao-de-dados`. A existência dessas páginas não comprova aprovação do aplicativo nem entrega de mensagens.

A página institucional `/sobre` apresenta a Domum Engenharia, a razão social confirmada e os canais públicos `domumenge@outlook.com` e Instagram `@domumenge`. Explica que a central está em implantação para atendimento próprio, sem oferta de SaaS a terceiros. A página é pública e não exige login, não carrega scripts nem adiciona coleta de dados por formulários. Não implica aprovação da verificação de acesso da Meta.

### Diagnóstico do recebimento

Em **Conexão → Diagnosticar recebimento**, o administrador consulta observações do processo atual: quantidade de POSTs ao webhook, requisições aceitas/recusadas, mensagens registradas, duplicadas e eventos de outro número, além de horários e resultado da última conclusão. Isso diferencia ausência de entrega, assinatura inválida, configuração incompleta, formato inválido e falha de processamento. O diagnóstico não chama a Meta e não registra corpos de eventos, telefones, tokens ou assinaturas. Os contadores ficam em memória e reiniciam com o servidor; não descrevem o período anterior ao início indicado.

Mensagens só entram na contagem após o commit da transação. Eventos do exemplo da Meta podem usar outro identificador de número e serem aceitos com HTTP 200 sem criar conversas. Uma mensagem registrada comprova recebimento, mas não confirma entrega de respostas nem coexistência do número Business real.

O diagnóstico também informa a última falha de envio observada nesta execução: horário, origem (recusa imediata da API, aviso de falha de entrega ou transporte) e código numérico da Meta quando disponível. O aviso de recusa imediata exibe esse código. Textos, detalhes e cabeçalhos retornados pelo provedor não são mostrados nem guardados nesse diagnóstico. Falhas de entrega só são consideradas para mensagens conhecidas, após o commit do evento. Esse registro histórico não implica que o próximo envio falhará e não inicia novas tentativas.

## Assistente interno e contexto do cliente

A aba Assistente interno conversa com um Custom Agent real do Notion, separada das mensagens de clientes. Configuração, créditos, aprovação de documentos e busca automática do cadastro por telefone estão no [guia de operadores e contexto](docs/chat-operadores-e-contexto.md). A ativação do chat interno é separada do piloto de respostas automáticas do WhatsApp.

## Atendimento integrado

Liberação geral, resumo cumulativo em Clientes, fila de histórico, seleção de cliente no assistente interno e transcrição estão descritos em [docs/atendimento-integrado.md](docs/atendimento-integrado.md). Esta seção atualiza o escopo de piloto das orientações anteriores. A configuração padrão permanece desligada; a ativação no Render e o acesso às bases precisam ser conferidos separadamente.
