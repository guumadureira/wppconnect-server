import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCentral} from '../server.mjs';

// Entirely synthetic WhatsApp and Notion transport. Never makes a network call.
const clientsId='11111111-1111-4111-8111-111111111111';
const historyId='22222222-2222-4222-8222-222222222222';
const clientId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rich=value=>({type:'rich_text',rich_text:[{text:{content:value},plain_text:value}]});
const title=value=>({type:'title',title:[{text:{content:value},plain_text:value}]});
const text=prop=>(prop?.title||prop?.rich_text||[]).map(x=>x.plain_text??x.text?.content??'').join('');
function fakeRemote(){
  const client={id:clientId,parent:{type:'data_source_id',data_source_id:clientsId},archived:false,in_trash:false,
    properties:{
      'Nome do Cliente':title('Cliente Fictício'),
      'Telefone':{type:'phone_number',phone_number:'+55 44 99999-1234'},
      'Etapa do Atendimento':{type:'select',select:{name:'Em andamento'}},
      'Resumo do atendimento — Central':rich('Resumo antigo'),
      'Pendências — Central':rich('Verificar proposta'),
      'Próximo passo — Central':rich('Conferir documentação'),
      'Atualizado em — Central':{type:'date',date:null},
      'Conversa — Central':{type:'url',url:null},
      'Valor do Contrato':{type:'number',number:88888}
    }};
  const state={history:[],client,notionReads:0,notionPatches:0,modelCalls:[],destinations:[]};
  const transport=async(url,options={})=>{
    state.destinations.push(url);
    if(url==='https://api.openai.com/v1/responses'){
      const request=JSON.parse(options.body);
      assert.equal(request.store,false);
      const payload=JSON.parse(request.input[0].content);
      state.modelCalls.push(payload);
      const latest=payload.messages.at(-1);
      assert.ok(latest);
      const result={summary:'Contexto atualizado após: '+latest.text,
        missing:'Conferir documentação',nextStep:'Equipe verifica documentação',
        kind:'andamento'};
      return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
    }
    if(!url.startsWith('https://api.notion.com/v1/'))throw Error('Unexpected external destination: '+url);
    const path=new URL(url).pathname.slice('/v1/'.length);
    const body=options.body?JSON.parse(options.body):undefined;
    assert.equal(options.headers['Notion-Version'],'2026-03-11');
    state.notionReads++;
    if(path==='pages/'+clientId&&options.method==='GET')return Response.json(client);
    if(path==='blocks/'+clientId+'/children')return Response.json({results:[],has_more:false,next_cursor:null});
    if(path==='pages/'+clientId&&options.method==='PATCH'){
      for(const [key,value]of Object.entries(body.properties)){
        assert.ok(['Resumo do atendimento — Central','Pendências — Central','Próximo passo — Central','Atualizado em — Central','Conversa — Central'].includes(key));
        client.properties[key]={...client.properties[key],...value};
      }
      state.notionPatches++;
      return Response.json(client);
    }
    if(path.startsWith('data_sources/')&&path.endsWith('/query')){
      const source=path.split('/')[1];
      let rows=[];
      if(source===clientsId)rows=[client];
      if(source===historyId){
        rows=state.history;
        if(body.filter?.property==='ID do evento'){
          rows=rows.filter(p=>text(p.properties['ID do evento'])===body.filter.rich_text.equals);
        }else if(body.filter?.property==='Cliente cadastrado'){
          rows=rows.filter(p=>p.properties['Cliente cadastrado']?.relation?.some(r=>r.id===clientId));
        }
      }
      return Response.json({results:rows,has_more:false,next_cursor:null});
    }
    if(path==='pages'&&options.method==='POST'){
      assert.equal(body.parent.data_source_id,historyId);
      const event={id:randomUUID(),parent:{type:'data_source_id',data_source_id:historyId},
        properties:body.properties,archived:false,in_trash:false};
      state.history.push(event);
      return Response.json(event);
    }
    throw Error('Unexpected Notion request: '+options.method+' '+path);
  };
  return {transport,state};
}

