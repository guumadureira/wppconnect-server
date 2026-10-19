# Avaliação gratuita no Render

O usuário pediu para validar a central sem gastar. O blueprint padrão `render.yaml` usa **Free**, em modo demonstração, com SQLite temporário. Ele não cria disco persistente nem banco de dados pago. O Render fornece um endereço HTTPS; não é necessário comprar domínio.

A conta Render foi criada pelo usuário. O projeto está na `main`, e a configuração é validável pelo [schema oficial](https://render.com/schema/render.yaml.json). Nenhum serviço foi implantado nesta tarefa. A aba autenticada do usuário não oferece ferramentas de controle nesta conversa; a automação disponível depende de uma chave de API configurada com segurança no ambiente.

## Manter custo zero

Use o workspace gratuito e mantenha a avaliação sem método de pagamento cadastrado. Confira **Free** no resumo do serviço e não adicione disco, banco pago ou upgrade. Segundo a [documentação oficial do plano gratuito](https://render.com/docs/free), o Render oferece uma franquia de horas, banda e builds. Sem método de pagamento, atingir a franquia suspende os serviços ou novos builds, em vez de cobrar excedentes. Com método de pagamento cadastrado, alguns excedentes podem gerar cobrança; a seleção Free sozinha não limita todos os gastos do workspace.

Não altere a cobrança da conta para fazer o teste. Se já existir um método de pagamento, revise os limites no painel antes de implantar ou valide localmente, onde esta aplicação não depende de serviço externo pago.

## O que está preparado

- Node.js 24.19.0, testes antes da inicialização, `npm start` e verificação em `/healthz`.
- Serviço Free, escutando em `0.0.0.0` e usando a porta da hospedagem.
- SQLite temporário em `/tmp/central-demo.sqlite`.
- `WHATSAPP_MODE=demo`: envios simulados, sem credenciais da Meta e sem envio a clientes.
- `SETUP_TOKEN` gerado pela plataforma para proteger o cadastro do primeiro administrador.
- Atualização automática desativada.

Quando `PUBLIC_ORIGIN` não estiver definido, a aplicação usa `RENDER_EXTERNAL_URL`, fornecido pelo Render. Não configure uma origem localhost na hospedagem remota.

## Implantar e validar a demonstração

1. No Render, conectar o GitHub e selecionar `guumadureira/wppconnect-server`, branch `main`, com o blueprint `render.yaml`.
2. Conferir o plano Free e a ausência de recursos pagos, observando as condições de custo zero acima. Depois criar o serviço gratuito.
3. Validar o build, a inicialização e o health check. Abrir o endereço HTTPS gerado.
4. Consultar `SETUP_TOKEN` privadamente nas variáveis do serviço e usá-lo no cadastro inicial. Não colocar o valor em URL, Git ou chat. Criar o administrador e dois atendentes fictícios.
5. Simular um cliente, responder com os dois atendentes e conferir as assinaturas. Testar responsável, agendamento, conclusão/reabertura e visualização no celular.
6. Verificar a sessão e o funcionamento enquanto o servidor estiver ativo. Não usar esta avaliação para comprovar retenção de dados, alertas contínuos ou conexão real ao WhatsApp.

## Limitações do plano gratuito

Após 15 minutos sem tráfego, o serviço pode entrar em suspensão. A retomada pode levar cerca de um minuto. O SQLite, inclusive contas, mensagens e retornos, pode desaparecer ao suspender, reiniciar ou atualizar o serviço. Nesse caso, é necessário repetir o cadastro inicial com o código de instalação. Use somente dados fictícios.

Os temporizadores de lembretes não executam enquanto o processo estiver suspenso. O plano não oferece persistência local para produção. Nenhum destino externo de alertas foi configurado. A validação aqui é da interface e dos fluxos simulados da central.

O teste real do número Business é uma etapa separada: exige configurar a Meta, verificar coexistência/elegibilidade e avaliar os custos e regras da API ou do provedor escolhido. Não habilite `live` durante a avaliação gratuita da central.

Referências consultadas em 19/10/2026: [plano gratuito](https://render.com/docs/free), [blueprints](https://render.com/docs/blueprint-spec) e [preços](https://render.com/pricing).
