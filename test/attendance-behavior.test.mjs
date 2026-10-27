import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attendanceInstructions} from '../ai-attendance-guide.mjs';
import {simulateAttendance} from '../ai-attendance.mjs';

test('atendimento se apresenta como integrante da Domum sem prometer encaminhamento externo',()=>{
  assert.match(attendanceInstructions,/Você integra o atendimento da Domum/);
  assert.match(attendanceInstructions,/Não diga ao contato/);
  const demo=simulateAttendance('Preciso falar com o Gustavo');
  assert.equal(demo.handoff,true);
  assert.equal(demo.reply,'Vamos verificar sua solicitação.');
});
test('atendimento reconhece linguagem leiga e perguntas adaptativas',()=>{
  assert.match(attendanceInstructions,/Muitos contatos não sabem nomes técnicos/);
  assert.match(attendanceInstructions,/Escolha a próxima pergunta pelo contexto mais útil/);
  assert.match(attendanceInstructions,/não pela ordem de um formulário/);
});
test('clientes recorrentes exigem vínculo ao trabalho correto e não presumem garantia',()=>{
  assert.match(attendanceInstructions,/Quando a pessoa mencionar serviço passado/);
  assert.match(attendanceInstructions,/não presuma que o problema atual é igual ao anterior/);
  assert.match(attendanceInstructions,/Nunca una duas obras/);
});
test('candidatos a emprego e contatos diversos não viram oportunidades de engenharia',()=>{
  assert.match(attendanceInstructions,/procura emprego/);
  assert.match(attendanceInstructions,/intake.ready=false, supplier=null/);
  assert.match(attendanceInstructions,/não afirme que existe seleção aberta/);
});
test('falhas e correções não alteram regras globais sem revisão',()=>{
  assert.match(attendanceInstructions,/sinal de possível falha/);
  assert.match(attendanceInstructions,/não pode editar suas próprias instruções/);
  assert.match(attendanceInstructions,/não crie uma certeza só porque apareceu repetida/);
});
