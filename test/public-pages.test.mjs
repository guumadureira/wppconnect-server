import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCentral } from '../server.mjs';

test('informações de privacidade são públicas sem expor dados ou abrir APIs privadas', async t => {
  let externalCalls = 0;
  const app = createCentral({DATABASE_PATH:':memory:',META_APP_SECRET:'test-private-secret'}, async () => { externalCalls++; throw new Error('External call forbidden'); });
  t.after(() => app.close());
  app.db.prepare('INSERT INTO agents(id,name,email,password,role) VALUES(?,?,?,?,?)').run('private-agent','Private person','private@example.invalid','test-private-hash','admin');
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  for (const path of ['/sobre','/privacidade','/exclusao-de-dados']) {
    const response = await fetch(base+path);
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/text\/html/);
    assert.equal(response.headers.get('set-cookie'),null);
    assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
    const html = await response.text();
    assert.match(html,/Rodrigues &amp; Madureira LTDA/);
    assert.match(html,/mailto:domumenge@outlook.com/);
    assert.doesNotMatch(html,/<script|test-private|Private person|private@example.invalid/);
    const head = await fetch(base+path,{method:'HEAD'});
    assert.equal(head.status,200);
    assert.equal(await head.text(),'');
  }
  assert.equal((await fetch(base+'/api/state')).status,401);
  assert.equal((await fetch(base+'/connect/whatsapp')).status,401);
  assert.equal(externalCalls,0);
});

test('ícone público é PNG quadrado válido para o cadastro Meta', async t => {
  const app = createCentral({DATABASE_PATH:':memory:'});
  t.after(() => app.close());
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  const response = await fetch('http://127.0.0.1:'+app.server.address().port+'/assets/app-icon.png');
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'image/png');
  const png = Buffer.from(await response.arrayBuffer());
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),1024);
  assert.equal(png.readUInt32BE(20),1024);
  assert.ok(png.length < 5*1024*1024);
});

test('logos oficiais da Domum são servidos como imagens sem abrir arquivos arbitrários', async t => {
  const app = createCentral({ DATABASE_PATH: ':memory:' });
  t.after(() => app.close());
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  for (const name of ['domum-wordmark-dark.png', 'domum-wordmark-light.png', 'domum-symbol.png']) {
    const response = await fetch(base + '/assets/' + name);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await response.arrayBuffer());
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(png.length > 1000);
  }
  assert.equal((await fetch(base + '/assets/server.mjs')).status, 404);
});
