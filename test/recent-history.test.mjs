import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/boot\(\);\s*$/, '');
const now = Date.UTC(2026, 9, 26, 12);
const day = 86400000;
function setup() {
  const root = { innerHTML: '' };
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    location: { protocol: 'file:' }, localStorage: { getItem: () => null }, setInterval() {},
    document: { querySelector: selector => selector === '#root' ? root : null, querySelectorAll: () => [] },
  });
  new vm.Script(code).runInContext(context);
  vm.runInContext('state=seed();', context);
  return { context, root };
}

test('período de 15 dias considera mensagens, sem confundir edição administrativa com atendimento recente', () => {
  const { context } = setup();
  const select = vm.runInContext('conversationsInPeriod', context);
  const conversations = [
    { id: 'old', updated: now, last_inbound: now - 20 * day },
    { id: 'boundary', updated: now - 15 * day },
    { id: 'outbound', updated: now - 30 * day },
    { id: 'contact', updated: now },
  ];
  const messages = [
    { conversation_id: 'old', created: now - 20 * day },
    { conversation_id: 'boundary', created: now - 15 * day },
    { conversation_id: 'outbound', created: now - day, direction: 'out' },
  ];
  const before = JSON.stringify({ conversations, messages });
  assert.deepEqual(Array.from(select(conversations, messages, 15, now), c => c.id), ['boundary', 'outbound', 'contact']);
  assert.equal(select(conversations, messages, 0, now).length, 4);
  assert.equal(JSON.stringify({ conversations, messages }), before);
});

test('filtro e histórico anterior preservam mensagens e deixam pendências antigas acessíveis', () => {
  const { context, root } = setup();
  vm.runInContext(`
    state.conversations[0].updated=Date.now();
    state.messages.filter(m=>m.conversation_id==='c1').forEach(m=>m.created=Date.now()-20*86400000);
    state.conversations[1].status='closed';
    state.messages.unshift({id:'old-c3',conversation_id:'c3',body:'Mensagem anterior preservada',created:Date.now()-20*86400000,direction:'in',status:'received'});
    active='c3';render();
  `, context);
  assert.match(root.innerHTML, /Últimos 15 dias/);
  assert.doesNotMatch(root.innerHTML, /data-chat="c1"/);
  assert.doesNotMatch(root.innerHTML, /data-chat="c2"/);
  assert.match(root.innerHTML, /data-chat="c3"/);
  assert.match(root.innerHTML, /id="show-older-messages"/);
  assert.doesNotMatch(root.innerHTML, /Mensagem anterior preservada/);
  const count = vm.runInContext('state.messages.length', context);
  vm.runInContext("expandedHistory.add('c3');render();", context);
  assert.match(root.innerHTML, /Mensagem anterior preservada/);
  vm.runInContext("chooseConversation('c1');", context);
  assert.equal(vm.runInContext('historyDays', context), 0);
  assert.match(root.innerHTML, /data-chat="c1"/);
  vm.runInContext('setHistoryPeriod(15);', context);
  assert.doesNotMatch(root.innerHTML, /data-chat="c1"/);
  assert.equal(vm.runInContext('state.messages.length', context), count);
  assert.equal(vm.runInContext("state.conversations.find(c=>c.id==='c1').pending_since!==null", context), true);
});

test('período mantém filtros de status e busca, e não remove a seleção Todas ao abrir conversa', () => {
  const { context, root } = setup();
  vm.runInContext("filter='all';chooseConversation('c2');", context);
  assert.equal(vm.runInContext('filter', context), 'all');
  vm.runInContext("query='Mariana';render();", context);
  assert.match(root.innerHTML, /data-chat="c1"/);
  assert.doesNotMatch(root.innerHTML, /data-chat="c2"/);
  vm.runInContext("state.mode='live';query='inexistente';render();", context);
  assert.match(root.innerHTML, /Nenhuma conversa neste filtro/);
  assert.match(root.innerHTML, /histórico do celular ainda não é importado/);
  assert.equal(vm.runInContext('active', context), null);
  assert.equal(vm.runInContext('mobileChat', context), false);
});
