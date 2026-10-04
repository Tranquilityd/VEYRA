import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CLAIM_QUANTUM_WEI,
  PLINKO_DISTRIBUTION_WEIGHTS,
  calculatePlinkoPayoutWei,
  generatePlinkoOutcome,
  parseZkLtcWei,
  selectPlinkoMultiplier,
  shouldCreateCasinoClaim,
  splitPlinkoWager,
  validatePlinkoSettings,
} from '../server/casino-outcomes.js';

const zeroRng=()=>0;
const highDraw=(max)=>max===2?1:max-1;

for(let count=1;count<=5;count++)test(`${count} Plinko ball${count===1?' is':'s are'} accepted`,()=>{
 assert.deepEqual(validatePlinkoSettings({ballCount:count,risk:'medium'}),{ballCount:count,risk:'medium'});
});
for(const count of [0,6,-1,1.5,'3',null])test(`invalid Plinko ball count ${String(count)} is rejected`,()=>{
 assert.throws(()=>validatePlinkoSettings({ballCount:count,risk:'medium'}),/INVALID_INPUT/);
});
for(const risk of ['low','medium','high'])test(`${risk} Plinko risk is accepted`,()=>{
 assert.equal(validatePlinkoSettings({ballCount:1,risk}).risk,risk);
});
for(const risk of [undefined,'','extreme','LOW',7])test(`invalid Plinko risk ${String(risk)} is rejected`,()=>{
 assert.throws(()=>validatePlinkoSettings({ballCount:1,risk}),/INVALID_INPUT/);
});

test('risk modes use the approved global Plinko distributions and RTP',()=>{
 const expected={
  low:{weights:[4,25,50,16,5],rtpPermille:965,profitablePermille:210},
  medium:{weights:[13,29,32,15,7,3,1],rtpPermille:970,profitablePermille:260},
  high:{weights:[72,42,36,20,14,8,6,2],rtpPermille:945,profitablePermille:250},
 };
 for(const [risk,distribution] of Object.entries(PLINKO_DISTRIBUTION_WEIGHTS)){
  assert.deepEqual(distribution.map(x=>x.weight),expected[risk].weights);
  const total=distribution.reduce((sum,x)=>sum+x.weight,0);
  const weighted=distribution.reduce((sum,x)=>sum+x.scaled*x.weight,0);
  const profitable=distribution.filter(x=>x.scaled>1000).reduce((sum,x)=>sum+x.weight,0);
  assert.equal(weighted/total,expected[risk].rtpPermille);
  assert.equal(profitable*1000/total,expected[risk].profitablePermille);
 }
 assert.notDeepEqual(PLINKO_DISTRIBUTION_WEIGHTS.low,PLINKO_DISTRIBUTION_WEIGHTS.medium);
 assert.notDeepEqual(PLINKO_DISTRIBUTION_WEIGHTS.medium,PLINKO_DISTRIBUTION_WEIGHTS.high);
});

test('0x multiplier produces exactly zero payout',()=>{
 assert.equal(selectPlinkoMultiplier('high',zeroRng),0);
 assert.equal(calculatePlinkoPayoutWei(123456789n,0),0n);
 const result=generatePlinkoOutcome('0.001',{ballCount:1,risk:'high'},zeroRng);
 assert.equal(result.balls[0].multiplier,'0×');
 assert.equal(result.balls[0].payoutWei,'0');
 assert.equal(result.totalPayoutWei,'0');
});

for(const [wager,count] of [['0.001',3],['0.007',5],['0.000500000000000001',4]])test(`${wager} split across ${count} balls preserves every wei`,()=>{
 const total=parseZkLtcWei(wager),shares=splitPlinkoWager(total,count);
 assert.equal(shares.reduce((sum,x)=>sum+x,0n),total);
 for(let i=1;i<shares.length-1;i++)assert.equal(shares[i],shares[0]);
 assert.ok(shares.at(-1)>=shares[0]);
 assert.ok(shares.at(-1)-shares[0]<BigInt(count));
});

test('0.001 / 3 assigns the complete remainder to the final ball',()=>{
 assert.deepEqual(splitPlinkoWager(parseZkLtcWei('0.001'),3),[
  333333333333333n,333333333333333n,333333333333334n,
 ]);
});

test('individual integer payouts sum exactly to aggregate payout',()=>{
 const result=generatePlinkoOutcome('0.007',{ballCount:5,risk:'high'},highDraw);
 const sum=result.balls.reduce((total,ball)=>total+BigInt(ball.payoutWei),0n);
 assert.equal(sum,BigInt(result.totalPayoutWei));
 assert.equal(BigInt(result.totalWagerWei),parseZkLtcWei('0.007'));
 result.balls.forEach(ball=>assert.equal(BigInt(ball.payoutWei)%CLAIM_QUANTUM_WEI,0n));
});

test('Plinko finance implementation contains no Number conversion or floating multiplication',()=>{
 const source=fs.readFileSync(new URL('../server/casino-outcomes.js',import.meta.url),'utf8');
 const financialSection=source.slice(source.indexOf('export function parseZkLtcWei'),source.indexOf('const multiplierLabel'));
 assert.doesNotMatch(financialSection,/Number\s*\(/);
 assert.doesNotMatch(financialSection,/parseFloat|toFixed/);
 assert.match(financialSection,/BigInt/);
});

test('zero aggregate payout creates no claim and positive aggregate uses one claim decision',()=>{
 assert.equal(shouldCreateCasinoClaim(0n),false);
 assert.equal(shouldCreateCasinoClaim(1n),true);
 const api=fs.readFileSync(new URL('../api/casino/session.js',import.meta.url),'utf8');
 assert.equal((api.match(/INSERT INTO casino_claims/g)||[]).length,1);
 assert.match(api,/ON CONFLICT\(casino_session_id\) DO NOTHING/);
});
