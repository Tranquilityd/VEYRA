import { TURNSTILE_SITE_KEY } from '../config/publicEnv.js';

let loader;
function loadTurnstile(){
 if(globalThis.turnstile)return Promise.resolve(globalThis.turnstile);
 if(loader)return loader;
 loader=new Promise((resolve,reject)=>{
  const existing=document.querySelector('script[data-veyra-turnstile]');
  if(existing){existing.addEventListener('load',()=>resolve(globalThis.turnstile),{once:true});existing.addEventListener('error',()=>reject(new Error('TURNSTILE_UNAVAILABLE')),{once:true});return;}
  const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.defer=true;script.dataset.veyraTurnstile='1';script.onload=()=>globalThis.turnstile?resolve(globalThis.turnstile):reject(new Error('TURNSTILE_UNAVAILABLE'));script.onerror=()=>reject(new Error('TURNSTILE_UNAVAILABLE'));document.head.appendChild(script);
 });
 return loader;
}

export class TurnstileWidget{
 constructor(container,{onState=()=>{},action}={}){this.container=container;this.onState=onState;this.action=action;this.id=null;this.token='';this.disposed=false;}
 async mount(){
  this.token='';this.onState({state:'loading',token:''});
  if(!TURNSTILE_SITE_KEY||TURNSTILE_SITE_KEY.startsWith('__VEYRA_')){this.onState({state:'error',token:'',message:'Security verification is temporarily unavailable.'});return;}
  // TEMPORARY DIAGNOSTIC: Capture Cloudflare lifecycle events without changing fail-closed behavior.
  try{const api=await loadTurnstile();if(this.disposed)return;this.id=api.render(this.container,{sitekey:TURNSTILE_SITE_KEY,theme:'dark',size:'flexible',appearance:'interaction-only',...(this.action?{action:this.action}:{}),callback:(token)=>{this.token=token;this.onState({state:'verified',token});},'before-interactive-callback':()=>{console.info('[Veyra Turnstile diagnostic] before-interactive');this.onState({state:'before-interactive',token:'',message:'Diagnostic: Cloudflare entered the interactive challenge.'});},'after-interactive-callback':()=>{console.info('[Veyra Turnstile diagnostic] after-interactive');this.onState({state:'after-interactive',token:'',message:'Diagnostic: Cloudflare left interactive mode; awaiting verification result.'});},'timeout-callback':()=>{this.token='';console.warn('[Veyra Turnstile diagnostic] timeout');if(this.id!=null){try{api.reset(this.id);}catch{}}this.onState({state:'timeout',token:'',message:'Diagnostic: Cloudflare challenge timed out. Please try again.'});},'unsupported-callback':()=>{this.token='';console.error('[Veyra Turnstile diagnostic] unsupported');this.onState({state:'unsupported',token:'',message:'Diagnostic: This browser environment is unsupported by Cloudflare Turnstile.'});},'expired-callback':()=>{this.token='';this.onState({state:'expired',token:'',message:'Security verification expired. Please retry.'});},'error-callback':(errorCode)=>{this.token='';console.error('[Veyra Turnstile diagnostic] error-callback:',errorCode);this.onState({state:'error',token:'',message:`Security verification failed to load. Turnstile error: ${errorCode||'unknown'}`});}});}
  catch{if(!this.disposed)this.onState({state:'error',token:'',message:'Security verification is temporarily unavailable.'});}
 }
 consume(){const token=this.token;this.token='';return token;}
 reset(){this.token='';if(this.id!=null&&globalThis.turnstile){try{globalThis.turnstile.reset(this.id);}catch{}}this.onState({state:'waiting',token:''});}
 dispose(){this.disposed=true;this.token='';if(this.id!=null&&globalThis.turnstile){try{globalThis.turnstile.remove(this.id);}catch{}}this.id=null;if(this.container)this.container.innerHTML='';}
}
