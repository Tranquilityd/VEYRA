import { HCAPTCHA_SITE_KEY } from '../config/publicEnv.js';

let loader;
function loadHCaptcha(){
 if(globalThis.hcaptcha)return Promise.resolve(globalThis.hcaptcha);
 if(loader)return loader;
 loader=new Promise((resolve,reject)=>{
  const existing=document.querySelector('script[data-veyra-hcaptcha]');
  if(existing){existing.addEventListener('load',()=>resolve(globalThis.hcaptcha),{once:true});existing.addEventListener('error',()=>reject(new Error('CAPTCHA_UNAVAILABLE')),{once:true});return;}
  const ready='__veyraHCaptchaReady';globalThis[ready]=()=>{delete globalThis[ready];globalThis.hcaptcha?resolve(globalThis.hcaptcha):reject(new Error('CAPTCHA_UNAVAILABLE'));};
  const script=document.createElement('script');script.src=`https://js.hcaptcha.com/1/api.js?render=explicit&onload=${ready}`;script.async=true;script.defer=true;script.dataset.veyraHcaptcha='1';script.onerror=()=>{delete globalThis[ready];reject(new Error('CAPTCHA_UNAVAILABLE'));};document.head.appendChild(script);
 });
 return loader;
}

export class HCaptchaWidget{
 constructor(container,{onState=()=>{},action}={}){this.container=container;this.onState=onState;this.action=action;this.id=null;this.token='';this.disposed=false;}
 async mount(){
  this.token='';this.onState({state:'loading',token:'',message:'Loading hCaptcha security check…'});
  if(!HCAPTCHA_SITE_KEY||HCAPTCHA_SITE_KEY.startsWith('__VEYRA_')){this.onState({state:'error',token:'',message:'Security verification is temporarily unavailable.'});return;}
  try{const api=await loadHCaptcha();if(this.disposed)return;this.id=api.render(this.container,{sitekey:HCAPTCHA_SITE_KEY,theme:'dark',size:'normal',...(this.action?{action:this.action}:{}),callback:(token)=>{this.token=token;this.onState({state:'verified',token});},'expired-callback':()=>{this.token='';this.onState({state:'expired',token:'',message:'Security verification expired. Please retry.'});},'error-callback':(errorCode)=>{this.token='';console.error('[Veyra hCaptcha diagnostic] error-callback:',errorCode);this.onState({state:'error',token:'',message:`Security verification failed. hCaptcha error: ${errorCode||'unknown'}`});}});}
  catch{if(!this.disposed)this.onState({state:'error',token:'',message:'Security verification is temporarily unavailable.'});}
 }
 consume(){const token=this.token;this.token='';return token;}
 reset(){this.token='';if(this.id!=null&&globalThis.hcaptcha){try{globalThis.hcaptcha.reset(this.id);}catch{}}this.onState({state:'waiting',token:''});}
 dispose(){this.disposed=true;this.token='';if(this.id!=null&&globalThis.hcaptcha){try{globalThis.hcaptcha.remove(this.id);}catch{}}this.id=null;if(this.container)this.container.innerHTML='';}
}
