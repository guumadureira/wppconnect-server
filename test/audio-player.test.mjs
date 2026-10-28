import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const code='function preserveAudioPlayers(){'+html.split('function preserveAudioPlayers(){')[1].split('\nfunction render(){')[0];
function fixture(fallback=false){
  let visible=[],notices=[];
  function parent(){
    const container={nodes:[],insertBefore(node,before){node.parentNode?.nodes.splice(node.parentNode.nodes.indexOf(node),1);this.nodes.splice(before?this.nodes.indexOf(before):this.nodes.length,0,node);node.parentNode=this;node.pause();node.currentTime=0;},moveBefore(node,before){const time=node.currentTime,paused=node.paused;this.insertBefore(node,before);node.currentTime=time;node.paused=paused;},remove(){for(const node of this.nodes)node.parentNode=null;this.nodes=[];}};
    if(fallback)delete container.moveBefore;return container;
  }
  function player(key,paused=false,src='/voice'){
    const p=parent(),node={dataset:{playbackKey:key},currentTime:12,paused,ended:false,playbackRate:1.5,volume:.4,muted:true,plays:0,getAttribute:()=>src,pause(){this.paused=true;},play(){this.plays++;this.paused=false;return Promise.resolve();},remove(){this.parentNode.nodes.splice(this.parentNode.nodes.indexOf(this),1);this.parentNode=null;}};
    node.parentNode=p;p.nodes.push(node);return node;
  }
  const context=vm.createContext({$ :()=>({querySelectorAll:()=>visible}),document:{createElement:parent,body:{append(){}}},toast:message=>notices.push(message)});vm.runInContext(code,context);
  return{player,show:items=>visible=items,capture:()=>vm.runInContext('preserveAudioPlayers()',context),notices};
}
test('atualização preserva o mesmo player ativo com tempo, velocidade e volume',()=>{
  const f=fixture(),old=f.player('chat1:message1:file');f.show([old]);const restore=f.capture();
  const replacement=f.player('chat1:message1:file',true);f.show([replacement]);restore();
  assert.ok(old.parentNode);assert.equal(replacement.parentNode,null);assert.equal(old.paused,false);assert.equal(old.currentTime,12);assert.equal(old.playbackRate,1.5);assert.equal(old.volume,.4);assert.equal(old.muted,true);assert.equal(old.plays,0);
});
test('navegador sem movimento atômico retoma somente o áudio que estava tocando',()=>{
  for(const paused of [true,false]){
    const f=fixture(true),old=f.player('chat1:message1:file',paused);f.show([old]);const restore=f.capture();f.show([f.player('chat1:message1:file',true)]);restore();
    assert.equal(old.currentTime,12);assert.equal(old.paused,paused);assert.equal(old.plays,paused?0:1);assert.equal(old.playbackRate,1.5);
  }
});
test('troca de conversa, retirada do anexo ou mudança de origem interrompe o player antigo',()=>{
  for(const target of ['outro-contato','outro-arquivo','sem-player','outra-origem']){
    const f=fixture(),old=f.player('chat1:message1:file');f.show([old]);const restore=f.capture();
    const next=target==='sem-player'?null:f.player(target==='outra-origem'?'chat1:message1:file':target,true,target==='outra-origem'?'/changed':'/voice');f.show(next?[next]:[]);restore();
    assert.equal(old.paused,true);assert.equal(old.plays,0);if(next)assert.equal(next.plays,0);
  }
});
test('reuso de arquivo em duas mensagens mantém posições e controles independentes',()=>{
  const f=fixture(),playing=f.player('chat1:message1:file'),paused=f.player('chat1:message2:file',true);paused.currentTime=4;
  f.show([playing,paused]);const restore=f.capture();f.show([f.player('chat1:message1:file',true),f.player('chat1:message2:file',true)]);restore();
  assert.equal(playing.currentTime,12);assert.equal(playing.paused,false);assert.equal(paused.currentTime,4);assert.equal(paused.paused,true);
});
