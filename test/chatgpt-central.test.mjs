import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createCentral} from '../server.mjs';

test('ChatGPT OAuth reads authorized conversation but never bypasses legacy MCP or sends',async t=>{
  const phone='5544987654321',other='5544987654322',origin='https://central.example',client='https://chatgpt.com/oauth/client.json';
  const redirect='https://chatgpt.com/connector_platform_oauth_redirect',verifier='v'.repeat(43);
  const calls=[];
  const config={DATABASE_PATH:':memory:',HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,SETUP_TOKEN:'setup-secret-only',
    WHATSAPP_MODE:'demo',WHATSAPP_PHONE_NUMBER_ID:'fake-number',
    CENTRAL_MCP_ENABLED:'false',CENTRAL_MCP_TOKEN:'',CENTRAL_MCP_SEND_ENABLED:'true',
    CENTRAL_MCP_ALLOWED_PHONES:phone+','+other,CHATGPT_OAUTH_ENABLED:'true',CHATGPT_OAUTH_ADMIN_EMAIL:'admin@example.invalid',CHATGPT_OAUTH_ALLOWED_PHONES:phone};
  const app=createCentral(config,async url=>{
    calls.push(String(url));
    if(url===client)return Response.json({client_id:client,client_name:'ChatGPT oficial',redirect_uris:[redirect],
      grant_types:['authorization_code','refresh_token'],token_endpoint_auth_method:'private_key_jwt',token_endpoint_auth_methods_supported:['none','private_key_jwt']});
    throw Error('Network call not allowed by test');
  });
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const post=(path,data,headers={})=>fetch(base+path,{method:'POST',redirect:'manual',
    headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
  const setup=await post('/api/setup',{name:'Administrator',email:'admin@example.invalid',
    password:'local-test-password',setupToken:'setup-secret-only'},{origin});
  assert.equal(setup.status,201);
  app.intake({metadata:{phone_number_id:'fake-number'},messages:[{id:'test-in-1',from:phone,
    type:'text',text:{body:'Pedido autorizado'},timestamp:Math.floor(Date.now()/1000)}]});
  // This conversation remains allowed to the old Notion channel, not to ChatGPT.
  app.intake({metadata:{phone_number_id:'fake-number'},messages:[{id:'test-in-private',from:other,
    type:'text',text:{body:'Conversa restrita a outro canal'},timestamp:Math.floor(Date.now()/1000)}]});
  const foreign=app.db.prepare('SELECT id FROM conversations WHERE phone=?').get(other);
  assert.ok(foreign);
  const foreignMessage=app.db.prepare('SELECT id FROM messages WHERE conversation_id=?').get(foreign.id);
  const foreignFile=app.media.store('document','application/pdf','privado.pdf',Buffer.from('%PDF-1.4\\nConteúdo privado'));
  app.media.link(foreignMessage.id,foreignFile.id);
  const q=new URLSearchParams({client_id:client,redirect_uri:redirect,response_type:'code',
    code_challenge:createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method:'S256',scope:'central:read offline_access',state:'unit-test',resource:origin+'/mcp/chatgpt'});
  const start=await fetch(base+'/oauth/authorize?'+q);assert.equal(start.status,200);
  const ticket=/name="ticket" value="([^"]+)"/.exec(await start.text())?.[1];assert.ok(ticket);
  const approve=await fetch(base+'/oauth/approve',{method:'POST',redirect:'manual',
    headers:{origin,'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({ticket,email:'admin@example.invalid',password:'local-test-password'})});
  assert.equal(approve.status,302);
  const callback=new URL(approve.headers.get('location'));
  const token=await fetch(base+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:client,grant_type:'authorization_code',code:callback.searchParams.get('code'),
      redirect_uri:redirect,code_verifier:verifier,resource:origin+'/mcp/chatgpt'})});
  assert.equal(token.status,200);
  const credential=(await token.json()).access_token;
  const rpc=(method,params)=>post('/mcp/chatgpt',{jsonrpc:'2.0',id:randomUUID(),method,params},{
    authorization:'Bearer '+credential,accept:'application/json, text/event-stream'});
  const scan=await rpc('tools/list');assert.equal(scan.status,200);
  const tools=(await scan.json()).result.tools;
  assert.ok(tools.some(x=>x.name==='consultar_historico'));
  assert.ok(tools.some(x=>x.name==='listar_conversas_autorizadas'));
  assert.ok(tools.every(x=>x.annotations?.readOnlyHint));
  assert.ok(tools.every(x=>x.securitySchemes?.[0]?.scopes.includes('central:read')));
  assert.ok(!tools.some(x=>['preparar_envio','confirmar_envio','consultar_envio'].includes(x.name)));
  const read=await rpc('tools/call',{name:'consultar_conversa',arguments:{telefone:phone}});
  assert.equal(read.status,200);assert.match(JSON.stringify(await read.json()),/Pedido autorizado/);
  const listing=await rpc('tools/call',{name:'listar_conversas_autorizadas',arguments:{}});
  const allowed=(await listing.json()).result.structuredContent.conversas;
  assert.deepEqual(allowed.map(c=>c.telefone),[phone]);
  for(const name of ['consultar_conversa','consultar_historico','listar_arquivos_recebidos']){
    const forbidden=await rpc('tools/call',{name,arguments:{telefone:other}});
    assert.equal((await forbidden.json()).result.isError,true,name);
  }
  const draft=await rpc('tools/call',{name:'consultar_envio',arguments:{envioId:randomUUID()}});
  assert.equal((await draft.json()).result.isError,true);
  const resource='central://conversations/'+foreign.id+'/messages/'+foreignMessage.id+'/attachments/'+foreignFile.id;
  const resourceRead=await rpc('resources/read',{uri:resource});
  assert.ok((await resourceRead.json()).error,'Anexo de conversa fora do escopo OAuth foi rejeitado');
  const write=await rpc('tools/call',{name:'preparar_envio',arguments:{telefone:phone,
    texto:'Não enviar',requestId:randomUUID()}});
  assert.equal((await write.json()).result.isError,true);
  const legacy=await post('/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'},{
    authorization:'Bearer '+credential,accept:'application/json'});
  assert.equal(legacy.status,503);
  assert.equal(calls.length,1);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM integration_drafts').get().n,0);
});
