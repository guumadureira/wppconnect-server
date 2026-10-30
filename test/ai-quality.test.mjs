import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCentral} from '../server.mjs';

test('registro de falhas exige sessão, conversa correta e revisão administrativa sem executar ações',async t=>{
  const config={DATABASE_PATH:':memory:',WHATSAPP_PHONE_NUMBER_ID:'test'};
  const app=createCentral(config,()=>assert.fail('Nenhuma chamada externa permitida'));t.after(()=>app.close());
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;config.PUBLIC_ORIGIN=origin;
  const request=async(path,method='GET',body,cookie,source=origin)=>{
    const response=await fetch(origin+path,{method,headers:{origin:source,'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
    return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const admin={name:'Ana',email:'admin@example.invalid',password:'test-password'};
  await request('/api/setup','POST',admin);const cookie=(await request('/api/login','POST',admin)).cookie;
  const agent={name:'Bruno',email:'agent@example.invalid',password:'test-password'};
  await request('/api/agents','POST',agent,cookie);const agentCookie=(await request('/api/login','POST',agent)).cookie;
  app.intake({metadata:{phone_number_id:'test'},messages:[{id:'in',from:'5544000000001',type:'text',text:{body:'Oi'}}]});
  const c=app.db.prepare('SELECT * FROM conversations').get(),messageId=randomUUID();
  app.db.prepare("INSERT INTO messages(id,conversation_id,direction,body,agent_name,status,created) VALUES(?,?,'out',?,'Domum · IA','sent',?)").run(messageId,c.id,'Pergunta repetida',Date.now());
  const path='/api/conversations/'+c.id+'/ai-quality',body={requestId:randomUUID(),messageId,category:'Pergunta repetida',observation:'Perguntou o município novamente.',correction:'Considerar o município já informado.'};
  assert.equal((await request(path)).status,401);
  assert.equal((await request(path,'POST',body,cookie,'https://evil.invalid')).status,403);
  assert.equal((await request(path,'POST',{...body,messageId:randomUUID()},cookie)).status,404);
  const created=await request(path,'POST',body,agentCookie);assert.equal(created.status,201);
  assert.equal((await request(path,'POST',body,agentCookie)).data.reports.length,1);
  assert.equal((await request(path,'POST',{...body,observation:'Mudou'},agentCookie)).status,409);
  const report=created.data.reports[0],review={decision:'approved',correction:body.correction};
  assert.equal((await request(path+'/'+report.id,'PATCH',review,agentCookie)).status,403);
  const accepted=await request(path+'/'+report.id,'PATCH',review,cookie);assert.equal(accepted.status,200);assert.equal(accepted.data.reports[0].reviewer,'Ana');
  assert.equal((await request(path+'/'+report.id,'PATCH',review,cookie)).status,200);
  assert.equal((await request(path+'/'+report.id,'PATCH',{...review,decision:'rejected'},cookie)).status,409);
  app.intake({metadata:{phone_number_id:'test'},messages:[{id:'other',from:'5544000000002',type:'text',text:{body:'Oi'}}]});
  const other=app.db.prepare("SELECT id FROM conversations WHERE phone='5544000000002'").get();
  assert.equal((await request('/api/conversations/'+other.id+'/ai-quality','POST',{...body,requestId:randomUUID()},cookie)).status,404);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,3);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM ai_jobs').get().n,0);
});

test('saúde publica somente revisão Render válida, sem valores arbitrários',async t=>{
  for(const revision of ['a'.repeat(40),'private-invalid-value']){
    const app=createCentral({DATABASE_PATH:':memory:',RENDER_GIT_COMMIT:revision});t.after(()=>app.close());
    await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
    const result=await(await fetch('http://127.0.0.1:'+app.server.address().port+'/healthz')).json();
    assert.equal(result.revision,revision.length===40?revision:null);
  }
});
