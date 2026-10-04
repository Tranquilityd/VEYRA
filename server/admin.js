import crypto from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(crypto.scrypt);
const COOKIE='veyra_admin';
const required=(name,min=1)=>{const v=process.env[name];if(!v||v.length<min)throw new Error(`Missing/weak server environment variable: ${name}`);return v;};
const b64=(v)=>Buffer.from(v).toString('base64url');
const signature=(v)=>crypto.createHmac('sha256',required('ADMIN_SESSION_SECRET',32)).update(v).digest('base64url');
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const cookies=(req)=>Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2));
export function issueAdminSession(username){
 const csrf=crypto.randomBytes(24).toString('base64url');
 const payload=b64(JSON.stringify({role:'social_verifier',username,csrf,iat:Date.now(),exp:Date.now()+8*3600e3}));
 return {token:`${payload}.${signature(payload)}`,csrf};
}
export function setAdminCookie(res,token){res.setHeader('Set-Cookie',`${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);}
export function clearAdminCookie(res){res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);}
export function readAdmin(req,{csrf=false}={}){
 const token=cookies(req)[COOKIE], [payload,sig,extra]=String(token||'').split('.');
 if(!payload||!sig||extra||!equal(sig,signature(payload)))throw new Error('UNAUTHORIZED');
 let data;try{data=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{throw new Error('UNAUTHORIZED');}
 if(data.role!=='social_verifier'||data.exp<Date.now()||Date.now()-data.iat>8*3600e3)throw new Error('UNAUTHORIZED');
 if(csrf&&!equal(String(req.headers['x-csrf-token']||''),String(data.csrf||'')))throw new Error('UNAUTHORIZED');
 return data;
}
export function assertSameOrigin(req){
 const origin=String(req.headers.origin||''),host=String(req.headers['x-forwarded-host']||req.headers.host||'');
 if(!origin||!host){if(process.env.NODE_ENV==='production')throw new Error('UNAUTHORIZED');return;}
 let o;try{o=new URL(origin);}catch{throw new Error('UNAUTHORIZED');}
 if(o.host!==host||o.protocol!=='https:')throw new Error('UNAUTHORIZED');
}
export async function verifyAdminCredentials(username,password){
 const expectedUser=required('ADMIN_USERNAME'),encoded=required('ADMIN_PASSWORD_SCRYPT');
 const [saltHex,keyHex,extra]=encoded.split(':');
 if(!saltHex||!keyHex||extra||!/^[0-9a-f]+$/i.test(saltHex+keyHex))throw new Error('ADMIN_CONFIG_INVALID');
 const derived=await scrypt(String(password||''),Buffer.from(saltHex,'hex'),Buffer.from(keyHex,'hex').length,{N:16384,r:8,p:1,maxmem:64*1024*1024});
 return equal(String(username||''),expectedUser)&&equal(Buffer.from(derived).toString('hex'),keyHex.toLowerCase());
}
export const hashIp=(req)=>crypto.createHmac('sha256',required('ADMIN_SESSION_SECRET',32)).update(String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim()).digest('hex');
