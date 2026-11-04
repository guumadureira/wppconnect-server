import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNotionGlobalContext} from '../notion-global-context.mjs';

const pageId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tableId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const rich=value=>[{plain_text:value}];
const block=(type,text,id)=>({type,id:id||'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  [type]:{rich_text:rich(text)},has_children:false});

test('contexto geral usa somente secoes permitidas e a tabela de servicos',async()=>{
  const calls=[];let service='Regularização residencial';
  const config={NOTION_ENABLED:'true',NOTION_TOKEN:'fake-private-token',NOTION_GLOBAL_CONTEXT_PAGE_ID:pageId,
    NOTION_GLOBAL_CONTEXT_TTL_SECONDS:'60'};
  let blocked=false;
  const transport=async(url,options)=>{
    calls.push({url,auth:options.headers.authorization});
    if(blocked)return Response.json({message:'no permission'},{status:403});
    if(url.endsWith('/pages/'+pageId))return Response.json({id:pageId,archived:false,in_trash:false});
    if(url.includes('/blocks/'+tableId+'/children'))return Response.json({results:[
      {type:'table_row',table_row:{cells:[rich(service),rich('Explicar o serviço sem promessa'),rich('Conferir municipio e documentos')]}},
      {type:'table_row',table_row:{cells:[rich('Construção'),rich('Escopo definido em contrato'),rich('Conferir projeto')]}},
    ],has_more:false});
    if(url.includes('/blocks/'+pageId+'/children'))return Response.json({results:[
      block('paragraph','SEGREDO FORA DO CONTEXTO'),
      block('heading_2','Serviços identificados nos documentos'),
      {type:'table',id:tableId,table:{},has_children:true},
      block('heading_2','Identificação e encaminhamento'),
      block('bulleted_list_item','Não confundir protocolo com aprovação.'),
      block('heading_2','Dados privados'),
      block('paragraph','OUTRO SEGREDO FORA DO CONTEXTO')
    ],has_more:false});
    throw Error('Unrecognized URL');
  };
  const context=createNotionGlobalContext(config,transport);
  const first=await context.get();
  assert.equal(first.available,true);
  assert.match(first.text,/Regularização residencial/);
  assert.match(first.text,/Não confundir protocolo/);
  assert.doesNotMatch(first.text,/SEGREDO|OUTRO SEGREDO/);
  assert.equal(first.source,'Notion — contexto geral de serviços');
  assert.ok(calls.every(v=>v.auth==='Bearer fake-private-token'));
  const count=calls.length;
  service='Regularização atualizada';
  assert.equal((await context.get()).text,first.text);
  assert.equal(calls.length,count);
  const updated=await context.refresh(true);
  assert.match(updated.text,/Regularização atualizada/);
  assert.doesNotMatch(updated.text,/Regularização residencial/);
  assert.equal(context.status().lastError,false);
  blocked=true;
  const unavailable=await context.refresh(true);
  assert.equal(unavailable.available,false);
  assert.equal(context.status().cached,false);
  assert.equal(context.status().lastError,true);
  assert.ok(!JSON.stringify(unavailable).includes('fake-private-token'));
});

test('pagina nao configurada nao faz chamada externa',async()=>{
  let calls=0;
  const context=createNotionGlobalContext({NOTION_ENABLED:'true',NOTION_TOKEN:'token',NOTION_GLOBAL_CONTEXT_PAGE_ID:''},async()=>{calls++;throw Error('unexpected');});
  assert.equal((await context.get()).available,false);
  assert.equal(context.status().enabled,false);
  assert.equal(calls,0);
});
