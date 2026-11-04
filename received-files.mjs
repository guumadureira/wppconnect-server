// Read-only, authenticated MCP access to originals already stored in SQLite.
// No remote downloads, public URLs, model calls or changes to contact/history data.
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const uuid='[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';
const resourcePattern=new RegExp('^central://conversations/('+uuid+')/messages/('+uuid+')/attachments/('+uuid+')$');
const uriFor=row=>`central://conversations/${row.conversation_id}/messages/${row.message_id}/attachments/${row.id}`;

export function createReceivedFiles(db,media,{authorize}){
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args);
  function list(c,before){
    const cursor=before?get("SELECT rowid AS position FROM messages WHERE id=? AND conversation_id=? AND direction='in'",before,c.id):null;
    if(before&&!cursor)fail(400,'Página inválida para esta conversa.');
    const rows=all(`SELECT m.rowid AS position,m.id AS message_id,m.conversation_id,m.created,
      a.id,a.name,a.mime,a.kind,a.byte_size,a.state
      FROM messages m JOIN message_media mm ON mm.message_id=m.id JOIN media a ON a.id=mm.media_id
      WHERE m.conversation_id=? AND m.direction='in' AND m.rowid<? ORDER BY m.rowid DESC LIMIT 31`,c.id,cursor?.position??Number.MAX_SAFE_INTEGER);
    return{conversaId:c.id,telefone:c.phone,arquivos:rows.slice(0,30).map(row=>({
      arquivoId:row.id,mensagemId:row.message_id,nome:row.name,mime:row.mime,tipo:row.kind,
      tamanho:row.byte_size,estado:row.state,remetente:c.phone,recebidoEm:new Date(row.created).toISOString(),
      origem:'whatsapp_recebido',...(row.state==='ready'?{uri:uriFor(row)}:{})
    })),proximaPagina:rows.length>30?rows[29].message_id:null};
  }
  function read(params){
    if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).length!==1||typeof params.uri!=='string')fail(400,'Parâmetros inválidos.');
    const match=resourcePattern.exec(params.uri);if(!match)fail(400,'URI inválida.');
    const [,conversationId,messageId,mediaId]=match;
    authorize(conversationId);
    const row=get(`SELECT a.id,a.state,a.byte_size FROM messages m JOIN message_media mm ON mm.message_id=m.id
      JOIN media a ON a.id=mm.media_id WHERE m.id=? AND m.conversation_id=? AND m.direction='in' AND a.id=?`,messageId,conversationId,mediaId);
    if(!row||row.state!=='ready')fail(404,'Arquivo não disponível.');
    // Bound the binary response to the current maximum stored document size.
    if(row.byte_size>20_000_000)fail(413,'Arquivo acima do limite de leitura desta conexão.');
    const file=media.content(mediaId),bytes=Buffer.from(file.data);
    if(bytes.length>20_000_000||bytes.length!==row.byte_size)fail(409,'Arquivo inconsistente.');
    return{conversationId,contents:[{uri:params.uri,mimeType:file.mime,blob:bytes.toString('base64')}]};
  }
  return{list,read};
}
