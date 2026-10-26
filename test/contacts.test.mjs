import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCentral } from '../server.mjs';

async function start(config = { DATABASE_PATH: ':memory:' }, transport) {
  const app = createCentral(config, transport || (async () => { throw new Error('External request forbidden'); }));
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  config.PUBLIC_ORIGIN = 'http://127.0.0.1:' + app.server.address().port;
  async function request(path, method = 'GET', body, cookie, origin = config.PUBLIC_ORIGIN) {
    const response = await fetch(config.PUBLIC_ORIGIN + path, {
      method, headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  return { app, request };
}
const admin = { name: 'Admin', email: 'admin@example.invalid', password: 'test-only-password' };
const contact = { name: 'Cliente de teste', phone: '+55 (44) 99999-0000', email: 'client@example.invalid', notes: 'Projeto fictício' };

test('contatos normalizam telefone, rejeitam duplicação e preservam conversa ao editar', async t => {
  const { app, request } = await start();
  t.after(() => app.close());
  await request('/api/setup', 'POST', admin);
  const { cookie } = await request('/api/login', 'POST', admin);
  assert.equal((await request('/api/contacts')).status, 401);
  assert.equal((await request('/api/contacts', 'POST', contact, cookie, 'https://invalid.example')).status, 403);
  const saved = await request('/api/contacts', 'POST', contact, cookie);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.contact.phone, '5544999990000');
  assert.equal((await request('/api/contacts', 'POST', { ...contact, phone: '5544999990000' }, cookie)).status, 409);
  for (const invalid of [{ phone: '44' }, { phone: 'invalid' }, { name: '' }, { email: 'invalid' }, { notes: 'x'.repeat(2001) }]) {
    assert.equal((await request('/api/contacts', 'POST', { ...contact, ...invalid }, cookie)).status, 400);
  }
  const opened = await request('/api/conversations', 'POST', { contactId: saved.body.contact.id }, cookie);
  assert.equal(opened.status, 201);
  assert.equal(opened.body.conversation.pending_since, null);
  assert.equal(opened.body.conversation.last_inbound, null);
  const same = await request('/api/conversations', 'POST', { contactId: saved.body.contact.id }, cookie);
  assert.equal(same.status, 200);
  assert.equal(same.body.conversation.id, opened.body.conversation.id);
  const path = '/api/contacts/' + saved.body.contact.id;
  assert.equal((await request(path, 'PATCH', { ...contact, name: 'Nome salvo pelo atendente' }, cookie)).status, 200);
  assert.equal((await request(path, 'PATCH', { ...contact, phone: '+55 44 98888-0000' }, cookie)).status, 400);
  const state = (await request('/api/state', 'GET', undefined, cookie)).body;
  assert.equal(state.contacts.length, 1);
  assert.equal(state.conversations.length, 1);
  assert.equal(state.conversations[0].name, 'Nome salvo pelo atendente');
  assert.equal(state.messages.length, 0);
});

test('cadastro de contato não abre janela de envio real nem chama a Meta', async t => {
  let externalCalls = 0;
  const config = { DATABASE_PATH: ':memory:', WHATSAPP_MODE: 'live', WHATSAPP_PHONE_NUMBER_ID: 'test-phone', WHATSAPP_ACCESS_TOKEN: 'test-only-token', META_APP_SECRET: 'test-only-secret', WEBHOOK_VERIFY_TOKEN: 'test-only-verify', META_GRAPH_VERSION: 'v25.0' };
  const { app, request } = await start(config, async () => { externalCalls++; throw new Error('External request forbidden'); });
  t.after(() => app.close());
  await request('/api/setup', 'POST', admin);
  const { cookie } = await request('/api/login', 'POST', admin);
  const saved = await request('/api/contacts', 'POST', contact, cookie);
  const opened = await request('/api/conversations', 'POST', { contactId: saved.body.contact.id }, cookie);
  const sent = await request('/api/conversations/' + opened.body.conversation.id + '/messages', 'POST', { text: 'Não enviar', requestId: 'blocked-new-contact' }, cookie);
  assert.equal(sent.status, 409);
  assert.equal(externalCalls, 0);
  app.intake({ metadata: { phone_number_id: 'test-phone' }, contacts: [{ wa_id: '5544999990000', profile: { name: 'Nome do perfil' } }], messages: [{ id: 'incoming-contact', from: '5544999990000', type: 'text', text: { body: 'Olá 😊' }, timestamp: Math.floor(Date.now() / 1000) }] });
  const state = (await request('/api/state', 'GET', undefined, cookie)).body;
  assert.equal(state.messages[0].body, 'Olá 😊');
  assert.equal(state.conversations[0].name, contact.name);
});

test('contatos salvos persistem junto das contas ao reiniciar o banco existente', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'central-contacts-'));
  const config = { DATABASE_PATH: join(dir, 'central.sqlite') };
  let running;
  try {
    running = await start(config);
    await running.request('/api/setup', 'POST', admin);
    const { cookie } = await running.request('/api/login', 'POST', admin);
    const saved = await running.request('/api/contacts', 'POST', contact, cookie);
    await running.app.close();
    running = null;
    running = await start(config);
    const contacts = await running.request('/api/contacts', 'GET', undefined, cookie);
    assert.equal(contacts.status, 200);
    assert.equal(contacts.body.contacts[0].id, saved.body.contact.id);
    assert.equal(contacts.body.contacts[0].notes, contact.notes);
    assert.equal((await running.request('/api/session')).body.setupRequired, false);
  } finally {
    if (running) await running.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
