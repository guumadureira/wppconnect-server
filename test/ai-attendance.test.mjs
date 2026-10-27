import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCentral} from '../server.mjs';
import {simulateAttendance} from '../ai-attendance.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const phone='5544000000001';
const output={reply:'Olá! Em qual município fica o imóvel?',summary:'Contato solicita informações sobre projeto.',missing:'Município e serviço',nextStep:'Entender o serviço solicitado',kind:'orcamento',handoff:false,reason:'',intake:{ready:false,name:'',city:'',service:'',nameMessageId:'',cityMessageId:'',serviceMessageId:''}};
function fixture(t,extra={},intercept){
  const config={DATABASE_PATH:':memory:',WHATSAPP_MODE:'live',WHATSAPP_PHONE_NUMBER_ID:'test-phone',WHATSAPP_ACCESS_TOKEN:'test-meta-key',META_APP_SECRET:'test-secret',WEBHOOK_VERIFY_TOKEN:'test-verify',META_GRAPH_VERSION:'v25.0',AI_ENABLED:'true',OPENAI_API_KEY:'test-openai-key',AI_ALLOWED_PHONES:phone,AI_MONTHLY_BUDGET_USD:'1',...extra};
  const calls=[];let app;
  const transport=async(url,options)=>{
    calls.push({url,body:options.body?JSON.parse(options.body):undefined,headers:options.headers});
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

test('oferta comercial fica na fila de fornecedores, fora do cadastro e histórico de clientes',async t=>{
  const result={...output,reply:'Obrigado por apresentar seu serviço. Por enquanto não precisamos; podemos conversar se surgir uma demanda.',kind:'comercial',summary:'Contato oferece pintura; empresa ainda não confirmada.',missing:'',nextStep:'Consultar somente se houver necessidade futura'};
  const f=fixture(t,{},async url=>url.includes('openai.com')?Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]}):null);
  const c=f.incoming('Gostaria de falar com Gustavo. Ofereço serviços de pintura.');
  f.app.customerContext.view(c.id);f.app.db.prepare('UPDATE conversation_context SET client_id=? WHERE conversation_id=?').run(randomUUID(),c.id);
  await f.app.ai.process();
  assert.equal(f.app.suppliers.status().pending,1);assert.equal(f.app.suppliers.status().enabled,false);
  assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM notion_client_operations').get().n,0);
  assert.equal(f.app.db.prepare("SELECT client_id FROM service_events WHERE actor='Domum · IA'").get().client_id,null);
  assert.equal(f.app.db.prepare("SELECT COUNT(*) AS n FROM service_requests").get().n,0);
  assert.equal(f.app.db.prepare("SELECT state FROM ai_jobs").get().state,'done');
});

