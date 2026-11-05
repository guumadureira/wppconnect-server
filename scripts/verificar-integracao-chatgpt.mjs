// Read-only configuration preflight. Never prints credentials, emails, phones or customer data.
import {DatabaseSync} from 'node:sqlite';
import {realpathSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chatgptPolicy} from '../chatgpt-policy.mjs';

export function inspectChatGPTConnection(db,config={}){
  const policy=chatgptPolicy(config),email=policy.email;
  let activeAdmin=false;
  if(policy.administratorConfigured){
    try{
      const entry=db.prepare("SELECT id FROM agents WHERE active=1 AND role='admin' AND lower(email)=? LIMIT 1").get(email);
      activeAdmin=!!entry;
    }catch{activeAdmin=false;}
  }
  const checks={
    httpsOrigin:!!policy.origin,
    administratorConfigured:policy.administratorConfigured,
    activeAdministratorFound:activeAdmin,
    explicitChatGPTScope:policy.explicitScope,
    singleInternalPhone:policy.singlePhone,
    scopeContainedInLegacy:policy.scopeSubset,
    oauthFeatureEnabled:String(config.CHATGPT_OAUTH_ENABLED)==='true'
  };
  const oauthTables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chatgpt_oauth_pending','chatgpt_oauth_codes','chatgpt_oauth_access','chatgpt_oauth_refresh')").all().length;
  const readyToEnable=[0,4].includes(oauthTables)&&Object.entries(checks).every(([key,ok])=>key==='oauthFeatureEnabled'||ok);
  return{
    checks,
    oauthSchema:{expectedTables:4,presentTables:oauthTables,absent:oauthTables===0,complete:oauthTables===4},
    readyToEnable,
    readyForPrivateOAuthTest:readyToEnable&&checks.oauthFeatureEnabled&&oauthTables===4,
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
