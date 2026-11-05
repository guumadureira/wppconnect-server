import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createChatGPTAuth} from '../chatgpt-oauth.mjs';

const client='https://chatgpt.com/oauth/client.json',redirect='https://chatgpt.com/connector_platform_oauth_redirect';
const issuer='https://central.example',resource=issuer+'/mcp/chatgpt',verifier='a'.repeat(43);
const challenge=value=>createHash('sha256').update(value).digest('base64url');

async function fixture(t,extra={},transport,authenticate){
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
    authenticate|| (async(email,password)=>email==='admin@example.invalid'&&password==='correct'?{id:'admin1',role:'admin'}:null),mock);
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

test('duas aprovações simultâneas do mesmo ticket emitem somente um código',async t=>{
  let entered=0,release;
  const barrier=new Promise(resolve=>release=resolve);
  const f=await fixture(t,{},undefined,async()=>{
    if(++entered===2)release();await barrier;return{id:'admin1',role:'admin'};
  });
  const page=await f.start(),ticket=/name="ticket" value="([^"]+)"/.exec(await page.text())[1];
  const results=await Promise.all([f.login(ticket),f.login(ticket)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[302,400]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM chatgpt_oauth_codes').get().n,1);
});

test('ticket vencido durante autenticação não emite código',async t=>{
  let f;
  f=await fixture(t,{},undefined,async()=>{
    f.db.exec('UPDATE chatgpt_oauth_pending SET expires=0');return{id:'admin1',role:'admin'};
  });
  const page=await f.start(),ticket=/name="ticket" value="([^"]+)"/.exec(await page.text())[1];
  assert.equal((await f.login(ticket)).status,400);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM chatgpt_oauth_codes').get().n,0);
});

test('senha alterada durante autenticação não autoriza com a credencial anterior',async t=>{
  let f;
  f=await fixture(t,{},undefined,async()=>{
    f.db.exec("UPDATE agents SET password='changed-during-login'");return{id:'admin1',role:'admin'};
  });
  const page=await f.start(),ticket=/name="ticket" value="([^"]+)"/.exec(await page.text())[1];
  assert.equal((await f.login(ticket)).status,401);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM chatgpt_oauth_codes').get().n,0);
});

test('troca de senha entre consentimento e token invalida o código pendente',async t=>{
  const f=await fixture(t),code=await f.authorization();
  f.db.exec("UPDATE agents SET password='new-password-hash'");
  assert.equal((await f.token({grant_type:'authorization_code',client_id:client,redirect_uri:redirect,
    code,code_verifier:verifier,resource})).status,400);
});

test('rotação conserva validade absoluta da família e limita o último access token',async t=>{
  const f=await fixture(t),code=await f.authorization();
  const first=await(await f.token({grant_type:'authorization_code',client_id:client,redirect_uri:redirect,
    code,code_verifier:verifier,resource})).json();
  const deadline=Date.now()+120000;
  f.db.prepare('UPDATE chatgpt_oauth_refresh SET expires=?').run(deadline);
  const second=await(await f.token({grant_type:'refresh_token',client_id:client,
    refresh_token:first.refresh_token,resource})).json();
  assert.ok(second.expires_in<=120);
  const expires=f.db.prepare('SELECT expires FROM chatgpt_oauth_refresh').all();
  assert.equal(expires.length,2);assert.ok(expires.every(r=>r.expires===deadline));
  assert.ok(f.db.prepare('SELECT expires FROM chatgpt_oauth_access ORDER BY rowid DESC LIMIT 1').get().expires<=deadline);
});

test('falha SQLite ao emitir tokens desfaz consumo do código e não deixa token órfão',async t=>{
  const f=await fixture(t),code=await f.authorization();
  f.db.exec("CREATE TRIGGER fail_refresh BEFORE INSERT ON chatgpt_oauth_refresh BEGIN SELECT RAISE(ABORT,'test-only'); END");
  const params={grant_type:'authorization_code',client_id:client,redirect_uri:redirect,code,code_verifier:verifier,resource};
  assert.equal((await f.token(params)).status,500);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM chatgpt_oauth_access').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM chatgpt_oauth_codes').get().n,1);
  f.db.exec('DROP TRIGGER fail_refresh');assert.equal((await f.token(params)).status,200);
});

test('não aceita parâmetros duplicados nem autenticação diferente de none',async t=>{
  const f=await fixture(t);
  const params=new URLSearchParams({grant_type:'refresh_token',client_id:client,resource,refresh_token:'fake'});
  params.append('resource',resource);
  const response=await f.fetchPath('/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:params});
  assert.equal(response.status,400);
  const query=new URLSearchParams({response_type:'code',client_id:client,redirect_uri:redirect,
    code_challenge:challenge(verifier),code_challenge_method:'S256',state:'state',resource});
  query.append('client_id',client);
  assert.equal((await f.fetchPath('/oauth/authorize?'+query)).status,400);
  assert.equal((await f.token({grant_type:'refresh_token',client_id:client,resource,client_secret:'fake'})).status,401);
  const basic=await f.fetchPath('/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',authorization:'Basic fake'},body:new URLSearchParams({client_id:client,resource})});
  assert.equal(basic.status,401);
});

test('limita abuso do token endpoint sem confiar em cabeçalhos de IP',async t=>{
  const f=await fixture(t);
  for(let i=0;i<120;i++)assert.equal((await f.token({client_id:client,resource,grant_type:'refresh_token',refresh_token:'fake'})).status,400);
  const denied=await f.token({client_id:client,resource});assert.equal(denied.status,429);
  assert.deepEqual(await denied.json(),{error:'temporarily_unavailable'});
});

