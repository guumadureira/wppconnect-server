import {createHash,randomUUID} from 'node:crypto';
const fail=(text,status=400)=>{throw Object.assign(Error(text),{status});};
const hash=v=>createHash('sha256').update(v).digest('hex');
export function parseGroupExport(source,order='dmy',now=Date.now()){
 if(typeof source!=='string'||Buffer.byteLength(source)>1000000||source.includes('\0'))fail('TXT invalido ou acima de 1 MB.');
 if(!['dmy','mdy'].includes(order))fail('Formato de data invalido.');
 let current=null,invalid=0,headers=0;const messages=[];
 for(const raw of source.split(/\r?\n/)){
  const line=raw.replace(/^[\u200e\u200f\u202a-\u202e\ufeff]+/,'');
  const m=line.match(/^\[?(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s?([AP]M))?\]?(?:\s+-)?\s+(.+)$/i);
  if(!m){if(current)current.body+='\n'+raw;continue;}
  headers++;current=null;const [,a,b,y,h,mi,s,apm,rest]=m;
  const year=Number(y)+(y.length===2?2000:0),month=Number(order==='dmy'?b:a),date=Number(order==='dmy'?a:b);
  let hour=Number(h);if(apm)hour=hour%12+(/PM/i.test(apm)?12:0);
  const utc=Date.UTC(year,month-1,date,hour,Number(mi),Number(s||0)),check=new Date(utc);
  if(year<2000||check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==date||hour>23||Number(mi)>59){invalid++;continue;}
  const split=rest.indexOf(': ');if(split<1)continue;
  current={author:rest.slice(0,split).trim(),body:rest.slice(split+2),created:utc+10800000};messages.push(current);
 }
 if(invalid||!headers)fail('Datas invalidas ou exportacao nao reconhecida.');
 const selected=messages.filter(m=>m.created>=now-30*86400000&&m.created<=now+300000);
 if(selected.length>5000||selected.some(m=>!m.author||m.author.length>160||!m.body||m.body.length>8000))fail('Arquivo excede limites de seguranca.');
 return {messages:selected.sort((a,b)=>a.created-b.created),authors:[...new Set(selected.map(x=>x.author))],ignored:messages.length-selected.length};
}
export function createGroupHistory(db){
 const get=(q,...a)=>db.prepare(q).get(...a),all=(q,...a)=>db.prepare(q).all(...a),run=(q,...a)=>db.prepare(q).run(...a);
 db.exec("CREATE TABLE IF NOT EXISTS whatsapp_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,created INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS whatsapp_group_messages(id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES whatsapp_groups(id),author TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS idx_group_time ON whatsapp_group_messages(group_id,created);CREATE TABLE IF NOT EXISTS whatsapp_group_previews(id TEXT PRIMARY KEY,group_id TEXT NOT NULL,actor_id TEXT NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL,expires INTEGER NOT NULL,confirmed INTEGER NOT NULL DEFAULT 0);");
 const gid=(id,m)=>'group:'+hash(JSON.stringify([id,m.author,m.created,m.body]));
 const list=()=>all('SELECT g.id,g.name,COUNT(m.id) AS message_count,COUNT(DISTINCT m.author) AS observed_authors FROM whatsapp_groups g LEFT JOIN whatsapp_group_messages m ON m.group_id=g.id GROUP BY g.id ORDER BY g.created DESC');
 function create(body){
  const name=typeof body.name==='string'?body.name.trim():'';
  if(name.length<2||name.length>120||/[\r\n\x00-\x1f\x7f]/.test(name))fail('Nome de grupo invalido.');
  if(get('SELECT id FROM whatsapp_groups WHERE name=?',name))fail('Grupo ja cadastrado.',409);
  const id=randomUUID();run('INSERT INTO whatsapp_groups VALUES(?,?,?)',id,name,Date.now());return{id,name};
 }
 function detail(id){
  const group=get('SELECT * FROM whatsapp_groups WHERE id=?',id);if(!group)fail('Grupo nao encontrado.',404);
  const hasPilot=!!get("SELECT name FROM sqlite_master WHERE type='table' AND name='group_pilot_receipts'");
  const messages=all(hasPilot?'SELECT m.*,r.kind,r.from_me AS fromMe,r.received AS receivedAt FROM whatsapp_group_messages m LEFT JOIN group_pilot_receipts r ON r.id=substr(m.id,6) WHERE m.group_id=? ORDER BY m.created DESC LIMIT 300':'SELECT * FROM whatsapp_group_messages WHERE group_id=? ORDER BY created DESC LIMIT 300',id).reverse();
  const participants=all('SELECT author,COUNT(*) AS messages,MAX(created) AS last_seen FROM whatsapp_group_messages WHERE group_id=? GROUP BY author ORDER BY last_seen DESC',id);
  return{group,messages:messages.map(m=>({...m,source:m.id.startsWith('live:')?'linked_device':'manual_export'})),historyComplete:false,observed_authors:participants,note:'Ultimas 300 mensagens armazenadas. Autores observados, nao participantes atuais. Fonte por mensagem; historico integral nao comprovado. Sem IA ou Notion automatico.'};
 }
 function preview(id,body,actor){
  if(!get('SELECT id FROM whatsapp_groups WHERE id=?',id))fail('Grupo nao encontrado.',404);
  if(body.groupConfirmed!==true)fail('Confirme o grupo antes de importar.');
  const parsed=parseGroupExport(body.text,body.dateOrder);
  if(!parsed.messages.length)fail('Sem mensagens dos ultimos 30 dias.');
  const selected=parsed.messages.filter(m=>!get('SELECT id FROM whatsapp_group_messages WHERE id=?',gid(id,m)));
  const payload=JSON.stringify({id,messages:selected}),digest=hash(payload),previewId=randomUUID();
  run('INSERT INTO whatsapp_group_previews(id,group_id,actor_id,digest,payload,expires) VALUES(?,?,?,?,?,?)',previewId,id,actor.id,digest,payload,Date.now()+1800000);
  return{previewId,digest,count:selected.length,duplicates:parsed.messages.length-selected.length,observedAuthors:parsed.authors,sample:selected.slice(0,3)};
 }
 function confirm(id,body,actor){
  const p=get('SELECT * FROM whatsapp_group_previews WHERE id=? AND group_id=? AND actor_id=?',body.previewId,id,actor.id);
  if(!p||!body.confirmed||body.digest!==p.digest)fail('Confirmacao da previa invalida.');
  if(p.confirmed)return{imported:0,repeated:true};
  if(p.expires<Date.now())fail('Previa expirada.',409);
  const payload=JSON.parse(p.payload);let imported=0;
  db.exec('BEGIN IMMEDIATE');try{
   for(const m of payload.messages)imported+=run('INSERT OR IGNORE INTO whatsapp_group_messages VALUES(?,?,?,?,?)',gid(id,m),id,m.author,m.body,m.created).changes;
   run('UPDATE whatsapp_group_previews SET confirmed=1 WHERE id=?',p.id);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return{imported};
 }
 function receive(id,m){
  if(!get('SELECT id FROM whatsapp_groups WHERE id=?',id))fail('Grupo nao encontrado.',404);
  const key='live:'+hash(JSON.stringify([m.session,m.id]));
  const old=get('SELECT * FROM whatsapp_group_messages WHERE id=?',key);
  if(old){if(old.group_id!==id||old.author!==m.author||old.body!==m.body||old.created!==m.created)fail('Identificador de mensagem divergente.',409);return{duplicate:true};}
  run('INSERT INTO whatsapp_group_messages(id,group_id,author,body,created) VALUES(?,?,?,?,?)',key,id,m.author,m.body,m.created);
  return{duplicate:false};
 }
 return{list,create,detail,preview,confirm,receive};
}
