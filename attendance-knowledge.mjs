// Curated orientation, not a legal opinion or a live municipal consultation.
const checkedAt='2026-10-28';
const maringa='https://sapl.cmm.pr.gov.br/ta/130/text';
const sarandi='https://sapl.sarandi.pr.leg.br/ta/1422/text';
const registry='https://www2.camara.leg.br/legin/fed/lei/1970-1979/lei-6015-31-dezembro-1973-357511-normaatualizada-pl.html';
const entries=[
  {topic:'Maringá — projeto e lote',city:'maringa',source:maringa,reference:'LC 1.045/2016, texto consolidado, arts. 109–111',match:/projet|constru|terreno|lote|ficha|recuo|alvar|regulariz/i,
    guidance:'A ficha técnica reúne uso e parâmetros urbanísticos do lote. Projeto, execução e conclusão são etapas distintas do licenciamento. Primeiro entenda o que a pessoa quer construir ou regularizar e identifique o imóvel. Não deduza recuos, altura ou aprovação pelo bairro ou metragem.',questionIfNeeded:'Você quer construir ou resolver a documentação de uma construção que já existe?'},
  {topic:'Maringá — documentação',city:'maringa',source:maringa,reference:'Código de Edificações e Posturas Básicas, procedimentos de licenciamento',match:/habite|conclus|document|regulariz|prefeitura|amplia|varanda|planta/i,
    guidance:'Diferencie a edificação existente, o projeto aprovado e o documento municipal de conclusão. Uma alteração na obra pode exigir conferência do projeto. Não trate documento recebido como aprovação nem prometa regularização.',questionIfNeeded:'O que você está tentando resolver com essa documentação?'},
  {topic:'Sarandi — projeto e obra',city:'sarandi',source:sarandi,reference:'LC 410/2022, texto consolidado, arts. 1–3 e 22',match:/projet|constru|reforma|amplia|terreno|alvar|regulariz|prefeitura/i,
    guidance:'O Código de Obras trata de projetos e licenciamento e deve ser lido junto com uso e ocupação do solo. Há procedimentos distintos de aprovação, alvará e regularização. Identifique a fase da obra e o objetivo; não aplique parâmetros de Maringá a Sarandi.',questionIfNeeded:'A obra já foi feita ou você ainda está planejando?'},
  {topic:'Sarandi — conclusão da obra',city:'sarandi',source:sarandi,reference:'LC 410/2022, texto consolidado, arts. 39–43',match:/habite|conclus|document|regulariz|averba|matricula/i,
    guidance:'O Habite-se é documento municipal de conclusão, sujeito à conferência da obra e do projeto. Não equivale à averbação no Registro de Imóveis. As exigências do caso precisam ser verificadas, sem checklist universal ou garantia de emissão.',questionIfNeeded:'Você já tem algum documento de conclusão da prefeitura?'},
  {topic:'Matrícula e registro do imóvel',source:registry,reference:'Lei 6.015/1973, arts. 19, 176 e 227–232',match:/cartorio|averba|matricula|escritura|registro|documento do terreno/i,
    guidance:'A matrícula reúne a identificação e os atos registrais do imóvel. Certidão de inteiro teor e cadastro municipal têm funções diferentes. Para entender o pedido, distinga registrar a aquisição, incluir uma construção ou corrigir informação. Não confirme propriedade ou regularidade sem exame.',questionIfNeeded:'Você quer incluir a construção no registro ou resolver outra informação do imóvel?'},
  {topic:'Exigência do cartório',source:registry,reference:'Lei 6.015/1973, art. 198',match:/exigencia|devolutiva|cartorio.{0,30}(?:pediu|solicitou)|recusou/i,
    guidance:'Uma exigência do registrador precisa ser compreendida pelo texto e pelo título apresentado. Se houver nota devolutiva, ela ajuda a identificar a pendência. Não suponha que toda pendência seja de engenharia nem prometa prazo ou aceitação.',questionIfNeeded:'O cartório te entregou por escrito o que precisa corrigir?'}
];
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function knowledgeFor(text,at=Date.now(),background=''){
  const recent=normalize(text),prior=normalize(background),mentions=[...recent.matchAll(/\b(maringa|sarandi)\b/g)];
  // Recent explicit municipality wins over the prior summary. Other cities must
  // not inherit a jurisdiction from a previous job.
  const otherCity=/\b(?:em|cidade de|municipio de) (?:londrina|pai[cç]andu|curitiba|mandaguari|maringa|sarandi)\b/g;
  const lastLocation=[...recent.matchAll(otherCity)].at(-1)?.[0];
  const city=lastLocation&&!/maringa|sarandi/.test(lastLocation)?null:mentions.at(-1)?.[1]||[...prior.matchAll(/\b(maringa|sarandi)\b/g)].at(-1)?.[1];
  const current=at>=Date.parse(checkedAt)&&at-Date.parse(checkedAt)<30*86400000;
  const subject=recent+' '+prior;
  return entries.filter(e=>(!e.city||e.city===city)&&e.match.test(subject)).slice(0,4).map(({topic,source,reference,guidance,questionIfNeeded})=>({topic,source,reference,checkedAt,current,
    guidance:current?guidance:'Referência precisa de nova conferência. Identifique a demanda sem citar regra específica ou garantir viabilidade.',
    questionIfNeeded,instruction:'Use como apoio interno para entender o serviço. Pergunte apenas se faltar e for útil ao assunto atual. Não recite lei nem envie aula ou lista ao cliente. Se a cidade ou imóvel estiver ambíguo, esclareça antes de aplicar esta referência.'}));
}
