import {test} from 'node:test';
import assert from 'node:assert/strict';
import {knowledgeFor} from '../attendance-knowledge.mjs';
const now=Date.parse('2026-10-28T12:00:00Z');
test('referências seguem o município atual sem misturar a obra anterior',()=>{
  const current=knowledgeFor('Agora é uma casa em Sarandi, preciso do habite-se',now,'Projeto anterior em Maringá');
  assert.ok(current.some(x=>x.topic.includes('Sarandi')));assert.ok(current.every(x=>!x.topic.includes('Maringá')));
  assert.ok(knowledgeFor('Outra obra em Londrina',now,'Casa em Maringá').every(x=>!x.topic.includes('Maringá')));
});
test('contexto preserva referência após resposta curta sem inventar município',()=>{
  assert.ok(knowledgeFor('Já está pronta',now,'Regularização de casa em Sarandi').some(x=>x.topic.includes('Sarandi')));
  assert.ok(knowledgeFor('Quero regularizar a casa',now).every(x=>!x.topic.includes('Sarandi')&&!x.topic.includes('Maringá')));
  const registry=knowledgeFor('O cartório pediu uma correção na matrícula',now);
  assert.ok(registry.some(x=>x.topic==='Exigência do cartório'));
});
test('referência vencida pede conferência e não oferece regra específica como atual',()=>{
  const old=knowledgeFor('Projeto em Maringá',Date.parse('2027-01-01'));
  assert.ok(old.length>0);assert.ok(old.every(x=>!x.current&&x.guidance.includes('nova conferência')));
});
