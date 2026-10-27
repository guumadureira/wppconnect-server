# Histórico manual e contatos de fornecedores

## Importar uma conversa individual

No WhatsApp do celular, exporte a conversa **sem mídia**. A função Exportar conversa está no menu da conversa; veja a [orientação oficial](https://faq.whatsapp.com/1180414079177245/?cms_platform=android&locale=pt_BR). Se o compartilhamento produzir ZIP, extraia o TXT antes de selecionar na central. Não é necessário desinstalar o WhatsApp ou restaurar um backup.

Na central, um administrador abre a conversa certa e usa **Cliente e histórico → Importar histórico**. Selecione o TXT de até 1 MB e o formato das datas. A importação considera somente os últimos sete dias, no fuso de São Paulo. Confira qual nome representa o contato; o outro representa a Domum. Nesta versão não aceita mais de dois nomes, grupos, fotos, documentos ou áudio do arquivo exportado. Mensagens de mídia aparecem somente como o texto que constar no TXT.

A prévia mostra telefone, participantes, quantidade, duplicadas e amostra de mensagens. Somente **Importar nesta conversa** salva. A confirmação depende da mesma pessoa, conversa e versão do contexto, tem validade de 30 minutos e não pode ser trocada por um arquivo diferente. Mudança de mensagem ou tomada humana exige nova prévia. Repetir a confirmação não duplica a importação.

Mensagens ficam em tabelas próprias no mesmo SQLite persistente, visíveis com o rótulo **histórico importado**. Não ganham IDs da Meta, não criam pendência, não abrem janela de 24 horas, não reabrem conversa e não disparam IA, notificações ou cadastro. O original no celular não é alterado. A IA é pausada; confira o resumo e use Permitir assistência quando quiser continuar, dentro dos telefones e limites já autorizados.

Na próxima mensagem real, o modelo recebe um trecho recente do histórico importado (até 60 mensagens candidatas e 7 KB de contexto, com sinalização se limitado), separado do histórico ao vivo e tratado como exportação não verificada. O TXT pode estar incompleto ou alterado; não comprova identidade, aprovação ou andamento atual. Não serve de fonte para o cadastro automático de cliente. Os controles existentes de resposta e consumo continuam valendo. Importar não faz chamada paga de IA.

## Ofertas de fornecedores e prestadores

Quem oferece produtos ou serviços recebe classificação comercial. Se a atividade ainda não está clara, a IA pode fazer uma pergunta curta sobre o serviço. Quando já compreendida, aproveita a informação recebida, agradece e recusa a oferta atual com cordialidade e poucas palavras, deixando apenas a possibilidade de contato futuro caso surja necessidade. Varia a resposta conforme a conversa; não pede catálogo, orçamento, reunião ou detalhes que prolonguem a venda e não promete contratação ou retorno. Uma oferta comum não exige passagem à equipe. Fornecedor já contratado com cobrança, entrega ou trabalho pendente precisa do atendimento correspondente; não recebe uma recusa automática de prospecção.

Os dados disponíveis ficam em uma fila local por telefone exato e sincronizam em uma base exclusiva. Não cria cliente, proposta, contrato ou relação com trabalho. A IA fornece descrição do serviço de até 240 caracteres e a mensagem de origem. Nome explícito precisa constar nas mensagens do contato; se ausente, usa o nome disponível na conversa como perfil, sem afirmar razão social confirmada. O **Resumo da IA** e a **Categoria** são interpretações automáticas. Categorias: Materiais e produtos, Mão de obra e execução, Projetos e serviços técnicos, Serviços para empresas, Outros e A identificar. A Situação escolhida pela equipe continua preservada em atualizações.

Depois de registrar localmente o serviço e enviar a resposta final com aceitação da Meta, a central conclui a conversa comercial e pausa a IA, sem marcar Pronto para assumir. Uma mensagem nova ou intervenção humana durante o envio impede a conclusão antiga. Falha ou resultado incerto também não concluem. A gravação no Notion acontece pela fila; concluir a conversa não comprova que o Notion já foi atualizado. Um nome como Wilton, sozinho, nunca determina qual serviço a pessoa oferece.

Base privada criada no Notion: [Fornecedores e prestadores — Contatos recebidos](https://app.notion.com/p/f575a206f48247c9b898161a741cfc70).

No Render, mantendo a integração atual, configure:

```dotenv
NOTION_SUPPLIERS_DATA_SOURCE_ID=ad7f0e81-2640-4830-a1bb-aebe193120aa
```

A integração cujo NOTION_TOKEN está no Render precisa de acesso próprio a essa base. Criar a base pelo conector do chat não transfere esse acesso. Não substitua o token nem amplie permissões de outras bases para fazer essa configuração. Não altera listas de telefones, escopo MCP ou o teto de US$ 5 do piloto.

Conexão → Fornecedores e prestadores mostra a fila e o resultado a conferir. A sincronização pesquisa telefone/chave antes de criar, reaproveita correspondência única e preserva o campo Situação alterado pela equipe em atualizações. Múltiplas correspondências precisam de conferência. Criação sem resposta não é repetida automaticamente: antes, pesquisa o registro; sem correspondência, mantém o caso incerto. Status só indica gravação depois de resposta confirmada. Não há contato futuro automático com esses fornecedores.

## Validação

Testes usam TXT, contatos, bancos e respostas fictícios. Cobrem datas Android/iPhone, fuso, multiline, período, prévia, autoria, deduplicação, tomada humana, autorização, persistência lógica e fila comercial com criação incerta. A conferência do texto natural e da sincronização real exige deploy e teste autorizado. A base foi criada e conferida vazia; isso não comprova que o servidor já tem acesso ou gravou fornecedores.
