import { requireAuth } from '../server/auth.js';
import { db } from '../server/db.js';
import { fail,json,method } from '../server/http.js';
export default async function handler(req,res){
 if(!method(req,res,['GET']))return;
 try{const auth=requireAuth(req),sql=db();const rows=await sql`INSERT INTO arcade_balances(user_id) VALUES(${auth.sub}) ON CONFLICT(user_id) DO UPDATE SET updated_at=arcade_balances.updated_at RETURNING balance,lifetime_earned,lifetime_withdrawn,updated_at`;
  const [reserved,history,withdrawals]=await Promise.all([sql`SELECT COALESCE(SUM(amount),0) amount FROM withdrawals WHERE user_id=${auth.sub} AND status='pending'`,sql`SELECT amount,balance_after,reason,created_at FROM arcade_reward_history WHERE user_id=${auth.sub} ORDER BY created_at DESC LIMIT 25`,sql`SELECT id,amount,wallet,transaction_hash,payment_reference,status,requested_at,updated_at,completed_at,sent_at,failure_reason FROM withdrawals WHERE user_id=${auth.sub} ORDER BY requested_at DESC LIMIT 25`]);
  const balance=rows[0],r=Number(reserved[0].amount);json(res,200,{ok:true,balance:{...balance,reserved:reserved[0].amount,available:Math.max(0,Number(balance.balance)-r).toFixed(8)},rewardHistory:history,withdrawalHistory:withdrawals});
 }catch(e){fail(res,e);}
}
