import {opusDuration} from './audio-format.mjs';
const RATE=0.0045; // USD/minute, GPT-Transcribe, official price checked 2026-10-27.
export function createAudioTranscription(db,config,transport,media,canSpend){
  const get=(sql,...p)=>db.prepare(sql).get(...p),run=(sql,...p)=>db.prepare(sql).run(...p);
  db.exec("CREATE TABLE IF NOT EXISTS ai_transcriptions(message_id TEXT PRIMARY KEY REFERENCES messages(id),text TEXT,state TEXT NOT NULL,cost_usd REAL NOT NULL,billing_month TEXT NOT NULL,created INTEGER NOT NULL)");
  run("UPDATE ai_transcriptions SET state='error' WHERE state='running'");
  const fail=message=>{throw Object.assign(Error(message),{aiReason:message});};
  async function read(messageId,valid){
    const cached=get('SELECT * FROM ai_transcriptions WHERE message_id=?',messageId);
    if(cached){if(cached.state==='done')return cached.text;fail('A transcrição anterior não foi confirmada. A equipe precisa conferir o áudio.');}
    if(!media)fail('A transcrição de áudio ainda não está disponível.');
    const part=get("SELECT a.id FROM media a JOIN message_media mm ON mm.media_id=a.id WHERE mm.message_id=? AND a.kind='audio'",messageId);
    if(!part)fail('O áudio não está disponível para ouvir.');
    await media.ensure(part.id);if(!valid())return '';
    const row=media.content(part.id);
    if(row.mime!=='audio/ogg')fail('Este formato de áudio precisa ser ouvido pela equipe. A transcrição automática aceita mensagens de voz OGG/Opus de até 5 minutos.');
    let seconds;try{seconds=opusDuration(row.data);}catch{fail('Não foi possível conferir este áudio. A equipe precisa ouvi-lo.');}
    // Round UP to full minutes, retaining the full reserve even when usage is uncertain.
    const reserve=Math.max(1,Math.ceil(seconds/60))*RATE;
    if(!canSpend(reserve))fail('O limite total do piloto foi atingido. A equipe precisa assumir.');
    if(!valid())return '';
    run("INSERT INTO ai_transcriptions VALUES(?,NULL,'running',?,?,?)",messageId,reserve,new Date().toISOString().slice(0,7),Date.now());
    try{
      const form=new FormData();form.set('model','gpt-transcribe');form.set('file',new Blob([row.data],{type:'audio/ogg'}),'mensagem.ogg');form.append('languages[]','pt');
      const response=await transport('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{authorization:'Bearer '+String(config.OPENAI_API_KEY).trim()},body:form,redirect:'error',signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw Error('Transcription rejected');
      const data=await response.json();
      if(typeof data.text!=='string'||!data.text.trim()||data.text.length>12000||/\x00/.test(data.text))throw Error('Invalid transcription');
      run("UPDATE ai_transcriptions SET text=?,state='done' WHERE message_id=?",data.text.trim(),messageId);
      return data.text.trim();
    }catch{run("UPDATE ai_transcriptions SET state='error' WHERE message_id=?",messageId);fail('Não consegui entender este áudio com segurança. A equipe precisa ouvi-lo; não haverá nova cobrança automática de transcrição.');}
  }
  return{read,cost:month=>get('SELECT COALESCE(SUM(cost_usd),0) AS n FROM ai_transcriptions'+(month?' WHERE billing_month=?':''),...(month?[month]:[])).n};
}
