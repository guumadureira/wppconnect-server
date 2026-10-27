import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createSupplierRegister} from '../supplier-register.mjs';
const source='11111111-1111-4111-8111-111111111111',phone='5544000000001';
const config={NOTION_ENABLED:'true',NOTION_TOKEN:'fake-secret',NOTION_SUPPLIERS_DATA_SOURCE_ID:source};
function setup(t,mode='ok'){
  const db=new DatabaseSync(':memory:'),rows=[],calls=[];let creates=0;t.after(()=>db.close());
  const register=createSupplierRegister(db,config,async(url,options)=>{
    assert.equal(options.headers.authorization,'Bearer fake-secret');assert.equal(options.redirect,'error');const body=options.body?JSON.parse(options.body):null;calls.push({url,body,method:options.method});
    assert.ok(!url.includes('clients'));if(url.endsWith('/query'))return Response.json({results:mode==='ambiguous'?[{id:source,properties:{Telefone:{phone_number:phone}}},{id:source,properties:{Telefone:{phone_number:phone}}}]:rows,has_more:false});
    if(options.method==='PATCH')return Response.json({id:source});
    assert.equal(url,'https://api.notion.com/v1/pages');assert.equal(body.parent.data_source_id,source);assert.ok(!body.properties['Cliente cadastrado']);
    creates++;rows.push({id:source,properties:body.properties});if(mode==='lost')throw Error('fake-secret');return Response.json({id:source});
  });t.after(()=>register.close());
  return{db,register,rows,calls,creates:()=>creates};
}
test('fornecedor é cadastrado uma vez, separado de clientes, e atualização preserva a situação humana',async t=>{
  const f=setup(t),c={id:'c',phone,name:'Contato (perfil)',last_inbound:Date.now()},result={kind:'comercial',summary:'Oferece serviços de pintura; dados ainda não verificados.'};
  f.register.record(c,result);f.register.record(c,result);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM supplier_contacts').get().n,1);
  await f.register.process();assert.equal(f.creates(),1);assert.equal(f.register.status().pending,0);
  f.register.record(c,{...result,summary:'Nova oferta informada'});await f.register.process();assert.equal(f.creates(),1);
  const patch=f.calls.find(c=>c.method==='PATCH');assert.ok(!patch.body.properties.Situação);assert.equal(patch.body.properties['Resumo da IA'].rich_text[0].text.content,'Nova oferta informada');
  f.register.record({...c,phone:'5544000000002'},{kind:'orcamento',summary:'Cliente solicita projeto'});assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM supplier_contacts').get().n,1);
});
test('criação incerta é reconciliada por telefone/chave sem duplicar nem revelar credencial',async t=>{
  const f=setup(t,'lost');f.register.record({id:'c',phone,name:'Contato',last_inbound:Date.now()},{kind:'comercial',summary:'Oferece serviço'});
  await f.register.process();assert.equal(f.register.status().uncertain,1);assert.ok(!JSON.stringify(f.register.status()).includes('fake-secret'));
  f.db.prepare('UPDATE supplier_contacts SET next_attempt=0').run();await f.register.process();assert.equal(f.creates(),1);assert.equal(f.register.status().pending,0);
});
test('duplicidade no Notion exige conferência e não cria outro cadastro',async t=>{
  const f=setup(t,'ambiguous');f.register.record({id:'c',phone,name:'Contato',last_inbound:Date.now()},{kind:'comercial',summary:'Oferece serviço'});await f.register.process();assert.equal(f.creates(),0);assert.match(f.register.status().lastError,/Mais de um/);
});

test('categoria e descrição sucinta são enviadas à base exclusiva',async t=>{
  const f=setup(t);f.register.record({id:'c',phone,name:'Nome de perfil',last_inbound:Date.now()},{kind:'comercial',summary:'Resumo amplo',supplier:{name:'Wilton',description:'Oferece pintura residencial.',category:'Mão de obra e execução'}});
  await f.register.process();const create=f.calls.find(c=>c.url.endsWith('/pages'));
  assert.equal(create.body.properties.Contato.title[0].text.content,'Wilton');assert.equal(create.body.properties.Categoria.select.name,'Mão de obra e execução');assert.equal(create.body.properties['Resumo da IA'].rich_text[0].text.content,'Oferece pintura residencial.');
});
