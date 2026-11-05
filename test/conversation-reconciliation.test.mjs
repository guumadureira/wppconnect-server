import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createConversationReconciliation} from '../conversation-reconciliation.mjs';
import {createCentral} from '../server.mjs';

function fixture(t,{enabled=true,kind='atendimento',clientId=null,onRequest,notionAvailable=false,refreshFailure=false,isDirectionContact=()=>false}={}){
  const db=new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE conversations(id TEXT PRIMARY KEY,phone TEXT NOT NULL,name TEXT NOT NULL);
    CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT REFERENCES conversations(id),
      direction TEXT NOT NULL,body TEXT NOT NULL,agent_name TEXT,status TEXT NOT NULL,created INTEGER NOT NULL);
    INSERT INTO conversations(id,phone,name) VALUES('c1','5544999990000','Contato de teste');`);
  const applied=[],requests=[];let counter=0;
  let state={client_id:clientId,kind,summary:'Demanda em análise',missing:'',next_step:'',version:1,snapshot:null};
  const context={
    view:()=>({...state}),
    status:()=>({enabled:notionAvailable}),
    refresh:async()=>{
      if(refreshFailure)throw Error('Notion indisponível');
      return {...state,snapshot:{client:{attendanceSummary:'Resumo documental previamente conferido',attendanceMissing:'',attendanceNext:'',attendanceAt:'2026-11-04'},sections:{works:{rows:[]}}},checked_at:Date.now()};
    },
    applyReconciliation:(id,input)=>{applied.push({id,...input});state={...state,summary:input.summary,missing:input.missing,next_step:input.nextStep,kind:input.kind,version:state.version+1};return true;}
  };
  const output={summary:'Contato respondeu e equipe confirmou que vai verificar o documento.',missing:'Conferir documento',nextStep:'Equipe deve verificar',kind:'documentos'};
  const transport=async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    const request=JSON.parse(options.body);requests.push(request);
    if(onRequest)await onRequest({db,request,insert});
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]});
  };
  const config={CONTEXT_RECONCILIATION_ENABLED:enabled?'true':'false',CONTEXT_RECONCILIATION_MONTHLY_BUDGET_USD:'1',OPENAI_API_KEY:'test-only-placeholder'};
  const worker=createConversationReconciliation(db,config,transport,context,{isDirectionContact});
  function insert(direction,body,status=direction==='in'?'received':'sent',actor=null){
    const id='msg-'+(++counter);
    db.prepare('INSERT INTO messages(id,conversation_id,direction,body,agent_name,status,created) VALUES(?,?,?,?,?,?,?)')
      .run(id,'c1',direction,body,actor,status,Date.now()+counter);
    return id;
  }
  t.after(async()=>{await worker.close();db.close();});
  return {db,worker,insert,applied,requests,context,config};
}

test('conciliação considera mensagens humanas de ambos os canais, sem enviar resposta',async t=>{
  const f=fixture(t);
  f.insert('in','Pode verificar o processo?');
  f.insert('out','*Equipe:* Vamos conferir.','sent','Equipe');
  await f.worker.process();
  assert.equal(f.requests.length,1);
  const input=JSON.parse(f.requests[0].input[0].content);
  assert.deepEqual(input.messages.map(m=>m.direction),['in','out']);
  assert.match(input.messages[1].text,/Vamos conferir/);
  assert.equal(f.applied.length,1);
  assert.equal(f.applied[0].kind,'documentos');
  assert.equal(f.worker.status().pending,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,2);
  assert.equal(f.db.prepare('SELECT state FROM context_reconciliation_jobs').get().state,'done');
});

test('mensagem nova durante a síntese invalida o resultado antigo',async t=>{
  let calls=0;
  const f=fixture(t,{onRequest:({insert})=>{if(++calls===1)insert('out','Nova resposta humana durante a análise','sent','Equipe');}});
  f.insert('in','Mensagem inicial');
  await f.worker.process();
  assert.equal(f.applied.length,0);
  assert.equal(f.db.prepare('SELECT state FROM context_reconciliation_jobs').get().state,'pending');
  await f.worker.process();
  assert.equal(f.applied.length,1);
  assert.equal(f.applied[0].cursor,2);
  assert.equal(calls,2);
});

test('envio manual sem confirmação bloqueia síntese até status seguro',async t=>{
  const f=fixture(t);
  const id=f.insert('out','Resposta pelo painel','unknown','Equipe');
  await f.worker.process();
  assert.equal(f.requests.length,0);
  assert.equal(f.applied.length,0);
  assert.equal(f.db.prepare('SELECT state FROM context_reconciliation_jobs').get().state,'retry');
  f.db.prepare("UPDATE messages SET status='sent' WHERE id=?").run(id);
  f.db.prepare('UPDATE context_reconciliation_jobs SET next_attempt=0').run();
  await f.worker.process();
  assert.equal(f.applied.length,1);
});

test('classificação comercial e contatos internos não alteram cadastro de cliente',async t=>{
  const commercial=fixture(t,{kind:'comercial'});
  commercial.insert('in','Apresentação comercial');
  await commercial.worker.process();
  assert.equal(commercial.requests.length,0);
  assert.equal(commercial.applied.length,0);
  assert.equal(commercial.db.prepare('SELECT state FROM context_reconciliation_jobs').get().state,'excluded');
  const internal=fixture(t,{isDirectionContact:()=>true});
  internal.insert('in','Conversa interna');
  await internal.worker.process();
  assert.equal(internal.applied.length,0);
  assert.equal(internal.db.prepare('SELECT state FROM context_reconciliation_jobs').get().state,'excluded');
});

test('falha no contexto Notion adia sem sobrescrever dados e configuração inicia desligada',async t=>{
  const unavailable=fixture(t,{clientId:'aaa',notionAvailable:true,refreshFailure:true});
  unavailable.insert('in','Dado novo');
  await unavailable.worker.process();
  assert.equal(unavailable.applied.length,0);
  assert.equal(unavailable.requests.length,0);
  assert.equal(unavailable.db.prepare('SELECT state FROM context_reconciliation_jobs').get().state,'retry');
  const disabled=fixture(t,{enabled:false});
  disabled.insert('in','Dado novo');
  await disabled.worker.process();
  assert.equal(disabled.requests.length,0);
  assert.equal(disabled.worker.status().enabled,false);
});

test('contexto local rejeita cursor antigo e registra uma única conciliação qualificada',async t=>{
  const app=createCentral({DATABASE_PATH:':memory:',WHATSAPP_MODE:'demo',WHATSAPP_PHONE_NUMBER_ID:'test-phone'});
  t.after(()=>app.close());
  app.intake({metadata:{phone_number_id:'test-phone'},messages:[{id:'in-1',from:'5544999990000',type:'text',text:{body:'Quero um orçamento'}}]});
  const conversation=app.db.prepare('SELECT id FROM conversations LIMIT 1').get();
  const ctx=app.customerContext.view(conversation.id);
  const cursor=app.db.prepare('SELECT MAX(rowid) AS n FROM messages WHERE conversation_id=?').get(conversation.id).n;
  const input={cursor,version:ctx.version,summary:'Pedido inicial de orçamento',missing:'Projeto',nextStep:'Solicitar projeto',kind:'orcamento'};
  assert.equal(app.customerContext.applyReconciliation(conversation.id,input),true);
  assert.equal(app.customerContext.applyReconciliation(conversation.id,input),false);
  assert.equal(app.customerContext.view(conversation.id).summary,'Pedido inicial de orçamento');
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM service_events WHERE event_key LIKE 'reconcile:%'").get().n,1);
  app.intake({metadata:{phone_number_id:'test-phone'},messages:[{id:'in-2',from:'5544999990000',type:'text',text:{body:'Também preciso de regularização'}}]});
  const refreshed=app.customerContext.view(conversation.id);
  assert.equal(app.customerContext.applyReconciliation(conversation.id,{...input,version:refreshed.version}),false);
});
