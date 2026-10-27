import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCentral } from '../server.mjs';

async function start(config = { DATABASE_PATH: ':memory:' }) {
  const app = createCentral(config, async () => { throw new Error('External calls are not allowed'); });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.PUBLIC_ORIGIN = 'http://127.0.0.1:' + app.server.address().port;
  const request = async (path, method = 'GET', body, cookie, origin = config.PUBLIC_ORIGIN) => {
    const response = await fetch(config.PUBLIC_ORIGIN + path, {
      method,
      headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  return { app, request };
}

const account = { name: 'Conta Domum', email: 'shared@example.invalid', password: 'test-only-password' };

test('o mesmo login mantém nomes independentes por sessão e preserva autoria das mensagens', async t => {
  const { app, request } = await start();
  t.after(() => app.close());
  assert.equal((await request('/api/setup', 'POST', account)).status, 201);
  const a = await request('/api/login', 'POST', { ...account, signatureName: 'Gustavo' });
  const b = await request('/api/login', 'POST', { ...account, signatureName: 'Jonatan' });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.notEqual(a.cookie, b.cookie);
  const userA = (await request('/api/session', 'GET', undefined, a.cookie)).body.user;
  const userB = (await request('/api/session', 'GET', undefined, b.cookie)).body.user;
  assert.equal(userA.id, userB.id);
  assert.equal(userA.signatureName, 'Gustavo');
  assert.equal(userB.signatureName, 'Jonatan');
  assert.equal(userA.name, account.name);
  const chat = await request('/api/demo/incoming', 'POST', { name: 'Cliente fictício', text: 'Olá' }, a.cookie);
  const send = (cookie, requestId) => request('/api/conversations/' + chat.body.id + '/messages', 'POST', { text: 'Olá', requestId, agentName: 'Nome não autorizado pelo envio' }, cookie);
  const first = await send(a.cookie, 'session-message-a');
  const second = await send(b.cookie, 'session-message-b');
  assert.equal(first.body.message.body, '*Gustavo:* Olá');
  assert.equal(second.body.message.body, '*Jonatan:* Olá');
  assert.equal(first.body.message.agent_id, second.body.message.agent_id);
  assert.equal((await request('/api/session/signature', 'PATCH', { name: '  Ana  ' }, a.cookie)).status, 200);
  assert.equal((await request('/api/session', 'GET', undefined, a.cookie)).body.user.signatureName, 'Ana');
  assert.equal((await request('/api/session', 'GET', undefined, b.cookie)).body.user.signatureName, 'Jonatan');
  assert.equal((await send(a.cookie, 'session-message-c')).body.message.body, '*Ana:* Olá');
  const state = (await request('/api/state', 'GET', undefined, a.cookie)).body;
  assert.equal(state.messages.find(message => message.request_id === 'session-message-a').agent_name, 'Gustavo');
  assert.equal(state.agents[0].name, account.name);
  assert.equal((await request('/api/session/signature', 'PATCH', { name: 'X' })).status, 401);
  assert.equal((await request('/api/session/signature', 'PATCH', { name: 'X' }, b.cookie, 'https://invalid.example')).status, 403);
  for (const name of ['', '  ', null, 42, 'a'.repeat(81), 'Ana\nBruno']) {
    assert.equal((await request('/api/session/signature', 'PATCH', { name }, a.cookie)).status, 400);
  }
});

test('banco antigo ganha assinatura de sessão sem perder contas, sessões ou histórico', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'central-signature-migration-'));
  const database = join(dir, 'central.sqlite');
  const config = { DATABASE_PATH: database };
  let running;
  try {
    running = await start(config);
    await running.request('/api/setup', 'POST', account);
    const login = await running.request('/api/login', 'POST', account);
    await running.request('/api/demo/incoming', 'POST', { name: 'Teste preservado', text: 'Histórico preservado' }, login.cookie);
    await running.app.close();
    running = null;
    const oldDatabase = new DatabaseSync(database);
    oldDatabase.exec('ALTER TABLE sessions DROP COLUMN signature_name');
    oldDatabase.close();
    running = await start(config);
    const session = await running.request('/api/session', 'GET', undefined, login.cookie);
    assert.equal(session.body.setupRequired, false);
    assert.equal(session.body.user.signatureName, account.name);
    const state = await running.request('/api/state', 'GET', undefined, login.cookie);
    assert.equal(state.body.messages[0].body, 'Histórico preservado');
    await running.request('/api/session/signature', 'PATCH', { name: 'Jonatan' }, login.cookie);
    await running.app.close();
    running = null;
    running = await start(config);
    assert.equal((await running.request('/api/session', 'GET', undefined, login.cookie)).body.user.signatureName, 'Jonatan');
    assert.equal((await running.request('/api/login', 'POST', account)).status, 200);
  } finally {
    if (running) await running.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
