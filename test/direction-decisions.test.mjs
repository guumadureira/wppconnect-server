import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCentral} from '../server.mjs';

const phone='5544000000001';
const directorEmail='director@example.invalid';
const configBase={DATABASE_PATH:':memory:',WHATSAPP_MODE:'demo',WHATSAPP_PHONE_NUMBER_ID:'test-phone',
  DIRECTION_ESCALATION_ENABLED:'true',DIRECTION_APPROVER_EMAIL:directorEmail};

test('fila exige sessao do administrador autorizado, guarda decisao e nao envia WhatsApp',async t=>{
  const calls=[],config={...configBase};
  const app=createCentral(config,async url=>{calls.push(url);throw Error('No external access during tests');});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.server.address().port;config.PUBLIC_ORIGIN=origin;
  t.after(()=>app.close());
  async function request(path,method='GET',body,cookie){
    const res=await fetch(origin+path,{method,headers:{origin,...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
      body:body?JSON.stringify(body):undefined});
    return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  const admin={name:'Diretor',email:directorEmail,password:'test-password-123456'};
  assert.equal((await request('/api/setup','POST',admin)).status,201);
  const cookie=(await request('/api/login','POST',admin)).cookie;
  const other={name:'Atendente',email:'operator@example.invalid',password:'test-password-654321'};
  assert.equal((await request('/api/agents','POST',other,cookie)).status,201);
  const otherCookie=(await request('/api/login','POST',other)).cookie;
  app.intake({metadata:{phone_number_id:'test-phone'},messages:[{id:'fake-in-1',from:phone,
    type:'text',text:{body:'Preciso de aprovacao de alteracao'},timestamp:Math.floor(Date.now()/1000)}]});
  const conversation=app.db.prepare('SELECT id FROM conversations WHERE phone=?').get(phone);
  const endpoint='/api/direction/decisions';
  const payload={conversationId:conversation.id,requestId:'decision_request_0001',category:'tecnica',
    question:'Aprovar a mudanca do projeto?',basis:'Cliente solicitou alterar o projeto; decisao ainda sem aprovacao.'};
  assert.equal((await request(endpoint)).status,401);
  assert.equal((await request(endpoint,'GET',null,otherCookie)).status,403);
  assert.equal((await request(endpoint,'POST',payload,otherCookie)).status,403);
  const first=await request(endpoint,'POST',payload,cookie);
  assert.equal(first.status,201);assert.equal(first.body.decision.category,'tecnica');
  assert.equal(first.body.decision.status,'pending');
  const id=first.body.decision.id;
  const duplicate=await request(endpoint,'POST',payload,cookie);
  assert.equal(duplicate.body.decision.id,id);
  assert.equal((await request(endpoint,'POST',{...payload,question:'Outra pergunta'},cookie)).status,409);
  assert.equal((await request(endpoint+'?status=pending','GET',null,cookie)).body.decisions.length,1);
  assert.equal((await request(endpoint+'/'+id,'GET',null,cookie)).body.decision.id,id);
  assert.equal((await request(endpoint+'/'+id,'GET',null,otherCookie)).status,403);
  const incomplete={action:'answer',answer:'Aprovar apos revisao tecnica.',requestId:'confirm_0001',version:0};
  assert.equal((await request(endpoint+'/'+id,'PATCH',incomplete,cookie)).status,400);
  const answer={...incomplete,confirmed:true};
  const answered=await request(endpoint+'/'+id,'PATCH',answer,cookie);
  assert.equal(answered.status,200);assert.equal(answered.body.decision.status,'answered');
  assert.equal(answered.body.decision.version,1);
  assert.equal((await request(endpoint+'/'+id,'PATCH',answer,cookie)).status,200);
  assert.equal((await request(endpoint+'/'+id,'PATCH',{...answer,answer:'Resposta diferente'},cookie)).status,409);
  assert.equal((await request(endpoint+'/'+id,'PATCH',{...answer,requestId:'confirm_0002'},cookie)).status,409);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM direction_decisions').get().n,1);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM direction_decision_audit').get().n,1);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='out'").get().n,0);
  assert.deepEqual(calls,[]);
  config.DIRECTION_ESCALATION_ENABLED='false';
  assert.equal((await request(endpoint,'GET',null,cookie)).status,503);
});

test('a IA somente registra decisao explicita e nao avisa diretor ou cliente sem aprovacao',async t=>{
  const config={...configBase,WHATSAPP_MODE:'live',WHATSAPP_ACCESS_TOKEN:'test-meta',
    META_APP_SECRET:'test-secret',WEBHOOK_VERIFY_TOKEN:'test-verify',META_GRAPH_VERSION:'v25.0',
    AI_ENABLED:'true',OPENAI_API_KEY:'test-openai',AI_ALLOWED_PHONES:phone,AI_MONTHLY_BUDGET_USD:'5'};
  const result={reply:'Precisamos conferir a alteracao antes de confirmar.',summary:'Pedido de alteracao de projeto.',
    missing:'Aprovacao tecnica',nextStep:'Direcao avaliar proposta de mudanca',kind:'alteracao',
    handoff:true,reason:'Depende de aprovacao tecnica.',intake:{ready:false,name:'',city:'',service:'',
    nameMessageId:'',cityMessageId:'',serviceMessageId:''},supplier:null,
    directorDecision:{required:true,category:'tecnica',question:'Autorizar a alteracao solicitada no projeto?',
      basis:'Cliente pediu alteracao; sem autorizacao nem revisao tecnica registrada.'}};
  const calls=[];
  const transport=async(url,options)=>{
    calls.push(url);
    if(url.includes('api.openai.com'))return Response.json({status:'completed',
      usage:{input_tokens:600,output_tokens:150},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
    if(url.includes('graph.facebook.com'))return Response.json({messages:[{id:'fake-out-1'}]});
    throw Error('Unexpected network request');
  };
  const app=createCentral(config,transport,{aiDebounceMs:0,notionRequestIntervalMs:0});
  t.after(()=>app.close());
  app.intake({metadata:{phone_number_id:'test-phone'},messages:[{id:'fake-in-1',from:phone,
    type:'text',text:{body:'Preciso alterar a estrutura do projeto; posso seguir?'},timestamp:Math.floor(Date.now()/1000)}]});
  await app.ai.process();
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM direction_decisions').get().n,1);
  const row=app.db.prepare('SELECT * FROM direction_decisions').get();
  assert.equal(row.category,'tecnica');assert.equal(row.origin,'ia');assert.equal(row.status,'pending');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM direction_decision_audit').get().n,0);
  assert.equal(app.customerContext.view(row.conversation_id).mode,'human');
  assert.equal(calls.filter(x=>x.includes('graph.facebook.com')).length,1);
  assert.equal(calls.filter(x=>x.includes('api.openai.com')).length,1);
  await app.ai.process();
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM direction_decisions').get().n,1);
});
