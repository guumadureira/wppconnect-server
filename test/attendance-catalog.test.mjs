import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serviceGuidesFor} from '../attendance-catalog.mjs';
test('expressao leiga sobre documento do terreno identifica necessidade sem prometer resultado',()=>{
  const guides=serviceGuidesFor({latest:'Quero colocar minha casa no documento do terreno'});
  assert.ok(guides.some(g=>g.subject.includes('averbacao')));
  assert.ok(guides.every(g=>g.boundary.includes('Nao')));
});
test('manutencao de cliente antigo recebe contexto de assistencia',()=>{
  const guides=serviceGuidesFor({latest:'Aquela infiltracao voltou na parede da sala',summary:'Serviço anterior de impermeabilização'});
  assert.ok(guides.some(g=>g.subject.includes('Manutencao')));
});
test('contatos sem demanda de engenharia nao recebem perguntas tecnicas',()=>{
  for(const latest of ['Oi, procuro emprego','Gostaria de apresentar meu curriculo','Boa tarde!','Quero falar sobre uma vaga']){
    assert.deepEqual(serviceGuidesFor({latest}),[]);
  }
});
test('o catalogo limita quantidade de sugestoes e nao exige checklist',()=>{
  const guides=serviceGuidesFor({latest:'Quero reformar a casa e regularizar a obra com projeto estrutural e matrícula'});
  assert.ok(guides.length<=2);
  assert.ok(guides.every(g=>g.instruction.includes('nunca transforme')));
});
test('preferencia da mensagem atual supera tema residual do resumo',()=>{
  const guides=serviceGuidesFor({latest:'A infiltracao voltou e a parede esta molhada',summary:'Cliente tinha projeto arquitetonico'});
  assert.equal(guides[0].subject,'Manutencao, reparo e retorno sobre servico anterior');
});
