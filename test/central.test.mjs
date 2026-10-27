import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createCentral } from '../server.mjs';

test('contas, assinaturas, recebimento e controle de pendências', async t => {
  let sendMode='ok',sendCount=0,lastPayload,lastAlert;
  const config={DATABASE_PATH:':memory:',WHATSAPP_MODE:'live',WHATSAPP_PHONE_NUMBER_ID:'test-phone',WHATSAPP_ACCESS_TOKEN:'test-only-placeholder',META_APP_SECRET:'test-only-secret',WEBHOOK_VERIFY_TOKEN:'test-only-verify',META_GRAPH_VERSION:'v25.0'};
  const app=createCentral(config,async(url,options)=>{
    if(url==='https://alerts.invalid/events'){lastAlert=JSON.parse(options.body);return new Response('{}');}
    sendCount++;lastPayload=JSON.parse(options.body);
    if(sendMode==='timeout')throw new Error('simulated network timeout');
    if(sendMode==='concurrent')app.intake({metadata:{phone_number_id:'test-phone'},messages:[{id:'in-concurrent',from:'5511999990000',timestamp:Math.floor(Date.now()/1000),type:'text',text:{body:'Nova dúvida durante o envio'}}]});
    return new Response(JSON.stringify(sendMode==='fail'?{error:{code:131000}}:{messages:[{id:'out-'+sendCount}]}),{status:sendMode==='fail'?400:200});
  });
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.server.address().port;config.PUBLIC_ORIGIN=origin;
  t.after(()=>app.close());
  async function request(path,method='GET',body,cookie,customHeaders={}) {
    const r=await fetch(origin+path,{method,headers:{origin,...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...customHeaders},body:body?JSON.stringify(body):undefined});
    const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}
    return {status:r.status,body:value,cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  async function webhook(messages=[],statuses=[],field='messages',extra={}) {
    const value={metadata:{phone_number_id:'test-phone'},contacts:[{wa_id:'5511999990000',profile:{name:'Cliente Teste'}}],...(field==='smb_message_echoes'?{message_echoes:messages}:{messages}),statuses,...extra};
    const payload={object:'whatsapp_business_account',entry:[{changes:[{field,value}]}]};
    const signature='sha256='+createHmac('sha256',config.META_APP_SECRET).update(JSON.stringify(payload)).digest('hex');
    return request('/webhooks/whatsapp','POST',payload,null,{'x-hub-signature-256':signature});
  }
  const admin={name:'Ana',email:'admin@example.invalid',password:'test-only-password-1234'};
  let adminCookie,agentCookie,chatId,adminId,agentId;
  await t.test('instalação e sessões protegidas',async()=>{
    assert.equal((await request('/api/state')).status,401);
    assert.equal((await request('/api/setup','POST',admin,null,{origin:'https://invalid.example'})).status,403);
    assert.equal((await request('/api/setup','POST',admin)).status,201);
    assert.equal((await request('/api/setup','POST',admin)).status,409);
    const login=await request('/api/login','POST',admin);assert.equal(login.status,200);assert.match(login.cookie,/central_session=/);adminCookie=login.cookie;
    assert.equal((await request('/api/login','POST',{...admin,password:'incorrect'})).status,401);
    const state=(await request('/api/state','GET',null,adminCookie)).body;adminId=state.user.id;
    assert.equal(state.user.name,'Ana');assert.equal(JSON.stringify(state).includes('test-only-password'),false);
  });
  await t.test('nomes configuráveis e permissões de administração',async()=>{
    const data={name:'Bruno',email:'agent@example.invalid',password:'test-only-password-5678'};
    assert.equal((await request('/api/agents','POST',data,adminCookie)).status,201);
    agentCookie=(await request('/api/login','POST',data)).cookie;
    agentId=(await request('/api/state','GET',null,agentCookie)).body.user.id;
    assert.equal((await request('/api/settings','PATCH',{minutes:10},agentCookie)).status,403);
    assert.equal((await request('/api/agents','POST',data,agentCookie)).status,403);
    assert.equal((await request('/api/agents/'+agentId,'PATCH',{name:'Bruno Silva'},adminCookie)).status,200);
  });
  await t.test('webhook valida assinatura, número e mensagens duplicadas',async()=>{
    assert.equal((await request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-only-verify&hub.challenge=123')).body,123);
    assert.equal((await request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=bad')).status,403);
    assert.equal((await request('/webhooks/whatsapp','POST',{})).status,403);
    const m={id:'in-1',from:'5511999990000',timestamp:Math.floor(Date.now()/1000)-2500,type:'text',text:{body:'Preciso de atendimento'}};
    assert.equal((await webhook([m],[],'messages',{metadata:{phone_number_id:'other-number'}})).status,200);
    assert.equal((await request('/api/state','GET',null,adminCookie)).body.conversations.length,0);
    assert.equal((await webhook([m])).status,200);await webhook([m]);
    const s=(await request('/api/state','GET',null,adminCookie)).body;assert.equal(s.messages.length,1);assert.equal(s.conversations.length,1);chatId=s.conversations[0].id;
    assert.ok(s.conversations[0].pending_since);app.tick();assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM alerts').get().n,1);
  });
  await t.test('assinatura usa a sessão, ignora identidade enviada pelo navegador e evita duplicidade',async()=>{
    const path='/api/conversations/'+chatId+'/messages';
    const result=await request(path,'POST',{text:'Olá, vou ajudar!',requestId:'request-1',agentId,agentName:'Falso'},adminCookie);
    assert.equal(result.status,201);assert.equal(result.body.message.body,'*Ana:* Olá, vou ajudar!');assert.equal(result.body.message.agent_id,adminId);
    assert.equal(lastPayload.text.body,'*Ana:* Olá, vou ajudar!');assert.equal(sendCount,1);
    assert.equal((await request(path,'POST',{text:'Outra',requestId:'request-1'},adminCookie)).status,200);assert.equal(sendCount,1);
    assert.equal((await request(path,'POST',{text:'Outra',requestId:'request-1'},agentCookie)).status,409);
    const s=(await request('/api/state','GET',null,adminCookie)).body;assert.equal(s.conversations[0].pending_since,null);
    assert.equal((await request('/api/agents/'+adminId,'PATCH',{name:'Ana Souza'},adminCookie)).status,200);
    const previous=(await request('/api/state','GET',null,adminCookie)).body.messages.find(m=>m.request_id==='request-1');assert.equal(previous.body,'*Ana:* Olá, vou ajudar!');
  });
  await t.test('recusas e resultado desconhecido preservam a pendência',async()=>{
    await webhook([{id:'in-2',from:'5511999990000',timestamp:Math.floor(Date.now()/1000),type:'text',text:{body:'Mais uma dúvida'}}]);
    sendMode='fail';assert.equal((await request('/api/conversations/'+chatId+'/messages','POST',{text:'Retorno',requestId:'request-fail'},agentCookie)).status,502);
    let s=(await request('/api/state','GET',null,adminCookie)).body;assert.ok(s.conversations[0].pending_since);assert.equal(s.messages.at(-1).status,'failed');assert.equal(lastPayload.text.body,'*Bruno Silva:* Retorno');
    sendMode='timeout';assert.equal((await request('/api/conversations/'+chatId+'/messages','POST',{text:'Retorno',requestId:'request-timeout'},agentCookie)).status,502);
    s=(await request('/api/state','GET',null,adminCookie)).body;assert.ok(s.conversations[0].pending_since);assert.equal(s.messages.at(-1).status,'unknown');
    sendMode='ok';
  });
  await t.test('respostas fora da central não recebem um atendente inventado',async()=>{
    const r=await webhook([{id:'echo-1',from:'5511000000000',to:'5511999990000',timestamp:Math.floor(Date.now()/1000),type:'text',text:{body:'Resposta no celular'}}],[],'smb_message_echoes');
    assert.equal(r.status,200);const s=(await request('/api/state','GET',null,adminCookie)).body;const echo=s.messages.find(m=>m.provider_id==='echo-1');
    assert.equal(echo.agent_id,null);assert.match(echo.agent_name,/não identificado/);
  });
  await t.test('mensagem recebida enquanto a API envia uma resposta continua pendente',async()=>{
    sendMode='concurrent';
    assert.equal((await request('/api/conversations/'+chatId+'/messages','POST',{text:'Estou verificando',requestId:'request-concurrent'},agentCookie)).status,201);
    const s=(await request('/api/state','GET',null,adminCookie)).body;
    assert.ok(s.conversations[0].pending_since);assert.equal(s.messages.filter(m=>m.provider_id==='in-concurrent').length,1);
    sendMode='ok';
  });
  await t.test('janela de 24 horas bloqueia envio livre antes de chamar a API',async()=>{
    app.db.prepare('UPDATE conversations SET last_inbound=? WHERE id=?').run(Date.now()-25*3600000,chatId);
    const before=sendCount;const r=await request('/api/conversations/'+chatId+'/messages','POST',{text:'Retorno',requestId:'request-expired'},adminCookie);
    assert.equal(r.status,409);assert.equal(sendCount,before);
  });
  await t.test('agendamento e alerta externo usam eventos persistentes',async()=>{
    assert.equal((await request('/api/conversations/'+chatId,'PATCH',{owner_id:agentId,followup_at:Date.now()+60000},adminCookie)).status,200);
    app.db.prepare('UPDATE conversations SET followup_at=?,pending_since=NULL WHERE id=?').run(Date.now()-1000,chatId);
    assert.equal((await request('/api/conversations/'+chatId,'PATCH',{owner_id:adminId},adminCookie)).status,200);
    config.ALERT_WEBHOOK_URL='https://alerts.invalid/events';await app.deliverAlerts();assert.equal(lastAlert.event,'followup');assert.equal(lastAlert.ownerId,adminId);
    assert.equal(app.db.prepare("SELECT delivered FROM alerts WHERE kind='followup'").get().delivered,1);
    await app.deliverAlerts();assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE kind='followup'").get().n,1);
    assert.equal((await request('/api/conversations/'+chatId,'PATCH',{status:'closed'},adminCookie)).status,200);
    assert.equal((await request('/api/conversations/'+chatId+'/messages','POST',{text:'Oi',requestId:'request-closed'},adminCookie)).status,409);
  });
  await t.test('simulação está bloqueada no modo real e logout encerra acesso',async()=>{
    assert.equal((await request('/api/demo/incoming','POST',{name:'Fake'},adminCookie)).status,403);
    assert.equal((await request('/api/logout','POST',{},adminCookie)).status,200);
    assert.equal((await request('/api/state','GET',null,adminCookie)).status,401);
  });
});

test('modo demonstração nunca chama a API do WhatsApp',async t=>{
  let externalCalls=0;
  const config={DATABASE_PATH:':memory:'};const app=createCentral(config,async()=>{externalCalls++;throw new Error('Unexpected external call');});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));config.PUBLIC_ORIGIN='http://127.0.0.1:'+app.server.address().port;t.after(()=>app.close());
  async function req(path,method,body,cookie){const r=await fetch(config.PUBLIC_ORIGIN+path,{method,headers:{origin:config.PUBLIC_ORIGIN,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});return{status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const account={name:'Demo',email:'demo@example.invalid',password:'test-only-password-demo'};
  await req('/api/setup','POST',account);const cookie=(await req('/api/login','POST',account)).cookie;
  const c=await req('/api/demo/incoming','POST',{name:'Cliente'},cookie);
  const sent=await req('/api/conversations/'+c.body.id+'/messages','POST',{text:'Teste',requestId:'demo-1'},cookie);
  assert.equal(sent.status,201);assert.equal(sent.body.message.status,'simulated');assert.equal(externalCalls,0);
});
