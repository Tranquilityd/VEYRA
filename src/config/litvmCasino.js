// Phase 12 — verified public contract data is loaded from the server registry.
// No address, ABI, method, RPC credential, or treasury value is embedded here.
export const EMPTY_LITVM_CASINO_CONFIG = Object.freeze({
  networkLabel: 'LitVM Testnet', chainId: null, publicRpcUrl: null,
  token: Object.freeze({ symbol: 'zkLTC', address: null, decimals: null, abi: [] }),
  casinoContractAddress: null, casinoAbi: null, roles: null, requiredConfirmations: null,
});
let cached=null;
export async function loadLitvmCasinoConfig(){
 if(cached)return cached;
 const r=await fetch('/api/blockchain/config',{cache:'no-store'});const d=await r.json();
 if(!r.ok||!d.config)throw new Error('Verified LitVM contract configuration is unavailable.');
 const c=d.config;
 cached=Object.freeze({networkLabel:c.network,chainId:c.chainId,publicRpcUrl:c.publicRpcUrl,
  token:Object.freeze(c.token),casinoContractAddress:c.contracts.casino.address,casinoAbi:c.contracts.casino.abi,
  roles:Object.freeze(c.roles),requiredConfirmations:c.requiredConfirmations});
 return cached;
}
export const casinoConfigReady=()=>!!cached;
