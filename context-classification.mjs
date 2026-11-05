import {randomUUID,createHash} from 'node:crypto';

const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const validId=x=>typeof x==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(x);
const purposes=['administrative','simulation','customer','undetermined'];
const clean=(x,max)=>typeof x==='string'&&x.trim()&&x.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x);

// Homologation opt-in: no table, classification or changed automation by default.
// Identity and purpose are administrative assertions, never inferred from content.
export function createContextClassification(db,config){
  const enabled=String(config.CONTEXT_CLASSIFICATION_ENABLED)==='true';
  const get=(sql,...a)=>db.prepare(sql).get(...a),run=(sql,...a)=>db.prepare(sql).run(...a);
  if(enabled)db.exec(`CREATE TABLE IF NOT EXISTS context_classifications(
    id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),
    version INTEGER NOT NULL,request_key TEXT UNIQUE NOT NULL,digest TEXT NOT NULL,
    payload TEXT NOT NULL,actor_id TEXT NOT NULL,created INTEGER NOT NULL,
    message_seq INTEGER NOT NULL,UNIQUE(conversation_id,version));`);
  const head=id=>enabled?get('SELECT * FROM context_classifications WHERE conversation_id=? ORDER BY version DESC LIMIT 1',id):null;
  function view(id){
    if(!enabled)return null;
    const row=head(id),profile=row?JSON.parse(row.payload):{identity:'unknown',topics:[],activeTopicId:null};
    const active=profile.topics.find(t=>t.id===profile.activeTopicId)||null;
    const latest=get('SELECT COALESCE(MAX(rowid),0) AS n FROM messages WHERE conversation_id=?',id).n;
    const pending=row?get('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=? AND rowid>?',id,row.message_seq).n:latest?get('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?',id).n:0;
    return{...profile,version:row?.version||0,purpose:active?.purpose||'undetermined',activeTopic:active,
      source:row?'admin_confirmed':'unclassified',confirmedBy:row?.actor_id||null,confirmedAt:row?.created||null,
      needsReview:!active||pending>0,messagesAfterReview:pending};
  }
  function customerAutomationAllowed(id){
    if(!enabled)return true;
    const p=view(id);return p.identity==='external'&&p.purpose==='customer';
  }
  function classify(id,body,actor){
    if(!enabled)fail(503,'Classificação de contexto disponível somente na homologação habilitada.');
    if(actor?.role!=='admin')fail(403,'Somente administrador pode confirmar identidade e finalidade.');
    if(!body||Object.keys(body).some(k=>!['version','requestId','identity','topics','activeTopicId'].includes(k))||!Number.isInteger(body.version)||!clean(body.requestId,100)||!['internal','external','unknown'].includes(body.identity)||!Array.isArray(body.topics)||body.topics.length>12)fail(400,'Classificação inválida.');
    const seen=new Set();
    for(const topic of body.topics){
      if(!topic||Object.keys(topic).some(k=>!['id','title','purpose','summary','messageIds'].includes(k))||!validId(topic.id)||seen.has(topic.id)||!clean(topic.title,120)||!clean(topic.summary,1200)||!purposes.includes(topic.purpose)||!Array.isArray(topic.messageIds)||!topic.messageIds.length||topic.messageIds.length>20||new Set(topic.messageIds).size!==topic.messageIds.length)fail(400,'Assunto inválido ou sem referência ao histórico.');
      seen.add(topic.id);
      for(const messageId of topic.messageIds)if(!validId(messageId)||!get('SELECT id FROM messages WHERE id=? AND conversation_id=?',messageId,id))fail(400,'Mensagem de referência não pertence a esta conversa.');
    }
    if(body.activeTopicId!==null&&!seen.has(body.activeTopicId))fail(400,'Selecione um assunto ativo registrado.');
    const payload=JSON.stringify({identity:body.identity,topics:body.topics,activeTopicId:body.activeTopicId});
    const digest=createHash('sha256').update(payload).digest('hex'),key=id+':'+actor.id+':'+body.requestId;
    const old=get('SELECT digest FROM context_classifications WHERE request_key=?',key);
    if(old){if(old.digest!==digest)fail(409,'Identificador de ação reutilizado com outro conteúdo.');return view(id);}
    const current=head(id);if((current?.version||0)!==body.version)fail(409,'A classificação mudou. Atualize antes de confirmar.');
    const seq=get('SELECT COALESCE(MAX(rowid),0) AS n FROM messages WHERE conversation_id=?',id).n;
    run('INSERT INTO context_classifications VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),id,body.version+1,key,digest,payload,actor.id,Date.now(),seq);
    return view(id);
  }
  function presentation(conversation,legacy){
    const profile=view(conversation.id);if(!profile)return null;
    const active=profile.activeTopic;
    return{identity:{kind:profile.identity,source:profile.source},topics:profile.topics,
      activeContext:active?{...active,needsReview:profile.needsReview}:null,
      review:{required:profile.needsReview,messagesAfterReview:profile.messagesAfterReview,version:profile.version,confirmedAt:profile.confirmedAt},
      storedSummary:{text:legacy.summary,missing:legacy.missing,nextStep:legacy.next_step,status:'legacy_not_revalidated',
        notice:'Resumo anterior preservado para auditoria; não confirma identidade, assunto ativo ou uma demanda real.'},
      operationalState:{conversation:conversation.status,mode:legacy.mode,ownerId:conversation.owner_id||null},
      customerAutomationAllowed:customerAutomationAllowed(conversation.id)};
  }
  return{enabled,view,classify,presentation,customerAutomationAllowed};
}
