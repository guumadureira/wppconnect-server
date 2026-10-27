import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../public/index.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/boot\(\);\s*$/,'');
function viewport(id,height=1000,client=200){
  let top=0;const handlers={};
  const area={dataset:{conversationId:id},scrollHeight:height,clientHeight:client,
    get scrollTop(){return top;},set scrollTop(value){top=Math.max(0,Math.min(value,this.scrollHeight-this.clientHeight));},
    getBoundingClientRect:()=>({top:0,bottom:client}),addEventListener:(name,fn)=>{handlers[name]=fn;},fire:name=>handlers[name]?.(),
    querySelectorAll:()=>Array.from({length:20},(_,i)=>({dataset:{messageId:'msg-'+i},getBoundingClientRect:()=>({top:i*50-top,bottom:i*50+50-top})}))};
  return area;
}
function setup(){
  let area=null,panel=null,nextArea=null,nextPanel=null,html='',resize;const root={};
  Object.defineProperty(root,'innerHTML',{get:()=>html,set:value=>{html=value;area=nextArea;panel=nextPanel;}});
  const context=vm.createContext({location:{protocol:'https:'},localStorage:{getItem:()=>null},setInterval(){},
    ResizeObserver:class{constructor(fn){resize=fn;}observe(){}disconnect(){}},
    document:{querySelector:selector=>({'#root':root,'.messages':area,'.context-panel':panel})[selector]||null,querySelectorAll:()=>[]}});
  vm.runInContext(code,context);vm.runInContext("state=seed();active='c1';",context);
  return{context,render:(newArea,newPanel=null)=>{nextArea=newArea;nextPanel=newPanel;vm.runInContext('render()',context);},resize:()=>resize?.()};
}
test('abre nas últimas mensagens e continua no final após atualizações e anexos carregarem',()=>{
  const f=setup(),first=viewport('c1');f.render(first);assert.equal(first.scrollTop,800);
  const next=viewport('c1',1200);f.render(next);assert.equal(next.scrollTop,1000);
  next.scrollHeight=1500;f.resize();assert.equal(next.scrollTop,1300);
  next.scrollTop=300;next.fire('scroll');next.scrollHeight=1600;f.resize();assert.equal(next.scrollTop,300);
});
test('preserva leitura anterior, troca de conversa e rolagem do contexto do Notion',()=>{
  const f=setup(),first=viewport('c1'),panel=viewport('c1',800,300);f.render(first,panel);first.scrollTop=250;panel.scrollTop=160;
  const next=viewport('c1',1400),nextPanel=viewport('c1',800,300);f.render(next,nextPanel);assert.equal(next.scrollTop,250);assert.equal(nextPanel.scrollTop,160);
  vm.runInContext("active='c2'",f.context);const other=viewport('c2',900);f.render(other);assert.equal(other.scrollTop,700);
  vm.runInContext("active='c1'",f.context);const back=viewport('c1',1500);f.render(back);assert.equal(back.scrollTop,250);
});
test('resposta enviada volta ao final uma vez, sem forçar o próximo retorno ao histórico',()=>{
  const f=setup(),first=viewport('c1');f.render(first);first.scrollTop=100;
  vm.runInContext("forceLatest.add('c1')",f.context);const sent=viewport('c1',1400);f.render(sent);assert.equal(sent.scrollTop,1200);
  sent.scrollTop=200;sent.fire('scroll');const reread=viewport('c1',1500);f.render(reread);assert.equal(reread.scrollTop,200);
});
