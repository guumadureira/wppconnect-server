import {randomUUID} from 'node:crypto';
const rt=value=>({rich_text:[{text:{content:String(value||'').slice(0,1800)}}]});
export const supplierCategories=['Materiais e produtos','Mão de obra e execução','Projetos e serviços técnicos','Serviços para empresas','Outros','A identificar'];
export function createSupplierRegister(db,config,transport){
  const get=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
  db.exec(`CREATE TABLE IF NOT EXISTS supplier_contacts(id TEXT PRIMARY KEY,phone TEXT UNIQUE NOT NULL,conversation_id TEXT NOT NULL,name TEXT NOT NULL,summary TEXT NOT NULL,last_contact INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,notion_id TEXT,state TEXT NOT NULL DEFAULT 'pending',error TEXT,next_attempt INTEGER NOT NULL DEFAULT 0);`);
  if(!db.prepare('PRAGMA table_info(supplier_contacts)').all().some(c=>c.name==='category'))db.exec("ALTER TABLE supplier_contacts ADD COLUMN category TEXT NOT NULL DEFAULT 'A identificar'");
  run("UPDATE supplier_contacts SET state='uncertain',error='Cadastro anterior sem resultado confirmado; conferir no Notion.' WHERE state='creating'");
  const source=String(config.NOTION_SUPPLIERS_DATA_SOURCE_ID||'').trim().replace(/^collection:\/\//,'');
  const sourceValid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(source);
  const enabled=()=>String(config.NOTION_ENABLED)==='true'&&!!String(config.NOTION_TOKEN||'').trim()&&sourceValid;
  function record(c,result){
    if(result.kind!=='comercial')return;
    const name=result.supplier?.name||c.name,summary=(result.supplier?.description||result.summary).slice(0,240),category=result.supplier?.category||'A identificar';
    const old=get('SELECT * FROM supplier_contacts WHERE phone=?',c.phone);
    if(old)run("UPDATE supplier_contacts SET name=?,summary=?,category=?,last_contact=?,conversation_id=?,version=version+1,state=CASE WHEN state IN ('creating','uncertain') THEN state ELSE 'pending' END,next_attempt=CASE WHEN next_attempt>? THEN next_attempt ELSE 0 END WHERE id=?",name,summary,category,c.last_inbound||Date.now(),c.id,Date.now(),old.id);
    else run('INSERT INTO supplier_contacts(id,phone,conversation_id,name,summary,category,last_contact) VALUES(?,?,?,?,?,?,?)',randomUUID(),c.phone,c.id,name,summary,category,c.last_inbound||Date.now());
  }
  function status(){return{enabled:enabled(),sourceConfigured:sourceValid,pending:get("SELECT COUNT(*) AS n FROM supplier_contacts WHERE state<>'synced'").n,uncertain:get("SELECT COUNT(*) AS n FROM supplier_contacts WHERE state='uncertain'").n,lastError:get("SELECT error FROM supplier_contacts WHERE error IS NOT NULL ORDER BY last_contact DESC LIMIT 1")?.error||null};}
  let nextAt=0;
  async function api(path,method='GET',body){
    const delay=nextAt-Date.now();if(delay>0)await new Promise(r=>setTimeout(r,delay));nextAt=Date.now()+350;
    let response;try{response=await transport('https://api.notion.com/v1/'+path,{method,headers:{authorization:'Bearer '+String(config.NOTION_TOKEN).trim(),'Notion-Version':'2026-03-11','content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Object.assign(Error('Resposta do Notion não confirmada.'),{uncertain:method==='POST'&&path==='pages'});}
    if(!response.ok)throw Object.assign(Error('Confira NOTION_SUPPLIERS_DATA_SOURCE_ID e o acesso da integração à base de fornecedores.'),{uncertain:method==='POST'&&path==='pages'&&response.status>=500,retryAfter:Math.max(60000,(Number(response.headers.get('retry-after'))||0)*1000)});
    try{return await response.json();}catch{throw Object.assign(Error('Resposta do Notion não confirmada.'),{uncertain:method==='POST'&&path==='pages'});}
  }
  let worker,stopped=false;
  async function process(){
    if(worker)return worker;if(stopped||!enabled())return;
    worker=(async()=>{for(const row of all("SELECT * FROM supplier_contacts WHERE state<>'synced' AND next_attempt<=? ORDER BY last_contact LIMIT 3",Date.now())){
      if(stopped)break;
      try{
        let notionId=row.notion_id;
        if(!notionId){
          const found=await api('data_sources/'+source+'/query','POST',{filter:{or:[{property:'ID do cadastro',rich_text:{equals:row.id}},{property:'Telefone',phone_number:{equals:row.phone}}]},page_size:100});
          const matches=(found.results||[]).filter(p=>p.properties?.Telefone?.phone_number===row.phone||p.properties?.['ID do cadastro']?.rich_text?.some(t=>(t.plain_text??t.text?.content)===row.id));
          if(found.has_more||matches.length>1)throw Error('Mais de um cadastro possível. A equipe precisa conferir a base de fornecedores.');
          if(matches.length)notionId=matches[0].id;
          else if(row.state==='uncertain')throw Object.assign(Error('Criação anterior incerta. Conferir no Notion antes de tentar criar outro cadastro.'),{uncertain:true});
        }
        const properties={Contato:{title:[{text:{content:row.name.slice(0,160)}}]},Telefone:{phone_number:row.phone},Categoria:{select:{name:row.category}},'Resumo da IA':rt(row.summary),'Último contato':{date:{start:new Date(row.last_contact).toISOString()}},'ID da conversa':rt(row.conversation_id),'ID do cadastro':rt(row.id),Origem:{select:{name:'WhatsApp'}}};
        if(notionId)await api('pages/'+notionId,'PATCH',{properties});
        else{
          run("UPDATE supplier_contacts SET state='creating' WHERE id=?",row.id);
          const created=await api('pages','POST',{parent:{type:'data_source_id',data_source_id:source},properties:{...properties,Situação:{select:{name:'Sem demanda atual'}}},notifications:{mode:'silent'}});
          if(!/^[a-f\d-]{32,36}$/i.test(created.id||''))throw Object.assign(Error('Criação sem identificador confirmado.'),{uncertain:true});notionId=created.id;
        }
        run("UPDATE supplier_contacts SET notion_id=?,state=CASE WHEN version=? THEN 'synced' ELSE 'pending' END,error=NULL,next_attempt=0 WHERE id=?",notionId,row.version,row.id);
      }catch(error){run('UPDATE supplier_contacts SET state=?,error=?,next_attempt=? WHERE id=?',error.uncertain?'uncertain':'error',error.message,Date.now()+(error.retryAfter||60000),row.id);}
    }})().finally(()=>worker=null);return worker;
  }
  return{record,status,process,close:async()=>{stopped=true;await worker;}};
}
