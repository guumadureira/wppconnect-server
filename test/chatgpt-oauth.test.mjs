import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createChatGPTAuth} from '../chatgpt-oauth.mjs';

const client='https://chatgpt.com/oauth/client.json',redirect='https://chatgpt.com/connector_platform_oauth_redirect';
const issuer='https://central.example',resource=issuer+'/mcp/chatgpt',verifier='a'.repeat(43);
const challenge=value=>createHash('sha256').update(value).digest('base64url');

async function fixture(t,extra={},transport){
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE agents(id TEXT PRIMARY KEY,email TEXT,role TEXT,active INTEGER,password TEXT NOT NULL); INSERT INTO agents VALUES ('admin1','admin@example.invalid','admin',1,'test-hash-original')");
  let auth;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,issuer);
    const readBody=async()=>{const parts=[];for await(const c of req)parts.push(c);return Buffer.concat(parts);};
    try{await auth.handle(req,res,{url,readBody,forwardMcp:()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true}));}})}
    catch(error){res.writeHead(error.status||500);res.end(error.message);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close()});
  const mock=transport|| (async url=>Response.json({client_id:url,client_name:'ChatGPT oficial',redirect_uris:[redirect],grant_types:['authorization_code'],token_endpoint_auth_method:'none'}));
  auth=createChatGPTAuth(db,{PUBLIC_ORIGIN:issuer,CHATGPT_OAUTH_ENABLED:'true',
    CHATGPT_OAUTH_ADMIN_EMAIL:'admin@example.invalid',CENTRAL_MCP_ALLOWED_PHONES:'5544999999999',CHATGPT_OAUTH_ALLOWED_PHONES:'5544999999999',...extra},
    async(email,password)=>email==='admin@example.invalid'&&password==='correct'?{id:'admin1',role:'admin'}:null,mock);
  const base='http://127.0.0.1:'+server.address().port;
  const fetchPath=(path,opts={})=>fetch(base+path,{redirect:'manual',...opts});
  const body=params=>new URLSearchParams(params);
  const start=(params={})=>fetchPath('/oauth/authorize?'+new URLSearchParams({
    response_type:'code',client_id:client,redirect_uri:redirect,code_challenge:challenge(verifier),
    code_challenge_method:'S256',state:'randomState',scope:'central:read offline_access',resource,...params
  }));
  const login=(ticket,password='correct',origin=issuer)=>fetchPath('/oauth/approve',{
    method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},
    body:body({ticket,email:'admin@example.invalid',password})
  });
  const token=params=>fetchPath('/oauth/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:body(params)
  });
  const authorization=async()=>{
    const page=await start();assert.equal(page.status,200);
    const ticket=/name="ticket" value="([A-Za-z0-9_-]+)"/.exec(await page.text())?.[1];assert.ok(ticket);
    const approved=await login(ticket);assert.equal(approved.status,302);
    const callback=new URL(approved.headers.get('location'));
    assert.equal(callback.searchParams.get('state'),'randomState');
    assert.equal(callback.searchParams.get('iss'),issuer);
    return callback.searchParams.get('code');
  };
  return{db,auth,fetchPath,start,login,token,authorization};
}

test('OAuth anuncia metadados e recusa requisições MCP sem token',async t=>{
  const f=await fixture(t);
  const resourceInfo=await f.fetchPath('/.well-known/oauth-protected-resource/mcp/chatgpt');
  assert.equal(resourceInfo.status,200);assert.equal((await resourceInfo.json()).resource,resource);
  const metadata=await(await f.fetchPath('/.well-known/oauth-authorization-server')).json();
  assert.deepEqual(metadata.code_challenge_methods_supported,['S256']);
  assert.equal(metadata.authorization_response_iss_parameter_supported,true);
  const denied=await f.fetchPath('/mcp/chatgpt');assert.equal(denied.status,401);
  assert.match(denied.headers.get('www-authenticate'),/resource_metadata/);
});

test('PKCE autoriza código de uso único e revoga usuário desabilitado',async t=>{
  const f=await fixture(t),code=await f.authorization();
  const params={grant_type:'authorization_code',client_id:client,redirect_uri:redirect,code,code_verifier:verifier,resource};
  assert.equal((await f.token({...params,code_verifier:'b'.repeat(43)})).status,400);
  const granted=await f.token(params);assert.equal(granted.status,200);
  const tokens=await granted.json();assert.equal(tokens.scope,'central:read');
  assert.equal((await f.token(params)).status,400);
  assert.equal((await f.fetchPath('/mcp/chatgpt',{headers:{authorization:'Bearer '+tokens.access_token}})).status,200);
  f.db.exec("UPDATE agents SET active=0 WHERE id='admin1'");
  assert.equal((await f.fetchPath('/mcp/chatgpt',{headers:{authorization:'Bearer '+tokens.access_token}})).status,401);
});

test('refresh é rotativo e token antigo reutilizado revoga toda a família',async t=>{
  const f=await fixture(t),code=await f.authorization();
  const first=await(await f.token({grant_type:'authorization_code',client_id:client,
    redirect_uri:redirect,code,code_verifier:verifier,resource})).json();
  const renew={grant_type:'refresh_token',client_id:client,refresh_token:first.refresh_token,resource};
  const response=await f.token(renew);assert.equal(response.status,200);const second=await response.json();
  assert.notEqual(first.refresh_token,second.refresh_token);
  assert.equal((await f.fetchPath('/mcp/chatgpt',{headers:{authorization:'Bearer '+second.access_token}})).status,200);
  assert.equal((await f.token(renew)).status,400);
  assert.equal((await f.fetchPath('/mcp/chatgpt',{headers:{authorization:'Bearer '+second.access_token}})).status,401);
  assert.equal((await f.token({...renew,refresh_token:second.refresh_token})).status,400);
});

