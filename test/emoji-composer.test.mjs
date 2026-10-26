import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('emoji substitui a seleção sem enviar e o rascunho sobrevive à atualização da conversa', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/boot\(\);\s*$/, '');
  const root = { innerHTML: '' };
  let focused = false;
  const reply = {
    value: 'Olá cliente', selectionStart: 4, selectionEnd: 11, maxLength: 3900,
    dataset: { chatId: 'c1' }, disabled: false,
    setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); },
    focus() { focused = true; }, addEventListener() {},
  };
  const context = vm.createContext({
    location: { protocol: 'file:' }, localStorage: { getItem: () => null }, setInterval() {},
    document: { querySelector: selector => selector === '#reply' ? reply : selector === '#root' ? root : null, querySelectorAll: () => [] },
  });
  new vm.Script(script).runInContext(context);
  vm.runInContext("state=seed();active='c1';insertEmoji('🏠');render();", context);
  assert.equal(reply.value, 'Olá 🏠');
  assert.equal(focused, true);
  assert.equal(vm.runInContext("replyDrafts.get('c1')", context), 'Olá 🏠');
  assert.match(root.innerHTML, /Olá 🏠<\/textarea>/);
  assert.match(root.innerHTML, /id="emoji-toggle" type="button"/);
  assert.match(root.innerHTML, /type="submit" class="primary"/);
  assert.equal(vm.runInContext("state.messages.filter(message=>message.direction==='out').length", context), 1);
  reply.disabled = true;
  vm.runInContext("insertEmoji('😊')", context);
  assert.equal(reply.value, 'Olá 🏠');
  reply.disabled = false;
  reply.dataset.chatId = 'c2';
  reply.value = 'Rascunho de outra conversa';
  vm.runInContext("replyDrafts.set('c1','Mensagem enviada');replyDrafts.set('c2','Rascunho de outra conversa');finishReplyDraft('c1','Mensagem enviada');", context);
  assert.equal(reply.value, 'Rascunho de outra conversa');
  assert.equal(vm.runInContext("replyDrafts.get('c2')", context), 'Rascunho de outra conversa');
  assert.equal(vm.runInContext("replyDrafts.has('c1')", context), false);
});
