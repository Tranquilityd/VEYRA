import { assertSameOrigin,clearAdminCookie,hashIp,issueAdminSession,readAdmin,setAdminCookie,verifyAdminCredentials } from './admin.js';
import { db } from './db.js';
import { audit } from './audit.js';
import { body,fail,json,method } from './http.js';
export default async function handler(req,res){
 if(!method(req,res,['GET','POST','DELETE']))return;
 try{
  if(req.method==='GET'){const admin=readAdmin(req);return json(res,200,{ok:true,admin:{username:admin.username,role:admin.role},csrf:admin.csrf,expiresAt:admin.exp});}
  assertSameOrigin(req);
  if(req.method==='DELETE'){readAdmin(req,{csrf:true});clearAdminCookie(res);return json(res,200,{ok:true});}
  const input=await body(req,4096),sql=db(),ipHash=hashIp(req);
  const rate=await sql`SELECT count(*)::int AS failures FROM admin_login_attempts WHERE ip_hash=${ipHash} AND succeeded=false AND attempted_at>NOW()-INTERVAL '15 minutes'`;
  if(rate[0].failures>=5){await audit(sql,{action:'admin.login_rate_limited',entityType:'admin_session',metadata:{ipHash}});return json(res,429,{ok:false,error:'TOO_MANY_ATTEMPTS'});}
  const valid=await verifyAdminCredentials(input.username,input.password);
  await sql`INSERT INTO admin_login_attempts(ip_hash,succeeded) VALUES(${ipHash},${valid})`;
  if(!valid){await audit(sql,{action:'admin.login_failed',entityType:'admin_session',metadata:{ipHash}});throw new Error('UNAUTHORIZED');}
  const session=issueAdminSession(String(input.username));setAdminCookie(res,session.token);
  await audit(sql,{action:'admin.login_succeeded',entityType:'admin_session',metadata:{ipHash}});
  json(res,200,{ok:true,admin:{username:String(input.username),role:'social_verifier'},csrf:session.csrf});
 }catch(e){fail(res,e);}
}
