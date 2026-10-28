import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attendanceTurn,removeRepeatedGreeting} from '../attendance-turn.mjs';

test('continuidade usa dia local e última resposta da equipe, sem reiniciar a cada mensagem',()=>{
  const prior={id:'team',direction:'out',body:'Em qual cidade fica a casa?',arrival:10,created:Date.parse('2026-10-28T13:00:00Z')};
  const history=[prior,{id:'city',direction:'in',body:'Sarandi',arrival:11},{id:'detail',direction:'in',body:'A casa já está pronta',arrival:12}];
  const turn=attendanceTurn(history,prior,Date.parse('2026-10-28T14:00:00Z'));
  assert.equal(turn.phase,'continuation');assert.equal(turn.greetingAllowed,false);
  assert.deepEqual(turn.unansweredMessageIds,['city','detail']);assert.equal(turn.previousReply.text,prior.body);
  assert.equal(turn.latestMessageId,'detail');
  assert.equal(attendanceTurn(history,null,prior.created).phase,'opening');
  assert.equal(attendanceTurn(history,prior,Date.parse('2026-10-29T14:00:00Z')).phase,'resumption');
  // UTC midnight is still the same day in São Paulo.
  const evening={...prior,created:Date.parse('2026-10-28T23:55:00Z')};
  assert.equal(attendanceTurn(history,evening,Date.parse('2026-10-29T00:05:00Z')).greetingAllowed,false);
});

test('remove apenas saudação redundante e preserva pergunta, orientação ou pausa',()=>{
  const turn={greetingAllowed:false};
  assert.equal(removeRepeatedGreeting('Bom dia! Você já tem o terreno?',turn),'Você já tem o terreno?');
  assert.equal(removeRepeatedGreeting('Olá, bom dia! Pode mandar quando encontrar.',turn),'Pode mandar quando encontrar.');
  assert.equal(removeRepeatedGreeting('Boa tarde! A matrícula é o registro do imóvel no cartório.',turn),'A matrícula é o registro do imóvel no cartório.');
  for(const text of ['Combinado!','Bom dia!','O cliente disse “bom dia”.','Bom dia seria um nome de arquivo.','“Bom dia!” é a mensagem que recebi.'])assert.equal(removeRepeatedGreeting(text,turn),text);
  assert.equal(removeRepeatedGreeting('Bom dia! Como posso ajudar?',{greetingAllowed:true}),'Bom dia! Como posso ajudar?');
});
