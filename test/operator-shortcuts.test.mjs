import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(){
  const state={user:{id:'operator'},conversations:[{id:'client-a',name:'Cliente A',phone:'5544000000001',status:'open'},{id:'client-b',name:'Cliente B',phone:'5544000000002',status:'open'}]};
  const x={state,signature:'Pessoa A',replyDrafts:new Map(),setInterval(){},signedName:()=>x.signature,esc:s=>String(s),$:()=>null,chooseConversation:id=>{x.chosen=id;},toast:s=>{x.notice=s;},modal:(title,body,label,callback)=>{x.review={title,body,label,callback};},api:()=>{throw Error('No network or sending allowed');}};
  vm.createContext(x);vm.runInContext(readFileSync(new URL('../public/operator-chat.js',import.meta.url),'utf8'),x);
  vm.runInContext("operatorThread={id:'task',conversationId:'client-a',messages:[{id:'suggestion',role:'agent',text:'Podemos conferir o projeto.'}]}",x);
  return x;
}
test('resposta revisada fica no rascunho do cliente da tarefa sem envio automático',async()=>{
  const x=fixture();x.reviewOperatorReply('suggestion');assert.match(x.review.body,/Cliente A/);assert.match(x.review.body,/5544000000001/);
  await x.review.callback(new Map([['text','Posso conferir o projeto.']]));assert.equal(x.chosen,'client-a');assert.equal(x.replyDrafts.get('client-a'),'Posso conferir o projeto.');assert.equal(x.replyDrafts.has('client-b'),false);
});
test('revisão preserva rascunho existente e rejeita mudança de atendente ou conversa encerrada',async()=>{
  const x=fixture();x.replyDrafts.set('client-a','Texto em elaboração');x.reviewOperatorReply('suggestion');
  await assert.rejects(x.review.callback(new Map([['text','Outro texto']])),/rascunho/);assert.equal(x.replyDrafts.get('client-a'),'Texto em elaboração');
  x.replyDrafts.clear();x.signature='Pessoa B';await assert.rejects(x.review.callback(new Map([['text','Outro texto']])),/atendente mudou/);
  x.signature='Pessoa A';x.state.conversations[0].status='closed';await assert.rejects(x.review.callback(new Map([['text','Outro texto']])),/não está aberta/);assert.equal(x.replyDrafts.size,0);
});
