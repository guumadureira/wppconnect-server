import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../public/index.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/boot\(\);\s*$/,'');
function setup(){
  let html='',reply,focused;const root={};
  const makeReply=(chatId,value)=>({id:'reply',tagName:'TEXTAREA',dataset:{chatId},value,disabled:false,selectionStart:0,selectionEnd:0,selectionDirection:'none',scrollTop:0,addEventListener(){},focus(){focused=this;},setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;}});
  Object.defineProperty(root,'innerHTML',{get:()=>html,set:value=>{html=value;const match=value.match(/<textarea id="reply" data-chat-id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/);reply=match?makeReply(match[1],match[2]):null;focused=null;}});
  const document={get activeElement(){return focused;},querySelector:s=>s==='#root'?root:s==='#reply'?reply:null,querySelectorAll:()=>[],getElementById:id=>id==='reply'?reply:null};
  const context=vm.createContext({document,location:{protocol:'file:'},localStorage:{getItem:()=>null},setInterval(){}});vm.runInContext(code,context);vm.runInContext("state=seed();active='c1';render();",context);
  return{context,get reply(){return reply;},get focused(){return focused;}};
}
test('renderização preserva foco, seleção e rascunho atuais do compositor',()=>{
  const f=setup();f.reply.value='Texto enquanto a central atualiza';f.reply.selectionStart=6;f.reply.selectionEnd=14;f.reply.selectionDirection='backward';f.reply.scrollTop=20;f.reply.focus();
  vm.runInContext('render()',f.context);
  assert.equal(f.focused,f.reply);assert.equal(f.reply.value,'Texto enquanto a central atualiza');assert.equal(f.reply.selectionStart,6);assert.equal(f.reply.selectionEnd,14);assert.equal(f.reply.selectionDirection,'backward');assert.equal(f.reply.scrollTop,20);
});
test('trocar conversa não copia texto nem transfere foco de um contato para outro',()=>{
  const f=setup();f.reply.value='Rascunho c1';f.reply.focus();vm.runInContext("chooseConversation('c2')",f.context);
  assert.equal(f.reply.dataset.chatId,'c2');assert.equal(f.reply.value,'');assert.equal(f.focused,null);
  f.reply.value='Rascunho c2';f.reply.focus();vm.runInContext('render()',f.context);assert.equal(f.focused,f.reply);assert.equal(f.reply.value,'Rascunho c2');
  assert.equal(vm.runInContext("replyDrafts.get('c1')",f.context),'Rascunho c1');
});