test('nega callback, resource, scope, origem e autenticação incorretos',async t=>{
  const f=await fixture(t);
  assert.equal((await f.start({redirect_uri:'https://evil.example/callback'})).status,400);
  assert.equal((await f.start({resource:'https://other.example/mcp'})).status,400);
  assert.equal((await f.start({scope:'central:write'})).status,400);
  const page=await f.start();
  const ticket=/name="ticket" value="([A-Za-z0-9_-]+)"/.exec(await page.text())[1];
  assert.equal((await f.login(ticket,'correct','https://evil.example')).status,403);
  assert.equal((await f.login(ticket,'incorrect')).status,401);
  assert.equal((await f.login(ticket,'correct')).status,302);
  assert.equal((await f.login(ticket,'correct')).status,400);
});

test('CIMD com identidade adulterada é rejeitado mesmo com campos válidos',async t=>{
  const invalid=await fixture(t,{},async()=>Response.json({
    client_id:'https://evil.example/client.json',client_name:'ChatGPT',
    redirect_uris:[redirect],token_endpoint_auth_method:'none'
  }));
  assert.equal((await invalid.start()).status,400);
});

test('integração OAuth desativada não publica endpoints',async t=>{
  const off=await fixture(t,{CHATGPT_OAUTH_ENABLED:'false'});
  assert.equal(off.auth.enabled,false);
  assert.equal((await off.fetchPath('/oauth/authorize')).status,404);
});

test('recusa cliente com método de autenticação incompatível',async t=>{
  const f=await fixture(t,{},async url=>Response.json({client_id:url,client_name:'ChatGPT',redirect_uris:[redirect],token_endpoint_auth_method:'private_key_jwt'}));
  assert.equal((await f.start()).status,400);
});

test('limita tentativas de senha mesmo alternando e-mails',async t=>{
  const f=await fixture(t);
  const page=await f.start();const ticket=/name="ticket" value="([A-Za-z0-9_-]+)"/.exec(await page.text())[1];
  for(let i=0;i<8;i++){
    const r=await f.fetchPath('/oauth/approve',{method:'POST',headers:{origin:issuer,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket,email:'falso'+i+'@example.invalid',password:'errada'})});
    assert.equal(r.status,401);
  }
  assert.equal((await f.login(ticket,'correct')).status,429);
});

test('aceita CIMD oficial com preferência private_key_jwt quando none também está suportado',async t=>{
  const f=await fixture(t,{},async url=>Response.json({
    client_id:url,client_name:'ChatGPT',redirect_uris:[redirect],
    token_endpoint_auth_method:'private_key_jwt',
    token_endpoint_auth_methods_supported:['none','private_key_jwt'],
    grant_types:['authorization_code','refresh_token']
  }));
  const response=await f.start();assert.equal(response.status,200);
  assert.match(await response.text(),/Conectar ChatGPT/);
});

test('rejeita CIMD cuja lista não inclui none apesar de preferência antiga',async t=>{
  const f=await fixture(t,{},async url=>Response.json({
    client_id:url,client_name:'ChatGPT',redirect_uris:[redirect],
    token_endpoint_auth_method:'none',
    token_endpoint_auth_methods_supported:['private_key_jwt']
  }));
  assert.equal((await f.start()).status,400);
});

test('OAuth desativa a conexão quando nenhum telefone específico do ChatGPT foi autorizado',async t=>{
  const f=await fixture(t,{CHATGPT_OAUTH_ALLOWED_PHONES:''});
  assert.equal(f.auth.enabled,false);
  assert.equal((await f.fetchPath('/oauth/authorize')).status,404);
});

test('OAuth bloqueia configuração com telefone inválido, não autorizado ou mistura perigosa',async t=>{
  for(const allowed of ['invalido','5544111111111','5544999999999,invalido']){
    const f=await fixture(t,{CHATGPT_OAUTH_ALLOWED_PHONES:allowed});
    assert.equal(f.auth.enabled,false,allowed);
    assert.equal((await f.fetchPath('/oauth/authorize')).status,404,allowed);
  }
});

test('alterar a senha do administrador revoga access e refresh tokens emitidos anteriormente',async t=>{
  const f=await fixture(t),code=await f.authorization();
  const granted=await f.token({grant_type:'authorization_code',client_id:client,redirect_uri:redirect,
    code,code_verifier:verifier,resource});
  assert.equal(granted.status,200);
  const tokens=await granted.json();
  assert.equal((await f.fetchPath('/mcp/chatgpt',{headers:{authorization:'Bearer '+tokens.access_token}})).status,200);
  f.db.exec("UPDATE agents SET password='test-hash-after-change' WHERE id='admin1'");
  assert.equal((await f.fetchPath('/mcp/chatgpt',{headers:{authorization:'Bearer '+tokens.access_token}})).status,401);
  assert.equal((await f.token({grant_type:'refresh_token',client_id:client,resource,refresh_token:tokens.refresh_token})).status,400);
});

test('limita pedidos públicos de autorização antes de esgotar os recursos do servidor',async t=>{
  const f=await fixture(t);
  for(let i=0;i<16;i++){
    const response=await f.start();
    assert.equal(response.status,200,'tentativa '+i);
    await response.text();
  }
  assert.equal((await f.start()).status,429);
});

test('recusa autorizações novas quando há 64 solicitações pendentes',async t=>{
  const f=await fixture(t);
  const query=f.db.prepare('INSERT INTO chatgpt_oauth_pending VALUES(?,?,?,?,?,?,?)');
  for(let i=0;i<64;i++)query.run('pending-'+i,client,redirect,challenge(verifier),'state', 'central:read',Date.now()+600000);
  assert.equal((await f.start()).status,429);
});
