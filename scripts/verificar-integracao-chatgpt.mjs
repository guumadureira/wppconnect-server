// Read-only configuration preflight. Never prints credentials, emails, phones or customer data.
import {DatabaseSync} from 'node:sqlite';
import {realpathSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {normalizeContactPhone,samePhone} from '../contact-phone.mjs';

const phoneList=value=>String(value||'').split(',').map(v=>v.trim()).filter(Boolean);
const publicOrigin=value=>/^https:\/\/[^/?#]+$/.test(String(value||'').replace(/\/$/,''));

export function inspectChatGPTConnection(db,config={}){
  const legacy=phoneList(config.CENTRAL_MCP_ALLOWED_PHONES);
  const scoped=phoneList(config.CHATGPT_OAUTH_ALLOWED_PHONES);
  const origin=String(config.PUBLIC_ORIGIN||config.RENDER_EXTERNAL_URL||'');
  const email=String(config.CHATGPT_OAUTH_ADMIN_EMAIL||'').trim().toLowerCase();
  const scopedPhonesValid=scoped.length>0&&scoped.every(p=>!!normalizeContactPhone(p));
  const scopeSubsetOfLegacy=scopedPhonesValid&&scoped.every(p=>legacy.some(l=>
    !!normalizeContactPhone(l)&&samePhone(l,p)));
  let activeAdmin=false;
  if(email.includes('@')&&email.length<=160){
    try{
      const entry=db.prepare("SELECT id FROM agents WHERE active=1 AND role='admin' AND lower(email)=? LIMIT 1").get(email);
      activeAdmin=!!entry;
    }catch{activeAdmin=false;}
  }
  const checks={
    httpsOrigin:publicOrigin(origin),
    administratorConfigured:email.includes('@')&&email.length<=160,
    activeAdministratorFound:activeAdmin,
    explicitChatGPTScope:scopedPhonesValid,
    scopeContainedInLegacy:scopeSubsetOfLegacy,
    oauthFeatureEnabled:String(config.CHATGPT_OAUTH_ENABLED)==='true'
  };
  const readyToEnable=Object.entries(checks).every(([key,ok])=>key==='oauthFeatureEnabled'||ok);
  return{
    checks,
    readyToEnable,
    readyForPrivateOAuthTest:readyToEnable&&checks.oauthFeatureEnabled,
    allowedOperation:'read_only',
    note:'This checks configuration and database metadata only. It does not test a ChatGPT login, change permissions or prove a live MCP connection.'
  };
}

function main(args,config){
  if(args.length!==2||args[0]!=='--database'||!args[1]||args[1]===':memory:'){
    throw Error('Forneça --database com o caminho do SQLite existente.');
  }
  const fullPath=realpathSync(resolve(args[1]));
  if(!statSync(fullPath).isFile())throw Error('Banco de dados não encontrado.');
  const db=new DatabaseSync(fullPath,{readOnly:true});
  try{
    return inspectChatGPTConnection(db,config);
  }finally{db.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const summary=main(process.argv.slice(2),process.env);
    console.log(JSON.stringify(summary,null,2));
    if(!summary.readyToEnable)process.exitCode=2;
  }catch{
    console.error('Pré-verificação não concluída. Confira o banco existente e as permissões. Nenhum dado foi alterado.');
    process.exitCode=1;
  }
}
