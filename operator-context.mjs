// Only operational, authenticated context: no raw Notion properties or private
// cadastral fields. Page text is data, not permission for an agent action.
export function createOperatorContext(db,context){
  return async id=>{
    const c=db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
    if(!c)throw Object.assign(Error('Conversa não encontrada.'),{status:404});
    let warning='';
    try{
      if(!context.view(id).client_id)await context.resolveBeforeReply(c);
      if(context.view(id).client_id)await context.refresh(c);
    }catch{warning='Não foi possível atualizar o cadastro no Notion. O contexto local não confirma o andamento atual.';}
    const v=context.view(id),snapshot=!warning&&!v.last_error?v.snapshot:null;
    const sections=Object.fromEntries(Object.entries(snapshot?.sections||{}).map(([key,s])=>[key,{available:s.configured&&!s.error,complete:s.complete===true,records:(s.rows||[]).slice(0,12).map(r=>({id:r.id,url:r.url,title:r.title,status:r.status,due:r.due,next:r.next,contract:r.contract}))}]));
    return {conversation:{id:c.id,phone:c.phone,name:c.name},client:v.client_id?{id:v.client_id,name:v.client_name,url:v.clientUrl}:null,
      summary:v.summary,missing:v.missing,nextStep:v.next_step,updated:v.updated,notionCheckedAt:v.checked_at,
      warning:warning||v.last_error||(!context.status().enabled?'Integração Notion indisponível.':''),
      attendance:snapshot?.attendance||null,notionSummary:snapshot?.client?{summary:snapshot.client.attendanceSummary,missing:snapshot.client.attendanceMissing,nextStep:snapshot.client.attendanceNext,at:snapshot.client.attendanceAt}:null,sections,
      history:v.history.slice(0,6).map(e=>({summary:e.summary,missing:e.missing,nextStep:e.next_step,source:e.source,qualification:e.qualification,at:e.created})),
      messages:db.prepare("SELECT direction,body,agent_name FROM messages WHERE conversation_id=? AND (direction='in' OR status IN ('sent','delivered','read')) ORDER BY rowid DESC LIMIT 8").all(id).reverse().map(m=>({from:m.direction==='in'?'Contato':m.agent_name||'Equipe',text:m.body.slice(0,1000)}))};
  };
}
