import { randomUUID } from 'node:crypto';
import { attendanceInstructions as instructions } from './ai-attendance-guide.mjs';
import {createAudioTranscription} from './audio-transcription.mjs';
import {knowledgeFor} from './attendance-knowledge.mjs';
import {serviceGuidesFor} from './attendance-catalog.mjs';
import {supplierCategories} from './supplier-register.mjs';

// Fixed model and standard text rates verified on 2026-10-26. No model tools.
const MODEL='gpt-5.4-mini-2026-03-17',INPUT_USD=0.75/1e6,OUTPUT_USD=4.5/1e6,MAX_OUTPUT=1800;
const kinds=['atendimento','orcamento','andamento','documentos','alteracao','comercial','administrativo','outro'];
const intakeSchema={type:'object',additionalProperties:false,required:['ready','name','city','service','nameMessageId','cityMessageId','serviceMessageId'],properties:{ready:{type:'boolean'},...Object.fromEntries(['name','city','service','nameMessageId','cityMessageId','serviceMessageId'].map(k=>[k,{type:'string'}]))}};
const schema={type:'object',additionalProperties:false,required:['reply','summary','missing','nextStep','kind','handoff','reason','intake'],properties:{reply:{type:'string',maxLength:700},summary:{type:'string'},missing:{type:'string'},nextStep:{type:'string'},kind:{type:'string',enum:kinds},handoff:{type:'boolean'},reason:{type:'string'},intake:intakeSchema}};
const supplierSchema={type:'object',additionalProperties:false,required:['name','description','category','sourceMessageId','complete'],properties:{name:{type:'string',maxLength:120},description:{type:'string',maxLength:240},category:{type:'string',enum:supplierCategories},sourceMessageId:{type:'string',maxLength:120},complete:{type:'boolean'}}};
schema.required.push('supplier');schema.properties.supplier={anyOf:[supplierSchema,{type:'null'}]};
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const month=()=>new Date().toISOString().slice(0,7);

