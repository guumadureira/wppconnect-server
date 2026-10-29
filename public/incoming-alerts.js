// Runs independently of the conversation refresh, including while writing or in a dialog.
(()=>{
  let audio=null,enabled=false,unseen=[],failed=false;
  const baseTitle=document.title;
  try{enabled=localStorage.getItem('domum-incoming-alerts')==='true';}catch{}
  const session=()=>!localMode&&state?.user?state.user.id:null;
  function update(){
    const button=document.getElementById('incoming-alerts');if(!button)return;
    const ready=enabled&&audio?.state==='running';
    button.textContent=unseen.length?unseen.length+' novas mensagens':failed?'Avisos sem conexão':ready?'Avisos ativos':'Ativar avisos';
    button.classList.toggle('has-new-messages',unseen.length>0);
    button.title=failed?'Aguardando reconexão para buscar mensagens.':'Sons e notificações de todas as mensagens recebidas, mesmo com a IA atendendo.';
    document.title=unseen.length?'('+unseen.length+') Novas mensagens · Domum':baseTitle;
  }
  function sound(){
    if(!enabled||audio?.state!=='running')return;
    try{
      const oscillator=audio.createOscillator(),gain=audio.createGain(),at=audio.currentTime;
      oscillator.type='sine';oscillator.frequency.setValueAtTime(740,at);oscillator.frequency.setValueAtTime(990,at+.12);
      gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.12,at+.015);gain.gain.exponentialRampToValueAtTime(.001,at+.36);
      oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(at);oscillator.stop(at+.38);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
    }catch{}
  }
  async function activate(){
    enabled=true;try{localStorage.setItem('domum-incoming-alerts','true');}catch{}
    const Context=window.AudioContext||window.webkitAudioContext;
    if(Context){audio=audio||new Context();audio.onstatechange=update;audio.resume().then(sound).catch(()=>{});}
    let permission='unsupported';
    try{if('Notification'in window)permission=await Notification.requestPermission();}catch{}
    if(permission==='granted')try{const note=new Notification('Avisos da Central ativados',{body:'Este é um aviso de teste.',tag:'domum-alert-test',silent:true});setTimeout(()=>note.close(),5000);}catch{}
    update();
    toast(permission==='granted'?'Avisos ativados. Mantenha a aba aberta, mesmo minimizada.':'Som ativado quando permitido pelo navegador. Para avisos do sistema, permita notificações nas configurações do site.');
  }
  async function openConversation(id){
    window.focus();await refresh();
    if(!state?.conversations.some(c=>c.id===id))return;
    unseen=unseen.filter(e=>e.conversation_id!==id);view='inbox';chooseConversation(id);render();update();
  }
  function received(events){
    failed=false;unseen.push(...events);update();sound();
    toast(events.length===1?'Nova mensagem de '+events[0].name:events.length+' novas mensagens recebidas.');
    if(enabled&&'Notification'in window&&Notification.permission==='granted'){
      const latest=events.at(-1);
      try{
        const note=new Notification(events.length===1?'Nova mensagem · Domum':events.length+' novas mensagens · Domum',{
          body:events.length===1?latest.name:'Clique para abrir a conversa mais recente.',tag:'domum-message-'+latest.message_id,icon:'/assets/domum-symbol.png',silent:true
        });
        note.onclick=()=>{note.close();openConversation(latest.conversation_id).catch(e=>toast(e.message,true));};
      }catch{}
    }
  }
  window.centralIncomingAlerts={update,activate,isEnabled:()=>enabled,seen(id){unseen=unseen.filter(e=>e.conversation_id!==id);update();}};
  document.addEventListener('click',event=>{
    if(!event.target.closest('#incoming-alerts'))return;
    modal('Avisos de mensagens','<p>Toda mensagem recebida gera um aviso, inclusive quando a IA responde. Mantenha esta aba aberta ou minimizada.</p><p>Após recarregar, ative o som novamente se o navegador pedir. Computador suspenso ou aba descartada podem atrasar os avisos.</p><button type="button" id="test-incoming-alerts">Ativar e testar som e avisos</button><button type="button" id="mute-incoming-alerts">Silenciar som e avisos do sistema</button>'+(unseen.length?'<button type="button" id="open-latest-alert">Abrir última conversa ('+unseen.length+' mensagens)</button>':''),'Fechar',async()=>{});
    document.getElementById('test-incoming-alerts').onclick=()=>activate().catch(e=>toast(e.message,true));
    document.getElementById('mute-incoming-alerts').onclick=()=>{enabled=false;try{localStorage.removeItem('domum-incoming-alerts');}catch{}update();toast('Avisos visuais continuam ativos. Som e notificações do sistema silenciados.');};
    const open=document.getElementById('open-latest-alert');if(open)open.onclick=()=>{document.getElementById('dialog').close();openConversation(unseen.at(-1).conversation_id).catch(e=>toast(e.message,true));};
  });
  import('/assets/incoming-alerts.mjs').then(({createIncomingAlerts})=>{
    const controller=createIncomingAlerts({session,baseline:()=>state?.incomingCursor??null,read:async cursor=>{
      const result=await api('/api/incoming-events'+(cursor===null?'':'?after='+cursor));failed=false;update();return result;
    },onEvents:received,onReset:()=>{unseen=[];failed=false;document.title=baseTitle;update();},onError:error=>{failed=true;if(error.status===401)controller.reset();update();}});
    setInterval(()=>{controller.poll();update();},5000);
    window.addEventListener('focus',()=>controller.poll());
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)controller.poll();});
    controller.poll();update();
  }).catch(()=>{failed=true;update();});
})();
