import { audit } from './audit.js';
export const REFERRAL_WAGER_REQUIREMENT='0.10000000';
export const REFERRAL_REWARD='0.05000000';
export async function qualifyReferralForUser(tx,referredUserId){
 const rows=await tx`SELECT * FROM referrals WHERE referred_user_id=${referredUserId} FOR UPDATE`;if(!rows[0]||rows[0].qualification_status==='qualified')return null;const referral=rows[0];
 const volume=await tx`SELECT COALESCE(SUM(wager),0) total FROM casino_sessions WHERE user_id=${referredUserId} AND status IN('wager_confirmed','resolved','paid')`;
 if(Number(volume[0].total)<Number(REFERRAL_WAGER_REQUIREMENT))return{qualified:false,volume:String(volume[0].total)};
 const qualified=await tx`UPDATE referrals SET qualification_status='qualified',reward_status='credited',qualified_at=NOW(),rewarded_at=NOW() WHERE id=${referral.id} AND qualification_status='pending' RETURNING *`;if(!qualified[0])return null;
 const balances=await tx`INSERT INTO arcade_balances(user_id,balance,lifetime_earned) VALUES(${referral.referrer_id},${REFERRAL_REWARD},${REFERRAL_REWARD}) ON CONFLICT(user_id) DO UPDATE SET balance=arcade_balances.balance+${REFERRAL_REWARD},lifetime_earned=arcade_balances.lifetime_earned+${REFERRAL_REWARD},updated_at=NOW() RETURNING balance`;
 await tx`INSERT INTO arcade_reward_history(user_id,referral_id,amount,balance_after,reason) VALUES(${referral.referrer_id},${referral.id},${REFERRAL_REWARD},${balances[0].balance},'referral') ON CONFLICT(referral_id) WHERE referral_id IS NOT NULL DO NOTHING`;
 await audit(tx,{userId:referral.referrer_id,action:'referral.qualified_rewarded',entityType:'referral',entityId:referral.id,metadata:{referredUserId,casinoWagerVolume:String(volume[0].total),reward:REFERRAL_REWARD}});return{qualified:true,volume:String(volume[0].total)};
}
