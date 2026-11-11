import {createHmac,timingSafeEqual,createHash} from 'node:crypto';

const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const jidPattern=/^[0-9]{5,30}(?:-[0-9]{5,20})?@g\.us$/;
const uuidPattern=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const sessionPattern=/^[a-zA-Z0-9_-]{1,64}$/;
const validText=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const digest=x=>createHash('sha256').update(x).digest('hex');
export function pilotBindings(value){
 let rows;try{rows=JSON.parse(value||'[]');}catch{fail(400,'Lista de grupos invalida.');}
 if(!Array.isArray(rows)||rows.length<1||rows.length>20)fail(400,'Selecione de 1 a 20 grupos.');
 const map=new Map(),ids=new Set();
 for(const row of rows){
  if(!row||!jidPattern.test(row.jid)||!uuidPattern.test(row.groupId)||map.has(row.jid)||ids.has(row.groupId))fail(400,'Vinculos de grupos invalidos ou duplicados.');
  map.set(row.jid,row.groupId);ids.add(row.groupId);
 }
 return map;
}
export function signPilot(raw,key,timestamp=Date.now()){
 const time=String(timestamp);
 return{'x-group-time':time,'x-group-signature':'sha256='+createHmac('sha256',key).update(time+'.').update(raw).digest('hex')};
}

/** Separate receive-only credential. No individual chat, AI or Notion APIs. */
export function createGroupPilot(db,config,history){
 const enabled=config.GROUP_PILOT_ENABLED==='true';
 if(!enabled)return{enabled:false,receive:()=>fail(404,'Piloto nao habilitado.'),status:()=>({enabled:false})};
 const key=String(config.GROUP_PILOT_KEY||''),session=config.GROUP_PILOT_SESSION;
 if(key.length<32||!sessionPattern.test(session||''))fail(400,'Configure a credencial e a sessao privadas do piloto.');
 const bindings=pilotBindings(config.GROUP_PILOT_BINDINGS_JSON);
 db.exec(`CREATE TABLE IF NOT EXISTS group_pilot_state(session TEXT PRIMARY KEY,last_event INTEGER,last_heartbeat INTEGER,connected INTEGER NOT NULL DEFAULT 0,queued INTEGER NOT NULL DEFAULT 0,gaps INTEGER NOT NULL DEFAULT 0,received INTEGER NOT NULL DEFAULT 0,duplicates INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS group_pilot_receipts(id TEXT PRIMARY KEY,group_id TEXT NOT NULL,kind TEXT NOT NULL,from_me INTEGER NOT NULL,received INTEGER NOT NULL);`);
 const get=(s,...p)=>db.prepare(s).get(...p),run=(s,...p)=>db.prepare(s).run(...p);
 run('INSERT OR IGNORE INTO group_pilot_state(session) VALUES(?)',session);
 let until=0,requests=0;
 function receive(raw,headers,now=Date.now()){
  if(!Buffer.isBuffer(raw)||raw.length>32768)fail(413,'Evento excede o limite.');
  if(headers.origin)fail(403,'Use o coletor privado, nao o navegador.');
  if(!String(headers['content-type']||'').startsWith('application/json'))fail(415,'Use JSON.');
  const time=headers['x-group-time'],signature=headers['x-group-signature'];
  if(typeof time!=='string'||!/^\d{13}$/.test(time)||Math.abs(now-Number(time))>120000)fail(403,'Evento sem autenticacao atual.');
  const expected=signPilot(raw,key,time)['x-group-signature'];
  if(typeof signature!=='string'||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))fail(403,'Assinatura invalida.');
  if(now>=until){until=now+60000;requests=0;}if(++requests>120)fail(429,'Aguarde a proxima janela do piloto.');
  let event;try{event=JSON.parse(raw.toString('utf8'));}catch{fail(400,'JSON invalido.');}
  if(!event||event.session!==session)fail(403,'Sessao nao autorizada.');
  if(event.event==='heartbeat'){
   if(typeof event.connected!=='boolean'||!Number.isSafeInteger(event.at)||Math.abs(now-event.at)>120000||![event.queued,event.gaps].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000))fail(400,'Estado do coletor invalido.');
   // A delayed heartbeat cannot replace a newer connection state.
   run('UPDATE group_pilot_state SET connected=?,last_heartbeat=?,queued=?,gaps=MAX(gaps,?) WHERE session=? AND COALESCE(last_heartbeat,0)<?',Number(event.connected),event.at,event.queued,event.gaps,session,event.at);
   return{accepted:true};
  }
  const m=event.message;
  if(event.event!=='message'||!m||!bindings.has(m.jid))fail(403,'Grupo nao autorizado.');
  if(!validText(m.id,512)||!validText(m.author,160)||!validText(m.body,8000)||!['text','image','document','audio','video','sticker','unsupported'].includes(m.kind)||typeof m.fromMe!=='boolean'||!Number.isSafeInteger(m.created)||m.created<946684800000||m.created>now+300000)fail(400,'Mensagem de grupo invalida.');
  const groupId=bindings.get(m.jid),receipt=digest(JSON.stringify([session,m.id]));
  const old=get('SELECT * FROM group_pilot_receipts WHERE id=?',receipt);
  if(old&&(old.group_id!==groupId||old.kind!==m.kind||old.from_me!==Number(m.fromMe)))fail(409,'Identificador de mensagem divergente.');
  if(!old&&get('SELECT COUNT(*) AS n FROM whatsapp_group_messages WHERE group_id=?',groupId).n>=10000)fail(507,'Limite do piloto atingido. Confira armazenamento e cobertura.');
  db.exec('BEGIN IMMEDIATE');
  try{
   const result=history.receive(groupId,{...m,session});
   run('INSERT OR IGNORE INTO group_pilot_receipts VALUES(?,?,?,?,?)',receipt,groupId,m.kind,Number(m.fromMe),now);
   run('UPDATE group_pilot_state SET last_event=MAX(COALESCE(last_event,0),?),received=received+?,duplicates=duplicates+? WHERE session=?',now,Number(!result.duplicate),Number(result.duplicate),session);
   db.exec('COMMIT');return{accepted:true,duplicate:result.duplicate};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function status(now=Date.now()){
  const row=get('SELECT * FROM group_pilot_state WHERE session=?',session);
  const online=!!row.connected&&row.last_heartbeat>now-90000;
  return{enabled:true,online,configuredGroups:bindings.size,lastEventAt:row.last_event,lastHeartbeatAt:row.last_heartbeat,queued:row.queued,observedGaps:row.gaps,received:row.received,duplicates:row.duplicates,coverage:row.gaps?'gap_detected':'since_connection_only',historyComplete:false,mediaContentAvailable:false,aiResponses:false,notionSync:false};
 }
 return{enabled,receive,status};
}

