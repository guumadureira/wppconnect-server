import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNotionDocuments} from '../notion-documents.mjs';
import {pageTextPDF} from '../notion-page-pdf.mjs';
const pageId='11111111-1111-4111-8111-111111111111',tableId='22222222-2222-4222-8222-222222222222';
const rt=text=>[{type:'text',plain_text:text}],p=text=>({type:'paragraph',paragraph:{rich_text:rt(text)}});
function fixture(extra={}){
  const state={content:[{type:'heading_1',heading_1:{rich_text:rt('Escopo')}},p('Projeto residencial em Sarandi. Área prevista: 100 m².'),p('Valor: R$ 1.250,00. Condições sujeitas à aprovação.'),{type:'table',id:tableId,has_children:true,table:{table_width:2,has_column_header:true}}],...extra},calls=[];
  const docs=createNotionDocuments({NOTION_ENABLED:'true',NOTION_TOKEN:'test-notion'},async(url,o)=>{
    assert.equal(o.headers.authorization,'Bearer test-notion');assert.ok(url.startsWith('https://api.notion.com/v1/'));calls.push(url);
    if(state.denied)return Response.json({message:'test-notion'},{status:404});
    if(url.includes('/pages/'))return Response.json({id:pageId,last_edited_time:state.edited||'2026-10-28T12:00:00Z',properties:{Nome:{type:'title',title:rt('Proposta de projeto')},Margem:{type:'number',number:99},Notas:{type:'rich_text',rich_text:rt('NÃO COPIAR PROPRIEDADES')}}});
    if(url.includes(tableId))return Response.json({results:[{type:'table_row',table_row:{cells:[rt('Serviço'),rt('Valor')]}},{type:'table_row',table_row:{cells:[rt('Projeto'),rt('R$ 1.250,00')]}}],has_more:false});
    if(state.pageChange)state.edited='2026-10-28T13:00:00Z';
    return Response.json({results:state.content,has_more:!!state.more,next_cursor:state.cursor});
  });return{docs,state,calls};
}
test('página escrita vira PDF paginado com valores, acentos e tabela, sem propriedades internas',async()=>{
  const f=fixture(),preview=await f.docs.inspect(pageId);
  assert.equal(preview.titulo,'Proposta de projeto');assert.equal(preview.resumoConteudo.length,64);assert.ok(!JSON.stringify(preview).includes('NÃO COPIAR PROPRIEDADES'));
  assert.ok(preview.conteudo.some(b=>b.cells?.includes('R$ 1.250,00')));
  const file=await f.docs.exportPage(pageId,preview.resumoConteudo),s=file.data.toString();
  assert.equal(file.name,'Proposta de projeto.pdf');assert.equal(file.mime,'application/pdf');assert.equal(file.origin.tipo,'pagina_pdf');assert.ok(s.startsWith('%PDF-1.4'));assert.match(s,/\/Count 1/);
  const xref=Number(s.match(/startxref\n(\d+)/)[1]);assert.equal(file.data.subarray(xref,xref+4).toString(),'xref');
  assert.ok(!s.includes('test-notion'));assert.ok(f.calls.every(u=>u.startsWith('https://api.notion.com/')));
});
test('página alterada, sem conteúdo, privada ou parcialmente lida nunca gera documento',async()=>{
  const f=fixture(),preview=await f.docs.inspect(pageId);f.state.content.push({type:'paragraph',paragraph:{rich_text:rt('Preço alterado: R$ 9.000,00')}});
  await assert.rejects(f.docs.exportPage(pageId,preview.resumoConteudo),/conteúdo da página mudou/);
  for(const extra of [{denied:true},{content:[]},{pageChange:true},{content:[{type:'image',image:{type:'external',external:{url:'https://evil.invalid'}}}]},{more:true,cursor:'repeated'},{content:[p('https://app.notion.com/p/private')]},{content:[p('Bearer test-secret')]}]){
    const f=fixture(extra);await assert.rejects(f.docs.inspect(pageId));
  }
});
test('PDF recusa caracteres incompatíveis e preserva todos os parágrafos entre páginas',()=>{
  assert.throws(()=>pageTextPDF({title:'Proposta',blocks:[{text:'Nome 字 não pode sumir'}]}),/símbolos/);
  const pdf=pageTextPDF({title:'Proposta',blocks:Array.from({length:150},(_,i)=>({type:'paragraph',text:'Item '+i+' - Projeto e aprovação. R$ 1.250,00.'}))});
  assert.ok(Number(pdf.toString().match(/\/Count (\d+)/)[1])>1);
  assert.ok(pdf.toString().includes(Buffer.from('Item 149','latin1').toString('hex')));
});
