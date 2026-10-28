# Atendimento contextual e melhoria supervisionada — versão inicial

## Alterações desta etapa
- Linguagem acessível para clientes leigos, escolhendo a próxima pergunta pela necessidade, não por checklist.
- IA fala como parte da Domum ("vamos verificar"), sem prometer que outra pessoa já recebeu ou resolveu o caso.
- Distinção explícita de clientes existentes, manutenção, reclamações, candidatos, fornecedores, demandas administrativas e contatos por engano.
- Conservação do vínculo cliente → trabalho → demanda. Um resumo interpretado pela IA nunca é confirmação da equipe.
- Orientação para registrar correções feitas pelo cliente no resumo da demanda; nenhuma alteração automática do prompt global.
- Simulação gratuita corrigida para não dizer "encaminhar para a equipe".
- Catálogo de investigação por assunto, como referência opcional; ofertas de fornecedores e procura de emprego não herdam perguntas sobre obra do histórico anterior.
- Brevidade sem abandonar a condução: se o cliente espera o próximo passo, fazer a pergunta básica pertinente, em vez de repetir que a conversa pode continuar. Exemplos de várias trocas para construção, terreno e projeto.

## Critérios de aceite para próxima etapa de implementação
1. **Memória por demanda:** selecionar trabalho correto antes de construir o resumo usado pelo modelo; conferir origem, data e qualificação dos registros; não mesclar imóveis.
2. **Qualidade:** registrar eventos de falhas sem dados sensíveis desnecessários (pergunta repetida, jargão, promessa, confusão de identidade, status antigo, insatisfação, transferência indevida), com amostra da evidência e referência interna.
3. **Revisão:** propor correção em fila administrativa; revisão humana obrigatória antes de torná-la uma regra geral. Versões e rollback.
4. **Regressão:** executar cenários negativos e positivos com transportes fictícios, depois piloto autorizado no telefone com teto financeiro preservado.
5. **Acesso ao Notion:** diagnosticar as fontes de Trabalhos, Propostas, Projetos e Atividades no Render; não recriar bases para contornar falta de permissão.
6. **Observabilidade:** avaliar indicadores por 100 conversas: re-perguntas desnecessárias, reclamações, transferência, abandono, acerto de contexto e intervenções.
7. **Atendimentos não comerciais:** políticas de emprego e fornecedores não podem cadastrar contato como prospect de engenharia.

## Limites e evidência
Esta alteração modifica o guia de comportamento, a resposta do simulador e testes estáticos. Não implementa ainda revisão automática de falhas, novas telas ou uma base de lições. Os testes estáticos verificam instruções presentes, mas não comprovam qualidade do modelo. Nenhum cliente deve receber mensagens como efeito colateral dessa alteração. Não mudar habilitação, contas, custos ou permissões no Render sem validação separada.

Em 28/10/2026, a consulta autenticada ao serviço confirmou cadastro e histórico acessíveis, mas Trabalhos, Propostas, Projetos e Atividades ainda retornaram fonte não encontrada ao acesso de servidor. Os IDs estavam preenchidos. Esse resultado não distingue sozinho ID incorreto de falta de acesso; conferir a fonte e as Conexões da integração usada no Render. A consulta da conversa do piloto também confirmou que ela estava concluída e em modo humano; não reaberta nem reativada por esta revisão. Não alegar contexto operacional completo nem atendimento automático ativo nessa conversa.
