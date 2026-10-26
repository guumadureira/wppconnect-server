import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const code=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/boot\(\);\s*$/,'');
function setup(){
  const root={innerHTML:''},events={};
  const reply={value:'Legenda de teste',dataset:{chatId:'c1'},addEventListener(){}};
  const form={addEventListener:(event,callback)=>{events[event]=callback;}};
  const context=vm.createContext({location:{protocol:'https:'},localStorage:{getItem:()=>null},setInterval(){},
    document:{querySelector:selector=>selector==='#root'?root:selector==='#reply'?reply:selector==='#reply-form'?form:null,querySelectorAll:()=>[]},
  });
  new vm.Script(code).runInContext(context);
  vm.runInContext("state=seed();active='c1';",context);
  return {context,root,reply,events};
}

test('anexos são escapados, prévia fica na conversa certa e renderizar não envia arquivos',()=>{
  const {context,root}=setup();
  vm.runInContext(`
    globalThis.prepared={id:'00000000-0000-4000-8000-000000000001',name:'<arquivo>.png',kind:'image',mime:'image/png',state:'ready',size:100,url:'https://other.invalid/file'};
    attachmentDrafts.set('c1',prepared);render();
  `,context);
  assert.match(root.innerHTML,/Pronto para enviar: &lt;arquivo&gt;.png/);
  assert.match(root.innerHTML,/id="attach-file"/);
  assert.match(root.innerHTML,/id="saved-stickers"/);
  assert.doesNotMatch(root.innerHTML,/https:\/\/other.invalid/);
  assert.match(root.innerHTML,/\/api\/media\/00000000-0000-4000-8000-000000000001\/content/);
  assert.match(root.innerHTML,/\?download=1/);
  assert.equal(vm.runInContext("state.messages.filter(m=>m.direction==='out').length",context),1);
  vm.runInContext("active='c2';render();",context);assert.doesNotMatch(root.innerHTML,/Pronto para enviar/);
  vm.runInContext("active='c1';render();",context);assert.match(root.innerHTML,/Pronto para enviar/);
  assert.equal(vm.runInContext("replyDrafts.get('c1')",context),'Legenda de teste');
  const pending=vm.runInContext("attachmentMarkup({...prepared,state:'error',error:'<erro>'})",context);
  assert.match(pending,/&lt;erro&gt;/);assert.match(pending,/Tentar baixar novamente/);assert.doesNotMatch(pending,/<img /);
});

test('confirmar envio usa o anexo da conversa capturada e preserva o anexo de outra conversa',async()=>{
  const {context,events}=setup();
  vm.runInContext(`
    attachmentDrafts.set('c1',{id:'attachment-a',name:'a.png',kind:'image'});
    attachmentDrafts.set('c2',{id:'attachment-b',name:'b.png',kind:'image'});
    globalThis.requests=[];globalThis.task=null;
    act=callback=>{task=callback();};
    api=async(path,method,body)=>{requests.push({path,method,body});active='c2';return {message:{status:'sent'}};};
    refresh=async()=>{};bindView();
  `,context);
  events.submit({preventDefault(){},submitter:{disabled:false}});
  await vm.runInContext('task',context);
  assert.equal(vm.runInContext('requests.length',context),1);
  assert.equal(vm.runInContext('requests[0].body.attachmentId',context),'attachment-a');
  assert.match(vm.runInContext('requests[0].path',context),/conversations\/c1\/messages/);
  assert.equal(vm.runInContext("attachmentDrafts.has('c1')",context),false);
  assert.equal(vm.runInContext("attachmentDrafts.get('c2').id",context),'attachment-b');
});
