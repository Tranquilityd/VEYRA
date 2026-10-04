import { readAdmin } from './admin.js';
import { db } from './db.js';
import { fail,json,method } from './http.js';
export default async function handler(req,res){
 if(!method(req,res,['GET']))return;
 try{readAdmin(req);const sql=db();
  const [stats,queue,withdrawals,casino,claims,blockchain,users,referrals,games,audits]=await Promise.all([
   sql`SELECT (SELECT count(*)::int FROM users) users,(SELECT count(*)::int FROM users WHERE last_activity_at>NOW()-INTERVAL '24 hours') active_users,(SELECT count(*)::int FROM game_sessions WHERE created_at>NOW()-INTERVAL '24 hours') arcade_sessions_24h,(SELECT count(*)::int FROM referrals WHERE created_at>NOW()-INTERVAL '24 hours') referrals_24h,(SELECT count(*)::int FROM social_verifications WHERE status='pending') verification_queue`,
   sql`SELECT s.id,s.x_username,s.submitted_at,s.status,s.reviewed_at,s.reviewer,s.review_note,s.attempt_number,(s.screenshot_data IS NOT NULL) has_screenshot,u.wallet_address,u.social_verified_at FROM social_verifications s JOIN users u ON u.id=s.user_id ORDER BY CASE WHEN s.status='pending' THEN 0 ELSE 1 END,s.submitted_at ASC LIMIT 100`,
   sql`SELECT w.id,w.user_id,w.amount,w.wallet,w.transaction_hash,w.payment_reference,w.status,w.requested_at,w.updated_at,w.completed_at,w.sent_at,w.sent_by,w.failure_reason,u.wallet_address AS user_wallet FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY CASE WHEN w.status='pending' THEN 0 ELSE 1 END,w.requested_at ASC LIMIT 100`,
   sql`SELECT c.id,c.game,c.wager,c.payout,c.wager_tx_hash,c.payout_tx_hash,c.status,c.created_at,c.resolved_at,u.wallet_address AS user_wallet FROM casino_sessions c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC LIMIT 50`,
   sql`SELECT id,casino_session_id,player_wallet,wager,payout,status,transaction_hash,failure_reason,expires_at,created_at,authorized_at,submitted_at,confirmed_at,claimed_at FROM casino_claims ORDER BY created_at DESC LIMIT 100`,
   sql`SELECT b.type,b.amount,b.contract_address,b.transaction_hash,b.status,b.confirmations,b.failure_reason,b.submitted_at,b.confirmed_at,u.wallet_address AS user_wallet FROM blockchain_transactions b JOIN users u ON u.id=b.user_id ORDER BY b.submitted_at DESC LIMIT 100`,
   sql`SELECT wallet_address,created_at,last_activity_at,social_verified_at,referral_code FROM users ORDER BY created_at DESC LIMIT 100`,
   sql`SELECT r.id,ru.wallet_address AS referrer_wallet,uu.wallet_address AS referred_wallet,r.referral_code,r.qualification_status,r.reward_status,r.created_at,r.qualified_at,r.rewarded_at FROM referrals r JOIN users ru ON ru.id=r.referrer_id JOIN users uu ON uu.id=r.referred_user_id ORDER BY r.created_at DESC LIMIT 100`,
   sql`SELECT g.game,g.score,g.waves,g.reward,g.validation_status,g.validation_reason,g.started_at,g.ended_at,u.wallet_address FROM game_sessions g JOIN users u ON u.id=g.user_id ORDER BY g.created_at DESC LIMIT 100`,
   sql`SELECT a.action,a.entity_type,a.entity_id,a.metadata,a.created_at,u.wallet_address FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 150`
  ]);
  json(res,200,{ok:true,stats:stats[0],verificationQueue:queue,withdrawals,casinoTransactions:casino,casinoClaims:claims,blockchainTransactions:blockchain,users,referrals,gameActivity:games,auditLogs:audits,permissions:{socialReview:true,manualWithdrawalStatus:true,paymentActions:false,casinoActions:false,balanceActions:false}});
 }catch(e){fail(res,e);}
}
