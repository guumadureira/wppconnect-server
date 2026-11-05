import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createCentral} from '../server.mjs';

async function fixture(t){
  const origin='https://central.example',client='https://chatgpt.com/oauth/client.json';
  const redirect='https://chatgpt.com/connector_platform_oauth_redirect',verifier='r'.repeat(43);
  const legacyKey='test-only-legacy-credential-12345678901234567890',calls=[];
  const app=createCentral({DATABASE_PATH:':memory:',WHATSAPP_MODE:'demo',PUBLIC_ORIGIN:origin,
    SETUP_TOKEN:'test-setup',CHATGPT_OAUTH_ENABLED:'true',CHATGPT_OAUTH_ADMIN_EMAIL:'admin@example.invalid',
    CHATGPT_OAUTH_READ_ALL_CONTACTS:'true',CENTRAL_MCP_ENABLED:'true',CENTRAL_MCP_TOKEN:legacyKey,
    CENTRAL_MCP_ALLOWED_PHONES:'5544999990001',CENTRAL_MCP_SEND_ENABLED:'true'},async url=>{
    calls.push(String(url));assert.equal(url,client,'Somente CIMD fictício pode ser consultado');
    return Response.json({client_id:client,client_name:'ChatGPT',redirect_uris:[redirect],token_endpoint_auth_method:'none'});
  });
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const post=(path,body,headers={})=>fetch(base+path,{method:'POST',redirect:'manual',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await post('/api/setup',{name:'Admin',email:'admin@example.invalid',password:'test-password-only',setupToken:'test-setup'},{origin})).status,201);
  const ids=[],contacts=[];
  for(let i=0;i<36;i++){
    const id=randomUUID(),contactId=randomUUID(),phone='55449876'+String(i).padStart(5,'0');ids.push({id,phone});contacts.push(contactId);
    app.db.prepare('INSERT INTO conversations(id,name,phone,status,updated) VALUES(?,?,?,?,?)').run(id,'Conversa '+i,phone,i===0?'closed':'open',Date.now());
    app.db.prepare('INSERT INTO contacts(id,name,phone,email,notes,created,updated) VALUES(?,?,?,?,?,?,?)').run(contactId,'Contato '+i,phone,'test'+i+'@example.invalid','Observação fictícia',Date.now(),Date.now());
  }
  for(let i=0;i<70;i++)app.db.prepare("INSERT INTO messages(id,conversation_id,direction,body,status,created) VALUES(?,?,'in',?,'received',?)")
    .run(randomUUID(),ids[0].id,'Mensagem fictícia '+i,Date.now()+i);
  const q=new URLSearchParams({response_type:'code',client_id:client,redirect_uri:redirect,resource:origin+'/mcp/chatgpt',scope:'central:read',state:'test-state',
    code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  const page=await fetch(base+'/oauth/authorize?'+q);assert.equal(page.status,200);
  const html=await page.text();assert.match(html,/todas as conversas e contatos/);
  const ticket=/name="ticket" value="([^"]+)"/.exec(html)[1];
  const approve=await fetch(base+'/oauth/approve',{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({ticket,email:'admin@example.invalid',password:'test-password-only'})});assert.equal(approve.status,302);
  const token=await fetch(base+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
    grant_type:'authorization_code',client_id:client,redirect_uri:redirect,resource:origin+'/mcp/chatgpt',code:new URL(approve.headers.get('location')).searchParams.get('code'),code_verifier:verifier})});
  assert.equal(token.status,200);const credential=(await token.json()).access_token;
  const rpc=async(method,params)=>{const response=await post('/mcp/chatgpt',{jsonrpc:'2.0',id:randomUUID(),method,params},
    {authorization:'Bearer '+credential,accept:'application/json'});assert.equal(response.status,200);return response.json();};
  const tool=async(name,args)=>(await rpc('tools/call',{name,arguments:args})).result;
  const legacy=async(name,args)=>{const response=await post('/mcp',{jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}},
    {authorization:'Bearer '+legacyKey,accept:'application/json'});return response.json();};
  return{app,ids,contacts,rpc,tool,legacy,calls};
}

test('leitura completa pagina conversas e agenda, busca e consulta contato sem criar registros',async t=>{
  const f=await fixture(t);
  const page=(await f.tool('listar_conversas_autorizadas',{})).structuredContent;
  assert.equal(page.total,36);assert.equal(page.conversas.length,30);assert.ok(page.proximaPagina);
  const next=(await f.tool('listar_conversas_autorizadas',{antesDe:page.proximaPagina})).structuredContent;
  assert.equal(next.conversas.length,6);assert.equal(next.proximaPagina,null);
  assert.equal(new Set([...page.conversas,...next.conversas].map(c=>c.conversaId)).size,36);
  const found=(await f.tool('listar_conversas_autorizadas',{busca:'Conversa 35'})).structuredContent;
  assert.equal(found.total,1);assert.equal(found.conversas[0].conversaId,f.ids[35].id);
  const agenda=(await f.tool('listar_contatos',{})).structuredContent;
  assert.equal(agenda.total,36);assert.equal(agenda.contatos.length,30);
  const remaining=(await f.tool('listar_contatos',{antesDe:agenda.proximaPagina})).structuredContent;assert.equal(remaining.contatos.length,6);
  const contact=(await f.tool('consultar_contato',{contatoId:f.contacts[3]})).structuredContent;
  assert.equal(contact.email,'test3@example.invalid');assert.equal(contact.observacoes,'Observação fictícia');
  assert.equal((await f.tool('listar_contatos',{busca:'Contato 35'})).structuredContent.total,1);
  assert.equal((await f.tool('listar_contatos',{antesDe:randomUUID()})).isError,true);
  assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n,36);
});

