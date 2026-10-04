import { assertSameOrigin,readAdmin } from './admin.js';
import { db } from './db.js';
import { audit } from './audit.js';
import { body,fail,json,method } from './http.js';
export default async function handler(req,res){
 if(!method(req,res,['POST']))return;
 try{assertSameOrigin(req);const admin=readAdmin(req,{csrf:true}),input=await body(req,4096),id=String(input.id||''),action=String(input.action||'').toLowerCase();
  if(!/^[0-9a-f-]{36}$/i.test(id)||!['sent','cancelled','failed'].includes(action))throw new Error('INVALID_INPUT');
  const reference=String(input.paymentReference||'').trim();if(reference.length>160||(action==='sent'&&!reference))throw new Error('INVALID_INPUT');
  const sql=db(),record=await sql.begin(async tx=>{
   const found=await tx`SELECT w.*,u.wallet_address AS authenticated_wallet FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.id=${id} FOR UPDATE OF w,u`;
   if(!found[0])throw new Error('NOT_FOUND');const w=found[0];
   if(w.wallet.toLowerCase()!==w.authenticated_wallet.toLowerCase())throw new Error('CONFLICT');
   if(w.status===action)return w;if(w.status!=='pending')throw new Error('CONFLICT');
   if(action==='sent'){
    const balances=await tx`SELECT balance FROM arcade_balances WHERE user_id=${w.user_id} FOR UPDATE`;if(!balances[0]||Number(balances[0].balance)<Number(w.amount))throw new Error('INSUFFICIENT_ARCADE_BALANCE');
    await tx`UPDATE arcade_balances SET balance=balance-${w.amount},lifetime_withdrawn=lifetime_withdrawn+${w.amount},updated_at=NOW() WHERE user_id=${w.user_id}`;
    const rows=await tx`UPDATE withdrawals SET status='sent',payment_reference=${reference||null},transaction_hash=${/^0x[0-9a-f]{64}$/i.test(reference)?reference.toLowerCase():null},sent_at=NOW(),sent_by=${admin.username},completed_at=NOW(),updated_at=NOW() WHERE id=${id} AND status='pending' RETURNING *`;if(!rows[0])throw new Error('CONFLICT');
    await audit(tx,{userId:w.user_id,action:'withdrawal.sent',entityType:'withdrawal',entityId:id,metadata:{admin:admin.username,amount:String(w.amount),wallet:w.wallet,paymentReference:reference||null}});return rows[0];
   }
   const reason=String(input.reason||'').trim().slice(0,500);if(action==='failed'&&!reason)throw new Error('INVALID_INPUT');
   const rows=action==='cancelled'
    ?await tx`UPDATE withdrawals SET status='cancelled',failure_reason=${reason||null},cancelled_at=NOW(),cancelled_by=${admin.username},completed_at=NOW(),updated_at=NOW() WHERE id=${id} AND status='pending' RETURNING *`
    :await tx`UPDATE withdrawals SET status='failed',failure_reason=${reason},completed_at=NOW(),updated_at=NOW() WHERE id=${id} AND status='pending' RETURNING *`;
   if(!rows[0])throw new Error('CONFLICT');
   await audit(tx,{userId:w.user_id,action:`withdrawal.${action}`,entityType:'withdrawal',entityId:id,metadata:{admin:admin.username,reason}});return rows[0];
  });json(res,200,{ok:true,withdrawal:record});
 }catch(e){fail(res,e);}
}
