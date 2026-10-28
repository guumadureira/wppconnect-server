import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCentral} from '../server.mjs';
import {createOperatorContext} from '../operator-context.mjs';

test('contexto interno usa projeção limitada, exclui campos privados e sinaliza falhas',async t=>{
  const app=createCentral({DATABASE_PATH:':memory:'});t.after(()=>app.close());
  const id='11111111-1111-4111-8111-111111111111';
  app.db.prepare('INSERT INTO conversations(id,name,phone,updated) VALUES(?,?,?,?)').run(id,'Cliente fictício','5544000000001',Date.now());
  const ctx={client_id:'client',client_name:'Cliente fictício',clientUrl:'https://notion.so/client',summary:'Resumo',missing:'Documento',next_step:'Solicitar',history:[],snapshot:{client:{cpf:'SECRET'},sections:{works:{configured:true,complete:true,rows:[{id:'work',title:'Projeto',status:'Em andamento',cpf:'SECRET',url:'https://notion.so/work'}]}}}};
  const context={view:()=>ctx,status:()=>({enabled:true}),refresh:async()=>{},resolveBeforeReply:async()=>{throw Error('Should not look up linked client');}};
  const read=createOperatorContext(app.db,context),result=await read(id);
  assert.equal(result.sections.works.records[0].title,'Projeto');assert.ok(!JSON.stringify(result).includes('SECRET'));
  context.refresh=async()=>{throw Error('private error');};
  const unavailable=await read(id);assert.ok(unavailable.warning);assert.deepEqual(unavailable.sections,{});
  await assert.rejects(read('missing'),{status:404});
});
