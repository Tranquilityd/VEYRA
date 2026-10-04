import crypto from 'node:crypto';
import { requireAuth } from '../server/auth.js';
import { db } from '../server/db.js';
import { audit } from '../server/audit.js';
import { body, fail, json, method } from '../server/http.js';
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode=()=>{let c='VEYRA-';const b=crypto.randomBytes(6);for(let i=0;i<6;i++)c+=alphabet[b[i]%alphabet.length];return c;};
export default async function handler(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    const auth=requireAuth(req),sql=db();
    if(req.method==='GET'){
      let rows=await sql`SELECT referral_code FROM users WHERE id=${auth.sub}`;
      if(!rows[0])throw new Error('NOT_FOUND');
      if(!rows[0].referral_code){for(let i=0;i<5;i++){try{rows=await sql`UPDATE users SET referral_code=${makeCode()} WHERE id=${auth.sub} AND referral_code IS NULL RETURNING referral_code`;if(rows[0])break;}catch(e){if(e.code!=='23505')throw e;}}}
      const refs=await sql`SELECT r.id,r.qualification_status,r.reward_status,r.created_at,u.wallet_address AS referred_wallet FROM referrals r JOIN users u ON u.id=r.referred_user_id WHERE r.referrer_id=${auth.sub} ORDER BY r.created_at DESC LIMIT 50`;
      return json(res,200,{ok:true,code:rows[0]?.referral_code,referrals:refs});
    }
    const input=await body(req), code=String(input.code||'').trim().toUpperCase();
    if(!/^VEYRA-[A-Z2-9]{6}$/.test(code))throw new Error('INVALID_INPUT');
    const out=await sql.begin(async tx=>{
      const owners=await tx`SELECT id FROM users WHERE referral_code=${code} FOR UPDATE`;if(!owners[0])throw new Error('NOT_FOUND');
      if(owners[0].id===auth.sub)throw new Error('CONFLICT');
      const rows=await tx`INSERT INTO referrals(referrer_id,referred_user_id,referral_code) VALUES(${owners[0].id},${auth.sub},${code}) RETURNING id,qualification_status,reward_status,created_at`;
      await audit(tx,{userId:auth.sub,action:'referral.redeemed',entityType:'referral',entityId:rows[0].id,metadata:{referrerId:owners[0].id}});return rows[0];
    });
    json(res,201,{ok:true,referral:out});
  }catch(e){if(e.code==='23505')e=new Error('CONFLICT');fail(res,e);}
}
