import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCentral} from '../server.mjs';
import {createGroupHistory} from '../group-history.mjs';
import {createGroupPilot,createGroupCollector,groupMessage,pilotBindings,signPilot} from '../group-pilot.mjs';

const session='test-pilot',key='test-only-group-credential-01234567890123456789';
const jid='120363000000000000@g.us';
const message=(extra={})=>({isGroupMsg:true,chatId:jid,id:'message-1',author:'111111111111@c.us',body:'Projeto ficticio para ensaio',type:'chat',timestamp:Math.floor(Date.now()/1000),fromMe:false,...extra});
const fixture=()=>{
 const db=new DatabaseSync(':memory:');const history=createGroupHistory(db),group=history.create({name:'Grupo ficticio'});
 const bindings=JSON.stringify([{jid,groupId:group.id}]);
 const config={GROUP_PILOT_ENABLED:'true',GROUP_PILOT_KEY:key,GROUP_PILOT_SESSION:session,GROUP_PILOT_BINDINGS_JSON:bindings};
 return{db,history,group,bindings,config,pilot:createGroupPilot(db,config,history)};
};
const send=(pilot,event,headers={})=>{const raw=Buffer.from(JSON.stringify({session,...event}));return pilot.receive(raw,{'content-type':'application/json',...signPilot(raw,key),...headers});};

