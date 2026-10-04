// Browser orchestration only: user wallet signs; Veyra never holds a treasury signer.
// Contract names/ABI/address come exclusively from the verified server registry.
const sessionToken=()=>{try{return sessionStorage.getItem('veyra:api-session');}catch{return null;}};
async function request(path,options={}){const token=sessionToken();if(!token)throw new Error('Wallet sign-in required.');const r=await fetch(path,{cache:'no-store',...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...(options.headers||{})}});const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d;}
let config;
export async function verifiedTreasuryConfig(){if(config)return config;const r=await fetch('/api/blockchain/config',{cache:'no-store'}),d=await r.json();if(!r.ok)throw new Error(d.error||'Verified LitVM configuration unavailable');config=d.config;return config;}
export class ArcadeWithdrawalGateway{
 constructor(){this.adapter=null;this.account=null;}
 async connect(){const c=await verifiedTreasuryConfig(),wallet=window.veyra?.walletSession;if(!wallet)throw new Error('Veyra wallet service is unavailable.');if(!wallet.account)await wallet.connect();const adapter=window.__VEYRA_LITVM_WITHDRAWAL_ADAPTER__||wallet.adapter;if(!adapter||typeof adapter.submitArcadeWithdrawal!=='function')throw new Error('Verified LitVM withdrawal wallet adapter is not installed.');this.adapter=adapter;this.account=wallet.account;return {account:this.account,network:'LitVM Testnet',config:c};}
 async submit(withdrawal){
  if(!this.adapter||!this.account)throw new Error('Connect a LitVM-compatible wallet first.');
  // Adapter maps the role descriptor to the verified ABI. No function signature is assumed here.
  const wallet=window.veyra?.walletSession;wallet?.setTransactionState('awaiting signature',`Sign arcade withdrawal ${withdrawal.amount} zkLTC.`);
  let receipt;try{receipt=await this.adapter.submitArcadeWithdrawal({withdrawal,account:this.account,config:await verifiedTreasuryConfig(),onState:(state,detail)=>wallet?.setTransactionState(state,detail)});}catch(e){wallet?.setTransactionState('failed',e.message);throw e;}
  if(!receipt||!receipt.hash){wallet?.setTransactionState('failed','Wallet returned no transaction hash.');throw new Error('Wallet did not return a transaction hash.');}
  wallet?.setTransactionState(receipt.confirmed?'confirmed':'confirming',receipt.confirmed?'Arcade withdrawal confirmed.':'Arcade withdrawal submitted; awaiting confirmation.');
  const tracked=await request('/api/blockchain/transactions',{method:'POST',body:JSON.stringify({type:'arcade_withdrawal',transactionHash:receipt.hash,relatedId:withdrawal.id})});
  if(tracked.transaction?.status==='confirmed'){wallet?.setTransactionState('confirmed','Arcade withdrawal confirmed on LitVM Testnet.');wallet?.refresh().catch(()=>{});}else if(tracked.transaction?.status==='failed')wallet?.setTransactionState('failed','Arcade withdrawal transaction failed; retry is available.');else wallet?.setTransactionState('confirming','Arcade withdrawal is confirming.');
  return {receipt,tracked};
 }
 async retryTracking(withdrawalId,transactionHash){return request('/api/blockchain/transactions',{method:'POST',body:JSON.stringify({type:'arcade_withdrawal',transactionHash,relatedId:withdrawalId})});}
}
export async function transactionHistory(){return request('/api/blockchain/transactions');}
