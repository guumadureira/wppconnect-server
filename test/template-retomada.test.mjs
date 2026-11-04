import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCentral} from '../server.mjs';
import {createTemplateResumption} from '../template-retomada.mjs';

const phone='5544000000001';
const template={name:'retomar_atendimento',language:'pt_BR',status:'APPROVED',
  category:'UTILITY',components:[{type:'BODY',text:'Podemos continuar seu atendimento por aqui?'}]};
function setup(t,overrides={}){
  const config={DATABASE_PATH:':memory:',WHATSAPP_MODE:'live',WHATSAPP_PHONE_NUMBER_ID:'test-phone',
    WHATSAPP_ACCESS_TOKEN:'fake-credential',META_APP_SECRET:'test-secret',WEBHOOK_VERIFY_TOKEN:'test-verify',
    META_GRAPH_VERSION:'v25.0',WHATSAPP_BUSINESS_ACCOUNT_ID:'123456789',
    WHATSAPP_REENGAGEMENT_ENABLED:'true',WHATSAPP_REENGAGEMENT_TEMPLATE_NAME:'retomar_atendimento',
    WHATSAPP_REENGAGEMENT_TEMPLATE_LANGUAGE:'pt_BR',...overrides};
  const calls=[],responses={approved:true,throwSend:false,failSend:false,onVerify:null};
  const transport=async(url,options)=>{
    calls.push({url,options});
    if(url.includes('/message_templates?')){
      await responses.onVerify?.();
      return Response.json({data:responses.approved?[template]:[{...template,status:'PENDING'}]});
    }
    if(url.endsWith('/messages')){
      if(responses.throwSend)throw Error('network failure');
      if(responses.failSend)return Response.json({error:{code:131000}},{status:400});
      return Response.json({messages:[{id:'provider-sent-'+calls.filter(c=>c.url.endsWith('/messages')).length}]});
    }
    throw Error('Unrecognized external URL: '+url);
  };
  const app=createCentral(config,transport);
  t.after(()=>app.close());
  const start=async()=>{
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+app.server.address().port;config.PUBLIC_ORIGIN=origin;
    const request=async(path,method='GET',body,cookie)=>{
      const response=await fetch(origin+path,{method,headers:{origin,...(body?{'content-type':'application/json'}:{}),
        ...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
      return {status:response.status,body:await response.json(),
        cookie:response.headers.get('set-cookie')?.split(';')[0]};
    };
    const admin={name:'Administrador',email:'admin@example.invalid',password:'test-only-secret-password'};
    assert.equal((await request('/api/setup','POST',admin)).status,201);
    const cookie=(await request('/api/login','POST',admin)).cookie;
    app.intake({metadata:{phone_number_id:'test-phone'},messages:[{
      id:'in-1',from:phone,type:'text',timestamp:Math.floor((Date.now()-26*3600000)/1000),
      text:{body:'Me avise sobre meu projeto'},}]});
    const chat=app.db.prepare('SELECT * FROM conversations WHERE phone=?').get(phone);
    assert.ok(chat);
    return {request,cookie,chat,origin};
  };
  return {app,config,calls,responses,start};
}

test('consentimento e envio de template exigem admin, evidencia, aprovacao Meta e nao aceitam texto livre',async t=>{
  const f=setup(t),{request,cookie,chat}=await f.start();
  const path='/api/conversations/'+chat.id+'/template-resumptions';
  const consent='/api/conversations/'+chat.id+'/template-consent';
  const sendCount=()=>f.calls.filter(c=>c.url.endsWith('/messages')).length;
  assert.equal((await request('/api/template-resumption/status')).status,401);
  assert.equal((await request('/api/template-resumption/status','GET',null,cookie)).body.enabled,true);
  assert.equal((await request(path,'POST',{requestId:'resume_request_0001',confirmed:true,approvedTemplateConfirmed:true},cookie)).status,403);
  assert.equal(sendCount(),0);
  assert.equal((await request(consent,'POST',{requestId:'optin_request_0001',action:'grant',
    category:'UTILITY',source:'whatsapp',evidence:'Mensagem de opt-in registrada no historico'},cookie)).status,200);
  assert.equal((await request(consent,'GET',null,cookie)).body.consents[0].granted,true);
  const send={requestId:'resume_request_0001',confirmed:true,approvedTemplateConfirmed:true};
  assert.equal((await request(path,'POST',{...send,text:'Texto arbitrario'},cookie)).status,400);
  assert.equal((await request(path,'POST',{...send,confirmed:false},cookie)).status,400);
  f.responses.approved=false;
  assert.equal((await request(path,'POST',send,cookie)).status,409);
  f.responses.approved=true;
  const result=await request(path,'POST',send,cookie);
  assert.equal(result.status,201);
  assert.equal(result.body.resumption.state,'sent');
  assert.equal(result.body.resumption.category,'UTILITY');
  assert.equal(sendCount(),1);
  assert.equal(f.calls.find(c=>c.url.endsWith('/messages')).options.body.includes('Texto arbitrario'),false);
  const requestBody=JSON.parse(f.calls.find(c=>c.url.endsWith('/messages')).options.body);
  assert.deepEqual(requestBody,{messaging_product:'whatsapp',to:phone,type:'template',
    template:{name:'retomar_atendimento',language:{code:'pt_BR'}}});
  assert.equal((await request(path,'POST',send,cookie)).body.resumption.id,result.body.resumption.id);
  assert.equal(sendCount(),1);
  assert.equal((await request(path,'POST',{...send,requestId:'resume_request_0002'},cookie)).status,409);
  assert.equal(sendCount(),1);
  assert.equal(applyStatuses(f.app,result.body.resumption.providerId),true);
  const saved=(await request(path,'GET',null,cookie)).body.resumptions[0];
  assert.equal(saved.state,'delivered');
  assert.equal((await request(path,'POST',{...send,requestId:'resume_after_delivery'},cookie)).status,409);
  assert.equal(sendCount(),1);
  assert.equal((await request(consent,'POST',{requestId:'optout_request_0001',action:'revoke',
    category:'UTILITY',source:'whatsapp',evidence:'Cliente solicitou encerrar mensagens'},cookie)).status,200);
  assert.equal((await request(consent,'GET',null,cookie)).body.consents[0].granted,false);
  assert.equal((await request(path,'POST',{...send,requestId:'resume_request_0003'},cookie)).status,403);
  assert.equal(sendCount(),1);
});

test('resposta recebida durante consulta do template impede retomada paga desnecessaria',async t=>{
  const f=setup(t),{request,cookie,chat}=await f.start();
  await request('/api/conversations/'+chat.id+'/template-consent','POST',{
    requestId:'concurrent_optin',action:'grant',category:'UTILITY',source:'whatsapp',
    evidence:'Autorizacao de retorno registrada'},cookie);
  f.responses.onVerify=()=>f.app.intake({metadata:{phone_number_id:'test-phone'},messages:[{
    id:'concurrent-reply',from:phone,type:'text',timestamp:Math.floor(Date.now()/1000),
    text:{body:'Podemos continuar agora'}}]});
  const result=await request('/api/conversations/'+chat.id+'/template-resumptions','POST',{
    requestId:'concurrent_resume',confirmed:true,approvedTemplateConfirmed:true},cookie);
  assert.equal(result.status,409);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/messages')).length,0);
  assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM template_resumptions').get().n,0);
});

test('modelo com variavel nomeada ou consulta incompleta nao e enviado como estatico',async t=>{
  const f=setup(t),{request,cookie,chat}=await f.start();
  await request('/api/conversations/'+chat.id+'/template-consent','POST',{
    requestId:'static_only_optin',action:'grant',category:'UTILITY',source:'whatsapp',
    evidence:'Autorizacao de retorno registrada'},cookie);
  const old=template.components;
  try{
    template.components=[{type:'BODY',text:'Ola {{nome}}'}];
    const result=await request('/api/conversations/'+chat.id+'/template-resumptions','POST',{
      requestId:'static_only_resume',confirmed:true,approvedTemplateConfirmed:true},cookie);
    assert.equal(result.status,409);
    assert.equal(f.calls.filter(c=>c.url.endsWith('/messages')).length,0);
  }finally{template.components=old;}
});

function applyStatuses(app,id){
  app.intake({metadata:{phone_number_id:'test-phone'},statuses:[{id,status:'delivered'}]});
  return app.db.prepare("SELECT status FROM messages WHERE provider_id=?").get(id)?.status==='delivered';
}

test('resultado de envio desconhecido nao dispara nova tentativa e limita acesso a operador',async t=>{
  const f=setup(t),{request,cookie,chat}=await f.start();
  const consent='/api/conversations/'+chat.id+'/template-consent';
  const path='/api/conversations/'+chat.id+'/template-resumptions';
  const other={name:'Operador',email:'agent@example.invalid',password:'test-only-secret-password-2'};
  assert.equal((await request('/api/agents','POST',other,cookie)).status,201);
  const otherCookie=(await request('/api/login','POST',other)).cookie;
  assert.equal((await request(consent,'GET',null,otherCookie)).status,403);
  assert.equal((await request(path,'POST',{requestId:'resume_request_0004',confirmed:true,approvedTemplateConfirmed:true},otherCookie)).status,403);
  assert.equal((await request(consent,'POST',{requestId:'optin_request_0004',action:'grant',category:'UTILITY',
    source:'formulario',evidence:'Opt in documentado no cadastro'},cookie)).status,200);
  f.responses.throwSend=true;
  const send={requestId:'resume_request_0005',confirmed:true,approvedTemplateConfirmed:true};
  assert.equal((await request(path,'POST',send,cookie)).status,502);
  const saved=(await request(path,'GET',null,cookie)).body.resumptions[0];
  assert.equal(saved.state,'unknown');
  assert.equal((await request(path,'POST',send,cookie)).body.resumption.state,'unknown');
  assert.equal((await request(path,'POST',{...send,requestId:'resume_request_0006'},cookie)).status,409);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/messages')).length,1);
  f.app.db.prepare('UPDATE template_resumptions SET created=?').run(Date.now()-48*3600000);
  assert.equal((await request(path,'POST',{...send,requestId:'resume_after_48h_unknown'},cookie)).status,409);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/messages')).length,1);
});

test('identificador Meta repetido preserva mensagem original e deixa novo envio sob conferencia',async t=>{
  const f=setup(t),{request,cookie,chat}=await f.start();
  const old=f.app.db.prepare("SELECT id,body FROM messages WHERE direction='in'").get();
  f.app.db.prepare('UPDATE messages SET provider_id=? WHERE id=?').run('provider-sent-1',old.id);
  await request('/api/conversations/'+chat.id+'/template-consent','POST',{
    requestId:'collision_optin',action:'grant',category:'UTILITY',source:'whatsapp',
    evidence:'Autorizacao de retorno registrada'},cookie);
  const result=await request('/api/conversations/'+chat.id+'/template-resumptions','POST',{
    requestId:'collision_resume',confirmed:true,approvedTemplateConfirmed:true},cookie);
  assert.equal(result.status,502);
  assert.equal(f.app.db.prepare('SELECT body FROM messages WHERE id=?').get(old.id).body,old.body);
  assert.equal(f.app.db.prepare('SELECT state FROM template_resumptions').get().state,'unknown');
});

test('janela de 24h continua bloqueando template de retomada desnecessario',async t=>{
  const f=setup(t),{request,cookie,chat}=await f.start();
  const consent='/api/conversations/'+chat.id+'/template-consent';
  const path='/api/conversations/'+chat.id+'/template-resumptions';
  assert.equal((await request(consent,'POST',{requestId:'optin_request_0007',action:'grant',category:'UTILITY',
    source:'whatsapp',evidence:'Permissao para retorno registrada'},cookie)).status,200);
  f.app.db.prepare('UPDATE conversations SET last_inbound=? WHERE id=?').run(Date.now()-1000,chat.id);
  assert.equal((await request(path,'POST',{requestId:'resume_request_0007',confirmed:true,approvedTemplateConfirmed:true},cookie)).status,409);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/messages')).length,0);
});

test('reinicio preserva envio interrompido como incerto sem repetir transporte',async t=>{
  const f=setup(t),{request,cookie,chat}=await f.start();
  const messageId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  f.app.db.prepare("INSERT INTO messages(id,conversation_id,direction,body,status,created) VALUES(?,?,'out','[Modelo]','sending',?)")
    .run(messageId,chat.id,Date.now());
  f.app.db.prepare(`INSERT INTO template_resumptions(id,request_id,conversation_id,message_id,name,language,category,state,created,updated,actor_id)
    VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','interrupted_request',?,?,'retomar_atendimento','pt_BR','UTILITY','sending',?,?,'test-admin')`)
    .run(chat.id,messageId,Date.now(),Date.now());
  createTemplateResumption(f.app.db,f.config,async()=>{throw Error('No network on recovery');},{ready:true});
  assert.equal(f.app.db.prepare('SELECT status FROM messages WHERE id=?').get(messageId).status,'unknown');
  const saved=(await request('/api/conversations/'+chat.id+'/template-resumptions','GET',null,cookie)).body.resumptions[0];
  assert.equal(saved.state,'unknown');
  assert.equal(f.calls.length,0);
});

test('painel de retomadas exige login administrativo e envio segue desligado por padrao',async t=>{
  const f=setup(t,{WHATSAPP_REENGAGEMENT_ENABLED:'false'}),{request,cookie,origin,chat}=await f.start();
  assert.equal((await fetch(origin+'/retomadas')).status,401);
  const other={name:'Operador',email:'operator@example.invalid',password:'test-only-secret-password-5'};
  assert.equal((await request('/api/agents','POST',other,cookie)).status,201);
  const otherCookie=(await request('/api/login','POST',other)).cookie;
  assert.equal((await fetch(origin+'/retomadas',{headers:{cookie:otherCookie}})).status,403);
  const allowed=await fetch(origin+'/retomadas',{headers:{cookie}});
  assert.equal(allowed.status,200);
  const html=await allowed.text();
  assert.match(html,/Retomada de atendimento/);
  assert.match(html,/\/api\/conversations\//);
  const metaStatus=(await request('/api/template-resumption/status','GET',null,cookie)).body;
  assert.equal(metaStatus.enabled,false);
  const id=chat.id;
  assert.equal((await request('/api/conversations/'+id+'/template-resumptions','POST',{
    requestId:'resume_request_0099',confirmed:true,approvedTemplateConfirmed:true},cookie)).status,503);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/messages')).length,0);
});
