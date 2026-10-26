import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCentral } from '../server.mjs';

async function start(config) {
  const app = createCentral(config);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.PUBLIC_ORIGIN = 'http://127.0.0.1:' + app.server.address().port;
  return {
    app,
    async request(path, method = 'GET', data, cookie) {
      const response = await fetch(config.PUBLIC_ORIGIN + path, {
        method,
        headers: { origin: config.PUBLIC_ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    },
  };
}

test('diagnóstico distingue configuração de conexão real e não expõe credenciais', async t => {
  const config = { DATABASE_PATH: ':memory:', WHATSAPP_MODE: 'live', WHATSAPP_ACCESS_TOKEN: 'test-only-private-value' };
  const { app, request } = await start(config);
  t.after(() => app.close());
  assert.deepEqual((await request('/healthz')).body, { status: 'ok', mode: 'live' });
  assert.equal((await request('/api/connection-status')).status, 401);
  const admin = { name: 'Admin', email: 'admin@example.invalid', password: 'test-only-password-123' };
  await request('/api/setup', 'POST', admin);
  const { cookie } = await request('/api/login', 'POST', admin);
  const status = await request('/api/connection-status', 'GET', undefined, cookie);
  assert.equal(status.body.connectionVerified, false);
  assert.equal(status.body.credentialsConfigured, false);
  assert.ok(status.body.missing.includes('META_APP_SECRET'));
  assert.ok(!status.body.missing.includes('WHATSAPP_ACCESS_TOKEN'));
  assert.ok(!JSON.stringify(status.body).includes(config.WHATSAPP_ACCESS_TOKEN));
  await request('/api/agents', 'POST', { ...admin, email: 'agent@example.invalid' }, cookie);
  const agent = await request('/api/login', 'POST', { ...admin, email: 'agent@example.invalid' });
  assert.equal((await request('/api/connection-status', 'GET', undefined, agent.cookie)).status, 403);
});

test('código de instalação é exigido quando configurado, sem criar conta em tentativa inválida', async t => {
  const { app, request } = await start({ DATABASE_PATH: ':memory:', SETUP_TOKEN: 'test-only-setup-code' });
  t.after(() => app.close());
  const account = { name: 'Admin', email: 'admin@example.invalid', password: 'test-only-password-123' };
  assert.equal((await request('/api/setup', 'POST', account)).status, 403);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM agents').get().n, 0);
  assert.equal((await request('/api/setup', 'POST', { ...account, setupToken: 'test-only-setup-code' })).status, 201);
});

test('administrador e atendente aceitam senha curta, exigem preenchimento e autenticam a senha exata', async t => {
  const { app, request } = await start({ DATABASE_PATH: ':memory:' });
  t.after(() => app.close());
  const admin = { name: 'Admin', email: 'short-admin@example.invalid', password: 'a' };
  for (const password of ['', null, 123, 'a'.repeat(513)]) {
    assert.equal((await request('/api/setup', 'POST', { ...admin, password })).status, 400);
  }
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM agents').get().n, 0);
  assert.equal((await request('/api/setup', 'POST', admin)).status, 201);
  const login = await request('/api/login', 'POST', admin);
  assert.equal(login.status, 200);
  assert.equal((await request('/api/login', 'POST', { ...admin, password: 'b' })).status, 401);
  const agent = { name: 'Agent', email: 'short-agent@example.invalid', password: '!' };
  for (const password of ['', null, 123, 'a'.repeat(513)]) {
    assert.equal((await request('/api/agents', 'POST', { ...agent, password }, login.cookie)).status, 400);
  }
  assert.equal((await request('/api/agents', 'POST', agent, login.cookie)).status, 201);
  const agentLogin = await request('/api/login', 'POST', agent);
  assert.equal(agentLogin.status, 200);
  const state = await request('/api/state', 'GET', undefined, agentLogin.cookie);
  assert.equal(state.body.user.name, agent.name);
  assert.equal(state.body.user.role, 'agent');
  const stored = app.db.prepare('SELECT password FROM agents WHERE email=?').get(agent.email).password;
  assert.notEqual(stored, agent.password);
});

test('contas, mensagens e retornos persistem após reiniciar o servidor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'central-persistence-'));
  const config = { DATABASE_PATH: join(dir, 'central.sqlite') };
  let running;
  try {
    running = await start(config);
    const account = { name: 'Ana', email: 'ana@example.invalid', password: 'test-only-password-123' };
    await running.request('/api/setup', 'POST', account);
    let { cookie } = await running.request('/api/login', 'POST', account);
    const chat = await running.request('/api/demo/incoming', 'POST', { name: 'Cliente de teste', text: 'Preciso de um retorno' }, cookie);
    const followup = Date.now() + 600000;
    await running.request('/api/conversations/' + chat.body.id, 'PATCH', { followup_at: followup }, cookie);
    await running.app.close();
    running = null;
    running = await start(config);
    assert.equal((await running.request('/api/session')).body.setupRequired, false);
    ({ cookie } = await running.request('/api/login', 'POST', account));
    const state = await running.request('/api/state', 'GET', undefined, cookie);
    assert.equal(state.body.conversations[0].followup_at, followup);
    assert.equal(state.body.messages[0].body, 'Preciso de um retorno');
    assert.ok(state.body.conversations[0].pending_since);
  } finally {
    if (running) await running.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('origem HTTPS do Render protege o cadastro remoto e habilita cookie Secure', async t => {
  const config = { DATABASE_PATH: ':memory:', RENDER_EXTERNAL_URL: 'https://central.example.invalid', SETUP_TOKEN: 'test-only-remote-code' };
  const app = createCentral(config);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const endpoint = 'http://127.0.0.1:' + app.server.address().port;
  const account = { name: 'Admin', email: 'admin@example.invalid', password: 'test-only-password-123' };
  const post = (path, body, origin = config.RENDER_EXTERNAL_URL) => fetch(endpoint + path, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await post('/api/setup', account)).status, 403);
  assert.equal((await post('/api/setup', { ...account, setupToken: config.SETUP_TOKEN }, 'http://localhost:3000')).status, 403);
  assert.equal((await post('/api/setup', { ...account, setupToken: config.SETUP_TOKEN })).status, 201);
  const login = await post('/api/login', account);
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /; Secure/);
});
