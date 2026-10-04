import crypto from 'node:crypto';
import { formatEther, parseEther } from 'viem';
import { requireAuth } from '../../server/auth.js';
import { db } from '../../server/db.js';
import { audit } from '../../server/audit.js';
import { generateCasinoOutcome, shouldCreateCasinoClaim } from '../../server/casino-outcomes.js';
import { createFairnessCommitment, hashServerSeed, publicFairness, validateClientSeed } from '../../server/provably-fair.js';
import { body, fail, json, method } from '../../server/http.js';
const GAMES=new Set(['plinko','slot','dice','coin']),HASH=/^0x[0-9a-f]{64}$/i;
export default async function handler(req,res){
 if(!method(req,res,['POST']))return;
 try{
  const auth=requireAuth(req),input=await body(req),sql=db();
  if(input.action==='resolve'){
   if(!/^[0-9a-f-]{36}$/i.test(String(input.sessionId)))throw new Error('INVALID_INPUT');
   const resolved=await sql.begin(async tx=>{
    const rows=await tx`SELECT c.*,u.wallet_address FROM casino_sessions c JOIN users u ON u.id=c.user_id WHERE c.id=${input.sessionId} AND c.user_id=${auth.sub} FOR UPDATE OF c`;
    const session=rows[0];if(!session)throw new Error('NOT_FOUND');
    if(session.status==='resolved'||session.status==='paid')return session;
    if(session.status!=='wager_confirmed')throw new Error('CONFLICT');
    const commitment=session.result?.fairness;
    if(commitment?.serverSeedSecret&&hashServerSeed(commitment.serverSeedSecret)!==commitment.serverSeedHash)throw new Error('FAIRNESS_COMMITMENT_INVALID');
    // Sessions created before v1 deployment remain resolvable through the legacy
    // engine; every newly created session has a pre-outcome commitment.
    const generated=generateCasinoOutcome(session.game,String(session.wager),{choice:input.choice,ballCount:input.ballCount,risk:input.risk},commitment?{fairness:commitment}:{});
    const result={...generated,fairness:commitment?publicFairness(commitment,{reveal:true}):null,generatedAt:new Date().toISOString()};
    const updated=await tx`UPDATE casino_sessions SET result=${tx.json(result)},payout=${generated.payout},status='resolved',resolved_at=NOW(),updated_at=NOW() WHERE id=${session.id} RETURNING *`;
    const createClaim=session.game==='plinko'?shouldCreateCasinoClaim(generated.outcome.totalPayoutWei):Number(generated.payout)>0;
    if(createClaim)await tx`INSERT INTO casino_claims(casino_session_id,user_id,player_wallet,wager,payout,status) VALUES(${session.id},${auth.sub},${session.wallet_address},${session.wager},${generated.payout},'pending') ON CONFLICT(casino_session_id) DO NOTHING`;
    await audit(tx,{userId:auth.sub,action:'casino.outcome_resolved',entityType:'casino_session',entityId:session.id,metadata:{game:session.game,wager:String(session.wager),payout:String(generated.payout),engine:generated.engine}});
    return updated[0];
   });
   return json(res,200,{ok:true,session:{id:resolved.id,game:resolved.game,wager:resolved.wager,result:resolved.result,payout:resolved.payout,status:resolved.status}});
  }
  const hash=String(input.wagerTxHash||'').toLowerCase(),clientSeed=validateClientSeed(input.clientSeed);
  let wagerAtomic;try{wagerAtomic=parseEther(String(input.wager));}catch{throw new Error('INVALID_INPUT');}
  if(!GAMES.has(input.game)||wagerAtomic<parseEther('0.0005')||wagerAtomic>parseEther('1')||!HASH.test(hash))throw new Error('INVALID_INPUT');
  const wager=formatEther(wagerAtomic);
  // The existing result JSONB safely stores the private commitment server-side;
  // creation responses expose only its hash. Resolution replaces it with the reveal.
  const id=crypto.randomUUID(),commitment=createFairnessCommitment(clientSeed,id),pendingResult={fairness:commitment};
  const rows=await sql`INSERT INTO casino_sessions(id,user_id,game,wager,wager_tx_hash,status,result)
    VALUES(${id},${auth.sub},${input.game},${wager},${hash},'pending_verification',${sql.json(pendingResult)})
    ON CONFLICT(wager_tx_hash) WHERE wager_tx_hash IS NOT NULL DO UPDATE SET updated_at=NOW()
    RETURNING id,game,wager,status,result,created_at`;
  await audit(sql,{userId:auth.sub,action:'casino.wager_recorded',entityType:'casino_session',entityId:rows[0].id,metadata:{wagerTxHash:hash,status:'pending_verification'}});
  const created=rows[0],storedFairness=created.result?.fairness,fairness=storedFairness?{version:storedFairness.version,algorithm:storedFairness.algorithm,clientSeed:storedFairness.clientSeed,nonce:String(storedFairness.nonce),serverSeedHash:storedFairness.serverSeedHash}:null;
  json(res,202,{ok:true,session:{id:created.id,game:created.game,wager:created.wager,status:created.status,createdAt:created.created_at,fairness},message:'Awaiting independent LitVM wager confirmation.'});
 }catch(e){fail(res,e);}
}
