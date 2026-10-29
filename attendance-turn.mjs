const localDay=value=>{
  const date=new Date(value);
  return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date):null;
};

// Arrival order is authoritative. Provider timestamps and imported exports do not
// establish which live messages have already received a reply.
export function attendanceTurn(history,lastReply,now=Date.now()){
  const continuation=!!lastReply&&localDay(lastReply.created)===localDay(now);
  return{
    phase:!lastReply?'opening':continuation?'continuation':'resumption',
    greetingAllowed:!continuation,
    recentReplies:history.filter(m=>m.direction==='out').slice(-4).map(m=>m.body.slice(0,700)),
    latestMessageId:history.at(-1)?.id||null,
    unansweredMessageIds:history.filter(m=>m.direction==='in'&&(!lastReply||m.arrival>lastReply.arrival)).map(m=>m.id),
    previousReply:lastReply?{id:lastReply.id,text:lastReply.body.slice(0,2000),at:lastReply.created}:null
  };
}

export function removeRepeatedGreeting(reply,turn){
  const original=reply.trim();
  if(turn.greetingAllowed)return original;
  // Remove only a standalone salutation prefix, keeping the substantive answer.
  // Do not rewrite quoted text, salutations within a sentence, or a bare greeting.
  const prefix=/^(?:olá|ola|oi|bom dia|boa tarde|boa noite)(?:[ \t]*[,.!?:;—–-]+\s*|[ \t]*\r?\n\s*|$)/iu;
  let text=original;
  for(let i=0;i<3;i++){
    const next=text.replace(prefix,'').trimStart();
    if(next===text||!next)break;
    text=next;
  }
  return text;
}