test('webhook fictício de cliente e eco Business atualizam o mesmo contexto e campos Notion',async t=>{
  const remote=fakeRemote();
  const config={DATABASE_PATH:':memory:',WHATSAPP_MODE:'demo',WHATSAPP_PHONE_NUMBER_ID:'test-phone',
    NOTION_ENABLED:'true',NOTION_CLIENT_SUMMARY_ENABLED:'true',
    NOTION_TOKEN:'fake-notion-token-only-for-tests',
    NOTION_CLIENTS_DATA_SOURCE_ID:clientsId,NOTION_HISTORY_DATA_SOURCE_ID:historyId,
    CONTEXT_RECONCILIATION_ENABLED:'true',CONTEXT_RECONCILIATION_MONTHLY_BUDGET_USD:'1',
    OPENAI_API_KEY:'fake-openai-key-only-for-tests',
    NOTION_AUTO_REGISTER_CONTACTS:'false'};
  const app=createCentral(config,remote.transport,{notionRequestIntervalMs:0});
  t.after(()=>app.close());
  const inbound={metadata:{phone_number_id:'test-phone'},messages:[{
    id:'wamid.test.in-1',from:'5544999991234',type:'text',
    text:{body:'Olá, preciso de informações da obra'},timestamp:Math.floor(Date.now()/1000)
  }]};
  app.intake(inbound);
  const conversation=app.db.prepare('SELECT * FROM conversations LIMIT 1').get();
  assert.ok(conversation);
  // The existing client is linked without creating or modifying a real Notion page.
  const actor={id:'fake-admin',role:'admin',signatureName:'Administradora de teste'};
  const current=app.customerContext.view(conversation.id);
  await app.customerContext.link(conversation,
    {confirmed:true,clientId,version:current.version,requestId:'link-fixture-1'},actor);
  const echo={metadata:{phone_number_id:'test-phone',display_phone_number:'5544000000002'},
    message_echoes:[{id:'wamid.test.echo-1',from:'5544000000002',to:conversation.phone,
      type:'text',text:{body:'Conferirei o documento e retornarei amanhã'},
      timestamp:Math.floor(Date.now()/1000)}]};
  app.intake(echo,'smb_message_echoes');
  app.intake(echo,'smb_message_echoes'); // Duplicate webhook is ignored.
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='out'").get().n,1);
  await app.reconciliation.process();
  const summary=app.customerContext.view(conversation.id);
  assert.match(summary.summary,/Conferirei o documento/);
  assert.equal(summary.kind,'andamento');
  assert.equal(remote.state.modelCalls.length,1);
  const modelInput=remote.state.modelCalls[0];
  assert.deepEqual(modelInput.messages.map(m=>m.direction),['in','out']);
  assert.equal(modelInput.notion.summary,'Resumo antigo');
  await app.customerContext.processQueue(true);
  const after=remote.state.client.properties;
  assert.equal(text(after['Resumo do atendimento — Central']),summary.summary);
  assert.equal(after['Valor do Contrato'].number,88888);
  assert.equal(remote.state.notionPatches,1);
  const reconciliations=remote.state.history.filter(p=>
    text(p.properties['ID do evento'])&&text(p.properties.Resumo)===summary.summary);
  assert.equal(reconciliations.length,1);
  assert.equal(reconciliations[0].properties.Qualificação.select.name,'Interpretado');
  const businessEvents=remote.state.history.filter(p=>
    text(p.properties.Resumo).includes('WhatsApp Business'));
  assert.equal(businessEvents.length,1);

  // A subsequent inbound message must revise both local and canonical context.
  app.intake({metadata:{phone_number_id:'test-phone'},messages:[{
    id:'wamid.test.in-2',from:'5544999991234',type:'text',
    text:{body:'Acabei de encaminhar a matrícula'},timestamp:Math.floor(Date.now()/1000)
  }]});
  await app.reconciliation.process();
  await app.customerContext.processQueue(true);
  const last=app.customerContext.view(conversation.id);
  assert.match(last.summary,/matrícula/);
  assert.equal(text(remote.state.client.properties['Resumo do atendimento — Central']),last.summary);
  assert.equal(remote.state.notionPatches,2);
  assert.equal(remote.state.modelCalls.length,2);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM service_events WHERE event_key LIKE 'reconcile:%'").get().n,2);
  assert.ok(remote.state.destinations.every(url=>url.startsWith('https://api.notion.com/v1/')||url==='https://api.openai.com/v1/responses'));
});
