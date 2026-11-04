import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCentral} from '../server.mjs';

async function environment(t,flags={}){
  const config={DATABASE_PATH:':memory:',WHATSAPP_MODE:'live',WHATSAPP_PHONE_NUMBER_ID:'555550001',
    WHATSAPP_ACCESS_TOKEN:'private-test-token',META_APP_SECRET:'private-test-secret',
    WEBHOOK_VERIFY_TOKEN:'private-test-verify',META_GRAPH_VERSION:'v25.0',
    META_APP_ID:'987654321',WHATSAPP_BUSINESS_ACCOUNT_ID:'123456789',...flags};
  const called=[];
  const transport=async(url,options)=>{
    called.push({url,method:options.method,auth:options.headers?.authorization});
    if(url.includes('/phone_numbers?'))return Response.json({data:[{
      id:'555550001',display_phone_number:'+55 44 00000-0001',platform_type:'CLOUD_API',is_on_biz_app:true
    }]});
    if(url.includes('/subscribed_apps?'))return Response.json({data:[{id:'987654321',name:'Test app'}]});
    throw Error('Unexpected network destination');
  };
  const app=createCentral(config,transport);
  t.after(()=>app.close());
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.server.address().port;config.PUBLIC_ORIGIN=origin;
  const request=async(path,method='GET',body,cookie)=>{
    const response=await fetch(origin+path,{method,headers:{origin,...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
      body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const account={name:'Admin',email:'admin@example.invalid',password:'test-only-password'};
  assert.equal((await request('/api/setup','POST',account)).status,201);
  const cookie=(await request('/api/login','POST',account)).cookie;
  return {config,app,called,request,cookie};
}

test('diagnóstico Meta é somente leitura e protegido pela sessão de admin',async t=>{
  const env=await environment(t);
  const endpoint='/api/coexistence/verify';
  assert.equal((await env.request(endpoint,'POST',{})).status,401);
  const operator={name:'Operator',email:'operator@example.invalid',password:'test-only-password2'};
  assert.equal((await env.request('/api/agents','POST',operator,env.cookie)).status,201);
  const user=(await env.request('/api/login','POST',operator)).cookie;
  assert.equal((await env.request(endpoint,'POST',{},user)).status,403);
  const result=await env.request(endpoint,'POST',{},env.cookie);
  assert.equal(result.status,200);
  assert.equal(result.body.credentialsPresent,true);
  assert.equal(result.body.phoneLookupConfirmed,true);
  assert.equal(result.body.phoneMatches,true);
  assert.equal(result.body.coexistenceConfirmed,true);
  assert.equal(result.body.subscribedAppsLookupConfirmed,true);
  assert.equal(result.body.ourAppSubscriptionConfirmed,true);
  assert.equal(result.body.requiredWebhookFieldsConfirmed,false);
  assert.equal(result.body.deliveryConfirmed,false);
  assert.deepEqual(result.body.fieldsToVerify,['messages','history','smb_app_state_sync','smb_message_echoes']);
  assert.equal(env.called.length,2);
  assert.ok(env.called.every(call=>call.method==='GET'));
  assert.ok(env.called.every(call=>call.auth==='Bearer private-test-token'));
  assert.ok(!JSON.stringify(result).includes('private-test-token'));
  assert.ok(!JSON.stringify(result).includes('555550001'));
});

test('ausência de WABA retorna pendência sem chamadas Meta ou falsa conexão comprovada',async t=>{
  const env=await environment(t,{WHATSAPP_BUSINESS_ACCOUNT_ID:'',META_APP_ID:''});
  const result=await env.request('/api/coexistence/verify','POST',{},env.cookie);
  assert.equal(result.status,200);
  assert.equal(result.body.wabaConfigured,false);
  assert.equal(result.body.coexistenceConfirmed,false);
  assert.equal(result.body.ourAppSubscriptionConfirmed,false);
  assert.equal(result.body.requiredWebhookFieldsConfirmed,false);
  assert.equal(env.called.length,0);
});
