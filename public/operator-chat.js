'use strict';
let operatorList=null,operatorThread=null,operatorBusy=false,operatorError='',operatorNew=false,operatorOutgoing=null,operatorOwner='';
let operatorConversation='',operatorContext=null,operatorPollAfter=0;
const operatorDrafts=new Map(),operatorViewports=new Map();
function operatorIdentity(){return state?.user?state.user.id+'\n'+signedName().trim().toLocaleLowerCase('pt-BR'):'';}
function resetOperatorChat(){operatorList=null;operatorThread=null;operatorBusy=false;operatorError='';operatorNew=false;operatorOutgoing=null;operatorOwner='';operatorConversation='';operatorContext=null;operatorPollAfter=0;operatorDrafts.clear();operatorViewports.clear();}
function operatorChatView(){
  if(operatorOwner&&operatorOwner!==operatorIdentity())resetOperatorChat();
  const viewport=$('.operator-messages');if(viewport)operatorViewports.set(viewport.dataset.chatId,{top:viewport.scrollTop,pinned:viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<70});
  const old=$('#operator-prompt');if(old)operatorDrafts.set(old.dataset.chatId,old.value);
  const info=operatorList,c=operatorThread,key=c?.id||'new',running=c&&(c.needsRefresh||['sending','queued','in_progress'].includes(c.state));
  const labels={sending:'Enviando comando',queued:'Na fila do Notion',in_progress:'Agente trabalhando',requires_action:'Aguardando sua decisão',completed:'Pronto',failed:'Execução não concluída',unknown:'Resultado a conferir',canceled:'Cancelado',terminated:'Encerrado'};
  return '<div class="operator-workspace"><aside class="operator-history"><div class="section-head"><h2>Seus comandos</h2><button id="operator-new" type="button">＋ Novo</button></div><p class="muted">Histórico desta conta e assinatura. Separado das conversas de clientes.</p>'+(info?.chats||[]).map(t=>'<button type="button" class="operator-thread '+(t.id===c?.id?'selected':'')+'" data-operator-thread="'+esc(t.id)+'"><strong>'+esc(t.title)+'</strong><small>'+esc(labels[t.state]||t.state)+' · '+formatDate(t.updated)+'</small></button>').join('')+'</aside><section class="operator-chat"><header class="operator-head"><div><h2>Assistente interno · Notion</h2><small>'+esc(info?.billing||'Converse com o agente do Notion conectado pela administração.')+'</small></div><button id="operator-refresh" type="button">Atualizar</button></header>'+operatorClientPanel()+'<div>'+(!info?'<p class="hint">Carregando configuração…</p>':!info.enabled?'<div class="hint">'+esc(info.activationPending?'O chat ainda precisa ser habilitado no Render. ':'')+esc((info.missing||[]).length?'Configurações pendentes: '+info.missing.join(', ')+'.':'Confira o acesso do agente antes de ativar.')+(state.user.role==='admin'?'<p>Selecione o agente no Agent access da conexão Notion e habilite “View sessions and interact with agents”. Depois configure NOTION_OPERATOR_AGENT_ID e NOTION_OPERATOR_CHAT_ENABLED=true no Render.</p>':'<p>Peça à administração para concluir a configuração.</p>')+'</div>':'')+(state.user.role==='admin'&&info?.configured?'<button id="operator-verify" type="button">Conferir acesso ao agente</button>':'')+(operatorError||c?.error?'<div class="hint" role="alert">'+esc(operatorError||c.error)+'</div>':'')+'</div><div class="operator-messages" data-chat-id="'+esc(key)+'" aria-live="polite">'+(!c?.messages?.length?'<div class="operator-welcome"><h3>O que vamos preparar?</h3><p>Peça ao agente para localizar um cliente, preparar uma proposta ou encontrar documentos no Notion. Informe o cliente e o serviço para evitar misturar trabalhos.</p><p>O comando fica neste chat interno. Qualquer envio ao cliente exige uma prévia e sua confirmação.</p></div>':c.messages.map(m=>'<article class="operator-message '+(m.role==='operator'?'from-operator':'from-agent')+'"><small>'+esc(m.role==='operator'?'Você':'Agente do Notion')+' · '+formatDate(m.created)+'</small><div>'+esc(m.text)+'</div></article>').join(''))+(running?'<p class="operator-pending" role="status">'+esc(c.needsRefresh&&c.state==='completed'?'Carregando resposta':labels[c.state])+'…</p>':'')+'</div>'+(c?.actions?.length?'<div class="operator-actions"><h3>Confira antes de decidir</h3><p>Revise a resposta e os documentos acima. Aprovar autoriza a ação exibida pelo agente.</p>'+c.actions.map(a=>'<div class="operator-action"><p>'+esc(a.title)+'</p>'+a.options.map(o=>'<button type="button" data-operator-action="'+esc(a.id)+'" data-option="'+esc(o.id)+'">'+esc(o.label||o.id)+'</button>').join('')+'</div>').join('')+'</div>':'')+'<form id="operator-form" class="operator-composer"><label for="operator-prompt">Comando para o agente</label><textarea id="operator-prompt" data-chat-id="'+esc(key)+'" placeholder="Ex.: encontre o cadastro do cliente e prepare uma proposta para revisão…" maxlength="6000" '+(!info?.enabled||operatorBusy||c&&!c.canSend?'disabled':'')+'>'+esc(operatorDrafts.get(key)||'')+'</textarea><div><small>Enter envia · Shift+Enter quebra linha</small><button class="primary" type="submit" '+(!info?.enabled||operatorBusy||c&&!c.canSend?'disabled':'')+'>Enviar comando</button><button id="operator-documents" type="button">Buscar e enviar documento</button></div></form></section></div>';
}
async function loadOperatorChat(id=operatorThread?.id,remote=false){
  if(localMode){operatorError='Entre na central conectada para usar o agente real do Notion.';render();return;}
  const identity=operatorIdentity();operatorOwner=identity;
  const list=await api('/api/operator-chat');if(operatorIdentity()!==identity)return;operatorList=list;
  if(!id&&!operatorNew)id=list.chats[0]?.id;
  if(id){const c=await api('/api/operator-chat/'+encodeURIComponent(id)+(remote?'/refresh':''),remote?'POST':'GET',remote?{}:undefined);if(operatorIdentity()!==identity)return;operatorThread=c;operatorError='';operatorPollAfter=0;operatorConversation=c.conversationId||'';if(operatorContext?.conversation.id!==operatorConversation)operatorContext=null;operatorList.chats=operatorList.chats.map(t=>t.id===c.id?{...t,state:c.state,updated:c.updated,error:c.error}:t);}
  if(view==='assistant')render();
}
function bindOperatorChat(){
  if(view!=='assistant')return;
  const box=$('.operator-messages');if(box){const saved=operatorViewports.get(box.dataset.chatId);box.scrollTop=saved&&!saved.pinned?saved.top:box.scrollHeight;}
  $('#operator-new')?.addEventListener('click',()=>{operatorThread=null;operatorNew=true;operatorError='';operatorOutgoing=null;operatorConversation=active||'';operatorContext=null;render();});
  document.querySelectorAll('[data-operator-thread]').forEach(b=>b.onclick=()=>act(async()=>{operatorNew=false;operatorError='';operatorOutgoing=null;await loadOperatorChat(b.dataset.operatorThread,true);}));
  $('#operator-refresh')?.addEventListener('click',()=>act(()=>loadOperatorChat(operatorThread?.id,true)));
  $('#operator-verify')?.addEventListener('click',()=>act(async()=>{const r=await api('/api/operator-chat/verify','POST',{});toast('Acesso conferido: '+r.name+'. Estado: '+r.agentStatus+'.');}));
  $('#operator-documents')?.addEventListener('click',()=>act(()=>openOperatorDocuments()));
  $('#operator-client')?.addEventListener('change',e=>{operatorConversation=e.target.value;operatorContext=null;render();});
  $('#operator-client-load')?.addEventListener('click',()=>act(async()=>{const id=operatorThread?.conversationId||operatorConversation,identity=operatorIdentity();if(!id)return;const result=await api('/api/operator-context/'+encodeURIComponent(id));if(identity===operatorIdentity()&&id===(operatorThread?.conversationId||operatorConversation)){operatorContext=result;render();}}));
  document.querySelectorAll('[data-operator-document-page]').forEach(b=>b.onclick=()=>act(()=>openOperatorDocuments(b.dataset.operatorDocumentPage)));
  $('#operator-form')?.addEventListener('submit',e=>{e.preventDefault();if(operatorBusy)return;act(async()=>{
    const text=$('#operator-prompt').value.trim(),id=operatorThread?.id||null,key=id||'new',identity=operatorIdentity();if(!text)return;
    if(!operatorOutgoing||operatorOutgoing.text!==text||operatorOutgoing.id!==id)operatorOutgoing={id,text,requestId:uid()};
    operatorBusy=true;operatorError='';render();
    try{
      const result=await api('/api/operator-chat/messages','POST',{chatId:id,conversationId:operatorThread?.conversationId||operatorConversation||undefined,message:text,requestId:operatorOutgoing.requestId});if(identity!==operatorIdentity())return;operatorThread=result;operatorNew=false;
      if(!['failed','unknown'].includes(result.state)){operatorDrafts.delete(key);const input=$('#operator-prompt');if(input?.value.trim()===text)input.value='';operatorOutgoing=null;}
      await loadOperatorChat(result.id,!['failed','unknown'].includes(result.state));
    }catch(error){if(identity===operatorIdentity())operatorError=error.message;}
    finally{if(identity===operatorIdentity()){operatorBusy=false;render();}}
  });});
  $('#operator-prompt')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.isComposing){e.preventDefault();if(!operatorBusy&&!e.target.disabled)$('#operator-form').requestSubmit();}});
  document.querySelectorAll('[data-operator-action]').forEach(b=>b.onclick=()=>{
    const c=operatorThread,action=c.actions.find(a=>a.id===b.dataset.operatorAction),option=b.dataset.option,requestId=uid();
    modal(option==='approve'?'Autorizar ação do agente':'Recusar ação','<p>'+esc(action.title)+'</p><label><input type="checkbox" name="reviewed" required> Conferi o conteúdo e esta decisão.</label>',option==='approve'?'Autorizar':'Recusar',async()=>{operatorThread=await api('/api/operator-chat/'+c.id+'/action','POST',{actionId:action.id,option,reviewDigest:c.reviewDigest,confirmed:true,requestId});await loadOperatorChat(c.id,true);});
  });
}
const docRPC=(action,args)=>api('/api/operator-documents','POST',{action,arguments:args});
async function openOperatorDocuments(pageId=''){
  if(localMode)throw Error('Entre na central conectada para buscar documentos.');
  modal('Documento do Notion','<label class="field">Conversa de destino<select name="phone" required>'+state.conversations.map(c=>'<option value="'+esc(c.phone)+'" '+(c.id===(operatorThread?.conversationId||operatorConversation)?'selected':'')+'>'+esc(c.name)+' · '+esc(c.phone)+'</option>').join('')+'</select></label><label class="field">Página do documento<input name="page" required value="'+esc(pageId)+'" placeholder="Cole a URL ou ID da página no Notion"></label><p>Selecione a página destinada ao cliente. Arquivos preparados não são enviados automaticamente.</p>','Buscar',async data=>{
    const raw=String(data.get('page')),m=raw.match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|[a-f0-9]{32}/i);if(!m)throw Error('Informe uma página válida do Notion.');
    const id=m[0].replace(/-/g,'').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5'),phone=String(data.get('phone'));
    const list=await docRPC('listar_documentos_notion',{telefone:phone,paginaId:id});
    setTimeout(()=>chooseOperatorDocument(phone,id,list),0);
  });
}
function chooseOperatorDocument(phone,pageId,list){
  modal('Escolher documento','<p>'+esc(list.titulo)+' → '+esc(phone)+'</p><label class="field">Documento<select name="file">'+list.documentos.filter(d=>d.importavel).map(d=>'<option value="'+esc(d.arquivoId)+'">'+esc(d.nome)+'</option>').join('')+'<option value="page">Gerar PDF do texto desta página</option></select></label><label class="field">Mensagem ao cliente<textarea name="text" maxlength="1024" required>Segue o documento para sua conferência.</textarea></label>','Preparar prévia',async data=>{
    const file=String(data.get('file')),text=String(data.get('text')),args={telefone:phone,paginaId:pageId,texto:text,requestId:uid()};
    if(file==='page'){
      const page=await docRPC('visualizar_pagina_notion',{telefone:phone,paginaId:pageId});
      setTimeout(()=>modal('Conferir o texto da página','<p>'+esc(page.titulo)+' → '+esc(phone)+'</p><pre class="operator-document-text">'+esc(page.conteudo.map(b=>b.cells?.join(' | ')||b.text||'').join('\n\n'))+'</pre><p>Este PDF contém o texto acima. Para preservar imagens ou modelos complexos, use um PDF anexado.</p>','Gerar PDF e prévia',async()=>{const d=await docRPC('preparar_pagina_notion_pdf',{...args,resumoConteudo:page.resumoConteudo});setTimeout(()=>reviewOperatorDocument(d),0);}),0);
    }else{const d=await docRPC('preparar_documento_notion',{...args,arquivoId:file});setTimeout(()=>reviewOperatorDocument(d),0);}
  });
}
function reviewOperatorDocument(d){
  modal('Conferir envio ao WhatsApp','<p><strong>Destinatário:</strong> '+esc(d.telefone)+'</p><p><strong>Arquivo:</strong> '+esc(d.anexo.nome)+'</p><p>'+esc(d.texto)+'</p><p><a href="'+esc(d.anexo.visualizar)+'" target="_blank" rel="noopener">Abrir e conferir o documento</a></p><label><input type="checkbox" required> Conferi destinatário, documento e mensagem.</label>','Enviar documento',async()=>{
    const r=await docRPC('confirmar_envio',{envioId:d.envioId,resumoCriptografico:d.resumoCriptografico,autorizadoPeloUsuario:true});toast(r.entregaConfirmada?'Entrega confirmada.':r.aceitoPelaMeta?'Envio aceito pela Meta; a entrega ainda será confirmada.':r.erro||r.estado);await refresh();
  });
}
setInterval(()=>{if(view==='assistant'&&!document.hidden&&!operatorBusy&&operatorThread&&(operatorThread.needsRefresh||['queued','in_progress'].includes(operatorThread.state))&&Date.now()>=operatorPollAfter){operatorBusy=true;loadOperatorChat(operatorThread.id,true).catch(e=>{operatorError=e.message;operatorPollAfter=Date.now()+60000;}).finally(()=>{operatorBusy=false;if(view==='assistant')render();});}},5000);

