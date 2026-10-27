// Catalogo inicial de investigacao, nao tabela de precos nem parecer tecnico.
// Sugere contexto para as perguntas sem obrigar o modelo a executar um formulario.
// As ofertas efetivas e condicoes contratuais precisam ser confirmadas pela Domum.
const services=[
  {
    id:'regularizacao-municipal',
    label:'Regularizacao municipal de obra ou imovel',
    match:[/regulariz/,/habite.?se/,/alvara/,/prefeitura/,/construcao sem aprovac/,/casa sem projeto/],
    need:'Entender se a pessoa quer regularizar uma construcao existente, obter aprovacao ou resolver alguma pendencia municipal.',
    clues:['Imovel ja construido ou obra ainda planejada','Municipio da obra','Existencia de projeto ou aprovacao anterior, se a pessoa souber'],
    question:'A casa ja esta pronta ou ainda vai ser construida?',
    limit:'Nao concluir que a regularizacao e viavel ou listar exigencias especificas sem consulta municipal.'
  },
  {
    id:'registro-e-averbacao',
    label:'Registro ou averbacao do imovel',
    match:[/averbac/,/cartorio/,/matricula/,/escritura/,/registro do imovel/,/documento do terreno/,/casa no documento/],
    need:'Diferenciar a documentacao da prefeitura dos registros mantidos pelo cartorio de imoveis.',
    clues:['O que a pessoa deseja que apareca na documentacao','Se a construcao ja existe','Municipio do imovel, quando relevante'],
    question:'Voce quer que a construcao apareca no registro do terreno ou esta tentando resolver uma pendencia na prefeitura?',
    limit:'Nao pressupor que alvara, habite-se e averbacao sejam o mesmo procedimento.'
  },
  {
    id:'regularizacao-fiscal-obra',
    label:'Regularizacao da obra perante a Receita Federal',
    match:[/\binss\b/,/\bcno\b/,/\bsero\b/,/\bcnd\b/,/receita federal/,/certidao negativa/],
    need:'Compreender a finalidade da regularizacao previdenciaria da obra, sem prometer calculos ou certidoes.',
    clues:['Situacao da obra','Qual pendencia ou documento a pessoa quer resolver','Se ja possui dados ou protocolo da obra'],
    question:'Voce precisa resolver alguma pendencia da obra na Receita Federal ou quer saber quais documentos faltam?',
    limit:'Nao calcular encargos, prazos, valores ou afirmar emissao de CND sem analise.'
  },
  {
    id:'projetos',
    label:'Projetos arquitetonicos e complementares',
    match:[/projeto arquiteton/,/projeto estrutural/,/projeto eletric/,/hidrossanit/,/projetos complementares/,/planta da casa/,/planta baixa/,/calculo estrutural/],
    need:'Entender o objetivo do projeto sem exigir que o leigo saiba qual especialidade tecnica contratar.',
    clues:['O que a pessoa deseja construir ou modificar','Se existe obra ou projeto anterior','Municipio ou endereco geral da obra'],
    question:'O que voce pretende construir ou modificar?',
    limit:'Nao diagnosticar necessidade de cada especialidade nem garantir aprovacao.'
  },
  {
    id:'construcao-e-execucao',
    label:'Construcao, execucao e acompanhamento de obra',
    match:[/construir minha casa/,/quero construir/,/obra nova/,/executar obra/,/fazer a obra/,/empreitada/,/acompanhar obra/,/gerenciar obra/],
    need:'Distinguir planejamento, projeto, execucao, acompanhamento e administracao de uma obra.',
    clues:['Se ja existe projeto','Fase atual da obra','O que espera que a Domum assuma'],
    question:'Voce ja tem o projeto pronto ou ainda esta planejando a construcao?',
    limit:'Nao prometer equipe, materiais, modalidades, cronograma ou orcamento sem verificacao.'
  },
  {
    id:'reforma-e-ampliacao',
    label:'Reforma ou ampliacao',
    match:[/reform/,/ampliac/,/ampliar/,/aumentar a casa/,/quebrar parede/,/mudar a cozinha/,/reformar banheiro/,/trocar piso/],
    need:'Identificar o resultado desejado, distinguindo mudanca de ambiente, ampliacao e reparo pontual.',
    clues:['Parte do imovel afetada','O que quer mudar','Se o imovel esta em uso'],
    question:'Qual parte do imovel voce pretende mudar?',
    limit:'Nao afirmar seguranca de demolicoes nem dispensar projeto ou licenca antes de analise.'
  },
  {
    id:'manutencao-e-assistencia',
    label:'Manutencao, reparo e retorno sobre servico anterior',
    match:[/manutenc/,/reparo/,/infiltr/,/goteir/,/vazament/,/rachadur/,/trinca/,/telhado/,/problema voltou/,/garantia/,/deu problema/],
    need:'Entender o problema observavel e localizar eventual trabalho anterior; reclamacao ou recorrencia nao comprovam automaticamente causa ou garantia.',
    clues:['Onde aparece o problema','Quando acontece ou comecou','Se e o mesmo local de trabalho anterior','Sinais de risco ou urgencia'],
    question:'O problema acontece naquela mesma area que atendemos antes?',
    limit:'Nao diagnosticar causa, assumir responsabilidade, prometer garantia ou orientar reparo arriscado; urgencias exigem avaliacao humana.'
  }
];

const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const score=(s,text)=>s.match.reduce((n,re)=>n+(re.test(text)?1:0),0);
export function serviceGuidesFor({latest='',recent='',summary=''}={}){
  const current=normalize(latest).slice(-1800);
  const previous=normalize(recent).slice(-2500);
  const background=normalize(summary).slice(-1800);
  const matches=services.map(s=>({s,weight:score(s,current)*5+score(s,previous)*2+score(s,background)})).filter(x=>x.weight>0);
  // Sem indício claro, a IA entende a necessidade com a pessoa, sem receber guia inventado.
  matches.sort((a,b)=>b.weight-a.weight);
  return matches.slice(0,2).map(({s})=>({
    subject:s.label,
    possibleNeed:s.need,
    usefulClues:s.clues,
    exampleQuestionIfMissing:s.question,
    boundary:s.limit,
    instruction:'A pergunta e apenas exemplo. Use somente se faltar no contexto; nunca transforme estas pistas em formulario nem afirme que o servico esta contratado.'
  }));
}
