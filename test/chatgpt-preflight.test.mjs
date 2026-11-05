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
  for(const name of ['pending','codes','access','refresh'])db.exec(`CREATE TABLE chatgpt_oauth_${name} (id TEXT)`);
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

test('preflight exige um único telefone e aplica a mesma validação de origem do runtime',t=>{
  const db=setup(t);
  assert.equal(inspectChatGPTConnection(db,{...valid,CHATGPT_OAUTH_ALLOWED_PHONES:valid.CENTRAL_MCP_ALLOWED_PHONES}).checks.singleInternalPhone,false);
  for(const PUBLIC_ORIGIN of ['https://user:pass@central.example','https://central.example:invalid','https://central.example/path']){
    assert.equal(inspectChatGPTConnection(db,{...valid,PUBLIC_ORIGIN}).readyToEnable,false);
  }
});

test('preflight relata esquema OAuth ausente, parcial e completo sem modificar tabelas',t=>{
  const db=setup(t);
  assert.deepEqual(inspectChatGPTConnection(db,valid).oauthSchema,{expectedTables:4,presentTables:0,absent:true,complete:false});
  db.exec('CREATE TABLE chatgpt_oauth_pending (id TEXT)');
  assert.equal(inspectChatGPTConnection(db,valid).oauthSchema.presentTables,1);
  assert.equal(inspectChatGPTConnection(db,valid).readyToEnable,false);
  for(const name of ['codes','access','refresh'])db.exec(`CREATE TABLE chatgpt_oauth_${name} (id TEXT)`);
  assert.equal(inspectChatGPTConnection(db,valid).oauthSchema.complete,true);
});

test('flag ligada sem tabelas não pode indicar que o teste privado está pronto',t=>{
  const report=inspectChatGPTConnection(setup(t),{...valid,CHATGPT_OAUTH_ENABLED:'true'});
  assert.equal(report.readyForPrivateOAuthTest,false);
  assert.equal(report.oauthSchema.absent,true);
});

test('leitura completa exige opt-in exato e dispensa a lista legada somente no canal ChatGPT',t=>{
  const db=setup(t),config={...valid,CENTRAL_MCP_ALLOWED_PHONES:'',CHATGPT_OAUTH_ALLOWED_PHONES:'',CHATGPT_OAUTH_READ_ALL_CONTACTS:'true'};
  const report=inspectChatGPTConnection(db,config);
  assert.equal(report.readyToEnable,true);assert.equal(report.readScope,'all_conversations_and_contacts');
  assert.equal(report.checks.singleInternalPhone,null);assert.equal(report.checks.scopeContainedInLegacy,null);
  for(const value of ['', 'false','TRUE'])assert.equal(inspectChatGPTConnection(db,{...config,CHATGPT_OAUTH_READ_ALL_CONTACTS:value}).readyToEnable,false);
});
