import { requireAuth } from '../server/auth.js';
import { normalizeWallet } from '../server/auth.js';
import { db } from '../server/db.js';
import { audit } from '../server/audit.js';
import { body,fail,json,method } from '../server/http.js';
export default async function handler(req,res){
 if(!method(req,res,['GET','POST']))return;
 try{const auth=requireAuth(req),sql=db();
  if(req.method==='GET'){const rows=await sql`SELECT id,amount,wallet,transaction_hash,status,requested_at,updated_at,completed_at FROM withdrawals WHERE user_id=${auth.sub} ORDER BY requested_at DESC LIMIT 50`;return json(res,200,{ok:true,withdrawals:rows});}
  const input=await body(req),amount=Number(input.amount),wallet=normalizeWallet(input.wallet);
  if(!Number.isFinite(amount)||amount<=0||!/^\d+(\.\d{1,8})?$/.test(String(input.amount)))throw new Error('INVALID_INPUT');
  const row=await sql.begin(async tx=>{
    const users=await tx`SELECT social_verified_at FROM users WHERE id=${auth.sub} FOR UPDATE`;
    if(!users[0]||!users[0].social_verified_at)throw new Error('CONFLICT');
    const balances=await tx`SELECT balance FROM arcade_balances WHERE user_id=${auth.sub} FOR UPDATE`;
    if(!balances[0]||Number(balances[0].balance)<amount)throw new Error('CONFLICT');
    const ws=await tx`INSERT INTO withdrawals(user_id,amount,wallet,status) VALUES(${auth.sub},${String(input.amount)},${wallet},'eligible') RETURNING *`;
    const updated=await tx`UPDATE arcade_balances SET balance=balance-${String(input.amount)},lifetime_withdrawn=lifetime_withdrawn+${String(input.amount)},updated_at=NOW() WHERE user_id=${auth.sub} RETURNING balance`;
    await audit(tx,{userId:auth.sub,action:'withdrawal.reserved',entityType:'withdrawal',entityId:ws[0].id,metadata:{amount:String(input.amount),wallet,balanceAfter:String(updated[0].balance)}});return ws[0];
  });json(res,201,{ok:true,withdrawal:row});
 }catch(e){fail(res,e);}
}
