import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('Enter envia uma vez; Shift+Enter, composição e preferência desligada preservam a edição', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const code = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/boot\(\);\s*$/, '');
  let submits = 0, prevented = 0;
  const button = { disabled: false };
  const form = { querySelector: () => button, requestSubmit: submitter => { assert.equal(submitter, button); submits++; } };
  const context = vm.createContext({
    location: { protocol: 'https:' },
    document: { querySelector: selector => selector === '#reply-form' ? form : null },
    localStorage: { getItem: () => null },
    setInterval: () => {},
  });
  new vm.Script(code).runInContext(context);
  const key = vm.runInContext('handleReplyKey', context);
  const event = extra => ({ key: 'Enter', target: { disabled: false }, preventDefault: () => { prevented++; }, ...extra });
  key(event());
  assert.equal(submits, 1);
  assert.equal(prevented, 1);
  for (const extra of [{ shiftKey: true }, { isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { key: 'a' }]) key(event(extra));
  assert.equal(submits, 1);
  assert.equal(prevented, 1);
  vm.runInContext('sendWithEnter=false', context);
  key(event());
  assert.equal(prevented, 1);
  vm.runInContext('sendWithEnter=true;sending=true', context);
  key(event());
  assert.equal(submits, 1);
  vm.runInContext('sending=false', context);
  button.disabled = true;
  key(event());
  assert.equal(submits, 1);
});
