import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createCentral} from '../server.mjs';
import {opusDuration} from '../audio-format.mjs';
import {knowledgeFor} from '../attendance-knowledge.mjs';

function voice(frames=1){
  const head=Buffer.alloc(19);head.write('OpusHead');head[8]=1;head[9]=1;head.writeUInt32LE(48000,12);
  const tags=Buffer.alloc(16);tags.write('OpusTags');
  const packets=[head,tags,...Array.from({length:frames},()=>Buffer.from([0xf8,0xff,0xfe]))];
  return Buffer.concat(packets.map((p,i)=>{
    const h=Buffer.alloc(28);h.write('OggS');h[5]=i===0?2:i===packets.length-1?4:0;h.writeBigUInt64LE(BigInt(Math.max(0,i-1)*960),6);h.writeUInt32LE(1,14);h.writeUInt32LE(i,18);h[26]=1;h[27]=p.length;
    const page=Buffer.concat([h,p]);let crc=0;for(const b of page){crc^=b<<24;for(let bit=0;bit<8;bit++)crc=crc&0x80000000?(crc<<1)^0x04c11db7:crc<<1;}page.writeUInt32LE(crc>>>0,22);return page;
  }));
}
async function fixture(t,config={},transcribe){
  const calls=[],phone='5544000000001';
  const result={reply:'Oi! Em qual município fica o imóvel?',summary:'Solicita regularização.',missing:'Município',nextStep:'Entender o imóvel',kind:'atendimento',handoff:false,reason:'',intake:{ready:false,name:'',city:'',service:'',nameMessageId:'',cityMessageId:'',serviceMessageId:''}};
  const app=createCentral({DATABASE_PATH:':memory:',WHATSAPP_MODE:'live',WHATSAPP_PHONE_NUMBER_ID:'fake-phone',WHATSAPP_ACCESS_TOKEN:'fake-meta',META_APP_SECRET:'fake-secret',WEBHOOK_VERIFY_TOKEN:'fake-verify',META_GRAPH_VERSION:'v25.0',AI_ENABLED:'true',AI_AUDIO_ENABLED:'true',OPENAI_API_KEY:'fake-openai',AI_ALLOWED_PHONES:phone,AI_MONTHLY_BUDGET_USD:'5',AI_TOTAL_BUDGET_USD:'5',...config},async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/transcriptions'))return transcribe?transcribe(url,options,app):Response.json({text:'Preciso regularizar uma casa em Maringá.'});
    if(url.endsWith('/responses'))return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
    assert.match(url,/graph.facebook.com/);return Response.json({messages:[{id:'fake-out-'+calls.length}]});
  },{aiDebounceMs:0});t.after(()=>app.close());
  const req=Readable.from([voice()]);req.headers={'content-type':'audio/ogg'};
  const file=await app.media.upload(req,new URLSearchParams({kind:'audio',name:'voz.ogg'}));app.db.prepare('UPDATE media SET provider_id=? WHERE id=?').run('remote-voice',file.id);
  let seq=0;
  const incoming=audio=>{app.intake({metadata:{phone_number_id:'fake-phone'},messages:[{id:'in-'+(++seq),from:phone,type:audio?'audio':'text',...(audio?{audio:{id:'remote-voice',mime_type:'audio/ogg'}}:{text:{body:'Podemos continuar?'}}),timestamp:Math.floor(Date.now()/1000)}]});return app.db.prepare('SELECT * FROM conversations WHERE phone=?').get(phone);};
  return{app,calls,file,incoming};
}
test('duração Opus usa pacotes, limita tamanho e rejeita cadeia/truncamento',()=>{
  assert.equal(opusDuration(voice(50)),1);
  assert.throws(()=>opusDuration(voice().subarray(0,-1)));
  assert.throws(()=>opusDuration(Buffer.concat([voice(),voice()])));
  assert.throws(()=>opusDuration(voice(15001)));
});
test('áudio vira texto de contexto, conserva original e custo conjunto, sem repetir transcrição',async t=>{
  const f=await fixture(t),c=f.incoming(true);await f.app.ai.process();
  assert.equal(f.calls.length,3);assert.equal(f.calls[0].options.body.get('model'),'gpt-transcribe');
  const request=JSON.parse(f.calls[1].options.body),message=JSON.parse(request.input[0].content).messages.at(-1);
  assert.match(message.text,/regularizar/);assert.equal(message.source,'transcricao_automatica');assert.equal(request.text.format.schema.properties.reply.maxLength,700);
  assert.equal(f.app.db.prepare("SELECT body FROM messages WHERE direction='in'").get().body,'[Áudio]');
  assert.ok(f.app.ai.status().usedTotalUsd>=0.0045);assert.equal(f.app.customerContext.view(c.id).mode,'assisted');
  f.incoming(false);await f.app.ai.process();assert.equal(f.calls.filter(c=>c.url.endsWith('/transcriptions')).length,1);
});
test('limite e tomada humana durante transcrição impedem chamada ou resposta posterior',async t=>{
  const small=await fixture(t,{AI_TOTAL_BUDGET_USD:'0.001'});small.incoming(true);await small.app.ai.process();assert.equal(small.calls.length,0);
  let finish,started;const waiting=new Promise(r=>finish=r),began=new Promise(r=>started=r);
  const f=await fixture(t,{},async()=>{started();await waiting;return Response.json({text:'Preciso de projeto.'});}),c=f.incoming(true),work=f.app.ai.process();
  await began;f.app.ai.pause(c.id);finish();await work;
  assert.equal(f.calls.length,1);assert.equal(f.app.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE direction='out'").get().n,0);
});
test('pedido humano por áudio é reconhecido; falha de transcrição mantém reserva sem nova cobrança',async t=>{
  const human=await fixture(t,{},async()=>Response.json({text:'Quero falar com uma pessoa.'}));const c=human.incoming(true);await human.app.ai.process();assert.equal(human.calls.length,1);assert.equal(human.app.customerContext.view(c.id).mode,'human');
  const f=await fixture(t,{},async()=>{throw Error('fake-openai private');});f.incoming(true);await f.app.ai.process();await f.app.ai.process();assert.equal(f.calls.length,1);assert.equal(f.app.ai.status().usedTotalUsd,0.0045);assert.ok(!JSON.stringify(f.app.ai.status()).includes('fake-openai'));
});
test('referências distinguem municípios e ficam limitadas quando a conferência vence',()=>{
  const at=Date.parse('2026-10-27T12:00:00Z');assert.equal(knowledgeFor('regularizar em Sarandi',at)[0].topic,'Sarandi');
  assert.ok(knowledgeFor('alvará em Maringá',at).every(x=>x.topic!=='Sarandi'));
  assert.ok(knowledgeFor('alvará em Maringá',at+31*86400000).every(x=>!x.current&&x.guidance.includes('nova conferência')));
});

test('áudio fica protegido por login e aceita faixa para reprodução sem liberar download público',async t=>{
  const config={DATABASE_PATH:':memory:'},app=createCentral(config,async()=>{throw Error('No external calls');});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const origin=config.PUBLIC_ORIGIN='http://127.0.0.1:'+app.server.address().port;
  const auth={name:'Teste',email:'audio@example.invalid',password:'fake-password'};
  await fetch(origin+'/api/setup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(auth)});
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(auth)}),cookie=login.headers.get('set-cookie').split(';')[0];
  const upload=await fetch(origin+'/api/media?kind=audio&name=voz.ogg',{method:'POST',headers:{origin,cookie,'content-type':'audio/ogg'},body:voice()});assert.equal(upload.status,201);
  const file=(await upload.json()).attachment,url=origin+'/api/media/'+file.id+'/content';
  assert.equal((await fetch(url)).status,401);
  const response=await fetch(url,{headers:{cookie,range:'bytes=0-3'}});assert.equal(response.status,206);assert.equal(await response.text(),'OggS');assert.match(response.headers.get('content-disposition'),/^inline/);
  assert.equal((await fetch(url,{headers:{cookie,range:'bytes=99999-'}})).status,416);
  const sent=await fetch(origin+'/api/conversations/no-chat/messages',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({text:'',attachmentId:file.id,requestId:'test'})});assert.equal(sent.status,404);
});
