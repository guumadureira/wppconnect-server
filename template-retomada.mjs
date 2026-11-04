import {randomUUID} from 'node:crypto';

// A strictly opt-in, admin-operated template sender. No free-form text or automatic retry.
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const types=new Set(['MARKETING','UTILITY']);
const sources=new Set(['whatsapp','formulario','contrato','outro']);
const idOk=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const keyOk=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(value);
const text=(v,max)=>typeof v==='string'?v.trim().slice(0,max+1):'';
const elapsed=24*3600*1000;
const current=()=>Date.now();

export function createTemplateResumption(db,config={},transport=fetch,{ready=false}={}){
  const get=(sql,...params)=>db.prepare(sql).get(...params);
  const all=(sql,...params)=>db.prepare(sql).all(...params);
  const run=(sql,...params)=>db.prepare(sql).run(...params);
  db.exec(`CREATE TABLE IF NOT EXISTS template_consents(
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    category TEXT NOT NULL,granted INTEGER NOT NULL,
    evidence TEXT NOT NULL,source TEXT NOT NULL,updated INTEGER NOT NULL,
    actor_id TEXT NOT NULL,PRIMARY KEY(conversation_id,category)
  );
  CREATE TABLE IF NOT EXISTS template_consent_audit(
    id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),
    request_id TEXT UNIQUE NOT NULL,category TEXT NOT NULL,action TEXT NOT NULL,
    evidence TEXT NOT NULL,source TEXT NOT NULL,actor_id TEXT NOT NULL,created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS template_resumptions(
    id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    message_id TEXT UNIQUE REFERENCES messages(id),
    name TEXT NOT NULL,language TEXT NOT NULL,category TEXT NOT NULL,
    state TEXT NOT NULL,provider_id TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,
    actor_id TEXT NOT NULL,error TEXT
  );
  CREATE INDEX IF NOT EXISTS template_resumption_by_conversation
    ON template_resumptions(conversation_id,created);`);
  const name=String(config.WHATSAPP_REENGAGEMENT_TEMPLATE_NAME||'').trim();
  const language=String(config.WHATSAPP_REENGAGEMENT_TEMPLATE_LANGUAGE||'pt_BR').trim();
  const waba=String(config.WHATSAPP_BUSINESS_ACCOUNT_ID||'').trim();
  const configured=()=>/^[a-z0-9_]{1,512}$/.test(name)&&/^[a-z]{2,3}_[A-Z]{2}$/.test(language)
    &&/^[0-9]{5,25}$/.test(waba);
  const enabled=()=>String(config.WHATSAPP_REENGAGEMENT_ENABLED||'').trim()==='true'
    && configured() && ready && String(config.WHATSAPP_MODE)==='live';
  const requireAdmin=user=>{if(!user||user.role!=='admin')fail(403,'Somente administradores podem autorizar uma retomada.');};
  const conversation=id=>{
    if(!idOk(id))fail(404,'Conversa não encontrada.');
    const row=get('SELECT * FROM conversations WHERE id=?',id);
    if(!row)fail(404,'Conversa não encontrada.');
    return row;
  };
  const ensureRequest=value=>{if(!keyOk(value))fail(400,'Identificador de ação inválido.');return value;};
  function status(){
    return {enabled:enabled(),configured:configured(),activationPending:!enabled(),
      requiresMetaApproval:true,name:configured()?name:null,language:configured()?language:null,
      consentCategories:[...types]};
  }
  function consents(id,user){
    requireAdmin(user);conversation(id);
    return all('SELECT category,granted,source,evidence,updated FROM template_consents WHERE conversation_id=? ORDER BY category',id)
      .map(x=>({...x,granted:!!x.granted}));
  }
  function consent(id,body,user){
    requireAdmin(user);conversation(id);
    const category=body?.category,action=body?.action,source=body?.source,
      evidence=text(body?.evidence,240),requestId=ensureRequest(body?.requestId);
    if(!types.has(category)||!['grant','revoke'].includes(action)||!sources.has(source)
      ||!evidence||evidence.length>240)fail(400,'Informe categoria, fonte e evidência de consentimento válida.');
    const existing=get('SELECT * FROM template_consent_audit WHERE request_id=?',requestId);
    if(existing){
      if(existing.conversation_id!==id||existing.actor_id!==user.id||existing.category!==category
        ||existing.action!==action||existing.evidence!==evidence||existing.source!==source)
        fail(409,'Identificador de ação já utilizado com outros dados.');
      return consents(id,user);
    }
    const at=current();
    db.exec('BEGIN IMMEDIATE');
    try{
      run('INSERT INTO template_consent_audit(id,conversation_id,request_id,category,action,evidence,source,actor_id,created) VALUES(?,?,?,?,?,?,?,?,?)',
        randomUUID(),id,requestId,category,action,evidence,source,user.id,at);
      run(`INSERT INTO template_consents(conversation_id,category,granted,evidence,source,updated,actor_id)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(conversation_id,category) DO UPDATE SET granted=excluded.granted,
        evidence=excluded.evidence,source=excluded.source,updated=excluded.updated,actor_id=excluded.actor_id`,
        id,category,action==='grant'?1:0,evidence,source,at,user.id);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return consents(id,user);
  }
  async function approvedTemplate(){
    if(!enabled())fail(503,'Configure e autorize o modelo de retomada antes de enviar.');
    const target='https://graph.facebook.com/'+config.META_GRAPH_VERSION+'/'+waba
      +'/message_templates?name='+encodeURIComponent(name)+'&fields=name%2Cstatus%2Clanguage%2Ccategory%2Ccomponents&limit=50';
    let res,json;
    try{
      res=await transport(target,{method:'GET',headers:{authorization:'Bearer '+String(config.WHATSAPP_ACCESS_TOKEN||'')},
        redirect:'error',signal:AbortSignal.timeout(15000)});
      json=await res.json();
    }catch{fail(502,'Não foi possível conferir a aprovação do modelo na Meta.');}
    if(!res.ok||!Array.isArray(json.data))fail(502,'A Meta não confirmou a aprovação do modelo.');
    const found=json.data.filter(x=>x.name===name&&x.language===language&&x.status==='APPROVED'
      &&types.has(x.category));
    if(found.length!==1)fail(409,'Não existe um único modelo aprovado com esse nome e idioma.');
    const template=found[0];
    if(!Array.isArray(template.components)||!template.components.length
      ||template.components.some(c=>/\{\{\s*\d+\s*\}\}/.test(JSON.stringify(c))
        ||(c.type==='HEADER'&&c.format&&c.format!=='TEXT')))
      fail(409,'Este modelo contém variáveis ou mídia e precisa de uma implementação específica.');
    return {name,language,category:template.category};
  }
  function dispatchView(row){
    return {id:row.id,conversationId:row.conversation_id,state:row.state,
      name:row.name,language:row.language,category:row.category,
      created:row.created,updated:row.updated,providerId:row.provider_id,
      error:row.error||null};
  }
  function list(id,user){
    requireAdmin(user);conversation(id);
    return all('SELECT * FROM template_resumptions WHERE conversation_id=? ORDER BY created DESC LIMIT 30',id).map(dispatchView);
  }
  async function send(id,body,user){
    requireAdmin(user);const c=conversation(id);
    const requestId=ensureRequest(body?.requestId);
    if(body?.confirmed!==true||body?.approvedTemplateConfirmed!==true)
      fail(400,'Confirme o envio e a aprovação do modelo no WhatsApp Manager.');
    if(body?.text!==undefined||body?.components!==undefined||body?.templateName!==undefined)
      fail(400,'Não é permitido enviar texto livre ou alterar o modelo.');
    const previous=get('SELECT * FROM template_resumptions WHERE request_id=?',requestId);
    if(previous){
      if(previous.conversation_id!==id||previous.actor_id!==user.id)fail(409,'Identificador de envio já utilizado.');
      return dispatchView(previous);
    }
    if(c.last_inbound&&current()-c.last_inbound<elapsed)
      fail(409,'A janela de atendimento está aberta; use a resposta normal sem custos adicionais do modelo.');
    if(!/^[1-9]\d{7,14}$/.test(c.phone))fail(409,'Número do WhatsApp inválido.');
    const meta=await approvedTemplate();
    const registered=get('SELECT granted FROM template_consents WHERE conversation_id=? AND category=?',id,meta.category);
    if(registered?.granted!==1)fail(403,'Não há consentimento comprovado para a categoria do modelo aprovado.');
    const recent=get(`SELECT id FROM template_resumptions WHERE conversation_id=?
      AND state IN ('sending','sent','unknown') AND created>? LIMIT 1`,id,current()-elapsed);
    if(recent)fail(409,'Já existe uma retomada recente; confira antes de novo envio.');
    // Reserve the idempotency key before the network call; never auto-retry an uncertain request.
    const at=current(),messageId=randomUUID(),dispatchId=randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try{
      const duplicate=get('SELECT * FROM template_resumptions WHERE request_id=?',requestId);
      if(duplicate){db.exec('ROLLBACK');return dispatchView(duplicate);}
      const freshConsent=get('SELECT granted FROM template_consents WHERE conversation_id=? AND category=?',id,meta.category);
      if(freshConsent?.granted!==1)fail(403,'Consentimento revogado antes do envio.');
      const freshRecent=get(`SELECT id FROM template_resumptions WHERE conversation_id=? AND
        state IN ('sending','sent','unknown') AND created>? LIMIT 1`,id,current()-elapsed);
      if(freshRecent)fail(409,'Outra retomada está sendo processada para este contato.');
      run("INSERT INTO messages(id,conversation_id,request_id,direction,body,agent_id,agent_name,status,created) VALUES(?,?,?,?,?,?,?,?,?)",
        messageId,id,requestId,'out','[Modelo de retomada: '+meta.name+']',user.id,user.signatureName||user.name,'sending',at);
      run(`INSERT INTO template_resumptions(id,request_id,conversation_id,message_id,name,language,category,state,
        created,updated,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        dispatchId,requestId,id,messageId,meta.name,meta.language,meta.category,'sending',at,at,user.id);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    const payload={messaging_product:'whatsapp',to:c.phone,type:'template',
      template:{name:meta.name,language:{code:meta.language}}};
    try{
      const res=await transport('https://graph.facebook.com/'+config.META_GRAPH_VERSION+'/'+config.WHATSAPP_PHONE_NUMBER_ID+'/messages',
        {method:'POST',headers:{authorization:'Bearer '+config.WHATSAPP_ACCESS_TOKEN,
          'content-type':'application/json'},body:JSON.stringify(payload),redirect:'error',
          signal:AbortSignal.timeout(15000)});
      const response=await res.json();
      if(!res.ok||!response?.messages?.[0]?.id){
        run("UPDATE messages SET status='failed' WHERE id=?",messageId);
        run("UPDATE template_resumptions SET state='failed',updated=?,error=? WHERE id=?",
          current(),'Meta recusou o modelo; conferir antes de outro envio.',dispatchId);
        fail(502,'A Meta recusou a retomada. Verifique o status e o motivo antes de tentar novamente.');
      }
      const providerId=response.messages[0].id;
      const duplicateMessage=get('SELECT id FROM messages WHERE provider_id=?',providerId);
      if(duplicateMessage&&duplicateMessage.id!==messageId)run('DELETE FROM messages WHERE id=?',duplicateMessage.id);
      run("UPDATE messages SET provider_id=?,status=CASE WHEN status IN ('delivered','read') THEN status ELSE 'sent' END WHERE id=?",
        providerId,messageId);
      run("UPDATE template_resumptions SET provider_id=?,state='sent',updated=?,error=NULL WHERE id=?",
        providerId,current(),dispatchId);
      return dispatchView(get('SELECT * FROM template_resumptions WHERE id=?',dispatchId));
    }catch(e){
      if(e.status)throw e;
      run("UPDATE messages SET status='unknown' WHERE id=? AND status='sending'",messageId);
      run("UPDATE template_resumptions SET state='unknown',updated=?,error=? WHERE id=?",
        current(),'Resultado incerto: conferir no WhatsApp Manager; não reenviar automaticamente.',dispatchId);
      fail(502,'Resultado do envio desconhecido. Confira na Meta antes de iniciar nova tentativa.');
    }
  }
  function reconcileProvider(providerId,status){
    if(!['sent','delivered','read','failed'].includes(status))return;
    const row=get('SELECT * FROM template_resumptions WHERE provider_id=?',providerId);
    if(!row)return;
    const rank={sending:0,unknown:0,sent:1,delivered:2,read:3,failed:4};
    if(status==='failed'||rank[status]>(rank[row.state]||0))
      run('UPDATE template_resumptions SET state=?,updated=? WHERE id=?',status,current(),row.id);
  }
  return {status,consents,consent,list,send,reconcileProvider};
}
