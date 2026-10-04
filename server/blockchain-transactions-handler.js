import { getAddress, parseEther } from 'viem';
import { requireAuth } from './auth.js';
import { blockchainTypes } from './blockchain-config.js';
import { validTransactionHash,verifyChainTransaction } from './blockchain.js';
import { db } from './db.js';
import { audit } from './audit.js';
import { body,fail,json,method } from './http.js';
import { qualifyReferralForUser } from './referral-qualification.js';
const atomicAmount=(value)=>{try{return parseEther(String(value));}catch{throw new Error('TRANSACTION_AMOUNT_MISMATCH');}};
const sameAmount=(a,b)=>atomicAmount(a)===atomicAmount(b);
const getAddressSafe=(v)=>getAddress(String(v)).toLowerCase();
const uintString=(value)=>{try{return BigInt(String(value)).toString();}catch{throw new Error('CLAIM_NOT_AUTHORIZED');}};
export const transactionMetadata=(verified)=>({
 eventOrMethod:verified.eventOrMethod||null,
 onchainSessionId:verified.sessionId||null,
 ...(verified.nonce!=null?{onchainNonce:verified.nonce}:{}),
});
export function assertPayoutAuthorization(related,verified,expectedWallet){
 const authorization=related?.authorization_payload;
 if(!authorization)throw new Error('CLAIM_NOT_AUTHORIZED');
 if(getAddressSafe(verified.user)!==getAddressSafe(expectedWallet))throw new Error('TRANSACTION_USER_MISMATCH');
 if(!sameAmount(verified.amount,related.payout))throw new Error('TRANSACTION_AMOUNT_MISMATCH');
 if(uintString(verified.sessionId)!==uintString(authorization.sessionId))throw new Error('TRANSACTION_SESSION_MISMATCH');
 if(uintString(verified.nonce)!==uintString(authorization.nonce))throw new Error('TRANSACTION_NONCE_MISMATCH');
 return true;
}
export default async function handler(req,res){
 if(!method(req,res,['GET','POST']))return;
 try{const auth=requireAuth(req),sql=db();
  if(req.method==='GET'){const rows=await sql`SELECT id,type,amount,contract_address,transaction_hash,status,related_entity_type,related_entity_id,block_number,confirmations,failure_reason,submitted_at,checked_at,confirmed_at FROM blockchain_transactions WHERE user_id=${auth.sub} ORDER BY submitted_at DESC LIMIT 100`;return json(res,200,{ok:true,transactions:rows});}
  const input=await body(req,8192),type=String(input.type||''),hash=String(input.transactionHash||'').toLowerCase();
  if(!blockchainTypes.includes(type)||!['casino_wager','casino_payout'].includes(type)||!validTransactionHash(hash))throw new Error('INVALID_INPUT');
  const users=await sql`SELECT wallet_address FROM users WHERE id=${auth.sub}`;if(!users[0])throw new Error('NOT_FOUND');
  let related,entityType;
  if(type==='casino_wager'){const r=await sql`SELECT * FROM casino_sessions WHERE user_id=${auth.sub} AND wager_tx_hash=${hash} LIMIT 1`;related=r[0];entityType='casino_session';}
  else if(type==='casino_payout'){if(!/^[0-9a-f-]{36}$/i.test(String(input.relatedId)))throw new Error('INVALID_INPUT');const r=await sql`SELECT * FROM casino_claims WHERE user_id=${auth.sub} AND id=${input.relatedId} LIMIT 1`;related=r[0];entityType='casino_claim';if(related&&getAddressSafe(related.player_wallet)!==getAddressSafe(users[0].wallet_address))throw new Error('TRANSACTION_USER_MISMATCH');}
  if(!related)throw new Error('NOT_FOUND');
  if(type==='casino_payout'&&!['authorized','submitted'].includes(related.status))throw new Error('CLAIM_NOT_AUTHORIZED');
  const verified=await verifyChainTransaction(type,hash,users[0].wallet_address);
  if(type==='casino_payout'&&verified.status==='confirmed')assertPayoutAuthorization(related,verified,users[0].wallet_address);
  if(verified.amount!=null&&!sameAmount(verified.amount,type==='casino_wager'?related.wager:(related.payout??verified.amount)))throw new Error('TRANSACTION_AMOUNT_MISMATCH');
  const row=await sql.begin(async tx=>{
   const rows=await tx`INSERT INTO blockchain_transactions(user_id,type,amount,contract_address,transaction_hash,status,related_entity_type,related_entity_id,block_number,confirmations,failure_reason,checked_at,confirmed_at,metadata)
    VALUES(${auth.sub},${type},${verified.amount},${verified.contract},${hash},${verified.status},${entityType},${related.id},${verified.blockNumber?.toString()||null},${verified.confirmations||0},${verified.failureReason||null},NOW(),${verified.confirmedAt||null},${tx.json(transactionMetadata(verified))})
    ON CONFLICT(transaction_hash) DO UPDATE SET status=EXCLUDED.status,amount=EXCLUDED.amount,block_number=EXCLUDED.block_number,confirmations=EXCLUDED.confirmations,failure_reason=EXCLUDED.failure_reason,checked_at=NOW(),confirmed_at=EXCLUDED.confirmed_at,metadata=blockchain_transactions.metadata || EXCLUDED.metadata
    WHERE blockchain_transactions.user_id=${auth.sub} AND blockchain_transactions.type=${type} AND blockchain_transactions.related_entity_id=${related.id} RETURNING *`;
   if(!rows[0])throw new Error('CONFLICT');
   if(type==='casino_payout'&&verified.status==='pending')await tx`UPDATE casino_claims SET status='submitted',transaction_hash=${hash},submitted_at=COALESCE(submitted_at,NOW()),updated_at=NOW() WHERE id=${related.id} AND user_id=${auth.sub} AND status IN ('authorized','submitted')`;
   if(verified.status==='confirmed'){
    if(type==='casino_wager'){await tx`UPDATE casino_sessions SET status='wager_confirmed',updated_at=NOW() WHERE id=${related.id} AND user_id=${auth.sub}`;await qualifyReferralForUser(tx,auth.sub);}
    if(type==='casino_payout'){
     await tx`UPDATE casino_claims SET status='claimed',transaction_hash=${hash},confirmed_at=NOW(),claimed_at=NOW(),failure_reason=NULL,updated_at=NOW() WHERE id=${related.id} AND user_id=${auth.sub} AND status IN ('authorized','submitted','confirmed')`;
     await tx`UPDATE casino_sessions SET status='paid',payout_tx_hash=${hash},updated_at=NOW() WHERE id=${related.casino_session_id} AND user_id=${auth.sub}`;
    }
   }else if(verified.status==='failed'){
    if(type==='casino_wager')await tx`UPDATE casino_sessions SET status='failed',updated_at=NOW() WHERE id=${related.id} AND user_id=${auth.sub}`;
    if(type==='casino_payout')await tx`UPDATE casino_claims SET status='failed',transaction_hash=${hash},failure_reason=${verified.failureReason||'transaction_failed'},updated_at=NOW() WHERE id=${related.id} AND user_id=${auth.sub} AND status<>'claimed'`;
   }
   await audit(tx,{userId:auth.sub,action:`blockchain.${verified.status}`,entityType:'blockchain_transaction',entityId:rows[0].id,metadata:{type,hash,amount:verified.amount,confirmations:verified.confirmations}});return rows[0];
  });
  json(res,verified.status==='confirmed'?200:202,{ok:true,transaction:row,retryAllowed:verified.status==='failed'});
 }catch(e){fail(res,e);}
}
