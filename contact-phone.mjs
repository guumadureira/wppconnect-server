export const phoneDigits=value=>String(value||'').replace(/\D/g,'');
const brazilDDDs=new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
const localBrazil=value=>!String(value).trim().startsWith('+')&&brazilDDDs.has(phoneDigits(value).slice(0,2))&&/^\d{2}(?:[2-9]\d{7}|9[6-9]\d{7})$/.test(phoneDigits(value));
// Only Brazilian mobile variants. Never match just a suffix, name or DDD.
export function canonicalPhone(value){
  const n=phoneDigits(value);
  return /^55\d{2}[6-9]\d{7}$/.test(n)?n.slice(0,4)+'9'+n.slice(4):n;
}
export function samePhone(a,b){
  if(!/^[1-9]\d{7,14}$/.test(phoneDigits(a))||!/^[1-9]\d{7,14}$/.test(phoneDigits(b)))return false;
  let left=canonicalPhone(a),right=canonicalPhone(b);
  // Only infer Brazil when comparing a local DDD number with an explicit Brazilian number.
  if(/^55\d{10,11}$/.test(right)&&localBrazil(a))left=canonicalPhone('55'+phoneDigits(a));
  if(/^55\d{10,11}$/.test(left)&&localBrazil(b))right=canonicalPhone('55'+phoneDigits(b));
  return left===right;
}

export function normalizeContactPhone(value){
  if(typeof value!=='string'||!/^\+?[\d\s().-]+$/.test(value.trim()))return '';
  const n=canonicalPhone(localBrazil(value)?'55'+phoneDigits(value):value);return /^[1-9]\d{7,14}$/.test(n)?n:'';
}