test('piloto desligado nao cria tabelas nem disponibiliza endpoint',async t=>{
 const app=createCentral({DATABASE_PATH:':memory:'},()=>assert.fail('sem transporte externo'));t.after(()=>app.close());
 assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%group%'").get().n,0);
 assert.deepEqual(app.groupPilot.status(),{enabled:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 assert.equal((await fetch('http://127.0.0.1:'+app.server.address().port+'/webhooks/group-pilot',{method:'POST',body:'{}'})).status,404);
});
test('filtro nao coleta particulares, outro grupo, notificacao nem bytes de midia',()=>{
 const allowed=new Map([[jid,'group']]);
 assert.equal(groupMessage(message({isGroupMsg:false}),allowed),null);
 assert.equal(groupMessage(message({chatId:'999999999@g.us'}),allowed),null);
 assert.equal(groupMessage(message({isNotification:true}),allowed),null);
 assert.equal(groupMessage(message({isMdHistoryMsg:true}),allowed),null);
 assert.equal(groupMessage(message({author:''}),allowed),null);
 const media=groupMessage(message({type:'audio',body:'base64-private',mediaKey:'private'}),allowed);
 assert.equal(media.kind,'audio');assert.match(media.body,/conteudo nao coletado/);
 assert.equal(JSON.stringify(media).includes('private'),false);
 assert.equal(groupMessage(message({chatId:{_serialized:jid}}),allowed).jid,jid);
 assert.throws(()=>pilotBindings('[]'),/Selecione/);
 assert.throws(()=>pilotBindings(JSON.stringify([{jid:'someone@c.us',groupId:'x'}])),/invalidos/);
});
test('assinatura corpo bruto, timestamp, sessao e grupos sao obrigatorios',t=>{
 const f=fixture();t.after(()=>f.db.close());
 const event={event:'message',message:groupMessage(message(),new Map([[jid,true]]))};
 assert.throws(()=>send(f.pilot,event,{'x-group-signature':'sha256='+'0'.repeat(64)}),/Assinatura/);
 assert.throws(()=>send(f.pilot,event,{'x-group-time':String(Date.now()-300000)}),/atual/);
 assert.throws(()=>send(f.pilot,event,{origin:'https://bad.invalid'}),/navegador/);
 assert.throws(()=>send(f.pilot,{...event,session:'different'}),/Sessao/);
 assert.throws(()=>send(f.pilot,{...event,message:{...event.message,jid:'999999999@g.us'}}),/Grupo/);
 assert.throws(()=>f.pilot.receive(Buffer.alloc(32769),{}),/limite/);
 assert.throws(()=>send(f.pilot,{...event,message:{...event.message,body:'\u0000'}}),/invalida/);
 const raw=Buffer.from(JSON.stringify({session,...event}));const signed=signPilot(raw,key);
 assert.throws(()=>f.pilot.receive(Buffer.from(raw.toString()+' '),{'content-type':'application/json',...signed}),/Assinatura/);
 assert.equal(f.history.detail(f.group.id).messages.length,0);
});
test('entrada idempotente preserva autoria, origem, saida humana e detecta conflito',t=>{
 const f=fixture();t.after(()=>f.db.close());const m=groupMessage(message({fromMe:true}),new Map([[jid,true]]));
 assert.equal(send(f.pilot,{event:'message',message:m}).duplicate,false);
 assert.equal(send(f.pilot,{event:'message',message:m}).duplicate,true);
 assert.throws(()=>send(f.pilot,{event:'message',message:{...m,body:'alterado'}}),/divergente/);
 assert.throws(()=>send(f.pilot,{event:'message',message:{...m,fromMe:false}}),/divergente/);
 const rows=f.history.detail(f.group.id).messages;
 assert.equal(rows.length,1);assert.equal(rows[0].author,m.author);assert.equal(rows[0].created,m.created);
 assert.equal(rows[0].fromMe,1);assert.equal(rows[0].source,'linked_device');
 const s=f.pilot.status();assert.equal(s.received,1);assert.equal(s.duplicates,1);
 assert.equal(s.historyComplete,false);assert.equal(s.notionSync,false);assert.equal(s.aiResponses,false);
});
test('heartbeat recente nao prova historico integral e desconexao fica visivel',t=>{
 const f=fixture();t.after(()=>f.db.close());const now=Date.now();
 send(f.pilot,{event:'heartbeat',connected:true,at:now,queued:2,gaps:0});
 assert.equal(f.pilot.status(now).online,true);assert.equal(f.pilot.status(now+90001).online,false);
 send(f.pilot,{event:'heartbeat',connected:false,at:now-1000,queued:0,gaps:0});
 assert.equal(f.pilot.status(now).online,true);
 send(f.pilot,{event:'heartbeat',connected:false,at:now+1,queued:1,gaps:1});
 assert.equal(f.pilot.status(now+1).online,false);assert.equal(f.pilot.status().coverage,'gap_detected');
});
test('fila persiste apos timeout e reinicio; resposta perdida nao duplica no receptor',async t=>{
 const f=fixture();t.after(()=>f.db.close());const dir=mkdtempSync(join(tmpdir(),'group-pilot-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let out=new DatabaseSync(join(dir,'outbox.sqlite')),lose=true;
 const transport=async(url,options)=>{
  assert.equal(url,'https://pilot.example.invalid/webhooks/group-pilot');
  const result=f.pilot.receive(Buffer.from(options.body),options.headers);
  if(JSON.parse(options.body).event==='message'&&lose){lose=false;throw Error('timeout after commit');}
  return Response.json(result);
 };
 const options={session,bindings:f.bindings,key,target:'https://pilot.example.invalid/webhooks/group-pilot'};
 let collector=createGroupCollector(out,options,transport);collector.setConnected(true);
 assert.equal(collector.accept(message()),true);await collector.flush();assert.equal(collector.state().queued,1);
 out.close();out=new DatabaseSync(join(dir,'outbox.sqlite'));t.after(()=>out.close());
 collector=createGroupCollector(out,options,transport);await collector.flush();assert.equal(collector.state().queued,0);
 collector.accept(message({id:'invalid',author:''}));assert.equal(collector.state().gaps,1);
 assert.equal(f.history.detail(f.group.id).messages.length,1);
 assert.throws(()=>createGroupCollector(out,{...options,target:'http://remote.invalid/webhooks/group-pilot'}),/Destino/);
 assert.throws(()=>createGroupCollector(out,{...options,target:'https://pilot.invalid/wrong'}),/Destino/);
});
test('piloto integrado nunca envia WhatsApp, invoca IA ou escreve Notion',async t=>{
 const config={DATABASE_PATH:':memory:',GROUP_HISTORY_ENABLED:'true'};
 let app=createCentral(config,()=>assert.fail('nenhum servico externo'));
 const group=app.groupHistory.create({name:'Grupo de ensaio'});
 // Reopen the same isolated database is covered by the receiver's fixture; here enable on a fresh app.
 await app.close();
 const id=group.id;Object.assign(config,{GROUP_PILOT_ENABLED:'true',GROUP_PILOT_KEY:key,GROUP_PILOT_SESSION:session,GROUP_PILOT_BINDINGS_JSON:JSON.stringify([{jid,groupId:id}])});
 app=createCentral(config,()=>assert.fail('nenhum servico externo'));t.after(()=>app.close());
 app.db.prepare('INSERT INTO whatsapp_groups VALUES(?,?,?)').run(id,'Grupo de ensaio',Date.now());
 const m=groupMessage(message(),new Map([[jid,true]]));
 send(app.groupPilot,{event:'message',message:m});
 for(const table of ['conversations','messages','ai_jobs','service_events'])assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;config.PUBLIC_ORIGIN=base;
 const raw=JSON.stringify({session,event:'message',message:m});
 assert.equal((await fetch(base+'/webhooks/group-pilot',{method:'POST',headers:{'content-type':'application/json',...signPilot(raw,key)},body:raw})).status,200);
 assert.equal((await fetch(base+'/api/groups/pilot-status')).status,401);
});
