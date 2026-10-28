import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {createOperatorChat} from '../operator-chat.mjs';
const agent='11111111-1111-4111-8111-111111111111',user={id:'u1',name:'Operador',signatureName:'Gustavo'},other={id:'u2',name:'Outro'};
function fixture(t,extra={}){
  const db=new DatabaseSync(':memory:'),calls=[],remote=new Map(),config={NOTION_OPERATOR_CHAT_ENABLED:'true',NOTION_OPERATOR_AGENT_ID:agent,NOTION_TOKEN:'test-notion-secret',...extra};
  const state={fail:false,actions:false,events:[],pageMore:false};
  const transport=async(url,o)=>{
    assert.ok(url.startsWith('https://api.notion.com/v1/'));assert.equal(o.headers.authorization,'Bearer test-notion-secret');calls.push({url,body:o.body?JSON.parse(o.body):null});
    if(state.fail)throw Error('test-notion-secret private error');
    if(url.endsWith('/agents/'+agent))return Response.json({id:agent,name:'Propostas de teste',status:'active'});
    if(url.endsWith('/sessions')){
      const body=JSON.parse(o.body),id=body.session_id||randomUUID(),s={id,agent_id:agent,status:state.actions?'requires_action':'queued',required_actions:state.actions?[{action_id:'22222222-2222-4222-8222-222222222222',title:'Salvar minuta para revisão',options:[{id:'approve',label:'Aprovar'},{id:'reject',label:'Recusar'}]}]:[]};remote.set(id,s);return Response.json(s);
    }
    if(url.endsWith('/events/query')){assert.equal(JSON.parse(o.body).sorts[0].direction,'ascending');const sessionId=url.split('/').at(-3);return Response.json({results:state.events.map(e=>({...e,session_id:sessionId})),has_more:state.pageMore});}
    const id=url.split('/').at(-1);return Response.json({...remote.get(id),status:state.actions?'requires_action':'completed'});
  };
  const chat=createOperatorChat(db,config,transport);t.after(async()=>{await chat.close();db.close();});return{db,calls,state,config,chat};
}
test('chat usa agente real do Notion e histórico é separado por conta e assinatura',async t=>{
  const f=fixture(t),requestId=randomUUID(),body={message:'Prepare uma proposta para revisão',requestId};
  const c=await f.chat.send(user,body);assert.equal(c.state,'queued');assert.equal(c.messages.length,1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.agent_id,agent);
  assert.equal(f.chat.list(user).chats.length,1);assert.equal(f.chat.list(other).chats.length,0);assert.equal(f.chat.list({...user,signatureName:'Outra pessoa'}).chats.length,0);
  assert.throws(()=>f.chat.view(other,c.id),{status:404});assert.throws(()=>f.chat.view({...user,signatureName:'Outra pessoa'},c.id),{status:404});
  const repeat=await f.chat.send(user,body);assert.equal(repeat.id,c.id);assert.equal(f.calls.length,1);
  f.state.events=[{id:randomUUID(),type:'agent.message',sequence:2,content:[{type:'text',text:'Minuta disponível no Notion para sua revisão.'}]}];
  const read=await f.chat.refresh(user,c.id);assert.equal(read.state,'completed');assert.equal(read.messages.length,2);assert.equal(read.canSend,true);
  await f.chat.refresh(user,c.id);assert.equal(f.chat.view(user,c.id).messages.length,2);
  assert.ok(!JSON.stringify(read).includes('test-notion-secret'));
});
test('resultado incerto não é repetido automaticamente e chave não aparece no erro',async t=>{
  const f=fixture(t),body={message:'Preparar documento',requestId:randomUUID()};f.state.fail=true;
  const c=await f.chat.send(user,body);assert.equal(c.state,'unknown');assert.ok(!JSON.stringify(c).includes('test-notion-secret'));
  await f.chat.send(user,body);assert.equal(f.calls.length,1);
  await assert.rejects(f.chat.send(user,{chatId:c.id,message:'Repita',requestId:randomUUID()}),{status:409});assert.equal(f.calls.length,1);
});
test('ações exigem decisão explícita da prévia atual e não são aprovadas pelo texto do agente',async t=>{
  const f=fixture(t);f.state.actions=true;const c=await f.chat.send(user,{message:'Preparar minuta',requestId:randomUUID()});
  assert.equal(c.state,'requires_action');assert.equal(f.calls.length,1);
  const body={chatId:c.id,actionId:c.actions[0].id,option:'approve',reviewDigest:c.reviewDigest,requestId:randomUUID()};
  await assert.rejects(f.chat.action(user,body),{status:409});assert.equal(f.calls.length,1);
  await assert.rejects(f.chat.action(other,{...body,confirmed:true}),{status:404});
  await assert.rejects(f.chat.action(user,{...body,confirmed:true,reviewDigest:'stale'}),{status:409});
  const sent=await f.chat.action(user,{...body,confirmed:true});assert.equal(sent.id,c.id);assert.equal(f.calls.length,2);assert.equal(f.calls[1].body.actions[0].option_id,'approve');
});
test('desativado não chama API e diagnóstico de acesso não executa o agente',async t=>{
  const f=fixture(t,{NOTION_OPERATOR_CHAT_ENABLED:'false'});assert.equal(f.chat.status().enabled,false);await assert.rejects(f.chat.send(user,{message:'Oi',requestId:randomUUID()}),{status:503});assert.equal(f.calls.length,0);
  const v=await f.chat.verify();assert.equal(v.verified,true);assert.equal(v.enabled,false);assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.includes('/agents/'));
});
test('reinício preserva conversa e marca solicitação em voo como incerta',async t=>{
  const f=fixture(t),c=await f.chat.send(user,{message:'Rascunho',requestId:randomUUID()});
  f.db.prepare("UPDATE operator_chats SET state='sending'").run();const next=createOperatorChat(f.db,f.config,()=>{throw Error('No retry');});
  assert.equal(next.view(user,c.id).state,'unknown');assert.equal(f.calls.length,1);
});
