import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCentral} from '../server.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
const phone='5544000000001',key='test-mcp-credential-12345678901234567890';
async function fixture(t,extra={},transport){
  const calls=[],config={DATABASE_PATH:':memory:',WHATSAPP_MODE:'live',WHATSAPP_PHONE_NUMBER_ID:'fake-phone',WHATSAPP_ACCESS_TOKEN:'fake-meta',META_APP_SECRET:'fake-secret',WEBHOOK_VERIFY_TOKEN:'fake-verify',META_GRAPH_VERSION:'v25.0',CENTRAL_MCP_ENABLED:'true',CENTRAL_MCP_TOKEN:key,CENTRAL_MCP_ALLOWED_PHONES:phone,CENTRAL_MCP_SEND_ENABLED:'true',...extra};
  const app=createCentral(config,async(url,options)=>{calls.push({url,options});return transport?transport(url,options,app):Response.json({messages:[{id:'fake-message-'+calls.length}]});});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const post=(rpc,headers={},method='POST')=>fetch(base+'/mcp',{method,headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json, text/event-stream',...headers},...(method==='POST'?{body:JSON.stringify(rpc)}:{})});
  const tool=async(name,args)=>{const response=await post({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}});assert.equal(response.status,200);return(await response.json()).result;};
  let seq=0;const incoming=(body='Olá',from=phone)=>{app.intake({metadata:{phone_number_id:'fake-phone'},messages:[{id:'in-'+(++seq),from,type:'text',text:{body},timestamp:Math.floor(Date.now()/1000)}]});return app.db.prepare('SELECT * FROM conversations WHERE phone=?').get(from);};
  const prepare=async(texto='Mensagem autorizada')=>(await tool('preparar_envio',{telefone:phone,texto,requestId:randomUUID()})).structuredContent;
  const send=d=>tool('confirmar_envio',{envioId:d.envioId,resumoCriptografico:d.resumoCriptografico,autorizadoPeloUsuario:true});
  return{app,base,post,tool,incoming,prepare,send,calls};
}
test('MCP exige credencial própria, origem válida e não aceita cookie como autorização',async t=>{
  const f=await fixture(t),rpc={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}};
  assert.equal((await f.post(rpc,{authorization:'',cookie:'central_session=fake'})).status,401);
  assert.equal((await f.post(rpc,{origin:'https://evil.invalid'})).status,403);
  assert.equal((await f.post(rpc,{'mcp-protocol-version':'invalid'})).status,400);
  assert.equal((await f.post(rpc,{},'GET')).status,405);
  const init=await(await f.post(rpc)).json();assert.equal(init.result.protocolVersion,'2025-06-18');
  assert.equal((await f.post({jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
  const list=await(await f.post({jsonrpc:'2.0',id:2,method:'tools/list'})).json();assert.equal(list.result.tools.length,7);
  assert.ok(list.result.tools.find(x=>x.name==='confirmar_envio').annotations.destructiveHint);
  assert.equal((await fetch(f.base+'/api/state',{headers:{authorization:'Bearer '+key}})).status,401);
  assert.ok(!JSON.stringify(init).includes(key));assert.equal(f.calls.length,0);
});
test('conexão desativada, token curto ou lista vazia não concede acesso',async t=>{
  for(const extra of [{CENTRAL_MCP_ENABLED:'false'},{CENTRAL_MCP_TOKEN:'short'},{CENTRAL_MCP_ALLOWED_PHONES:''}]){
    const f=await fixture(t,extra);assert.equal((await f.post({jsonrpc:'2.0',id:1,method:'tools/list'})).status,503);
  }
});
test('consulta escopada e preparação não enviam; confirmação repete resultado sem duplicar',async t=>{
  const f=await fixture(t);f.incoming('Mensagem do piloto');f.incoming('Privado de outro cliente','5544000000002');
  assert.equal((await f.tool('consultar_conversa',{telefone:'5544000000002'})).isError,true);
  const read=await f.tool('consultar_conversa',{telefone:phone});assert.equal(read.structuredContent.mensagens.length,1);assert.ok(!JSON.stringify(read).includes('Privado de outro'));
  const requestId=randomUUID(),args={telefone:phone,texto:'Olá, segue o retorno aprovado.',requestId};
  const d=(await f.tool('preparar_envio',args)).structuredContent;
  assert.equal((await f.tool('preparar_envio',args)).structuredContent.envioId,d.envioId);
  assert.equal((await f.tool('preparar_envio',{...args,texto:'Alterado'})).isError,true);assert.equal(f.calls.length,0);
  assert.equal((await f.tool('confirmar_envio',{envioId:d.envioId,resumoCriptografico:'outro',autorizadoPeloUsuario:true})).isError,true);
  const sent=(await f.send(d)).structuredContent;assert.equal(sent.estado,'sent');assert.equal(sent.entregaConfirmada,false);
  await f.send(d);assert.equal(f.calls.length,1);assert.equal(JSON.parse(f.calls[0].options.body).to,phone);
  const message=f.app.db.prepare("SELECT * FROM messages WHERE direction='out'").get();assert.equal(message.agent_name,'Notion · integração');
  assert.equal(f.app.db.prepare("SELECT COUNT(*) AS n FROM service_events WHERE actor='Notion · integração'").get().n,1);
  f.app.intake({metadata:{phone_number_id:'fake-phone'},statuses:[{id:message.provider_id,status:'delivered'}]});
  assert.equal((await f.tool('consultar_envio',{envioId:d.envioId})).structuredContent.entregaConfirmada,true);
});
test('janela encerrada, nova mensagem, tomada humana, prévia expirada e envio desativado bloqueiam despacho',async t=>{
  for(const change of ['window','incoming','human','expired','disabled']){
    const f=await fixture(t,change==='disabled'?{CENTRAL_MCP_SEND_ENABLED:'false'}:{}),c=f.incoming(),d=await f.prepare();
    if(change==='window')f.app.db.prepare('UPDATE conversations SET last_inbound=?').run(Date.now()-90000000);
    if(change==='incoming')f.incoming('Mudou minha solicitação');
    if(change==='human'){f.app.db.prepare("UPDATE conversation_context SET mode='assisted' WHERE conversation_id=?").run(c.id);f.app.ai.pause(c.id);}
    if(change==='expired')f.app.db.prepare('UPDATE integration_drafts SET expires=0').run();
    assert.equal((await f.send(d)).isError,true,change);assert.equal(f.calls.length,0,change);
  }
});
test('confirmações concorrentes e retorno incerto nunca repetem envio',async t=>{
  let finish,started;const wait=new Promise(r=>finish=r),began=new Promise(r=>started=r);
  const f=await fixture(t,{},async()=>{started();await wait;throw Error('fake-meta private error');});f.incoming();const d=await f.prepare(),first=f.send(d);await began;
  const second=await f.send(d);assert.equal(second.structuredContent.estado,'sending');finish();
  const result=await first;assert.equal(result.structuredContent.estado,'unknown');assert.ok(!JSON.stringify(result).includes('fake-meta'));
  await f.send(d);assert.equal(f.calls.length,1);
});
test('anexo alheio e parâmetros não declarados são recusados',async t=>{
  const f=await fixture(t);f.incoming();
  assert.equal((await f.tool('preparar_envio',{telefone:phone,texto:'Documento',requestId:randomUUID(),anexoId:randomUUID()})).isError,true);
  assert.equal((await f.tool('consultar_conversa',{telefone:phone,sql:'SELECT * FROM agents'})).isError,true);
  assert.equal(f.calls.length,0);
});
test('anexo da conversa passa por prévia e upload; nova mensagem durante upload cancela despacho',async t=>{
  for(const interrupt of [false,true]){
    let f;f=await fixture(t,{},async(url)=>{
      if(url.endsWith('/media')){if(interrupt)f.incoming('Aguarde, preciso corrigir o documento.');return Response.json({id:'fake-upload'});}
      return Response.json({messages:[{id:'fake-sent'}]});
    });
    const c=f.incoming(),req=Readable.from([Buffer.from('%PDF-1.4\nconteudo ficticio')]);req.headers={'content-type':'application/pdf'};
    const a=await f.app.media.upload(req,new URLSearchParams({kind:'document',name:'teste.pdf'}));
    const m=f.app.db.prepare('SELECT id FROM messages WHERE conversation_id=?').get(c.id);f.app.media.link(m.id,a.id);
    const d=(await f.tool('preparar_envio',{telefone:phone,texto:'Documento aprovado',anexoId:a.id,requestId:randomUUID()})).structuredContent;
    assert.equal(d.anexo.nome,'teste.pdf');assert.equal(d.anexo.sha256.length,64);assert.equal(f.calls.length,0);
    const sent=await f.send(d);assert.equal(sent.structuredContent.estado,interrupt?'failed':'sent');
    assert.equal(f.calls.filter(c=>c.url.endsWith('/messages')).length,interrupt?0:1);
  }
});
test('erro 500 da Meta conserva resultado incerto sem revelar erro remoto',async t=>{
  const f=await fixture(t,{},async()=>Response.json({error:{message:'fake-meta secret'}},{status:500}));f.incoming();const d=await f.prepare();
  const r=await f.send(d);assert.equal(r.structuredContent.estado,'unknown');assert.ok(!JSON.stringify(r).includes('fake-meta secret'));
  await f.send(d);assert.equal(f.calls.length,1);
});
test('reinício conserva resultado desconhecido sem reenvio e rotação revoga token antigo',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'central-mcp-')),path=join(directory,'db.sqlite');
  const f=await fixture(t,{DATABASE_PATH:path});const c=f.incoming(),d=await f.prepare();
  f.app.db.prepare("UPDATE integration_drafts SET state='sending' WHERE id=?").run(d.envioId);
  await f.app.close();
  // Prevent the fixture cleanup from closing the database twice.
  f.app.close=async()=>{};
  const next=await fixture(t,{DATABASE_PATH:path,CENTRAL_MCP_TOKEN:key+'rotated'});
  assert.equal((await next.post({jsonrpc:'2.0',id:1,method:'tools/list'})).status,401);
  assert.equal(next.app.db.prepare('SELECT state FROM integration_drafts WHERE id=?').get(d.envioId).state,'unknown');
  assert.equal(next.app.db.prepare('SELECT id FROM conversations WHERE id=?').get(c.id).id,c.id);
  await next.app.close();next.app.close=async()=>{};rmSync(directory,{recursive:true,force:true});
});
