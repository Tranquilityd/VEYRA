import { readAdmin } from './admin.js';
import { db } from './db.js';
import { fail,method } from './http.js';
export default async function handler(req,res){
 if(!method(req,res,['GET']))return;
 try{readAdmin(req);const id=String(new URL(req.url,'http://local').searchParams.get('id')||'');if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('INVALID_INPUT');const rows=await db()`SELECT screenshot_data,screenshot_mime FROM social_verifications WHERE id=${id}`;if(!rows[0]?.screenshot_data)throw new Error('NOT_FOUND');res.statusCode=200;res.setHeader('Content-Type',rows[0].screenshot_mime||'application/octet-stream');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(rows[0].screenshot_data);
 }catch(e){fail(res,e);}
}
