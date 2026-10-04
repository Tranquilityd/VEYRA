import { env } from './env.js';

const VERIFY_URL='https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TOKEN=/^[A-Za-z0-9._~-]{20,4096}$/;

export async function verifyTurnstileToken({token,remoteIp=null,expectedAction,fetchImpl=fetch}){
 const response=String(token||'').trim(),action=String(expectedAction||'');
 if(!TOKEN.test(response))throw new Error('TURNSTILE_REQUIRED');
 if(!/^[a-z0-9_-]{1,32}$/.test(action))throw new Error('TURNSTILE_FAILED');
 const form=new URLSearchParams({secret:env.turnstileSecretKey(),response});
 if(remoteIp)form.set('remoteip',String(remoteIp).split(',')[0].trim());
 let result;
 try{
  const request=await fetchImpl(VERIFY_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(8000)});
  if(!request.ok)throw new Error('HTTP_'+request.status);
  result=await request.json();
 }catch(error){
  // Never log the response token or secret. Operational category only.
  console.warn('[turnstile] verification unavailable',{type:error?.name||'request_error'});
  throw new Error('TURNSTILE_UNAVAILABLE');
 }
 if(!result?.success||result.action!==action){
  console.warn('[turnstile] verification rejected',{codes:Array.isArray(result?.['error-codes'])?result['error-codes'].slice(0,5):[],actionMatch:result?.action===action});
  throw new Error('TURNSTILE_FAILED');
 }
 return{success:true,hostname:result.hostname||null,challengeTs:result.challenge_ts||null,action:result.action};
}

export function requestIp(req){return req.headers?.['cf-connecting-ip']||req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||null;}
