import {createHash,randomUUID} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=message=>{throw Object.assign(Error(message),{status:400});};
const day=86400000;
export function parseWhatsAppExport(source,order='dmy',now=Date.now()){
  if(typeof source!=='string'||Buffer.byteLength(source)>1_000_000||source.includes('\0'))fail('Use um TXT de até 1 MB, sem mídia. Se recebeu ZIP, extraia o arquivo TXT.');
  if(!['dmy','mdy'].includes(order))fail('Formato de data inválido.');
  const messages=[];let current,invalid=0;
  for(const raw of source.split(/\r?\n/)){
    const line=raw.replace(/^[\u200e\u200f\u202a-\u202e\ufeff]+/,'');
    const m=line.match(/^\[?(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s?([AP]M))?\]?(?:\s+-)?\s+(.+)$/i);
    if(!m){if(current)current.body+='\n'+raw;continue;}
    const [,a,b,y,h,min,sec,ampm,rest]=m,year=Number(y)+(y.length===2?2000:0),month=Number(order==='dmy'?b:a),date=Number(order==='dmy'?a:b);
    let hour=Number(h);if(ampm)hour=hour%12+(/PM/i.test(ampm)?12:0);
    const local=Date.UTC(year,month-1,date,hour,Number(min),Number(sec||0)),check=new Date(local);
    const valid=year>=2000&&year<=2099&&check.getUTCFullYear()===year&&check.getUTCMonth()===month-1&&check.getUTCDate()===date&&hour<24&&Number(min)<60&&Number(sec||0)<60;
    const split=rest.indexOf(': ');current=null;
    if(!valid){invalid++;continue;}
    if(split<1){messages.push({system:true,created:local+3*3600000});continue;}
    current={author:rest.slice(0,split).trim(),body:rest.slice(split+2),created:local+3*3600000};messages.push(current);
  }
  const selected=messages.filter(m=>!m.system&&m.created>=now-7*day&&m.created<=now+300000);
  if(invalid)fail('Há datas inválidas. Confira o formato selecionado antes de importar.');
  if(!messages.length)fail('Não reconhecemos as datas deste TXT. Use uma exportação original do WhatsApp em dia/mês/ano ou mês/dia/ano.');
  if(selected.some(m=>!m.author||m.author.length>160||m.body.length>8000))fail('Há mensagens ou nomes acima do limite. A equipe precisa conferir esse TXT.');
  const participants=[...new Set(selected.map(m=>m.author))];
  if(participants.length>2)fail('Este TXT contém mais de dois participantes. Nesta versão, importe somente conversas individuais com identificação inequívoca.');
  return{messages:selected.sort((a,b)=>a.created-b.created),participants,ignored:messages.length-selected.length};
}
export function createHistoryImport(db,context,ai){
  const get=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
  db.exec(`CREATE TABLE IF NOT EXISTS history_import_previews(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,actor_id TEXT NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL,context_version INTEGER NOT NULL,last_received INTEGER,expires INTEGER NOT NULL,confirmed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS imported_history(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,author TEXT NOT NULL,direction TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL,import_id TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS imported_history_conversation ON imported_history(conversation_id,created);`);
  const entryId=(c,m)=>'import:'+hash(JSON.stringify([c.id,m.direction,m.author,m.created,m.body]));
  function inspect(body){const parsed=parseWhatsAppExport(body.text,body.dateOrder);return{participants:parsed.participants,count:parsed.messages.length,ignored:parsed.ignored,first:parsed.messages[0]?.created,last:parsed.messages.at(-1)?.created};}
  function preview(c,body,actor){
    const parsed=parseWhatsAppExport(body.text,body.dateOrder);
    if(!parsed.messages.length)fail('Este arquivo não tem mensagens nos últimos 7 dias.');
    if(body.participantsConfirmed!==true||!parsed.participants.includes(body.customerName))fail('Confira quem é o contato e quem representa a Domum antes de importar.');
    const messages=parsed.messages.map(m=>({...m,direction:m.author===body.customerName?'in':'out'}));
    const existing=all('SELECT direction,body,created FROM messages WHERE conversation_id=?',c.id),seen=new Set();let duplicates=0;
    const selected=messages.filter(m=>{
      const id=entryId(c,m),old=get('SELECT id FROM imported_history WHERE id=?',id);
      const live=existing.some(e=>e.direction===m.direction&&e.body.trim()===m.body.trim()&&Math.floor(e.created/60000)===Math.floor(m.created/60000));
      if(seen.has(id)||old||live){duplicates++;return false;}seen.add(id);return true;
    });
    const payload=JSON.stringify({phone:c.phone,customerName:body.customerName,messages:selected,duplicates,ignored:parsed.ignored,controlEpoch:get('SELECT epoch FROM ai_control WHERE conversation_id=?',c.id)?.epoch||0});
    const id=randomUUID(),digest=hash(payload),ctx=context.view(c.id);
    run('INSERT INTO history_import_previews VALUES(?,?,?,?,?,?,?,?,0)',id,c.id,actor.id,digest,payload,ctx.version,c.last_received,Date.now()+1800000);
    return{previewId:id,digest,phone:c.phone,customerName:body.customerName,teamNames:parsed.participants.filter(n=>n!==body.customerName),count:selected.length,duplicates,ignored:parsed.ignored,sample:[...selected.slice(0,2),...selected.slice(-2)].filter((m,i,a)=>a.indexOf(m)===i)};
  }
  function confirm(c,body,actor){
    const row=get('SELECT * FROM history_import_previews WHERE id=? AND conversation_id=? AND actor_id=?',body.previewId,c.id,actor.id);
    if(!row||body.confirmed!==true||body.digest!==row.digest)fail('Confirme a prévia desta conversa antes de importar.');
    const payload=JSON.parse(row.payload);if(row.confirmed)return{imported:payload.messages.length,repeated:true};
    const ctx=context.view(c.id);if(row.expires<Date.now()||ctx.version!==row.context_version||c.last_received!==row.last_received||c.phone!==payload.phone||(get('SELECT epoch FROM ai_control WHERE conversation_id=?',c.id)?.epoch||0)!==payload.controlEpoch)fail('A conversa ou a prévia mudou. Confira novamente antes de importar.');
    db.exec('BEGIN IMMEDIATE');try{
      for(const m of payload.messages)run('INSERT OR IGNORE INTO imported_history VALUES(?,?,?,?,?,?,?)',entryId(c,m),c.id,m.author,m.direction,m.body,m.created,row.id);
      run('UPDATE history_import_previews SET confirmed=1 WHERE id=?',row.id);
      ai.pause(c.id,'Histórico manual importado. Confira o contexto e use Permitir assistência quando estiver pronto.');
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return{imported:payload.messages.length};
  }
  function forAI(conversationId){
    const rows=all('SELECT author,direction,body,created FROM imported_history WHERE conversation_id=? AND created>=? ORDER BY created DESC LIMIT 60',conversationId,Date.now()-7*day),selected=[];let bytes=0;
    for(const row of rows){const m={author:row.author,direction:row.direction,text:row.body.slice(0,1200),at:row.created};const size=Buffer.byteLength(JSON.stringify(m));if(bytes+size>7000)break;bytes+=size;selected.unshift(m);}
    const total=get('SELECT COUNT(*) AS n FROM imported_history WHERE conversation_id=? AND created>=?',conversationId,Date.now()-7*day).n;
    return{source:'exportacao_manual_nao_verificada',messages:selected,limited:selected.length<total||rows.some(m=>m.body.length>1200),note:'Histórico passado, não é uma nova solicitação nem prova de andamento atual. Não usar para cadastrar automaticamente pessoas ou disparar tarefas.'};
  }
  const messages=()=>all('SELECT * FROM imported_history ORDER BY created').map(m=>({id:m.id,conversation_id:m.conversation_id,direction:m.direction,body:m.direction==='out'?m.author+': '+m.body:m.body,agent_name:m.direction==='out'?m.author:null,status:'imported',created:m.created}));
  return{inspect,preview,confirm,forAI,messages};
}
