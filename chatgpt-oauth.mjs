import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const sha256url = value => createHash('sha256').update(value).digest('base64url');
const random = () => randomBytes(32).toString('base64url');
const safe = (a,b) => typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fail = (code,message) => {throw Object.assign(Error(message),{status:code});};
const CLIENT = /^https:\/\/chatgpt\.com\/oauth\/(?:[A-Za-z0-9_-]{1,96}\/)?client\.json$/;
const SCOPE = 'central:read';
const MAX_FORM = 8192;
const html = text => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Autorizar leitura — Central Domum</title><style>body{font:16px system-ui,sans-serif;max-width:440px;margin:3rem auto;padding:1rem}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;font:inherit}button{background:#252525;color:white;border:0;cursor:pointer}p{line-height:1.5}</style></head><body>${text}</body></html>`;

/** An isolated OAuth 2.1 authorization layer. Does not authenticate legacy /mcp traffic. */
export function createChatGPTAuth(db,config,authenticate,transport=fetch){
  const origin=String(config.PUBLIC_ORIGIN||config.RENDER_EXTERNAL_URL||'').replace(/\/$/,'');
  const resource=origin+'/mcp/chatgpt';
  const enabled=String(config.CHATGPT_OAUTH_ENABLED)==='true'&&
    /^https:\/\/[^/?#]+$/.test(origin)&&
    String(config.CHATGPT_OAUTH_ADMIN_EMAIL||'').includes('@')&&
    String(config.CENTRAL_MCP_ALLOWED_PHONES||'').trim().length>0;
  const get=(sql,...params)=>db.prepare(sql).get(...params);
  const run=(sql,...params)=>db.prepare(sql).run(...params);
  const attempts=new Map();
  const clientCache=new Map();
  const abuseKey=ip=>ip+'|all';
  if(enabled)db.exec(`CREATE TABLE IF NOT EXISTS chatgpt_oauth_pending (
    id_hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,redirect_uri TEXT NOT NULL,
    challenge TEXT NOT NULL,state TEXT NOT NULL,scope TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS chatgpt_oauth_codes (
    code_hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,redirect_uri TEXT NOT NULL,
    challenge TEXT NOT NULL,user_id TEXT NOT NULL,resource TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS chatgpt_oauth_access (
    token_hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,user_id TEXT NOT NULL,
    family TEXT NOT NULL,resource TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS chatgpt_oauth_refresh (
    token_hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,user_id TEXT NOT NULL,
    family TEXT NOT NULL,resource TEXT NOT NULL,expires INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0);`);
  const metadata={
    protected:{resource,authorization_servers:[origin],scopes_supported:[SCOPE]},
    authorization:{issuer:origin,authorization_endpoint:origin+'/oauth/authorize',token_endpoint:origin+'/oauth/token',
      authorization_response_iss_parameter_supported:true,client_id_metadata_document_supported:true,
      response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
      token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],
      scopes_supported:[SCOPE,'offline_access']}
  };
  const matches=path=>['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp/chatgpt',
      '/.well-known/oauth-authorization-server','/oauth/authorize','/oauth/approve','/oauth/token','/mcp/chatgpt'].includes(path);
  function cleanup(){
    const now=Date.now();
    for(const name of ['chatgpt_oauth_pending','chatgpt_oauth_codes','chatgpt_oauth_access','chatgpt_oauth_refresh'])
      run(`DELETE FROM ${name} WHERE expires<?`,now);
  }
  function limited(key){
    const now=Date.now(),v=attempts.get(key);
    if(v&&v.until>now&&v.n>=8)return true;
    return false;
  }
  function recordFailure(key){
    const now=Date.now(),v=attempts.get(key);
    attempts.set(key,v&&v.until>now?{n:v.n+1,until:v.until}:{n:1,until:now+900000});
  }
  function issue(userId,clientId,family=random()){
    const access=random(),refresh=random(),now=Date.now();
    run('INSERT INTO chatgpt_oauth_access VALUES(?,?,?,?,?,?)',hash(access),clientId,userId,family,resource,now+900000);
    run('INSERT INTO chatgpt_oauth_refresh(token_hash,client_id,user_id,family,resource,expires) VALUES(?,?,?,?,?,?)',hash(refresh),clientId,userId,family,resource,now+30*86400000);
    return{access_token:access,token_type:'Bearer',expires_in:900,refresh_token:refresh,scope:SCOPE};
  }
  function currentAdmin(userId){
    return get("SELECT id FROM agents WHERE id=? AND active=1 AND role='admin' AND lower(email)=?",userId,String(config.CHATGPT_OAUTH_ADMIN_EMAIL).trim().toLowerCase());
  }
  function validToken(supplied){
    if(typeof supplied!=='string'||!/^Bearer [A-Za-z0-9_-]{40,256}$/.test(supplied))return false;
    const token=supplied.slice(7);
    const row=get('SELECT * FROM chatgpt_oauth_access WHERE token_hash=? AND expires>? AND resource=?',hash(token),Date.now(),resource);
    if(!row||!currentAdmin(row.user_id))return false;
    const revoked=get('SELECT 1 FROM chatgpt_oauth_refresh WHERE family=? AND revoked=1 LIMIT 1',row.family);
    return !revoked;
  }
  function json(res,status,data){
    res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','pragma':'no-cache'});
    res.end(JSON.stringify(data));
  }
  function tokenError(res,error='invalid_grant',status=400){
    return json(res,status,{error});
  }
  function www(res){
    res.setHeader('www-authenticate',`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp/chatgpt", scope="${SCOPE}"`);
    return json(res,401,{error:'unauthorized'});
  }
  function htmlReply(res,status,body){
    res.setHeader('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('referrer-policy','no-referrer');
    res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    return res.end(html(body));
  }
  async function readForm(req,readBody){
    if(!String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded'))fail(415,'Tipo inválido.');
    const bytes=await readBody();
    if(bytes.length>MAX_FORM)fail(413,'Formulário muito grande.');
    return new URLSearchParams(bytes.toString('utf8'));
  }
  async function validClient(clientId,redirect){
    if(!CLIENT.test(clientId)||typeof redirect!=='string'||redirect.length>400||!redirect.startsWith('https://chatgpt.com/'))return false;
    if(redirect!=='https://chatgpt.com/connector_platform_oauth_redirect'&&!/^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,96}$/.test(redirect))return false;
    const cached=clientCache.get(clientId);
    if(cached?.until>Date.now())return cached.redirects.includes(redirect);
    const response=await transport(clientId,{redirect:'error',signal:AbortSignal.timeout(5000),headers:{accept:'application/json'}});
    if(!response.ok)fail(503,'Não foi possível verificar o cliente OAuth.');
    const payload=await response.text();
    if(payload.length>32000)fail(400,'Metadados do cliente inválidos.');
    const data=JSON.parse(payload);
    if(data.client_id!==clientId||typeof data.client_name!=='string'||!data.client_name.trim()||data.client_name.length>160||
        !Array.isArray(data.redirect_uris)||!data.redirect_uris.length||data.redirect_uris.length>30||
        !data.redirect_uris.every(uri=>typeof uri==='string'&&uri.length<500))fail(400,'Metadados do cliente inválidos.');
    if(data.grant_types&&(!Array.isArray(data.grant_types)||!data.grant_types.includes('authorization_code')))fail(400,'Cliente sem autorização de código.');
    // ChatGPT's production CIMD advertises both methods, with a legacy preference for private_key_jwt.
    // This server supports only public clients, so require 'none' in the authoritative methods list.
    const methods=data.token_endpoint_auth_methods_supported;
    if(methods!==undefined){
      if(!Array.isArray(methods)||!methods.length||!methods.every(m=>typeof m==='string')||!methods.includes('none'))
        fail(400,'Cliente não permite autenticação pública.');
    }else if(data.token_endpoint_auth_method!=='none')fail(400,'Cliente não permite autenticação pública.');
    clientCache.set(clientId,{until:Date.now()+300000,redirects:data.redirect_uris});
    return data.redirect_uris.includes(redirect);
  }
  async function handle(req,res,{url,readBody,forwardMcp}){
    if(!enabled)fail(404,'Integração OAuth não configurada.');
    const path=url.pathname;
    if(path==='/.well-known/oauth-protected-resource'||path==='/.well-known/oauth-protected-resource/mcp/chatgpt'){
      if(req.method!=='GET')fail(405,'Método não permitido.');
      return json(res,200,metadata.protected);
    }
    if(path==='/.well-known/oauth-authorization-server'){
      if(req.method!=='GET')fail(405,'Método não permitido.');
      return json(res,200,metadata.authorization);
    }
    if(path==='/mcp/chatgpt'){
      if(!validToken(req.headers.authorization))return www(res);
      return forwardMcp(req,res);
    }
    if(path==='/oauth/authorize'){
      if(req.method!=='GET')fail(405,'Método não permitido.');
      const q=url.searchParams,clientId=q.get('client_id'),redirect=q.get('redirect_uri'),challenge=q.get('code_challenge');
      if(q.get('response_type')!=='code'||q.get('code_challenge_method')!=='S256'||!challenge||
          !/^[A-Za-z0-9_-]{43}$/.test(challenge)||!q.get('state')||q.get('state').length>512||
          q.get('resource')!==resource||!clientId||!redirect||!await validClient(clientId,redirect))fail(400,'Solicitação OAuth inválida.');
      const scopes=new Set(String(q.get('scope')||SCOPE).split(' ').filter(Boolean));
      if(!scopes.has(SCOPE)||[...scopes].some(s=>![SCOPE,'offline_access'].includes(s)))fail(400,'Escopo OAuth não autorizado.');
      cleanup();
      const ticket=random();
      run('INSERT INTO chatgpt_oauth_pending VALUES(?,?,?,?,?,?,?)',hash(ticket),clientId,redirect,challenge,q.get('state'),SCOPE,Date.now()+300000);
      return htmlReply(res,200,`<h1>Conectar ChatGPT à Central Domum</h1><p>Autorize a consulta somente de leitura das conversas previamente permitidas. Nenhum envio de mensagem será habilitado.</p><form method="post" action="/oauth/approve"><input type="hidden" name="ticket" value="${ticket}"><label>E-mail do administrador<input type="email" name="email" autocomplete="username" required maxlength="160"></label><label>Senha da Central<input type="password" name="password" autocomplete="current-password" required maxlength="512"></label><button type="submit">Autorizar consulta</button></form>`);
    }
    if(path==='/oauth/approve'){
      if(req.method!=='POST')fail(405,'Método não permitido.');
      if(req.headers.origin!==origin)fail(403,'Origem não autorizada.');
      const form=await readForm(req,readBody),ticket=form.get('ticket')||'',email=String(form.get('email')||'').trim().toLowerCase(),password=String(form.get('password')||'');
      if(ticket.length>128||!ticket||email.length>160||password.length>512)fail(400,'Formulário inválido.');
      const pending=get('SELECT * FROM chatgpt_oauth_pending WHERE id_hash=? AND expires>?',hash(ticket),Date.now());
      if(!pending)fail(400,'Solicitação vencida. Reinicie a autorização no ChatGPT.');
      const ip=String(req.socket.remoteAddress||'');
      const key=ip+'|'+hash(email),globalKey=abuseKey(ip);
      if(limited(key)||limited(globalKey))fail(429,'Muitas tentativas. Aguarde.');
      const account=await authenticate(email,password);
      if(!account||account.role!=='admin'||!currentAdmin(account.id)){
        recordFailure(key);recordFailure(globalKey);
        return htmlReply(res,401,'<h1>Acesso negado</h1><p>Confira as credenciais e inicie novamente a conexão no ChatGPT.</p>');
      }
      run('DELETE FROM chatgpt_oauth_pending WHERE id_hash=?',hash(ticket));
      attempts.delete(key);
      const code=random();
      run('INSERT INTO chatgpt_oauth_codes VALUES(?,?,?,?,?,?,?)',hash(code),pending.client_id,pending.redirect_uri,pending.challenge,account.id,resource,Date.now()+300000);
      const callback=new URL(pending.redirect_uri);
      callback.searchParams.set('code',code);
      callback.searchParams.set('state',pending.state);
      callback.searchParams.set('iss',origin);
      res.writeHead(302,{location:callback.toString(),'cache-control':'no-store','referrer-policy':'no-referrer'});
      return res.end();
    }
    if(path==='/oauth/token'){
      if(req.method!=='POST')fail(405,'Método não permitido.');
      const form=await readForm(req,readBody),grant=form.get('grant_type'),clientId=form.get('client_id')||'';
      if(!CLIENT.test(clientId)||form.get('resource')!==resource)return tokenError(res,'invalid_request');
      if(grant==='authorization_code'){
        const code=form.get('code')||'',verifier=form.get('code_verifier')||'',redirect=form.get('redirect_uri')||'';
        if(code.length>200||!code||!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))return tokenError(res);
        const row=get('SELECT * FROM chatgpt_oauth_codes WHERE code_hash=? AND expires>?',hash(code),Date.now());
        if(!row||row.client_id!==clientId||row.redirect_uri!==redirect||row.resource!==resource||!currentAdmin(row.user_id)||
            !safe(sha256url(verifier),row.challenge))return tokenError(res);
        const claim=run('DELETE FROM chatgpt_oauth_codes WHERE code_hash=?',hash(code));
        if(claim.changes!==1)return tokenError(res);
        return json(res,200,issue(row.user_id,clientId));
      }
      if(grant==='refresh_token'){
        const secret=form.get('refresh_token')||'';
        if(secret.length>200||!secret)return tokenError(res);
        const row=get('SELECT * FROM chatgpt_oauth_refresh WHERE token_hash=?',hash(secret));
        if(!row||row.client_id!==clientId||row.resource!==resource)return tokenError(res);
        if(row.used||row.revoked){
          run('UPDATE chatgpt_oauth_refresh SET revoked=1 WHERE family=?',row.family);
          run('DELETE FROM chatgpt_oauth_access WHERE family=?',row.family);
          return tokenError(res);
        }
        if(row.expires<=Date.now()||!currentAdmin(row.user_id))return tokenError(res);
        const claim=run('UPDATE chatgpt_oauth_refresh SET used=1 WHERE token_hash=? AND used=0 AND revoked=0',hash(secret));
        if(claim.changes!==1)return tokenError(res);
        return json(res,200,issue(row.user_id,clientId,row.family));
      }
      return tokenError(res,'unsupported_grant_type');
    }
    fail(404,'Rota não encontrada.');
  }
  return{enabled,resource,metadata,matches,handle,validToken};
}
