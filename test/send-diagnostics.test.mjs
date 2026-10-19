import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createCentral } from '../server.mjs';

async function fixture(t, transport) {
  const config={DATABASE_PATH:':memory:',WHATSAPP_MODE:'live',WHATSAPP_PHONE_NUMBER_ID:'test-phone',WHATSAPP_ACCESS_TOKEN:'private-test-token',META_APP_SECRET:'private-test-secret',WEBHOOK_VERIFY_TOKEN:'private-test-verify',META_GRAPH_VERSION:'v25.0'};
  const app=createCentral(config,transport);t.after(()=>app.close());
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));config.PUBLIC_ORIGIN='http://127.0.0.1:'+app.server.address().port;
  async function request(path,method='GET',body,cookie,headers={}){
    const response=await fetch(config.PUBLIC_ORIGIN+path,{method,headers:{origin:config.PUBLIC_ORIGIN,...(cookie?{cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const admin={name:'Test agent',email:'admin@example.invalid',password:'test-only-password-123'};await request('/api/setup','POST',admin);const cookie=(await request('/api/login','POST',admin)).cookie;
  app.intake({metadata:{phone_number_id:'test-phone'},messages:[{id:'test-incoming',from:'550000000000',timestamp:Math.floor(Date.now()/1000),text:{body:'Test-only incoming'}}]});
  const id=app.db.prepare('SELECT id FROM conversations').get().id;
  const send=(requestId='test-request')=>request('/api/conversations/'+id+'/messages','POST',{text:'private-test-message',requestId},cookie);
  const diagnostic=async()=>(await request('/api/connection-status','GET',undefined,cookie)).body;
  const webhook=async(changes)=>{const body={object:'whatsapp_business_account',entry:[{changes}]};const signature='sha256='+createHmac('sha256',config.META_APP_SECRET).update(JSON.stringify(body)).digest('hex');return request('/webhooks/whatsapp','POST',body,undefined,{'x-hub-signature-256':signature});};
  return {app,send,diagnostic,webhook};
}

test('recusa da API mostra só código numérico e mantém falha e pendência',async t=>{
  for(const code of [190,130497,'private-test-token']){
    const {app,send,diagnostic}=await fixture(t,async()=>Response.json({error:{code,message:'private-test-token private-test-secret',error_data:{details:'private-test-message'}}},{status:400}));
    const response=await send();assert.equal(response.status,502);
    const expected=typeof code==='number'?code:null;
    if(expected)assert.match(response.body.error,new RegExp('Código Meta: '+expected));
    else assert.doesNotMatch(response.body.error,/Código Meta/);
    const status=await diagnostic();assert.equal(status.lastSendFailure.code,expected);assert.equal(status.lastSendFailure.source,'api');assert.ok(status.lastSendFailure.at>0);
    const text=JSON.stringify({response,status});for(const value of ['private-test-token','private-test-secret','private-test-message'])assert.ok(!text.includes(value));
    assert.equal(app.db.prepare("SELECT status FROM messages WHERE direction='out'").get().status,'failed');
    assert.ok(app.db.prepare('SELECT pending_since FROM conversations').get().pending_since);
  }
});

test('falha de entrega só altera diagnóstico para mensagem conhecida e evento confirmado no banco',async t=>{
  const {app,send,diagnostic,webhook}=await fixture(t,async()=>Response.json({messages:[{id:'test-outbound-provider-id'}]}));
  assert.equal((await send()).status,201);assert.equal((await diagnostic()).lastSendFailure,null);
  const statusChange=id=>({field:'messages',value:{metadata:{phone_number_id:'test-phone'},statuses:[{id,status:'failed',errors:[{code:130497,message:'private-test-secret'}]}]}});
  await webhook([statusChange('unknown-message')]);assert.equal((await diagnostic()).lastSendFailure,null);
  app.db.exec("CREATE TRIGGER fail_test BEFORE INSERT ON messages WHEN NEW.provider_id='force-failure' BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  const badChange={field:'messages',value:{metadata:{phone_number_id:'test-phone'},messages:[{id:'force-failure',from:'550000000000',text:{body:'test'}}]}};
  assert.equal((await webhook([statusChange('test-outbound-provider-id'),badChange])).status,500);
  assert.equal((await diagnostic()).lastSendFailure,null);assert.equal(app.db.prepare("SELECT status FROM messages WHERE direction='out'").get().status,'sent');
  assert.equal((await webhook([statusChange('test-outbound-provider-id')])).status,200);
  const result=await diagnostic();assert.equal(result.lastSendFailure.code,130497);assert.equal(result.lastSendFailure.source,'delivery');assert.ok(!JSON.stringify(result).includes('private-test-secret'));
});
