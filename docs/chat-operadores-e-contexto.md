# Chat interno e reconhecimento do cliente

## Assistente interno

A aba **Assistente interno** atende usuários autenticados, incluindo operadores. Conversa com um **Custom Agent real do Notion**, pela API de sessões; não usa a OpenAI do WhatsApp nem tenta controlar o navegador do Notion. O agente já precisa existir e estar autorizado para a conexão. Sua configuração e seus acessos determinam o que consegue consultar, gerar ou alterar.

No Render, preservar o banco persistente e configurar:

```dotenv
NOTION_OPERATOR_CHAT_ENABLED=false
NOTION_OPERATOR_AGENT_ID=
NOTION_AGENT_TOKEN=
```

NOTION_AGENT_TOKEN é opcional: vazio reutiliza NOTION_TOKEN. Para a conexão interna, habilitar **View sessions and interact with agents** e escolher o agente em **Agent access**. Não é necessário dar à conexão permissão para editar ou excluir agentes. Conferir acesso pelo botão de administração antes de habilitar o chat. A verificação só lê os metadados do agente, sem iniciar execução.

Habilitar explicitamente com NOTION_OPERATOR_CHAT_ENABLED=true depois de conferir o agente, seus acessos e créditos. O chat usa o consumo do Notion, separado do teto de US$ 5 da OpenAI do atendimento. A implementação não contrata plano, aumenta limite, recarrega créditos ou habilita automaticamente o serviço. O token da integração no Render precisa estar autorizado; o acesso do conector deste chat não comprova esse acesso.

Selecionar um agente apropriado para **todos os operadores**. O acesso remoto é o da conexão, e não a permissão individual do operador no Notion. A interface não permite escolher IDs de agentes ou de sessões remotas arbitrários. Dados internos/financeiros restritos devem continuar fora dos acessos do agente utilizado pela equipe.

Chats e respostas persistem no SQLite, separados das mensagens dos clientes. A identificação combina a conta autenticada e a assinatura escolhida no login. A mesma conta e assinatura retomam os mesmos chats; assinaturas diferentes ficam separadas na interface. A assinatura é uma identificação declarada, não autenticação independente: quem compartilha uma conta também compartilha a capacidade de escolher seus nomes.

Cada comando possui requestId. Repeti-lo com o mesmo conteúdo recupera o resultado, sem novo despacho. O servidor não repete comandos em timeout ou reinício; resultado incerto exige conferência. As respostas são consultadas de forma assíncrona, em ordem, sem renderizar HTML do agente, raciocínio ou resultados de ferramentas como código executável. Ações que o Notion apresentar para aprovação exigem decisão explícita da prévia atual. Registros de decisões ficam no chat.

## Buscar e enviar documento

**Buscar e enviar documento** está disponível aos operadores autenticados. Selecionar a conversa pelo nome **e telefone**, indicar a página no Notion e escolher um arquivo pronto ou gerar PDF de texto da página. Para PDF de texto, revisar o conteúdo completo antes de gerar. Depois abrir o arquivo, conferir a legenda e o destinatário e confirmar o envio.

Esse caminho usa a sessão autenticada da central e seu acesso normal às conversas. Não amplia CENTRAL_MCP_ALLOWED_PHONES nem habilita envios da conexão externa. Prévias ficam vinculadas ao canal e à conta/assinatura de origem; outra assinatura ou a conexão MCP não pode confirmá-las. Mantém as proteções de versão, vínculo, arquivo, validade, janela de 24 horas e resultado incerto. A preparação não cria mensagem fictícia, não chama IA paga nem envia. Consulte também [o fluxo de documentos](notion-central-mcp.md).

O agente pode gerar uma proposta apenas se suas ferramentas e instruções permitirem. Texto apenas escrito no chat não equivale a arquivo salvo. Para usar o botão de envio, salvar a proposta em página acessível à integração ou anexar o PDF pronto a essa página. Arquivos externos e layouts complexos seguem os limites existentes; não se trata de exportador universal do Notion.

## Localizar contexto antes de responder

Ao registrar mensagem de entrada, a central coloca uma busca na fila persistente. Isso também funciona com a IA automática desligada ou para contatos fora do piloto, sem habilitar respostas a esses números. Para uma resposta automática, a própria execução espera a busca quando ainda não existe vínculo.

A busca usa o campo **Telefone** de **Clientes — Cadastro restrito**, conferindo o número completo após a consulta. Aceita formatação e a variante móvel brasileira com/sem o nono dígito; não associa por sufixo ou nome de perfil. Uma única correspondência em consulta completa permite vínculo local, registrado como associação por telefone, sem criar outro cliente. Mais de um cadastro, consulta parcial, mudança de contexto ou nome expressamente divergente exigem conferência. A associação não comprova propriedade do imóvel, identidade civil, contratação ou representação de terceiros.

Após identificar o cadastro, a central consulta seus registros operacionais vinculados e as seções **Contexto básico de atendimento**, **Contexto para atendimento** ou **Atendimento** no corpo da própria página de cliente. Não percorre suas pastas locais, subpáginas, comentários ou links, nem copia automaticamente campos de CPF, valores ou dados bancários. O trecho é limitado a 4 mil caracteres e informa leitura parcial/indisponível. Esses dados chegam ao modelo como referência documental não verificada, não como instruções nem confirmação de andamento atual.

Para preparar o acervo, manter o cadastro único com telefone; vincular projetos e atividades a ele; usar uma das seções de atendimento para resumo do serviço, decisões, pendências, datas e origem das evidências. Não substituir o contratante por proprietários ou intermediários encontrados nos documentos. Havendo mais de um trabalho, identificar cada frente e conferir qual a pessoa quer tratar. Não inventar estado atual a partir de documento antigo.

As fontes operacionais do Render precisam estar acessíveis. Encontrar um resumo no Notion por outro conector não comprova que o servidor consegue lê-lo. O chat interno, a busca de cadastro e os registros de arquivos não liberam a IA do WhatsApp para contatos fora da lista já autorizada.

## Histórico pessoal, Business e grupos

O acervo de contexto é útil mesmo sem o histórico completo de WhatsApp. Priorizar clientes e trabalhos ativos, o último acordo, pendências, documentos entregues e decisões que mudaram o escopo. Marcar origem e data; mensagens e resumos interpretados não são confirmação técnica ou contratual.

A importação manual já implementada aceita TXT individual, sem mídia, dos últimos 7 dias, com conferência de participantes e telefone. Não transfere mensagens para o aplicativo Business nem abre a janela de envio. Conversas exportadas do WhatsApp pessoal podem fornecer contexto ao cadastro correto sem migrar o número pessoal ou copiar todas as conversas. Para fatos mais antigos, preparar resumo no Notion com as fontes; não alterar a exportação para aparentar datas recentes.

O código atual recebe mensagens novas e ecos do Business que a Meta entregar. Não implementa recuperação automática de histórico de coexistência, histórico de grupos ou sincronização de grupos existentes. A disponibilidade do fluxo oficial de histórico precisa ser conferida na conta e no cadastro de coexistência; não desconectar ou refazer o cadastro apenas para tentar recuperar mensagens. Grupos não devem ser tratados como conversas individuais: múltiplos clientes e autores exigem seleção e conferência antes de usar informações no atendimento de alguém.

Fontes da implementação: [Notion Agent API](https://developers.notion.com/guides/notion-agent-apis/overview), [autenticação e início de sessão](https://developers.notion.com/guides/notion-agent-apis/quickstart), [sessões e ações](https://developers.notion.com/reference/notion-agent-apis/update-session).
