import { loadLitvmCasinoConfig } from '../config/litvmCasino.js';
export const MIN_WAGER='0.0005',MAX_WAGER='1';
export function validateWager(raw,balanceRaw,decimals=8){
 const text=String(raw==null?'':raw);if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text))return{ok:false,code:'FORMAT',message:'Enter a valid numeric zkLTC amount.'};
 const parts=text.split('.');if((parts[1]||'').length>decimals)return{ok:false,code:'PRECISION',message:`Use no more than ${decimals} decimal places.`};
 const scale=10n**BigInt(decimals),toAtomic=(v)=>{const p=String(v).split('.');return BigInt(p[0])*scale+BigInt((p[1]||'').padEnd(decimals,'0'));};
 const atomic=toAtomic(text);if(atomic<toAtomic(MIN_WAGER))return{ok:false,code:'MIN',message:`Minimum wager is ${MIN_WAGER} zkLTC.`};if(atomic>toAtomic(MAX_WAGER))return{ok:false,code:'MAX',message:`Maximum wager is ${MAX_WAGER} zkLTC.`};if(balanceRaw!=null&&atomic>toAtomic(balanceRaw))return{ok:false,code:'BALANCE',message:'Insufficient main-wallet zkLTC balance.'};
 return{ok:true,atomic,amount:parts[1]?`${parts[0]}.${parts[1]}`:parts[0],decimals};
}
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
class DevelopmentMockAdapter{
 constructor(){this.balance='10';this.seq=0;}
 async connect(){await wait(100);return{account:'DEV-MOCK-WALLET',network:'DEVELOPMENT MOCK — NOT BLOCKCHAIN'};}
 async getBalance(){return this.balance;}
 async submitWager({gameId,amount,atomic}){await wait(250);const n=Number(this.balance)-Number(amount);if(n<0)throw new Error('Insufficient mock balance');this.balance=n.toFixed(8).replace(/0+$/,'').replace(/\.$/,'');return{id:`DEV-MOCK-WAGER-${++this.seq}`,hash:null,gameId,amount,atomic:atomic.toString(),confirmed:true,mock:true};}
 async claimPayout({wager,payout}){await wait(200);this.balance=(Number(this.balance)+Number(payout)).toFixed(8).replace(/0+$/,'').replace(/\.$/,'');return{id:`DEV-MOCK-CLAIM-${++this.seq}`,hash:null,wagerId:wager.id,payout,confirmed:true,mock:true};}
}
export class CasinoWagerGateway{
 constructor(){const developmentHost=['localhost','127.0.0.1'].includes(location.hostname);this.mock=developmentHost&&new URLSearchParams(location.search).get('casinoMock')==='1';this.adapter=this.mock?new DevelopmentMockAdapter():null;this.account=null;this.config=null;this.pendingTracking=null;this.clientSeed=this._loadClientSeed();this.lastFairness=null;}
 _loadClientSeed(){try{const saved=localStorage.getItem('veyra:casino-client-seed');if(/^[A-Za-z0-9._:-]{8,128}$/.test(saved||''))return saved;}catch{}const bytes=globalThis.crypto.getRandomValues(new Uint8Array(12)),seed=`veyra-${[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('')}`;try{localStorage.setItem('veyra:casino-client-seed',seed);}catch{}return seed;}
 setClientSeed(seed){if(this.pendingTracking)throw new Error('Client seed cannot change during an active round.');if(!/^[A-Za-z0-9._:-]{8,128}$/.test(String(seed)))throw new Error('Client seed must be 8–128 letters, numbers, dots, colons, underscores, or hyphens.');this.clientSeed=String(seed);localStorage.setItem('veyra:casino-client-seed',this.clientSeed);return this.clientSeed;}
 get modeLabel(){return this.mock?'DEVELOPMENT MOCK — NO BLOCKCHAIN':'LITVM TESTNET · VERIFIED SETTLEMENT';}
 _apiToken(){try{return sessionStorage.getItem('veyra:api-session');}catch{return null;}}
 async _backend(path,payload){const token=this._apiToken();if(!token)throw new Error('Backend wallet session is required.');const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(payload)}),d=await r.json();if(!r.ok)throw new Error(d.error||'Backend request failed');return d;}
 async _backendGet(path){const token=this._apiToken();if(!token)throw new Error('Backend wallet session is required.');const r=await fetch(path,{headers:{Authorization:`Bearer ${token}`}}),d=await r.json();if(!r.ok)throw new Error(d.error||'Backend request failed');return d;}
 async _safeBalance(){try{return await this.balance();}catch{return null;}}
 async _trackWager(gameId,amount,receipt){if(this.mock)return{ok:true,mock:true};if(!receipt.hash)throw new Error('Confirmed adapter receipt omitted its transaction hash.');const session=await this._backend('/api/casino/session',{game:gameId,wager:amount,wagerTxHash:receipt.hash,clientSeed:this.clientSeed});receipt.backendSessionId=session.session.id;receipt.fairness=session.session.fairness;this.lastFairness=session.session.fairness;const tracked=await this._backend('/api/blockchain/transactions',{type:'casino_wager',transactionHash:receipt.hash});if(tracked.transaction?.status!=='confirmed')throw new Error(`Wager is ${tracked.transaction?.status||'pending'} in backend confirmation tracking.`);return tracked;}
 async _trackPayout(claim,receipt){if(this.mock)return{ok:true,mock:true};if(!receipt.hash||!claim?.id)throw new Error('Submitted claim is missing tracking identifiers.');const tracked=await this._backend('/api/blockchain/transactions',{type:'casino_payout',transactionHash:receipt.hash,relatedId:claim.id});if(tracked.transaction?.status!=='confirmed')throw new Error(`Claim is ${tracked.transaction?.status||'pending'} in blockchain confirmation tracking.`);return tracked;}
 async connect(){
  if(this.mock){this.config={networkLabel:'DEVELOPMENT MOCK',token:{decimals:8}};const s=this.account?{account:this.account}:await this.adapter.connect();this.account=s.account;return s;}
  const wallet=window.veyra?.walletSession;if(!wallet)throw new Error('Veyra wallet service is unavailable.');if(!wallet.account)throw new Error('Connect your wallet from the Game Main interface first.');this.config=wallet.config||await loadLitvmCasinoConfig();this.adapter=window.__VEYRA_LITVM_CASINO_ADAPTER__||wallet.adapter;if(!this.adapter||typeof this.adapter.submitWager!=='function'||typeof this.adapter.claimPayout!=='function')throw new Error('Verified LitVM casino settlement adapter is not installed.');this.account=wallet.account;return{account:this.account,network:'LitVM Testnet'};
 }
 disconnect(){this.adapter=this.mock?this.adapter:null;this.account=null;this.config=this.mock?this.config:null;}
 async balance(){if(!this.adapter||!this.account)return null;if(!this.mock&&window.veyra?.walletSession){await window.veyra.walletSession.refresh();return String(window.veyra.walletSession.mainBalance);}return String(await this.adapter.getBalance());}
 async wager(gameId,raw){
  if(!this.adapter||!this.account)await this.connect();if(!this.mock&&!this._apiToken())throw new Error('Sign in with your wallet before submitting a tracked wager.');const bal=await this.balance(),v=validateWager(raw,bal,this.mock?8:this.config.token.decimals);if(!v.ok)throw new Error(v.message);
  const wallet=this.mock?null:window.veyra?.walletSession;wallet?.setTransactionState('awaiting signature',`Sign wager ${v.amount} zkLTC in your wallet.`);let receipt;
  try{receipt=await this.adapter.submitWager({gameId,amount:v.amount,atomic:v.atomic,account:this.account,config:this.config,onState:(state,detail)=>wallet?.setTransactionState(state,detail)});}catch(e){wallet?.setTransactionState('failed',e.message);throw e;}
  if(!receipt||receipt.confirmed!==true){wallet?.setTransactionState('failed','Wager was not confirmed.');throw new Error('Wager transaction was not confirmed. No game started.');}
  wallet?.setTransactionState('confirming','Wager submitted; verifying LitVM confirmation.');receipt.gameId=gameId;receipt.amount=v.amount;let tracking;
  try{tracking=await this._trackWager(gameId,v.amount,receipt);wallet?.setTransactionState('confirmed',`Wager ${v.amount} zkLTC confirmed.`);}catch(e){tracking={ok:false,retryRequired:true,error:e.message};this.pendingTracking={kind:'wager',gameId,amount:v.amount,receipt};wallet?.setTransactionState('confirming','Wager awaits backend confirmation verification.');}
  return{validation:v,balance:await this.balance(),receipt,tracking};
 }
 async resolveOutcome(wager,gameId,makeMockOutcome,context={}){
  if(this.mock)return{outcome:makeMockOutcome(),payout:null,proof:'DEV-MOCK-LOCAL-ENGINE',mock:true};
  if(!wager.backendSessionId)throw new Error('Confirmed wager must be tracked before backend outcome resolution. Retry tracking; do not resubmit the wager.');
  const payload={action:'resolve',sessionId:wager.backendSessionId,choice:context.choice||null};if(gameId==='plinko'){payload.ballCount=context.ballCount??1;payload.risk=context.risk??'medium';}
  const d=await this._backend('/api/casino/session',payload),result=d.session.result;if(!result||result.engine!=='veyra-backend')throw new Error('Backend did not return a valid Veyra game result.');
  const outcome=gameId==='dice'?result.outcome.faces:gameId==='coin'?result.outcome.side:result.outcome;wager.authoritativePayout=Number(d.session.payout);wager.fairness=result.fairness;this.lastFairness={...result.fairness,game:gameId,outcome:result.outcome,payout:String(d.session.payout),input:{...context}};return{outcome,payout:wager.authoritativePayout,proof:`VEYRA-BACKEND-SESSION-${d.session.id}`,engine:result.engine,fairness:this.lastFairness};
 }
 async claim(wager,payout){
  if(!(Number(payout)>0))return{receipt:null,balance:await this.balance(),tracking:{ok:true}};
  if(this.mock){const receipt=await this.adapter.claimPayout({wager,payout});return{receipt,balance:await this.balance(),tracking:{ok:true,mock:true}};}
  if(!wager.backendSessionId)throw new Error('A verified casino session is required before claiming.');
  let prepared;
  try{prepared=await this._backend('/api/blockchain/claims',{action:'prepare',sessionId:wager.backendSessionId});}
  catch(error){
   // A prior attempt may have completed on-chain and in the backend even if a
   // non-critical balance refresh failed in the browser. Reconcile before ever
   // offering another payout transaction.
   try{const d=await this._backendGet('/api/blockchain/claims'),existing=(d.claims||[]).find(c=>c.casinoSessionId===wager.backendSessionId);if(existing?.status==='claimed')return{receipt:null,claim:existing,balance:await this._safeBalance(),tracking:{ok:true,alreadyClaimed:true}};}catch{}
   throw error;
  }
  const claim=prepared.claim;
  if(!claim||String(claim.playerWallet).toLowerCase()!==String(this.account).toLowerCase())throw new Error('Authorized claim wallet does not match the connected wallet.');
  const wallet=window.veyra?.walletSession;wallet?.setTransactionState('awaiting signature','Confirm the claim in your wallet.');let receipt;
  try{receipt=await this.adapter.claimPayout({claim,account:this.account,config:this.config,onState:(state,detail)=>wallet?.setTransactionState(state,detail)});}catch(e){wallet?.setTransactionState('failed',e.message||'Transaction rejected.');throw e;}
  if(!receipt?.hash){wallet?.setTransactionState('failed','Claim failed. Your winnings were not marked as claimed.');throw new Error('Claim transaction did not return a transaction hash.');}
  wallet?.setTransactionState('submitted','Claim submitted');let tracking;
  try{wallet?.setTransactionState('confirming','Waiting for blockchain confirmation...');tracking=await this._trackPayout(claim,receipt);wallet?.setTransactionState('confirmed','Winnings claimed');wallet?.refresh().catch(()=>{});}catch(e){tracking={ok:false,retryRequired:true,error:e.message};this.pendingTracking={kind:'payout',claim,receipt};wallet?.setTransactionState('confirming','Waiting for blockchain confirmation...');}
  // Settlement success must never be reclassified as claim failure merely
  // because a subsequent display-only balance refresh is unavailable.
  return{receipt,claim,balance:await this._safeBalance(),tracking};
 }
 async retryTracking(){const p=this.pendingTracking;if(!p)return{ok:true};const out=p.kind==='wager'?await this._trackWager(p.gameId,p.amount,p.receipt):await this._trackPayout(p.claim,p.receipt);this.pendingTracking=null;if(!this.mock&&window.veyra?.walletSession){window.veyra.walletSession.setTransactionState('confirmed',`${p.kind==='wager'?'Wager':'Payout'} transaction confirmed.`);window.veyra.walletSession.refresh().catch(()=>{});}return out;}
}
