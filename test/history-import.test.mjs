import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseWhatsAppExport} from '../history-import.mjs';
import {createCentral} from '../server.mjs';
const at=Date.UTC(2026,9,27,16);
test('TXT Android e iPhone preservam autoria, linhas e fuso de São Paulo, selecionando sete dias',()=>{
  for(const source of ['27/10/2026 12:30 - Cliente: Olá\nSegunda linha\n27/10/2026 12:31 - Domum: Bom dia','[27/10/26, 12:30:00] Cliente: Olá\nSegunda linha\n[27/10/26, 12:31:00] Domum: Bom dia']){
    const parsed=parseWhatsAppExport(source,'dmy',at);assert.equal(parsed.messages[0].created,Date.UTC(2026,9,27,15,30));assert.equal(parsed.messages[0].body,'Olá\nSegunda linha');assert.deepEqual(parsed.participants,['Cliente','Domum']);
  }
  const parsed=parseWhatsAppExport('01/10/2026 10:00 - Cliente: Antiga\n27/10/2026 10:00 - Mensagens são protegidas\n27/10/2026 10:05 - Cliente: Recente','dmy',at);assert.equal(parsed.messages.length,1);assert.equal(parsed.ignored,2);
  assert.equal(parseWhatsAppExport('[10/27/2026, 12:30] Cliente: Oi','mdy',at).messages.length,1);
  assert.throws(()=>parseWhatsAppExport('31/02/2026 12:00 - A: Oi','dmy',at),/datas inválidas/);
  assert.throws(()=>parseWhatsAppExport('27/10/2026 12:00 - A: 1\n27/10/2026 12:01 - B: 2\n27/10/2026 12:02 - C: 3','dmy',at),/dois participantes/);
});
function txt(body='Histórico a conferir'){
  const d=new Date(Date.now()-3*3600000-60000),date=[d.getUTCDate(),d.getUTCMonth()+1,d.getUTCFullYear()].join('/');
  return date+' '+d.getUTCHours()+':'+String(d.getUTCMinutes()).padStart(2,'0')+' - Cliente: '+body;
}
test('importação tem prévia, deduplica, pausa IA e conserva pendência, janela e mensagens reais',async t=>{
  const app=createCentral({DATABASE_PATH:':memory:'},()=>{assert.fail('Não deve haver chamada externa');});t.after(()=>app.close());
  app.db.prepare('INSERT INTO conversations(id,name,phone,updated,pending_since,last_inbound) VALUES(?,?,?,?,?,?)').run('c','Cliente','5544000000001',Date.now(),Date.now(),Date.now());
  const c=app.db.prepare('SELECT * FROM conversations WHERE id=?').get('c'),actor={id:'admin'},body={text:txt(),dateOrder:'dmy',customerName:'Cliente',participantsConfirmed:true};
  const before=JSON.stringify(c),draft=app.manualHistory.preview(c,body,actor);
  assert.equal(draft.count,1);assert.equal(app.manualHistory.messages().length,0);
  assert.throws(()=>app.manualHistory.confirm(c,{previewId:draft.previewId,digest:'alterado',confirmed:true},actor),/prévia/);
  assert.throws(()=>app.manualHistory.confirm({...c,id:'outro'}, {...draft,confirmed:true},actor),/prévia/);
  app.manualHistory.confirm(c,{...draft,confirmed:true},actor);assert.equal(app.manualHistory.messages().length,1);
  assert.equal(JSON.stringify(app.db.prepare('SELECT * FROM conversations WHERE id=?').get('c')),before);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,0);
  assert.equal(app.customerContext.view('c').mode,'human');
  assert.equal(app.manualHistory.forAI('c').messages[0].text,'Histórico a conferir');assert.equal(app.manualHistory.forAI('outro').messages.length,0);
  app.manualHistory.confirm(c,{...draft,confirmed:true},actor);assert.equal(app.manualHistory.messages().length,1);
  assert.equal(app.manualHistory.preview(c,body,actor).duplicates,1);
});
test('nova mensagem, mudança de contexto ou expiração invalidam a confirmação antiga',async t=>{
  for(const change of ['message','context','expired']){
    const app=createCentral({DATABASE_PATH:':memory:'});t.after(()=>app.close());
    app.db.prepare('INSERT INTO conversations(id,name,phone,updated) VALUES(?,?,?,?)').run('c','Cliente','5544000000001',Date.now());
    const c=app.db.prepare('SELECT * FROM conversations WHERE id=?').get('c'),actor={id:'admin'},draft=app.manualHistory.preview(c,{text:txt(),dateOrder:'dmy',customerName:'Cliente',participantsConfirmed:true},actor);
    if(change==='message')app.db.prepare('UPDATE conversations SET last_received=99').run();
    if(change==='context')app.ai.pause('c');if(change==='expired')app.db.prepare('UPDATE history_import_previews SET expires=0').run();
    assert.throws(()=>app.manualHistory.confirm(app.db.prepare('SELECT * FROM conversations WHERE id=?').get('c'),{...draft,confirmed:true},actor),/mudou/);
    assert.equal(app.manualHistory.messages().length,0);
  }
});
test('rotas de importação exigem administrador, origem e sessão, sem aceitar chave MCP',async t=>{
  const config={DATABASE_PATH:':memory:'},app=createCentral(config);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  config.PUBLIC_ORIGIN=base;
  const post=(path,data,cookie,origin=base)=>fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)});
  const admin={name:'Admin',email:'history@example.invalid',password:'teste'};await post('/api/setup',admin);const login=await post('/api/login',admin),cookie=login.headers.get('set-cookie').split(';')[0];
  app.db.prepare('INSERT INTO conversations(id,name,phone,updated) VALUES(?,?,?,?)').run('c','Cliente','5544000000001',Date.now());
  const path='/api/conversations/c/history-import/inspect';
  assert.equal((await post(path,{text:txt(),dateOrder:'dmy'})).status,401);
  assert.equal((await post(path,{text:txt(),dateOrder:'dmy'},cookie,'https://evil.invalid')).status,403);
  const report=await post(path,{text:txt(),dateOrder:'dmy'},cookie);assert.equal(report.status,200);assert.equal((await report.json()).count,1);
  assert.equal((await post(path,{text:'x'.repeat(1000001),dateOrder:'dmy'},cookie)).status,400);
  app.db.prepare("UPDATE agents SET role='agent'").run();assert.equal((await post(path,{text:txt(),dateOrder:'dmy'},cookie)).status,403);
});
