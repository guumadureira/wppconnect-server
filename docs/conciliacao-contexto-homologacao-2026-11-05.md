# Homologação — conciliação de contexto da Central Domum

Estado: proposta técnica, **não publicada**. PR #54. Atualização: 05/11/2026.

## Objetivo e escopo

Cada mensagem persistida na Central deve contribuir para o **contexto operacional**, independentemente de ter origem no cliente, na IA, em um atendente do painel ou no eco do aplicativo WhatsApp Business. O processo de síntese não responde no WhatsApp, não autoriza ações, não cadastra contratos e não presume que a equipe concluiu o serviço.

Fluxo: `messages` (SQLite) → gatilho de fila por conversa → síntese estruturada → versão otimista do `conversation_context` → evento qualificado em `service_events` → fila própria do Notion. Para cliente já vinculado, a síntese consulta o cadastro e o resumo existentes no Notion antes de gravar; sem acesso válido ou sem a sincronização de resumos habilitada, mantém a tarefa em retry, **sem atualizar o contexto do cliente**.

A janela proposta de 60 minutos após intervenção humana, o controle de transferência e as regras de envio de mensagens continuam independentes deste worker. Alterar um resumo **não** libera a IA, nem inicia atendimento automático.

## Guardas de segurança

- Desativado por padrão. Nenhum deploy, merge ou alteração de ambiente de produção está autorizado por este documento.
- Limite financeiro mensal separado, exigido para habilitar. Processamento usa `store:false` na chamada de síntese; os textos de mensagens são processados pela API da OpenAI, portanto revisar privacidade, minimização de dados e permissões antes de ativar.
- Não envia mensagens ao cliente. Restringe o diagnóstico e a recuperação histórica a sessões de administrador.
- Registros internos da direção e contatos comerciais já classificados são excluídos. Uma proposta de reclassificação comercial de cliente vinculado exige revisão humana.
- Não considera saída sem confirmação da Meta como mensagem enviada. Não impede a continuidade da síntese dos eventos confirmados; identifica a presença de saídas incertas para análise.
- Mudanças de mensagem durante a síntese **ou** confirmação posterior de status invalidam o resultado anterior; um controle de geração protege o mesmo `rowid`.
- Falhas no Notion não apagam o contexto existente nem criam contratos, receitas ou tarefas. A síntese registra informações como **interpretadas**, não confirmadas.
- Não expor chave da API, credenciais, telefones ou mensagens no repositório público, comentários da PR, registros de CI ou evidências de teste.

## Configuração proposta (somente após aprovação)

```dotenv
CONTEXT_RECONCILIATION_ENABLED=false
CONTEXT_RECONCILIATION_MONTHLY_BUDGET_USD=0
NOTION_ENABLED=true
NOTION_CLIENT_SUMMARY_ENABLED=true
```

A configuração acima é **exemplificativa**, não foi aplicada ao Render. Para iniciar piloto, mudar a habilitação e o orçamento apenas no ambiente de homologação aprovado, com as conexões válidas e o backup confirmado. `OPENAI_API_KEY` deve estar no gerenciador de segredos do ambiente, nunca no código.

## Rotas internas propostas

| Rota | Método | Permissão | Comportamento |
|---|---|---|---|
| `/api/context/reconciliation/status` | GET | Admin | Estado da conciliação, filas, revisão e orçamento |
| `/api/context/reconciliation/backfill?limit=100` | GET | Admin | Prévia de registros históricos elegíveis, sem enfileirar |
| `/api/context/reconciliation/backfill` | POST | Admin | Requer `{"confirmed":true,"limit":100}`, worker habilitado e ambiente autorizado |

Não disparar POST de recuperação histórica em produção antes da análise da prévia, da capacidade de processamento e da validação de privacidade.

## Testes automatizados

`npm test`, Node.js 24, via GitHub Actions. A suíte usa SQLite em memória e transporte falso, sem token de produção, clientes reais, mensagens à Meta ou alterações no Notion corporativo.

Casos principais: mensagens dos dois sentidos; atualização durante geração; confirmação de entrega posterior com mesmo cursor; saída incerta; reclassificação comercial; contatos internos; indisponibilidade e desativação do Notion; histórico idempotente; autorização de administrador e confirmação explícita.

## Limitações conhecidas

1. A síntese considera os últimos **40 eventos textuais confirmados** mais o resumo anterior e os campos recuperados do Notion. Uma conversa longa pré-existente **não** está inteiramente reprocessada por esta versão. A recuperação histórica é controlada e não substitui a auditoria de todas as páginas/anexos. Não afirmar cobertura integral sem uma etapa própria de paginação e reconciliação.
2. Áudios sem transcrição e imagens/documentos não analisados não permitem extrair seu conteúdo. O registro de recebimento não comprova interpretação.
3. Grupos do WhatsApp, integração SharePoint e gatilhos externos de mudanças diretamente no Notion são frentes diferentes e **não estão implementados por esta PR**.
4. A integração com WhatsApp Business depende de webhooks efetivamente assinados e entregues pela Meta (`messages` e `smb_message_echoes`); testes simulados não comprovam entrega em produção.
5. O modelo pode produzir sínteses incompletas. Conferir casos com contrato, pagamentos, prazos, procurações ou mudanças relevantes antes de usá-los em decisões jurídicas e operacionais.

## Homologação e ativação progressiva

1. Validar GitHub Actions na revisão final da PR e registrar o SHA aprovado.
2. Inspecionar ambiente de testes e backup do SQLite, sem copiar credenciais e dados pessoais para arquivos públicos.
3. Realizar piloto isolado com contato fictício: mensagem do cliente → resposta do painel → eco do Business simulado → falha/recuperação do Notion. Comparar resumo local, histórico e campos dedicados no cadastro restrito.
4. Avaliar prévia do histórico e confirmar quais registros necessitam revisão; não acionar recuperação em massa silenciosamente.
5. Observar fila, retentativas, custo reservado e possíveis divergências; proteger a retomada da IA conforme política humana de 60 minutos.
6. Somente depois de autorização específica, planejar merge e deploy com possibilidade de reversão. Desligar `CONTEXT_RECONCILIATION_ENABLED` é a contenção imediata; não apagar tabelas ou eventos para reverter.

Referência: [PR #54](https://github.com/guumadureira/wppconnect-server/pull/54).
