import {randomUUID} from 'node:crypto';

export const qualityCategories=['Pergunta repetida','Tom inadequado','Promessa indevida','Cliente ou trabalho incorreto','Informação desatualizada','Transferência indevida','Outro'];
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const text=(value,max)=>typeof value==='string'&&value.trim().length<=max?value.trim():'';

// Local review ledger only. Reports never modify prompts or contact customers.
export function createAIQuality(db){
  db.exec(`CREATE TABLE IF NOT EXISTS ai_quality_reports(
    id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id),
    message_id TEXT NOT NULL REFERENCES messages(id),category TEXT NOT NULL,observation TEXT NOT NULL,
    proposed_correction TEXT NOT NULL,reporter TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_quality_reviews(
    id TEXT PRIMARY KEY,report_id TEXT UNIQUE NOT NULL REFERENCES ai_quality_reports(id),decision TEXT NOT NULL,
    correction TEXT NOT NULL,reviewer TEXT NOT NULL,created INTEGER NOT NULL);`);
  function list(conversationId){return db.prepare(`SELECT r.*,v.decision,v.correction,v.reviewer,v.created AS reviewed_at
    FROM ai_quality_reports r LEFT JOIN ai_quality_reviews v ON v.report_id=r.id WHERE r.conversation_id=?
    ORDER BY r.created DESC,r.rowid DESC LIMIT 50`).all(conversationId);}
  function report(conversationId,body,user){
    if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(body.requestId||''))fail(400,'Identificador da solicitação inválido.');
    const observation=text(body.observation,800),correction=text(body.correction,800);
    if(!qualityCategories.includes(body.category)||!observation||!correction)fail(400,'Informe categoria, falha observada e correção proposta (até 800 caracteres cada).');
    const message=db.prepare("SELECT id FROM messages WHERE id=? AND conversation_id=? AND direction='out' AND agent_name='Domum · IA'").get(body.messageId,conversationId);
    if(!message)fail(404,'Resposta da IA não encontrada nesta conversa.');
    const previous=db.prepare('SELECT * FROM ai_quality_reports WHERE request_id=?').get(body.requestId);
    if(previous){
      if(previous.conversation_id!==conversationId||previous.message_id!==body.messageId||previous.category!==body.category||previous.observation!==observation||previous.proposed_correction!==correction||previous.reporter!==(user.signatureName||user.name))fail(409,'Solicitação já usada para outro registro.');
      return list(conversationId);
    }
    db.prepare('INSERT INTO ai_quality_reports VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),body.requestId,conversationId,body.messageId,body.category,observation,correction,user.signatureName||user.name,Date.now());
    return list(conversationId);
  }
  function review(conversationId,id,body,user){
    if(user.role!=='admin')fail(403,'Somente administradores podem revisar correções.');
    const report=db.prepare('SELECT id FROM ai_quality_reports WHERE id=? AND conversation_id=?').get(id,conversationId);
    if(!report)fail(404,'Registro não encontrado nesta conversa.');
    const correction=text(body.correction,800);
    if(!['approved','rejected'].includes(body.decision)||!correction)fail(400,'Informe a decisão e a correção ou motivo (até 800 caracteres).');
    const previous=db.prepare('SELECT * FROM ai_quality_reviews WHERE report_id=?').get(id);
    if(previous){if(previous.decision!==body.decision||previous.correction!==correction)fail(409,'Registro já revisado. Crie outro registro para uma nova correção.');return list(conversationId);}
    db.prepare('INSERT INTO ai_quality_reviews VALUES(?,?,?,?,?,?)').run(randomUUID(),id,body.decision,correction,user.signatureName||user.name,Date.now());
    return list(conversationId);
  }
  return{list,report,review};
}
