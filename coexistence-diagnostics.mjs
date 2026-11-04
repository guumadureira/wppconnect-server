// Read-only Meta inspection. Credentials and webhook payloads never leave the server.
const numericId=value=>typeof value==='string'&&/^\d{5,30}$/.test(value);
export function createCoexistenceDiagnostics(db,config,transport=fetch,{ready=false}={}){
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  const observations=()=>db.prepare('SELECT field,deliveries,last_seen AS lastSeenAt FROM whatsapp_coexistence_observations ORDER BY field').all();
  async function read(path){
    const response=await transport('https://graph.facebook.com/'+config.META_GRAPH_VERSION+'/'+path,
      {method:'GET',headers:{authorization:'Bearer '+config.WHATSAPP_ACCESS_TOKEN},
        redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('A Meta não permitiu conferir esta informação com a credencial atual.');
    let result;
    try{result=await response.json();}catch{throw Error('A Meta retornou um diagnóstico inválido.');}
    if(!result||typeof result!=='object'||result.error)throw Error('A Meta não confirmou a consulta.');
    return result;
  }
  async function inspect(){
    const observation=observations();
    const result={
      checkedAt:new Date().toISOString(),credentialsPresent:!!ready,
      wabaConfigured:false,phoneLookupConfirmed:false,phoneMatches:false,coexistenceConfirmed:false,
      subscribedAppsLookupConfirmed:false,ourAppSubscriptionConfirmed:false,
      requiredWebhookFieldsConfirmed:false,deliveryConfirmed:!!get("SELECT 1 FROM messages WHERE direction='out' AND agent_name='Aplicativo Business (atendente não identificado)' LIMIT 1"),
      fieldsToVerify:['messages','history','smb_app_state_sync','smb_message_echoes'],
      observation
    };
    if(!ready)return {...result,diagnostic:'Configure a conexão ativa da Meta antes de consultar os dados da coexistência.'};
    const configuredWaba=String(config.WHATSAPP_BUSINESS_ACCOUNT_ID||
      get('SELECT waba_id FROM whatsapp_signup_checks WHERE id=1')?.waba_id||'').trim();
    if(!numericId(configuredWaba)){
      return {...result,diagnostic:'Informe o WABA ID no ambiente privado ou conclua a autorização de cadastro com o Business App.'};
    }
    result.wabaConfigured=true;
    try{
      const phones=await read(configuredWaba+'/phone_numbers?fields=id%2Cdisplay_phone_number%2Cplatform_type%2Cis_on_biz_app&limit=100');
      if(!Array.isArray(phones.data)||phones.paging?.next)throw Error('A lista de números não foi conferida integralmente.');
      result.phoneLookupConfirmed=true;
      const found=phones.data.filter(p=>String(p.id)===String(config.WHATSAPP_PHONE_NUMBER_ID));
      result.phoneMatches=found.length===1;
      result.coexistenceConfirmed=found.length===1&&found[0].is_on_biz_app===true
        &&found[0].platform_type==='CLOUD_API';
    }catch{
      result.phoneDiagnostic='Não foi possível confirmar o número ou a modalidade de coexistência pela Meta.';
    }
    try{
      const subscriptions=await read(configuredWaba+'/subscribed_apps?limit=100');
      if(!Array.isArray(subscriptions.data)||subscriptions.paging?.next)
        throw Error('A lista de aplicativos não foi conferida integralmente.');
      result.subscribedAppsLookupConfirmed=true;
      const configuredApp=String(config.META_APP_ID||'').trim();
      result.ourAppSubscriptionConfirmed=numericId(configuredApp)
        &&subscriptions.data.some(app=>String(app.id)===configuredApp);
    }catch{
      result.subscriptionDiagnostic='Não foi possível confirmar a assinatura do aplicativo na WABA.';
    }
    // Meta's subscriptions listing does not establish the delivery of each
    // coexistence field or that an override routes to this exact endpoint.
    return result;
  }
  return {inspect};
}
