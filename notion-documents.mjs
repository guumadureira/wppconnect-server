// Read only the selected page. Download links never come from MCP arguments.
import {createHash} from 'node:crypto';

const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const id=value=>String(value||'').replace(/-/g,'').toLowerCase();
const key=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const types={pdf:'application/pdf',txt:'text/plain',doc:'application/msword',xls:'application/vnd.ms-excel',ppt:'application/vnd.ms-powerpoint',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
const cleanName=value=>String(value||'documento').split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f<>:"|?*]/g,'_').slice(0,150);
function downloadURL(raw){
  let u;try{u=new URL(raw);}catch{fail(400,'O documento não possui um endereço de download válido no Notion.');}
  const storage=['prod-files-secure.s3.us-west-2.amazonaws.com','prod-files-secure-euc1.s3.eu-central-1.amazonaws.com','prod-files-secure-apne1.s3.ap-northeast-1.amazonaws.com','prod-files-secure-apne2.s3.ap-northeast-2.amazonaws.com'];
  const legacy=['s3.us-west-2.amazonaws.com','s3-us-west-2.amazonaws.com'].includes(u.hostname)&&u.pathname.startsWith('/secure.notion-static.com/');
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!(storage.includes(u.hostname)||legacy||u.hostname==='secure.notion-static.com'))fail(400,'Use um arquivo carregado no Notion. Links externos não são importados por esta conexão.');
  return u;
}

export function createNotionDocuments(config,transport){
  async function api(path){
    if(String(config.NOTION_ENABLED)!=='true'||!String(config.NOTION_TOKEN||'').trim())fail(409,'A leitura de documentos depende de NOTION_ENABLED e NOTION_TOKEN no Render e do acesso à página.');
    let r;try{r=await transport('https://api.notion.com/v1/'+path,{method:'GET',headers:{authorization:'Bearer '+String(config.NOTION_TOKEN).trim(),'Notion-Version':'2026-03-11'},redirect:'error',signal:AbortSignal.timeout(20000)});}catch{fail(409,'Não foi possível consultar os documentos no Notion. Tente novamente mais tarde.');}
    if(!r.ok)fail(409,'O Notion não permitiu consultar esta página. Confira o identificador e as Conexões da página para a integração usada no Render.');
    try{return await r.json();}catch{fail(409,'O Notion não retornou os documentos corretamente.');}
  }
  async function list(pageId){
    if(!/^[a-f\d]{32}$/.test(id(pageId)))fail(400,'Identificador de página inválido.');
    const page=await api('pages/'+pageId);
    if(id(page.id)!==id(pageId)||page.archived||page.in_trash)fail(409,'A página não está disponível para selecionar documentos.');
    const files=[];
    function add(file,source){
      let fallback='documento';try{fallback=decodeURIComponent(new URL(file.file?.url).pathname.split('/').at(-1))||fallback;}catch{}
      const name=cleanName(file.name||fallback),mime=types[name.split('.').at(-1).toLowerCase()];
      files.push({arquivoId:key(pageId,source),nome:name,formato:!!mime,carregadoNoNotion:file.type==='file',source,file,mime});
    }
    for(const [name,p]of Object.entries(page.properties||{}))if(p.type==='files')for(const [index,file]of(p.files||[]).entries())add(file,['property',p.id||name,index,file.name||'']);
    let cursor,partial=false;
    for(let count=0;count<3;count++){
      const data=await api('blocks/'+pageId+'/children?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));
      for(const block of data.results||[])if(['file','pdf'].includes(block.type)&&!block.archived&&!block.in_trash)add(block[block.type],['block',block.id]);
      partial=!!data.has_more;if(!partial)break;
      if(typeof data.next_cursor!=='string'||!data.next_cursor)fail(409,'Não foi possível continuar a lista de documentos.');
      cursor=data.next_cursor;
    }
    const title=Object.values(page.properties||{}).find(p=>p.type==='title');
    return{paginaId:pageId,titulo:(title?.title||[]).map(t=>t.plain_text??t.text?.content??'').join('').slice(0,200),parcial:partial,files};
  }
  const publicList=result=>({paginaId:result.paginaId,titulo:result.titulo,parcial:result.parcial,documentos:result.files.map(f=>({arquivoId:f.arquivoId,nome:f.nome,importavel:f.formato&&f.carregadoNoNotion})),observacao:'Somente arquivos anexados diretamente nesta página ou em propriedades Arquivos. Blocos dentro de colunas, listas recolhidas e subpáginas não são percorridos. Uma página de texto não é exportada automaticamente para PDF.'});
  async function load(pageId,fileId){
    const result=await list(pageId),selected=result.files.find(f=>f.arquivoId===fileId);
    if(!selected)fail(409,'Documento não encontrado nesta página. Liste novamente os documentos antes de preparar.');
    if(!selected.formato||!selected.carregadoNoNotion)fail(415,'Anexe o documento como arquivo no Notion. São aceitos PDF, TXT e documentos Office; links externos não são importados.');
    const u=downloadURL(selected.file.file.url);
    if(selected.file.file.expiry_time&&Date.parse(selected.file.file.expiry_time)<=Date.now())fail(409,'O acesso temporário ao documento expirou. Prepare novamente para obter um acesso atualizado.');
    let r;try{r=await transport(u.href,{method:'GET',redirect:'error',signal:AbortSignal.timeout(30000)});}catch{fail(409,'Não foi possível baixar o documento do Notion. Nenhuma mensagem foi enviada.');}
    if(!r.ok)fail(409,'O download do documento não foi autorizado pelo Notion. Prepare novamente mais tarde.');
    const limit=20_000_000;
    if(Number(r.headers.get('content-length'))>limit){await r.body?.cancel();fail(413,'O documento excede o limite de 20 MB.');}
    const actual=(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(actual&&actual!=='application/octet-stream'&&actual!==selected.mime){await r.body?.cancel();fail(415,'O formato baixado não corresponde ao nome do documento.');}
    const chunks=[];let size=0;
    try{for await(const part of r.body||[]){size+=part.length;if(size>limit)fail(413,'O documento excede o limite de 20 MB.');chunks.push(Buffer.from(part));}}catch(error){if(error.status===413)throw error;fail(409,'O download do documento foi interrompido. Nenhuma mensagem foi enviada.');}
    return{data:Buffer.concat(chunks),mime:selected.mime,name:selected.nome,origin:{paginaId:pageId,arquivoId:fileId,titulo:result.titulo}};
  }
  return{list:async pageId=>publicList(await list(pageId)),load};
}
