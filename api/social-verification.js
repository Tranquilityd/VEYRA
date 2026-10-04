import { requireAuth } from '../server/auth.js';
import { db } from '../server/db.js';
import { audit } from '../server/audit.js';
import { body,fail,json,method } from '../server/http.js';
const IMAGE=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const validImage=(mime,b)=>mime==='image/png'?b.length>=8&&b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):mime==='image/jpeg'?b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff:mime==='image/webp'?b.length>=12&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP':false;
export default async function handler(req,res){
 if(!method(req,res,['GET','POST']))return;
 try{const auth=requireAuth(req),sql=db();
  if(req.method==='GET'){const [user,rows]=await Promise.all([sql`SELECT social_verified_at FROM users WHERE id=${auth.sub}`,sql`SELECT id,x_username,submitted_at,status,reviewed_at,reviewer,review_note,attempt_number FROM social_verifications WHERE user_id=${auth.sub} ORDER BY submitted_at DESC LIMIT 20`]);if(!user[0])throw new Error('NOT_FOUND');return json(res,200,{ok:true,status:user[0].social_verified_at?'not_required':rows[0]?.status||'verification_required',submissions:rows});}
  const input=await body(req,1_200_000),username=String(input.xUsername||'').trim().replace(/^@/,''),match=String(input.screenshotData||'').match(IMAGE);
  if(!/^[A-Za-z0-9_]{1,15}$/.test(username)||!match)throw new Error('INVALID_INPUT');const image=Buffer.from(match[2],'base64');if(image.length<1024||image.length>800_000||!validImage(match[1],image))throw new Error('INVALID_INPUT');
  const record=await sql.begin(async tx=>{const users=await tx`SELECT social_verified_at FROM users WHERE id=${auth.sub} FOR UPDATE`;if(!users[0])throw new Error('NOT_FOUND');if(users[0].social_verified_at)throw new Error('CONFLICT');const pending=await tx`SELECT id FROM social_verifications WHERE user_id=${auth.sub} AND status='pending'`;if(pending[0])throw new Error('CONFLICT');const attempts=await tx`SELECT COALESCE(MAX(attempt_number),0)+1 attempt FROM social_verifications WHERE user_id=${auth.sub}`;const rows=await tx`INSERT INTO social_verifications(user_id,x_username,screenshot_reference,screenshot_data,screenshot_mime,attempt_number) VALUES(${auth.sub},${username},${`db:${auth.sub}:${attempts[0].attempt}`},${image},${match[1]},${attempts[0].attempt}) RETURNING id,x_username,submitted_at,status,attempt_number`;await audit(tx,{userId:auth.sub,action:'social.submitted',entityType:'social_verification',entityId:rows[0].id,metadata:{attempt:attempts[0].attempt}});return rows[0];});
  json(res,201,{ok:true,submission:record});
 }catch(e){fail(res,e);}
}
