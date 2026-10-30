// Internal, supervised review. No model calls and no customer dispatches.
(()=>{
  const categories=['Pergunta repetida','Tom inadequado','Promessa indevida','Cliente ou trabalho incorreto','Informação desatualizada','Transferência indevida','Outro'];
  const path=id=>'/api/conversations/'+encodeURIComponent(id)+'/ai-quality';
  async function history(id){
    const result=await api(path(id));
    const conversation=state.conversations.find(c=>c.id===id);
    modal('Falhas e correções · '+conversation.name,'<p>Revisão interna. Aprovar registra uma decisão; não muda as instruções da IA nem envia mensagem ao cliente.</p>'+result.reports.map(r=>'<article class="context-entry"><strong>'+esc(r.category)+'</strong><small> · '+esc(r.decision==='approved'?'Aprovada':r.decision==='rejected'?'Rejeitada':'Aguardando revisão')+' · '+formatDate(r.created)+'</small><p>'+esc(r.observation)+'</p><p>Proposta: '+esc(r.proposed_correction)+'</p>'+(r.decision?'<p>'+esc(r.reviewer)+': '+esc(r.correction)+'</p>':state.user.role==='admin'?'<button type="button" data-review-quality="'+esc(r.id)+'">Revisar</button>':'')+'</article>').join('')+(!result.reports.length?'<p>Nenhuma falha registrada nesta conversa.</p>':''),'Fechar',async()=>{});
    document.querySelectorAll('[data-review-quality]').forEach(button=>button.onclick=()=>{
      const report=result.reports.find(r=>r.id===button.dataset.reviewQuality);
      modal('Revisar correção','<p>'+esc(report.observation)+'</p><label class="field">Decisão<select name="decision"><option value="approved">Aprovar correção</option><option value="rejected">Rejeitar proposta</option></select></label><label class="field">Correção aprovada ou motivo<textarea name="correction" maxlength="800" required>'+esc(report.proposed_correction)+'</textarea></label><p>A decisão fica registrada. Para corrigir o contexto do cliente, use Editar contexto. Mudanças gerais precisam de implementação e testes separados.</p>','Registrar revisão',async data=>{await api(path(id)+'/'+report.id,'PATCH',Object.fromEntries(data));toast('Revisão registrada. As regras da IA permanecem sob controle humano.');});
    });
  }
  document.addEventListener('click',event=>{
    if(!event.target.closest('#review-ai-quality'))return;
    const id=active,conversation=state.conversations.find(c=>c.id===id);
    if(localMode||!conversation)return;
    const messages=state.messages.filter(m=>m.conversation_id===id&&m.direction==='out'&&m.agent_name==='Domum · IA').slice(-30).reverse();
    const requestId=uid();
    modal('Registrar falha da IA · '+conversation.name,'<p>Escolha a resposta e descreva a correção. Evite repetir dados pessoais. O registro não é enviado ao cliente nem altera as regras automaticamente.</p><button type="button" id="quality-history">Ver registros desta conversa</button>'+(messages.length?'<label class="field">Resposta da IA<select name="messageId">'+messages.map(m=>'<option value="'+esc(m.id)+'">'+esc(formatDate(m.created)+' · '+m.body.slice(0,150))+'</option>').join('')+'</select></label><label class="field">Tipo de falha<select name="category">'+categories.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></label><label class="field">O que aconteceu<textarea name="observation" maxlength="800" required></textarea></label><label class="field">Como deveria responder<textarea name="correction" maxlength="800" required></textarea></label>':'<p>Não há resposta da IA disponível para registrar uma falha.</p>'),messages.length?'Registrar para revisão':'Fechar',async data=>{if(!messages.length)return;await api(path(id),'POST',{...Object.fromEntries(data),requestId});toast('Falha registrada para revisão humana.');});
    document.getElementById('quality-history').onclick=()=>act(()=>history(id));
  });
})();
