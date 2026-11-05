import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {inspectChatGPTConnection} from '../scripts/verificar-integracao-chatgpt.mjs';

function setup(t){
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE agents (id TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL); INSERT INTO agents VALUES ('admin','admin@example.invalid','admin',1);");
  t.after(()=>db.close());
  return db;
}
const valid={PUBLIC_ORIGIN:'https://central.example',CHATGPT_OAUTH_ADMIN_EMAIL:'admin@example.invalid',
  CENTRAL_MCP_ALLOWED_PHONES:'5544987654321,5544987654322',CHATGPT_OAUTH_ALLOWED_PHONES:'5544987654321'};

test('preflight com OAuth desligado identifica preparo sem expor credenciais',t=>{
  const db=setup(t);
  const report=inspectChatGPTConnection(db,{...valid,CHATGPT_OAUTH_ENABLED:'false',CENTRAL_MCP_TOKEN:'secret-do-not-print'});
  assert.equal(report.readyToEnable,true);
  assert.equal(report.readyForPrivateOAuthTest,false);
  assert.equal(report.allowedOperation,'read_only');
  assert.ok(!JSON.stringify(report).includes('secret-do-not-print'));
  assert.ok(!JSON.stringify(report).includes('admin@example.invalid'));
  assert.ok(!JSON.stringify(report).includes('5544987654321'));
});

test('preflight confirma somente requisitos de configuração, não a conexão real',t=>{
  const db=setup(t);
  const report=inspectChatGPTConnection(db,{...valid,CHATGPT_OAUTH_ENABLED:'true'});
  assert.equal(report.readyForPrivateOAuthTest,true);
  assert.equal(report.checks.activeAdministratorFound,true);
});

test('preflight recusa telefone do ChatGPT ausente do escopo legado',t=>{
  const db=setup(t);
  const report=inspectChatGPTConnection(db,{...valid,CHATGPT_OAUTH_ALLOWED_PHONES:'5544987654333'});
  assert.equal(report.readyToEnable,false);
  assert.equal(report.checks.scopeContainedInLegacy,false);
});

test('preflight recusa lista misturada com numero malformado',t=>{
  const db=setup(t);
  const report=inspectChatGPTConnection(db,{...valid,CHATGPT_OAUTH_ALLOWED_PHONES:'5544987654321,invalid'});
  assert.equal(report.readyToEnable,false);
  assert.equal(report.checks.explicitChatGPTScope,false);
});

test('preflight exige conta administrativa ativa e endereco HTTPS',t=>{
  const db=setup(t);
  db.exec("UPDATE agents SET active=0 WHERE id='admin'");
  const report=inspectChatGPTConnection(db,{...valid,PUBLIC_ORIGIN:'http://central.example',CHATGPT_OAUTH_ENABLED:'true'});
  assert.equal(report.readyToEnable,false);
  assert.equal(report.checks.activeAdministratorFound,false);
  assert.equal(report.checks.httpsOrigin,false);
});

test('preflight não faz alterações de esquema nem adiciona registros',t=>{
  const db=setup(t);
  const before=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name);
  inspectChatGPTConnection(db,{...valid,CHATGPT_OAUTH_ENABLED:'false'});
  const after=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(x=>x.name);
  assert.deepEqual(after,before);
});
