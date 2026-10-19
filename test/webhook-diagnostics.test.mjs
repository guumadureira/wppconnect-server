import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createCentral } from '../server.mjs';

async function fixture(t, configured=true) {
  const config={DATABASE_PATH:':memory:',WHATSAPP_MODE:'live',WHATSAPP_PHONE_NUMBER_ID:'555550001',WHATSAPP_ACCESS_TOKEN:'test-private-token',META_APP_SECRET:'test-private-secret',WEBHOOK_VERIFY_TOKEN:'test-private-verify',META_GRAPH_VERSION:'v25.0'};
  if(!configured)delete config.WHATSAPP_ACCESS_TOKEN;
  const app=createCentral(config,()=>{throw new Error('No external calls allowed');});
  t.after(()=>app.close());
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.server.address().port;config.PUBLIC_ORIGIN=origin;
  async function request(path,method='GET',body,cookie,headers={}) {
    const response=await fetch(origin+path,{method,headers:{origin,...(cookie?{cookie}:{}),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const admin={name:'Test admin',email:'admin@example.invalid',password:'test-only-password-123'};
  await request('/api/setup','POST',admin);
  const cookie=(await request('/api/login','POST',admin)).cookie;
  const diagnostic=async()=> (await request('/api/connection-status','GET',undefined,cookie)).body;
  const delivery=async(value,valid=true)=>{
    const raw=typeof value==='string'?value:JSON.stringify(value);
    const signature='sha256='+createHmac('sha256',valid?config.META_APP_SECRET:'wrong-test-secret').update(raw).digest('hex');
    return request('/webhooks/whatsapp','POST',raw,undefined,{'x-hub-signature-256':signature});
  };
  const event=(phone='555550001',messages=[],statuses=[])=>({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:phone},messages,statuses}}]}]});
  const message=(id='private-provider-id')=>({id,from:'550000000000',timestamp:Math.floor(Date.now()/1000),type:'text',text:{body:'private-message-content'}});
  return {app,request,cookie,diagnostic,delivery,event,message};
}

test('diagnóstico distingue falha de assinatura, outro número, mensagem e reentrega sem vazar dados',async t=>{
  const {request,cookie,diagnostic,delivery,event,message}=await fixture(t);
  assert.equal((await request('/api/connection-status')).status,401);
  const agent={name:'Agent',email:'agent@example.invalid',password:'test-only-password-456'};
  await request('/api/agents','POST',agent,cookie);
  const agentCookie=(await request('/api/login','POST',agent)).cookie;
  assert.equal((await request('/api/connection-status','GET',undefined,agentCookie)).status,403);
  assert.equal((await diagnostic()).webhook.postRequests,0);
  assert.equal((await delivery(event(undefined,[message()]),false)).status,403);
  let state=await diagnostic();assert.equal(state.webhook.lastResult,'signature_rejected');assert.equal(state.webhook.rejectedRequests,1);
  assert.equal((await delivery(event('other-test-number',[message()]))).status,200);
  state=await diagnostic();assert.equal(state.webhook.lastResult,'other_number');assert.equal(state.webhook.ignoredNumberEvents,1);assert.equal(state.webhook.recordedMessages,0);
  assert.equal((await delivery(event(undefined,[message()]))).status,200);
  state=await diagnostic();assert.equal(state.webhook.lastResult,'recorded');assert.equal(state.webhook.recordedMessages,1);assert.ok(state.webhook.lastMessageAt>=state.webhook.startedAt);assert.equal(state.connectionVerified,false);
  await delivery(event(undefined,[message()]));
  state=await diagnostic();assert.equal(state.webhook.lastResult,'duplicate');assert.equal(state.webhook.recordedMessages,1);assert.equal(state.webhook.duplicates,1);
  await delivery(event(undefined,[],[{id:'unknown-status-only',status:'sent'}]));
  state=await diagnostic();assert.equal(state.webhook.lastResult,'no_new_message');assert.equal(state.webhook.recordedMessages,1);
  assert.equal((await delivery('{"malformed":')).status,400);
  state=await diagnostic();assert.equal(state.webhook.lastResult,'invalid_payload');assert.equal(state.webhook.postRequests,6);assert.equal(state.webhook.acceptedRequests,4);assert.equal(state.webhook.rejectedRequests,2);
  const serialized=JSON.stringify(state);
  for(const privateValue of ['private-message-content','private-provider-id','550000000000','test-private-token','test-private-secret','test-private-verify','admin@example.invalid'])assert.ok(!serialized.includes(privateValue));
});

test('falha de transação não confirma mensagens desfeitas pelo rollback',async t=>{
  const {app,diagnostic,delivery,event,message}=await fixture(t);
  app.db.exec("CREATE TRIGGER fail_test BEFORE INSERT ON messages WHEN NEW.provider_id='force-failure' BEGIN SELECT RAISE(ABORT,'test-only failure'); END;");
  assert.equal((await delivery(event(undefined,[message('first-in-transaction'),message('force-failure')]))).status,500);
  const state=await diagnostic();assert.equal(state.webhook.lastResult,'processing_error');assert.equal(state.webhook.recordedMessages,0);assert.equal(state.webhook.lastMessageAt,null);assert.equal(state.webhook.acceptedRequests,0);assert.equal(state.webhook.rejectedRequests,1);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n,0);
});

test('servidor sem credenciais registra recusa sem contornar a proteção',async t=>{
  const {diagnostic,delivery,event,message}=await fixture(t,false);
  assert.equal((await delivery(event(undefined,[message()]))).status,503);
  const state=await diagnostic();assert.equal(state.webhook.lastResult,'not_configured');assert.equal(state.webhook.rejectedRequests,1);assert.equal(state.webhook.recordedMessages,0);
});
