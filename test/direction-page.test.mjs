import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCentral} from '../server.mjs';

test('painel de decisoes so serve HTML ao administrador designado',async t=>{
  const config={DATABASE_PATH:':memory:',WHATSAPP_MODE:'demo',
    DIRECTION_ESCALATION_ENABLED:'true',DIRECTION_APPROVER_EMAIL:'director@example.invalid'};
  const app=createCentral(config,async()=>{throw Error('Sem chamadas externas');});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.server.address().port;
  config.PUBLIC_ORIGIN=origin;
  t.after(()=>app.close());
  async function call(path,method='GET',data,cookie){
    return fetch(origin+path,{method,headers:{origin,...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
      body:data?JSON.stringify(data):undefined});
  }
  const admin={name:'Diretor',email:'director@example.invalid',password:'test-only-password-123'};
  assert.equal((await call('/api/setup','POST',admin)).status,201);
  const login=await call('/api/login','POST',admin);
  const adminCookie=login.headers.get('set-cookie')?.split(';')[0];
  assert.equal((await call('/direcao')).status,401);
  assert.equal((await call('/api/agents','POST',{name:'Operador',email:'agent@example.invalid',password:'test-only-password-321'},adminCookie)).status,201);
  const userLogin=await call('/api/login','POST',{email:'agent@example.invalid',password:'test-only-password-321'});
  const agentCookie=userLogin.headers.get('set-cookie')?.split(';')[0];
  assert.equal((await call('/direcao','GET',null,agentCookie)).status,403);
  const view=await call('/direcao','GET',null,adminCookie);
  assert.equal(view.status,200);
  assert.match(view.headers.get('content-type'),/text\/html/);
  assert.equal(view.headers.get('cache-control'),'no-store');
  const html=await view.text();
  assert.match(html,/Decisões da direção/);
  assert.match(html,/\/api\/direction\/decisions/);
  assert.match(html,/Ativar avisos neste navegador/);
  assert.match(html,/Notification\.requestPermission/);
  assert.match(html,/setInterval\(checkPending,30000\)/);
  assert.doesNotMatch(html,/director@example.invalid/);
  config.DIRECTION_ESCALATION_ENABLED='false';
  assert.equal((await call('/direcao','GET',null,adminCookie)).status,503);
});
