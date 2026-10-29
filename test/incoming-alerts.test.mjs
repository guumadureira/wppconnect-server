import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentral} from '../server.mjs';
import {createIncomingAlerts} from '../public/incoming-alerts.mjs';

test('alertas acompanham recebimentos, mesmo respondidos pela IA; não repetem eco ou webhook',async t=>{
  const config={DATABASE_PATH:':memory:',WHATSAPP_PHONE_NUMBER_ID:'test'};const app=createCentral(config);t.after(()=>app.close());
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;config.PUBLIC_ORIGIN=origin;
  let cookie='';const request=async(path,body)=>{const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{origin,cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return{status:r.status,data:await r.json()};};
  assert.equal((await request('/api/incoming-events')).status,401);
  await request('/api/setup',{name:'Teste',email:'test@example.invalid',password:'test'});await request('/api/login',{email:'test@example.invalid',password:'test'});
  const incoming=id=>app.intake({metadata:{phone_number_id:'test'},messages:[{id,from:'554498231095',type:'text',text:{body:'Mensagem privada'}}]});
  incoming('old');assert.deepEqual((await request('/api/incoming-events')).data,{cursor:1,events:[]});
  incoming('new');incoming('new');
  app.intake({metadata:{phone_number_id:'test'},message_echoes:[{id:'echo',to:'554498231095',type:'text',text:{body:'Resposta'}}]},'smb_message_echoes');
  app.db.prepare('UPDATE conversations SET pending_since=NULL').run();
  const result=(await request('/api/incoming-events?after=1')).data;
  assert.equal(result.events.length,1);assert.equal(result.cursor,2);assert.equal(result.events[0].sequence,2);
  assert.equal(JSON.stringify(result).includes('Mensagem privada'),false);
  assert.equal((await request('/api/incoming-events?after=2')).data.events.length,0);
  assert.equal((await request('/api/incoming-events?after=NaN')).status,400);
  for(let i=0;i<103;i++)incoming('batch-'+i);
  const batch=(await request('/api/incoming-events?after=2')).data;assert.equal(batch.events.length,100);assert.equal(batch.more,true);
  assert.equal((await request('/api/incoming-events?after='+batch.cursor)).data.events.length,3);
});

test('cursor inicia sem alertas antigos, conserva falhas e descarta resposta após logout',async()=>{
  let user='a',result={cursor:4,events:[]},error=false,resolve;const delivered=[],cursors=[];
  const controller=createIncomingAlerts({session:()=>user,read:async cursor=>{cursors.push(cursor);if(error)throw Error('offline');return result;},onEvents:events=>delivered.push(...events)});
  await controller.poll();result={cursor:5,events:[{sequence:5}]};error=true;await controller.poll();error=false;await controller.poll();await controller.poll();
  assert.deepEqual(delivered,[{sequence:5}]);assert.deepEqual(cursors,[null,4,4,5]);
  user=null;await controller.poll();user='b';result={cursor:8,events:[{sequence:8}]};await controller.poll();assert.equal(delivered.length,1);
  const racing=createIncomingAlerts({session:()=>user,read:()=>new Promise(r=>resolve=r),baseline:()=>0,onEvents:()=>assert.fail('stale session')});
  const pending=racing.poll();user=null;resolve({cursor:9,events:[{sequence:9}]});await pending;
});

test('mensagem chegada entre carga da página e primeira consulta gera aviso',async()=>{
  const events=[];const c=createIncomingAlerts({session:()=> 'user',baseline:()=>12,read:async after=>{assert.equal(after,12);return{cursor:13,events:[{sequence:13}]};},onEvents:items=>events.push(...items)});
  await c.poll();assert.equal(events.length,1);
});
