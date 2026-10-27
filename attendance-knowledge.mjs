// Brief process guidance checked against official sources. No property-specific legal opinion.
const checkedAt='2026-10-27';
const entries=[
  {topic:'Maringá',match:/maring[aá]/i,source:'https://sapl.cmm.pr.gov.br/ta/130/text',guidance:'A ficha técnica do lote informa os parâmetros urbanísticos daquele imóvel. Para orientar um projeto, primeiro identifique o imóvel e a finalidade da obra. Não informe recuo, altura, ocupação ou viabilidade sem consulta específica e atual.'},
  {topic:'Sarandi',match:/sarandi/i,source:'https://sapl.sarandi.pr.leg.br/ta/1422/text',guidance:'O Código de Obras trata de projetos, licenciamento e execução. A análise também depende do uso e ocupação do solo e do imóvel. Não use regra de Maringá em Sarandi, nem prometa aprovação ou regularização apenas com o relato.'},
  {topic:'Registro de imóveis',match:/cart[oó]rio|averba|matr[ií]cula|escritura|registro do im[oó]vel/i,source:'https://www.planalto.gov.br/ccivil_03/leis/l6015compilada.htm',guidance:'Registro e averbação são atos do Registro de Imóveis; matrícula identifica o imóvel e seus registros. Licenciamento municipal e situação registral são conferências diferentes. Identifique se a dúvida é sobre obra/prefeitura ou matrícula/cartório. Não forneça lista universal de documentos, taxas, prazo ou garantia de averbação. Exigências e exceções precisam ser conferidas para o caso.'}
];
export function knowledgeFor(text,at=Date.now()){
  if(!/prefeitura|lei\b|legal|regulariz|recuo|alvar[aá]|cart[oó]rio|averba|matr[ií]cula|escritura|document|licen|constru|terreno/i.test(text))return [];
  const current=at>=Date.parse(checkedAt)&&at-Date.parse(checkedAt)<30*86400000;
  return entries.filter(e=>e.match.test(text)).map(({topic,source,guidance})=>({topic,source,checkedAt,current,guidance:current?guidance:'Referência precisa de nova conferência. Não cite regra específica; ajude a identificar a necessidade e o imóvel para a equipe consultar.'}));
}
