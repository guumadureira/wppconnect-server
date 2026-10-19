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
| `ALERT_WEBHOOK_URL` | Destino opcional, sob seu controle, para entregar lembretes fora do navegador. |
| `ALERT_WEBHOOK_TOKEN` | Credencial opcional do destino de alertas. |

Em **Conexão → Verificar configuração**, o administrador vê os nomes das configurações pendentes, sem seus valores. O diagnóstico não faz requisições à Meta. Credenciais preenchidas não comprovam conexão real.

`META_APP_SECRET` e `WEBHOOK_VERIFY_TOKEN` precisam estar disponíveis como valores originais no processo do servidor, pois são comparados localmente. Marcadores de credenciais substituídos somente por um proxy de rede não servem para essa validação. Configure-os pelo gerenciador de segredos da hospedagem ou por arquivo privado, com acesso restrito.

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

## Limites atuais

- A assinatura automática se aplica às mensagens enviadas pela central. Ecos do aplicativo Business não identificam automaticamente o atendente.
- O prazo de alerta usa tempo corrido, sem calendário de horário comercial. O padrão é 30 minutos.
- Notificações do navegador exigem permissão e a central aberta. Avisos com a página fechada dependem de um destino externo de alertas; nenhum está configurado neste ambiente.
- Mensagens livres são bloqueadas após a janela de 24 horas. Modelos aprovados, anexos, recuperação de senha e importação do histórico ainda não estão implementados.
- O fluxo local foi validado com API simulada. No serviço publicado, o webhook foi cadastrado e o campo `messages` assinado; o usuário optou por adiar o teste de recebimento na central. O envio do número de teste retornou `130497`, restrição informada pela Meta para o país do destinatário. A coexistência e a ativação do número Business real permanecem pendentes.

Mais detalhes da versão anterior estão em [docs/projeto-original.md](docs/projeto-original.md). O código legado do WPPConnect foi removido por solicitação do usuário; o nome do repositório não define o adaptador usado pela nova central.

## Personalização planejada

Após a implantação, alinhar cores, fontes e componentes à identidade visual da Domum Engenharia, conforme pedido do usuário. Usar materiais e referências oficiais da empresa; a personalização visual ainda não foi feita.

## Informações públicas do aplicativo

`/privacidade` e `/exclusao-de-dados` são páginas públicas, sem login e sem SDK da Meta. Identificam a Domum Engenharia (Rodrigues & Madureira LTDA), com o contato público informado pela empresa: `domumenge@outlook.com`. Atualize esses textos se mudarem o responsável, o contato, os fornecedores, a retenção ou as funcionalidades. A exclusão é solicitada por e-mail e tratada pela empresa; não há exclusão automática implementada.

O ícone provisório da central está em `/assets/app-icon.png` (1024 × 1024); o original vetorial é `public/app-icon.svg`. Ele não substitui o logotipo oficial da empresa. Para a análise do app na Meta, use a URL HTTPS pública de `/privacidade` e, no campo de instruções de exclusão, `/exclusao-de-dados`. A existência dessas páginas não comprova aprovação do aplicativo nem entrega de mensagens.
