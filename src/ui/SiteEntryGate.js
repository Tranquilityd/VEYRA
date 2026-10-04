import { SITE_ENTRY_CAPTCHA_PROVIDER } from '../config/publicEnv.js';
import { HCaptchaWidget } from './HCaptchaWidget.js';
import { TurnstileWidget } from './TurnstileWidget.js';

const MESSAGE={TURNSTILE_REQUIRED:'Complete the security check to enter Veyra.',TURNSTILE_FAILED:'Verification failed or expired. Please try again.',TURNSTILE_UNAVAILABLE:'Verification is temporarily unavailable. Please try again shortly.',CAPTCHA_REQUIRED:'Complete the security check to enter Veyra.',CAPTCHA_FAILED:'Verification failed or expired. Please try again.',CAPTCHA_UNAVAILABLE:'Verification is temporarily unavailable. Please try again shortly.'};
const EntryWidget=SITE_ENTRY_CAPTCHA_PROVIDER==='hcaptcha'?HCaptchaWidget:TurnstileWidget;

export class SiteEntryGate{
 constructor({button,container,status}){this.button=button;this.container=container;this.status=status;this.widget=null;this.verified=false;this.expiresAt=0;this.timer=null;this.checking=false;}
 async init(){this._lock('Checking verification…');try{const state=await this._request('GET');if(state.verified)return this._approve(state.expiresAt);this._mount();}catch{this._mount('Complete the verification to enter Veyra.');}}
 async authorize(){
  if(!this.verified||this.expiresAt<=Date.now()){this._expire();return false;}
  this.checking=true;this.button.disabled=true;this.status.textContent='Confirming verification…';
  try{const state=await this._request('GET');if(!state.verified){this._expire();return false;}this._approve(state.expiresAt);return true;}
  catch{this._lock('Unable to confirm verification. Please try again.');this._mount();return false;}
  finally{this.checking=false;if(this.verified)this.button.disabled=false;}
 }
 _mount(message='Complete the verification to enter Veyra.'){
  this.verified=false;clearTimeout(this.timer);this.button.disabled=true;this.status.textContent=message;this.widget?.dispose();
  this.widget=new EntryWidget(this.container,{action:'site_entry',onState:state=>this._state(state)});this.widget.mount();
 }
 async _state({state,message}){
  if(state==='verified'){
   const token=this.widget?.consume();if(!token)return this._mount('Complete the verification to enter Veyra.');
   this.checking=true;this.button.disabled=true;this.status.textContent='Verifying securely…';
   try{const result=await this._request('POST',{captchaToken:token});if(!result.verified)throw new Error('CAPTCHA_FAILED');this._approve(result.expiresAt);}
   catch(error){this.verified=false;this.status.textContent=MESSAGE[error.message]||'Verification failed. Please try again.';this.widget?.reset();}
   finally{this.checking=false;}
   return;
  }
  if(state==='loading'){this.status.textContent=message||'Loading security check…';return;}
  if(state==='before-interactive'||state==='after-interactive'){this.verified=false;this.button.disabled=true;this.status.textContent=message;return;}
  if(state==='expired'||state==='error'||state==='timeout'||state==='unsupported'){this.verified=false;this.button.disabled=true;this.status.textContent=message||'Verification expired. Please retry.';}
 }
 _approve(expiresAt){
  const expiry=Number(expiresAt);if(!Number.isFinite(expiry)||expiry<=Date.now())return this._expire();
  this.verified=true;this.expiresAt=expiry;this.button.disabled=false;this.button.classList.add('site-entry-ready');this.status.textContent='Verified';this.container.classList.add('verified');this.widget?.dispose();this.widget=null;clearTimeout(this.timer);this.timer=setTimeout(()=>this._expire(),Math.max(0,expiry-Date.now()));
 }
 _expire(){this.verified=false;this.expiresAt=0;this.button.classList.remove('site-entry-ready');this.container.classList.remove('verified');this._mount('Verification expired. Complete it again to enter Veyra.');}
 _lock(message){this.verified=false;this.button.disabled=true;this.status.textContent=message;}
 async _request(method,payload){
  const response=await fetch('/api/site-entry',{method,credentials:'same-origin',cache:'no-store',headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined});
  let data;try{data=await response.json();}catch{throw new Error('TURNSTILE_UNAVAILABLE');}
  if(!response.ok)throw new Error(data?.error||'TURNSTILE_UNAVAILABLE');return data;
 }
}
