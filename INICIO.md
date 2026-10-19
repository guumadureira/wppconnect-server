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

As contas, mensagens, retornos e alertas persistem em `data/central.sqlite`. Preserve o diretório `data` e faça backups consistentes com SQLite. Testes usam bancos separados e transporte simulado. O README original do WPPConnect permanece preservado, mas seus comandos não se aplicam à nova central.

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
| `PUBLIC_ORIGIN` | Origem HTTPS pública da central, sem caminho nem barra final. |
| `SETUP_TOKEN` | Código privado para cadastrar o administrador em uma instalação remota. |
| `ALERT_WEBHOOK_URL` | Destino opcional, sob seu controle, para entregar lembretes fora do navegador. |
| `ALERT_WEBHOOK_TOKEN` | Credencial opcional do destino de alertas. |

Em **Conexão → Verificar configuração**, o administrador vê os nomes das configurações pendentes, sem seus valores. O diagnóstico não faz requisições à Meta. Credenciais preenchidas não comprovam conexão real.

`META_APP_SECRET` e `WEBHOOK_VERIFY_TOKEN` precisam estar disponíveis como valores originais no processo do servidor, pois são comparados localmente. Marcadores de credenciais substituídos somente por um proxy de rede não servem para essa validação. Configure-os pelo gerenciador de segredos da hospedagem ou por arquivo privado, com acesso restrito.

## Retomar a conexão à Meta

A hospedagem proposta está em [docs/hospedagem-render.md](docs/hospedagem-render.md), com configuração em `render.yaml`. Não foi contratada nem publicada. No Render, a aplicação usa `RENDER_EXTERNAL_URL` como origem quando `PUBLIC_ORIGIN` não estiver definido.

1. Definir hospedagem com Node.js 24+, processo sempre ativo, disco persistente, HTTPS público e backup. Configurar `HOST` e `PORT` conforme a hospedagem e `PUBLIC_ORIGIN` com o domínio público. Configurar `SETUP_TOKEN` antes de expor o cadastro inicial. O proxy reverso deve preservar a origem das requisições e servir HTTPS.
2. Inspecionar o portfólio empresarial e a conta WhatsApp corretos, preservando número, conta Business e conversas. O aplicativo antigo “Chatwoot Domum” não foi reutilizado nem excluído. Sua configuração ainda precisa ser verificada antes de qualquer remoção.
3. Verificar elegibilidade e um fluxo de cadastro de **coexistência** compatível com manter o Business ativo. O projeto não implementa cadastro integrado e nenhum provedor foi contratado. Uma chave de provedor pode exigir um adaptador diferente; este código chama diretamente a Cloud API da Meta.
4. Configurar as credenciais de forma privada. Cadastrar `https://SEU-DOMINIO/webhooks/whatsapp` e a assinatura dos eventos de mensagens. Para coexistência, verificar também a disponibilidade/configuração de `smb_message_echoes`.
5. Com um contato de teste autorizado, validar entrada de mensagem, resposta assinada por dois usuários, recibos, ecos de respostas pelo aplicativo e entrega efetiva de um lembrete. Só então abrir o atendimento à equipe.

O webhook verifica HMAC do corpo bruto e restringe o recebimento ao identificador de número configurado. Mensagens duplicadas são deduplicadas. Envios recusados ou não confirmados mantêm a pendência, e uma mensagem nova recebida durante o envio continua pendente.

## Limites atuais

- A assinatura automática se aplica às mensagens enviadas pela central. Ecos do aplicativo Business não identificam automaticamente o atendente.
- O prazo de alerta usa tempo corrido, sem calendário de horário comercial. O padrão é 30 minutos.
- Notificações do navegador exigem permissão e a central aberta. Avisos com a página fechada dependem de um destino externo de alertas; nenhum está configurado neste ambiente.
- Mensagens livres são bloqueadas após a janela de 24 horas. Modelos aprovados, anexos, recuperação de senha e importação do histórico ainda não estão implementados.
- A base foi validada localmente com API simulada. Não há publicação, pareamento ou conexão real à Meta confirmados.

Mais detalhes da versão anterior estão em [docs/projeto-original.md](docs/projeto-original.md). O código legado do WPPConnect foi removido por solicitação do usuário; o nome do repositório não define o adaptador usado pela nova central.

## Personalização planejada

Após a implantação, alinhar cores, fontes e componentes à identidade visual da Domum Engenharia, conforme pedido do usuário. Usar materiais e referências oficiais da empresa; a personalização visual ainda não foi feita.