test('histórico manual acompanha a próxima mensagem sem gerar resposta ao importar ou servir de cadastro',async t=>{
  const f=fixture(t);const c=f.incoming('Olá');
  const d=new Date(Date.now()-3*3600000-3600000),line=d.getUTCDate()+'/'+(d.getUTCMonth()+1)+'/'+d.getUTCFullYear()+' '+d.getUTCHours()+':'+String(d.getUTCMinutes()).padStart(2,'0')+' - Cliente: Já enviei a matrícula ontem.';
  const actor={id:'admin'},draft=f.app.manualHistory.preview(c,{text:line,dateOrder:'dmy',customerName:'Cliente',participantsConfirmed:true},actor);
  f.app.manualHistory.confirm(c,{...draft,confirmed:true},actor);await f.app.ai.process();assert.equal(f.calls.length,0);
  f.app.db.prepare("UPDATE conversation_context SET mode='assisted' WHERE conversation_id=?").run(c.id);f.app.ai.release(c);
  f.incoming('Podemos continuar de onde paramos?');await f.app.ai.process();
  const input=JSON.parse(f.calls.find(c=>c.url.includes('openai.com')).body.input[0].content);
  assert.equal(input.importedHistory.source,'exportacao_manual_nao_verificada');assert.equal(input.importedHistory.messages[0].text,'Já enviei a matrícula ontem.');
  assert.ok(input.messages.every(m=>!m.text.includes('Já enviei a matrícula')));
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

test('teto total do teste não renova quando o mês muda',async t=>{
  const f=fixture(t,{AI_TOTAL_BUDGET_USD:'5',AI_MONTHLY_BUDGET_USD:'5'});f.incoming();await f.app.ai.process();assert.equal(f.calls.length,2);
  f.app.db.prepare("UPDATE ai_jobs SET cost_usd=5,billing_month='2000-01'").run();f.incoming('Tenho mais uma pergunta');await f.app.ai.process();assert.equal(f.calls.length,2);assert.equal(f.app.ai.status().usedTotalUsd,5);assert.equal(f.app.ai.status().handoffs.length,1);
});

function notionPilot(t,{existing=null,invalidEvidence=false,commercial=false,pauseBeforeCreate=false,pauseDuringCreate=false}={}){
  const clients='11111111-1111-4111-8111-111111111111',history='22222222-2222-4222-8222-222222222222';
  const rows={[clients]:existing?[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',parent:{data_source_id:clients},properties:{'Nome do Cliente':{title:[{text:{content:existing}}]},Telefone:{phone_number:phone}}}]:[],[history]:[]};
  let clientPosts=0;const rt=p=>(p?.title||p?.rich_text||[]).map(x=>x.text?.content||'').join('');
  const f=fixture(t,{PUBLIC_ORIGIN:'https://central.example.invalid',AI_AUTO_REGISTER:'true',AI_TOTAL_BUDGET_USD:'5',NOTION_ENABLED:'true',NOTION_TOKEN:'fake-notion-token',NOTION_CLIENTS_DATA_SOURCE_ID:clients,NOTION_HISTORY_DATA_SOURCE_ID:history},async(url,options)=>{
    if(url.includes('api.notion.com')){
      const body=options.body?JSON.parse(options.body):null,path=new URL(url).pathname;
      if(path.startsWith('/v1/pages/'))return Response.json(Object.values(rows).flat().find(p=>p.id===path.split('/').at(-1)));
      if(path.endsWith('/query')){const list=rows[path.split('/')[3]]||[],filter=body.filter;if(pauseBeforeCreate&&filter?.title?.equals){const chat=f.app.db.prepare('SELECT id FROM conversations WHERE phone=?').get(phone);f.app.ai.pause(chat.id);}return Response.json({results:list.filter(p=>{if(!filter)return true;if(filter.relation)return p.properties[filter.property]?.relation?.some(r=>r.id===filter.relation.contains);const value=filter.phone_number?p.properties[filter.property]?.phone_number||'':rt(p.properties[filter.property]);const cond=filter.phone_number||filter.title||filter.rich_text;return cond?.equals!==undefined?value===cond.equals:value.includes(cond?.contains||'');}),has_more:false});}
      if(path==='/v1/pages'){
        const source=body.parent.data_source_id;if(source===clients)clientPosts++;
        const page={id:randomUUID(),parent:body.parent,properties:body.properties,children:body.children};rows[source].push(page);if(pauseDuringCreate&&source===clients){const chat=f.app.db.prepare('SELECT id FROM conversations WHERE phone=?').get(phone);f.app.ai.pause(chat.id);}return Response.json(page);
      }
      throw Error('Unexpected Notion path');
    }
    if(url.includes('api.openai.com')){
      const input=JSON.parse(JSON.parse(options.body).input[0].content),source=input.messages.find(m=>m.text.includes('Meu nome é')),file=input.attachments?.length>0;
      const intake=source?{ready:true,name:invalidEvidence?'Nome inventado':'Cliente Exemplo',city:'Maringá',service:'projeto residencial',nameMessageId:source.id,cityMessageId:source.id,serviceMessageId:source.id}:{ready:false,name:'',city:'',service:'',nameMessageId:'',cityMessageId:'',serviceMessageId:''};
      return Response.json({status:'completed',usage:{input_tokens:1500,output_tokens:250},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...output,reply:file?'Recebi o arquivo. A equipe vai conferir e seguir com o atendimento.':source?'Você tem matrícula ou cadastro imobiliário? Se não tiver, seguimos com as informações disponíveis.':'Como posso te chamar?',summary:file?'Solicitação de projeto em Maringá; arquivo recebido, sem validação.':'Solicitação de projeto residencial em Maringá.',kind:commercial?'comercial':'orcamento',handoff:file,reason:file?'Conferir documento e preparar orçamento.':'',intake})}]}]});
    }
  });
  let registrationError;const register=f.app.customerContext.registerFromAI;f.app.customerContext.registerFromAI=async(...args)=>{try{return await register(...args);}catch(error){registrationError=error.message;throw error;}};
  return{...f,rows,clients,history,get clientPosts(){return clientPosts;},get registrationError(){return registrationError;}};
}

