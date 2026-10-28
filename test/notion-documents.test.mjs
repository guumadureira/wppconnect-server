import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNotionDocuments} from '../notion-documents.mjs';
const pageId='a1111111-1111-4111-8111-111111111111',config={NOTION_ENABLED:'true',NOTION_TOKEN:'test-only-key'};
test('configuração ausente impede consulta sem usar outras credenciais',async()=>{
  for(const config of [{},{NOTION_ENABLED:'false',NOTION_TOKEN:'test-only-key'},{NOTION_ENABLED:'true'}]){
    const docs=createNotionDocuments(config,()=>{assert.fail('Não deve acessar o Notion');});await assert.rejects(docs.list(pageId),{status:409});
  }
});
function setup({file,download,denied=false,props=false}={}){
  const calls=[];let pageCount=0;
  const entry=file||{name:'contrato.pdf',type:'file',file:{url:'https://s3.us-west-2.amazonaws.com/secure.notion-static.com/test/contrato.pdf?private=signature'}};
  const docs=createNotionDocuments(config,async(url,options)=>{
    calls.push({url,options});
    if(url.startsWith('https://api.notion.com/')){
      assert.equal(options.headers.authorization,'Bearer test-only-key');assert.equal(options.headers['Notion-Version'],'2026-03-11');assert.equal(options.redirect,'error');
      if(denied)return Response.json({message:'test-only-key'},{status:404});
      if(url.includes('/pages/'))return Response.json({id:pageId,properties:props?{Arquivo:{id:'files',type:'files',files:[entry]}}:{}});
      pageCount++;return Response.json({results:props?[]:[{id:'block-'+((pageCount-1)%2),type:'pdf',pdf:entry}],has_more:!props&&pageCount%2===1,next_cursor:'cursor-with/%?reserved'});
    }
    assert.equal(options.headers,undefined);assert.equal(options.redirect,'error');
    return download?download():new Response('%PDF-1.4\nTest',{headers:{'content-type':'application/octet-stream'}});
  });return{docs,calls};
}
test('lista arquivos de propriedades e blocos paginados sem expor URL temporária ou conteúdo da página',async()=>{
  for(const props of [false,true]){
    const f=setup({props}),list=await f.docs.list(pageId);assert.equal(list.documentos.length,props?1:2);assert.equal(list.parcial,false);
    assert.ok(!JSON.stringify(list).includes('signature'));assert.ok(list.documentos.every(d=>d.importavel));
    if(!props)assert.ok(f.calls.some(c=>c.url.includes('start_cursor=cursor-with%2F%25%3Freserved')));
    const loaded=await f.docs.load(pageId,list.documentos[0].arquivoId);assert.equal(loaded.mime,'application/pdf');assert.equal(loaded.data.toString(),'%PDF-1.4\nTest');
  }
});
test('somente links hospedados no Notion são baixados, sem credenciais ou redirecionamentos',async()=>{
  for(const url of ['http://127.0.0.1/a.pdf','https://evil.invalid/a.pdf','https://prod-files-secure.s3.us-west-2.amazonaws.com.evil.invalid/a.pdf','https://s3.us-west-2.amazonaws.com/outro-bucket/a.pdf','https://user:pass@secure.notion-static.com/a.pdf','https://secure.notion-static.com:8443/a.pdf']){
    const f=setup({file:{name:'arquivo.pdf',type:'file',file:{url}},props:true}),list=await f.docs.list(pageId);
    await assert.rejects(f.docs.load(pageId,list.documentos[0].arquivoId),{status:400});assert.ok(f.calls.every(c=>c.url.startsWith('https://api.notion.com/')));
  }
  const f=setup({file:{name:'arquivo.pdf',type:'external',external:{url:'https://secure.notion-static.com/file.pdf'}},props:true}),list=await f.docs.list(pageId);
  assert.equal(list.documentos[0].importavel,false);await assert.rejects(f.docs.load(pageId,list.documentos[0].arquivoId),{status:415});
});
test('limites de corpo, formato, expiração e redirecionamento impedem importação',async()=>{
  for(const download of [
    ()=>new Response('x',{headers:{'content-length':'20000001'}}),
    ()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),
    ()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}),
    ()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(10000001));c.enqueue(new Uint8Array(10000000));c.close();}}))
  ]){
    const f=setup({download,props:true}),list=await f.docs.list(pageId);await assert.rejects(f.docs.load(pageId,list.documentos[0].arquivoId));
  }
  const f=setup({file:{name:'arquivo.pdf',type:'file',file:{url:'https://secure.notion-static.com/file.pdf',expiry_time:'2000-01-01T00:00:00Z'}},props:true}),list=await f.docs.list(pageId);
  await assert.rejects(f.docs.load(pageId,list.documentos[0].arquivoId),{status:409});assert.ok(f.calls.every(c=>c.url.startsWith('https://api.notion.com/')));
});

test('identidade de arquivo é estável com UUID em maiúsculas ou sem hífens',async()=>{
  const f=setup({props:true}),a=await f.docs.list(pageId),b=await f.docs.list(pageId.replace(/-/g,'').toUpperCase());
  assert.equal(a.documentos[0].arquivoId,b.documentos[0].arquivoId);
});
