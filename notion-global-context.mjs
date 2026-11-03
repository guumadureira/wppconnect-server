// Read-only, explicitly configured business-reference context from a single Notion page.
// Page content is untrusted reference data, never authorization or model instructions.
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.trim());
const rich=parts=>(Array.isArray(parts)?parts:[]).map(p=>p?.plain_text??p?.text?.content??'').join('').trim();
const sections=new Set(['serviços identificados nos documentos','identificação e encaminhamento']);

export function createNotionGlobalContext(config={},transport=fetch){
  const pageId=String(config.NOTION_GLOBAL_CONTEXT_PAGE_ID||'').trim();
  const seconds=Number(config.NOTION_GLOBAL_CONTEXT_TTL_SECONDS)||60;
  const ttlMs=Math.min(3600,Math.max(30,seconds))*1000;
  const enabled=()=>String(config.NOTION_ENABLED).trim()==='true'
    && !!String(config.NOTION_TOKEN||'').trim() && uuid(pageId);
  let cache=null,inflight=null,lastError=null,lastAttempt=null;
  const unavailable=()=>({available:false,source:'Notion — contexto geral de serviços',
    error:lastError?'Não foi possível atualizar o contexto geral.':null});
  const status=()=>({enabled:enabled(),configured:uuid(pageId),cached:!!cache,
    checkedAt:cache?.checkedAt||null,lastAttempt,lastError:!!lastError,
    ttlSeconds:ttlMs/1000});
  async function api(path){
    const response=await transport('https://api.notion.com/v1/'+path,{method:'GET',
      headers:{authorization:'Bearer '+String(config.NOTION_TOKEN||'').trim(),
        'Notion-Version':'2026-03-11','accept':'application/json'},
      redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response?.ok)throw Error('Notion não confirmou o acesso à fonte do contexto geral.');
    const result=await response.json();
    if(!result||typeof result!=='object')throw Error('Resposta incompleta do Notion.');
    return result;
  }
  async function children(blockId,maxPages=2){
    const blocks=[];let cursor;
    for(let i=0;i<maxPages;i++){
      const response=await api('blocks/'+blockId+'/children?page_size=100'
        +(cursor?'&start_cursor='+encodeURIComponent(cursor):''));
      if(!Array.isArray(response.results))throw Error('Blocos do Notion indisponíveis.');
      blocks.push(...response.results);
      if(!response.has_more)return blocks;
      if(!response.next_cursor)throw Error('Paginação do Notion sem cursor.');
      cursor=response.next_cursor;
    }
    throw Error('Contexto geral excede o limite de páginas definido.');
  }
  async function collect(){
    const page=await api('pages/'+pageId);
    if(page.archived||page.in_trash||page.id?.toLowerCase()!==pageId.toLowerCase())
      throw Error('Página de contexto geral inválida.');
    const blocks=await children(pageId),lines=[];
    let capture=false;
    for(const block of blocks){
      if(block.archived||block.in_trash)continue;
      const type=block.type||'';
      if(/^heading_[123]$/.test(type)){
        const heading=rich(block[type]?.rich_text);
        capture=sections.has(heading.toLocaleLowerCase('pt-BR'));
        if(capture)lines.push(heading);
        continue;
      }
      if(!capture)continue;
      if(type==='table'&&block.has_children&&uuid(block.id)){
        const rows=await children(block.id,1);
        if(rows.length>25)throw Error('Tabela de referências excede o limite.');
        for(const row of rows){
          if(row.type!=='table_row'||!Array.isArray(row.table_row?.cells))continue;
          const cells=row.table_row.cells.slice(0,3).map(rich);
          if(cells.some(Boolean))lines.push(cells.join(' | '));
        }
      }else if(['paragraph','bulleted_list_item','numbered_list_item','quote'].includes(type)){
        const value=rich(block[type]?.rich_text);
        if(value)lines.push(value);
      }
    }
    const text=lines.join('\n');
    if(!text||text.length>7000)throw Error('Contexto geral ausente ou acima do limite permitido.');
    return{text,available:true,source:'Notion — contexto geral de serviços',
      checkedAt:new Date().toISOString()};
  }
  async function refresh(force=false){
    if(!enabled())return unavailable();
    if(!force&&cache&&Date.now()-Date.parse(cache.checkedAt)<ttlMs)return {...cache};
    if(inflight)return inflight;
    inflight=(async()=>{
      lastAttempt=new Date().toISOString();
      try{const updated=await collect();cache=updated;lastError=null;return {...updated};}
      catch{cache=null;lastError='indisponível';return unavailable();}
    })().finally(()=>{inflight=null;});
    return inflight;
  }
  return {enabled,status,refresh,get:()=>refresh(false)};
}
