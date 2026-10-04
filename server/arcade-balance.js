import { audit } from './audit.js';
// Shared authoritative credit path. Only server validation code may call this.
// Referral amount/qualification policy is intentionally not invented here.
export async function creditArcadeBalance(tx,{userId,amount,source,sourceId}){
 if(!['arcade_session','referral'].includes(source)||!(Number(amount)>0))throw new Error('INVALID_REWARD_CREDIT');
 const link=source==='arcade_session'?{gameSessionId:sourceId,referralId:null}:{gameSessionId:null,referralId:sourceId};
 const balances=await tx`INSERT INTO arcade_balances(user_id,balance,lifetime_earned) VALUES(${userId},${amount},${amount})
  ON CONFLICT(user_id) DO UPDATE SET balance=arcade_balances.balance+${amount},lifetime_earned=arcade_balances.lifetime_earned+${amount},updated_at=NOW() RETURNING balance`;
 await tx`INSERT INTO arcade_reward_history(user_id,game_session_id,referral_id,amount,balance_after,reason)
  VALUES(${userId},${link.gameSessionId},${link.referralId},${amount},${balances[0].balance},${source})`;
 await audit(tx,{userId,action:'arcade_balance.credited',entityType:source,entityId:sourceId,metadata:{amount:String(amount),balanceAfter:String(balances[0].balance)}});
 return balances[0];
}
