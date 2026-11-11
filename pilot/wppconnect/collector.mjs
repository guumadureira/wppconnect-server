import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {createGroupCollector} from '../../group-pilot.mjs';

// Explicitly launched on the private pilot computer, never by npm start at root.
if(process.env.GROUP_COLLECTOR_ENABLED!=='true')throw Error('Coletor desligado. Configure o piloto privado antes de iniciar.');
const directory=resolve('private');
mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
process.umask(0o077);
const qrFile=resolve(directory,'pairing.png');
const db=new DatabaseSync(resolve(directory,'outbox.sqlite'));
const discovery=process.argv.includes('--discover');
if(!/^[a-zA-Z0-9_-]{1,64}$/.test(process.env.GROUP_PILOT_SESSION||'')||!/^\d{5,30}@(c\.us|lid)$/.test(process.env.GROUP_PILOT_EXPECTED_ACCOUNT||''))throw Error('Configure sessao e identidade esperada do aparelho.');
const collector=discovery?null:createGroupCollector(db,{
 session:process.env.GROUP_PILOT_SESSION,
 bindings:process.env.GROUP_PILOT_BINDINGS_JSON,
 key:String(process.env.GROUP_PILOT_KEY||''),
 target:process.env.GROUP_PILOT_TARGET
});
// Load the SDK only after validation. A broken configuration must not start QR pairing.
const {create}=await import('@wppconnect-team/wppconnect');
let client,timer,closing=false,ticking=null;
try{
 client=await create({
  session:process.env.GROUP_PILOT_SESSION,
  folderNameToken:resolve(directory,'tokens'),
  puppeteerOptions:{userDataDir:resolve(directory,'browser')},
  headless:true,logQR:false,disableWelcome:true,updatesLog:false,
  disableGoogleAnalytics:true,debug:false,autoClose:120000,
  catchQR:base64=>{
   const matched=/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(base64||'');
   if(!matched)throw Error('QR em formato inesperado.');
   writeFileSync(qrFile,Buffer.from(matched[1],'base64'),{mode:0o600});
   console.info('QR disponivel no arquivo privado de emparelhamento. Nao compartilhe esse arquivo.');
  }
 });
 if(await client.getWid()!==process.env.GROUP_PILOT_EXPECTED_ACCOUNT)throw Error('Aparelho diferente do autorizado.');
 if(discovery){
  const groups=(await client.getAllGroups(false)).map(g=>({jid:typeof g.id==='string'?g.id:g.id?._serialized,name:g.name||g.formattedTitle||''})).filter(g=>/^[0-9]{5,30}(?:-[0-9]{5,20})?@g\.us$/.test(g.jid||''));
  writeFileSync(resolve(directory,'groups.json'),JSON.stringify(groups,null,2),{mode:0o600});
  await client.close();db.close();rmSync(qrFile,{force:true});
  console.info('Lista de nomes e identificadores salva no arquivo privado groups.json. Nenhum historico coletado.');
 }else{
 await client.onAnyMessage(message=>collector.accept(message));
 await client.onStateChange(state=>collector.setConnected(state==='CONNECTED'));
 const tick=()=>{
  if(ticking||closing)return ticking;
  ticking=(async()=>{
   try{collector.setConnected(await client.isConnected());}catch{collector.setConnected(false);}
   if(collector.state().connected)rmSync(qrFile,{force:true});
   await collector.flush();
  })().finally(()=>{ticking=null;});return ticking;
 };
 await tick();
 timer=setInterval(()=>{void tick();},30000);
 console.info('Piloto de leitura iniciado. Apenas grupos selecionados; sem envios e sem recuperacao retroativa.');
 const stop=async()=>{
  if(closing)return;closing=true;clearInterval(timer);collector.stop();await ticking;
  await collector.flush();await client.close();db.close();rmSync(qrFile,{force:true});
 };
 const handleStop=()=>{void stop().catch(()=>{console.error('Encerramento incompleto; confira o processo privado.');process.exitCode=1;});};
 process.once('SIGINT',handleStop);process.once('SIGTERM',handleStop);
 }
}catch{
 collector?.stop();clearInterval(timer);if(client)await client.close().catch(()=>{});
 db.close();rmSync(qrFile,{force:true});
 console.error('Coletor nao iniciou. Confira configuracao e sessao no computador privado. Nenhum detalhe sensivel foi impresso.');
 process.exitCode=1;
}
