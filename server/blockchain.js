import { createPublicClient,decodeEventLog,decodeFunctionData,formatUnits,getAddress,http } from 'viem';
import { loadBlockchainConfig } from './blockchain-config.js';
const HASH=/^0x[0-9a-f]{64}$/i;
const field=(args,name,ctx)=>{
 if(name==='$sender')return ctx.sender;if(name==='$value')return ctx.value;
 if(args==null)return undefined;if(Array.isArray(args)&&/^\d+$/.test(name))return args[Number(name)];return args[name];
};
let injectedTestClient=null;
export function setBlockchainClientForTests(client){
 if(process.env.NODE_ENV!=='test')throw new Error('TEST_CLIENT_INJECTION_FORBIDDEN');
 if(!client||typeof client.getTransaction!=='function'||typeof client.getTransactionReceipt!=='function'||typeof client.getBlockNumber!=='function')throw new Error('INVALID_TEST_BLOCKCHAIN_CLIENT');
 injectedTestClient=client;
}
export function resetBlockchainClientForTests(){
 if(process.env.NODE_ENV!=='test')throw new Error('TEST_CLIENT_INJECTION_FORBIDDEN');
 injectedTestClient=null;
}
const clientFor=(c)=>injectedTestClient||createPublicClient({chain:{id:c.chainId,name:c.network,nativeCurrency:{name:'LiteForge zkLTC',symbol:'zkLTC',decimals:18},rpcUrls:{default:{http:[c.rpcUrl]}}},transport:http(c.rpcUrl,{timeout:8_000,retryCount:1})});
export function extractVerifiedEventFields(args,role,ctx){
 const rawAmount=field(args,role.amountField,ctx),rawUser=field(args,role.userField,ctx);
 const rawSession=role.sessionField?field(args,role.sessionField,ctx):null;
 const rawNonce=role.nonceField?field(args,role.nonceField,ctx):null;
 if(rawAmount==null||rawUser==null||(role.sessionField&&rawSession==null)||(role.nonceField&&rawNonce==null))throw new Error('VERIFICATION_FIELD_MISSING');
 return {amount:formatUnits(BigInt(rawAmount),ctx.decimals),user:getAddress(String(rawUser)),sessionId:rawSession==null?null:BigInt(rawSession).toString(),nonce:rawNonce==null?null:BigInt(rawNonce).toString()};
}
export async function verifyChainTransaction(type,hash,expectedWallet){
 const c=loadBlockchainConfig();if(!c)throw new Error('BLOCKCHAIN_UNCONFIGURED');if(!HASH.test(String(hash)))throw new Error('INVALID_INPUT');
 const role=c.roles[type],contract=c.contracts[role.contract],client=clientFor(c),tx=await client.getTransaction({hash});
 if(!tx.to||getAddress(tx.to)!==getAddress(contract.address))throw new Error('CONTRACT_MISMATCH');
 let args,name,receipt=null;
 if(role.source==='method'){
  const decoded=decodeFunctionData({abi:contract.abi,data:tx.input});name=decoded.functionName;args=decoded.args;
  if(name!==role.name)throw new Error('CONTRACT_METHOD_MISMATCH');
 }
 try{receipt=await client.getTransactionReceipt({hash});}catch(e){if(!String(e.name).includes('ReceiptNotFound'))throw e;}
 if(receipt?.status==='reverted')return {status:'failed',amount:null,contract:contract.address,blockNumber:receipt.blockNumber,confirmations:0,failureReason:'transaction_reverted'};
 if(role.source==='event'&&receipt){
  let found;
  for(const log of receipt.logs){if(!log.address||getAddress(log.address)!==getAddress(contract.address))continue;try{const d=decodeEventLog({abi:contract.abi,data:log.data,topics:log.topics,strict:true});if(d.eventName===role.name){found=d;break;}}catch{/* unrelated log */}}
  if(!found)throw new Error('CONTRACT_EVENT_MISSING');name=found.eventName;args=found.args;
 }
 if(role.source==='event'&&!receipt)return {status:'pending',amount:null,contract:contract.address,blockNumber:null,confirmations:0};
 const extracted=extractVerifiedEventFields(args,role,{sender:tx.from,value:tx.value,decimals:c.token.decimals});
 if(extracted.user.toLowerCase()!==getAddress(expectedWallet).toLowerCase())throw new Error('TRANSACTION_USER_MISMATCH');
 if(!receipt)return {status:'pending',...extracted,contract:contract.address,blockNumber:null,confirmations:0};
 const latest=await client.getBlockNumber(),confirmations=Number(latest-receipt.blockNumber+1n);
 return {status:confirmations>=c.requiredConfirmations?'confirmed':'pending',...extracted,contract:contract.address,blockNumber:receipt.blockNumber,confirmations,eventOrMethod:name,confirmedAt:confirmations>=c.requiredConfirmations?new Date():null};
}
export const validTransactionHash=(v)=>HASH.test(String(v||''));
