import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCentral } from '../server.mjs';
import { createSignupFlow } from '../public/whatsapp-signup.mjs';

const account = { name: 'Admin', email: 'signup@example.invalid', password: 'test-only-signup-password' };
const eventData = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  data: { waba_id: '5555511111', phone_number_id: '5555522222' } };
const message = (origin = 'https://www.facebook.com', data = eventData) => ({ origin, data: JSON.stringify(data) });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, overrides = {}) {
  const config = { DATABASE_PATH: ':memory:', PUBLIC_ORIGIN: 'https://central.example.invalid', SETUP_TOKEN: 'test-only-install-code',
    WHATSAPP_MODE: 'live', WHATSAPP_PHONE_NUMBER_ID: 'unchanged-test-phone', WHATSAPP_ACCESS_TOKEN: 'test-only-current-token',
    WEBHOOK_VERIFY_TOKEN: 'test-only-webhook-secret', META_APP_SECRET: 'test-only-app-secret', META_GRAPH_VERSION: 'v25.0',
    META_APP_ID: '5555500001', META_LOGIN_CONFIG_ID: '5555500002', META_COEXISTENCE_PHONE_NUMBER: '550000000000', ...overrides };
  const calls = [];
  let mode = 'ok';
  const app = createCentral(config, async (url, options) => {
    calls.push({ url, options });
    if (mode === 'timeout') throw new Error('test-only-secret-must-not-leak');
    if (mode === 'error') return Response.json({ error: { code: 190, message: 'test-only-secret-must-not-leak' } }, { status: 400 });
    if (url.endsWith('/oauth/access_token')) {
      if (mode === 'missing-token') return Response.json({});
      return Response.json({ access_token: 'test-only-exchanged-token' });
    }
    return Response.json({ data: [{ id: mode === 'new-assets' ? '7777722222' : eventData.data.phone_number_id,
      display_phone_number: mode === 'wrong-phone' ? '+55 11 1111-1111' : '+55 00 0000-0000',
      is_on_biz_app: mode !== 'not-business', platform_type: mode === 'on-premise' ? 'ON_PREMISE' : 'CLOUD_API' }] });
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = 'http://127.0.0.1:' + app.server.address().port;
  async function request(path, method = 'GET', body, cookie, origin = config.PUBLIC_ORIGIN) {
    const response = await fetch(base + path, { method,
      headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, body: data, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  await request('/api/setup', 'POST', { ...account, setupToken: config.SETUP_TOKEN });
  const admin = (await request('/api/login', 'POST', account)).cookie;
  const begin = async (cookie = admin) => (await request('/api/whatsapp/signup/start', 'POST', {}, cookie)).body;
  const finish = async (attempt, changes = {}, cookie = admin) => request('/api/whatsapp/signup/complete', 'POST', {
    attemptId: attempt.attemptId, code: 'test-only-one-use-code', wabaId: eventData.data.waba_id,
    phoneNumberId: eventData.data.phone_number_id, ...changes }, cookie);
  return { config, calls, app, request, admin, begin, finish, setMode: value => { mode = value; } };
}

test('cadastro exige administrador, origem correta, HTTPS e configuração completa', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/connect/whatsapp')).status, 401);
  assert.equal((await f.request('/assets/whatsapp-signup.mjs')).status, 401);
  assert.equal((await f.request('/api/whatsapp/signup')).status, 401);
  await f.request('/api/agents', 'POST', { ...account, email: 'agent@example.invalid' }, f.admin);
  const agent = (await f.request('/api/login', 'POST', { ...account, email: 'agent@example.invalid' })).cookie;
  for (const path of ['/connect/whatsapp', '/assets/whatsapp-signup.mjs', '/api/whatsapp/signup']) assert.equal((await f.request(path, 'GET', undefined, agent)).status, 403);
  assert.equal((await f.request('/api/whatsapp/signup/start', 'POST', {}, f.admin, 'https://attacker.invalid')).status, 403);
  const page = await f.request('/connect/whatsapp', 'GET', undefined, f.admin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /https:\/\/connect.facebook.net/);
  const normal = await f.request('/');
  assert.doesNotMatch(normal.headers.get('content-security-policy'), /facebook/);
  for (const [key, value] of [['WHATSAPP_MODE', 'demo'], ['PUBLIC_ORIGIN', 'http://central.example.invalid'], ['META_LOGIN_CONFIG_ID', 'not-an-id']]) {
    const previous = f.config[key]; f.config[key] = value;
    const status = await f.request('/api/whatsapp/signup', 'GET', undefined, f.admin);
    assert.equal(status.body.available, false);
    assert.equal((await f.request('/api/whatsapp/signup/start', 'POST', {}, f.admin)).status, 409);
    f.config[key] = previous;
  }
  delete f.config.META_APP_SECRET;
  const status = await f.request('/api/whatsapp/signup', 'GET', undefined, f.admin);
  assert.deepEqual(status.body.missing, ['META_APP_SECRET']);
  assert.equal(f.calls.length, 0);
});

test('código só é trocado uma vez e pertence à sessão que iniciou o cadastro', async t => {
  const f = await fixture(t);
  const attempt = await f.begin();
  const otherSession = (await f.request('/api/login', 'POST', account)).cookie;
  assert.equal((await f.finish(attempt, {}, otherSession)).status, 409);
  assert.equal(f.calls.length, 0);
  const result = await f.finish(attempt);
  assert.equal(result.status, 200);
  assert.equal(result.body.authorizationChecked, true);
  assert.equal(result.body.activationPending, true);
  assert.equal(result.body.connectionVerified, false);
  assert.equal((await f.finish(attempt)).status, 409);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].url.endsWith('/oauth/access_token'));
  assert.equal(f.calls[0].options.method, 'POST');
  assert.equal(new URLSearchParams(f.calls[0].options.body).get('client_id'), f.config.META_APP_ID);
  assert.equal(f.calls[1].options.headers.authorization, 'Bearer test-only-exchanged-token');
  assert.equal(f.config.WHATSAPP_PHONE_NUMBER_ID, 'unchanged-test-phone');
  assert.equal(f.config.WHATSAPP_ACCESS_TOKEN, 'test-only-current-token');
  const stored = f.app.db.prepare('SELECT * FROM whatsapp_signup_checks').all();
  assert.equal(stored.length, 1);
  const publicData = JSON.stringify({ result, stored, status: (await f.request('/api/whatsapp/signup', 'GET', undefined, f.admin)).body, attempt });
  for (const secret of ['test-only-one-use-code', 'test-only-exchanged-token', 'test-only-app-secret', 'test-only-current-token']) assert.ok(!publicData.includes(secret));
  assert.ok(f.calls.every(call => !/\/(register|deregister|messages|subscribed_apps)(\?|$)/.test(call.url)));
});

test('cadastro rejeita identificadores malformados antes de consultar a Meta e invalida tentativas antigas', async t => {
  const f = await fixture(t);
  for (const changes of [{ phoneNumberId: '../wrong' }, { wabaId: 'bad/asset' }]) assert.equal((await f.finish(await f.begin(), changes)).status, 400);
  const old = await f.begin();
  await f.begin();
  assert.equal((await f.finish(old)).status, 409);
  assert.equal(f.calls.length, 0);
});

test('tentativas expiradas e dois retornos concorrentes não reutilizam o código', async t => {
  const f = await fixture(t);
  const originalNow = Date.now;
  const now = originalNow();
  try {
    Date.now = () => now - 11 * 60000;
    const expired = await f.begin();
    Date.now = originalNow;
    assert.equal((await f.finish(expired)).status, 409);
    assert.equal(f.calls.length, 0);
  } finally { Date.now = originalNow; }
  const attempt = await f.begin();
  const result = await Promise.all([f.finish(attempt), f.finish(attempt)]);
  assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.calls.length, 2);
});

test('erros da Meta, outro telefone e ausência de coexistência nunca concluem cadastro nem expõem segredos', async t => {
  const f = await fixture(t);
  for (const mode of ['timeout', 'error', 'missing-token', 'on-premise', 'not-business', 'wrong-phone']) {
    f.setMode(mode);
    const result = await f.finish(await f.begin());
    assert.equal(result.status, ['on-premise', 'not-business', 'wrong-phone'].includes(mode) ? 409 : 502);
    assert.ok(!JSON.stringify(result.body).includes('test-only-'));
    assert.equal(f.app.db.prepare('SELECT COUNT(*) AS n FROM whatsapp_signup_checks').get().n, 0);
    assert.equal(f.config.WHATSAPP_PHONE_NUMBER_ID, 'unchanged-test-phone');
  }
});

test('confere o telefone real pela Meta mesmo quando os identificadores dos ativos mudam', async t => {
  const f = await fixture(t);
  f.setMode('new-assets');
  const result = await f.finish(await f.begin(), { wabaId: '7777711111', phoneNumberId: '7777722222' });
  assert.equal(result.status, 200);
  assert.ok(f.calls[1].url.includes('/7777711111/phone_numbers'));
  const stored = f.app.db.prepare('SELECT * FROM whatsapp_signup_checks').get();
  assert.equal(stored.waba_id, '7777711111');
  assert.equal(stored.phone_number_id, '7777722222');
  assert.equal(f.config.WHATSAPP_PHONE_NUMBER_ID, 'unchanged-test-phone');
});

test('navegador espera código e evento em qualquer ordem e ignora origem falsa, eventos duplicados e cancelamento', async () => {
  for (const eventFirst of [true, false]) {
    const calls = [], notices = [];
    const flow = createSignupFlow({ complete: async body => { calls.push(body); return { message: 'Autorização conferida; ativação pendente.' }; }, notify: text => notices.push(text) });
    flow.message(message());
    flow.begin({ attemptId: 'attempt' });
    flow.message(message('https://evilfacebook.com'));
    flow.message(message('http://www.facebook.com'));
    flow.message(message('https://www.facebook.com.attacker.invalid'));
    flow.message(message('https://www.facebook.com', { ...eventData, event: 'FINISH_ONLY_WABA' }));
    flow.message({ origin: 'https://www.facebook.com', data: 'malformed-json' });
    const login = () => flow.login({ authResponse: { code: 'private-code' } });
    if (eventFirst) flow.message(message()); else login();
    assert.equal(calls.length, 0);
    if (eventFirst) login(); else flow.message(message());
    flow.message(message()); login();
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].phoneNumberId, eventData.data.phone_number_id);
    assert.ok(!JSON.stringify(notices).includes('private-code'));
    flow.begin({ attemptId: 'next' });
    flow.message(message('https://www.facebook.com', { type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { error_message: 'private-value' } }));
    login(); flow.message(message()); await settle();
    assert.equal(calls.length, 1);
    assert.ok(!JSON.stringify(notices).includes('private-value'));
  }
});
