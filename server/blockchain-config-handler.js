import { publicBlockchainConfig } from './blockchain-config.js';
import { fail,json,method } from './http.js';
export default async function handler(req,res){if(!method(req,res,['GET']))return;try{const config=publicBlockchainConfig();if(!config)return json(res,503,{ok:false,error:'BLOCKCHAIN_UNCONFIGURED'});json(res,200,{ok:true,config});}catch(e){fail(res,e);}}
