export const phoneDigits=value=>String(value||'').replace(/\D/g,'');
// Only Brazilian mobile variants. Never match just a suffix, name or DDD.
export function canonicalPhone(value){
  const n=phoneDigits(value);return /^55\d{2}[6-9]\d{7}$/.test(n)?n.slice(0,4)+'9'+n.slice(4):n;
}
export const samePhone=(a,b)=>/^[1-9]\d{7,14}$/.test(phoneDigits(a))&&canonicalPhone(a)===canonicalPhone(b);
