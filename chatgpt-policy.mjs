import {normalizeContactPhone,samePhone} from './contact-phone.mjs';

// Shared by runtime and read-only preflight; the private pilot permits one contact.
export function chatgptPolicy(config={}){
  let origin='';
  try{
    const raw=String(config.PUBLIC_ORIGIN||config.RENDER_EXTERNAL_URL||'').replace(/\/$/,'');
    const parsed=new URL(raw);
    if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&parsed.origin===raw)origin=raw;
  }catch{}
  const list=value=>String(value||'').split(',').map(x=>x.trim()).filter(Boolean);
  const phones=list(config.CHATGPT_OAUTH_ALLOWED_PHONES),legacy=list(config.CENTRAL_MCP_ALLOWED_PHONES);
  const email=String(config.CHATGPT_OAUTH_ADMIN_EMAIL||'').trim().toLowerCase();
  const explicitScope=phones.length>0&&phones.every(p=>!!normalizeContactPhone(p));
  const singlePhone=explicitScope&&phones.length===1;
  const scopeSubset=explicitScope&&phones.every(p=>legacy.some(l=>!!normalizeContactPhone(l)&&samePhone(l,p)));
  const administratorConfigured=/^[^\s@]+@[^\s@]+$/.test(email)&&email.length<=160;
  return{origin,email,phones,explicitScope,singlePhone,scopeSubset,administratorConfigured,
    ready:!!origin&&administratorConfigured&&singlePhone&&scopeSubset};
}
