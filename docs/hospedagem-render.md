# Hospedagem proposta: Render

O usuário ainda não possui servidor nem domínio. A proposta é um serviço Node no Render, com endereço HTTPS fornecido pela plataforma e disco persistente para o SQLite. Domínio próprio é opcional. O serviço e o disco são pagos; consulte os valores atuais no painel antes de criar recursos.

O arquivo `render.yaml` foi preparado para revisão. Nenhum recurso foi criado, nenhum plano foi contratado e nenhuma publicação foi feita. A documentação web do Render respondeu 403 neste ambiente, então a aceitação do blueprint pelo painel da plataforma ainda precisa ser validada. Referências: [Blueprint](https://render.com/docs/blueprint-spec), [discos](https://render.com/docs/disks), [Node](https://render.com/docs/node-version).

## O que está preparado

- Node.js 24.19.0, testes antes da inicialização, comando `npm start` e verificação em `/healthz`.
- Escuta em `0.0.0.0`, usando a porta informada pela hospedagem.
- Banco em `/var/data/central.sqlite`, num disco persistente de 1 GB. O serviço precisa permanecer com uma única instância enquanto usar SQLite local.
- Modo demonstração. As credenciais da Meta não fazem parte do blueprint.
- Código de instalação gerado pela plataforma em `SETUP_TOKEN`, necessário para criar o primeiro administrador.
- Atualização automática desativada. Novos commits não devem iniciar deploys sem revisão.

Quando `PUBLIC_ORIGIN` não estiver definido, a aplicação usa `RENDER_EXTERNAL_URL`, fornecido pela plataforma, como origem das requisições. Se usar domínio próprio, configure `PUBLIC_ORIGIN=https://SEU-DOMINIO`, sem barra final, antes de atender por esse endereço. Não configure uma origem localhost na hospedagem remota.

## Publicação, após revisão e autorização

O usuário informou que criou sua conta no Render. Se o painel ainda estiver em `verify-email`, concluir a confirmação pelo e-mail recebido. A conexão do repositório e a contratação dos recursos são etapas distintas do cadastro; o blueprint deve usar o código novo depois que ele estiver disponível no GitHub.

1. Revisar a versão da central e disponibilizá-la no GitHub. Se as alterações estiverem numa branch de revisão, integrar a mudança antes de implantar a partir de `main`. Conferir que o commit selecionado contém `server.mjs`, `render.yaml` e o projeto novo.
2. Conectar a conta Render ao repositório e criar um Blueprint com `render.yaml`. Conferir no painel o plano, o disco e o custo antes de confirmar a criação dos recursos.
3. Validar o resultado dos testes, a inicialização e o health check. Acessar a central pelo endereço HTTPS gerado.
4. Consultar `SETUP_TOKEN` privadamente nas variáveis do serviço e usá-lo somente no cadastro inicial da central. Não colocar esse valor em URL, Git ou chat. Criar o administrador e depois os demais atendentes.
5. Validar a demonstração com dados fictícios e confirmar persistência após reiniciar o serviço. Configurar backup consistente do SQLite e verificar sua restauração antes de produção.
6. Só depois configurar a Meta conforme [INICIO.md](../INICIO.md). Registrar o webhook público, testar com um contato autorizado e confirmar entrega dos lembretes.

O runtime da nuvem desta conversa é destinado a desenvolvimento. Não há URL pública para este servidor local nem conexão de entrada da Meta validada. O disco, a hospedagem e o banco no Render são recursos separados deste ambiente.
