import { requireAuth } from '../server/auth.js';
import { db } from '../server/db.js';
import { audit } from '../server/audit.js';
import { body,fail,json,method } from '../server/http.js';
export default async function handler(req,res){
 if(!method(req,res,['GET','POST']))return;
 try{const auth=requireAuth(req),sql=db();
  if(req.method==='GET'){const rows=await sql`SELECT id,x_username,screenshot_reference,submitted_at,status,reviewed_at,reviewer FROM social_verifications WHERE user_id=${auth.sub} ORDER BY submitted_at DESC LIMIT 20`;return json(res,200,{ok:true,submissions:rows});}
  const input=await body(req);const username=String(input.xUsername||'').trim().replace(/^@/,'');const screenshot=String(input.screenshotReference||'').trim();
  if(!/^[A-Za-z0-9_]{1,15}$/.test(username)||screenshot.length<8||screenshot.length>500)throw new Error('INVALID_INPUT');
  const eligibility=await sql`SELECT social_verified_at,(SELECT count(*)::int FROM social_verifications WHERE user_id=${auth.sub} AND status='pending') pending FROM users WHERE id=${auth.sub}`;
  if(!eligibility[0]||eligibility[0].social_verified_at||eligibility[0].pending>0)throw new Error('CONFLICT');
  // screenshotReference must be an object-storage key/verified URL; image bytes do not enter the function/database.
  const rows=await sql`INSERT INTO social_verifications(user_id,x_username,screenshot_reference) VALUES(${auth.sub},${username},${screenshot}) RETURNING id,x_username,screenshot_reference,submitted_at,status`;
  await audit(sql,{userId:auth.sub,action:'social.submitted',entityType:'social_verification',entityId:rows[0].id});json(res,201,{ok:true,submission:rows[0]});
 }catch(e){fail(res,e);}
}
