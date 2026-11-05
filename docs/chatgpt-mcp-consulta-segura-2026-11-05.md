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
5. Após homologação, o administrador do workspace conecta **no ChatGPT web** em Plugins > Add custom MCP server, com endpoint `https://central-atendimento-znn0.onrender.com/mcp` e OAuth. Atualizar/revisar a lista de ações do plugin após novas versões.
6. Primeiro teste com um único telefone interno autorizado, validando a leitura das conversas e anexos **sem enviar mensagens**.

## Limites

Não existe aqui comprovação de que OAuth esteja configurado, de que a integração foi cadastrada no ChatGPT nem de que seja possível ler o banco de produção a partir deste chat. A revisão do código não é homologação de execução; até o teste efetivo, o acesso permanece indireto via GitHub/Render/Notion.

