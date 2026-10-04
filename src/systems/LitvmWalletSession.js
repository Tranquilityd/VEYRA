import { loadLitvmCasinoConfig } from '../config/litvmCasino.js';
import { loadLedger, refreshLedger, setBackendSessionToken } from '../games/arcadeRewards.js';
const STATES=new Set(['disconnected','connecting','connected','awaiting signature','submitted','confirming','confirmed','failed']);
const short=(a)=>a?`${a.slice(0,6)}…${a.slice(-4)}`:'Not connected';
export class LitvmWalletSession{
 constructor(events){this.events=events;this.adapter=null;this.account=null;this.mainBalance=null;this.arcadeBalance=0;this.state='disconnected';this.detail='';this.config=null;this.connectPromise=null;this.lifecycle=0;this.manualDisconnect=false;try{this.manualDisconnect=sessionStorage.getItem('veyra:manual-disconnect')==='1';}catch{}}
 snapshot(){return {state:this.state,detail:this.detail,address:this.account,addressShort:short(this.account),mainBalance:this.mainBalance,arcadeBalance:this.arcadeBalance,network:'LitVM Testnet',token:'zkLTC'};}
 _emit(){this.events.emit('litvm:wallet',this.snapshot());window.dispatchEvent(new CustomEvent('veyra:wallet',{detail:this.snapshot()}));}
 setState(state,detail=''){if(!STATES.has(state))throw new Error('Invalid wallet state');this.state=state;this.detail=detail;this._emit();}
 async _api(path,options={}){let token;try{token=sessionStorage.getItem('veyra:api-session');}catch{}const r=await fetch(path,{cache:'no-store',...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.headers||{})}});const d=await r.json();if(!r.ok)throw new Error(d.error||'Wallet request failed');return d;}
 async connect({userInitiated=false}={}){
  if(this.manualDisconnect&&!userInitiated)throw new Error('Wallet was manually disconnected. Press Connect Wallet to reconnect.');
  if(userInitiated){this.manualDisconnect=false;try{sessionStorage.removeItem('veyra:manual-disconnect');}catch{}}
  if(this.connectPromise)return this.connectPromise;
  const lifecycle=++this.lifecycle;
  this.connectPromise=this._connect(lifecycle);
  try{return await this.connectPromise;}finally{if(lifecycle===this.lifecycle)this.connectPromise=null;}
 }
 async _connect(lifecycle){
  this.setState('connecting','Connecting LitVM-compatible wallet…');
  try{
   this.config=await loadLitvmCasinoConfig();
   this.adapter=window.__VEYRA_LITVM_WALLET_ADAPTER__;
   if(!this.adapter)throw new Error('LitVM wallet adapter is not installed.');
   const session=await this.adapter.connect({config:this.config,network:'LitVM Testnet',token:'zkLTC'});
   if(lifecycle!==this.lifecycle)return this.snapshot();
   if(!session?.account)throw new Error('Wallet did not provide an account.');this.account=session.account;
   const challenge=await this._api('/api/auth/challenge',{method:'POST',body:JSON.stringify({wallet:this.account})});
   if(lifecycle!==this.lifecycle)return this.snapshot();
   this.setState('awaiting signature','Sign the Veyra login message. This is not a transaction.');
   const signature=await this.adapter.signMessage({account:this.account,message:challenge.message});
   if(lifecycle!==this.lifecycle)return this.snapshot();
   const verified=await this._api('/api/auth/verify',{method:'POST',body:JSON.stringify({wallet:this.account,nonce:challenge.nonce,signature})});
   if(lifecycle!==this.lifecycle)return this.snapshot();
   setBackendSessionToken(verified.token);this.setState('connected','Wallet authenticated on LitVM Testnet.');await this.refresh(lifecycle);
   if(lifecycle!==this.lifecycle)return this.snapshot();
   if(this.adapter.subscribe)this.adapter.subscribe({accountsChanged:(accounts)=>this._accountChanged(accounts),chainChanged:()=>this.refresh()});
   return this.snapshot();
  }catch(e){if(lifecycle!==this.lifecycle)return this.snapshot();this.account=null;this.mainBalance=null;this.setState('failed',e.message);throw e;}
 }
 async restore(){
  if(this.manualDisconnect)return null;
  let token;try{token=sessionStorage.getItem('veyra:api-session');}catch{}
  if(!token)return null;
  const lifecycle=++this.lifecycle;
  try{
   this.config=await loadLitvmCasinoConfig();if(lifecycle!==this.lifecycle)return null;this.adapter=window.__VEYRA_LITVM_WALLET_ADAPTER__;
   if(!this.adapter?.restore)return null;
   const session=await this.adapter.restore();if(lifecycle!==this.lifecycle||!session?.account)return null;
   this.account=session.account;this.setState('connected','Restored wallet session.');await this.refresh(lifecycle);
   if(lifecycle!==this.lifecycle)return null;
   if(this.adapter.subscribe)this.adapter.subscribe({accountsChanged:(accounts)=>this._accountChanged(accounts),chainChanged:()=>this.refresh()});
   return this.snapshot();
  }catch{if(lifecycle===this.lifecycle)this.disconnect({manual:false});return null;}
 }
 async _accountChanged(accounts){if(!accounts?.[0])return this.disconnect({manual:false});this.disconnect({manual:false});this.setState('failed','Wallet account changed. Reconnect and authenticate the new address.');}
 async refresh(lifecycle=this.lifecycle){
  if(!this.adapter||!this.account)throw new Error('Connect wallet first.');
  const adapter=this.adapter,account=this.account;
  try{const value=await adapter.getTokenBalance({account,token:this.config.token,config:this.config});if(lifecycle!==this.lifecycle||adapter!==this.adapter||account!==this.account)return this.snapshot();this.mainBalance=String(value);await refreshLedger();if(lifecycle!==this.lifecycle||account!==this.account)return this.snapshot();this.arcadeBalance=Number(loadLedger().tokens||0);this._emit();return this.snapshot();}
  catch(e){if(lifecycle!==this.lifecycle)return this.snapshot();this.setState('failed',`Balance refresh failed: ${e.message}`);throw e;}
 }
 setTransactionState(state,detail=''){this.setState(state,detail);}
 disconnect({manual=true}={}){this.lifecycle++;if(manual){this.manualDisconnect=true;try{sessionStorage.setItem('veyra:manual-disconnect','1');}catch{}}try{this.adapter?.disconnect?.({manual});}catch{}this.adapter=null;this.account=null;this.mainBalance=null;this.arcadeBalance=0;this.connectPromise=null;setBackendSessionToken(null);this.setState('disconnected',manual?'Wallet disconnected. Connect manually when ready.':'Wallet disconnected.');}
}
