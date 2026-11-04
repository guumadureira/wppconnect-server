import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCentral} from '../server.mjs';
import {createDirectionContactGuard} from '../direction-contact.mjs';

test('numero interno so e identificado por configuracao privada explicita',()=>{
  const disabled=createDirectionContactGuard({});
  assert.equal(disabled.configured,false);
  assert.equal(disabled.isDirectionContact('5544000000001'),false);
  const enabled=createDirectionContactGuard({DIRECTION_CONTACT_PHONES:'5544000000001'});
  assert.equal(enabled.isDirectionContact('5544000000001'),true);
  assert.equal(enabled.isDirectionContact('+55 (44) 0000-0001'),false);
  assert.equal(enabled.isDirectionContact('5544999999999'),false);
});

test('contato da direcao nao recebe IA de clientes nem cadastro automatico',async t=>{
  const phone='5544000000001',sent=[];
  const config={DATABASE_PATH:':memory:',WHATSAPP_MODE:'live',WHATSAPP_PHONE_NUMBER_ID:'test-phone',
    WHATSAPP_ACCESS_TOKEN:'test-token',META_APP_SECRET:'test-secret',WEBHOOK_VERIFY_TOKEN:'test-verify',
    META_GRAPH_VERSION:'v25.0',AI_ENABLED:'true',OPENAI_API_KEY:'test-key',
    AI_ALLOWED_PHONES:phone,AI_MONTHLY_BUDGET_USD:'1',DIRECTION_CONTACT_PHONES:phone,
    NOTION_AUTO_REGISTER_CONTACTS:'true'};
  const app=createCentral(config,async(url)=>{sent.push(url);throw Error('Contatos internos nao devem chamar transportes');},
    {aiDebounceMs:0,notionRequestIntervalMs:0});
  t.after(()=>app.close());
  app.intake({metadata:{phone_number_id:'test-phone'},messages:[
    {id:'internal-in',from:phone,type:'text',text:{body:'Quero ver a proposta'},timestamp:Math.floor(Date.now()/1000)}
  ]});
  await app.ai.process();
  await app.customerContext.processLookups();
  const chat=app.db.prepare('SELECT * FROM conversations WHERE phone=?').get(phone);
  assert.ok(chat);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM ai_jobs').get().n,0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE direction=?').get('out').n,0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM notion_client_operations').get().n,0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM service_events').get().n,0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM notion_client_summaries').get().n,0);
  assert.equal(app.customerContext.view(chat.id).mode,'human');
  assert.deepEqual(sent,[]);
  assert.throws(()=>app.ai.release(chat),{status:403});
});
