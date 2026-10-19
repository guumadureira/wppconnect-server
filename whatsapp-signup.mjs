import { randomBytes, createHash } from 'node:crypto';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const digest = value => createHash('sha256').update(value).digest('hex');
const numericId = value => typeof value === 'string' && /^\d{5,30}$/.test(value);
const required = ['META_APP_ID', 'META_LOGIN_CONFIG_ID', 'META_APP_SECRET', 'META_GRAPH_VERSION', 'META_COEXISTENCE_WABA_ID', 'META_COEXISTENCE_PHONE_NUMBER_ID'];

// Preparation only: never register, migrate, subscribe, send, or replace credentials.
// Authorization codes and the exchanged token are not persisted or returned.
export function createWhatsAppSignup(config, db, transport) {
  db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_signup_checks(
    id INTEGER PRIMARY KEY CHECK(id=1),waba_id TEXT NOT NULL,phone_number_id TEXT NOT NULL,
    display_phone_number TEXT NOT NULL,checked_at INTEGER NOT NULL
  )`);
  const attempts = new Map();
  function status(origin) {
    const missing = required.filter(name => !config[name]);
    const invalid = required.filter(name => name !== 'META_APP_SECRET' && config[name] &&
      !(name === 'META_GRAPH_VERSION' ? /^v\d{1,2}\.\d+$/.test(config[name]) : numericId(config[name])));
    const publicHttps = new URL(origin).protocol === 'https:';
    return { available: !missing.length && !invalid.length && publicHttps && config.WHATSAPP_MODE === 'live',
      missing, invalid, publicHttps, mode: config.WHATSAPP_MODE === 'live' ? 'live' : 'demo',
      authorizationCheck: db.prepare('SELECT waba_id,phone_number_id,display_phone_number,checked_at FROM whatsapp_signup_checks WHERE id=1').get() || null,
      activationPending: true, connectionVerified: false };
  }
  function start(session, origin) {
    if (!status(origin).available) fail(409, 'O cadastro precisa de modo real, HTTPS e configuração completa no servidor.');
    const now = Date.now();
    for (const [key, item] of attempts) if (item.expires <= now || item.session === session) attempts.delete(key);
    if (attempts.size >= 100) fail(429, 'Há muitos cadastros em andamento. Tente novamente mais tarde.');
    const attemptId = randomBytes(32).toString('hex');
    const expiresAt = now + 10 * 60000;
    attempts.set(digest(attemptId), { session, expires: expiresAt });
    return { attemptId, expiresAt, appId: config.META_APP_ID, graphVersion: config.META_GRAPH_VERSION,
      login: { config_id: config.META_LOGIN_CONFIG_ID, response_type: 'code', override_default_response_type: true,
        extras: { sessionInfoVersion: '3', version: 'v4', featureType: 'whatsapp_business_app_onboarding' } } };
  }
  async function graph(url, options) {
    try {
      const response = await transport(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok || result?.error) {
        const code = Number.isInteger(result?.error?.code) ? ` (código ${result.error.code})` : '';
        fail(502, `A Meta recusou a conferência da autorização${code}.`);
      }
      return result;
    } catch (error) {
      if (error.status) throw error;
      fail(502, 'Não foi possível confirmar a autorização na Meta. Inicie uma nova tentativa.');
    }
  }
  async function complete(session, origin, body) {
    if (!status(origin).available) fail(409, 'O cadastro ainda não está configurado.');
    if (typeof body.attemptId !== 'string' || !/^[a-f0-9]{64}$/.test(body.attemptId)) fail(400, 'Tentativa de cadastro inválida.');
    const key = digest(body.attemptId), attempt = attempts.get(key);
    if (!attempt || attempt.session !== session || attempt.expires <= Date.now()) fail(409, 'O cadastro expirou ou pertence a outra sessão. Inicie novamente.');
    // Consume before any await: a code is never exchanged twice, including retries.
    attempts.delete(key);
    if (body.wabaId !== config.META_COEXISTENCE_WABA_ID || body.phoneNumberId !== config.META_COEXISTENCE_PHONE_NUMBER_ID) fail(400, 'A conta ou o número escolhido é diferente do autorizado para esta central.');
    if (typeof body.code !== 'string' || !body.code.trim() || body.code.length > 4096) fail(400, 'A Meta não retornou um código de autorização válido.');
    const root = `https://graph.facebook.com/${config.META_GRAPH_VERSION}`;
    const result = await graph(`${root}/oauth/access_token`, { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.META_APP_ID, client_secret: config.META_APP_SECRET, code: body.code }).toString() });
    if (typeof result?.access_token !== 'string' || !result.access_token || result.access_token.length > 16384) fail(502, 'A Meta não retornou uma autorização válida.');
    const numbers = await graph(`${root}/${config.META_COEXISTENCE_WABA_ID}/phone_numbers?fields=id,display_phone_number,platform_type,is_on_biz_app&limit=100`, {
      method: 'GET', headers: { authorization: `Bearer ${result.access_token}` } });
    const phone = Array.isArray(numbers?.data) && numbers.data.find(item => item.id === config.META_COEXISTENCE_PHONE_NUMBER_ID);
    if (!phone || phone.is_on_biz_app !== true || phone.platform_type !== 'CLOUD_API') fail(409, 'A Meta ainda não confirmou esse número no Business e na Cloud API por coexistência. A conexão atual foi preservada.');
    const checkedAt = Date.now();
    const display = typeof phone.display_phone_number === 'string' && /^[+\d\s()-]{5,40}$/.test(phone.display_phone_number) ? phone.display_phone_number : '';
    db.prepare(`INSERT INTO whatsapp_signup_checks(id,waba_id,phone_number_id,display_phone_number,checked_at) VALUES(1,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET waba_id=excluded.waba_id,phone_number_id=excluded.phone_number_id,display_phone_number=excluded.display_phone_number,checked_at=excluded.checked_at`)
      .run(config.META_COEXISTENCE_WABA_ID, phone.id, display, checkedAt);
    return { authorizationChecked: true, activationPending: true, connectionVerified: false,
      phoneNumber: display, checkedAt,
      message: 'Autorização conferida. O número de atendimento da central foi preservado. A ativação é uma etapa separada; envio e recebimento ainda precisam ser validados.' };
  }
  return { status, start, complete };
}
