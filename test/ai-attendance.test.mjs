import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCentral} from '../server.mjs';
import {simulateAttendance} from '../ai-attendance.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const phone='5544000000001';
const output={reply:'Olá! Em qual município fica o imóvel?',summary:'Contato solicita informações sobre projeto.',missing:'Município e serviço',nextStep:'Entender o serviço solicitado',kind:'orcamento',handoff:false,reason:''};
function fixture(t,extra={},intercept){
  const config={DATABASE_PATH:':memory:',WHATSAPP_MODE:'live',WHATSAPP_PHONE_NUMBER_ID:'test-phone',WHATSAPP_ACCESS_TOKEN:'test-meta-key',META_APP_SECRET:'test-secret',WEBHOOK_VERIFY_TOKEN:'test-verify',META_GRAPH_VERSION:'v25.0',AI_ENABLED:'true',OPENAI_API_KEY:'test-openai-key',AI_ALLOWED_PHONES:phone,AI_MONTHLY_BUDGET_USD:'1',...extra};
  const calls=[];let app;
  const transport=async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body),headers:options.headers});
    if(intercept){const result=await intercept(url,options,app);if(result)return result;}
    if(url==='https://api.openai.com/v1/responses')return Response.json({status:'completed',usage:{input_tokens:1000,output_tokens:150},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]});
    assert.match(url,/^https:\/\/graph.facebook.com\//);return Response.json({messages:[{id:'fake-out-'+calls.length}]});
  };
  app=createCentral(config,transport,{aiDebounceMs:0,notionRequestIntervalMs:0});t.after(()=>app.close());
  let sequence=0;
  const incoming=(body='Quero informações de projeto',from=phone,extra={})=>{const id='fake-in-'+(++sequence);app.intake({metadata:{phone_number_id:'test-phone'},messages:[{id,from,type:'text',timestamp:Math.floor(Date.now()/1000),text:{body},...extra}]});return app.db.prepare('SELECT * FROM conversations WHERE phone=?').get(from);};
  return{app,config,calls,incoming};
}
test('simulação gratuita não usa modelo nem grava atendimento',()=>{
  const result=simulateAttendance('Quero falar com uma pessoa');assert.equal(result.simulation,true);assert.equal(result.handoff,true);
  assert.equal(simulateAttendance('Ofereço parceria comercial').kind,'comercial');assert.throws(()=>simulateAttendance(''),/mensagem de teste/);
});
test('chave presente sem limite autorizado ou ativação não chama APIs',async t=>{
  for(const extra of [{AI_MONTHLY_BUDGET_USD:'0'},{AI_ENABLED:'false'},{AI_ALLOWED_PHONES:''},{WHATSAPP_MODE:'demo'}]){
    const f=fixture(t,extra);f.incoming();await f.app.ai.process();assert.equal(f.calls.length,0);assert.equal(f.app.ai.status().enabled,false);
  }
});
test('piloto usa somente o número liberado, JSON estrito, histórico mínimo e autoria IA',async t=>{
  const f=fixture(t);f.incoming('Olá','5544000000002');await f.app.ai.process();assert.equal(f.calls.length,0);
  const chat=f.incoming();await f.app.ai.process();assert.equal(f.calls.length,2);
  const req=f.calls[0];assert.equal(req.url,'https://api.openai.com/v1/responses');assert.equal(req.body.store,false);assert.equal(req.body.text.format.strict,true);assert.equal(req.body.model,'gpt-5.4-mini-2026-03-17');assert.ok(!req.body.tools);
  assert.ok(!JSON.stringify(req.body).includes('test-openai-key'));assert.ok(!JSON.stringify(f.app.ai.status()).includes('test-openai-key'));
  const sent=f.app.db.prepare("SELECT * FROM messages WHERE direction='out'").get();assert.equal(sent.agent_name,'Domum · IA');assert.equal(sent.body,output.reply);assert.equal(sent.status,'sent');
  const ctx=f.app.customerContext.view(chat.id);assert.equal(ctx.history[0].source,'IA');assert.equal(ctx.history[0].qualification,'Interpretado');assert.equal(ctx.history[0].sync_state,'waiting_link');
});
test('nova mensagem substitui trabalho pendente e deduplicação evita outra resposta',async t=>{
  const f=fixture(t);const c=f.incoming('Quero um projeto');f.incoming('O imóvel fica em Sarandi');await f.app.ai.process();await f.app.ai.process();
  assert.equal(f.calls.filter(c=>c.url.includes('openai.com')).length,1);assert.equal(f.app.db.prepare("SELECT COUNT(*) AS n FROM ai_jobs WHERE state='cancelled'").get().n,1);
  f.app.intake({metadata:{phone_number_id:'test-phone'},messages:[{id:'fake-in-2',from:phone,type:'text',text:{body:'reentrega'}}]});await f.app.ai.process();assert.equal(f.calls.length,2);assert.ok(f.app.customerContext.view(c.id));
});
test('assumir enquanto o modelo trabalha cancela a resposta e preserva controle humano',async t=>{
  let started,finish;const began=new Promise(r=>started=r),waiting=new Promise(r=>finish=r);
  const f=fixture(t,{},async(url)=>{if(url.includes('openai.com')){started();await waiting;}});const c=f.incoming();const work=f.app.ai.process();await began;f.app.ai.pause(c.id);finish();await work;
  assert.equal(f.calls.length,1);assert.equal(f.app.customerContext.view(c.id).mode,'human');assert.equal(f.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='out'").get().n,0);
  f.incoming('Mais uma dúvida');await f.app.ai.process();assert.equal(f.calls.length,1);
});
test('resposta pelo aplicativo Business pausa a IA mesmo durante geração',async t=>{
  let started,finish;const began=new Promise(r=>started=r),waiting=new Promise(r=>finish=r);
  const f=fixture(t,{},async url=>{if(url.includes('openai.com')){started();await waiting;}});const c=f.incoming();const work=f.app.ai.process();await began;
  f.app.intake({metadata:{phone_number_id:'test-phone'},message_echoes:[{id:'human-echo',to:phone,type:'text',text:{body:'Vou cuidar disso.'},timestamp:Math.floor(Date.now()/1000)}]},'smb_message_echoes');finish();await work;
  assert.equal(f.calls.length,1);assert.equal(f.app.customerContext.view(c.id).mode,'human');
});
test('alteração humana no contexto durante a geração invalida a resposta antiga',async t=>{
  let started,finish;const began=new Promise(r=>started=r),waiting=new Promise(r=>finish=r);
  const f=fixture(t,{},async url=>{if(url.includes('openai.com')){started();await waiting;}});const c=f.incoming();const work=f.app.ai.process();await began;
  f.app.db.prepare("UPDATE conversation_context SET version=version+1,summary='Conferência humana atualizada' WHERE conversation_id=?").run(c.id);finish();await work;
  assert.equal(f.calls.length,1);assert.equal(f.app.ai.result(c.id).state,'cancelled');assert.equal(f.app.customerContext.view(c.id).summary,'Conferência humana atualizada');
});
test('pedido humano e arquivo recebido encaminham sem modelo, inclusive dentro da transação do webhook',async t=>{
  const f=fixture(t);f.app.db.exec('BEGIN');const c=f.incoming('Quero falar com uma pessoa');f.app.db.exec('COMMIT');await f.app.ai.process();assert.equal(f.calls.length,0);assert.match(f.app.ai.status().handoffs[0].handoff,/humano/);
  assert.equal(f.app.customerContext.view(c.id).requests[0].status,'Aguardando equipe');
  const second=fixture(t);const file=second.incoming('',phone,{type:'audio',audio:{id:'test-audio'}});await second.app.ai.process();assert.equal(second.calls.length,0);assert.match(second.app.ai.status().handoffs[0].handoff,/Arquivo/);assert.equal(second.app.customerContext.view(file.id).mode,'human');
});
test('limite local impede chamada e falha de modelo não expõe resposta privada nem repete consumo',async t=>{
  const f=fixture(t,{AI_MONTHLY_BUDGET_USD:'0.00001'});f.incoming();await f.app.ai.process();assert.equal(f.calls.length,0);assert.equal(f.app.ai.status().handoffs.length,1);
  const g=fixture(t,{},async url=>url.includes('openai.com')?Response.json({error:'test-openai-key'},{status:429}):undefined);const c=g.incoming();await g.app.ai.process();await g.app.ai.process();assert.equal(g.calls.length,1);assert.ok(g.app.ai.status().usedUsd>0);assert.ok(!JSON.stringify(g.app.ai.result(c.id)).includes('test-openai-key'));
});
test('saída inválida ou recusa do modelo fica para pessoa, sem enviar ao cliente',async t=>{
  for(const data of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]},{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...output,reply:'https://internal.invalid/private'})}]}]}]){
    const f=fixture(t,{},async url=>url.includes('openai.com')?Response.json(data):undefined);f.incoming();await f.app.ai.process();assert.equal(f.calls.length,1);assert.equal(f.app.ai.status().handoffs.length,1);
  }
});
test('handoff do modelo registra pendências e uma resposta de transporte incerto nunca é reenviada',async t=>{
  const f=fixture(t,{},async url=>url.includes('openai.com')?Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...output,handoff:true,reason:'Orçamento depende de conferência da equipe.'})}]}]}):undefined);
  const c=f.incoming();await f.app.ai.process();assert.equal(f.calls.length,2);assert.equal(f.app.customerContext.view(c.id).mode,'human');assert.equal(f.app.customerContext.view(c.id).requests[0].status,'Aguardando equipe');
  const g=fixture(t,{},async url=>{if(url.includes('graph.facebook.com'))throw Error('private transport details');});g.incoming();await g.app.ai.process();await g.app.ai.process();assert.equal(g.calls.length,2);assert.equal(g.app.db.prepare("SELECT status FROM messages WHERE direction='out'").get().status,'unknown');assert.equal(g.app.ai.status().handoffs.length,1);
});
test('reinício preserva consumo reservado e põe execuções incertas sob conferência humana',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'domum-ai-test-'));let app;
  try{
    const config={DATABASE_PATH:join(directory,'test.sqlite'),WHATSAPP_MODE:'live',WHATSAPP_PHONE_NUMBER_ID:'test-phone',WHATSAPP_ACCESS_TOKEN:'test-meta',META_APP_SECRET:'test-secret',WEBHOOK_VERIFY_TOKEN:'test-verify',META_GRAPH_VERSION:'v25.0',AI_ENABLED:'true',OPENAI_API_KEY:'test-key',AI_ALLOWED_PHONES:phone,AI_MONTHLY_BUDGET_USD:'1'};
    app=createCentral(config,async()=>{throw Error('No real transport');},{aiDebounceMs:0});
    app.intake({metadata:{phone_number_id:'test-phone'},messages:[{id:'in-restart',from:phone,type:'text',text:{body:'Projeto'},timestamp:Math.floor(Date.now()/1000)}]});
    app.db.prepare("UPDATE ai_jobs SET state='running',cost_usd=0.02").run();const id=app.db.prepare('SELECT conversation_id FROM ai_jobs').get().conversation_id;await app.close();app=null;
    app=createCentral(config,async()=>{throw Error('No real transport');},{aiDebounceMs:0});assert.equal(app.ai.status().usedUsd,0.02);assert.equal(app.customerContext.view(id).mode,'human');assert.equal(app.ai.status().handoffs.length,1);await app.ai.process();assert.equal(app.ai.result(id).state,'error');
  }finally{if(app)await app.close();rmSync(directory,{recursive:true,force:true});}
});
test('ensaio exige autenticação e administração, sem gravar ou consumir API',async t=>{
  const f=fixture(t,{AI_ENABLED:'false'});await new Promise(r=>f.app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+f.app.server.address().port;f.config.PUBLIC_ORIGIN=origin;
  const req=async(path,method='GET',body,cookie)=>{const r=await fetch(origin+path,{method,headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  assert.equal((await req('/api/ai/simulate','POST',{message:'Projeto'})).status,401);
  await req('/api/setup','POST',{name:'Admin teste',email:'ai-test@example.invalid',password:'test-password'});const login=await req('/api/login','POST',{email:'ai-test@example.invalid',password:'test-password'});
  const result=await req('/api/ai/simulate','POST',{message:'Preciso de projeto em Maringá'},login.cookie);assert.equal(result.status,200);assert.equal(result.body.simulation,true);assert.equal(f.calls.length,0);assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,0);
  const status=await req('/api/ai/status','GET',null,login.cookie);assert.ok(!JSON.stringify(status).includes('test-openai-key'));
});
