# Integração ChatGPT ↔ Central Domum: consulta segura (05/11/2026)

## Situação verificada

- Serviço existente: `central-atendimento` no Render, `srv-dbb2pfss728c73a74uc0`, repositório `guumadureira/wppconnect-server`.
- Produção na revisão `f1fb7b7eb5bed3890dca1bf89f10a5ea58fff70e` (PR #46), deploy bem-sucedido em 05/11/2026 00:09 UTC.
- O endpoint `POST /mcp` já existe e verifica um Bearer próprio com `CENTRAL_MCP_TOKEN`, mais uma lista estrita `CENTRAL_MCP_ALLOWED_PHONES`. Não é uma conexão já cadastrada no ChatGPT.
- `consultar_conversa` traz as últimas 30 mensagens; anexos recebidos já são paginados por `listar_arquivos_recebidos` e `resources/read`.
- **Esta branch não altera a produção, não amplia a lista de contatos, não habilita envio e não altera segredos, banco ou permissões.**

## Melhorias preparadas nesta branch

1. `listar_conversas_autorizadas({})`: descobre apenas as conversas existentes vinculadas de forma inequívoca à lista de telefones permitidos. Não pesquisa todos os clientes nem expõe mensagens.
2. `consultar_historico({telefone, antesDe?})`: pagina 30 mensagens por vez, de mais recentes para antigas, preservando o cursor do próprio contato. Bloqueia cursor de outra conversa e telefone não autorizado.
3. `CENTRAL_MCP_READ_ONLY=true` (opcional, desligado por padrão): retira ferramentas mutáveis da descoberta de ferramentas externas e impede sua execução, mesmo quando invocadas diretamente. Mantém consultas de histórico, arquivos e `resources/read`. Não altera as rotas autenticadas dos operadores da Central.

A seleção por `CENTRAL_MCP_ALLOWED_PHONES` continua sendo o controle de autorização para o Bearer existente. `CENTRAL_MCP_SEND_ENABLED=false` isoladamente **não** é modo somente leitura: ferramentas de preparação e atualização de cache continuam sendo mutáveis. Não definir `CENTRAL_MCP_READ_ONLY=true` no servidor compartilhado sem verificar se a conexão Notion existente depende de ferramentas de envio; a flag atualmente vale para todas as chamadas ao `/mcp`. Para ter conectores com permissões distintas, implementar autenticação e autorização por identidade/conector.

## Implementação OAuth preparada — 05/11/2026

A PR #47 recebeu um servidor de autorização OAuth 2.1 privado em `chatgpt-oauth.mjs`, integrado ao `server.mjs` e ao MCP existente:

- Novo endpoint MCP: `https://central-atendimento-znn0.onrender.com/mcp/chatgpt`. O legado `/mcp` mantém seu próprio Bearer, ferramentas e controles Notion.
- Descoberta OAuth: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp/chatgpt`, `/.well-known/oauth-authorization-server`.
- `/oauth/authorize` com PKCE S256, `resource` exato, `state` e cliente CIMD limitado ao domínio oficial `chatgpt.com`. Redirecionamentos permitidos são os oficiais, registrados no documento CIMD. `/oauth/approve` exige senha da conta de administrador **ativa e explicitamente aprovada** (`CHATGPT_OAUTH_ADMIN_EMAIL`).
- `/oauth/token` emite tokens opacos, vinculados ao administrador, cliente e recurso; guarda apenas hashes no SQLite. Código de autorização é de uso único. Access token expira em 15 minutos; refresh token dura até 30 dias, com rotação e revogação da família em caso de reuso.
- O endpoint OAuth somente anuncia e aceita operações da lista `readTools`, com `securitySchemes` OAuth, mesmo quando o MCP legado permite gravação. Tentativas de `preparar_envio`, `confirmar_envio` e `atualizar_contexto_notion` são recusadas diretamente.
- `CHATGPT_OAUTH_ENABLED=false` é o padrão. A ativação só deverá ocorrer após homologação e aprovação específica, configurando `CHATGPT_OAUTH_ADMIN_EMAIL` no Render. Não compartilhar senha, token, telefone ou segredo em Git, Notion ou chat.

Testes: seis testes locais isolados do servidor de autorização concluídos em 05/11/2026 (Node 22, SQLite experimental), cobrindo PKCE, autenticação, expiração por desativação de administrador, revogação, rotação e bloqueio de origem/clientes. Testes adicionais foram incluídos na PR para Node 24, inclusive integração com a Central, mas **não houve resultado de CI** encontrado no GitHub até a última consulta. O código não foi publicado nem ativado, e não foi realizado login real ChatGPT nem troca com tokens de produção. O uso de login local da Central como emissor OAuth precisa de revisão de segurança antes do deploy; para expansão da equipe, preferir provedor de identidade corporativo gerenciado.

Referência atual: [OpenAI Developers — Authentication](https://developers.openai.com/plugins/build/auth).

## Bloqueio para conexão ao ChatGPT

ChatGPT não aceita chave de API personalizada no fluxo de autenticação de plugins MCP. A integração atual por Bearer estático não atende, por si só, ao fluxo OAuth do cliente; **não remover a autenticação nem expor dados anonimamente como solução**. O código OAuth acima resolve esse pré-requisito em nível de implementação, mas permanece desligado, não homologado em produção e sem conexão cadastrada.

Para conexão autenticada, é necessário implementar OAuth 2.1 compatível com MCP e validar com um provedor existente. Possível direção: identidade corporativa Microsoft Entra, condicionada à verificação de compatibilidade e cadastro/admin consent. Antes de implementar, confirmar:

- Registro de aplicação e autorização de usuário para a Central, identidade administrativa autorizada, scopes de leitura e configuração de cliente predefinido/CIMD/DCR;
- Metadados `/.well-known/oauth-protected-resource` com resource/audience e authorization server; metadados OAuth/OIDC com PKCE S256, redirect URI oficial e refresh/offline access;
- validação de assinatura JWKS, issuer, audience, exp/nbf, scopes, revogação, tenant e usuário em cada requisição;
- distinção entre identidade autorizada (Gustavo ou administrador) e destinatários permitidos; impedir acesso de outros membros do workspace ao histórico sem autorização;
- manutenção do MCP Notion atual e seu fluxo de envio, sem trocar credenciais, ampliar telefones ou compartilhar o token original.

Não presumir que uma assinatura Microsoft 365, isoladamente, conclui a configuração OAuth do MCP.

Referências:
- https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
- https://developers.openai.com/plugins/build/auth

## Homologação e liberação

1. Executar `npm test` com Node >=24 na branch. Os testes novos verificam descoberta estrita, paginação de 70 mensagens, rejeição de cursor estrangeiro, ausência de envio e modo só leitura.
2. Rever a lista efetiva de telefones permitidos e as permissões Notion atuais, sem ampliar escopo.
3. Configurar OAuth em ambiente de teste, sem tokens em Git/Notion/chat; testar 401, negação de acesso alheio, tokens expirados e listagem de ferramentas.
4. Preservar e testar backup do SQLite real antes de qualquer deploy. A rotina existente em `docs/retomada-integrada-2026-11-04.md` define inspeção e backup. Não implantar automaticamente.
5. Após homologação e autorização específica de ativação, o administrador conecta **no ChatGPT web**, pela opção de adicionar servidor MCP disponível na conta, com endpoint `https://central-atendimento-znn0.onrender.com/mcp/chatgpt` e OAuth/CIMD. Atualizar/revisar a lista de ações do plugin após novas versões. Consulte o [estado e roteiro atual da Fase B](chatgpt-fase-b-homologacao-2026-11-05.md); os registros históricos abaixo não substituem a publicação já concluída da Fase A nem comprovam conexão real no ChatGPT.
6. Primeiro teste com um único telefone interno autorizado, validando a leitura das conversas e anexos **sem enviar mensagens**.

## Limites

Não existe aqui comprovação de que OAuth esteja configurado, de que a integração foi cadastrada no ChatGPT nem de que seja possível ler o banco de produção a partir deste chat. A revisão do código não é homologação de execução; até o teste efetivo, o acesso permanece indireto via GitHub/Render/Notion.


## Revisão adicional de segurança — 05/11/2026

Foram corrigidos dois pontos concretos do módulo OAuth: (1) validação explícita de `client_name` e de `token_endpoint_auth_method=none`, impedindo que metadados CIMD inconsistentes passem por uma condição ambígua; (2) limitação de tentativas de senha pela origem da conexão, mesmo quando a pessoa alterna e-mails. Os testes locais isolados (Node 22, SQLite experimental) passaram de seis para **oito casos aprovados**. A suíte completa e o teste de integração continuam **sem execução confirmada no CI com Node 24**.

O repositório GitHub está **público**. Nenhum segredo ou informação de cliente deve ser versionado. A implementação OAuth é uma versão preparatória e exige auditoria de segurança, verificação de compatibilidade real do cliente ChatGPT, proteção contra abuso distribuído, homologação com credenciais fictícias e backup verificável antes de publicação. Ativar login administrativo em endpoint público apenas após revisão humana, pois credenciais de contas internas não devem ser expostas desnecessariamente.

## Correção de interoperabilidade CIMD — 05/11/2026

Foi identificada uma incompatibilidade real entre `chatgpt-oauth.mjs` e o documento CIMD publicado pelo ChatGPT: o cliente pode declarar `token_endpoint_auth_method=private_key_jwt` como preferência legada **e**, simultaneamente, `token_endpoint_auth_methods_supported=['none','private_key_jwt']`. O nosso authorization server público aceita somente `none` e agora confere a lista de métodos suportados quando presente, rejeitando clientes que não declaram `none`. Dois testes de regressão foram adicionados na PR #47.

**Validação isolada local:** 10 testes aprovados, 0 falhas com Node 22 (não equivale a executar a aplicação inteira). A execução da suíte completa com Node 24 e o CI GitHub permanecem sem resultado confirmado. O workflow foi ampliado para considerar alterações na branch e no arquivo OAuth.

**Produção observada:** o Render realizou novo deploy da **mesma revisão #46** `f1fb7b7eb5bed3890dca1bf89f10a5ea58fff70e`, em 05/11/2026 11:43:54 UTC, status `live`. Isto **não** é publicação da PR #47, que permanece em rascunho. A conexão do ChatGPT e seu endpoint OAuth continuam indisponíveis na produção. Não foi alterada nenhuma variável de ambiente, credencial ou registro do SQLite neste trabalho.

## Isolamento adicional do ChatGPT — revisão de 05/11/2026

A auditoria de segurança revelou que a implementação inicialmente reutilizava `CENTRAL_MCP_ALLOWED_PHONES` para o ChatGPT. Isso permitiria consultar contatos liberados para a integração Notion sem autorização específica para o novo canal. A correção na PR #47 introduz `CHATGPT_OAUTH_ALLOWED_PHONES`, que começa vazia e **impede que o OAuth seja habilitado sem escopo explicitamente configurado**. Mesmo com essa lista, cada conversa precisa continuar autorizada na lista preexistente: o acesso OAuth efetivo é a interseção das duas listas. Configurar inicialmente um único número de teste permitido nas duas listas; não ampliar os registros de clientes automaticamente.

A API `/mcp/chatgpt` agora expõe somente cinco ferramentas de leitura de conversas, histórico, arquivos e áudio. Não anuncia nem executa `consultar_envio`, `verificar_integracao_notion`, `atualizar_contexto_notion` ou quaisquer ferramentas de preparação/envio. Consultas de anexos por `resources/read` fazem autorização adicional por conversa, além da verificação antiga sobre o vínculo do arquivo.

Foram acrescentados testes de regressão para isolamento entre telefones do Notion e do ChatGPT, bloqueio de anexos e da consulta de envios, recusa de ferramentas não anunciadas e bloqueio do OAuth sem a lista específica. **Verificação executada:** 11 testes isolados do módulo OAuth aprovados com Node 22 e SQLite experimental em 05/11/2026. **Ainda não verificado:** teste integrado do MCP/servidor e suíte total em Node 24; o GitHub não retornou runs ou statuses de CI para o último commit da PR. Não ativar no Render sem testes integrais, análise de segurança e backup do SQLite real.


## Bloqueio confirmado do CI — 05/11/2026

A página `https://github.com/guumadureira/wppconnect-server/actions` exibe o aviso do próprio GitHub: `Workflows are not currently being run on this fork due to the scale of GitHub Actions usage. A repository maintainer can choose to re-enable these.` Portanto, os testes não estão simplesmente pendentes por falta de commit: **o GitHub Actions está desativado neste fork**. Só o mantenedor pode reativar o workflow nas configurações/página Actions do repositório; os conectores disponíveis aqui não permitem essa alteração. Depois da reativação, executar `Central MCP tests` na branch desta PR e conferir `npm test` com Node 24. Até lá não mesclar nem publicar no Render.

A validação dos telefones autorizados no módulo OAuth agora é fail-closed, inclusive em listas com números malformados ou fora do escopo. Os **12 testes isolados** (reproduzidos no ambiente local Node 22 com SQLite de teste, sem dados reais) passaram. Os testes integrados do servidor completo **não foram executados**. O teste remoto de identidade CIMD foi reforçado para fornecer campos de cliente válidos, evitando falso positivo por outro campo ausente.

## Segurança e CI — revisão 05/11/2026 (substitui as pendências antigas de CI)

A validação do módulo OAuth incluiu mais três cenários de regressão, implementados **sem mudança de esquema no banco**:

1. A sessão OAuth e seus tokens opacos de acesso/renovação deixam de ser válidos quando a senha do administrador autorizado muda, incluindo a conta posteriormente desativada.
2. O endpoint público `/oauth/authorize` limita a 16 tentativas por origem em cinco minutos.
3. Há limite global de 64 autorizações pendentes simultâneas; ao atingir o teto, novas solicitações retornam HTTP 429 até expiração/consumo.

Todos os testes foram executados novamente com Node 24. No commit `3f360b9cb569aa1aa0de9c56add48a7190185e6c`:

- [Central MCP tests #8](https://github.com/guumadureira/wppconnect-server/actions/runs/42040893117): **277 executados, 277 aprovados, 0 falhas**.
- [Central de atendimento #241](https://github.com/guumadureira/wppconnect-server/actions/runs/42040894158): **277 executados, 277 aprovados, 0 falhas**.
- A suíte inclui testes do backup SQLite com WAL ativo, restauração independente da fonte e recusa de bancos corrompidos/com vínculos inconsistentes.

Esses resultados são de ambiente de teste, **não** de uma execução de backup sobre o banco de produção. A PR continua em rascunho, não publicada.

### Comprovação do backup real antes de qualquer publicação

O código principal atualmente publicado no Render possui `scripts/banco-central.mjs`, que não exige conexão externa nem imprime conversas. Para executar no **Render Shell autenticado** do serviço existente, sem revelar senhas, tokens ou histórico:

```sh
cd ~/project/src
node scripts/banco-central.mjs inspecionar --database /var/data/central.sqlite
node scripts/banco-central.mjs backup --database /var/data/central.sqlite --backup-dir /var/data/backups
```

Validar o retorno de `integrity=ok`, `restoreVerified=true`, hash SHA-256, contagens, tamanho do arquivo e manifesto. Não editar o banco original. O backup acima fica **no mesmo disco do serviço** e `externalCopyVerified=false`: não substitui uma cópia protegida **fora do Render**. Registrar a conferência da cópia externa somente após transferi-la para armazenamento corporativo aprovado, mantendo acesso restrito.

Os conectores disponíveis nesta conversa permitem consultar Render, GitHub e logs, mas **não executam comandos no Shell nem acessam `/var/data/central.sqlite` diretamente**. Assim, esta etapa não foi confirmada no banco real e continua bloqueando o deploy.

### Gates de homologação ainda abertos

- [x] OAuth com escopo estrito de telefones e apenas ferramentas de consulta.
- [x] Duas suítes completas aprovadas com Node 24 e sem dados de clientes.
- [ ] Backup do SQLite de produção executado e recuperação local comprovada.
- [ ] Cópia externa protegida do backup e confirmação do manifesto.
- [ ] Confirmação privada do administrador e de um telefone interno de teste.
- [ ] Revisão final dos riscos do login OAuth público; sem identidade gerenciada neste piloto.
- [ ] Autorização específica para publicar a PR e habilitar o OAuth no Render.
- [ ] Conexão privada no ChatGPT web e teste de consulta sem envio de mensagens.

Não tratar a suíte automatizada como certificação de segurança ou como comprovação de recuperação do banco real.


## Pré-verificação privada antes de ativar — 05/11/2026

Esta PR inclui `scripts/verificar-integracao-chatgpt.mjs`, uma rotina de **somente leitura** que verifica se o ambiente está pronto para ativação controlada de OAuth sem imprimir e-mail, telefone, token, senha, conteúdo de mensagens nem caminho do banco. Não acessa a rede e abre o SQLite existente em modo `readOnly`.

Depois de um **deploy autorizado com `CHATGPT_OAUTH_ENABLED=false`**, executar no Shell do Render:

```sh
cd ~/project/src
node scripts/verificar-integracao-chatgpt.mjs --database /var/data/central.sqlite
```

Campos do JSON:
- `checks.httpsOrigin` — origem HTTPS está configurada;
- `checks.administratorConfigured` e `checks.activeAdministratorFound` — e-mail configurado corresponde a um administrador ativo do banco;
- `checks.explicitChatGPTScope` e `checks.scopeContainedInLegacy` — o escopo do ChatGPT é válido e subconjunto do escopo da Central;
- `checks.oauthFeatureEnabled` — flag de ativação;
- `readyToEnable` — pré-requisitos preenchidos, **não significa que o OAuth já foi ativado**;
- `readyForPrivateOAuthTest` — pré-requisitos preenchidos e flag ativada, **não garante que o login com ChatGPT tenha sido testado**.

Esse diagnóstico não cria tabelas nem modifica permissões. Quando o OAuth for habilitado, o código do serviço inicializa **quatro tabelas próprias para tokens e autorizações** no SQLite; obter autorização específica do responsável **antes de alterar o esquema em produção**. Não habilitar por antecipação.

### Etapas propostas de publicação, sujeitas a autorização separada

**Fase A — publicação de código desativado:** mesclar a PR após revisão, confirmar backup e cópia externa aprovada, publicar o código no Render com `CHATGPT_OAUTH_ENABLED=false`. Com a flag desativada, a nova autenticação não responde aos endpoints públicos nem cria as tabelas OAuth. Executar teste de regressão operacional (`/healthz`, login da Central, atendimento atual, Notion, logs), sem consultar ou enviar mensagens reais de teste.

**Fase B — piloto privado restrito:** depois de autorização expressa para criar as quatro tabelas e configurar as variáveis privadas, liberar **um telefone interno** que esteja simultaneamente em `CENTRAL_MCP_ALLOWED_PHONES` e `CHATGPT_OAUTH_ALLOWED_PHONES`, além do e-mail exato de administrador ativo. Executar o script acima, testar 401 sem token, validar OAuth no ChatGPT web e conferir somente consultas. Não publicar o conector para todo o workspace.

**Fase C — aumento controlado:** somente após consentimento operacional, revisão de riscos, restrição e validação do armazenamento externo dos backups, considerar mais contatos e automação de contexto com Notion. Não habilitar envios pelo conector na primeira fase.

Teste automatizado da verificação de pré-ativação: **283 testes, 283 aprovados, 0 falhas** em cada um dos workflows [Central MCP tests #11](https://github.com/guumadureira/wppconnect-server/actions/runs/42048719026) e [Central de atendimento #246](https://github.com/guumadureira/wppconnect-server/actions/runs/42048719147), código em `8c4126968acd3e32c205b0ae3d46f1a442010d71`. Os testes são com bancos e credenciais fictícios, sem alteração de produção.

A pasta `Backups Restritos` foi criada no SharePoint, mas sua herança de acesso continua abrangendo membros e visitantes. O usuário optou por deixar a restrição para depois: **não enviar SQLite para o SharePoint até concluir as permissões**. A cópia íntegra no Windows, com SHA-256 conferido, está disponível fora do Render; é diferente de um backup corporativo durável com acesso restrito.
