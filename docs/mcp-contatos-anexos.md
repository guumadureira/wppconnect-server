# Telefones e arquivos recebidos pelo MCP

## Base conferida em 04/11/2026

O GitHub incorporou a retomada integrada na PR #44, commit `e8599c41b9f4e5bfeae0d4d93fc774dd5baa4be7`. O Render e `/healthz.revision` confirmaram essa mesma revisão. Serviço Starter, uma instância, disco de 1 GB montado em `/var/data`; deploy automático desligado. Essa conferência não comprova backup recuperável nem uso físico atual do disco.

A versão anterior já permite envios Notion em conversas concluídas dentro da janela válida, preserva intervenção humana e contém os painéis de direção/coexistência e retomadas aprovadas. Este lote mantém esses controles.

## Identificação do destinatário

As ferramentas MCP passam a aceitar telefone formatado, com `+`, com país ou DDD brasileiro e as variantes brasileiras de celular com/sem nono dígito, usando as regras existentes em `contact-phone.mjs`. A lista `CENTRAL_MCP_ALLOWED_PHONES` também aceita formatação. A comparação continua limitada ao mesmo contato autorizado: não corresponde por nome nem por sufixo, não aplica nono dígito a fixos e revalida a autorização sobre o registro encontrado.

O número armazenado pela Central permanece o destino do envio. A busca não altera telefones, vínculos Notion ou históricos. Se houver mais de uma conversa equivalente, a integração bloqueia leitura, preparação e confirmação até revisão dos registros, inclusive quando uma variante coincide exatamente. Nenhum cadastro é fundido ou excluído.

O despacho MCP também revalida a janela de 24 horas e a validade da prévia depois do upload. Um identificador de mensagem vazio, inválido ou já registrado conserva o resultado como incerto, preserva a mensagem anterior e impede redisparo da mesma intenção. Não há exclusão automática de histórico para conciliar uma colisão.

## Recuperar arquivos recebidos

`listar_arquivos_recebidos({telefone, antesDe?})` retorna até 30 anexos recebidos por página, em ordem de registro decrescente. Para a página seguinte, passar `proximaPagina` como `antesDe`. A busca não se limita às últimas 30 mensagens, aos sete dias exibidos na interface ou a conversas abertas.

Cada item informa nome, formato, tamanho, estado, telefone da conversa, mensagem de origem e data da mensagem. Apenas arquivos prontos têm URI. Arquivos pendentes continuam visíveis como pendentes; a consulta não os baixa novamente nem inicia transcrição ou atendimento. O telefone retornado é o identificador preservado na conversa; não se inventa um identificador de remetente por mensagem que o banco antigo não tenha armazenado.

O servidor anuncia `capabilities.resources` e retorna blocos `resource_link`. O cliente MCP pode recuperar o original com `resources/read`, mantendo o mesmo Bearer e as regras de origem já exigidas pelo endpoint `/mcp`. O resultado contém `mimeType` e os bytes em `blob` base64, conforme a [especificação MCP de recursos](https://modelcontextprotocol.io/specification/2025-06-18/server/resources).

As URIs têm o formato `central://conversations/{id}/messages/{id}/attachments/{id}`. Não são links públicos e não abrem diretamente no navegador. Toda leitura revalida o contato autorizado e o vínculo entre conversa, mensagem recebida e arquivo. Não aceita caminhos de disco, URLs remotas, arquivos apenas preparados ou anexos enviados por outro cliente. O catálogo global de recursos permanece vazio; a descoberta é feita pela ferramenta da conversa autorizada.

O limite de leitura é 20 MB por arquivo, compatível com o limite atual de documentos da aplicação. Isso é um limite desta implementação, não uma afirmação sobre o limite máximo da Meta. O original não é convertido, alterado ou apagado. A sessão comum da interface não substitui a credencial MCP.

## Validação e limites

Testes simulados cobrem variantes de telefone, preservação do destino, países distintos, fixos, cadastros ambíguos, idempotência, paginação de arquivos antigos, bytes do original, conversa concluída, cursor alheio, vínculo adulterado, falta de autenticação, arquivo pendente e mudança de autorização. Não há envio real nem consumo de IA nesses testes.

Resultado local em 04/11/2026: **253 testes aprovados**, com `node --test test/*.test.mjs`, o mesmo comando definido em `npm test`. O executável `npm` não estava no PATH desta sessão; não foi necessário instalar dependências. A revisão incluiu testes de expiração durante upload e colisão do identificador Meta sem exclusão da mensagem anterior.

Este lote prepara o lado servidor. Ainda é necessário publicar com autorização e conferir se o cliente ChatGPT/Notion conectado oferece `resources/read` e apresentação/download do binário. Não declarar o fluxo completo homologado apenas pelos testes locais. Nenhuma integração foi cadastrada automaticamente, nenhuma credencial foi ampliada e nenhum arquivo foi transferido ao SharePoint.

Próximas etapas: assistente interno independente dos créditos do agente Notion, acesso Microsoft Graph com permissões restritas e melhorias do seletor de anexos. Publicação permanece separada da revisão do código; seguir o procedimento de backup da retomada integrada antes de deploy autorizado.