/** Filter before persistence; never enumerate chats or download media. */
export function groupMessage(message,allowed,now=Date.now()){
 if(!message||message.isGroupMsg!==true||message.isNotification||message.isMdHistoryMsg===true)return null;
 const jid=typeof message.chatId==='string'?message.chatId:message.chatId?._serialized;
 if(!allowed.has(jid))return null;
 const kind=({chat:'text',image:'image',document:'document',ptt:'audio',audio:'audio',video:'video',sticker:'sticker'})[message.type]||'unsupported';
 const created=Number(message.timestamp)*1000;
 const author=typeof message.author==='string'?message.author:'';
 const body=kind==='text'?message.body:'['+kind+' — conteudo nao coletado no piloto]';
 if(!validText(message.id,512)||!validText(author,160)||!validText(body,8000)||!Number.isSafeInteger(created)||created<946684800000||created>now+300000)return null;
 return{jid,id:message.id,author,body,kind,created,fromMe:message.fromMe===true};
}

/** Durable local outbox: retry the same event, stop collecting on capacity gap. */
export function createGroupCollector(db,{session,bindings,key,target},transport=fetch){
 if(!sessionPattern.test(session||'')||key.length<32)fail(400,'Configuracao privada do coletor invalida.');
 const endpoint=new URL(target);
 if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/webhooks/group-pilot'||!(endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)))fail(400,'Destino HTTPS ou loopback invalido.');
 const allowed=pilotBindings(bindings);
 db.exec(`CREATE TABLE IF NOT EXISTS group_collector_outbox(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS group_collector_state(id INTEGER PRIMARY KEY CHECK(id=1),gaps INTEGER NOT NULL DEFAULT 0);INSERT OR IGNORE INTO group_collector_state(id) VALUES(1);`);
 const get=(s,...p)=>db.prepare(s).get(...p),run=(s,...p)=>db.prepare(s).run(...p);
 let connected=false,busy=false,closed=false;
 const state=()=>({queued:get('SELECT COUNT(*) AS n FROM group_collector_outbox').n,gaps:get('SELECT gaps FROM group_collector_state WHERE id=1').gaps,connected});
 function accept(raw){
  if(closed)return false;
  const m=groupMessage(raw,allowed);
  if(!m){
   const jid=typeof raw?.chatId==='string'?raw.chatId:raw?.chatId?._serialized;
   if(raw?.isGroupMsg===true&&allowed.has(jid)&&!raw.isNotification&&raw.isMdHistoryMsg!==true)run('UPDATE group_collector_state SET gaps=gaps+1 WHERE id=1');
   return false;
  }
  const id=digest(JSON.stringify([session,m.id])),payload=JSON.stringify({session,event:'message',message:m});
  const old=get('SELECT payload FROM group_collector_outbox WHERE id=?',id);
  if(old){if(old.payload!==payload){run('UPDATE group_collector_state SET gaps=gaps+1 WHERE id=1');closed=true;}return false;}
  if(state().queued>=1000){run('UPDATE group_collector_state SET gaps=gaps+1 WHERE id=1');closed=true;return false;}
  run('INSERT INTO group_collector_outbox VALUES(?,?,?)',id,payload,Date.now());return true;
 }
 async function post(payload){
  const response=await transport(endpoint.href,{method:'POST',headers:{'content-type':'application/json',...signPilot(payload,key)},body:payload,redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return false;
  try{return(await response.json()).accepted===true;}catch{return false;}
 }
 async function flush(){
  if(busy)return;busy=true;
  try{
   const heartbeat=JSON.stringify({session,event:'heartbeat',connected,at:Date.now(),queued:state().queued,gaps:state().gaps});
   if(!await post(heartbeat))return;
   for(let i=0;i<20;i++){
    const row=get('SELECT * FROM group_collector_outbox ORDER BY created,rowid LIMIT 1');if(!row)break;
    if(!await post(row.payload))break;
    run('DELETE FROM group_collector_outbox WHERE id=?',row.id);
   }
  }catch{/* The durable queue remains; never log private messages or errors. */}finally{busy=false;}
 }
 return{accept,flush,state,setConnected:value=>{connected=value===true;},stop:()=>{closed=true;connected=false;}};
}