export function createAIAttendance(db,config,transport,context,{ready=false,debounceMs=2500,media,suppliers,importedHistory}={}){
  const get=(sql,...a)=>db.prepare(sql).get(...a),all=(sql,...a)=>db.prepare(sql).all(...a),run=(sql,...a)=>db.prepare(sql).run(...a);
  db.exec(`CREATE TABLE IF NOT EXISTS ai_jobs(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),message_id TEXT UNIQUE NOT NULL REFERENCES messages(id),epoch INTEGER NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,result TEXT,error TEXT,cost_usd REAL NOT NULL DEFAULT 0,billing_month TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_control(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),epoch INTEGER NOT NULL DEFAULT 0,handoff TEXT NOT NULL DEFAULT '');`);
  // Unknown API results and sends are never retried automatically after a restart.
  const interrupted=all("SELECT * FROM ai_jobs WHERE state='running'");
  run("UPDATE ai_jobs SET state='error',error='Execução interrompida; conferir antes de retomar.',updated=? WHERE state='running'",Date.now());
  const phones=String(config.AI_ALLOWED_PHONES||'').split(',').map(v=>v.trim()).filter(v=>/^[1-9]\d{7,14}$/.test(v));
  const budget=Number(config.AI_MONTHLY_BUDGET_USD)||0;
  const totalBudget=Number(config.AI_TOTAL_BUDGET_USD)||0;
  const enabled=()=>String(config.AI_ENABLED).trim()==='true'&&!!String(config.OPENAI_API_KEY||'').trim()&&phones.length>0&&budget>0&&budget<=100&&(config.AI_TOTAL_BUDGET_USD===undefined||(totalBudget>0&&totalBudget<=100))&&ready;
  const ensure=id=>{run('INSERT OR IGNORE INTO ai_control(conversation_id) VALUES(?)',id);return get('SELECT * FROM ai_control WHERE conversation_id=?',id);};
  const transcriber=createAudioTranscription(db,config,transport,media,cost=>spent()+cost<=budget&&(!totalBudget||totalSpent()+cost<=totalBudget));
  const spent=()=>get('SELECT COALESCE(SUM(cost_usd),0) AS n FROM ai_jobs WHERE billing_month=?',month()).n+transcriber.cost(month());
  const totalSpent=()=>get('SELECT COALESCE(SUM(cost_usd),0) AS n FROM ai_jobs').n+transcriber.cost();
  function status(){return{enabled:enabled(),model:MODEL,credentialPresent:!!String(config.OPENAI_API_KEY||'').trim(),activationPending:String(config.AI_ENABLED).trim()!=='true',pilotConfigured:phones.length>0,budgetUsd:budget>0&&budget<=100?budget:0,usedUsd:spent(),totalBudgetUsd:totalBudget,usedTotalUsd:totalSpent(),audioEnabled:String(config.AI_AUDIO_ENABLED)==='true',autoRegistration:String(config.AI_AUTO_REGISTER)==='true',whatsappReady:ready,pending:get("SELECT COUNT(*) AS n FROM ai_jobs WHERE state IN ('pending','running')").n,handoffs:all("SELECT a.conversation_id,c.name,a.handoff FROM ai_control a JOIN conversations c ON c.id=a.conversation_id WHERE a.handoff<>'' ORDER BY c.updated DESC LIMIT 30")};}
  function pause(id,reason=''){
    ensure(id);run('UPDATE ai_control SET epoch=epoch+1,handoff=? WHERE conversation_id=?',reason,id);
    run("UPDATE ai_jobs SET state='cancelled',updated=? WHERE conversation_id=? AND state='pending'",Date.now(),id);
    run("UPDATE conversation_context SET mode='human',version=version+1,updated=? WHERE conversation_id=? AND mode<>'human'",Date.now(),id);
  }
  function release(conversation){
    if(!enabled())fail(503,'Configure a chave, o piloto, o limite de consumo e a conexão WhatsApp antes de liberar a IA.');
    if(!phones.includes(conversation.phone))fail(403,'Este telefone não está autorizado no piloto da IA.');
    ensure(conversation.id);run("UPDATE ai_control SET epoch=epoch+1,handoff='' WHERE conversation_id=?",conversation.id);
  }
  function incoming(conversation,message,{fresh=false,echo=false,type='text'}={}){
    if(echo){pause(conversation.id);return;}
    if(!enabled()||!phones.includes(conversation.phone))return;
    const c=context.view(conversation.id);
    if(fresh&&!conversation.owner_id){run("UPDATE conversation_context SET mode='assisted',version=version+1 WHERE conversation_id=?",conversation.id);}
    else if(c.mode!=='assisted')return;
    const control=ensure(conversation.id);
    if(!['text','image','document'].includes(type)&&!(type==='audio'&&String(config.AI_AUDIO_ENABLED)==='true')){handoff(conversation.id,message.id,'Arquivo recebido: precisa de conferência humana.');return;}
    const salesOffer=c.kind==='comercial'||/\b(?:oferecemos|vendemos|ofereço|represento)\b|sou .{0,30}(?:prestador|fornecedor|representante)/i.test(message.body);
    if(!salesOffer&&/(?:falar|conversar|atendido|atendida).{0,35}(?:pessoa|humano|humana|gustavo|atendente)|(?:quero|preciso).{0,20}(?:humano|humana)/i.test(message.body)){handoff(conversation.id,message.id,'Contato solicitou atendimento humano.');return;}
    run("UPDATE ai_jobs SET state='cancelled',updated=? WHERE conversation_id=? AND state='pending'",Date.now(),conversation.id);
    run("INSERT OR IGNORE INTO ai_jobs(id,conversation_id,message_id,epoch,state,created,updated,billing_month) VALUES(?,?,?,?,'pending',?,?,?)",randomUUID(),conversation.id,message.id,control.epoch,Date.now(),Date.now(),month());
  }
  function handoff(id,key,reason,result){
    pause(id,reason);context.aiRecord(id,key,result||{summary:reason,missing:'Conferência da equipe',nextStep:'Assumir atendimento',kind:'atendimento'},true);
  }
  const valid=job=>{
    const c=get('SELECT *,rowid AS chat_row FROM conversations WHERE id=?',job.conversation_id),control=ensure(job.conversation_id),ctx=context.view(job.conversation_id);
    return !stopped&&enabled()&&phones.includes(c.phone)&&c.status==='open'&&ctx.mode==='assisted'&&control.epoch===job.epoch&&(job.contextVersion===undefined||ctx.version===job.contextVersion)&&c.last_received===get('SELECT rowid AS n FROM messages WHERE id=?',job.message_id)?.n&&Date.now()-c.last_inbound<24*3600000;
  };
  function resultView(id){const row=get('SELECT state,result,error,updated FROM ai_jobs WHERE conversation_id=? ORDER BY created DESC,rowid DESC LIMIT 1',id);return row?{...row,result:row.result?JSON.parse(row.result):null,handoff:ensure(id).handoff}:null;}
  function validated(result){
    if(!result||Array.isArray(result)||!kinds.includes(result.kind)||typeof result.handoff!=='boolean')throw Error('Invalid output');
    if(!result.intake||Array.isArray(result.intake)||typeof result.intake.ready!=='boolean')throw Error('Invalid intake');
    for(const field of ['name','city','service','nameMessageId','cityMessageId','serviceMessageId'])if(typeof result.intake[field]!=='string'||result.intake[field].length>120||/\0/.test(result.intake[field]))throw Error('Invalid intake field');
    for(const [k,max]of Object.entries({reply:700,summary:1800,missing:1000,nextStep:1000,reason:500}))if(typeof result[k]!=='string'||result[k].length>max||/\0/.test(result[k]))throw Error('Invalid output');
    if(/https?:\/\/|www\.|sk-proj-|Bearer /i.test(result.reply))throw Error('Unsafe output');
    if(/R\$|\b(?:custa|custará|garantimos)\b|\b(?:prazo|entrega).{0,35}\d/i.test(result.reply))throw Error('Unapproved commitment');
    if(!result.reply.trim()&&!result.handoff)throw Error('Empty output');return result;
  }
  function supplierEvidence(result,history){
    const s=result.supplier;if(s==null)return;
    if(result.kind!=='comercial'||typeof s.complete!=='boolean'||!supplierCategories.includes(s.category))throw Error('Invalid supplier');
    for(const [key,max]of Object.entries({name:120,description:240,sourceMessageId:120}))if(typeof s[key]!=='string'||s[key].length>max||/\0/.test(s[key]))throw Error('Invalid supplier field');
    const source=history.find(m=>m.direction==='in'&&m.id===s.sourceMessageId);
    if((s.description||s.complete)&&!source)throw Error('Supplier source unavailable');
    if(s.name&&!history.some(m=>m.direction==='in'&&m.body.toLocaleLowerCase('pt-BR').includes(s.name.toLocaleLowerCase('pt-BR'))))s.name='';
    if(s.complete&&(!s.description.trim()||s.category==='A identificar'))throw Error('Supplier service unavailable');
  }
  function registrationEvidence(result,history){
    const intake=result.intake;if(!intake?.ready)return null;
    if(!['atendimento','orcamento','documentos'].includes(result.kind))throw Error('Commercial registration');
    if(history.filter(m=>m.direction==='in').some(m=>/\b(?:fornecedor|representante|vendemos|oferecemos|parceria)\b|ofereço|proposta comercial/i.test(m.body)))throw Error('Commercial contact requires review');
    const normalize=s=>String(s).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
    for(const field of ['name','city','service']){
      const source=history.find(m=>m.id===intake[field+'MessageId']&&m.direction==='in');
      if(typeof intake[field]!=='string'||intake[field].trim().length<2||intake[field].length>120||!source||!normalize(source.body).includes(normalize(intake[field])))throw Error('Registration source unavailable');
      if(field==='name'){
        const index=history.indexOf(source),previous=history[index-1];
        const candidate=normalize(intake.name),sourceText=normalize(source.body),nameAtStart=value=>value.startsWith(candidate)&&(!value[candidate.length]||/[\s.,;!?]/.test(value[candidate.length]));
        const declared=[...sourceText.matchAll(/\b(?:meu nome(?: e|:)?|me chamo|pode me chamar de|sou(?: o| a)?)\s+/g)].some(match=>nameAtStart(sourceText.slice(match.index+match[0].length)));
        const answered=previous?.direction==='out'&&/como (?:posso|podemos).{0,20}chamar|seu nome|nome do solicitante/i.test(previous.body)&&nameAtStart(sourceText);
        if(!declared&&!answered)throw Error('Requester name not provided');
      }
    }
    return intake;
  }
  async function execute(job){
    if(!valid(job)){run("UPDATE ai_jobs SET state='cancelled',updated=? WHERE id=?",Date.now(),job.id);return;}
    const conversation=get('SELECT * FROM conversations WHERE id=?',job.conversation_id);
    try{
      let ctx=context.view(conversation.id);
      let clientLookup={state:ctx.client_id?'linked':'unavailable'};
      if(!ctx.client_id&&context.status().enabled){
        try{clientLookup=await context.resolveBeforeReply(conversation,()=>valid(job));}
        catch(error){throw Object.assign(Error('Client lookup unavailable'),{aiReason:error.status===409?'O cadastro do telefone exige conferência antes da resposta automática.':'Não foi possível conferir o cadastro no Notion antes de responder. A equipe precisa verificar.'});}
        if(!valid(job))return;ctx=context.view(conversation.id);
      }
      if(ctx.client_id){try{await context.refresh(conversation);}catch{/* General attendance can continue without presenting stale operational status as current. */}ctx=context.view(conversation.id);}
      job.contextVersion=ctx.version;
      if(!valid(job)){run("UPDATE ai_jobs SET state='cancelled' WHERE id=?",job.id);return;}
      // Meta timestamps have second precision; replies have milliseconds. Use the
      // persisted arrival order (also used by last_received) to preserve turn order.
      const history=all("SELECT id,direction,body,agent_name FROM messages WHERE conversation_id=? AND (direction='in' OR status IN ('sent','delivered','read')) ORDER BY rowid DESC LIMIT 24",conversation.id).reverse();
      const transcripts=new Map();
      if(String(config.AI_AUDIO_ENABLED)==='true')for(const message of history){
        if(message.direction!=='in'||!get("SELECT 1 FROM message_media mm JOIN media m ON m.id=mm.media_id WHERE mm.message_id=? AND m.kind='audio'",message.id))continue;
        let text;try{text=await transcriber.read(message.id,()=>valid(job));}catch(e){if(message.id===job.message_id)throw e;continue;}if(!valid(job))return;transcripts.set(message.id,text);
        if(message.id===job.message_id&&/(?:quero|preciso).{0,30}(?:humano|humana|atendente)|(?:falar|conversar).{0,25}(?:pessoa|gustavo|atendente)/i.test(text)){handoff(conversation.id,job.id,'Contato solicitou atendimento humano por áudio.');return;}
      }
      const attachments=all('SELECT m.kind,m.name,m.state,mm.message_id FROM message_media mm JOIN media m ON m.id=mm.media_id JOIN messages x ON x.id=mm.message_id WHERE x.conversation_id=? ORDER BY x.rowid DESC LIMIT 5',conversation.id);
      // Only the allowlisted operational subset from the Notion adapter, never a raw page.
      const snapshot=ctx.snapshot&&!ctx.last_error?{attendance:ctx.snapshot.attendance,client:{name:ctx.snapshot.client?.name,stage:ctx.snapshot.client?.stage,registration:ctx.snapshot.client?.registration},sections:Object.fromEntries(Object.entries(ctx.snapshot.sections||{}).map(([k,v])=>[k,{configured:v.configured,complete:v.complete,error:!!v.error,rows:(v.rows||[]).slice(0,8).map(r=>({title:r.title,status:r.status,due:r.due,next:r.next,contract:r.contract}))}]))}:null;
      const input=JSON.stringify({currentDate:new Date().toISOString(),clientLookup,referenceGuide:knowledgeFor(history.slice(-8).map(m=>transcripts.get(m.id)||m.body).join(' ')),serviceGuides:serviceGuidesFor({latest:transcripts.get(job.message_id)||history.at(-1)?.body||'',recent:history.slice(-8).map(m=>transcripts.get(m.id)||m.body).join(' '),summary:ctx.summary}),importedHistory:importedHistory?.(conversation.id),registrationAvailable:String(config.AI_AUTO_REGISTER)==='true'&&context.status().enabled,attachments,context:{notionUnavailable:!!ctx.last_error,clientLinked:!!ctx.client_id,summary:ctx.summary,missing:ctx.missing,nextStep:ctx.next_step,notion:snapshot,history:ctx.history.slice(0,8).map(e=>({summary:e.summary,missing:e.missing,nextStep:e.next_step,source:e.source,qualification:e.qualification,at:e.created})),notionHistory:(!ctx.last_error&&ctx.snapshot?.history?.rows||[]).slice(0,8).map(e=>({summary:e.summary,missing:e.missing,nextStep:e.next,source:e.source,qualification:e.qualification,at:e.at}))},messages:history.map(m=>({id:m.id,from:m.direction==='in'?'contato':m.agent_name||'equipe',text:(transcripts.get(m.id)||m.body).slice(0,transcripts.has(m.id)?8000:2000),...(transcripts.has(m.id)?{source:'transcricao_automatica',original:'audio'}:{})}))});
      if(Buffer.byteLength(input)>36000)throw Error('Context too large');
      const body={model:MODEL,store:false,instructions,input:[{role:'user',content:input}],reasoning:{effort:'none'},max_output_tokens:MAX_OUTPUT,text:{format:{type:'json_schema',name:'domum_attendance',strict:true,schema}}};
      // Reserve by UTF-8 bytes (a conservative upper bound for input tokens), including schema/overhead.
      const reserve=(Buffer.byteLength(JSON.stringify(body))+2000)*INPUT_USD+MAX_OUTPUT*OUTPUT_USD;
      if(spent()+reserve>budget||(totalBudget>0&&totalSpent()+reserve>totalBudget))throw Object.assign(Error('Budget unavailable'),{aiReason:'O limite local de consumo do piloto foi atingido. A equipe precisa assumir.'});
      run("UPDATE ai_jobs SET state='running',cost_usd=?,billing_month=?,updated=? WHERE id=?",reserve,month(),Date.now(),job.id);
      const response=await transport('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:'Bearer '+String(config.OPENAI_API_KEY).trim(),'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(45000)});
      if(!response.ok){
        let code,type;try{const error=(await response.json()).error;code=error?.code;type=error?.type;}catch{}
        const aiReason=['credit_balance_exhausted','insufficient_quota'].includes(code)||type==='insufficient_quota'?'A OpenAI informou saldo de API esgotado ou limite de cobrança atingido. Confira o faturamento da API.':code==='rate_limit_exceeded'?'A OpenAI limitou as requisições. A equipe precisa conferir antes de retomar.':null;
        throw Object.assign(Error('API rejected'),{aiReason});
      }
      const data=await response.json();
      // Actual usage may include reasoning. Unknown outcomes retain the full reservation.
      if(Number.isSafeInteger(data.usage?.input_tokens)&&Number.isSafeInteger(data.usage?.output_tokens)&&data.usage.input_tokens>=0&&data.usage.output_tokens>=0)run('UPDATE ai_jobs SET cost_usd=? WHERE id=?',data.usage.input_tokens*INPUT_USD+data.usage.output_tokens*OUTPUT_USD,job.id);
      if(data.status!=='completed')throw Error('Incomplete output');
      const result=validated(JSON.parse((data.output||[]).filter(o=>o.type==='message').flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('')));
      supplierEvidence(result,history);
      run('UPDATE ai_jobs SET result=? WHERE id=?',JSON.stringify(result),job.id);
      if(!valid(job)){run("UPDATE ai_jobs SET state='cancelled',updated=? WHERE id=?",Date.now(),job.id);return;}
      if(!ctx.client_id&&String(config.AI_AUTO_REGISTER)==='true'){
        const intake=registrationEvidence(result,history);
        if(intake){ctx=await context.registerFromAI(conversation,intake,()=>valid(job));job.contextVersion=ctx.version;run('UPDATE ai_jobs SET result=? WHERE id=?',JSON.stringify({...result,registration:{clientName:ctx.client_name,linked:true}}),job.id);}
      }
      if(!valid(job)){run("UPDATE ai_jobs SET state='cancelled',updated=? WHERE id=?",Date.now(),job.id);return;}
      if(result.kind==='comercial')suppliers?.record(conversation,result);
      if(result.reply.trim()){
        const id=randomUUID(),at=Date.now();
        run("INSERT INTO messages(id,conversation_id,request_id,direction,body,agent_name,status,created) VALUES(?,?,?,'out',?,'Domum · IA','sending',?)",id,conversation.id,'ai:'+job.id,result.reply.trim(),at);
        // No await between the final eligibility check and dispatch to WhatsApp.
        if(!valid(job)){run("UPDATE messages SET status='failed' WHERE id=?",id);run("UPDATE ai_jobs SET state='cancelled' WHERE id=?",job.id);return;}
        let sent;
        try{const res=await transport(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{authorization:'Bearer '+config.WHATSAPP_ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:conversation.phone,type:'text',text:{body:result.reply.trim()}}),redirect:'error',signal:AbortSignal.timeout(15000)});const payload=await res.json();if(!res.ok||typeof payload.messages?.[0]?.id!=='string'){run("UPDATE messages SET status='failed' WHERE id=?",id);throw Error('Send rejected');}sent=payload.messages[0].id;}
        catch{run("UPDATE messages SET status='unknown' WHERE id=? AND status='sending'",id);throw Error('Send not confirmed');}
        const echoed=get('SELECT id FROM messages WHERE provider_id=?',sent);if(echoed&&echoed.id!==id)run('DELETE FROM messages WHERE id=?',echoed.id);
        run("UPDATE messages SET status=CASE WHEN status IN ('delivered','read') THEN status ELSE 'sent' END,provider_id=? WHERE id=?",sent,id);
        run('UPDATE conversations SET pending_since=CASE WHEN last_received IS ? THEN NULL ELSE pending_since END,updated=MAX(updated,?) WHERE id=?',conversation.last_received,at,conversation.id);
      }
      run("UPDATE ai_jobs SET state='done',updated=? WHERE id=?",Date.now(),job.id);
      context.aiRecord(conversation.id,job.id,result,result.handoff);
      if(result.kind==='comercial'&&result.supplier?.complete&&!result.handoff&&result.reply.trim()&&valid(job)){
        const closed=run("UPDATE conversations SET status='closed',pending_since=NULL WHERE id=? AND last_received=? AND status='open'",conversation.id,conversation.last_received);
        if(closed.changes)pause(conversation.id);
      }else if(result.handoff)pause(conversation.id,result.reason||'Atendimento pronto para a equipe.');
    }catch(error){
      if(!valid(job)){run("UPDATE ai_jobs SET state='cancelled',updated=? WHERE id=?",Date.now(),job.id);return;}
      const reason=error.aiReason||'A IA não concluiu esta etapa. A equipe precisa conferir; não haverá reenvio automático.';
      run("UPDATE ai_jobs SET state='error',error=?,updated=? WHERE id=?",reason,Date.now(),job.id);
      handoff(conversation.id,job.id,reason);
    }
  }
  let worker=null,stopped=false;
  for(const job of interrupted){run("UPDATE messages SET status='unknown' WHERE request_id=? AND status='sending'",'ai:'+job.id);handoff(job.conversation_id,job.id,'Execução interrompida; conferir o resultado antes de liberar a IA.');}
  function process(){if(worker)return worker;if(stopped||!enabled())return Promise.resolve();worker=(async()=>{for(const job of all("SELECT * FROM ai_jobs WHERE state='pending' AND created<=? ORDER BY created LIMIT 5",Date.now()-debounceMs))await execute(job);})().finally(()=>{worker=null;});return worker;}
  return{status,incoming,pause,release,process,result:resultView,close:async()=>{stopped=true;await worker;}};
}

// A deterministic walkthrough, not a model call or an assessment of model quality.
export function simulateAttendance(message){
  if(typeof message!=='string'||!message.trim()||message.length>2000)fail(400,'Escreva uma mensagem de teste com até 2000 caracteres.');
  if(/(?:pessoa|humano|gustavo|atendente)|reclama|urgente/i.test(message))return{simulation:true,reply:'Vamos verificar sua solicitação.',handoff:true,reason:'Solicitação de atendimento humano ou prioridade.'};
  if(/fornece|vend[ao]|parceria|comercial/i.test(message))return{simulation:true,reply:'Obrigado pela oferta. No momento não precisamos, mas podemos conversar se surgir uma necessidade.',handoff:false,kind:'comercial'};
  return{simulation:true,reply:/maring|sarandi|paiçandu/i.test(message)?'Olá! Qual serviço você precisa para esse imóvel?':'Olá! Em qual município fica o imóvel?',handoff:false,kind:'atendimento'};
}
