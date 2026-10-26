# Central de atendimento

Primeira versão funcional para revisar o atendimento do número Business compartilhado. Possui assinatura automática por usuário autenticado, cadastro e edição de nomes, responsável por conversa, agendamento de retornos e alertas de mensagens sem resposta.

**Estado da entrega:** demonstração local e projeto executável. Nenhum número foi conectado, nenhum cliente foi contatado e nenhuma conta ou assinatura foi contratada. O servidor não está publicado. Não há conexão com o outro número, usado no WhatsApp comum.

## Ver a demonstração

Abra `public/index.html` no navegador, sem instalar nada. As conversas e os atendentes iniciais são exemplos. Use **Equipe** para cadastrar ou editar nomes e **Simular atendente** para testar as assinaturas. Os dados dessa prévia ficam somente no navegador, não são compartilhados entre pessoas. Esse seletor é uma simulação, não autenticação.

A prévia permite simular envio, concluir/reabrir conversas, atribuir responsáveis, programar retornos e ajustar o prazo de alerta. Nenhuma mensagem é enviada ao WhatsApp. Avisos do navegador dependem da permissão e de a página permanecer aberta; alguns navegadores não permitem notificações em arquivos locais.

## Executar com contas individuais

Requisito: Node.js 24 ou superior. Não há dependências externas a instalar.

```sh
cd central-atendimento
cp .env.example .env
npm start
```

Abra `http://localhost:3000`. No primeiro acesso, cadastre o administrador com nome, e-mail e senha preenchida, sem tamanho mínimo ou exigência de composição. O campo código de instalação pode ficar vazio apenas na instalação local padrão. Depois, entre em **Equipe** e crie o acesso de cada atendente. Cada pessoa responde com seu próprio login; o servidor determina a assinatura e não aceita um nome de remetente informado pelo navegador.

O modo padrão é `WHATSAPP_MODE=demo`. Mesmo com contas reais na central, os envios continuam simulados. Use **Simular cliente** para criar conversas fictícias e revisar o fluxo.

As conversas e contas do servidor são guardadas em `data/central.sqlite`. Senhas usam scrypt com salt; sessões possuem cookies HttpOnly e SameSite, duração de 12 horas e flag Secure quando a origem é HTTPS. Há limite de tentativas de login por endereço de origem. Nenhum token de API vai para o navegador.

## Seu número já está ativo no Business

A ativação padrão de um número no painel de desenvolvedores da Meta é diferente do fluxo de **coexistência**. A coexistência permite, para contas elegíveis, manter o mesmo número no aplicativo Business e na plataforma/API.

O fato de o número estar ativo no app não basta para diagnosticar o erro visto anteriormente. A mensagem exata do erro e a elegibilidade da conta ainda precisam ser verificadas.

1. Escolha um provedor que ofereça o cadastro integrado de coexistência. Confirme elegibilidade e custos antes de contratar. Não foi escolhido ou contratado nenhum provedor nesta entrega.
2. No fluxo desse provedor, selecione a opção de conectar uma conta/número **já usado no WhatsApp Business App**. Não trate o número como um novo número livre para o cadastro padrão.
3. Autorize o portfólio empresarial correto da Meta e siga as confirmações dentro do aplicativo/QR do fluxo oficial.
4. Configure o recebimento das mensagens na central e valide os eventos recebidos, os envios e os lembretes antes de abrir o acesso à equipe.

Não exclua sua conta e não desinstale o Business para contornar o cadastro. Dispositivos vinculados podem ser desconectados durante a ativação e precisar de novo vínculo. A elegibilidade e os recursos disponíveis são definidos pela Meta e pelo provedor.

Referências consultadas em 18/10/2026:

