import config from '../../server/blockchain-config-handler.js';
import transactions from '../../server/blockchain-transactions-handler.js';
import ltcPrice from '../../server/ltc-price-handler.js';
import claims from '../../server/casino-claims-handler.js';
import btcPrice from '../../server/btc-price-handler.js';
import { json } from '../../server/http.js';
export default function handler(req,res){
 const route=Array.isArray(req.query.route)?req.query.route[0]:req.query.route;
 if(route==='config')return config(req,res);
 if(route==='transactions')return transactions(req,res);
 if(route==='claims')return claims(req,res);
 if(route==='price')return ltcPrice(req,res);
 if(route==='btc-price')return btcPrice(req,res);
 return json(res,404,{ok:false,error:'NOT_FOUND'});
}
