import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import {isOggOpus} from './audio-format.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const limits = { image: 5_000_000, document: 20_000_000, sticker: 500_000, audio:16_000_000 };
const documents = new Set(['application/pdf','text/plain','application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
const filename = value => (String(value || 'arquivo').split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').slice(0,150) || 'arquivo');
const mimeType = value => {const mime=String(value || '').split(';')[0].trim().toLowerCase();return ({'audio/mp3':'audio/mpeg','audio/x-m4a':'audio/mp4','audio/x-aac':'audio/aac'})[mime]||mime;};
function mediaName(value,mime) {
  const extension=({'audio/ogg':'ogg','audio/mpeg':'mp3','audio/mp4':'m4a','audio/aac':'aac','audio/amr':'amr','image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf','text/plain':'txt','application/msword':'doc','application/vnd.ms-excel':'xls','application/vnd.ms-powerpoint':'ppt','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx','application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx'})[mime];
  const name=filename(value);
  return extension&&!name.toLowerCase().endsWith('.'+extension)?name+'.'+extension:name;
}
function validateType(kind, mime) {
  if (!limits[kind] || !(kind === 'audio'?['audio/ogg','audio/mpeg','audio/mp4','audio/aac','audio/amr'].includes(mime):kind === 'image' ? ['image/jpeg','image/png'].includes(mime) : kind === 'sticker' ? mime === 'image/webp' : documents.has(mime))) fail(415,'Formato não suportado. Use imagem, documento, figurinha WebP ou áudio OGG/Opus, MP3, M4A, AAC ou AMR.');
}
function validateBytes(kind, mime, data) {
  validateType(kind,mime);
  if (!data.length || data.length > limits[kind]) fail(413,'Arquivo vazio ou acima do limite permitido. Imagens: 5 MB; documentos: 20 MB; figurinhas: até 500 KB.');
  let valid = true;
  if(mime==='audio/ogg'&&!isOggOpus(data))fail(415,'O arquivo não contém uma mensagem de voz OGG/Opus reconhecível.');
  if(mime==='audio/mpeg')valid=data.subarray(0,3).toString()==='ID3'||(data[0]===255&&(data[1]&0xe0)===0xe0);
  if(mime==='audio/aac')valid=data[0]===255&&(data[1]&0xf6)===0xf0;
  if(mime==='audio/mp4')valid=data.length>12&&data.toString('ascii',4,8)==='ftyp';
  if(mime==='audio/amr')valid=data.subarray(0,6).toString()==='#!AMR\n'||data.subarray(0,9).toString()==='#!AMR-WB\n';
  if (mime === 'image/png') valid = data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/jpeg') valid = data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (mime === 'application/pdf') valid = data.subarray(0,5).toString() === '%PDF-';
  if (mime.includes('openxmlformats')) valid = data.subarray(0,4).equals(Buffer.from([80,75,3,4]));
  if (['application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint'].includes(mime)) valid = data.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225]));
  if (mime === 'text/plain') valid = !data.includes(0);
  if (kind === 'sticker') {
    valid = data.length >= 30 && data.toString('ascii',0,4) === 'RIFF' && data.toString('ascii',8,12) === 'WEBP' && data.readUInt32LE(4) + 8 === data.length;
    let width=0,height=0,animated=false;
    const encoding = data.toString('ascii',12,16);
    if (valid && encoding === 'VP8X') { width=1+data.readUIntLE(24,3);height=1+data.readUIntLE(27,3);animated=!!(data[20]&2); }
    else if (valid && encoding === 'VP8L' && data[20] === 47) { width=1+((data[21]|data[22]<<8)&0x3fff);height=1+((data[22]>>6|data[23]<<2|data[24]<<10)&0x3fff); }
    else if (valid && encoding === 'VP8 ' && data[23]===157 && data[24]===1 && data[25]===42) { width=data.readUInt16LE(26)&0x3fff;height=data.readUInt16LE(28)&0x3fff; }
    if (!valid || width !== 512 || height !== 512) fail(415,'A figurinha precisa ser WebP de 512 × 512 pixels.');
    if (!animated && data.length > 100_000) fail(413,'Figurinhas estáticas aceitam até 100 KB; animadas, até 500 KB.');
  }
  if (!valid) fail(415,'O conteúdo do arquivo não corresponde ao formato informado.');
}
async function boundedBody(response, limit) {
  if (Number(response.headers?.get('content-length')) > limit) { await response.body?.cancel();fail(413,'Arquivo acima do limite permitido.'); }
  const chunks=[];let size=0;
  for await (const chunk of response.body || []) { size+=chunk.length;if(size>limit)fail(413,'Arquivo acima do limite permitido.');chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}

export function createMediaStore(db,config,transport,live) {
  db.exec(`CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,kind TEXT NOT NULL,mime TEXT NOT NULL,name TEXT NOT NULL,byte_size INTEGER NOT NULL DEFAULT 0,provider_id TEXT,expected_hash TEXT,state TEXT NOT NULL,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,favorite INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,data BLOB);
    CREATE TABLE IF NOT EXISTS message_media(message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,media_id TEXT NOT NULL REFERENCES media(id));
    CREATE INDEX IF NOT EXISTS media_pending ON media(state,next_attempt);`);
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  const configuredMB=Number(config.MEDIA_STORAGE_MAX_MB||500);
  if(!Number.isInteger(configuredMB)||configuredMB<1||configuredMB>500)fail(500,'MEDIA_STORAGE_MAX_MB deve ser um inteiro entre 1 e 500.');
  const maxBytes=configuredMB*1_000_000;
  // Re-fetch voices rejected by the old packet timer. This only downloads from
  // Meta; it neither resumes an AI job nor calls a paid transcription API.
  run("UPDATE media SET state='pending',attempts=0,next_attempt=0,error=NULL WHERE kind='audio' AND state='blocked' AND error IN ('Use áudio OGG com codec Opus válido.','Use áudio OGG com codec Opus de até 5 minutos.')");
  const used=()=>get('SELECT COALESCE(SUM(length(data)),0) AS bytes FROM media').bytes;
  const view=row=>row?{id:row.id,kind:row.kind,mime:row.mime,name:row.name,size:row.byte_size,state:row.state,error:row.error,favorite:!!row.favorite,url:row.state==='ready'?'/api/media/'+row.id+'/content':null}:null;
  const columns='id,kind,mime,name,byte_size,provider_id,expected_hash,state,error,attempts,next_attempt,favorite,created';
  const find=id=>get('SELECT '+columns+' FROM media WHERE id=?',id);
  const checkCapacity=bytes=>{if(used()+bytes>maxBytes)fail(507,`O armazenamento de anexos atingiu ${configuredMB} MB. Nenhum arquivo foi apagado; peça à equipe para revisar o armazenamento.`);};
  function saveBytes(id,kind,mime,data) {
    validateBytes(kind,mime,data);checkCapacity(data.length);
    const row=find(id);
    run("UPDATE media SET data=?,mime=?,name=?,byte_size=?,state='ready',error=NULL WHERE id=?",data,mime,mediaName(row.name,mime),data.length,id);
  }
  function incoming(messageId,message) {
    const kind=message.type,part=message[kind];
    if(!limits[kind] || !part || !/^[A-Za-z0-9_-]{1,120}$/.test(String(part.id||'')))return;
    const existing=get('SELECT id FROM media WHERE provider_id=? AND kind=?',String(part.id),kind);
    if(existing){run('INSERT INTO message_media(message_id,media_id) VALUES(?,?)',messageId,existing.id);return;}
    const id=randomUUID();
    run("INSERT INTO media(id,kind,mime,name,provider_id,expected_hash,state,created) VALUES(?,?,?,?,?,?,'pending',?)",id,kind,mimeType(part.mime_type),filename(part.filename||({image:'imagem',sticker:'figurinha.webp',document:'documento'})[kind]),String(part.id),typeof part.sha256==='string'?part.sha256.slice(0,100):null,Date.now());
    run('INSERT INTO message_media(message_id,media_id) VALUES(?,?)',messageId,id);
  }
  function messages(rows) {
    const attachments=new Map(all('SELECT mm.message_id,m.'+columns.split(',').join(',m.')+' FROM message_media mm JOIN media m ON m.id=mm.media_id').map(row=>[row.message_id,view(row)]));
    const transcripts=new Map(get("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_transcriptions'")?all("SELECT message_id,text FROM ai_transcriptions WHERE state='done'").map(r=>[r.message_id,r.text]):[]);
    return rows.map(row=>({...row,...(attachments.has(row.id)?{attachment:attachments.get(row.id)}:{}),...(transcripts.has(row.id)?{transcription:transcripts.get(row.id)}:{})}));
  }
  async function upload(req,params) {
    const kind=params.get('kind'),mime=mimeType(req.headers['content-type']);validateType(kind,mime);
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>limits[kind])fail(413,'Arquivo acima do limite permitido.');chunks.push(chunk);}
    const data=Buffer.concat(chunks);validateBytes(kind,mime,data);checkCapacity(data.length);
    const id=randomUUID();run("INSERT INTO media(id,kind,mime,name,byte_size,state,created,data) VALUES(?,?,?,?,?,'ready',?,?)",id,kind,mime,mediaName(params.get('name'),mime),data.length,Date.now(),data);
    return view(find(id));
  }
  const inflight=new Map();let worker=null,stopped=false;
  async function ensure(id,force=false) {
    if(stopped)return;
    if(inflight.has(id))return inflight.get(id);
    const row=find(id);if(!row)fail(404,'Anexo não encontrado.');
    if(row.state==='ready')return view(row);
    if(!live || !row.provider_id)fail(409,'O anexo ainda não está disponível.');
    if(!force && (row.next_attempt>Date.now()||row.attempts>=5||row.state==='blocked'))return view(row);
    const job=(async()=>{
      try {
        const headers={authorization:`Bearer ${config.WHATSAPP_ACCESS_TOKEN}`};
        if(!config.WHATSAPP_ACCESS_TOKEN || !/^v\d+\.\d+$/.test(config.META_GRAPH_VERSION||''))fail(503,'A conexão de arquivos ainda não está configurada.');
        const response=await transport(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${encodeURIComponent(row.provider_id)}?phone_number_id=${encodeURIComponent(config.WHATSAPP_PHONE_NUMBER_ID)}`,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
        if(!response.ok)fail(502,'Não foi possível obter o anexo na Meta.');
        const meta=await response.json(),mime=mimeType(meta.mime_type||row.mime);validateType(row.kind,mime);
        if(Number(meta.file_size)>limits[row.kind])fail(413,'O arquivo recebido excede o limite da central. Consulte o WhatsApp Business.');
        const url=new URL(meta.url);
        // The bearer token is sent only to Meta's HTTPS media hosts, never a URL supplied by the browser.
        if(url.protocol!=='https:'||url.port||url.username||url.password||!(url.hostname==='lookaside.fbsbx.com'||url.hostname.endsWith('.fbsbx.com')||url.hostname.endsWith('.facebook.com')||url.hostname.endsWith('.fbcdn.net')))fail(502,'Endereço de mídia da Meta inválido.');
        const download=await transport(url.href,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});
        if(!download.ok)fail(502,'Não foi possível baixar o anexo na Meta.');
        const data=await boundedBody(download,limits[row.kind]);
        for(const expected of [row.expected_hash,meta.sha256].filter(Boolean)){
          const decoded=Buffer.from(expected,/^[a-f\d]{64}$/i.test(expected)?'hex':'base64');
          const digest=createHash('sha256').update(data).digest();
          if(decoded.length!==digest.length||!timingSafeEqual(decoded,digest))fail(422,'O arquivo recebido não passou na conferência de integridade.');
        }
        saveBytes(id,row.kind,mime,data);
      } catch(error) {
        const known=[413,415,422,507,503,502].includes(error.status);
        const message=known?error.message:'Não foi possível baixar o anexo. Tente novamente ou consulte o WhatsApp Business.';
        run('UPDATE media SET state=?,error=?,attempts=attempts+1,next_attempt=? WHERE id=?',[413,415,422,507].includes(error.status)?'blocked':'error',message,Date.now()+Math.min(900000,60000*2**Math.min(row.attempts,4)),id);
      }
      return view(find(id));
    })();
    inflight.set(id,job);try{return await job;}finally{inflight.delete(id);}
  }
  function processPending(){
    if(worker||stopped||!live)return worker||Promise.resolve();
    worker=(async()=>{for(const row of all("SELECT id FROM media WHERE state IN ('pending','error') AND next_attempt<=? AND attempts<5 ORDER BY created LIMIT 10",Date.now())){if(stopped)break;await ensure(row.id);}})().finally(()=>{worker=null;});
    return worker;
  }
  async function payload(id,caption) {
    const row=get('SELECT * FROM media WHERE id=?',id);if(!row||row.state!=='ready')fail(409,'O anexo não está disponível para envio.');
    validateBytes(row.kind,row.mime,Buffer.from(row.data));
    const form=new FormData();form.set('messaging_product','whatsapp');form.set('file',new Blob([row.data],{type:row.mime}),row.name);
    const response=await transport(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/media`,{method:'POST',headers:{authorization:`Bearer ${config.WHATSAPP_ACCESS_TOKEN}`},body:form,signal:AbortSignal.timeout(30000)});
    const result=await response.json();if(!response.ok||!result.id)fail(502,'O WhatsApp recusou o carregamento do anexo. A conversa continua pendente.');
    const part={id:String(result.id)};
    if(!['sticker','audio'].includes(row.kind))part.caption=caption;
    if(row.kind==='document')part.filename=row.name;
    return {type:row.kind,[row.kind]:part};
  }
  return {
    incoming,messages,upload,ensure,processPending,payload,find,
    public:id=>view(find(id)),
    stats:()=>({usedBytes:used(),maxBytes,limits}),
    link:(messageId,id)=>run('INSERT INTO message_media(message_id,media_id) VALUES(?,?)',messageId,id),
    favorites:()=>all('SELECT '+columns+" FROM media WHERE favorite=1 AND kind='sticker' ORDER BY created DESC").map(view),
    favorite:(id,value)=>{const row=find(id);if(!row||row.kind!=='sticker'||row.state!=='ready')fail(409,'A figurinha ainda não está disponível.');run('UPDATE media SET favorite=? WHERE id=?',value?1:0,id);return view(find(id));},
    content:id=>{const row=get('SELECT * FROM media WHERE id=?',id);if(!row)fail(404,'Anexo não encontrado.');if(row.state!=='ready'||!row.data)fail(409,'Anexo indisponível. Tente baixar novamente pela conversa.');return row;},
    close:async()=>{stopped=true;await Promise.allSettled([...inflight.values(),worker].filter(Boolean));},
  };
}
