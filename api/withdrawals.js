import { requireAuth } from '../server/auth.js';
import { db } from '../server/db.js';
import { audit } from '../server/audit.js';
import { body,fail,json,method } from '../server/http.js';
import { requestIp,verifyTurnstileToken } from '../server/turnstile.js';
const AMOUNT=/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/,KEY=/^[A-Za-z0-9_-]{16,100}$/;
const MIN=0.005;
export default async function handler(req,res){
 if(!method(req,res,['GET','POST']))return;
 try{const auth=requireAuth(req),sql=db();
  if(req.method==='GET'){
   const [account,rows]=await Promise.all([
    sql`SELECT u.wallet_address,u.social_verified_at,COALESCE(b.balance,0) balance,
      COALESCE((SELECT SUM(w.amount) FROM withdrawals w WHERE w.user_id=u.id AND w.status='pending'),0) reserved,
      EXISTS(SELECT 1 FROM withdrawals w WHERE w.user_id=u.id AND w.status='sent') has_sent,
      (SELECT status FROM social_verifications s WHERE s.user_id=u.id ORDER BY submitted_at DESC LIMIT 1) verification_status
      FROM users u LEFT JOIN arcade_balances b ON b.user_id=u.id WHERE u.id=${auth.sub}`,
    sql`SELECT id,amount,wallet,transaction_hash,payment_reference,status,requested_at,updated_at,completed_at,sent_at,failure_reason FROM withdrawals WHERE user_id=${auth.sub} ORDER BY requested_at DESC LIMIT 50`
   ]);if(!account[0])throw new Error('NOT_FOUND');const a=account[0],available=Math.max(0,Number(a.balance)-Number(a.reserved));
   return json(res,200,{ok:true,account:{balance:a.balance,reserved:a.reserved,available:available.toFixed(8),wallet:a.wallet_address,minimum:MIN,verificationStatus:a.has_sent||a.social_verified_at?'not_required':a.verification_status||'verification_required'},withdrawals:rows});
  }
  const input=await body(req),raw=String(input.amount||''),amount=Number(raw),key=String(input.idempotencyKey||'');
  if(!AMOUNT.test(raw)||!Number.isFinite(amount)||amount<MIN||!KEY.test(key))throw new Error('INVALID_INPUT');
  // Verify the one-time challenge server-side before entering the existing
  // withdrawal transaction. Success never reserves or deducts Arcade Balance.
  await verifyTurnstileToken({token:input.turnstileToken,remoteIp:requestIp(req),expectedAction:'arcade_withdrawal'});
  const row=await sql.begin(async tx=>{
   await tx`SELECT pg_advisory_xact_lock(hashtext(${String(auth.sub)}))`;
   const duplicate=await tx`SELECT * FROM withdrawals WHERE user_id=${auth.sub} AND idempotency_key=${key}`;if(duplicate[0])return duplicate[0];
   const users=await tx`SELECT id,wallet_address,social_verified_at FROM users WHERE id=${auth.sub} FOR UPDATE`;if(!users[0])throw new Error('NOT_FOUND');
   const balances=await tx`INSERT INTO arcade_balances(user_id) VALUES(${auth.sub}) ON CONFLICT(user_id) DO UPDATE SET updated_at=arcade_balances.updated_at RETURNING balance`;
   const sent=await tx`SELECT EXISTS(SELECT 1 FROM withdrawals WHERE user_id=${auth.sub} AND status='sent') value`;
   if(!sent[0].value&&!users[0].social_verified_at)throw new Error('VERIFICATION_REQUIRED');
   const pending=await tx`SELECT COALESCE(SUM(amount),0) reserved FROM withdrawals WHERE user_id=${auth.sub} AND status='pending'`;
   const available=Number(balances[0].balance)-Number(pending[0].reserved);if(amount>available+1e-10)throw new Error('INSUFFICIENT_ARCADE_BALANCE');
   const ws=await tx`INSERT INTO withdrawals(user_id,amount,wallet,status,idempotency_key) VALUES(${auth.sub},${raw},${users[0].wallet_address},'pending',${key}) RETURNING *`;
   await audit(tx,{userId:auth.sub,action:'withdrawal.requested',entityType:'withdrawal',entityId:ws[0].id,metadata:{amount:raw,wallet:users[0].wallet_address,availableAfter:(available-amount).toFixed(8)}});return ws[0];
  });json(res,201,{ok:true,withdrawal:row});
 }catch(e){fail(res,e);}
}
