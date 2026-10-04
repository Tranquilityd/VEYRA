import { env } from './env.js';

const VERIFY_URL='https://api.hcaptcha.com/siteverify';
const TOKEN=/^[A-Za-z0-9._~-]{20,4096}$/;

export async function verifyHcaptchaToken({token,remoteIp=null,expectedAction,fetchImpl=fetch}){
 const response=String(token||'').trim(),action=String(expectedAction||'');
 if(!TOKEN.test(response))throw new Error('CAPTCHA_REQUIRED');
 if(action!=='site_entry')throw new Error('CAPTCHA_FAILED');
 const form=new URLSearchParams({secret:env.hcaptchaSecretKey(),response});
 if(remoteIp)form.set('remoteip',String(remoteIp).split(',')[0].trim());
 let result;
 try{
  const request=await fetchImpl(VERIFY_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(8000)});
  if(!request.ok)throw new Error('HTTP_'+request.status);
  result=await request.json();
  if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.success!=='boolean')throw new Error('MALFORMED_RESPONSE');
 }catch(error){
  console.warn('[hcaptcha] verification unavailable',{type:error?.name||'request_error'});
  throw new Error('CAPTCHA_UNAVAILABLE');
 }
 if(!result.success||(result.action!=null&&result.action!==action)){
  console.warn('[hcaptcha] verification rejected',{codes:Array.isArray(result['error-codes'])?result['error-codes'].slice(0,5):[],actionMatch:result.action==null||result.action===action});
  throw new Error('CAPTCHA_FAILED');
 }
 return{success:true,hostname:result.hostname||null,challengeTs:result.challenge_ts||null,action:result.action||action};
}