test('jornada do novo contato cria cadastro com origem conferida e vincula documento ao histórico privado',async t=>{
  const f=notionPilot(t);const c=f.incoming('Gostaria de um projeto');await f.app.ai.process();assert.equal(f.clientPosts,0);
  f.incoming('Meu nome é Cliente Exemplo. Preciso de projeto residencial em Maringá.');await f.app.ai.process();assert.equal(f.clientPosts,1);
  let ctx=f.app.customerContext.view(c.id);assert.ok(ctx.client_id,f.registrationError);assert.equal(ctx.client_name,'Cliente Exemplo');assert.ok(ctx.history.some(e=>e.summary.includes('Município do serviço: Maringá')&&e.source==='IA'));
  f.incoming('',phone,{type:'document',document:{id:'fake-document-id',filename:'cadastro-imobiliario.pdf',mime_type:'application/pdf'}});await f.app.ai.process();await f.app.customerContext.processQueue(true);
  ctx=f.app.customerContext.view(c.id);assert.equal(ctx.mode,'human');assert.equal(f.clientPosts,1);assert.ok(ctx.requests.some(r=>r.status==='Aguardando equipe'));
  const file=f.rows[f.history].find(p=>p.children?.length);assert.ok(file);const paragraph=JSON.stringify(file.children);assert.match(paragraph,/api\/media\//);assert.match(paragraph,/ainda não validado/);assert.ok(!paragraph.includes('fake-notion-token'));
  assert.equal(f.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='out' AND agent_name='Domum · IA'").get().n,3);
});

test('nome inventado, contato comercial e cadastro divergente não criam cliente automaticamente',async t=>{
  for(const variant of [{invalidEvidence:true},{commercial:true},{existing:'Outra Pessoa'}]){
    const f=notionPilot(t,variant);f.incoming('Meu nome é Cliente Exemplo. Preciso de projeto residencial em Maringá.');await f.app.ai.process();assert.equal(f.clientPosts,0);assert.equal(f.app.ai.status().handoffs.length,1);
  }
});

test('cadastro inicial mantém diálogo e contexto entre turnos sem nova página nem encaminhamento obrigatório',async t=>{
  const f=notionPilot(t),timestamp=Math.floor(Date.now()/1000)-1;
  const c=f.incoming('Meu nome é Cliente Exemplo. Preciso de projeto residencial em Maringá.',phone,{timestamp});await f.app.ai.process();
  f.incoming('Quero continuar conversando. A cozinha será integrada à área gourmet.',phone,{timestamp});await f.app.ai.process();
  f.incoming('Pode resumir o que já contei?',phone,{timestamp});await f.app.ai.process();await f.app.customerContext.processQueue(true);
  assert.equal(f.clientPosts,1);assert.equal(f.app.customerContext.view(c.id).mode,'assisted');assert.equal(f.app.ai.status().handoffs.length,0);
  const requests=f.calls.filter(c=>c.url.includes('api.openai.com'));
  assert.equal(requests.length,3);
  assert.deepEqual(JSON.parse(requests.at(-1).body.input[0].content).messages.map(m=>m.from==='contato'?'in':'out'),['in','out','in','out','in']);
  assert.equal(JSON.parse(requests[0].body.input[0].content).context.clientLinked,false);
  const input=JSON.parse(requests.at(-1).body.input[0].content);
  assert.equal(input.context.clientLinked,true);assert.equal(input.context.notion.client.registration,'Inicial');
  assert.ok(input.messages.some(m=>m.text.includes('cozinha será integrada')));
  assert.equal(input.messages.at(-1).text,'Pode resumir o que já contei?');
  assert.ok(input.context.history.some(e=>e.source==='IA'&&e.qualification==='Interpretado'));
  assert.ok(f.rows[f.history].length>0);
  assert.equal(f.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='out'").get().n,3);
  // Transporte simulado valida continuidade e contexto, não avalia o tom de um modelo real.
});

test('telefone e nome exatos reaproveitam cadastro único sem criar outra página',async t=>{
  const f=notionPilot(t,{existing:'Cliente Exemplo'});const c=f.incoming('Meu nome é Cliente Exemplo. Preciso de projeto residencial em Maringá.');await f.app.ai.process();assert.equal(f.clientPosts,0);assert.equal(f.app.customerContext.view(c.id).client_name,'Cliente Exemplo',f.registrationError);assert.equal(f.app.customerContext.view(c.id).history.find(e=>e.kind==='cliente').source,'IA');
});
test('nome do proprietário mencionado na conversa não vira cadastro do solicitante',async t=>{
  const f=notionPilot(t);f.incoming('Meu nome é Maria. O proprietário é Cliente Exemplo. Preciso de projeto residencial em Maringá.');await f.app.ai.process();assert.equal(f.clientPosts,0);assert.equal(f.app.ai.status().handoffs.length,1);
});
test('saldo esgotado da OpenAI tem diagnóstico específico sem expor o texto privado do fornecedor',async t=>{
  const f=fixture(t,{},async url=>url.includes('openai.com')?Response.json({error:{code:'credit_balance_exhausted',type:'insufficient_quota',message:'test-openai-key'}},{status:429}):undefined);const c=f.incoming();await f.app.ai.process();assert.match(f.app.ai.result(c.id).error,/saldo de API esgotado/);assert.ok(!JSON.stringify(f.app.ai.result(c.id)).includes('test-openai-key'));assert.equal(f.calls.length,1);
});
test('tomada humana durante cadastro impede novas escritas e conserva resultado já despachado para conferência',async t=>{
  for(const stage of ['pauseBeforeCreate','pauseDuringCreate']){
    const f=notionPilot(t,{[stage]:true});const c=f.incoming('Meu nome é Cliente Exemplo. Preciso de projeto residencial em Maringá.');await f.app.ai.process();const ctx=f.app.customerContext.view(c.id);assert.equal(ctx.mode,'human');assert.equal(ctx.client_id,null);assert.equal(f.app.ai.result(c.id).state,'cancelled');assert.equal(f.clientPosts,stage==='pauseBeforeCreate'?0:1);assert.equal(f.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='out'").get().n,0);
    if(stage==='pauseDuringCreate')assert.ok(f.app.db.prepare('SELECT client_id FROM notion_client_operations').get().client_id);
  }
});

test('falha de atualização do Notion permite orientação geral sem apresentar consulta antiga como atual',async t=>{
  const f=notionPilot(t),c=f.incoming('Meu nome é Cliente Exemplo. Preciso de projeto residencial em Maringá.');await f.app.ai.process();
  f.app.customerContext.refresh=async()=>{f.app.db.prepare('UPDATE conversation_context SET last_error=? WHERE conversation_id=?').run('Consulta indisponível',c.id);throw Error('private remote details');};
  f.incoming('Podemos conversar sobre a minha ideia?');await f.app.ai.process();
  const req=f.calls.filter(r=>r.url.includes('api.openai.com')).at(-1),input=JSON.parse(req.body.input[0].content);
  assert.equal(input.context.notionUnavailable,true);assert.equal(input.context.notion,null);assert.deepEqual(input.context.notionHistory,[]);
  assert.equal(f.app.customerContext.view(c.id).mode,'assisted');assert.equal(f.app.ai.status().handoffs.length,0);
  assert.ok(!req.body.input[0].content.includes('private remote details'));
});
