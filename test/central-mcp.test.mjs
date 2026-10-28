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
  const list=await(await f.post({jsonrpc:'2.0',id:2,method:'tools/list'})).json();assert.equal(list.result.tools.length,11);
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

const pageId='11111111-1111-4111-8111-111111111111',blockId='22222222-2222-4222-8222-222222222222';
const notionConfig={NOTION_ENABLED:'true',NOTION_TOKEN:'test-only-notion-token'};
function documentTransport(state={}){
  return async(url,options)=>{
    if(url.startsWith('https://api.notion.com/v1/')){
      assert.equal(options.headers.authorization,'Bearer test-only-notion-token');assert.equal(options.redirect,'error');
      if(state.denied)return Response.json({message:'test-only-notion-token'},{status:404});
      if(url.endsWith('/pages/'+pageId))return Response.json({id:pageId,properties:{Nome:{type:'title',title:[{plain_text:'Proposta de teste'}]}}});
      if(url.includes('/children'))return Response.json({results:[{id:blockId,type:'file',file:{type:'file',name:'proposta.pdf',file:{url:state.url||'https://prod-files-secure.s3.us-west-2.amazonaws.com/test/proposta.pdf?signature=private-test',expiry_time:new Date(Date.now()+3600000).toISOString()}}}],has_more:false});
      throw Error('Unexpected Notion path');
    }
    if(url.includes('amazonaws.com')){
      state.downloads=(state.downloads||0)+1;assert.equal(options.headers,undefined);assert.equal(options.redirect,'error');
      if(state.onDownload)await state.onDownload();
      return new Response(state.bytes||Buffer.from('%PDF-1.4\nDocumento ficticio'),{headers:{'content-type':'application/pdf'}});
    }
    if(url.endsWith('/media'))return Response.json({id:'fake-document-upload'});
    if(url.endsWith('/messages'))return Response.json({messages:[{id:'fake-document-message'}]});
    throw Error('Forbidden transport');
  };
}
async function selectDocument(f){
  const r=await f.tool('listar_documentos_notion',{telefone:phone,paginaId:pageId});assert.equal(r.isError,undefined);
  assert.ok(!JSON.stringify(r).includes('private-test'));assert.ok(!JSON.stringify(r).includes('test-only-notion-token'));
  return{telefone:phone,paginaId:pageId,arquivoId:r.structuredContent.documentos[0].arquivoId,texto:'Segue a proposta para conferir.',requestId:randomUUID()};
}
test('documento do Notion é copiado para conversa exata e só enviado após confirmação, sem duplicação',async t=>{
  const state={},f=await fixture(t,notionConfig,documentTransport(state)),c=f.incoming();
  const args=await selectDocument(f),d=(await f.tool('preparar_documento_notion',args)).structuredContent;
  assert.equal(d.estado,'prepared');assert.equal(d.anexo.nome,'proposta.pdf');assert.equal(d.anexo.origemNotion.paginaId,pageId);
  assert.equal(f.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='out'").get().n,0);
  assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM message_media').get().n,0);
  assert.equal(f.calls.filter(c=>c.url.includes('facebook.com')).length,0);
  assert.equal((await f.tool('preparar_documento_notion',args)).structuredContent.envioId,d.envioId);assert.equal(state.downloads,1);
  assert.equal((await f.tool('preparar_documento_notion',{...args,texto:'Outra legenda'})).isError,true);
  const other='5544000000002';f.incoming('Outro cliente',other);
  assert.equal((await f.tool('preparar_documento_notion',{...args,telefone:other})).isError,true);
  await f.send(d);await f.send(d);
  const dispatches=f.calls.filter(c=>c.url.endsWith('/messages'));assert.equal(dispatches.length,1);
  const payload=JSON.parse(dispatches[0].options.body);assert.equal(payload.to,phone);assert.equal(payload.type,'document');assert.equal(payload.document.filename,'proposta.pdf');
  const linked=f.app.db.prepare('SELECT m.conversation_id FROM message_media mm JOIN messages m ON m.id=mm.message_id WHERE mm.media_id=?').get(d.anexo.id);assert.equal(linked.conversation_id,c.id);
  f.app.intake({metadata:{phone_number_id:'fake-phone'},statuses:[{id:'fake-document-message',status:'delivered'}]});
  assert.equal((await f.tool('consultar_envio',{envioId:d.envioId})).structuredContent.entregaConfirmada,true);
});
test('preparações simultâneas reutilizam arquivo e prévia; troca de conteúdo não é aceita',async t=>{
  let release,started;const barrier=new Promise(r=>release=r),began=new Promise(r=>started=r);
  const state={onDownload:async()=>{started();await barrier;}},f=await fixture(t,notionConfig,documentTransport(state));f.incoming();
  const args=await selectDocument(f),first=f.tool('preparar_documento_notion',args);await began;
  const second=f.tool('preparar_documento_notion',args);
  const conflict=await f.tool('preparar_documento_notion',{...args,texto:'Mudou'});assert.equal(conflict.isError,true);
  release();const [a,b]=await Promise.all([first,second]);assert.equal(a.structuredContent.envioId,b.structuredContent.envioId);assert.equal(state.downloads,1);
  assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM media').get().n,1);
});
test('mudança da conversa durante importação ou do arquivo após prévia bloqueia envio',async t=>{
  for(const change of ['incoming','client','bytes']){
    let f;const state={onDownload:()=>{
      if(change==='incoming')f.incoming('Aguarde');
      if(change==='client')f.app.db.prepare('UPDATE conversation_context SET client_id=?').run(randomUUID());
    }};
    f=await fixture(t,notionConfig,documentTransport(state));f.incoming();const args=await selectDocument(f),r=await f.tool('preparar_documento_notion',args);
    if(change==='bytes'){
      const d=r.structuredContent;f.app.db.prepare('UPDATE media SET data=? WHERE id=?').run(Buffer.from('%PDF-1.4\nModificado'),d.anexo.id);
      assert.equal((await f.send(d)).isError,true);
    }else{assert.equal(r.isError,true);assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM media').get().n,0);}
    assert.equal(f.calls.filter(c=>c.url.includes('facebook.com')).length,0);
  }
});
test('erro de acesso, arquivo falso e falta de armazenamento não criam prévia nem mensagem',async t=>{
  for(const change of ['denied','fake','capacity']){
    const state={},f=await fixture(t,{...notionConfig,MEDIA_STORAGE_MAX_MB:'1'},documentTransport(state));f.incoming();
    if(change==='denied'){
      state.denied=true;const r=await f.tool('listar_documentos_notion',{telefone:phone,paginaId:pageId});assert.equal(r.isError,true);assert.ok(!JSON.stringify(r).includes('test-only-notion-token'));continue;
    }
    const args=await selectDocument(f);
    if(change==='fake')state.bytes=Buffer.from('<html>nao e PDF</html>');
    if(change==='capacity')f.app.db.prepare("INSERT INTO media(id,kind,mime,name,state,created,data) VALUES(?,'document','application/pdf','ocupado.pdf','ready',?,zeroblob(1000000))").run(randomUUID(),Date.now());
    const failed=await f.tool('preparar_documento_notion',args);assert.equal(failed.isError,true);
    if(change==='capacity')assert.match(failed.content[0].text,/armazenamento/);
    assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM integration_document_imports').get().n,0);
    assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM integration_drafts').get().n,0);
    assert.equal(f.calls.filter(c=>c.url.includes('facebook.com')).length,0);
  }
});
test('cópia importada não pode ser reutilizada em outro cliente mesmo com ambos os telefones autorizados',async t=>{
  const other='5544000000002',f=await fixture(t,{...notionConfig,CENTRAL_MCP_ALLOWED_PHONES:phone+','+other},documentTransport());f.incoming();f.incoming('Outro cliente',other);
  const args=await selectDocument(f),d=(await f.tool('preparar_documento_notion',args)).structuredContent;
  assert.equal((await f.tool('preparar_envio',{telefone:other,texto:'Arquivo',anexoId:d.anexo.id,requestId:randomUUID()})).isError,true);
  assert.equal((await f.tool('preparar_documento_notion',{...args,telefone:other})).isError,true);
  assert.equal(f.calls.filter(c=>c.url.includes('facebook.com')).length,0);
});
test('arquivo preparado persiste após reinício e não é baixado novamente na mesma intenção',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'central-notion-doc-')),path=join(directory,'db.sqlite'),state={};
  const f=await fixture(t,{...notionConfig,DATABASE_PATH:path},documentTransport(state));f.incoming();
  const args=await selectDocument(f),d=(await f.tool('preparar_documento_notion',args)).structuredContent;
  await f.app.close();f.app.close=async()=>{};
  const next=await fixture(t,{...notionConfig,DATABASE_PATH:path},()=>{throw Error('No network expected');});
  const restored=await next.tool('preparar_documento_notion',args);assert.equal(restored.structuredContent.envioId,d.envioId);assert.equal(next.calls.length,0);
  assert.equal(Buffer.from(next.app.media.content(d.anexo.id).data).toString(),'%PDF-1.4\nDocumento ficticio');
  await next.app.close();next.app.close=async()=>{};rmSync(directory,{recursive:true,force:true});
});

