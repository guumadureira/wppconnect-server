import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCentral } from '../server.mjs';
import {samePhone} from '../contact-phone.mjs';

const ids={clients:'11111111-1111-4111-8111-111111111111',history:'22222222-2222-4222-8222-222222222222',works:'33333333-3333-4333-8333-333333333333',proposals:'44444444-4444-4444-8444-444444444444',projects:'55555555-5555-4555-8555-555555555555',tasks:'66666666-6666-4666-8666-666666666666',client:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',work:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',other:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
const rt=text=>({rich_text:[{plain_text:text,text:{content:text}}]}),title=text=>({title:[{plain_text:text,text:{content:text}}]}),relation=id=>({relation:[{id}]}),select=name=>({select:{name}});
const page=(id,source,properties)=>({id,parent:{data_source_id:source},properties});
test('telefone reconhece apenas equivalência móvel brasileira, nunca sufixo ou fixo',()=>{
  assert.equal(samePhone('+55 (44) 99823-1095','554498231095'),true);
  for(const [a,b]of [['554432231095','5544932231095'],['554498231095','554198231095'],['+155498231095','554498231095'],['98231095','554498231095']])assert.equal(samePhone(a,b),false);
});

test('resumo atual atualiza somente campos dedicados no cliente e reconcilia PATCH sem duplicar histórico',async t=>{
  const r=remote(),base=r.transport,p=r.state.rows[ids.clients][0];let patches=0,lost=true;
  for(const [name,type]of Object.entries({'Resumo do atendimento — Central':'rich_text','Pendências — Central':'rich_text','Próximo passo — Central':'rich_text','Atualizado em — Central':'date','Conversa — Central':'url'}))p.properties[name]={type,...(type==='rich_text'?rt(''):{[type]:null})};
  r.transport=async(url,o)=>{
    if(o.method==='PATCH'){
      assert.equal(url,'https://api.notion.com/v1/pages/'+ids.client);patches++;
      const properties=JSON.parse(o.body).properties;
      assert.ok(Object.keys(properties).every(k=>k.endsWith('— Central')));
      for(const [k,v]of Object.entries(properties))p.properties[k]={...p.properties[k],...v};
      p.properties['Atualizado em — Central'].date.start=p.properties['Atualizado em — Central'].date.start.replace('Z','+00:00');
      if(lost){lost=false;throw Error('lost-response');}return Response.json(p);
    }
    return base(url,o);
  };
  const f=await fixture(t,{remoteServer:r,config:{NOTION_CLIENT_SUMMARY_ENABLED:'true'}});await f.bind();
  let ctx=await f.view();
  await f.action('',{version:ctx.version,requestId:'summary-1',summary:'Casa em Sarandi; aguarda matrícula.',missing:'Matrícula',nextStep:'Aguardar documento'},'PATCH');
  await f.app.customerContext.processQueue(true);
  assert.equal(patches,1);assert.equal(f.app.customerContext.status().pendingSummaries,1);
  const historyCount=r.state.historyCreates;
  f.app.db.prepare('UPDATE notion_client_summaries SET next_attempt=0').run();
  await f.app.customerContext.processQueue(true);
  assert.equal(patches,1);assert.equal(f.app.customerContext.status().pendingSummaries,0);assert.equal(r.state.historyCreates,historyCount);
  ctx=await f.view();await f.action('',{version:ctx.version,requestId:'summary-2',summary:'Matrícula recebida; conferir regularização.',missing:'',nextStep:'Conferir documento'},'PATCH');
  await f.app.customerContext.processQueue(true);
  assert.equal(patches,2);assert.equal(p.properties['Pendências — Central'].rich_text[0].text.content,'');
  assert.equal(p.properties['CPF/CNPJ'].rich_text[0].text.content,'PRIVATE-CPF');
  assert.equal(p.properties['Valor do Contrato'].number,987654321);
  assert.ok(r.state.rows[ids.history].some(p=>p.properties.Resumo.rich_text[0].text.content==='Casa em Sarandi; aguarda matrícula.'));
});

test('vínculo automático encaminha eventos antigos para histórico sem incluir ofertas comerciais',async t=>{
  const f=await fixture(t),ctx=await f.view();
  f.app.customerContext.aiRecord(f.chat.id,'prior',{kind:'atendimento',summary:'Necessidade conhecida antes do vínculo',missing:'',nextStep:''},false,{updateCurrent:true,expectedVersion:ctx.version});
  f.app.customerContext.aiRecord(f.chat.id,'offer',{kind:'comercial',summary:'Oferta separada',missing:'',nextStep:''});
  await f.app.customerContext.resolveBeforeReply(f.chat);await f.app.customerContext.processQueue(true);
  assert.ok(f.remote.rows[ids.history].some(p=>p.properties.Resumo.rich_text[0].text.content==='Necessidade conhecida antes do vínculo'));
  assert.ok(f.remote.rows[ids.history].every(p=>p.properties.Resumo.rich_text[0].text.content!=='Oferta separada'));
});
function remote(){
  const rows={
    [ids.clients]:[page(ids.client,ids.clients,{'Nome do Cliente':title('Cliente exemplo'),Telefone:{phone_number:'+55 (44) 99999-1234'},'Etapa do cadastro':select('Inicial'),'Etapa do Atendimento':select('Captação de Cliente'),'CPF/CNPJ':rt('PRIVATE-CPF'),'Valor do Contrato':{number:987654321},'Pasta principal Microsoft 365 — restrita':{url:'https://private.invalid/secret'}})],
    [ids.history]:[],
    [ids.works]:[page(ids.work,ids.works,{Trabalho:title('Projeto de teste'),'Cliente cadastrado':relation(ids.client),Situação:select('Em andamento'),Prazo:{date:{start:'2026-11-10'}},'Valor do Contrato':{number:987654321}})],
    [ids.proposals]:[],[ids.projects]:[],[ids.tasks]:[],
  };
  const state={rows,calls:[],historyCreates:0,clientCreates:0,historyMode:'ok',clientMode:'ok',queryFailure:false};
  const matches=(p,f)=>!f||f.or?(!f||f.or.some(part=>matches(p,part))):f.relation?p.properties[f.property]?.relation?.some(r=>r.id===f.relation.contains):Object.entries(f).filter(([k])=>k!=='property').every(([type,condition])=>{const prop=p.properties[f.property];const val=type==='phone_number'?prop?.phone_number||'':(prop?.title||prop?.rich_text||[]).map(item=>item.plain_text||item.text?.content||'').join('');return condition.equals!==undefined?val===condition.equals:val.toLowerCase().includes(condition.contains.toLowerCase());});
  const transport=async(url,options={})=>{
    assert.match(url,/^https:\/\/api\.notion\.com\/v1\//);assert.equal(options.headers.authorization,'Bearer private-test-notion-token');assert.equal(options.redirect,'error');assert.equal(options.headers['Notion-Version'],'2026-03-11');
    const path=new URL(url).pathname.slice(4),body=options.body?JSON.parse(options.body):undefined;state.calls.push({path,method:options.method,body});
    if(path.startsWith('pages/')&&!options.body){const p=Object.values(rows).flat().find(p=>p.id===path.slice(6));return p?Response.json(p):Response.json({message:'private-test-notion-token'},{status:404});}
    if(path.startsWith('data_sources/')&&path.endsWith('/query')){
      if(state.queryFailure)return Response.json({message:'private-test-notion-token'},{status:503});
      const source=path.split('/')[1],list=(rows[source]||[]).filter(p=>matches(p,body.filter));
      if(source===ids.history&&state.historyMode==='invisible')return Response.json({results:[],has_more:false});
      const offset=Number(body.start_cursor||0),results=list.slice(offset,offset+body.page_size);return Response.json({results,has_more:offset+results.length<list.length,next_cursor:String(offset+results.length)});
    }
    if(path.startsWith('data_sources/')){
      const source=path.split('/')[1],properties=source===ids.clients?{'Nome do Cliente':{type:'title'},Telefone:{type:'phone_number'},'ID de criação na central':{type:'rich_text'}}:{Registro:{type:'title'},'ID do evento':{type:'rich_text'},'Cliente cadastrado':{type:'relation'},'Data do acontecimento':{type:'date'},Resumo:{type:'rich_text'},Qualificação:{type:'select'}};
      return Response.json({id:source,properties});
    }
    assert.equal(path,'pages');assert.deepEqual(body.notifications,{mode:'silent'});
    const source=body.parent.data_source_id;
    if(source===ids.history){state.historyCreates++;if(state.historyMode==='reject')return Response.json({message:'private-test-notion-token'},{status:403});}
    if(source===ids.clients){state.clientCreates++;if(state.clientMode==='reject')return Response.json({message:'private-test-notion-token'},{status:403});}
    const created=page(randomUUID(),source,body.properties);rows[source].push(created);
    if(source===ids.history&&['lost','invisible'].includes(state.historyMode))throw Error('private-test-notion-token');
    if(source===ids.clients&&state.clientMode==='lost')throw Error('private-test-notion-token');
    return Response.json(created);
  };
  return {state,transport};
}

test('verificação distingue cadastro/histórico acessíveis das quatro fontes operacionais sem acesso',async t=>{
  const r=remote(),base=r.transport;
  r.transport=async(url,options)=>Object.values(ids).slice(2,6).some(id=>url.endsWith('/data_sources/'+id))?Response.json({message:'private-test-notion-token'},{status:404}):base(url,options);
  const f=await fixture(t,{remoteServer:r}),diagnostic=await f.app.customerContext.verify();
  assert.equal(diagnostic.accessVerified,true);assert.equal(diagnostic.allConfiguredSourcesVerified,false);assert.equal(diagnostic.pendingSources.length,4);
  assert.deepEqual(diagnostic.pendingSources.map(s=>s.name).sort(),['projects','proposals','tasks','works']);
  assert.ok(!JSON.stringify(diagnostic).includes('private-test-notion-token'));
});
async function fixture(t,{enabled=true,config:extra={},remoteServer=remote()}={}){
  const config={DATABASE_PATH:':memory:',WHATSAPP_MODE:'demo',WHATSAPP_PHONE_NUMBER_ID:'test-phone',NOTION_ENABLED:enabled?'true':'false',NOTION_TOKEN:'private-test-notion-token',...Object.fromEntries(Object.entries(ids).filter(([k])=>['clients','history','works','projects','proposals','tasks'].includes(k)).map(([k,v])=>['NOTION_'+k.toUpperCase()+'_DATA_SOURCE_ID',v])),...extra};
  const app=createCentral(config,remoteServer.transport,{notionRequestIntervalMs:0});t?.after(()=>app.close());await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));config.PUBLIC_ORIGIN='http://127.0.0.1:'+app.server.address().port;
  async function request(path,method='GET',body,cookie,origin=config.PUBLIC_ORIGIN){const r=await fetch(config.PUBLIC_ORIGIN+path,{method,headers:{origin,...(cookie?{cookie}:{}),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const admin={name:'Admin teste',email:'context@example.invalid',password:'test-only-password'};
  if((await request('/api/session')).body.setupRequired)await request('/api/setup','POST',admin);
  const cookie=(await request('/api/login','POST',{...admin,signatureName:'Pessoa da sessão'})).cookie;
  let chat=app.db.prepare('SELECT * FROM conversations').get();
  if(!chat){app.intake({metadata:{phone_number_id:'test-phone'},messages:[{id:'test-message',from:'5544999991234',type:'text',text:{body:'Pedido de teste'},timestamp:Math.floor(Date.now()/1000)}]});chat=app.db.prepare('SELECT * FROM conversations').get();}
  const base='/api/conversations/'+chat.id+'/context';
  const view=async()=>(await request(base,'GET',undefined,cookie)).body;
  const action=(path,body,method='POST',auth=cookie)=>request(base+path,method,body,auth);
  const bind=async()=>action('/link',{clientId:ids.client,confirmed:true,version:(await view()).version,requestId:randomUUID()});
  return {app,config,request,cookie,chat,base,view,action,bind,remote:remoteServer.state};
}

test('contexto e solicitações funcionam sem acesso Notion, com autoria real, idempotência e controle de concorrência',async t=>{
  const f=await fixture(t,{enabled:false});
  assert.equal((await f.request(f.base)).status,401);
  assert.equal((await f.request(f.base,'PATCH',{},f.cookie,'https://other.invalid')).status,403);
  const update={requestId:'context-save',version:0,summary:'Solicita andamento',missing:'Conferir documento',nextStep:'Revisar com responsável',kind:'andamento',source:'IA',actor:'Nome inventado',qualification:'Interpretado'};
  assert.equal((await f.action('',update,'PATCH')).status,200);
  assert.equal((await f.action('',update,'PATCH')).status,200);
  const v=await f.view();assert.equal(v.history.length,1);assert.equal(v.history[0].actor,'Pessoa da sessão');assert.equal(v.history[0].source,'Atendente');assert.equal(v.history[0].sync_state,'waiting_link');
  assert.equal((await f.action('',{...update,requestId:'stale'},'PATCH')).status,409);
  await f.action('/requests',{requestId:'new-request',title:'Andamento do trabalho',kind:'andamento',summary:'Cliente quer posição',status:'Aguardando equipe'});
  await f.action('/requests',{requestId:'new-request',title:'Andamento do trabalho'});
  let current=await f.view();assert.equal(current.requests.length,1);
  const row=current.requests[0];assert.equal((await f.action('/requests/'+row.id,{requestId:'request-update',status:'Resolvida',version:row.version,nextStep:'Concluído'},'PATCH')).status,200);
  assert.equal((await f.action('/requests/'+row.id,{requestId:'request-stale',status:'Em atendimento',version:row.version},'PATCH')).status,409);
  await f.app.customerContext.processQueue();assert.equal(f.remote.calls.length,0);assert.equal((await f.view()).requests[0].status,'Resolvida');
});

test('busca por telefone normalizado, confirma vínculo e retorna somente contexto operacional autorizado',async t=>{
  const f=await fixture(t);
  const found=await f.action('/lookup',{query:''});assert.equal(found.status,200);assert.equal(found.body.matches.length,1);assert.equal(found.body.matches[0].phoneMatches,true);
  assert.equal((await f.action('/link',{clientId:ids.client,confirmed:false,version:0,requestId:'no-confirm'})).status,400);
  assert.equal((await f.bind()).status,200);await f.app.customerContext.processQueue();
  const refreshed=await f.action('/refresh',{});assert.equal(refreshed.status,200);assert.equal(refreshed.body.snapshot.sections.works.rows[0].status,'Em andamento');
  const result=JSON.stringify([found,refreshed]);for(const secret of ['PRIVATE-CPF','987654321','private.invalid','private-test-notion-token'])assert.ok(!result.includes(secret));
  assert.equal((await f.action('',{version:refreshed.body.version,requestId:'work-context',summary:'Frente conferida',workId:ids.work,qualification:'Confirmado'},'PATCH')).status,200);
  await f.app.customerContext.processQueue();const events=f.remote.rows[ids.history];assert.ok(events.length>=2);assert.ok(events.every(p=>p.properties['Cliente cadastrado'].relation[0].id===ids.client));
  const doc=f.remote.calls.find(c=>c.path==='pages').body;assert.equal(doc.notifications.mode,'silent');assert.ok(!JSON.stringify(doc).includes('PRIVATE-CPF'));
});

test('configuração aceita UUID com espaços e prefixo collection sem expor seus valores',async t=>{
  const f=await fixture(t,{config:{NOTION_ENABLED:' true ',NOTION_TOKEN:' private-test-notion-token ',NOTION_CLIENTS_DATA_SOURCE_ID:'  collection://'+ids.clients+'  ',NOTION_HISTORY_DATA_SOURCE_ID:' '+ids.history+' '}});
  const status=(await f.request('/api/notion/status','GET',undefined,f.cookie)).body;assert.equal(status.enabled,true);assert.deepEqual(status.invalid,[]);
  const verified=await f.request('/api/notion/verify','POST',{},f.cookie);assert.equal(verified.status,200);assert.equal(verified.body.accessVerified,true);
  assert.ok(!JSON.stringify(status).includes('private-test-notion-token'));
});

test('ID configurado inválido informa o campo exato e não impede a saúde do servidor',async t=>{
  const f=await fixture(t,{config:{NOTION_CLIENTS_DATA_SOURCE_ID:'NOTION_CLIENTS_DATA_SOURCE_ID=private-test-value'}});
  assert.equal((await f.request('/healthz')).status,200);
  const status=(await f.request('/api/notion/status','GET',undefined,f.cookie)).body;assert.equal(status.enabled,false);assert.deepEqual(status.invalid,['NOTION_CLIENTS_DATA_SOURCE_ID']);
  const verified=await f.request('/api/notion/verify','POST',{},f.cookie);assert.equal(verified.status,400);assert.match(verified.body.error,/NOTION_CLIENTS_DATA_SOURCE_ID/);assert.ok(!JSON.stringify({status,verified}).includes('private-test-value'));assert.equal(f.remote.calls.length,0);
});

test('erro de acesso à fonte identifica a variável sem reproduzir resposta privada do Notion',async t=>{
  const remoteServer=remote();remoteServer.transport=async()=>Response.json({message:'private-test-value'},{status:404});
  const f=await fixture(t,{remoteServer});const result=await f.request('/api/notion/verify','POST',{},f.cookie);
  assert.equal(result.status,502);assert.match(result.body.error,/NOTION_CLIENTS_DATA_SOURCE_ID/);assert.ok(!JSON.stringify(result).includes('private-test-value'));
});

test('telefone divergente exige administrador e motivo; trabalho de outro cliente é recusado',async t=>{
  const f=await fixture(t);f.remote.rows[ids.clients].push(page(ids.other,ids.clients,{'Nome do Cliente':title('Outro cadastro'),Telefone:{phone_number:'5544000000000'}}));
  assert.equal((await f.action('/link',{clientId:ids.other,confirmed:true,version:0,requestId:'different'})).status,409);
  assert.equal((await f.action('/link',{clientId:ids.other,confirmed:true,reason:'Conferido com o contato',version:0,requestId:'different-reviewed'})).status,200);
  let c=await f.view();assert.equal((await f.action('',{requestId:'wrong-work',version:c.version,workId:ids.work,summary:'Teste'},'PATCH')).status,409);
  const agent={name:'Atendente',email:'other@example.invalid',password:'test-only-password'};await f.request('/api/agents','POST',agent,f.cookie);const cookie=(await f.request('/api/login','POST',agent)).cookie;
  assert.equal((await f.action('/link',{clientId:ids.client,confirmed:true,reason:'Teste',version:c.version,requestId:'agent-change'},'POST',cookie)).status,409);
});

test('vários cadastros com telefone coincidente impedem criação automática de outro',async t=>{
  const f=await fixture(t);f.remote.rows[ids.clients].push(page(ids.other,ids.clients,{'Nome do Cliente':title('Outro contato compartilhado'),Telefone:{phone_number:'5544999991234'}}));
  const found=await f.action('/lookup',{});assert.equal(found.body.matches.length,2);
  const created=await f.action('/client',{name:'Pessoa exemplo',requestId:'duplicate-test',version:0});assert.equal(created.status,409);assert.equal(f.remote.clientCreates,0);
});

test('busca percorre páginas antes de concluir o vínculo e trata limite de consulta como incompleto',async t=>{
  const f=await fixture(t),target=f.remote.rows[ids.clients][0];
  f.remote.rows[ids.clients]=Array.from({length:100},(_,i)=>page(randomUUID(),ids.clients,{'Nome do Cliente':title('Contato '+i),Telefone:{phone_number:'5533'+String(i).padStart(5,'0')+'1234'}}));f.remote.rows[ids.clients].push(target);
  const found=await f.action('/lookup',{});assert.equal(found.body.matches.length,1);assert.equal(found.body.matches[0].id,ids.client);assert.equal(found.body.complete,true);assert.ok(f.remote.calls.some(call=>call.body?.start_cursor==='100'));
  f.remote.rows[ids.clients]=Array.from({length:1001},(_,i)=>page(randomUUID(),ids.clients,{'Nome do Cliente':title('Contato '+i),Telefone:{phone_number:f.chat.phone}}));
  assert.equal((await f.action('/lookup',{})).body.complete,false);
  assert.equal((await f.action('/client',{name:'Novo cadastro',version:0,requestId:'partial-lookup'})).status,409);assert.equal(f.remote.clientCreates,0);
});

test('arquivos recebidos geram um registro de recebimento, sem afirmar validação do documento',async t=>{
  const f=await fixture(t,{enabled:false});const incoming={metadata:{phone_number_id:'test-phone'},messages:[{id:'document-message',from:f.chat.phone,type:'document',document:{id:'remote-file',mime_type:'application/pdf',filename:'matricula.pdf'}}]};
  f.app.intake(incoming);f.app.intake(incoming);const c=await f.view();assert.equal(c.history.length,1);assert.equal(c.history[0].kind,'arquivo');assert.equal(c.history[0].qualification,'Informado');assert.equal(c.history[0].source,'Cliente');assert.equal(c.history[0].summary,'Documento recebido');assert.equal(f.remote.calls.length,0);
});

test('resultado incerto de histórico é reconciliado por ID, sem repetir criação nem expor erro remoto',async t=>{
  const f=await fixture(t);await f.bind();await f.app.customerContext.processQueue();
  f.remote.historyMode='lost';let c=await f.view();
  await f.action('',{version:c.version,requestId:'uncertain-history',summary:'Documento pendente'},'PATCH');await f.app.customerContext.processQueue();
  c=await f.view();const event=c.history.find(e=>e.summary==='Documento pendente');assert.equal(event.sync_state,'uncertain');assert.ok(!JSON.stringify(c).includes('private-test-notion-token'));
  const count=f.remote.historyCreates;f.remote.historyMode='ok';await f.app.customerContext.processQueue(true);
  assert.equal(f.remote.historyCreates,count);assert.equal((await f.view()).history.find(e=>e.id===event.id).sync_state,'synced');
});

test('criação incerta sem correspondência visível não é repetida automaticamente',async t=>{
  const f=await fixture(t);await f.bind();await f.app.customerContext.processQueue();
  f.remote.historyMode='invisible';const c=await f.view();await f.action('',{version:c.version,requestId:'invisible-history',summary:'Conferir resultado'},'PATCH');await f.app.customerContext.processQueue();const count=f.remote.historyCreates;
  await f.app.customerContext.processQueue(true);assert.equal(f.remote.historyCreates,count);assert.equal((await f.view()).history.find(e=>e.summary==='Conferir resultado').sync_state,'uncertain');
});

test('cadastro inicial perdido na resposta é localizado pela chave de criação antes de nova tentativa',async t=>{
  const f=await fixture(t);f.remote.rows[ids.clients]=[];f.remote.clientMode='lost';
  const body={name:'Solicitante teste',city:'Maringá',version:0,requestId:'create-client'};
  assert.equal((await f.action('/client',body)).status,502);assert.equal(f.remote.clientCreates,1);f.remote.clientMode='ok';
  const recovered=await f.action('/client',body);assert.equal(recovered.status,200);assert.equal(f.remote.clientCreates,1);assert.equal(recovered.body.client_name,'Solicitante teste');
  const created=f.remote.rows[ids.clients][0];assert.equal(created.properties['Etapa do cadastro'].select.name,'Inicial');assert.equal(created.properties.Telefone.phone_number,f.chat.phone);assert.equal(created.properties['CPF/CNPJ'],undefined);
});

test('falha definida de cadastro permite repetir a mesma operação e nome existente exige conferência',async t=>{
  const f=await fixture(t);f.remote.rows[ids.clients][0].properties.Telefone.phone_number='554400001111';
  const duplicate=await f.action('/client',{name:'Cliente exemplo',version:0,requestId:'same-name'});assert.equal(duplicate.status,409);assert.equal(f.remote.clientCreates,0);
  f.remote.clientMode='reject';const body={name:'Novo solicitante',version:0,requestId:'rejected-client'};
  assert.equal((await f.action('/client',body)).status,502);f.remote.clientMode='ok';
  const created=await f.action('/client',body);assert.equal(created.status,200);assert.equal(f.remote.clientCreates,2);assert.equal(f.remote.rows[ids.clients].filter(p=>p.properties['Nome do Cliente'].title[0].text?.content==='Novo solicitante').length,1);
});

test('consulta indisponível preserva contexto anterior e resumo local pode ser salvo com vínculo já conferido',async t=>{
  const f=await fixture(t);await f.bind();await f.action('/refresh',{});let c=await f.view();
  await f.action('',{version:c.version,workId:ids.work,summary:'Resumo inicial',requestId:'initial-local'},'PATCH');await f.app.customerContext.processQueue();
  f.remote.queryFailure=true;assert.equal((await f.action('/refresh',{})).status,502);c=await f.view();assert.ok(c.snapshot);assert.ok(c.last_error);
  f.config.NOTION_ENABLED='false';assert.equal((await f.action('',{version:c.version,workId:ids.work,summary:'Atualização enquanto offline',requestId:'offline-save'},'PATCH')).status,200);assert.equal((await f.view()).summary,'Atualização enquanto offline');
});

test('assumir e liberar assistência são locais e não habilitam respostas automáticas nem mudam com nova mensagem',async t=>{
  const f=await fixture(t,{enabled:false});let c=await f.view();
  await f.action('/control',{mode:'assisted',version:c.version,requestId:'release'});c=await f.view();assert.equal(c.mode,'assisted');assert.equal(c.integration.aiEnabled,false);
  await f.action('/control',{mode:'human',version:c.version,requestId:'take'});assert.equal((await f.view()).mode,'human');
  f.app.intake({metadata:{phone_number_id:'test-phone'},messages:[{id:'second-message',from:f.chat.phone,type:'text',text:{body:'Outra pergunta'}}]});assert.equal((await f.view()).mode,'human');assert.equal(f.remote.calls.length,0);assert.equal(f.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='out'").get().n,0);
});

test('histórico e solicitações persistem ao reiniciar o banco e dados existentes permanecem',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'central-context-')),remoteServer=remote(),config={DATABASE_PATH:join(dir,'central.sqlite')};let f;
  try{f=await fixture(null,{enabled:false,config,remoteServer});await f.action('',{requestId:'persist-context',version:0,summary:'Retomar atendimento'},'PATCH');await f.action('/requests',{requestId:'persist-request',title:'Conferir arquivo',kind:'documentos'});await f.app.close();f=null;f=await fixture(null,{enabled:false,config,remoteServer});const c=await f.view();assert.equal(c.summary,'Retomar atendimento');assert.equal(c.requests.length,1);assert.equal(c.history.length,2);assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,1);}finally{if(f)await f.app.close();rmSync(dir,{recursive:true,force:true});}
});


test('primeiro contato localiza cadastro e lê apenas seções de atendimento antes de criar resposta',async t=>{
  const r=remote(),base=r.transport;
  r.transport=async(url,o)=>url.includes('/blocks/')?Response.json({results:[
    {type:'paragraph',paragraph:{rich_text:[{plain_text:'PRIVATE fora da seção'}]}},
    {type:'heading_2',heading_2:{rich_text:[{plain_text:'Contexto básico de atendimento'}]}},
    {type:'paragraph',paragraph:{rich_text:[{plain_text:'Documentação em subdivisão; consultar serviço atual antes de informar andamento.'}]}},
    {type:'heading_2',heading_2:{rich_text:[{plain_text:'Acessos internos'}]}},
    {type:'paragraph',paragraph:{rich_text:[{plain_text:'PRIVATE link e financeiro'}]}}
  ],has_more:false}):base(url,o);
  const f=await fixture(t,{remoteServer:r});
  const result=await f.app.customerContext.resolveBeforeReply(f.chat);
  assert.equal(result.state,'matched_by_phone');assert.equal((await f.view()).client_id,ids.client);
  const context=await f.app.customerContext.refresh(f.chat);
  assert.match(context.snapshot.attendance.text,/Documentação em subdivisão/);
  assert.ok(!JSON.stringify(context.snapshot.attendance).includes('PRIVATE'));
  assert.equal(r.state.clientCreates,0);
  assert.equal((await f.app.customerContext.resolveBeforeReply(f.chat)).state,'linked');
});

test('busca ambígua, incompleta ou ultrapassada não vincula nem cria cliente',async t=>{
  for(const mode of ['duplicate','partial','stale']){
    const r=remote(),base=r.transport;
    r.transport=async(url,o)=>{
      if(url.includes('/data_sources/'+ids.clients+'/query')){
        if(mode==='duplicate'){const a=await (await base(url,o)).json();return Response.json({results:[...a.results,{...a.results[0],id:ids.other}],has_more:false});}
        if(mode==='partial')return Response.json({results:[],has_more:true,next_cursor:'next'});
      }
      return base(url,o);
    };
    const f=await fixture(t,{remoteServer:r});
    await assert.rejects(f.app.customerContext.resolveBeforeReply(f.chat,()=>mode!=='stale'),{status:409});
    assert.equal((await f.view()).client_id,null);assert.equal(r.state.clientCreates,0);
  }
});


test('busca em fila reconhece cliente mesmo com atendimento por IA desligado',async t=>{
 const f=await fixture(t);assert.equal(f.app.ai.status().enabled,false);
 await f.app.customerContext.processLookups();
 assert.equal((await f.view()).client_id,ids.client);
 assert.equal((await f.view()).discovery.state,'matched_by_phone');
 assert.equal(f.remote.clientCreates,0);
 assert.equal(f.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='out'").get().n,0);
});
