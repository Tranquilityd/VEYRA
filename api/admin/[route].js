import auth from '../../server/admin-auth-handler.js';
import dashboard from '../../server/admin-dashboard-handler.js';
import review from '../../server/admin-review-handler.js';
import socialProof from '../../server/admin-social-proof-handler.js';
import withdrawals from '../../server/admin-withdrawals-handler.js';
import { json } from '../../server/http.js';

export default function handler(req,res){
 const route=Array.isArray(req.query.route)?req.query.route[0]:req.query.route;
 if(route==='auth')return auth(req,res);
 if(route==='dashboard')return dashboard(req,res);
 if(route==='review')return review(req,res);
 if(route==='social-proof')return socialProof(req,res);
 if(route==='withdrawals')return withdrawals(req,res);
 return json(res,404,{ok:false,error:'NOT_FOUND'});
}
