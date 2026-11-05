import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createConversationReconciliation} from '../conversation-reconciliation.mjs';
import {createCentral} from '../server.mjs';

function fixture(t,{enabled=true,kind='atendimento',clientId=null,onRequest,notionAvailable=false,notionSummaryAvailable=notionAvailable,refreshFailure=false,isDirectionContact=()=>false}={}){
  const db=new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE conversations(id TEXT PRIMARY KEY,phone TEXT NOT NULL,name TEXT NOT NULL);
    CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT REFERENCES conversations(id),
      direction TEXT NOT NULL,body TEXT NOT NULL,agent_name TEXT,status TEXT NOT NULL,created INTEGER NOT NULL);
    INSERT INTO conversations(id,phone,name) VALUES('c1','5544999990000','Contato de teste');
    CREATE TABLE conversation_context(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),kind TEXT NOT NULL DEFAULT 'atendimento');
    INSERT INTO conversation_context(conversation_id,kind) VALUES('c1','atendimento');`);
  const applied=[],requests=[];let counter=0;
  let state={client_id:clientId,kind,summary:'Demanda em análise',missing:'',next_step:'',version:1,snapshot:null};
  const context={
    view:()=>({...state}),
    status:()=>({enabled:notionAvailable,summaryEnabled:notionSummaryAvailable}),
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
  db.prepare('UPDATE conversation_context SET kind=? WHERE conversation_id=\'c1\'').run(kind);
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

test('prévia histórica é somente leitura e recuperação confirmada não duplica trabalho',async t=>{
  const f=fixture(t);
  const id=f.insert('in','Mensagem antiga');
  // Simulate messages inserted before the trigger existed.
  f.db.prepare('DELETE FROM context_reconciliation_jobs').run();
  const before=f.db.prepare('SELECT COUNT(*) AS n FROM context_reconciliation_jobs').get().n;
  assert.equal(before,0);
  const preview=f.worker.backfill({limit:50});
  assert.equal(preview.confirmed,false);
  assert.equal(preview.eligible,1);
  assert.equal(preview.enqueued,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM context_reconciliation_jobs').get().n,0);
  assert.equal(f.worker.backfill({confirmed:true,limit:50}).enqueued,1);
  assert.equal(f.worker.backfill({confirmed:true,limit:50}).enqueued,0);
  await f.worker.process();
  assert.equal(f.requests.length,1);
  assert.equal(f.worker.backfill({confirmed:false}).unchanged,1);
});

test('confirmação posterior de envio reabre a fila sem esperar o intervalo anterior',async t=>{
  const f=fixture(t);
  const id=f.insert('out','Enviado pelo aplicativo','unknown','Gustavo');
  await f.worker.process();
  assert.equal(f.requests.length,0);
  const delayed=f.db.prepare('SELECT next_attempt AS n FROM context_reconciliation_jobs').get().n;
  assert.ok(delayed>Date.now());
  f.db.prepare("UPDATE messages SET status='sent' WHERE id=?").run(id);
  assert.equal(f.db.prepare('SELECT state FROM context_reconciliation_jobs').get().state,'pending');
  assert.equal(f.db.prepare('SELECT next_attempt AS n FROM context_reconciliation_jobs').get().n,0);
  await f.worker.process();
  assert.equal(f.applied.length,1);
});

test('a prévia histórica exclui contatos comerciais sem criar novo cliente',async t=>{
  const f=fixture(t,{kind:'comercial'});
  f.insert('in','Oferta comercial antiga');
  f.db.prepare('DELETE FROM context_reconciliation_jobs').run();
  const preview=f.worker.backfill({confirmed:false,limit:50});
  assert.equal(preview.eligible,0);
  assert.equal(preview.excluded,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM context_reconciliation_jobs').get().n,0);
});

test('nova mensagem é conciliada apesar de envio antigo desconhecido',async t=>{
  const f=fixture(t);
  f.insert('out','Mensagem cujo envio não está confirmado','unknown','Equipe');
  f.insert('in','Quero acrescentar informação sobre meu projeto');
  await f.worker.process();
  assert.equal(f.applied.length,1);
  assert.equal(f.requests.length,1);
  const input=JSON.parse(f.requests[0].input[0].content);
  assert.equal(input.unconfirmedOutboundCount,1);
  assert.equal(input.messages.length,1);
  assert.equal(input.messages[0].direction,'in');
  assert.equal(JSON.stringify(input.messages).includes('cujo envio não está confirmado'),false);
});

test('Notion desabilitado bloqueia atualização de cliente vinculado',async t=>{
  const f=fixture(t,{clientId:'aaa',notionAvailable:false});
  f.insert('in','Solicito nova etapa contratual');
  await f.worker.process();
  assert.equal(f.requests.length,0);
  assert.equal(f.applied.length,0);
  const row=f.db.prepare('SELECT state,error FROM context_reconciliation_jobs').get();
  assert.equal(row.state,'retry');
  assert.match(row.error,/Integração e resumo/);
});

test('confirmação de envio durante síntese invalida resposta antiga mesmo sem novo rowid',async t=>{
  let requests=0;
  const f=fixture(t,{onRequest:({db})=>{
    if(++requests===1){
      db.prepare("UPDATE messages SET status='sent' WHERE id=?").run('msg-2');
    }
  }});
  f.insert('in','Preciso de uma atualização do processo');
  f.insert('out','*Equipe:* Vou avaliar e retorno.','unknown','Equipe');
  const cursor=f.db.prepare('SELECT cursor FROM context_reconciliation_jobs').get().cursor;
  await f.worker.process();
  assert.equal(f.applied.length,0);
  const pending=f.db.prepare('SELECT cursor,state,generation FROM context_reconciliation_jobs').get();
  assert.equal(pending.cursor,cursor);
  assert.equal(pending.state,'pending');
  assert.ok(pending.generation>0);
  await f.worker.process();
  assert.equal(f.applied.length,1);
  const messages=JSON.parse(f.requests.at(-1).input[0].content).messages;
  assert.equal(messages.length,2);
  assert.match(messages[1].text,/Vou avaliar/);
});

test('resumo desabilitado no Notion impede perda de sincronização do cliente vinculado',async t=>{
  const f=fixture(t,{clientId:'aaa',notionAvailable:true,notionSummaryAvailable:false});
  f.insert('in','Solicito informação de orçamento');
  await f.worker.process();
  assert.equal(f.requests.length,0);
  assert.equal(f.applied.length,0);
  assert.equal(f.db.prepare('SELECT state FROM context_reconciliation_jobs').get().state,'retry');
});

test('recuperação histórica exige sessão de administrador e confirmação explícita',async t=>{
  const config={DATABASE_PATH:':memory:',WHATSAPP_MODE:'demo',WHATSAPP_PHONE_NUMBER_ID:'test-phone'};
  const app=createCentral(config);
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const origin='http://127.0.0.1:'+app.server.address().port;
  config.PUBLIC_ORIGIN=origin;
  async function call(path,method='GET',body,cookie){
    const response=await fetch(origin+path,{method,
      headers:{origin,...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
      body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  assert.equal((await call('/api/context/reconciliation/backfill')).status,401);
  const admin={name:'Admin',email:'admin@example.invalid',password:'test-only-password-1234'};
  assert.equal((await call('/api/setup','POST',admin)).status,201);
  const session=await call('/api/login','POST',admin);
  assert.equal(session.status,200);
  const adminCookie=session.cookie;
  assert.equal((await call('/api/context/reconciliation/backfill?limit=100','GET',null,adminCookie)).status,200);
  assert.equal((await call('/api/context/reconciliation/backfill?limit=999','GET',null,adminCookie)).status,400);
  assert.equal((await call('/api/context/reconciliation/backfill','POST',{confirmed:false},adminCookie)).status,400);
  assert.equal((await call('/api/context/reconciliation/backfill','POST',{confirmed:true},adminCookie)).status,409);
  const agent={name:'Atendente',email:'agent@example.invalid',password:'test-only-password-9876'};
  assert.equal((await call('/api/agents','POST',agent,adminCookie)).status,201);
  const agentCookie=(await call('/api/login','POST',agent)).cookie;
  assert.equal((await call('/api/context/reconciliation/status','GET',null,agentCookie)).status,403);
  assert.equal((await call('/api/context/reconciliation/backfill','GET',null,agentCookie)).status,403);
});
