import crypto from 'node:crypto';
import { env } from './env.js';

const COOKIE='veyra_site_entry';
export const SITE_ENTRY_TTL_MS=10*60*1000;
const b64=value=>Buffer.from(value).toString('base64url');
const sign=value=>crypto.createHmac('sha256',env.sessionSecret()).update(`site-entry:${value}`).digest('base64url');
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const cookies=req=>Object.fromEntries(String(req.headers?.cookie||'').split(';').map(part=>part.trim().split('=').map(decodeURIComponent)).filter(pair=>pair.length===2));

export function issueSiteEntrySession(now=Date.now()){
 const data={purpose:'site_entry',iat:now,exp:now+SITE_ENTRY_TTL_MS,nonce:crypto.randomBytes(16).toString('base64url')};
 const payload=b64(JSON.stringify(data));
 return{token:`${payload}.${sign(payload)}`,expiresAt:data.exp};
}

export function readSiteEntrySession(req,now=Date.now()){
 const [payload,signature,extra]=String(cookies(req)[COOKIE]||'').split('.');
 if(!payload||!signature||extra||!equal(signature,sign(payload)))return null;
 let data;try{data=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{return null;}
 if(data.purpose!=='site_entry'||!Number.isFinite(data.iat)||!Number.isFinite(data.exp)||data.exp<=now||data.exp-data.iat>SITE_ENTRY_TTL_MS)return null;
 return data;
}

export function setSiteEntryCookie(res,token){
 const secure=process.env.NODE_ENV==='production'?'; Secure':'';
 res.setHeader('Set-Cookie',`${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${Math.floor(SITE_ENTRY_TTL_MS/1000)}`);
}
