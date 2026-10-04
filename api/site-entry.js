import { assertSameOrigin } from '../server/admin.js';
import { env } from '../server/env.js';
import { verifyHcaptchaToken } from '../server/hcaptcha.js';
import { body,fail,json,method } from '../server/http.js';
import { issueSiteEntrySession,readSiteEntrySession,setSiteEntryCookie } from '../server/site-entry.js';
import { requestIp,verifyTurnstileToken } from '../server/turnstile.js';

const siteEntryVerifier=()=>env.siteEntryCaptchaProvider()==='hcaptcha'?verifyHcaptchaToken:verifyTurnstileToken;
export function createSiteEntryHandler({verify=null,issue=issueSiteEntrySession}={}){return async function handler(req,res){
 if(!method(req,res,['GET','POST']))return;
 try{
  if(req.method==='GET'){
   const session=readSiteEntrySession(req);
   return json(res,200,{ok:true,verified:!!session,expiresAt:session?.exp||null});
  }
  assertSameOrigin(req);
  const input=await body(req,8192);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('INVALID_INPUT');
  const verifyToken=verify||siteEntryVerifier();
  await verifyToken({token:input.captchaToken||input.turnstileToken,remoteIp:requestIp(req),expectedAction:'site_entry'});
  const session=issue();
  setSiteEntryCookie(res,session.token);
  json(res,200,{ok:true,verified:true,expiresAt:session.expiresAt});
 }catch(error){fail(res,error);}
};}

export default createSiteEntryHandler();