test('administrador lê histórico de qualquer conversa enquanto o canal legado mantém a lista própria',async t=>{
  const f=await fixture(t),id=f.ids[0].id;
  const state=(await f.tool('consultar_conversa',{conversaId:id})).structuredContent;
  assert.equal(state.situacao,'closed');assert.equal(state.mensagens.length,30);
  const first=(await f.tool('consultar_historico',{conversaId:id})).structuredContent;
  const second=(await f.tool('consultar_historico',{telefone:f.ids[0].phone,antesDe:first.proximaPagina})).structuredContent;
  const third=(await f.tool('consultar_historico',{conversaId:id,antesDe:second.proximaPagina})).structuredContent;
  assert.equal(first.mensagens.length,30);assert.equal(second.mensagens.length,30);assert.equal(third.mensagens.length,10);
  assert.equal(third.proximaPagina,null);
  assert.equal((await f.tool('consultar_historico',{conversaId:f.ids[1].id,antesDe:first.proximaPagina})).isError,true);
  assert.equal((await f.legacy('consultar_conversa',{telefone:f.ids[0].phone})).result.isError,true);
  assert.equal((await f.legacy('consultar_conversa',{conversaId:id})).result.isError,true);
  assert.equal((await f.legacy('listar_contatos',{})).result.isError,true);
});

test('leitura completa de anexos mantém vínculo entre URI, mensagem e conversa',async t=>{
  const f=await fixture(t),message=f.app.db.prepare('SELECT id FROM messages WHERE conversation_id=? LIMIT 1').get(f.ids[0].id);
  const media=f.app.media.store('document','application/pdf','teste.pdf',Buffer.from('%PDF-1.4 test'));f.app.media.link(message.id,media.id);
  const files=(await f.tool('listar_arquivos_recebidos',{conversaId:f.ids[0].id})).structuredContent;
  assert.equal(files.arquivos.length,1);
  const read=await f.rpc('resources/read',{uri:files.arquivos[0].uri});assert.ok(read.result.contents[0].blob);
  const wrong=files.arquivos[0].uri.replace(f.ids[0].id,f.ids[1].id);
  assert.ok((await f.rpc('resources/read',{uri:wrong})).error);
});

test('seleção por ID é explícita e todas as operações mutáveis continuam bloqueadas',async t=>{
  const f=await fixture(t),id=f.ids[0].id;
  assert.equal((await f.tool('consultar_conversa',{})).isError,true);
  assert.equal((await f.tool('consultar_conversa',{conversaId:id,telefone:f.ids[0].phone})).isError,true);
  assert.equal((await f.tool('consultar_conversa',{conversaId:randomUUID()})).isError,true);
  const aliasId=randomUUID(),aliasPhone=f.ids[0].phone.slice(0,4)+f.ids[0].phone.slice(5);
  f.app.db.prepare('INSERT INTO conversations(id,name,phone,updated) VALUES(?,?,?,?)').run(aliasId,'Cadastro com variante',aliasPhone,Date.now());
  assert.equal((await f.tool('consultar_conversa',{telefone:f.ids[0].phone})).isError,true);
  assert.equal((await f.tool('consultar_conversa',{conversaId:aliasId})).structuredContent.conversaId,aliasId);
  assert.equal((await f.tool('consultar_conversa',{conversaId:id})).structuredContent.conversaId,id);
  const discovered=(await f.rpc('tools/list')).result.tools;
  assert.equal(discovered.length,7);assert.ok(discovered.every(t=>t.annotations.readOnlyHint));
  for(const [name,args] of [['preparar_envio',{telefone:f.ids[0].phone,texto:'Não enviar',requestId:randomUUID()}],
    ['confirmar_envio',{envioId:randomUUID(),resumoCriptografico:'test',autorizadoPeloUsuario:true}],
    ['atualizar_contexto_notion',{telefone:f.ids[0].phone}],['consultar_envio',{envioId:randomUUID()}]]){
    assert.ok(!discovered.some(t=>t.name===name));assert.equal((await f.tool(name,args)).isError,true);
  }
  assert.equal(f.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='out'").get().n,0);
  assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM integration_drafts').get().n,0);
  assert.equal(f.calls.length,1);
});