- [Coexistência e suas limitações — documentação 360dialog](https://docs.360dialog.com/docs/resources/phone-numbers/coexistence)
- [Exemplo de cadastro integrado de coexistência — 360dialog](https://docs.360dialog.com/docs/hub/embedded-signup/coexistence-onboarding)
- [Fluxo de onboarding da Meta](https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users/)

Esses links documentam o fluxo; o cadastro integrado de um provedor não foi implementado nesta central e não é substituído por um formulário de token.

## Integração preparada para a Cloud API da Meta

O adaptador incluído usa diretamente o endpoint oficial `graph.facebook.com`. Após o onboarding, o responsável técnico deve conferir o acesso e as credenciais disponibilizadas pelo provedor escolhido. Provedores com endpoints e chaves próprios exigem adaptar o transporte e, eventualmente, o formato do webhook. Não suponha que uma chave de provedor possa ser usada como token da Meta.

Para acesso direto à Cloud API, configure no ambiente do servidor:

```text
WHATSAPP_MODE=live
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_ACCESS_TOKEN
META_APP_SECRET
WEBHOOK_VERIFY_TOKEN
META_GRAPH_VERSION
PUBLIC_ORIGIN
SETUP_TOKEN
```

Os nomes são intencionais; valores devem ser configurados de forma privada no servidor. Não publique `.env`, banco de dados, cookies ou tokens. `META_GRAPH_VERSION` precisa ser uma versão suportada pelo aplicativo Meta, no formato `vNN.N`.

O webhook é `https://SEU-DOMINIO/webhooks/whatsapp`. A rota GET responde ao desafio de verificação; POST verifica HMAC SHA-256 do corpo bruto antes de processar eventos. Cadastre a assinatura de eventos de mensagens da conta correta e, para coexistência, os ecos `smb_message_echoes` conforme a configuração do provedor.

O servidor aceita mensagens de texto e registra um aviso para mensagens não textuais, que devem ser consultadas no aplicativo. O recebimento é deduplicado pelo identificador da Meta e restrito ao `phone_number_id` configurado. Uma mensagem enviada pela central inclui `Nome do atendente: mensagem`. Alterar o nome preserva o histórico já enviado.

Respostas feitas diretamente no app ou WhatsApp Web não recebem a assinatura da central. Quando sincronizadas por eco, são registradas como envio pelo aplicativo, sem atribuir uma identidade de atendente que o evento não fornece. Casos ambíguos no mesmo segundo mantêm a pendência de forma conservadora.

Envios recusados ou não confirmados preservam a pendência. Não há reenvio automático quando o resultado do envio é desconhecido: confira o aplicativo antes de repetir. Mensagens recebidas enquanto um envio está em andamento continuam pendentes.

A central bloqueia mensagens livres pela API após 24 horas da última mensagem recebida do cliente. O envio por modelos aprovados ainda não está implementado; o app Business pode ser usado para esses retornos, respeitando as regras da plataforma.

## Lembretes

- O padrão é 30 minutos sem resposta, ajustável de 1 a 1440 minutos em **Lembretes**.
- A contagem usa tempo corrido. Não há calendário de horário comercial nesta versão.
- A resposta encerra a pendência de mensagem sem resposta; um retorno agendado permanece até ser removido ou a conversa concluída.
- A central verifica os avisos a cada 15 segundos com a página aberta. Notificações do navegador dependem de permissão.
- O servidor verifica eventos de alerta a cada minuto e mantém os registros no SQLite. Para entregar avisos fora do navegador, configure `ALERT_WEBHOOK_URL` e, se necessário, `ALERT_WEBHOOK_TOKEN`, apontando para um serviço de notificação sob seu controle.
- O destino recebe um POST JSON com `id`, `event`, `customer`, `ownerId`, `ownerName` e `due`. Implemente deduplicação pelo `id`. Falhas são tentadas novamente após cinco minutos; a entrega pode ocorrer mais de uma vez. Alertas que deixaram de ser pertinentes não são enviados.
- Nenhum destino externo está configurado nesta entrega. Não há envio nativo de e-mail, push com página fechada ou lembrete por WhatsApp.

## Antes de uso real pela equipe

É necessário um servidor Node sempre ativo com disco persistente, HTTPS e backup do banco. Ajuste `HOST`, `PORT` e `PUBLIC_ORIGIN` para a hospedagem. Em instalação remota, defina um `SETUP_TOKEN` aleatório longo; não exponha a instalação antes de configurá-lo. O proxy reverso deve preservar a origem esperada. Os demais usuários terão os mesmos acessos às conversas compartilhadas; apenas o administrador cadastra/renomeia atendentes e muda o prazo.

Esta versão não inclui recuperação de senha, desligamento de usuários, importação do histórico antigo, anexos, respostas por modelos, grupos, chamadas, controle de acesso por conversa nem onboarding automático da Meta. Esses pontos, hospedagem e compatibilidade do provedor devem ser tratados antes de produção. O número usado no WhatsApp comum precisará de uma avaliação própria para eventual mudança para Business; não há acesso a ele neste projeto.

Valide com um contato de teste autorizado: entrada de mensagem, envio assinado por dois usuários distintos, atualização de nomes, falha no envio, retomada do app, eventos de coexistência e entrega de lembrete. Os testes automatizados usam uma API simulada; não comprovam acesso real à Meta.

## Verificação

```sh
npm test
```

Os testes verificam sessões, permissões administrativas, assinaturas por usuário, webhook e deduplicação, identificação de envios do aplicativo, falhas de envio, mensagens simultâneas, janela de 24 horas, agendamentos, alertas e ausência de chamadas reais no modo demonstração.
