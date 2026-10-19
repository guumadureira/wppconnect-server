import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createWhatsAppSignup } from './whatsapp-signup.mjs';

const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => Date.now();
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const clean = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${Buffer.from(await derive(password, salt, 64)).toString('hex')}`;
}
async function checkPassword(password, encoded) {
  const salt = encoded?.split(':')[0] || '00000000000000000000000000000000';
  const calculated = await passwordHash(String(password || '').slice(0, 512), salt);
  return safeEqual(calculated, encoded || '');
}

export function createCentral(config = process.env, transport = fetch) {
  const database = config.DATABASE_PATH || './data/central.sqlite';
  if (database !== ':memory:') mkdirSync(dirname(resolve(database)), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agents(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT UNIQUE NOT NULL,owner_id TEXT REFERENCES agents(id),status TEXT NOT NULL DEFAULT 'open',pending_since INTEGER,last_inbound INTEGER,last_received INTEGER,followup_at INTEGER,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),provider_id TEXT UNIQUE,request_id TEXT UNIQUE,direction TEXT NOT NULL,body TEXT NOT NULL,agent_id TEXT REFERENCES agents(id),agent_name TEXT,status TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),minutes INTEGER NOT NULL DEFAULT 30);
    INSERT OR IGNORE INTO settings(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,kind TEXT NOT NULL,due INTEGER NOT NULL,delivered INTEGER NOT NULL DEFAULT 0,attempted INTEGER);
  `);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const live = config.WHATSAPP_MODE === 'live';
  const ready = live && ['WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_ACCESS_TOKEN','META_APP_SECRET','WEBHOOK_VERIFY_TOKEN','META_GRAPH_VERSION'].every(k => config[k]);
  const attempts = new Map();
  const signup = createWhatsAppSignup(config, db, transport);
  const tick = () => {
    const minutes = get('SELECT minutes FROM settings WHERE id=1').minutes;
    for (const c of all("SELECT * FROM conversations WHERE status='open'")) {
      const dueItems = [];
      if (c.pending_since) dueItems.push(['unanswered', c.pending_since + minutes * 60000]);
      if (c.followup_at) dueItems.push(['followup', c.followup_at]);
      for (const [kind, due] of dueItems) if (due <= now()) run('INSERT OR IGNORE INTO alerts(id,conversation_id,kind,due) VALUES(?,?,?,?)', `${c.id}:${kind}:${due}`, c.id, kind, due);
    }
    run('DELETE FROM sessions WHERE expires < ?', now());
  };
  async function deliverAlerts() {
    tick();
    if (!config.ALERT_WEBHOOK_URL) return;
    const pending = all(`SELECT a.*,c.name,c.owner_id,g.name AS owner_name FROM alerts a JOIN conversations c ON c.id=a.conversation_id LEFT JOIN agents g ON g.id=c.owner_id
      WHERE a.delivered=0 AND c.status='open' AND (a.attempted IS NULL OR a.attempted < ?) AND
      ((a.kind='unanswered' AND c.pending_since IS NOT NULL AND a.due=c.pending_since+(SELECT minutes*60000 FROM settings WHERE id=1)) OR (a.kind='followup' AND a.due=c.followup_at))`, now() - 300000);
    for (const a of pending) {
      run('UPDATE alerts SET attempted=? WHERE id=?', now(), a.id);
      try {
        const r = await transport(config.ALERT_WEBHOOK_URL, { method:'POST', headers:{'content-type':'application/json', ...(config.ALERT_WEBHOOK_TOKEN ? {authorization:`Bearer ${config.ALERT_WEBHOOK_TOKEN}`} : {})}, body:JSON.stringify({id:a.id,event:a.kind,customer:a.name,ownerId:a.owner_id,ownerName:a.owner_name,due:new Date(a.due).toISOString()}),signal:AbortSignal.timeout(10000) });
        if (r.ok) run('UPDATE alerts SET delivered=1 WHERE id=?', a.id);
      } catch { /* Retry with the same event ID; destinations should deduplicate it. */ }
    }
  }
  function intake(value, field = 'messages') {
    if (String(value.metadata?.phone_number_id) !== String(config.WHATSAPP_PHONE_NUMBER_ID)) return;
    const incoming = field === 'smb_message_echoes' ? (value.message_echoes || []) : (value.messages || []);
    for (const m of incoming) {
      if (!m.id || get('SELECT id FROM messages WHERE provider_id=?', m.id)) continue;
      const echo = field === 'smb_message_echoes';
      const phone = clean(echo ? m.to : m.from, 30);
      if (!/^\d{5,20}$/.test(phone)) continue;
      const timestamp = Number(m.timestamp) * 1000;
      const at = Number.isFinite(timestamp) && timestamp > 0 ? Math.min(timestamp, now()) : now();
      let c = get('SELECT * FROM conversations WHERE phone=?', phone);
      if (!c) {
        const name = clean(value.contacts?.find(p => p.wa_id === phone)?.profile?.name) || phone;
        const id = randomUUID();
        run('INSERT INTO conversations(id,name,phone,updated) VALUES(?,?,?,?)', id, name, phone, at);
        c = get('SELECT * FROM conversations WHERE id=?', id);
      }
      const body = clean(m.text?.body, 4096) || `[${clean(m.type,40) || 'Mensagem não textual'} — consulte o aplicativo WhatsApp Business]`;
      const received = run('INSERT INTO messages(id,conversation_id,provider_id,direction,body,agent_name,status,created) VALUES(?,?,?,?,?,?,?,?)',randomUUID(),c.id,m.id,echo?'out':'in',body,echo?'Aplicativo Business (atendente não identificado)':null,echo?'sent':'received',at).lastInsertRowid;
      if (echo) {
        run('UPDATE conversations SET pending_since=CASE WHEN last_inbound<? THEN NULL ELSE pending_since END,updated=MAX(updated,?) WHERE id=?', at, at, c.id);
      } else {
        const lastOut = get("SELECT MAX(created) AS at FROM messages WHERE conversation_id=? AND direction='out' AND status IN ('sent','delivered','read')", c.id)?.at || 0;
        // Provider timestamps have second precision. Keep ambiguous same-second
        // inbound messages pending rather than silently losing a customer reply.
        const pending = at >= Math.floor(lastOut/1000)*1000 ? Math.min(c.pending_since || at, at) : c.pending_since;
        run("UPDATE conversations SET pending_since=?,last_inbound=MAX(COALESCE(last_inbound,0),?),last_received=?,updated=MAX(updated,?),status=CASE WHEN ?>=CAST(updated/1000 AS INTEGER)*1000 THEN 'open' ELSE status END WHERE id=?", pending,at,received,at,at,c.id);
      }
    }
    for (const s of value.statuses || []) {
      if (!['sent','delivered','read','failed'].includes(s.status)) continue;
      const m = get('SELECT * FROM messages WHERE provider_id=?', s.id);
      if (!m) continue;
      const rank = {sending:0,unknown:0,sent:1,delivered:2,read:3,failed:4};
      if (s.status === 'failed' || rank[s.status] > rank[m.status]) run('UPDATE messages SET status=? WHERE id=?',s.status,m.id);
      if (s.status === 'failed') {
        const c = get('SELECT * FROM conversations WHERE id=?',m.conversation_id);
        const after = get("SELECT id FROM messages WHERE conversation_id=? AND direction='out' AND created>? AND status IN ('sent','delivered','read')",c.id,m.created);
        if (!after && c.last_inbound) run('UPDATE conversations SET pending_since=COALESCE(pending_since,last_inbound) WHERE id=?',c.id);
      }
    }
  }
  async function handler(req, res) {
    const origin = config.PUBLIC_ORIGIN || config.RENDER_EXTERNAL_URL || 'http://localhost:3000';
    const url = new URL(req.url, origin);
    const reply = (status, data) => {res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
    const readBody = async () => {
      const chunks=[];let length=0;
      for await (const chunk of req) {length+=chunk.length;if(length>131072) fail(413,'Mensagem muito grande.');chunks.push(chunk);}
      return Buffer.concat(chunks);
    };
    try {
      res.setHeader('x-content-type-options','nosniff');
      res.setHeader('referrer-policy','same-origin');
      res.setHeader('content-security-policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
      if(url.pathname==='/healthz' && req.method==='GET')return reply(200,{status:'ok',mode:live?'live':'demo'});
      if (url.pathname === '/webhooks/whatsapp') {
        if (req.method==='GET') {
          if (!config.WEBHOOK_VERIFY_TOKEN || url.searchParams.get('hub.mode')!=='subscribe' || !safeEqual(url.searchParams.get('hub.verify_token'), config.WEBHOOK_VERIFY_TOKEN)) fail(403,'Verificação inválida.');
          res.writeHead(200,{'content-type':'text/plain'});return res.end(url.searchParams.get('hub.challenge') || '');
        }
        if (req.method !== 'POST') fail(405,'Método não permitido.');
        if (!ready) fail(503,'Conexão ainda não configurada.');
        const raw = await readBody();
        const expected = 'sha256='+createHmac('sha256',config.META_APP_SECRET).update(raw).digest('hex');
        if (!safeEqual(req.headers['x-hub-signature-256'],expected)) fail(403,'Assinatura inválida.');
        const event = JSON.parse(raw);
        if (event.object!=='whatsapp_business_account') fail(400,'Evento inválido.');
        db.exec('BEGIN');
        try {for(const entry of event.entry || []) for(const change of entry.changes || []) intake(change.value || {},change.field);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
        tick();return reply(200,{ok:true});
      }
      if (url.pathname==='/' && req.method==='GET') {
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
        return res.end(readFileSync(new URL('./public/index.html',import.meta.url)));
      }
      const signupPage = ['/connect/whatsapp','/assets/whatsapp-signup.mjs'].includes(url.pathname);
      if (!url.pathname.startsWith('/api/') && !signupPage) fail(404,'Página não encontrada.');
      if (!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin) fail(403,'Origem não autorizada.');
      let body = {};
      if (['POST','PATCH'].includes(req.method)) {const raw=await readBody();try{body=JSON.parse(raw.toString() || '{}');}catch{fail(400,'Dados inválidos.');}if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'Dados inválidos.');}
      const token = (req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith('central_session='))?.slice(16);
      const user = token ? get('SELECT a.id,a.name,a.email,a.role FROM sessions s JOIN agents a ON a.id=s.agent_id WHERE s.token=? AND s.expires>? AND a.active=1',hash(token),now()) : null;
      const setupRequired = !get('SELECT id FROM agents LIMIT 1');
      if (url.pathname==='/api/session' && req.method==='GET') return reply(200,{user,setupRequired,mode:live?'live':'demo',connected:!!ready});
      if (url.pathname==='/api/setup' && req.method==='POST') {
        if (!setupRequired) fail(409,'A instalação já foi concluída.');
        const local = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && ['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname);
        if (config.SETUP_TOKEN ? !safeEqual(body.setupToken,config.SETUP_TOKEN) : !local) fail(403,'É necessário o código de instalação configurado no servidor.');
        const name=clean(body.name,80),email=clean(body.email).toLowerCase();
        if (!name || !email.includes('@') || typeof body.password!=='string' || body.password.length<12 || body.password.length>512) fail(400,'Informe nome, e-mail e senha de pelo menos 12 caracteres.');
        const encoded = await passwordHash(body.password);
        if (get('SELECT id FROM agents LIMIT 1')) fail(409,'A instalação já foi concluída.');
        run('INSERT INTO agents(id,name,email,password,role) VALUES(?,?,?,?,?)',randomUUID(),name,email,encoded,'admin');
        return reply(201,{ok:true});
      }
      if (url.pathname==='/api/login' && req.method==='POST') {
        const key=req.socket.remoteAddress;
        const counter=attempts.get(key) || {count:0,until:now()+900000};
        if(counter.until<now()) {counter.count=0;counter.until=now()+900000;}
        if(counter.count>=10) fail(429,'Muitas tentativas. Aguarde 15 minutos.');
        counter.count++;attempts.set(key,counter);
        const agent=get('SELECT * FROM agents WHERE email=? AND active=1',clean(body.email).toLowerCase());
        if(!await checkPassword(body.password,agent?.password)) fail(401,'E-mail ou senha incorretos.');
        attempts.delete(key);
        const session=randomBytes(32).toString('hex');
        run('INSERT INTO sessions VALUES(?,?,?)',hash(session),agent.id,now()+12*3600000);
        res.setHeader('set-cookie',`central_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${origin.startsWith('https:')?'; Secure':''}`);
        return reply(200,{ok:true});
      }
      if (!user) fail(401,'Entre com seu usuário para continuar.');
      if (signupPage || url.pathname.startsWith('/api/whatsapp/signup')) {
        if (user.role !== 'admin') fail(403,'Somente administradores podem preparar a conexão.');
        if (signupPage && req.method === 'GET') {
          const page = url.pathname === '/connect/whatsapp';
          if (page) res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' https://connect.facebook.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://www.facebook.com; connect-src 'self' https://www.facebook.com https://graph.facebook.com; frame-src https://www.facebook.com https://web.facebook.com https://business.facebook.com https://staticxx.facebook.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
          res.setHeader('referrer-policy','no-referrer');
          res.writeHead(200,{'content-type':page?'text/html; charset=utf-8':'text/javascript; charset=utf-8','cache-control':'no-store'});
          return res.end(readFileSync(new URL(page?'./public/whatsapp-signup.html':'./public/whatsapp-signup.mjs',import.meta.url)));
        }
        if (url.pathname === '/api/whatsapp/signup' && req.method === 'GET') return reply(200,signup.status(origin));
        if (url.pathname === '/api/whatsapp/signup/start' && req.method === 'POST') return reply(201,signup.start(hash(token),origin));
        if (url.pathname === '/api/whatsapp/signup/complete' && req.method === 'POST') return reply(200,await signup.complete(hash(token),origin,body));
        fail(405,'Método não permitido.');
      }
      if(url.pathname==='/api/connection-status' && req.method==='GET'){
        if(user.role!=='admin')fail(403,'Somente administradores podem consultar a configuração.');
        const required=['WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_ACCESS_TOKEN','META_APP_SECRET','WEBHOOK_VERIFY_TOKEN','META_GRAPH_VERSION'];
        return reply(200,{mode:live?'live':'demo',credentialsConfigured:!!ready,connectionVerified:false,missing:required.filter(name=>!config[name]),webhookPath:'/webhooks/whatsapp',publicHttps:origin.startsWith('https://')});
      }
      if (url.pathname==='/api/logout' && req.method==='POST') {
        if(token)run('DELETE FROM sessions WHERE token=?',hash(token));
        res.setHeader('set-cookie','central_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return reply(200,{ok:true});
      }
      if (url.pathname==='/api/state' && req.method==='GET') {
        tick();return reply(200,{user,mode:live?'live':'demo',connected:!!ready,externalAlerts:!!config.ALERT_WEBHOOK_URL,agents:all('SELECT id,name,email,role,active FROM agents'),conversations:all('SELECT * FROM conversations ORDER BY updated DESC'),messages:all('SELECT * FROM messages ORDER BY created'),settings:get('SELECT minutes FROM settings WHERE id=1')});
      }
      if (url.pathname==='/api/settings' && req.method==='PATCH') {
        if(user.role!=='admin')fail(403,'Somente administradores podem configurar a central.');
        const minutes=Number(body.minutes);if(!Number.isInteger(minutes)||minutes<1||minutes>1440)fail(400,'Use um prazo de 1 a 1440 minutos.');
        run('UPDATE settings SET minutes=? WHERE id=1',minutes);return reply(200,{ok:true});
      }
      if (url.pathname==='/api/agents' && req.method==='POST') {
        if(user.role!=='admin')fail(403,'Somente administradores podem cadastrar atendentes.');
        const name=clean(body.name,80),email=clean(body.email).toLowerCase();
        if(!name||!email.includes('@')||typeof body.password!=='string'||body.password.length<12||body.password.length>512)fail(400,'Informe nome, e-mail e senha de pelo menos 12 caracteres.');
        if(get('SELECT id FROM agents WHERE email=?',email))fail(409,'Já existe um atendente com esse e-mail.');
        run('INSERT INTO agents(id,name,email,password,role) VALUES(?,?,?,?,?)',randomUUID(),name,email,await passwordHash(body.password),'agent');return reply(201,{ok:true});
      }
      const agentMatch=url.pathname.match(/^\/api\/agents\/([^/]+)$/);
      if(agentMatch && req.method==='PATCH') {
        if(user.role!=='admin')fail(403,'Somente administradores podem editar atendentes.');
        const a=get('SELECT * FROM agents WHERE id=?',agentMatch[1]);if(!a)fail(404,'Atendente não encontrado.');
        const name=clean(body.name,80);if(!name)fail(400,'Informe o nome da assinatura.');
        run('UPDATE agents SET name=? WHERE id=?',name,a.id);return reply(200,{ok:true});
      }
      const chatMatch=url.pathname.match(/^\/api\/conversations\/([^/]+)(\/messages)?$/);
      if(chatMatch) {
        const c=get('SELECT * FROM conversations WHERE id=?',chatMatch[1]);if(!c)fail(404,'Conversa não encontrada.');
        if(req.method==='PATCH'&&!chatMatch[2]) {
          const owner=body.owner_id===null?null:body.owner_id;
          if(owner && !get('SELECT id FROM agents WHERE id=? AND active=1',owner))fail(400,'Atendente inválido.');
          const status=body.status || c.status;if(!['open','closed'].includes(status))fail(400,'Situação inválida.');
          const follow=body.followup_at===null?null:body.followup_at===undefined?c.followup_at:Number(body.followup_at);
          if(body.followup_at!==undefined&&follow!==null&&(!Number.isFinite(follow)||follow<=now()))fail(400,'Escolha uma data futura para o retorno.');
          run('UPDATE conversations SET owner_id=?,status=?,followup_at=?,updated=? WHERE id=?',owner===undefined?c.owner_id:owner,status,follow,now(),c.id);return reply(200,{ok:true});
        }
        if(req.method==='POST'&&chatMatch[2]) {
          const text=clean(body.text,3900),requestId=clean(body.requestId,80);
          if(!text||!requestId)fail(400,'Escreva uma mensagem.');
          const previous=get('SELECT * FROM messages WHERE request_id=?',requestId);
          if(previous) {if(previous.conversation_id!==c.id||previous.agent_id!==user.id)fail(409,'Identificador de envio já utilizado.');return reply(200,{message:previous});}
          if(c.status!=='open')fail(409,'Reabra a conversa antes de responder.');
          if(live&&!ready)fail(503,'A conexão com o WhatsApp ainda não foi configurada.');
          if(live&&(!c.last_inbound||now()-c.last_inbound>24*3600000))fail(409,'A janela de 24 horas terminou. O retorno pela API exige um modelo aprovado; use o aplicativo Business para este contato.');
          const id=randomUUID(),at=now(),signed=`${user.name}: ${text}`;
          run('INSERT INTO messages(id,conversation_id,request_id,direction,body,agent_id,agent_name,status,created) VALUES(?,?,?,?,?,?,?,?,?)',id,c.id,requestId,'out',signed,user.id,user.name,live?'sending':'simulated',at);
          if(live) {
            let response;
            try {
              response=await transport(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{authorization:`Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:c.phone,type:'text',text:{body:signed}}),signal:AbortSignal.timeout(15000)});
              const result=await response.json();
              if(!response.ok||!result.messages?.[0]?.id) {run("UPDATE messages SET status='failed' WHERE id=?",id);fail(502,'O WhatsApp recusou o envio. A conversa continua pendente.');}
              const pid=result.messages[0].id;
              const echoed=get('SELECT id FROM messages WHERE provider_id=?',pid);
              if(echoed&&echoed.id!==id)run('DELETE FROM messages WHERE id=?',echoed.id);
              run("UPDATE messages SET status='sent',provider_id=? WHERE id=?",pid,id);
            } catch(e) {
              if(e.status)throw e;
              run("UPDATE messages SET status='unknown' WHERE id=?",id);fail(502,'Não foi possível confirmar o envio. Confira no Business antes de tentar novamente; a pendência foi mantida.');
            }
          }
          // Clear only the inbound message observed before this send started.
          // A new reply arriving while the provider request is in flight stays pending.
          run("UPDATE conversations SET pending_since=CASE WHEN last_received IS ? THEN NULL ELSE pending_since END,owner_id=COALESCE(owner_id,?),updated=MAX(updated,?) WHERE id=?",c.last_received,user.id,at,c.id);
          return reply(201,{message:get('SELECT * FROM messages WHERE id=?',id)});
        }
      }
      if (url.pathname==='/api/demo/incoming' && req.method==='POST') {
        if(live)fail(403,'A simulação está desativada no modo real.');
        const at=now(),id=randomUUID(),text=clean(body.text,4096)||'Olá! Preciso de atendimento.';
        let c=body.conversation_id?get('SELECT * FROM conversations WHERE id=?',clean(body.conversation_id,80)):null;
        if(body.conversation_id&&!c)fail(404,'Conversa não encontrada.');
        if(!c){const phone=String(5500000000000+Math.floor(Math.random()*100000));run('INSERT INTO conversations(id,name,phone,updated) VALUES(?,?,?,?)',id,clean(body.name)||'Cliente de exemplo',phone,at);c=get('SELECT * FROM conversations WHERE id=?',id);}
        const received=run("INSERT INTO messages(id,conversation_id,direction,body,status,created) VALUES(?,?,'in',?,'received',?)",randomUUID(),c.id,text,at).lastInsertRowid;
        run("UPDATE conversations SET last_inbound=?,last_received=?,pending_since=COALESCE(pending_since,?),updated=?,status='open' WHERE id=?",at,received,at,at,c.id);
        return reply(201,{ok:true,id:c.id});
      }
      fail(404,'Recurso não encontrado.');
    } catch(error) {
      if(res.headersSent){res.destroy();return;}
      const status=error.status || 500;
      reply(status,{error:status<500||error.status?error.message:'Não foi possível concluir esta ação.'});
    }
  }
  const server=http.createServer(handler);
  let delivering=false;
  const timer=setInterval(async()=>{
    if(delivering)return;
    delivering=true;
    try{await deliverAlerts();}catch{console.error('Falha ao verificar os lembretes.');}finally{delivering=false;}
  },60000);
  timer.unref();
  return {server,db,intake,tick,deliverAlerts,close:()=>{
    clearInterval(timer);
    return new Promise((resolve,reject)=>server.close(error=>{
      db.close();
      if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')reject(error);else resolve();
    }));
  }};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const central=createCentral();
  const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
  central.server.listen(port,host,()=>console.log(`Central de atendimento iniciada na porta ${port}; modo ${process.env.WHATSAPP_MODE==='live'?'real':'demonstração'}.`));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>central.close().then(()=>process.exit(0)));
}
