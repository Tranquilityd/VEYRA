import { assertSameOrigin,readAdmin } from './admin.js';
import { db } from './db.js';
import { audit } from './audit.js';
import { body,fail,json,method } from './http.js';
export default async function handler(req,res){
 if(!method(req,res,['POST']))return;
 try{
  assertSameOrigin(req);const admin=readAdmin(req,{csrf:true}),input=await body(req,4096);
  if(!['approved','rejected'].includes(input.status)||!/^[0-9a-f-]{36}$/i.test(String(input.id)))throw new Error('INVALID_INPUT');
  const sql=db();const row=await sql.begin(async tx=>{
   const found=await tx`SELECT s.*,u.wallet_address,u.social_verified_at FROM social_verifications s JOIN users u ON u.id=s.user_id WHERE s.id=${input.id} FOR UPDATE OF s,u`;
   if(!found[0])throw new Error('NOT_FOUND');const item=found[0];
   if(item.status!=='pending')throw new Error('CONFLICT');
   if(input.status==='approved'&&item.social_verified_at)throw new Error('CONFLICT');
   const rows=await tx`UPDATE social_verifications SET status=${input.status},reviewed_at=NOW(),reviewer=${admin.username},review_note=${String(input.note||'').slice(0,500)} WHERE id=${input.id} RETURNING *`;
   if(input.status==='approved')await tx`UPDATE users SET social_verified_at=NOW() WHERE id=${item.user_id} AND social_verified_at IS NULL`;
   await audit(tx,{userId:item.user_id,action:`social.${input.status}`,entityType:'social_verification',entityId:item.id,metadata:{reviewer:admin.username,wallet:item.wallet_address}});
   return {...rows[0],wallet_address:item.wallet_address};
  });
  json(res,200,{ok:true,record:row});
 }catch(e){fail(res,e);}
}
