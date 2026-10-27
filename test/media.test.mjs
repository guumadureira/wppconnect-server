import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCentral } from '../server.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS6sAAAAASUVORK5CYII=','base64');
const pdf=Buffer.from('%PDF-1.4\nDocumento fictício para teste\n%%EOF');
function webp(width=512,animated=false,size=30){const b=Buffer.alloc(size);b.write('RIFF');b.writeUInt32LE(size-8,4);b.write('WEBP',8);b.write('VP8X',12);b.writeUInt32LE(10,16);b[20]=animated?2:0;b.writeUIntLE(width-1,24,3);b.writeUIntLE(511,27,3);return b;}
const admin={name:'Atendente teste',email:'media@example.invalid',password:'test-only-password'};
const defaultConfig=()=>({DATABASE_PATH:':memory:',WHATSAPP_MODE:'live',WHATSAPP_PHONE_NUMBER_ID:'5555000001',WHATSAPP_ACCESS_TOKEN:'private-test-token',META_APP_SECRET:'private-test-secret',WEBHOOK_VERIFY_TOKEN:'private-test-verify',META_GRAPH_VERSION:'v25.0'});
async function start(config=defaultConfig(),transport=()=>{throw Error('External calls forbidden');}){
  const app=createCentral(config,transport);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  config.PUBLIC_ORIGIN='http://127.0.0.1:'+app.server.address().port;
  async function request(path,method='GET',body,cookie,headers={}){
    const response=await fetch(config.PUBLIC_ORIGIN+path,{method,headers:{origin:config.PUBLIC_ORIGIN,...(cookie?{cookie}:{}),...headers},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body)});
    return {status:response.status,headers:response.headers,body:response.headers.get('content-type')?.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer()),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const session=(await request('/api/session')).body;
  if(session.setupRequired)await request('/api/setup','POST',admin);
  const cookie=(await request('/api/login','POST',admin)).cookie;
  const incoming=(id,kind,part)=>({id,from:'550000000000',timestamp:Math.floor(Date.now()/1000),type:kind,[kind]:part});
  const value=messages=>({metadata:{phone_number_id:config.WHATSAPP_PHONE_NUMBER_ID},messages});
  const receive=async messages=>{
    const event={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:value(messages)}]}]};
    const signature='sha256='+createHmac('sha256',config.META_APP_SECRET).update(JSON.stringify(event)).digest('hex');
    return request('/webhooks/whatsapp','POST',event,undefined,{'x-hub-signature-256':signature});
  };
  const upload=(kind,mime,data,name='teste')=>request('/api/media?'+new URLSearchParams({kind,name}),'POST',data,cookie,{'content-type':mime});
  const state=async()=>(await request('/api/state','GET',undefined,cookie)).body;
  const chat=()=>app.db.prepare('SELECT id FROM conversations').get().id;
  const send=(attachmentId,requestId,text='')=>request('/api/conversations/'+chat()+'/messages','POST',{attachmentId,requestId,text},cookie);
  return {app,config,request,cookie,incoming,value,receive,upload,state,chat,send};
}

test('recebe imagens, documentos e figurinhas, confere hash e oferece conteúdo apenas autenticado',async t=>{
  const files={'media-image':{mime:'image/png',data:png},'media-document':{mime:'application/pdf',data:pdf},'media-sticker':{mime:'image/webp',data:webp()}};
  let downloads=0;
  const f=await start(undefined,async(url,options)=>{
    assert.equal(options.headers.authorization,'Bearer private-test-token');assert.equal(options.redirect,'error');
    if(url.startsWith('https://graph.facebook.com/')){const id=new URL(url).pathname.split('/').at(-1);const file=files[id];return Response.json({url:'https://lookaside.fbsbx.com/'+id,mime_type:file.mime,file_size:file.data.length,sha256:createHash('sha256').update(file.data).digest('hex')});}
    downloads++;const file=files[new URL(url).pathname.slice(1)];return new Response(file.data);
  });t.after(()=>f.app.close());
  const events=Object.entries(files).map(([id,file])=>f.incoming('message-'+id,id.split('-')[1],{id,mime_type:file.mime,filename:'arquivo.pdf',sha256:createHash('sha256').update(file.data).digest('base64')}));
  assert.equal((await f.receive(events)).status,200);await f.app.media.processPending();
  const state=await f.state();assert.equal(state.messages.length,3);assert.equal(state.mediaStorage.usedBytes,png.length+pdf.length+30);
  assert.ok(state.messages.every(m=>m.attachment.state==='ready'));
  const image=state.messages.find(m=>m.attachment.kind==='image').attachment;
  assert.equal((await f.request(image.url)).status,401);
  const opened=await f.request(image.url,'GET',undefined,f.cookie);assert.equal(opened.status,200);assert.deepEqual(opened.body,png);assert.match(opened.headers.get('content-disposition'),/^inline/);
  const document=state.messages.find(m=>m.attachment.kind==='document').attachment;
  const downloaded=await f.request(document.url,'GET',undefined,f.cookie);assert.deepEqual(downloaded.body,pdf);assert.match(downloaded.headers.get('content-disposition'),/^attachment/);assert.match(downloaded.headers.get('cache-control'),/no-store/);
  assert.equal((await f.receive(events)).status,200);await f.app.media.processPending();assert.equal(downloads,3);
  assert.equal((await f.state()).messages.length,3);
  assert.ok(!JSON.stringify(state).includes('private-test-token'));assert.ok(!JSON.stringify(state).includes('lookaside.fbsbx.com'));assert.ok(!JSON.stringify(state).includes('"data":'));
});

