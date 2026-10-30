import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/incoming-alerts.js',import.meta.url),'utf8').replace("import('/assets/incoming-alerts.mjs')",'Promise.resolve({createIncomingAlerts})');
async function fixture(saved=null){
  let enabledValue=saved,requestCount=0,notes=0,sounds=0,received;
  const handlers={},controls={};
  const button={classList:{toggle(){}},textContent:''},badge={hidden:true,setAttribute(){}};
  const row={dataset:{chat:'c1'},classList:{toggle(name,on){this[name]=on;}},querySelector:()=>badge};
  const context=vm.createContext({
    localMode:false,state:{user:{id:'u1'},incomingCursor:0,conversations:[{id:'c1'}]},
    localStorage:{getItem:()=>enabledValue,setItem:(key,value)=>{enabledValue=value;}},
    window:{AudioContext:class{constructor(){this.state='suspended';this.currentTime=0;}resume(){this.state='running';return Promise.resolve();}createOscillator(){return{frequency:{setValueAtTime(){}},connect(){},start(){sounds++;},stop(){},disconnect(){}};}createGain(){return{gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}},addEventListener(){},focus(){}},
    Notification:class{static permission='granted';static requestPermission(){requestCount++;return Promise.resolve('granted');}constructor(){notes++;}close(){}},
    document:{title:'Domum',getElementById:id=>id==='incoming-alerts'?button:(controls[id]??={}),querySelectorAll:()=>[row],addEventListener:(name,fn)=>{handlers[name]=fn;}},
    createIncomingAlerts:options=>{received=options.onEvents;return{poll(){},reset(){}};},
    setInterval(){},setTimeout(){},toast(){},modal(){},api(){},refresh(){},chooseConversation(){},render(){},act:fn=>fn()
  });
  context.window.Notification=context.Notification;
  vm.runInContext(source,context);await new Promise(resolve=>setImmediate(resolve));
  return{context,handlers,controls,button,row,badge,receive:events=>received(events),saved:()=>enabledValue,requests:()=>requestCount,notes:()=>notes,sounds:()=>sounds};
}

test('avisos ligados por padrão, sem pedir permissão automaticamente, com som após gesto e destaque por conversa',async()=>{
  const f=await fixture();assert.equal(vm.runInContext('window.centralIncomingAlerts.isEnabled()',f.context),true);
  assert.equal(f.requests(),0);f.handlers.pointerdown();await Promise.resolve();
  f.receive([{conversation_id:'c1',message_id:'m1',name:'Contato'}]);
  assert.equal(f.sounds(),1);assert.equal(f.notes(),1);assert.equal(f.badge.textContent,'1');assert.equal(f.row.classList['has-unread'],true);
  vm.runInContext("window.centralIncomingAlerts.seen('c1')",f.context);assert.equal(f.badge.hidden,true);assert.equal(f.requests(),0);
});

test('silenciar persiste após recarregar, conserva avisos visuais e requer ação explícita para pedir permissão',async()=>{
  const f=await fixture();f.handlers.click({target:{closest:()=>true}});f.controls['mute-incoming-alerts'].onclick();
  assert.equal(f.saved(),'false');const reload=await fixture(f.saved());reload.handlers.keydown();await Promise.resolve();
  reload.receive([{conversation_id:'c1',message_id:'m1',name:'Contato'}]);assert.equal(reload.sounds(),0);assert.equal(reload.notes(),0);assert.equal(reload.badge.hidden,false);assert.equal(reload.requests(),0);
  await vm.runInContext('window.centralIncomingAlerts.activate()',reload.context);assert.equal(reload.requests(),1);assert.equal(reload.saved(),'true');
});