test('metadados CIMD grandes, inválidos ou redirecionados nunca autorizam',async t=>{
  for(const payload of ['x'.repeat(33000),'null','{invalid']){
    const f=await fixture(t,{},async()=>new Response(payload));
    assert.equal((await f.start()).status,400);
  }
  const f=await fixture(t,{},async(url,options)=>{
    assert.equal(options.redirect,'error');assert.ok(options.signal);return new Response('',{status:302});
  });
  assert.equal((await f.start()).status,503);
});

test('CIMD e callback específicos da conexão completam PKCE com issuer exato',async t=>{
  const scopedClient='https://chatgpt.com/oauth/test_callback/client.json';
  const scopedRedirect='https://chatgpt.com/connector/oauth/test_callback';
  const f=await fixture(t,{},async url=>Response.json({client_id:url,client_name:'ChatGPT',
    redirect_uris:[scopedRedirect],token_endpoint_auth_methods_supported:['none','private_key_jwt']}));
  const page=await f.start({client_id:scopedClient,redirect_uri:scopedRedirect});assert.equal(page.status,200);
  const ticket=/name="ticket" value="([^"]+)"/.exec(await page.text())[1];
  const callback=new URL((await f.login(ticket)).headers.get('location'));
  assert.equal(callback.searchParams.get('iss'),issuer);
  assert.equal((await f.token({client_id:scopedClient,redirect_uri:scopedRedirect,resource,
    grant_type:'authorization_code',code:callback.searchParams.get('code'),code_verifier:verifier})).status,200);
});

test('CSP do login permite apenas submissão local e retorno ao callback validado',async t=>{
  for(const [clientId,callback] of [[client,redirect],
    ['https://chatgpt.com/oauth/csp_test/client.json','https://chatgpt.com/connector/oauth/csp_test']]){
    const f=await fixture(t,{},async url=>Response.json({client_id:url,client_name:'ChatGPT',
      redirect_uris:[callback],token_endpoint_auth_method:'none'}));
    const page=await f.start({client_id:clientId,redirect_uri:callback});assert.equal(page.status,200);
    const directive=response=>response.headers.get('content-security-policy').split(';').map(v=>v.trim()).find(v=>v.startsWith('form-action ')).split(/\s+/);
    assert.deepEqual(directive(page),['form-action',"'self'",callback]);
    assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    const ticket=/name="ticket" value="([^"]+)"/.exec(await page.text())[1];
    const rejected=await f.login(ticket,'incorrect');assert.equal(rejected.status,401);
    assert.deepEqual(directive(rejected),['form-action',"'self'"]);
    const approved=await f.login(ticket);assert.equal(approved.status,302);
    assert.deepEqual(directive(approved),['form-action',"'self'",callback]);
    const target=new URL(approved.headers.get('location'));
    assert.equal(target.origin+target.pathname,callback);assert.ok(target.searchParams.get('code'));
  }
});

test('piloto recusa múltiplos telefones e origens com credenciais ou sintaxe ambígua sem criar tabelas',async t=>{
  for(const extra of [
    {CHATGPT_OAUTH_ALLOWED_PHONES:'5544999999999,5544999999999'},
    {PUBLIC_ORIGIN:'https://user:password@central.example'},
    {PUBLIC_ORIGIN:'https://central.example:invalid'},
    {PUBLIC_ORIGIN:'https://central.example\\evil'},
    {CHATGPT_OAUTH_ADMIN_EMAIL:'admin @example.invalid'}
  ]){
    const f=await fixture(t,extra);assert.equal(f.auth.enabled,false);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'chatgpt_oauth_%'").get().n,0);
    assert.equal((await f.fetchPath('/.well-known/oauth-authorization-server')).status,404);
  }
});

test('tokens expirados são recusados e somente hashes ficam no SQLite',async t=>{
  const f=await fixture(t),code=await f.authorization();
  const tokens=await(await f.token({grant_type:'authorization_code',client_id:client,redirect_uri:redirect,
    code,code_verifier:verifier,resource})).json();
  const rows=JSON.stringify({access:f.db.prepare('SELECT * FROM chatgpt_oauth_access').all(),refresh:f.db.prepare('SELECT * FROM chatgpt_oauth_refresh').all()});
  for(const secret of [tokens.access_token,tokens.refresh_token,code])assert.ok(!rows.includes(secret));
  f.db.exec('UPDATE chatgpt_oauth_access SET expires=0; UPDATE chatgpt_oauth_refresh SET expires=0');
  assert.equal((await f.fetchPath('/mcp/chatgpt',{headers:{authorization:'Bearer '+tokens.access_token}})).status,401);
  assert.equal((await f.token({client_id:client,resource,grant_type:'refresh_token',refresh_token:tokens.refresh_token})).status,400);
});

test('mudança do telefone do piloto invalida tokens anteriores mesmo com o mesmo administrador',async t=>{
  const f=await fixture(t),code=await f.authorization();
  const tokens=await(await f.token({grant_type:'authorization_code',client_id:client,redirect_uri:redirect,
    code,code_verifier:verifier,resource})).json();
  const replacement=createChatGPTAuth(f.db,{PUBLIC_ORIGIN:issuer,CHATGPT_OAUTH_ENABLED:'true',
    CHATGPT_OAUTH_ADMIN_EMAIL:'admin@example.invalid',CENTRAL_MCP_ALLOWED_PHONES:'5544888888888',
    CHATGPT_OAUTH_ALLOWED_PHONES:'5544888888888'},async()=>null);
  assert.equal(replacement.enabled,true);
  assert.equal(replacement.validToken('Bearer '+tokens.access_token),false);
});