test('prepara e envia anexos por ID com assinatura e idempotência, preservando uma resposta que chega durante o envio',async t=>{
  let uploads=0,sends=0;const sent=[];let f;
  f=await start(undefined,async(url,options)=>{
    if(url.endsWith('/media')){uploads++;assert.equal(options.body.get('messaging_product'),'whatsapp');assert.ok(options.body.get('file') instanceof Blob);return Response.json({id:'uploaded-'+uploads});}
    sends++;sent.push(JSON.parse(options.body));if(sends===1)f.app.intake(f.value([f.incoming('new-reply','text',{body:'Nova resposta durante envio'})]));
    return Response.json({messages:[{id:'sent-'+sends}]});
  });t.after(()=>f.app.close());
  f.app.intake(f.value([f.incoming('incoming-text','text',{body:'Teste fictício'})]));
  const image=(await f.upload('image','image/png',png,'foto.png')).body.attachment;
  assert.equal(uploads,0);assert.equal((await f.state()).messages.length,1);
  const results=await Promise.all([f.send(image.id,'same-request','Olá'),f.send(image.id,'same-request','Olá')]);
  assert.ok(results.every(r=>[200,201].includes(r.status)));assert.equal(uploads,1);assert.equal(sends,1);
  assert.deepEqual(sent[0].image,{id:'uploaded-1',caption:'*Atendente teste:* Olá'});assert.equal(sent[0].type,'image');
  assert.ok(f.app.db.prepare('SELECT pending_since FROM conversations').get().pending_since);
  const document=(await f.upload('document','application/pdf',pdf,'../../Contrato "teste".pdf')).body.attachment;
  assert.equal((await f.send(document.id,'document-request')).status,201);
  assert.equal(sent[1].document.filename,'Contrato _teste_.pdf');
  const sticker=(await f.upload('sticker','image/webp',webp(),'figurinha.webp')).body.attachment;
  assert.equal((await f.send(sticker.id,'bad-caption','texto')).status,400);
  assert.equal((await f.send(sticker.id,'sticker-request')).status,201);assert.deepEqual(sent[2].sticker,{id:'uploaded-3'});
  const messages=(await f.state()).messages.filter(m=>m.direction==='out');assert.equal(messages.length,3);assert.ok(messages.every(m=>m.agent_name==='Atendente teste'&&m.attachment.state==='ready'));
  f.app.db.prepare('UPDATE conversations SET last_inbound=?').run(Date.now()-25*3600000);
  assert.equal((await f.send(image.id,'expired-window')).status,409);assert.equal(uploads,3);
});

test('bloqueia formato falso, limites, origem e falta de login; não apaga anexos ao atingir capacidade',async t=>{
  const f=await start({...defaultConfig(),WHATSAPP_MODE:'demo',MEDIA_STORAGE_MAX_MB:'1'});t.after(()=>f.app.close());
  assert.equal((await f.request('/api/media?kind=image','POST',png,undefined,{'content-type':'image/png'})).status,401);
  assert.equal((await f.request('/api/media?kind=image','POST',png,f.cookie,{origin:'https://other.invalid','content-type':'image/png'})).status,403);
  assert.equal((await f.upload('image','image/png',Buffer.from('<script>bad</script>'))).status,415);
  assert.equal((await f.upload('document','text/html',Buffer.from('<b>bad</b>'))).status,415);
  assert.equal((await f.upload('sticker','image/webp',webp(100))).status,415);
  assert.equal((await f.upload('sticker','image/webp',webp(512,false,100001))).status,413);
  assert.equal((await f.upload('sticker','image/webp',webp(512,true,500001))).status,413);
  const first=await f.upload('document','text/plain',Buffer.alloc(600000,65),'grande.txt');assert.equal(first.status,201);
  assert.equal((await f.upload('document','text/plain',Buffer.alloc(600000,65))).status,507);
  assert.equal((await f.request(first.body.attachment.url,'GET',undefined,f.cookie)).body.length,600000);
  assert.equal((await f.state()).mediaStorage.usedBytes,600000);
});