function operatorClientPanel(){
  const id=operatorThread?.conversationId||operatorConversation,ctx=operatorContext?.conversation.id===id?operatorContext:null;
  const options=state.conversations.map(c=>'<option value="'+esc(c.id)+'" '+(c.id===id?'selected':'')+'>'+esc(c.name)+' · '+esc(c.phone)+'</option>').join('');
  const docs=ctx?[...(ctx.client?[{title:'Cadastro: '+ctx.client.name,id:ctx.client.id}]:[]),...Object.values(ctx.sections).flatMap(s=>s.records)]:[];
  return '<div class="operator-client-panel"><label>Cliente desta tarefa<select id="operator-client" '+(operatorThread||operatorBusy?'disabled':'')+'><option value="">Sem cliente específico</option>'+options+'</select></label><button id="operator-client-load" type="button" '+(!id?'disabled':'')+'>Consultar cadastro e contexto</button>'+(operatorThread?'<small>Para outro cliente, abra um novo chat interno.</small>':'')+(ctx?'<details open><summary>Contexto do cliente</summary><p>'+esc(ctx.summary||'Ainda sem resumo da conversa.')+'</p><p>'+esc(ctx.missing)+'</p><p>'+esc(ctx.nextStep)+'</p>'+(ctx.warning?'<p class="hint">'+esc(ctx.warning)+'</p>':'')+Object.entries(ctx.sections).filter(([,s])=>!s.available).map(([k])=>'<p class="hint">Fonte indisponível: '+esc(k)+'.</p>').join('')+'<div class="context-actions">'+docs.map(d=>'<button type="button" data-operator-document-page="'+esc(d.id)+'">Documentos · '+esc(d.title)+'</button>').join('')+'</div></details>':'')+'</div>';
}
