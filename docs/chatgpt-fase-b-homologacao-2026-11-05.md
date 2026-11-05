# Central Domum ↔ ChatGPT: homologação da Fase B

Data: 05/11/2026. Base auditada: `7201471dd9e552974b6b183c37919ef2522aabff` (PR #47). Branch: `codex/chatgpt-fase-b-homologacao-20261105`.

## Estado e limites da execução

O Render continua na revisão da Fase A. Foram confirmados por consulta de leitura o deploy `dep-dbm9ie88v5cc73dvl1rg` como `live`, a branch `main`, autoDeploy desligado e previews desligados. Consulta HTTP direta retornou `/healthz` 200 com a revisão base, e 404 para os documentos de descoberta OAuth e `/oauth/authorize`. Não foi lido nem alterado o SQLite de produção nesta homologação; a ausência das quatro tabelas em produção ainda requer inspeção SQL de somente leitura.

O checkout de trabalho anterior continha mudanças locais. Foi preservado; esta homologação usa uma cópia separada da base publicada, sem `.env`, backup ou banco de clientes. Todos os testes usam dados fictícios e transporte controlado. Não houve envio WhatsApp, acesso a mensagens reais, deploy, alteração de envs, permissões, lista de contatos ou migração do banco de produção.

## Compatibilidade verificada

Referências oficiais consultadas em 05/11/2026:

- [OpenAI: autenticação de MCP](https://developers.openai.com/plugins/build/auth).
- [OpenAI: adicionar servidor MCP no ChatGPT](https://developers.openai.com/api/docs/guides/custom-mcp-server).
- [CIMD público do ChatGPT](https://chatgpt.com/oauth/client.json), consultado sem credenciais: `client_id` estável, callback `https://chatgpt.com/connector_platform_oauth_redirect`, grants `authorization_code` e `refresh_token`, métodos `none` e `private_key_jwt`.

O servidor anuncia CIMD, `none`, PKCE S256, issuer e resource exatos, e retorna `iss` no callback de sucesso. Aceita o callback estável e a variante específica da conexão quando registrados no CIMD. Nunca segue redirecionamento ao buscar o CIMD. Não implementa DCR nem `private_key_jwt`: selecionar CIMD no cadastro. Falhas locais de autorização não são redirecionadas a callbacks não validados.

**Endpoint correto para a futura conexão OAuth:** `https://central-atendimento-znn0.onrender.com/mcp/chatgpt`. `/mcp` é o canal legado com credencial distinta. A descoberta do MCP continua protegida por OAuth; não escolher autenticação anônima ou mista.

Os testes completam OAuth e MCP sobre HTTP local com contas e dados sintéticos, incluindo `initialize`, notificação `notifications/initialized`, descoberta, leitura e recusas. Isso verifica o contrato implementado, mas não comprova elegibilidade do plano/conta, opções efetivas da interface, instalação privada nem login real no ChatGPT. O transporte implementado é POST HTTP com resposta JSON; GET retorna 405. SSE persistente não é necessário para as ferramentas atuais e não foi implementado.

## Correções nesta branch

- Política compartilhada entre runtime e diagnóstico: origem HTTPS canônica sem credenciais e **um único telefone** do piloto, previamente contido no escopo legado. A configuração não consegue habilitar o piloto com dois números.
- Consumo único de ticket após autenticação, com revalidação da expiração, impedindo dois códigos em aprovações simultâneas.
- Código e família de tokens vinculados à senha, ao administrador, ao recurso e ao telefone configurado. Troca de senha durante login, entre consentimento e token ou durante a sessão invalida o grant anterior. Mudança de escopo exige nova autorização.
- Refresh rotativo com prazo absoluto de 30 dias para a família, em vez de prorrogação a cada renovação. O último access token não ultrapassa esse prazo. Evidências de reuso permanecem até a expiração comum da família.
- Consumo do código e emissão dos dois tokens em transação SQLite; rotação também é transacional, com rollback diante de falha de gravação.
- Recusa de parâmetros OAuth duplicados e métodos de autenticação não anunciados; requisições com segredo de cliente, assertion ou Authorization no endpoint de token são rejeitadas, pois este emissor aceita somente `none`.
- Formulários limitados a 8 KiB durante a leitura HTTP; CIMD limitado a 32.000 bytes durante streaming, com cancelamento de leitura, prazo de rede e validação de JSON. Caches e mapas de controle têm teto.
- Limites adicionais de 120 trocas de token/minuto e 60 aprovações/minuto por processo, no máximo duas verificações de senha simultâneas. Mantidos os controles por origem, oito falhas de senha/15 minutos e teto de 64 pedidos pendentes.
- Instruções de inicialização próprias para o canal ChatGPT, descrevendo apenas consulta. Cinco ferramentas de leitura permanecem separadas das operações Notion. Tokens de um canal não autenticam o outro.
- Diagnóstico sem exposição de valores agora informa quantidade das quatro tabelas OAuth: ausentes, parciais ou presentes. Esquema parcial bloqueia prontidão; flag ligada sem as quatro tabelas não indica prontidão para teste privado. A contagem não certifica a estrutura de colunas nem um login real.
- CI de MCP inclui a branch de homologação e os arquivos de política/diagnóstico. Os workflows executam testes, sem deploy ou uso de segredos.

Não foram acrescentadas tabelas ou colunas além das quatro já previstas na PR #47. O formato interno do campo `challenge` do código agora inclui a impressão da autorização; grants de versões anteriores falham de forma segura e exigem nova conexão. Não existe sessão OAuth de produção validada que precise ser migrada.

## Evidências de teste

Base: 283 testes aprovados com Node 24.22.1. Homologação: 300 testes aprovados, zero falhas. Neste Windows, npm não está no PATH; foi executado o mesmo comando do script `npm test`, `node --test test/*.test.mjs`. O CI Linux usa `npm test` com Node 24.

Os casos novos verificam concorrência de aprovação, expiração durante login, senha alterada em diferentes etapas, prazo absoluto da família, rollback SQLite, parâmetros duplicados, abuso do token endpoint, metadados CIMD excessivos ou inválidos, callback específico, um telefone, origem inválida, tokens expirados e hashes armazenados. O servidor completo com flag desligada mantém todos os endpoints OAuth fechados e nenhuma tabela OAuth. A integração comprova contato estrangeiro e anexo estrangeiro negados, credenciais segregadas, ferramentas de envio negadas mesmo com canal legado habilitado, zero drafts e zero mensagens de saída.

Resultados remotos e SHA final devem ser conferidos na PR e nos workflows do respectivo commit. Suíte automatizada não equivale a auditoria independente de segurança nem a teste real na conta ChatGPT.

## Roteiro do piloto, após autorizações específicas

1. Revisar a PR e o CI. Autorizar separadamente merge/publicação da revisão, mantendo `CHATGPT_OAUTH_ENABLED=false`. Não executar publicação apenas por aprovação desta documentação.
2. Confirmar privadamente a conta admin ativa e **um telefone interno já autorizado** no canal legado. Se não existir telefone interno nessa lista, interromper: não ampliar lista sob a autorização de piloto. Não colocar esses valores, senha ou tokens em PR, Notion ou relatórios.
3. Antes de alterar produção, obter evidência atual de backup restaurável e cópia externa íntegra. O backup já comprovado no Render e Windows é histórico de 05/11; não presume uma cópia atual. Não subir SQLite no SharePoint enquanto a pasta herdar acesso amplo, conforme decisão do usuário. Não alterar suas permissões nesta etapa.
4. Com OAuth ainda desligado, executar o diagnóstico publicado em modo somente leitura. Relatar booleans, contagem das tabelas e prontidão. Isso permite comprovar a ausência/presença das tabelas sem criar esquema.
5. Obter autorização **expressa e específica** para inicializar as quatro tabelas no SQLite real e configurar as três variáveis privadas `CHATGPT_OAUTH_ADMIN_EMAIL`, `CHATGPT_OAUTH_ALLOWED_PHONES` e `CHATGPT_OAUTH_ENABLED=true`, além do reinício/deploy necessário. Preservar demais envs e listas. Atualizar env no Render pode disparar deploy mesmo com autoDeploy Git desligado.
6. No ChatGPT, confirmar disponibilidade de cadastro MCP e selecionar conexão OAuth/CIMD somente para a conta autorizada. Copiar os identificadores/callbacks exatos mostrados na gestão da conexão. Não publicar no catálogo nem compartilhar com workspace/equipe.
7. Sem token: 401 e `WWW-Authenticate` apontando para os metadados. Com login: `central:read`, somente cinco ferramentas de leitura; listar apenas a conversa interna, consultar uma mensagem sintética e um anexo sintético previamente aprovados. Testar bloqueio de telefone/URI estrangeiros usando identificadores fictícios, sem procurar outro cliente real. Não preparar nem enviar WhatsApp. Verificar zero saída no intervalo aprovado.
8. Revogar a conexão ao encerrar o ensaio. Rollback de produção: desligar a flag mediante autorização; endpoints voltam a 404, tabelas aditivas permanecem. Não apagar tabelas nem restaurar backup sobre o banco ativo como rotina de rollback. Revogação ativa pelo usuário e propagação real de desconexão precisam ser verificadas na interface; não existe endpoint RFC 7009 nesta versão. Para revogação emergencial, desligar a flag; troca de senha também invalida grants, mas afeta o acesso administrativo e exige autorização própria.

## Pendências de ativação

Faltam revisão/CI do commit final, autorização de publicação, seleção privada de admin/telefone, inspeção SQL de produção, backup atual antes da alteração, autorização de esquema/env/reinício e teste real na conta ChatGPT. Não há motivo para ampliar permissões SharePoint ou contatos para concluir a homologação de código.

O emissor usa a senha local da Central, sem MFA/OIDC. Não oferece restrição de domínio verificado do ChatGPT Enterprise. Uma conta administrativa compartilhada não prova identidade individual de quem lê. O piloto deve permanecer individual e restrito; expansão requer identidade corporativa gerenciada e nova revisão. Limites de abuso são locais ao processo e usam socket remoto sem confiar em X-Forwarded-For; podem agrupar usuários atrás do proxy Render e reiniciam com o processo. Não presumir proteção distribuída ou autenticação mTLS da origem ChatGPT.
