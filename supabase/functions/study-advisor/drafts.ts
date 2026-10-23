const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = (v:any) => typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v+'T12:00:00Z')) && new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
export function validateDraft(input:any, complete=true) {
  if (!input || typeof input!=='object' || Array.isArray(input) || !['task','event'].includes(input.kind)) throw new Error('invalid_draft');
  const allowed=['kind','title','date','start_time','end_time'];
  if (Object.keys(input).some(k=>!allowed.includes(k))) throw new Error('invalid_draft');
  const title=typeof input.title==='string'?input.title.trim():'';
  if (!title || title.length>160 || (input.date && !date(input.date)) || (complete && !date(input.date))) throw new Error('invalid_draft');
  const start=input.start_time||'',end=input.end_time||'';
  if (input.kind==='task' && (start||end)) throw new Error('invalid_draft');
  if ((start||end) && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||end<=start)) throw new Error('invalid_draft');
  return {kind:input.kind,title,date:input.date||'',start_time:start,end_time:end};
}
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function key(secret:string) { return crypto.subtle.importKey('raw',new TextEncoder().encode('lyra-draft-v1:'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']); }
export async function prepareApproval(owner:string,draft:any,secret:string,now=Date.now(),operation=crypto.randomUUID()) {
  if(!uuid.test(operation))throw new Error('invalid_draft');
  const expires=now+5*60*1000;
  const payload={owner,operation,expires,draft:validateDraft(draft)};
  const data=encode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),new TextEncoder().encode(data))));
  return {token:data+'.'+signature,operation,expires};
}
export async function verifyApproval(token:any,owner:string,draft:any,secret:string,now=Date.now()) {
  try {
    if(typeof token!=='string'||token.length>4000)throw Error();
    const [data,signature,...extra]=token.split('.');
    if(extra.length||!await crypto.subtle.verify('HMAC',await key(secret),decode(signature),new TextEncoder().encode(data)))throw Error();
    const payload=JSON.parse(new TextDecoder().decode(decode(data)));
    if(payload.owner!==owner||!uuid.test(payload.operation)||payload.expires<now||payload.expires>now+300000||JSON.stringify(payload.draft)!==JSON.stringify(validateDraft(draft)))throw Error();
    return payload;
  } catch { throw new Error('approval_invalid'); }
}
export function parseAdvisorOutput(answer:string) {
  let parsed;
  try { parsed=JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g,'')); }
  catch { return {answer,draft:null}; }
  if(typeof parsed?.answer!=='string'||!parsed.answer.trim()) return {answer:'No pude preparar una respuesta completa. Reformula tu solicitud.',draft:null};
  try { return {answer:parsed.answer.trim().slice(0,6000),draft:parsed.draft?validateDraft(parsed.draft,false):null}; }
  catch { return {answer:parsed.answer.trim().slice(0,6000)+' Revisa tu solicitud: no pude preparar un borrador válido.',draft:null}; }
}
