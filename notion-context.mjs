import { randomUUID } from 'node:crypto';
import {samePhone} from './contact-phone.mjs';

const fail=(status,message,extra={})=>{throw Object.assign(new Error(message),{status,...extra});};
const norm=value=>String(value||'').replace(/\D/g,'');
const uuid=value=>{const raw=String(value||'').trim().replace(/-/g,'');if(!/^[a-f\d]{32}$/i.test(raw))fail(400,'Identificador de registro inválido.');return raw.toLowerCase().replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');};
const url=id=>'https://app.notion.com/p/'+uuid(id).replace(/-/g,'');
const text=(value,max=2000)=>{if(typeof value!=='string'||value.length>max||/\x00/.test(value))fail(400,'Texto inválido ou acima do limite permitido.');return value.trim();};
const plain=property=>(property?.title||property?.rich_text||[]).map(part=>part.plain_text??part.text?.content??'').join('').slice(0,2000);
const value=(page,key)=>{const p=page.properties?.[key];return p?.select?.name??p?.status?.name??p?.date?.start??plain(p);};
const rt=value=>({rich_text:[{text:{content:String(value||'').slice(0,2000)}}]});
const kinds=['atendimento','orcamento','andamento','documentos','alteracao','comercial','administrativo','outro'];
const states=['Em atendimento','Aguardando contato','Aguardando equipe','Resolvida'];
const qualifications=['Informado','Extraído','Interpretado','Confirmado','Corrigido'];
const eventTypes={comercial:'Oferta comercial recebida',contexto:'Contexto atualizado',solicitacao:'Solicitação registrada',situacao:'Situação da solicitação atualizada',cliente:'Cliente vinculado',humano:'Atendimento assumido',assistencia:'Assistência liberada',arquivo:'Arquivo recebido'};

export function createNotionContext(db,config,transport,options={}){
  const aiActor=Object.freeze({id:'domum-ai-registration',signatureName:'Domum · IA',role:'internal_ai'});
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_context(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),client_id TEXT,client_name TEXT,work_id TEXT,kind TEXT NOT NULL DEFAULT 'atendimento',summary TEXT NOT NULL DEFAULT '',missing TEXT NOT NULL DEFAULT '',next_step TEXT NOT NULL DEFAULT '',mode TEXT NOT NULL DEFAULT 'human',version INTEGER NOT NULL DEFAULT 0,snapshot TEXT,checked_at INTEGER,last_error TEXT,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS service_requests(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),client_id TEXT,work_id TEXT,title TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,summary TEXT NOT NULL,missing TEXT NOT NULL,next_step TEXT NOT NULL,owner_id TEXT,version INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS service_events(id TEXT PRIMARY KEY,event_key TEXT UNIQUE NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id),request_id TEXT,client_id TEXT,work_id TEXT,kind TEXT NOT NULL,summary TEXT NOT NULL,missing TEXT NOT NULL DEFAULT '',next_step TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'Em atendimento',qualification TEXT NOT NULL,actor TEXT NOT NULL,source TEXT NOT NULL,message_id TEXT,created INTEGER NOT NULL,sync_state TEXT NOT NULL,sync_error TEXT,notion_page_id TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS service_events_queue ON service_events(sync_state,next_attempt);
    CREATE TABLE IF NOT EXISTS notion_client_operations(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),operation_key TEXT UNIQUE NOT NULL,state TEXT NOT NULL,client_id TEXT,error TEXT,created INTEGER NOT NULL);`);
  db.exec("CREATE TABLE IF NOT EXISTS context_lookup_jobs(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),last_received INTEGER,state TEXT NOT NULL,next_attempt INTEGER NOT NULL DEFAULT 0,error TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS notion_client_summaries(client_id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,revision TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT,next_attempt INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL)");
  // A process restart during creation leaves an uncertain outcome. Reconcile before another write.
  run("UPDATE service_events SET sync_state='uncertain',sync_error='Resultado anterior não confirmado; aguardando conferência no Notion.' WHERE sync_state='sending'");
  run("UPDATE notion_client_operations SET state='uncertain' WHERE state='creating'");
  const sourceFields={clients:'NOTION_CLIENTS_DATA_SOURCE_ID',history:'NOTION_HISTORY_DATA_SOURCE_ID',works:'NOTION_WORKS_DATA_SOURCE_ID',proposals:'NOTION_PROPOSALS_DATA_SOURCE_ID',projects:'NOTION_PROJECTS_DATA_SOURCE_ID',tasks:'NOTION_TASKS_DATA_SOURCE_ID'};
  // Configuration errors are reported by the diagnostic, never thrown during startup.
  const present=name=>!!String(config[name]||'').trim();
  const sources=Object.fromEntries(Object.entries(sourceFields).map(([key,name])=>{try{return[key,present(name)?uuid(String(config[name]).trim().replace(/^collection:\/\//i,'')):null];}catch{return[key,null];}}));
  const invalidSources=()=>Object.entries(sourceFields).filter(([key,name])=>present(name)&&!sources[key]).map(([,name])=>name);
  const activated=()=>String(config.NOTION_ENABLED||'').trim().toLowerCase()==='true';
  const summaryEnabled=()=>String(config.NOTION_CLIENT_SUMMARY_ENABLED).trim()==='true';
  const summaryFields={'Resumo do atendimento — Central':'rich_text','Pendências — Central':'rich_text','Próximo passo — Central':'rich_text','Atualizado em — Central':'date','Conversa — Central':'url'};
  const required=['NOTION_TOKEN','NOTION_CLIENTS_DATA_SOURCE_ID','NOTION_HISTORY_DATA_SOURCE_ID'];
  const configured=()=>required.every(present);
  const enabled=()=>activated()&&configured()&&!!sources.clients&&!!sources.history;
  const ensureEnabled=()=>{const invalid=invalidSources().filter(name=>required.includes(name));if(invalid.length)fail(400,'Identificador de fonte inválido em '+invalid.join(', ')+'. Use somente o ID da fonte, sem nome da variável, sinal de igual ou URL da página.');if(!enabled())fail(503,'A integração própria da central com o Notion ainda precisa ser configurada. O histórico continua salvo na central.');};
  const context=id=>{run('INSERT OR IGNORE INTO conversation_context(conversation_id,updated) VALUES(?,?)',id,Date.now());return get('SELECT * FROM conversation_context WHERE conversation_id=?',id);};
  const transaction=fn=>{db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  const checkVersion=(id,version)=>{const row=context(id);if(!Number.isInteger(version)||row.version!==version)fail(409,'O contexto mudou em outra sessão. Atualize antes de salvar.');return row;};
  const key=(id,actor,requestId)=>{const request=text(requestId,100);if(!request)fail(400,'Identificador de ação obrigatório.');return id+':'+actor.id+':'+request;};
  function addEvent(id,data){
    const old=get('SELECT id FROM service_events WHERE event_key=?',data.key);if(old)return old.id;
    const c=context(id),eventId=randomUUID();
    const clientId=data.clientId===undefined?c.client_id:data.clientId,workId=data.workId===undefined?c.work_id:data.workId;
    run('INSERT INTO service_events(id,event_key,conversation_id,request_id,client_id,work_id,kind,summary,missing,next_step,status,qualification,actor,source,message_id,created,sync_state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',eventId,data.key,id,data.requestId||null,clientId,workId,data.kind,data.summary,data.missing??c.missing,data.nextStep??c.next_step,data.status||'Em atendimento',data.qualification||'Informado',data.actor||'Sistema',data.source||'Sistema',data.messageId||null,Date.now(),data.kind==='comercial'?'separate':clientId?'pending':'waiting_link');
    if(data.kind==='contexto'&&data.currentSummary)queueSummary(id);
    return eventId;
  }
  function queueSummary(id){
    const c=context(id);if(!summaryEnabled()||!c.client_id||c.kind==='comercial'||!c.summary)return;
    const at=Date.now(),properties={'Resumo do atendimento — Central':rt(c.summary),'Pendências — Central':rt(c.missing),'Próximo passo — Central':rt(c.next_step),'Atualizado em — Central':{date:{start:new Date(Math.floor(at/60000)*60000).toISOString()}}};
    const origin=config.PUBLIC_ORIGIN||config.RENDER_EXTERNAL_URL||'';
    if(/^https:\/\//.test(origin)){const link=new URL('/',origin);link.searchParams.set('conversation',id);properties['Conversa — Central']={url:link.href};}
    run("INSERT INTO notion_client_summaries(client_id,conversation_id,revision,payload,updated) VALUES(?,?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET conversation_id=excluded.conversation_id,revision=excluded.revision,payload=excluded.payload,state='pending',error=NULL,next_attempt=0,updated=excluded.updated",c.client_id,id,randomUUID(),JSON.stringify(properties),at);
  }
  async function processSummaries(){
    if(!summaryEnabled())return;
    for(const job of all("SELECT * FROM notion_client_summaries WHERE state IN ('pending','error') AND next_attempt<=? ORDER BY updated LIMIT 5",Date.now())){
      if(stopped)break;
      try{
        const current=context(job.conversation_id);
        if(current.client_id!==job.client_id||current.kind==='comercial'){run("UPDATE notion_client_summaries SET state='cancelled' WHERE client_id=? AND revision=?",job.client_id,job.revision);continue;}
        // Only dedicated Central fields are updated. Never replace cadastral,
        // contractual fields, page content or the append-only event history.
        const page=await api('pages/'+uuid(job.client_id));checkParent(page,sources.clients);
        if(get('SELECT revision FROM notion_client_summaries WHERE client_id=?',job.client_id)?.revision!==job.revision)continue;
        const latest=context(job.conversation_id);if(latest.client_id!==job.client_id||latest.kind==='comercial'){run("UPDATE notion_client_summaries SET state='cancelled' WHERE client_id=? AND revision=?",job.client_id,job.revision);continue;}
        const properties=JSON.parse(job.payload);
        for(const field of Object.keys(properties))if(page.properties?.[field]?.type!==summaryFields[field])fail(409,'Campo de resumo ausente ou incompatível em Clientes: '+field+'.');
        // A lost PATCH response is safely reconciled by reading its values next time.
        const equal=(p,q)=>q.date?Math.floor(Date.parse(p?.date?.start)/60000)===Math.floor(Date.parse(q.date.start)/60000):q.url!==undefined?p?.url===q.url:plain(p)===plain(q);
        if(!Object.entries(properties).every(([k,v])=>equal(page.properties[k],v))){
          const saved=await api('pages/'+uuid(job.client_id),'PATCH',{properties});checkParent(saved,sources.clients);
          const changed=Object.entries(properties).filter(([k,v])=>!equal(saved.properties?.[k],v)).map(([k])=>k);
          if(uuid(saved.id)!==job.client_id||changed.length)fail(502,'O Notion não confirmou os campos do resumo: '+(changed.join(', ')||'identificador do cliente')+'.');
        }
        run("UPDATE notion_client_summaries SET state='synced',error=NULL WHERE client_id=? AND revision=?",job.client_id,job.revision);
      }catch(e){run("UPDATE notion_client_summaries SET state='error',error=?,next_attempt=? WHERE client_id=? AND revision=?",e.message,Date.now()+Math.max(e.retryAfter||0,60000),job.client_id,job.revision);}
    }
  }
  function localView(id){
    const c=context(id),snapshot=c.snapshot?JSON.parse(c.snapshot):null;
    return {...c,snapshot,discovery:get('SELECT state,error FROM context_lookup_jobs WHERE conversation_id=?',id)||null,clientUrl:c.client_id?url(c.client_id):null,history:all('SELECT id,request_id,kind,summary,missing,next_step,status,qualification,actor,source,message_id,created,sync_state,sync_error,notion_page_id FROM service_events WHERE conversation_id=? ORDER BY created DESC,rowid DESC LIMIT 40',id).map(e=>({...e,notionUrl:e.notion_page_id?url(e.notion_page_id):null})),requests:all('SELECT * FROM service_requests WHERE conversation_id=? ORDER BY updated DESC LIMIT 100',id),integration:status()};
  }
  function status(){return {enabled:enabled(),configured:configured(),missing:required.filter(name=>!present(name)),invalid:invalidSources(),activationPending:!activated(),aiEnabled:!!options.aiEnabled?.(),summaryEnabled:summaryEnabled(),pendingSummaries:get("SELECT COUNT(*) AS n FROM notion_client_summaries WHERE state IN ('pending','error')").n,summaryErrors:all("SELECT error FROM notion_client_summaries WHERE state='error' ORDER BY updated DESC LIMIT 3").map(r=>r.error),optionalSources:Object.fromEntries(Object.entries(sources).filter(([k])=>!['clients','history'].includes(k)).map(([k,v])=>[k,!!v])),pendingEvents:get("SELECT COUNT(*) AS n FROM service_events WHERE sync_state IN ('pending','error')").n,uncertainEvents:get("SELECT COUNT(*) AS n FROM service_events WHERE sync_state='uncertain'").n};}
  let stopped=false,serial=Promise.resolve(),nextAt=0,retryUntil=0;const interval=options.requestIntervalMs??350;
  async function api(path,method='GET',body){
    ensureEnabled();
    if(Date.now()<retryUntil)fail(502,'O Notion pediu uma pausa. Aguarde a retomada da consulta.',{retryAfter:retryUntil-Date.now()});
    const slot=serial.then(async()=>{if(stopped)fail(503,'A central está reiniciando.');const delay=nextAt-Date.now();if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));nextAt=Date.now()+interval;});
    serial=slot.catch(()=>{});await slot;
    let response;
    try{response=await transport('https://api.notion.com/v1/'+path,{method,headers:{authorization:'Bearer '+String(config.NOTION_TOKEN).trim(),'Notion-Version':'2026-03-11','content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});}
    catch{fail(502,'Não foi possível confirmar a resposta do Notion.',{uncertain:method==='POST'&&path==='pages'});}
    if(!response.ok){
      const retry=Number(response.headers?.get('retry-after')),source=path.match(/^data_sources\/([a-f\d-]+)/i)?.[1],field=Object.entries(sources).find(([,id])=>id===source)?.[0];
      if(response.status===429)retryUntil=Date.now()+(Number.isFinite(retry)&&retry>0?retry*1000:60000);
      const message=response.status===429?'O Notion pediu uma pausa. A sincronização será retomada.':response.status===404&&field?'O Notion não encontrou a fonte definida em '+sourceFields[field]+'. Confira o ID de fonte e o acesso da conexão a essa base.':[401,403].includes(response.status)?'O Notion recusou o acesso ('+response.status+'). Confira a credencial e as permissões da conexão.':'O Notion não concluiu a operação. Confira o acesso da integração e a estrutura das bases.';
      fail(502,message,{uncertain:method==='POST'&&path==='pages'&&response.status>=500,retryAfter:Number.isFinite(retry)?Math.max(1,retry)*1000:60000});
    }
    try{const result=await response.json();if(method==='POST'&&path==='pages'&&!/^[a-f\d-]{32,36}$/i.test(result.id||''))throw new Error('Missing page ID');return result;}catch{fail(502,'Resposta inválida do Notion.',{uncertain:method==='POST'&&path==='pages'});}
  }
  async function query(source,filter,{maxPages=10,pageSize=100,sorts}={}){
    const id=uuid(source),rows=[];let cursor;
    for(let i=0;i<maxPages;i++){
      const r=await api('data_sources/'+id+'/query','POST',{filter,page_size:pageSize,...(sorts?{sorts}:{}),...(cursor?{start_cursor:cursor}:{})});
      if(!Array.isArray(r.results))fail(502,'A consulta do Notion não retornou registros válidos.');
      rows.push(...r.results.filter(p=>!p.archived&&!p.in_trash));if(!r.has_more)return{rows,complete:true};
      if(!r.next_cursor)fail(502,'A consulta do Notion ficou incompleta.');cursor=r.next_cursor;
    }
    return{rows,complete:false};
  }
  const checkParent=(page,source)=>{if(page.archived||page.in_trash||uuid(page.parent?.data_source_id||'')!==uuid(source))fail(409,'O registro não pertence à base esperada ou foi arquivado.');};
  const clientView=p=>({id:uuid(p.id),url:url(p.id),name:value(p,'Nome do Cliente'),phone:p.properties?.Telefone?.phone_number||'',stage:value(p,'Etapa do Atendimento'),registration:value(p,'Etapa do cadastro'),attendanceSummary:value(p,'Resumo do atendimento — Central'),attendanceMissing:value(p,'Pendências — Central'),attendanceNext:value(p,'Próximo passo — Central'),attendanceAt:value(p,'Atualizado em — Central')});
  async function client(id){const p=await api('pages/'+uuid(id));checkParent(p,sources.clients);return clientView(p);}
  async function lookup(conversation,search=''){
    ensureEnabled();const term=text(search,120),phone=norm(conversation.phone);
    const filter=term?{or:[{property:'Nome do Cliente',title:{contains:term}},{property:'Telefone',phone_number:{contains:term}}]}:{property:'Telefone',phone_number:{contains:phone.slice(-4)}};
    const found=await query(sources.clients,filter);
    const matches=found.rows.map(clientView).filter(c=>term||samePhone(c.phone,phone));
    return {matches:matches.slice(0,30).map(c=>({...c,phoneMatches:samePhone(c.phone,phone)})),complete:found.complete&&matches.length<=30};
  }
  async function link(conversation,body,actor){
    if(body.confirmed!==true)fail(400,'Confirme o cliente antes de vincular.');
    const eventKey=key(conversation.id,actor,body.requestId);
    if(get('SELECT id FROM service_events WHERE event_key=?',eventKey))return localView(conversation.id);
    checkVersion(conversation.id,body.version);const selected=await client(body.clientId);
    if(actor===aiActor&&(!body.guard?.()||!samePhone(selected.phone,conversation.phone)||selected.name.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim()!==String(body.name).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim()))fail(409,'O cadastro automático foi interrompido para conferência.');
    const reason=text(body.reason||'',500);
    if(!samePhone(selected.phone,conversation.phone)&&(!reason||actor.role!=='admin'))fail(409,'Telefone diferente: a associação exige conferência e justificativa de um administrador.');
    transaction(()=>{
      const c=checkVersion(conversation.id,body.version);
      if(c.client_id&&c.client_id!==selected.id&&(!reason||actor.role!=='admin'))fail(409,'A troca do cliente exige conferência e justificativa de um administrador.');
      run("UPDATE conversation_context SET client_id=?,client_name=?,work_id=NULL,snapshot=NULL,checked_at=NULL,last_error=NULL,summary=CASE WHEN client_id IS NOT NULL AND client_id<>? THEN '' ELSE summary END,missing=CASE WHEN client_id IS NOT NULL AND client_id<>? THEN '' ELSE missing END,next_step=CASE WHEN client_id IS NOT NULL AND client_id<>? THEN '' ELSE next_step END,version=version+1,updated=? WHERE conversation_id=?",selected.id,selected.name,selected.id,selected.id,selected.id,Date.now(),conversation.id);
      // Only previously unbound events are associated; older confirmed bindings are preserved.
      run("UPDATE service_events SET client_id=?,sync_state='pending' WHERE conversation_id=? AND client_id IS NULL AND sync_state='waiting_link'",selected.id,conversation.id);
      run("UPDATE service_requests SET client_id=? WHERE conversation_id=? AND client_id IS NULL AND kind<>'comercial'",selected.id,conversation.id);
      queueSummary(conversation.id);
      addEvent(conversation.id,{key:eventKey,kind:'cliente',summary:'Cliente vinculado: '+selected.name+(reason?' — '+reason:''),actor:actor.signatureName,source:actor===aiActor?'IA':'Atendente',qualification:actor===aiActor?'Informado':'Confirmado'});
    });return localView(conversation.id);
  }
  const refreshing=new Map();
  async function attendanceExcerpt(clientId){
    const accepted=new Set(['contexto básico de atendimento','contexto para atendimento','atendimento']);
    let cursor,selected=false,sectionLevel=0,excerpt='',limited=false;
    const seen=new Set();
    const rich=parts=>(parts||[]).map(p=>p.type==='mention'&&p.mention?.type==='date'?p.mention.date.start:p.plain_text??p.text?.content??'').join('');
    for(let page=0;page<3;page++){
      const response=await api('blocks/'+clientId+'/children?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));
      if(!Array.isArray(response.results))fail(502,'O resumo do cliente não pôde ser lido.');
      for(const b of response.results){
        if(b.archived||b.in_trash)continue;
        const type=b.type,heading=/^heading_([123])$/.exec(type||'');
        if(heading){const level=Number(heading[1]),title=rich(b[type]?.rich_text).trim().toLocaleLowerCase('pt-BR');if(accepted.has(title)){selected=true;sectionLevel=level;}else if(level<=sectionLevel)selected=false;continue;}
        if(!selected)continue;
        if(['paragraph','bulleted_list_item','numbered_list_item','quote','callout'].includes(type))excerpt+=rich(b[type]?.rich_text)+'\n';
        if(b.has_children)limited=true;
        if(excerpt.length>4000){excerpt=excerpt.slice(0,4000);limited=true;break;}
      }
      if(excerpt.length>=4000||!response.has_more)break;
      if(!response.next_cursor||seen.has(response.next_cursor))fail(502,'A leitura do resumo ficou incompleta.');
      cursor=response.next_cursor;seen.add(cursor);limited=page===2;
    }
    return{text:excerpt.trim(),limited,source:'Seções de atendimento no cadastro do cliente',qualification:'Contexto documental; não confirma andamento atual'};
  }
  const resolving=new Map();
  async function resolveBeforeReply(conversation,guard=()=>true){
    if(!enabled())return{state:'unavailable'};
    const initial=context(conversation.id);
    if(initial.client_id)return{state:'linked'};
    const found=await lookup(conversation);
    if(!guard()||context(conversation.id).version!==initial.version)fail(409,'O contexto mudou durante a busca do cadastro.');
    if(!found.complete||found.matches.length>1)fail(409,'Há mais de um cadastro possível ou a busca ficou incompleta. Confira o cliente antes de liberar a IA.');
    if(!found.matches.length)return{state:'not_found'};
    const selected=await client(found.matches[0].id);
    if(!guard()||!samePhone(selected.phone,conversation.phone))fail(409,'O telefone ou a conversa mudou durante a conferência do cadastro.');
    const latest=get("SELECT body FROM messages WHERE conversation_id=? AND direction='in' ORDER BY rowid DESC LIMIT 1",conversation.id)?.body||'';
    const declared=latest.match(/\b(?:meu nome [ée]|me chamo)\s+([^.!?\n,;]{1,120})/i)?.[1]?.trim();
    const normalized=s=>s.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').trim();
    if(declared&&normalized(declared).split(/\s+/)[0]!==normalized(selected.name).split(/\s+/)[0])fail(409,'O nome informado diverge do cadastro encontrado por telefone. Confira a identidade antes de usar o contexto.');
    transaction(()=>{
      const current=checkVersion(conversation.id,initial.version);
      if(current.client_id)fail(409,'O cliente já foi vinculado por outra ação.');
      run('UPDATE conversation_context SET client_id=?,client_name=?,snapshot=NULL,checked_at=NULL,last_error=NULL,version=version+1,updated=? WHERE conversation_id=?',selected.id,selected.name,Date.now(),conversation.id);
      run("UPDATE service_events SET client_id=?,sync_state='pending' WHERE conversation_id=? AND client_id IS NULL AND sync_state='waiting_link'",selected.id,conversation.id);
      run('UPDATE service_requests SET client_id=? WHERE conversation_id=? AND client_id IS NULL AND kind<>\'comercial\'',selected.id,conversation.id);
      queueSummary(conversation.id);
      addEvent(conversation.id,{key:'phone-lookup:'+conversation.id+':'+selected.id,kind:'cliente',summary:'Cadastro localizado pelo telefone do WhatsApp. A associação não confirma identidade pessoal, contratação ou situação de trabalho.',actor:'Sistema · busca de contexto',source:'Sistema',qualification:'Informado'});
    });
    return{state:'matched_by_phone',clientId:selected.id};
  }
  async function resolve(conversation,guard){
    const key=conversation.id+':'+conversation.last_received;
    if(resolving.has(key))return resolving.get(key);
    const op=resolveBeforeReply(conversation,guard);resolving.set(key,op);
    try{return await op;}finally{resolving.delete(key);}
  }
  function queueLookup(c){
    if(!enabled())return;
    run("INSERT INTO context_lookup_jobs(conversation_id,last_received,state) VALUES(?,?,'pending') ON CONFLICT(conversation_id) DO UPDATE SET last_received=excluded.last_received,state='pending'",c.id,c.last_received);
  }
  let lookupWorker=null;
  function processLookups(){
    if(lookupWorker||stopped||!enabled())return lookupWorker||Promise.resolve();
    lookupWorker=(async()=>{
      for(const job of all("SELECT * FROM context_lookup_jobs WHERE state IN ('pending','error') AND next_attempt<=? LIMIT 5",Date.now())){
        const c=get('SELECT * FROM conversations WHERE id=?',job.conversation_id);if(!c)continue;
        const guard=()=>!stopped&&get('SELECT last_received FROM conversations WHERE id=?',c.id)?.last_received===job.last_received;
        if(!guard()){run("UPDATE context_lookup_jobs SET state='cancelled' WHERE conversation_id=? AND last_received=?",c.id,job.last_received);continue;}
        try{
          const result=await resolve(c,guard);
          if(guard()&&context(c.id).client_id)await refresh(c);
          run('UPDATE context_lookup_jobs SET state=?,error=NULL,next_attempt=0 WHERE conversation_id=? AND last_received=?',result.state,c.id,job.last_received);
        }catch(e){run("UPDATE context_lookup_jobs SET state='error',error=?,next_attempt=? WHERE conversation_id=? AND last_received=?",e.status===409?'Cadastro exige conferência.':'Consulta do cadastro indisponível.',Date.now()+Math.max(e.retryAfter||0,60000),c.id,job.last_received);}
      }
    })().finally(()=>{lookupWorker=null;});return lookupWorker;
  }
  async function refresh(conversation){
    if(refreshing.has(conversation.id))return refreshing.get(conversation.id);
    const operation=(async()=>{
      const c=context(conversation.id);if(!c.client_id)fail(409,'Vincule o cadastro do cliente para consultar seu contexto.');
      try{
        const selected=await client(c.client_id),snapshot={client:selected,sections:{},at:Date.now()};
        try{snapshot.attendance=await attendanceExcerpt(c.client_id);}catch{snapshot.attendance={text:'',unavailable:true};}
        const descriptions={works:['Trabalho','Situação','Prazo'],proposals:['Proposta','Status',null],projects:['Projeto','Situação','Prazo contratual'],tasks:['Atividade','Status','Prazo']};
        for(const [name,[title,state,due]] of Object.entries(descriptions)){
          if(!sources[name]){snapshot.sections[name]={configured:false,rows:[]};continue;}
          try{
            const r=await query(sources[name],{property:'Cliente cadastrado',relation:{contains:c.client_id}},{maxPages:1,pageSize:30});
            snapshot.sections[name]={configured:true,complete:r.complete,rows:r.rows.map(p=>({id:uuid(p.id),url:url(p.id),title:value(p,title),status:value(p,state),due:due?value(p,due):null,...(name==='projects'?{next:value(p,'Próximo marco')}:{}),...(name==='proposals'?{contract:value(p,'Situação do contrato')}:{} )}))};
          }catch(e){snapshot.sections[name]={configured:true,error:e.message,rows:[]};}
        }
        const history=await query(sources.history,{property:'Cliente cadastrado',relation:{contains:c.client_id}},{maxPages:1,pageSize:30,sorts:[{property:'Data do acontecimento',direction:'descending'}]});
        snapshot.history={complete:history.complete,rows:history.rows.map(p=>({id:uuid(p.id),url:url(p.id),eventId:value(p,'ID do evento'),title:value(p,'Registro'),summary:value(p,'Resumo'),missing:value(p,'Pendências'),next:value(p,'Próximo passo'),source:value(p,'Origem'),qualification:value(p,'Qualificação'),at:value(p,'Data do acontecimento')}))};
        // Never save a result into a conversation that was rebound during the query.
        if(context(conversation.id).client_id!==c.client_id)fail(409,'O vínculo mudou durante a consulta. Atualize novamente.');
        run('UPDATE conversation_context SET client_name=?,snapshot=?,checked_at=?,last_error=NULL WHERE conversation_id=?',selected.name,JSON.stringify(snapshot),Date.now(),conversation.id);
      }catch(e){run('UPDATE conversation_context SET last_error=? WHERE conversation_id=?',e.message,conversation.id);throw e;}
      return localView(conversation.id);
    })();refreshing.set(conversation.id,operation);try{return await operation;}finally{refreshing.delete(conversation.id);}
  }
  async function save(conversation,body,actor){
    const eventKey=key(conversation.id,actor,body.requestId);if(get('SELECT id FROM service_events WHERE event_key=?',eventKey))return localView(conversation.id);
    const current=checkVersion(conversation.id,body.version),summary=text(body.summary??current.summary),missing=text(body.missing??current.missing,1000),next=text(body.nextStep??current.next_step,1000),kind=body.kind??current.kind;
    if(!kinds.includes(kind)||!qualifications.includes(body.qualification||'Informado'))fail(400,'Tipo de demanda ou qualificação inválidos.');
    const work=body.workId===undefined?current.work_id:body.workId?uuid(body.workId):null;
    if(work&&work!==current.work_id){
      if(!current.client_id||!sources.works)fail(409,'Vincule um cliente e configure a base de trabalhos antes de escolher a frente.');
      const p=await api('pages/'+work);checkParent(p,sources.works);
      const relation=p.properties?.['Cliente cadastrado'];
      if(relation?.has_more||!relation?.relation?.some(r=>uuid(r.id)===current.client_id))fail(409,'O trabalho não tem vínculo confirmado com este cliente.');
    }
    transaction(()=>{checkVersion(conversation.id,body.version);run('UPDATE conversation_context SET summary=?,missing=?,next_step=?,kind=?,work_id=?,version=version+1,updated=? WHERE conversation_id=?',summary,missing,next,kind,work,Date.now(),conversation.id);addEvent(conversation.id,{key:eventKey,kind:'contexto',summary,missing,nextStep:next,currentSummary:true,actor:actor.signatureName,source:'Atendente',qualification:body.qualification||'Informado'});});
    return localView(conversation.id);
  }
  function request(conversation,body,actor){
    const eventKey=key(conversation.id,actor,body.requestId);if(get('SELECT id FROM service_events WHERE event_key=?',eventKey))return localView(conversation.id);
    const title=text(body.title,160),summary=text(body.summary||'',1800),missing=text(body.missing||'',1000),next=text(body.nextStep||'',1000),kind=body.kind||'atendimento',status=body.status||'Em atendimento';
    if(!title||!kinds.includes(kind)||!states.includes(status))fail(400,'Informe título, tipo e situação válidos.');
    transaction(()=>{const c=context(conversation.id),id=randomUUID(),at=Date.now();run('INSERT INTO service_requests(id,conversation_id,client_id,work_id,title,kind,status,summary,missing,next_step,owner_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,conversation.id,c.client_id,c.work_id,title,kind,status,summary,missing,next,actor.id,at,at);addEvent(conversation.id,{key:eventKey,kind:'solicitacao',requestId:id,summary:title+(summary?' — '+summary:''),missing,nextStep:next,status,actor:actor.signatureName,source:'Atendente'});});return localView(conversation.id);
  }
  function updateRequest(conversation,id,body,actor){
    const eventKey=key(conversation.id,actor,body.requestId);if(get('SELECT id FROM service_events WHERE event_key=?',eventKey))return localView(conversation.id);
    const row=get('SELECT * FROM service_requests WHERE id=? AND conversation_id=?',id,conversation.id);if(!row)fail(404,'Solicitação não encontrada.');
    if(row.version!==body.version||!states.includes(body.status))fail(409,'Situação inválida ou solicitação alterada em outra sessão.');
    const missing=text(body.missing??row.missing,1000),next=text(body.nextStep??row.next_step,1000);
    transaction(()=>{run('UPDATE service_requests SET status=?,missing=?,next_step=?,version=version+1,updated=? WHERE id=?',body.status,missing,next,Date.now(),id);addEvent(conversation.id,{key:eventKey,kind:'situacao',requestId:id,clientId:row.client_id,workId:row.work_id,summary:row.title+' — '+body.status,missing,nextStep:next,status:body.status,actor:actor.signatureName,source:'Atendente',qualification:'Confirmado'});});return localView(conversation.id);
  }
  function control(conversation,body,actor){
    const eventKey=key(conversation.id,actor,body.requestId);if(get('SELECT id FROM service_events WHERE event_key=?',eventKey))return localView(conversation.id);
    if(!['human','assisted'].includes(body.mode))fail(400,'Modo de atendimento inválido.');
    transaction(()=>{checkVersion(conversation.id,body.version);run('UPDATE conversation_context SET mode=?,version=version+1,updated=? WHERE conversation_id=?',body.mode,Date.now(),conversation.id);if(body.mode==='human')run('UPDATE conversations SET owner_id=? WHERE id=?',actor.id,conversation.id);addEvent(conversation.id,{key:eventKey,kind:body.mode==='human'?'humano':'assistencia',summary:body.mode==='human'?'Atendimento assumido por '+actor.signatureName:'Assistência liberada; a execução depende da configuração e dos telefones autorizados no piloto de IA.',actor:actor.signatureName,source:'Atendente',qualification:'Confirmado'});});return localView(conversation.id);
  }
  function receivedFile(conversationId,messageId,kind){addEvent(conversationId,{key:'file:'+messageId,kind:'arquivo',summary:({image:'Imagem recebida',document:'Documento recebido',sticker:'Figurinha recebida',audio:'Áudio recebido'})[kind]||'Arquivo recebido',source:'Cliente',actor:'Contato do WhatsApp',messageId});}
  function aiRecord(id,jobId,result,handoff=false,{updateCurrent=false,expectedVersion,clientId}={}){
    const eventKey='ai:'+jobId;if(get('SELECT id FROM service_events WHERE event_key=?',eventKey))return;
    const record=()=>{
      const c=context(id);let requestId=null;
      const currentSummary=updateCurrent&&c.version===expectedVersion;
      if(currentSummary)run('UPDATE conversation_context SET summary=?,missing=?,next_step=?,kind=?,version=version+1,updated=? WHERE conversation_id=?',result.summary,result.missing,result.nextStep,result.kind,Date.now(),id);
      if(handoff){
        const existing=get("SELECT id FROM service_requests WHERE conversation_id=? AND owner_id IS NULL AND status='Aguardando equipe'",id);
        requestId=existing?.id||randomUUID();
        if(!existing)run('INSERT INTO service_requests(id,conversation_id,client_id,work_id,title,kind,status,summary,missing,next_step,owner_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',requestId,id,result.kind==='comercial'?null:c.client_id,result.kind==='comercial'?null:c.work_id,'Atendimento encaminhado pela IA',result.kind,'Aguardando equipe',result.summary,result.missing,result.nextStep,null,Date.now(),Date.now());
      }
      addEvent(id,{key:eventKey,kind:result.kind==='comercial'?'comercial':'contexto',currentSummary,requestId,...(clientId!==undefined?{clientId}:{}),...(result.kind==='comercial'?{clientId:null,workId:null}:{}),summary:result.summary,missing:result.missing,nextStep:result.nextStep,status:handoff?'Aguardando equipe':'Em atendimento',actor:'Domum · IA',source:'IA',qualification:'Interpretado'});
    };if(db.isTransaction)record();else transaction(record);
  }
  const creating=new Map();
  async function createClient(conversation,body,actor){
    ensureEnabled();if(actor.role!=='admin'&&actor!==aiActor)fail(403,'Somente administradores podem criar cadastros no Notion nesta etapa.');
    if(creating.has(conversation.id))fail(409,'Uma criação de cadastro já está em andamento.');
    const operation=(async()=>{
      const checkGuard=()=>{checkVersion(conversation.id,body.version);if(actor===aiActor&&!body.guard?.())fail(409,'Cadastro automático interrompido: o atendimento mudou.');};
      checkGuard();const name=text(body.name,120),city=text(body.city||'',120);if(!name||!/[A-Za-zÀ-ÿ]/.test(name))fail(400,'Informe o nome do solicitante, sem usar apenas o telefone.');
      const opKey=key(conversation.id,actor,body.requestId);
      let op=get('SELECT * FROM notion_client_operations WHERE operation_key=?',opKey)||get("SELECT * FROM notion_client_operations WHERE conversation_id=? AND state IN ('creating','uncertain') ORDER BY created LIMIT 1",conversation.id);
      if(op?.client_id)return link(conversation,{...body,clientId:op.client_id,confirmed:true},actor);
      if(op){const found=await query(sources.clients,{property:'ID de criação na central',rich_text:{equals:op.id}});if(found.rows.length===1&&found.complete){run("UPDATE notion_client_operations SET state='done',client_id=?,error=NULL WHERE id=?",uuid(found.rows[0].id),op.id);return link(conversation,{...body,clientId:found.rows[0].id,confirmed:true},actor);}if(op.state==='uncertain'||found.rows.length)fail(409,'Uma criação anterior ficou sem confirmação. Confira o Notion e vincule o cadastro existente; não foi criado outro.');}
      const existing=await lookup(conversation);if(!existing.complete||existing.matches.length>1)fail(409,'Há correspondências ambíguas. Busque e confirme o cliente antes de criar outro.');
      if(existing.matches.length===1){if(actor===aiActor&&existing.matches[0].name.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim()!==name.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim())fail(409,'O telefone possui cadastro com outro nome; exige conferência humana.');return link(conversation,{...body,clientId:existing.matches[0].id,confirmed:true},actor);}
      const sameName=await query(sources.clients,{property:'Nome do Cliente',title:{equals:name}});
      if(!sameName.complete||sameName.rows.length)fail(409,'Já há cadastro com esse nome. Busque e confira a associação antes de criar outro.');
      checkGuard();
      const id=op?.id||randomUUID();if(op)run("UPDATE notion_client_operations SET state='creating',error=NULL WHERE id=?",id);else run("INSERT INTO notion_client_operations(id,conversation_id,operation_key,state,created) VALUES(?,?,?,'creating',?)",id,conversation.id,opKey,Date.now());
      try{
        const created=await api('pages','POST',{parent:{type:'data_source_id',data_source_id:uuid(sources.clients)},properties:{'Nome do Cliente':{title:[{text:{content:name}}]},Telefone:{phone_number:conversation.phone},'Etapa do cadastro':{select:{name:'Inicial'}},'ID de criação na central':rt(id)},children:[{object:'block',type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:'Cadastro inicial criado a partir de atendimento na Central Domum.'+(city?' Município informado para o serviço: '+city+'.':'')}}]}}],notifications:{mode:'silent'}});
        const clientId=uuid(created.id);run("UPDATE notion_client_operations SET state='done',client_id=?,error=NULL WHERE id=?",clientId,id);
        return await link(conversation,{...body,clientId,confirmed:true},actor);
      }catch(e){const completed=get('SELECT client_id FROM notion_client_operations WHERE id=?',id);if(!completed?.client_id)run('UPDATE notion_client_operations SET state=?,error=? WHERE id=?',e.uncertain?'uncertain':'error',e.message,id);throw e;}
    })();creating.set(conversation.id,operation);try{return await operation;}finally{creating.delete(conversation.id);}
  }
  async function registerFromAI(conversation,intake,guard){
    if(String(config.AI_AUTO_REGISTER)!=='true'||!guard?.())fail(403,'Cadastro automático não está liberado para este atendimento.');
    const result=await createClient(conversation,{name:intake.name,city:intake.city,version:context(conversation.id).version,requestId:'initial-client',guard},aiActor);
    addEvent(conversation.id,{key:'ai-registration:'+conversation.id,kind:'cadastro inicial',summary:'Solicitante informou: '+intake.name+'. Município do serviço: '+intake.city+'. Necessidade: '+intake.service+'.',actor:aiActor.signatureName,source:'IA',qualification:'Informado',messageId:intake.nameMessageId});
    return result;
  }
  function eventChildren(e){
    if(!e.message_id)return [];
    const attachment=get('SELECT m.id,m.name,m.state FROM message_media mm JOIN media m ON m.id=mm.media_id WHERE mm.message_id=?',e.message_id);
    if(!attachment)return [];
    const origin=config.PUBLIC_ORIGIN||config.RENDER_EXTERNAL_URL||'';if(!/^https:\/\//.test(origin))return [];
    const privateLink=new URL('/api/media/'+attachment.id+'/content',origin);privateLink.searchParams.set('download','1');
    return [{object:'block',type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:'Arquivo recebido: '+attachment.name+'. Acesso restrito à equipe autenticada na central; disponibilidade depende da conclusão do download. Conteúdo ainda não validado. ' }},{type:'text',text:{content:'Abrir arquivo na central',link:{url:privateLink.href}}}]}}];
  }
  function eventProperties(e){
    const assignee=e.request_id?get('SELECT a.name FROM service_requests r LEFT JOIN agents a ON a.id=r.owner_id WHERE r.id=?',e.request_id):get('SELECT a.name FROM conversations c LEFT JOIN agents a ON a.id=c.owner_id WHERE c.id=?',e.conversation_id);
    const properties={Registro:{title:[{text:{content:(eventTypes[e.kind]||e.kind).slice(0,160)}}]},'ID do evento':rt(e.id),'ID da conversa':rt(e.conversation_id),'ID da demanda':rt(e.request_id||''),'Cliente cadastrado':{relation:[{id:uuid(e.client_id)}]},'Data do acontecimento':{date:{start:new Date(e.created).toISOString()}},Autor:rt(e.actor),Origem:{select:{name:e.source}},Qualificação:{select:{name:e.qualification}},Tipo:rt(e.kind),Resumo:rt(e.summary),Pendências:rt(e.missing),'Próximo passo':rt(e.next_step),'Situação da demanda':{select:{name:e.status}},Responsável:rt(assignee?.name||'')};
    if(e.work_id)properties['Trabalho integrado']={relation:[{id:uuid(e.work_id)}]};
    const origin=config.PUBLIC_ORIGIN||(config.RENDER_EXTERNAL_URL||'');if(/^https:\/\//.test(origin)){const link=new URL(origin);link.pathname='/';link.search='';link.hash='';link.searchParams.set('conversation',e.conversation_id);properties['Referência da conversa']={url:link.href};}
    return properties;
  }
  let worker=null;
  function processQueue(force=false){
    if(worker||stopped||!enabled())return worker||Promise.resolve();
    worker=(async()=>{
      const events=all("SELECT * FROM service_events WHERE client_id IS NOT NULL AND sync_state IN ('pending','error','uncertain') AND next_attempt<=? ORDER BY created LIMIT 10",force?Number.MAX_SAFE_INTEGER:Date.now());
      for(const e of events){if(stopped)break;
        try{
          const found=await query(sources.history,{property:'ID do evento',rich_text:{equals:e.id}},{maxPages:1,pageSize:2});
          if(found.rows.length>1||!found.complete)fail(409,'Mais de um registro encontrado para o evento; exige conferência.');
          if(found.rows.length===1){run("UPDATE service_events SET notion_page_id=?,sync_state='synced',sync_error=NULL WHERE id=?",uuid(found.rows[0].id),e.id);continue;}
          if(e.sync_state==='uncertain'){run("UPDATE service_events SET sync_error='Criação anterior sem confirmação. Verifique o Notion antes de autorizar outra criação.',next_attempt=? WHERE id=?",Date.now()+300000,e.id);continue;}
          run("UPDATE service_events SET sync_state='sending' WHERE id=?",e.id);
          const children=eventChildren(e);
          const result=await api('pages','POST',{parent:{type:'data_source_id',data_source_id:uuid(sources.history)},properties:eventProperties(e),...(children.length?{children}:{}),notifications:{mode:'silent'}});
          run("UPDATE service_events SET notion_page_id=?,sync_state='synced',sync_error=NULL WHERE id=?",uuid(result.id),e.id);
        }catch(error){run('UPDATE service_events SET sync_state=?,sync_error=?,attempts=attempts+1,next_attempt=? WHERE id=?',error.uncertain||e.sync_state==='uncertain'?'uncertain':'error',error.message,Date.now()+Math.max(error.retryAfter||0,Math.min(3600000,60000*2**Math.min(e.attempts,5))),e.id);}
      }
      await processSummaries();
    })().finally(()=>{worker=null;});return worker;
  }
  async function verify(){
    ensureEnabled();const invalid=invalidSources();if(invalid.length)fail(400,'Confira os identificadores de fonte em '+invalid.join(', ')+'.');const clients=await api('data_sources/'+uuid(sources.clients)),history=await api('data_sources/'+uuid(sources.history));
    const expected={clients:{'Nome do Cliente':'title',Telefone:'phone_number','ID de criação na central':'rich_text'},history:{Registro:'title','ID do evento':'rich_text','Cliente cadastrado':'relation','Data do acontecimento':'date',Resumo:'rich_text',Qualificação:'select'}};
    if(summaryEnabled())Object.assign(expected.clients,summaryFields);
    const missing=[];for(const [name,schema]of Object.entries(expected))for(const [property,type]of Object.entries(schema))if(({clients,history})[name].properties?.[property]?.type!==type)missing.push(name+': '+property);
    if(missing.length)fail(409,'Confira as propriedades das bases: '+missing.join(', '));
    const sourceChecks=Object.entries(sources).map(([name,id])=>({name,field:sourceFields[name],sourceId:id,configured:!!id,accessible:['clients','history'].includes(name)}));
    for(const check of sourceChecks.filter(c=>c.configured&&!['clients','history'].includes(c.name))){
      try{await api('data_sources/'+check.sourceId);check.accessible=true;}
      catch(error){check.accessible=false;check.error=error.message;}
    }
    const pendingSources=sourceChecks.filter(c=>c.configured&&!c.accessible);
    return {...status(),accessVerified:true,allConfiguredSourcesVerified:pendingSources.length===0,sourceChecks,pendingSources,verifiedAt:Date.now()};
  }
  function integrationRecord(conversationId,draftId,messageId,state){
    const descriptions={sent:'Mensagem da conexão Notion aceita pela Meta; entrega ainda deve ser conferida.',failed:'Envio da conexão Notion não realizado ou recusado.',unknown:'Resultado do envio da conexão Notion não confirmado; conferir no WhatsApp antes de nova tentativa.'};
    if(!descriptions[state])return;
    addEvent(conversationId,{key:'mcp:'+draftId,kind:'contexto',summary:descriptions[state],missing:'',nextStep:state==='sent'?'Conferir entrega na central.':'Conferir resultado com a equipe.',actor:'Notion · integração',source:'Sistema',qualification:'Confirmado',messageId});
  }
  return{status,view:localView,lookup,link,refresh,resolveBeforeReply:resolve,queueLookup,processLookups,save,request,updateRequest,control,receivedFile,aiRecord,createClient,registerFromAI,processQueue,verify,integrationRecord,
    close:async()=>{stopped=true;await Promise.allSettled([worker,lookupWorker,...refreshing.values(),...resolving.values(),...creating.values(),serial].filter(Boolean));},
  };
}