function pageTransport(state={}){
  return async(url,options)=>{
    if(url.startsWith('https://api.notion.com/v1/')){
      assert.equal(options.headers.authorization,'Bearer test-only-notion-token');
      if(url.includes('/pages/'))return Response.json({id:pageId,properties:{Nome:{type:'title',title:[{plain_text:'Proposta piloto'}]}}});
      if(state.duringRead)state.duringRead();
      return Response.json({results:[{type:'paragraph',paragraph:{rich_text:[{plain_text:state.text||'Projeto de residência. Valor: R$ 1.250,00.'}]}}],has_more:false});
    }
    if(url.endsWith('/media'))return Response.json({id:'fake-page-upload'});
    if(url.endsWith('/messages'))return Response.json({messages:[{id:'fake-page-message'}]});
    throw Error('No other network allowed');
  };
}
test('proposta escrita passa por leitura, PDF e aprovação exata antes de um único envio',async t=>{
  const f=await fixture(t,notionConfig,pageTransport()),c=f.incoming();
  const viewed=(await f.tool('visualizar_pagina_notion',{telefone:phone,paginaId:pageId})).structuredContent;
  assert.match(JSON.stringify(viewed.conteudo),/1.250/);
  const args={telefone:phone,paginaId:pageId,resumoConteudo:viewed.resumoConteudo,texto:'Segue a proposta para sua aprovação.',requestId:randomUUID()};
  const d=(await f.tool('preparar_pagina_notion_pdf',args)).structuredContent;
  assert.equal(d.estado,'prepared');assert.equal(d.anexo.nome,'Proposta piloto.pdf');assert.equal(d.anexo.origemNotion.tipo,'pagina_pdf');assert.ok(d.anexo.tamanho>300);
  assert.match(Buffer.from(f.app.media.content(d.anexo.id).data).toString(),/^%PDF-1.4/);
  assert.equal(f.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='out'").get().n,0);
  assert.equal(f.calls.filter(c=>c.url.includes('facebook.com')).length,0);
  const calls=f.calls.length;
  const retry=await f.tool('preparar_pagina_notion_pdf',args);assert.equal(retry.structuredContent.envioId,d.envioId);assert.equal(f.calls.length,calls);
  assert.equal((await f.tool('preparar_pagina_notion_pdf',{...args,texto:'Legenda alterada'})).isError,true);
  const sent=(await f.send(d)).structuredContent;await f.send(d);
  assert.equal(sent.aceitoPelaMeta,true);assert.equal(sent.entregaConfirmada,false);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/messages')).length,1);
  assert.equal(f.app.db.prepare('SELECT m.conversation_id FROM message_media mm JOIN messages m ON m.id=mm.message_id WHERE mm.media_id=?').get(d.anexo.id).conversation_id,c.id);
});
test('proposta alterada, nova mensagem e outro destinatário impedem preparação e despacho',async t=>{
  for(const change of ['content','incoming','phone','human']){
    const state={},f=await fixture(t,notionConfig,pageTransport(state)),c=f.incoming();
    const viewed=(await f.tool('visualizar_pagina_notion',{telefone:phone,paginaId:pageId})).structuredContent;
    const args={telefone:phone,paginaId:pageId,resumoConteudo:viewed.resumoConteudo,texto:'Confira a proposta.',requestId:randomUUID()};
    if(change==='content')state.text='Mudança no preço';
    if(change==='incoming')state.duringRead=()=>{state.duringRead=null;f.incoming('Mudou meu pedido');};
    if(change==='human')state.duringRead=()=>{state.duringRead=null;f.app.customerContext.control(c,{mode:'human'},{name:'Humano'});};
    if(change==='phone')args.telefone='5544000000002';
    const result=await f.tool('preparar_pagina_notion_pdf',args);assert.equal(result.isError,true,change);
    assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM integration_drafts').get().n,0);
    assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM media').get().n,0);
    assert.equal(f.calls.filter(c=>c.url.includes('facebook.com')).length,0);
  }
});
