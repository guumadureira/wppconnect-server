# Auditoria e melhorias da Central — 30/10/2026

## Evidência atual

- Repositório: `guumadureira/wppconnect-server`; base `a82085f` (PR #36). Checkout inicialmente limpo e atualizado com `origin/main`.
- Arquitetura ativa: Node.js 24 e módulos nativos, servidor `server.mjs`, SQLite, interface HTML/JS/CSS. O nome histórico WPPConnect não descreve o adaptador ativo: a aplicação chama a Cloud API oficial da Meta.
- Atendimento externo: OpenAI Responses, limites de consumo persistidos, pausa humana, fila e cancelamento por versão. O assistente interno usa sessões de agente Notion e créditos próprios do Notion; não é requisito para a consulta direta às bases.
- Publicação existente: `GET /healthz` retornou 200 e `mode=live`. Página principal, CSS e script de avisos coincidiram com `a82085f`, após normalização de finais de linha. Isso confirma esses arquivos publicados, não o SHA integral do backend ou a entrega de WhatsApp.
- Diagnóstico real autenticado do Notion: Clientes, Histórico, Trabalhos, Propostas, Projetos e Atividades acessíveis; cadastro automático e resumo habilitados; filas de eventos e resumos sem pendências no momento da consulta. A falta de acesso anotada em guias antigos foi superada.
- Amostra restrita aos telefones já autorizados no MCP: quatro conversas consultáveis, 77 mensagens retornadas e 19 respostas IA. Nenhum eco Business nem expressão “encaminhar … equipe” nessa amostra. Uma conversa tinha resumo; três não. São até 30 mensagens por conversa: ausência na amostra não prova inexistência no acervo.
- O painel Render e a configuração Meta não puderam ser inspecionados nesta rodada. O controle de navegador falhou por componente ausente; o controle Windows parou por não conseguir verificar a URL. Não se extraiu sessão nem se contornou a proteção. Não havia credencial Render disponível no ambiente consultado. Plano, disco persistente, backup e commit do deploy continuam sem comprovação pelo painel.

## Solicitado × existente × mudança desta rodada

| Frente | Estado encontrado | Alterado e testado | Publicação desta rodada |
| --- | --- | --- | --- |
| Respostas pelo celular | Recepção de `smb_message_echoes`, deduplicação e pausa da IA já existiam. Ecos aceitos entram no contexto das respostas após liberação humana. | Regressão de autoria, deduplicação, pausa e contexto. Diagnóstico administrativo passa a mostrar total persistido e última data de ecos, sem dados de clientes. | Pendente |
| Contexto de clientes antigos | Consulta direta às seis bases disponível; resumo e TXT manual de sete dias já implementados. Não há recuperação automática de todo o passado. | Revalidado acesso real; preservado escopo por cliente e controle humano. Não duplicadas bases nem permissões. | Revalidação não exige deploy |
| Área da conversa | Menu fixo e cabeçalho com espaço excessivo. | Menu recolhível com preferência persistida, cabeçalho menor, contadores por conversa. Ganho medido de 144 px na conversa a 1440 px. | Pendente |
| Avisos | Recebimentos independentes da IA já geravam alerta, mas som era opt-in e silenciar não persistia explicitamente. | Preferência ligada por padrão, som liberado por gesto, silenciar persistido, contadores e destaques por conversa. Nenhum pedido de permissão ao carregar. | Pendente |
| Notion em conversa concluída | Conclusão administrativa bloqueava texto e documento. | Removido esse impedimento no conector, mantendo prévia, confirmação, destinatário, escopo, janela de 24 horas, idempotência e verificações de concorrência. Não reabre conversa nem libera IA. | Pendente |
| Falhas da IA | Orientação de revisão existia apenas no guia. Tom de integrante da Domum já estava no prompt. | Registro local por resposta, categoria, observação e proposta; revisão exclusiva de administrador; decisão imutável e repetição idempotente. Nenhuma regra global alterada automaticamente. | Pendente |
| Identificar versão publicada | Saúde informava somente disponibilidade e modo. | `/healthz` passa a informar `revision` somente quando `RENDER_GIT_COMMIT` contém um SHA válido; caso contrário, null. | Pendente |

## Limites reais e dependências

### WhatsApp

O código não pode criar eventos que a Meta não entregou. Antes de prometer sincronização do celular, conferir no cadastro existente a coexistência, o número e a assinatura `smb_message_echoes`; depois testar uma mensagem de um contato autorizado. Não excluir, migrar, registrar novamente o número ou contratar provedor para tentar contornar a falta de eventos.

A documentação direta da Meta respondeu HTTP 429 nesta consulta. A [documentação oficial do provedor 8x8](https://developer.8x8.com/connect/docs/whatsapp/whatsapp-business-app-coexistence/) descreve coexistência e espelhamento em sua plataforma; isso não comprova elegibilidade, assinatura ou funcionamento desta conta Meta. O provedor ativo da Central continua sendo o adaptador direto Meta.

Histórico antigo continua exigindo exportação TXT e conferência ou um resumo humano. Importação não abre janela, não comprova andamento e não provoca respostas antigas. Grupos e sincronização completa entre aparelhos não estão comprovados.

### Notion e documentos corporativos

A consulta direta ao Notion funciona independentemente de créditos de agente. Preparação de arquivos anexados e PDF de texto de página já existem, com aprovação antes do envio. O estado administrativo concluído passa a ser aceito pelo conector.

Não há conector Microsoft Graph de produção no servidor. A conexão Microsoft disponível neste chat não concede acesso ao Render. Busca automática em SharePoint/OneDrive, arquivamento corporativo e leitura integral de documentos pela IA continuam pendentes de uma integração própria com recursos e permissões limitados. Não foram concedidos acessos nem copiados documentos corporativos nesta rodada.

O MCP atual é restrito a telefones autorizados; a interface dos operadores tem autorização própria. A consulta de mensagens retorna metadados de anexos, não um download binário genérico utilizável por qualquer chat. Não ampliar a lista de telefones ou expor mídia por links públicos como atalho.

### Notificações e revisão

Os [avisos do sistema precisam de permissão do navegador](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API), solicitada pelo botão de teste. [Áudio pode depender de interação com a página](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay); a preferência ligada não elimina essa restrição. Não há push com a Central fechada. Quem silenciar mantém destaques e contadores visuais.

Em **Revisar IA**, registrar uma falha não corrige uma mensagem já enviada. Aprovar documenta a decisão; a correção do contexto atual deve ser feita em **Cliente e histórico → Editar resumo e pendências**. Uma regra reutilizável exige alteração revisada e cenários de regressão. A fila não é enviada à OpenAI, ao Notion ou aos clientes automaticamente e não treina o modelo.

### Pedidos correlatos recuperados

Permanecem no escopo futuro: clipe sem seleção prévia de tipo, múltiplos arquivos, arrastar/colar; baixar anexos por integração autenticada neste ChatGPT/Notion; armazenamento corporativo com origem e datas; correio Microsoft 365; aplicativo Windows/inicialização; alternativa ao agente interno enquanto faltar crédito Notion. Não foram confundidos com funções já publicadas. Nada disso foi contratado ou habilitado silenciosamente.

## Validação

- Antes das mudanças: 207 testes aprovados.
- Versão desta rodada: 215 testes aprovados, incluindo autenticação, origem, isolamento por conversa, revisão administrativa, ecos/contexto, janela encerrada, texto/documento em conversa concluída, repetição sem novo envio e avisos após silenciar/recarregar.
- Interface local em Chrome separado e banco em memória: 1440×1000 e 390×844; sem erro de JavaScript ou corte horizontal, compositor visível, preferência de menu persistida, registro/revisão de falha e silenciamento persistido.
- Todos os testes usam dados fictícios e transporte falso. Nenhuma mensagem real, geração paga ou alteração de configuração de produção foi feita.
- O comando do pacote é `node --test test/*.test.mjs`; foi executado diretamente porque o atalho `npm` não estava no PATH desta sessão. O CI usa `npm test`.

## Publicar com segurança

1. Conferir o diff e o resultado de CI da PR desta rodada.
2. Confirmar no Render o serviço, branch de produção, disco persistente e backup SQLite consistente. O `render.yaml` histórico tem Free e `/tmp`, e não prova a configuração atual. Não fazer deploy com a persistência desconhecida.
3. Obter autorização para a publicação concreta. Não mudar limites financeiros, credenciais, permissões, número ou habilitação da IA como efeito do deploy.
4. Publicar o commit aprovado, aguardar Live e comparar `/healthz.revision` com o SHA esperado. Verificar saúde, login e consulta ao Notion antes de teste autorizado de mensagens.
5. Testar ecos do celular, tomada humana, envio aprovado em conversa concluída e notificações. Meta aceitar o envio não comprova entrega; conferir `delivered`/`read`.

Reversão: publicar o commit anterior preservando banco e arquivos. As duas tabelas de revisão são aditivas; o código anterior as ignora. Não restaurar banco antigo nem apagar dados como forma de rollback. Nenhuma variável nova é exigida pelas melhorias.