test('download inseguro e hash divergente não expõem token, não perdem a mensagem e permitem nova tentativa',async t=>{
  let mode='unsafe',downloads=0;
  const f=await start(undefined,async(url)=>{
    if(url.startsWith('https://graph.facebook.com/'))return Response.json({url:mode==='unsafe'?'http://localhost/secret':'https://lookaside.fbsbx.com/asset',mime_type:'image/png',sha256:mode==='hash'?'0'.repeat(64):createHash('sha256').update(png).digest('hex')});
    downloads++;return new Response(png);
  });t.after(()=>f.app.close());
  await f.receive([f.incoming('incoming-image','image',{id:'remote-id',mime_type:'image/png'})]);await f.app.media.processPending();
  let state=await f.state(),file=state.messages[0].attachment;assert.equal(downloads,0);assert.equal(file.state,'error');assert.equal(state.messages.length,1);
  mode='hash';await f.request('/api/media/'+file.id+'/retry','POST',{},f.cookie);file=(await f.state()).messages[0].attachment;assert.equal(file.state,'blocked');assert.match(file.error,/integridade/);
  mode='ok';await f.request('/api/media/'+file.id+'/retry','POST',{},f.cookie);file=(await f.state()).messages[0].attachment;assert.equal(file.state,'ready');assert.equal((await f.state()).messages.length,1);
});

test('recusa de upload marca falha e mantém pendência sem duplicar envio',async t=>{
  let calls=0;
  const f=await start(undefined,async()=>{calls++;return Response.json({error:{message:'private-test-token'}},{status:400});});t.after(()=>f.app.close());
  f.app.intake(f.value([f.incoming('incoming-text','text',{body:'Teste'})]));
  const file=(await f.upload('document','application/pdf',pdf)).body.attachment;
  const result=await f.send(file.id,'failed-upload');assert.equal(result.status,502);assert.ok(!JSON.stringify(result).includes('private-test-token'));
  const duplicate=await f.send(file.id,'failed-upload');assert.equal(duplicate.body.message.status,'failed');assert.equal(calls,1);
  assert.ok(f.app.db.prepare('SELECT pending_since FROM conversations').get().pending_since);
});

test('arquivo recebido acima do limite mantém mensagem e não baixa o conteúdo',async t=>{
  let requests=0;
  const f=await start(undefined,async()=>{requests++;return Response.json({url:'https://lookaside.fbsbx.com/large',mime_type:'application/pdf',file_size:20_000_001});});t.after(()=>f.app.close());
  await f.receive([f.incoming('large-document','document',{id:'large-asset',mime_type:'application/pdf',filename:'grande.pdf',caption:'Documento do cliente'})]);await f.app.media.processPending();
  const state=await f.state();assert.equal(requests,1);assert.equal(state.messages.length,1);assert.equal(state.messages[0].body,'Documento do cliente');assert.equal(state.messages[0].attachment.state,'blocked');assert.equal(state.mediaStorage.usedBytes,0);
});

test('anexos e figurinhas favoritas persistem no banco após reiniciar, sem chamada externa no modo demo',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'central-media-test-')),config={DATABASE_PATH:join(dir,'central.sqlite'),WHATSAPP_MODE:'demo'};
  let f;
  try{
    f=await start(config);
    const sticker=(await f.upload('sticker','image/webp',webp(),'favorita.webp')).body.attachment;
    assert.equal((await f.request('/api/media/'+sticker.id+'/favorite','PATCH',{favorite:true},f.cookie)).status,200);
    f.app.intake(f.value([f.incoming('incoming-text','text',{body:'Teste demo'})]));
    assert.equal((await f.send(sticker.id,'demo-sticker')).body.message.status,'simulated');
    const cookie=f.cookie;await f.app.close();f=null;
    f=await start(config);
    const library=(await f.request('/api/stickers','GET',undefined,cookie)).body.stickers;assert.equal(library.length,1);assert.equal(library[0].id,sticker.id);
    const download=await f.request(library[0].url+'?download=1','GET',undefined,cookie);assert.deepEqual(download.body,webp());assert.match(download.headers.get('content-disposition'),/^attachment/);
    assert.equal((await f.state()).messages.find(m=>m.direction==='out').attachment.id,sticker.id);
    await f.request('/api/media/'+sticker.id+'/favorite','PATCH',{favorite:false},f.cookie);
    assert.equal((await f.request('/api/stickers','GET',undefined,f.cookie)).body.stickers.length,0);
    assert.deepEqual((await f.request(library[0].url,'GET',undefined,cookie)).body,webp());
  }finally{if(f)await f.app.close();rmSync(dir,{recursive:true,force:true});}
});
