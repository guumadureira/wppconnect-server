// Read only the selected page. Download links never come from MCP arguments.
import {createHash} from 'node:crypto';
import {pageTextPDF} from './notion-page-pdf.mjs';

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
    if(r.status===429)fail(429,'O Notion limitou as consultas. Aguarde antes de tentar novamente; nada foi enviado.');
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
      files.push({arquivoId:key(id(pageId),source),nome:name,formato:!!mime,carregadoNoNotion:file.type==='file',source,file,mime});
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
  async function pageContent(pageId){
    if(!/^[a-f\d]{32}$/.test(id(pageId)))fail(400,'Identificador de página inválido.');
    const page=await api('pages/'+pageId);
    if(id(page.id)!==id(pageId)||page.archived||page.in_trash)fail(409,'A página não está disponível para exportação.');
    const titleProp=Object.values(page.properties||{}).find(p=>p.type==='title');
    const title=(titleProp?.title||[]).map(t=>t.plain_text??t.text?.content??'').join('').trim();
    if(!title||title.length>200)fail(415,'Use um título de até 200 caracteres para o documento.');
    const blocks=[],unsupported=new Set();let count=0,requests=0,total=title.length;
    function rich(parts){
      if(!Array.isArray(parts))fail(415,'Um trecho da página não pôde ser lido com segurança. Anexe o PDF original.');
      let text='';
      for(const part of parts){
        if(part.type&&part.type!=='text')fail(415,'A página contém menções ou fórmulas. Anexe o PDF original para preservar esse conteúdo.');
        text+=part.plain_text??part.text?.content??'';
      }
      total+=text.length;if(total>60000)fail(413,'O texto da página excede 60 mil caracteres. Anexe o documento original.');return text;
    }
    async function children(blockId,depth=0,parent=null){
      if(depth>6)fail(413,'A página tem muitos níveis de blocos. Anexe o PDF original.');
      const seen=new Set();let cursor,row=0;
      do{
        if(++requests>12)fail(413,'A página exige muitas consultas. Anexe o documento original.');
        const data=await api('blocks/'+blockId+'/children?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));
        if(!Array.isArray(data.results)||typeof data.has_more!=='boolean')fail(409,'O Notion não retornou uma lista completa de blocos. Nenhum PDF foi preparado.');
        for(const block of data.results||[]){
          if(++count>300)fail(413,'A página excede 300 blocos. Anexe o documento original.');
          if(block.archived||block.in_trash)continue;
          const type=block.type,value=block[type]||{};
          if(['paragraph','heading_1','heading_2','heading_3','bulleted_list_item','numbered_list_item','quote','callout','toggle'].includes(type)){
            const prefix=type==='bulleted_list_item'?'- ':type==='numbered_list_item'?(++row)+'. ':'';
            blocks.push({type,text:prefix+rich(value.rich_text||[]),indent:Math.min(depth,4)*12});
          }else if(type==='divider')blocks.push({type});
          else if(type==='table_row'){
            if(parent?.type!=='table')fail(415,'A tabela da página está incompleta. Anexe o PDF original.');
            if(!Array.isArray(value.cells)||value.cells.length!==parent.width)fail(415,'Não foi possível conferir todas as colunas da tabela.');
            blocks.push({type,cells:value.cells.map(rich),header:parent.header&&row++===0});
          }else if(!['table','column_list','column'].includes(type)){unsupported.add(type||'desconhecido');continue;}
          if(block.has_children){
            if(typeof block.id!=='string'||!/^[a-f\d]{32}$/.test(id(block.id)))fail(415,'Bloco da página sem identificador válido.');
            await children(block.id,depth+1,type==='table'?{type,width:value.table_width,header:!!value.has_column_header}:null);
          }
        }
        if(!data.has_more)break;
        if(typeof data.next_cursor!=='string'||!data.next_cursor||seen.has(data.next_cursor))fail(409,'Não foi possível completar a leitura da página.');
        cursor=data.next_cursor;seen.add(cursor);
      }while(true);
    }
    await children(pageId);
    if(unsupported.size)fail(415,'A página contém blocos não suportados no PDF de texto ('+[...unsupported].sort().join(', ')+'). Anexe um PDF pronto para preservar todo o conteúdo. Nenhum documento foi preparado.');
    if(!blocks.some(b=>b.text?.trim()||b.cells?.some(c=>c.trim())))fail(415,'A proposta ainda não tem conteúdo nesta página. Salve o texto do agente no corpo de uma página do Notion ou anexe o PDF pronto.');
    const content=JSON.stringify({title,blocks});
    if(/sk-proj-|Bearer\s|https?:\/\/(?:[^\s/]+\.)?(?:notion\.so|notion\.site|app\.notion\.com)\b/i.test(content))fail(415,'A página contém referência interna ou possível credencial. Revise uma cópia destinada ao cliente antes de exportar.');
    const refreshed=await api('pages/'+pageId);
    if(id(refreshed.id)!==id(pageId)||refreshed.archived||refreshed.in_trash||refreshed.last_edited_time!==page.last_edited_time)fail(409,'A página mudou durante a leitura. Confira o conteúdo novamente.');
    return{paginaId:pageId,titulo:title,blocks,resumoConteudo:key(content),editadoEm:page.last_edited_time||null,nome:cleanName(title).slice(0,140)+'.pdf'};
  }
  async function inspect(pageId){
    const p=await pageContent(pageId);
    return{paginaId:p.paginaId,titulo:p.titulo,nome:p.nome,resumoConteudo:p.resumoConteudo,editadoEm:p.editadoEm,conteudo:p.blocks,observacao:'PDF de texto do corpo desta página. Não inclui propriedades da base, comentários, subpáginas, fórmulas, imagens ou anexos. Revise o conteúdo completo e a conversa de destino antes de preparar. Não gera valores, escopo ou cláusulas novos.'};
  }
  async function exportPage(pageId,digest){
    if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))fail(400,'Use resumoConteudo retornado pela visualização da página.');
    const p=await pageContent(pageId);if(p.resumoConteudo!==digest)fail(409,'O conteúdo da página mudou. Confira a nova versão antes de preparar o PDF.');
    return{data:pageTextPDF({title:p.titulo,blocks:p.blocks}),mime:'application/pdf',name:p.nome,origin:{paginaId:pageId,titulo:p.titulo,tipo:'pagina_pdf',resumoConteudo:p.resumoConteudo,editadoEm:p.editadoEm}};
  }
  return{list:async pageId=>publicList(await list(pageId)),load,inspect,exportPage};
}
