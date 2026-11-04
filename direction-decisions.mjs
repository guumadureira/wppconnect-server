import {randomUUID} from 'node:crypto';

// Internal review queue only: never sends messages or performs external requests.
const categories=new Set(['tecnica','comercial','administrativa']);
const actions=new Set(['answer','cancel']);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const clean=(value,max,label)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    fail(400,'Informe '+label+' válido, com até '+max+' caracteres.');
  return value.trim();
};
const keyValue=value=>{
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(value))fail(400,'Identificador de ação inválido.');
  return value;
};
const goodId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);

export function createDirectionDecisions(db,config={}){
  const get=(sql,...v)=>db.prepare(sql).get(...v);
  const all=(sql,...v)=>db.prepare(sql).all(...v);
  const run=(sql,...v)=>db.prepare(sql).run(...v);
  db.exec(`CREATE TABLE IF NOT EXISTS direction_decisions(
    id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),
    source_key TEXT UNIQUE NOT NULL,origin TEXT NOT NULL CHECK(origin IN ('ia','admin')),
    category TEXT NOT NULL CHECK(category IN ('tecnica','comercial','administrativa')),
    question TEXT NOT NULL,basis TEXT NOT NULL,client_id TEXT,work_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','answered','cancelled')),
    requested_by TEXT,answered_by TEXT,answer TEXT,created INTEGER NOT NULL,
    updated INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS direction_decisions_status ON direction_decisions(status,created);
  CREATE TABLE IF NOT EXISTS direction_decision_audit(
    id TEXT PRIMARY KEY,decision_id TEXT NOT NULL REFERENCES direction_decisions(id),
    action_key TEXT UNIQUE NOT NULL,actor_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('answer','cancel')),
    created INTEGER NOT NULL
  );`);
  const approver=String(config.DIRECTION_APPROVER_EMAIL||'').trim().toLowerCase();
  const enabled=()=>String(config.DIRECTION_ESCALATION_ENABLED||'').trim()==='true'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approver);
  const requireApprover=user=>{
    if(!enabled())fail(503,'A fila de decisões internas ainda não foi habilitada para uma conta administrativa.');
    if(!user||user.role!=='admin'||String(user.email||'').toLowerCase()!==approver)
      fail(403,'Somente a conta administrativa autorizada pode consultar ou decidir.');
  };
  const transaction=fn=>{
    if(db.isTransaction)return fn();
    db.exec('BEGIN IMMEDIATE');
    try{const result=fn();db.exec('COMMIT');return result;}
    catch(e){db.exec('ROLLBACK');throw e;}
  };
  const view=row=>row?{id:row.id,conversationId:row.conversation_id,category:row.category,
    question:row.question,basis:row.basis,clientId:row.client_id,workId:row.work_id,
    status:row.status,origin:row.origin,created:row.created,updated:row.updated,
    version:row.version,answer:row.answer,answeredBy:row.answered_by}:null;
  const find=id=>{
    if(!goodId(id))fail(404,'Decisão não encontrada.');
    const row=get('SELECT * FROM direction_decisions WHERE id=?',id);
    if(!row)fail(404,'Decisão não encontrada.');
    return row;
  };
  const source=(conversation,origin,requestId,actor)=>{
    const request=keyValue(requestId);
    return conversation+':'+origin+':'+(origin==='admin'?actor.id+':':'')+request;
  };
  function insert({conversationId,requestId,category,question,basis,origin},actor){
    if(!goodId(conversationId)||!get('SELECT id FROM conversations WHERE id=?',conversationId))
      fail(404,'Conversa não encontrada.');
    if(!categories.has(category))fail(400,'Escolha decisão técnica, comercial ou administrativa.');
    const q=clean(question,500,'a pergunta objetiva');
    const explanation=clean(basis,1000,'a justificativa documentada');
    const sourceKey=source(conversationId,origin,requestId,actor);
    return transaction(()=>{
      const previous=get('SELECT * FROM direction_decisions WHERE source_key=?',sourceKey);
      if(previous){
        if(previous.question!==q||previous.basis!==explanation||previous.category!==category)
          fail(409,'Esse identificador foi usado para outra decisão.');
        return view(previous);
      }
      const context=get('SELECT client_id,work_id FROM conversation_context WHERE conversation_id=?',conversationId);
      const id=randomUUID(),at=Date.now();
      run(`INSERT INTO direction_decisions(id,conversation_id,source_key,origin,category,question,basis,
        client_id,work_id,requested_by,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,conversationId,sourceKey,origin,category,q,explanation,context?.client_id||null,
        context?.work_id||null,actor?.id||null,at,at);
      return view(find(id));
    });
  }
  function create(body,user){
    requireApprover(user);
    return insert({...body,origin:'admin'},user);
  }
  function fromAI(conversationId,jobId,decision){
    if(!enabled()||!decision?.required)return null;
    if(!categories.has(decision.category))return null;
    if(!goodId(jobId))fail(400,'Identificador de turno da IA inválido.');
    return insert({conversationId,requestId:jobId,category:decision.category,
      question:decision.question,basis:decision.basis,origin:'ia'},null);
  }
  function list(user,status='pending'){
    requireApprover(user);
    if(!['pending','answered','cancelled','all'].includes(status))
      fail(400,'Filtro de decisões inválido.');
    const rows=status==='all'
      ?all('SELECT * FROM direction_decisions ORDER BY created DESC LIMIT 100')
      :all('SELECT * FROM direction_decisions WHERE status=? ORDER BY created DESC LIMIT 100',status);
    return rows.map(view);
  }
  function detail(id,user){requireApprover(user);return view(find(id));}
  function act(id,body,user){
    requireApprover(user);
    const action=body?.action;
    if(!actions.has(action))fail(400,'Escolha responder ou cancelar.');
    if(body.confirmed!==true)fail(400,'A decisão exige confirmação explícita.');
    const requestId=keyValue(body.requestId);
    const answer=clean(body.answer,1500,action==='answer'?'a decisão confirmada':'o motivo do cancelamento');
    const actionKey=id+':'+user.id+':'+requestId;
    return transaction(()=>{
      const previous=get('SELECT * FROM direction_decision_audit WHERE action_key=?',actionKey);
      if(previous){
        if(previous.decision_id!==id||previous.action!==action)fail(409,'Identificador usado para outra ação.');
        const prior=find(id);
        if(prior.answer!==answer)fail(409,'A ação repetida contém uma resposta diferente.');
        return view(prior);
      }
      const row=find(id);
      if(row.status!=='pending'||!Number.isInteger(body.version)||row.version!==body.version)
        fail(409,'Esta decisão já foi alterada; atualize antes de agir.');
      const at=Date.now(),status=action==='answer'?'answered':'cancelled';
      run('UPDATE direction_decisions SET status=?,answer=?,answered_by=?,updated=?,version=version+1 WHERE id=?',
        status,answer,user.id,at,id);
      run('INSERT INTO direction_decision_audit(id,decision_id,action_key,actor_id,action,created) VALUES(?,?,?,?,?,?)',
        randomUUID(),id,actionKey,user.id,action,at);
      return view(find(id));
    });
  }
  return {enabled,create,fromAI,list,detail,act};
}
