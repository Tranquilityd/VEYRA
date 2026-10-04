import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fairInt, fairnessDigest, hashServerSeed, FAIRNESS_VERSION, FAIRNESS_ALGORITHM } from '../server/provably-fair.js';
import { generateCasinoOutcome } from '../server/casino-outcomes.js';
import { verifyFairRound } from '../src/games/provablyFair.js';

const serverSeed='0123456789abcdef'.repeat(4),clientSeed='veyra-test-client',nonce='00000000-0000-4000-8000-000000000042';
const fairness={version:FAIRNESS_VERSION,algorithm:FAIRNESS_ALGORITHM,serverSeedSecret:serverSeed,serverSeedHash:hashServerSeed(serverSeed),clientSeed,nonce};
const gen=(game,input={})=>generateCasinoOutcome(game,'0.001',input,{fairness});

test('same fairness inputs always produce the same digest and result',()=>{assert.equal(fairnessDigest(serverSeed,{clientSeed,nonce,game:'coin',subIndex:'draw:0'}),fairnessDigest(serverSeed,{clientSeed,nonce,game:'coin',subIndex:'draw:0'}));assert.deepEqual(gen('coin',{choice:'heads'}),gen('coin',{choice:'heads'}));});
test('changing client seed changes deterministic randomness',()=>assert.notEqual(fairInt(serverSeed,{clientSeed,nonce,game:'dice',subIndex:'draw:0'},2**31-1),fairInt(serverSeed,{clientSeed:'veyra-other-client',nonce,game:'dice',subIndex:'draw:0'},2**31-1)));
test('changing nonce changes deterministic randomness',()=>assert.notEqual(fairInt(serverSeed,{clientSeed,nonce,game:'dice',subIndex:'draw:0'},2**31-1),fairInt(serverSeed,{clientSeed,nonce:'43',game:'dice',subIndex:'draw:0'},2**31-1)));
test('changing server seed changes deterministic randomness',()=>assert.notEqual(fairInt(serverSeed,{clientSeed,nonce,game:'dice',subIndex:'draw:0'},2**31-1),fairInt('fedcba9876543210'.repeat(4),{clientSeed,nonce,game:'dice',subIndex:'draw:0'},2**31-1)));
test('revealed server seed hashes to committed hash',()=>assert.equal(createHash('sha256').update(serverSeed).digest('hex'),fairness.serverSeedHash));
const record=(game,input,outcome)=>({version:FAIRNESS_VERSION,algorithm:FAIRNESS_ALGORITHM,serverSeed,serverSeedHash:fairness.serverSeedHash,clientSeed,nonce,game,input,outcome});
test('client verifier reproduces Plinko individual ball outcomes',async()=>{const input={ballCount:5,risk:'high'},outcome=gen('plinko',input).outcome;assert.equal((await verifyFairRound(record('plinko',input,outcome))).ok,true);});
test('client verifier preserves historical v1 Plinko verification after rebalance',async()=>{
 const version='veyra-provably-fair-v1',input={ballCount:1,risk:'high'},old=[{scaled:0,weight:25},{scaled:500,weight:15},{scaled:1000,weight:15},{scaled:1500,weight:10},{scaled:2000,weight:10},{scaled:3000,weight:10},{scaled:5000,weight:10},{scaled:10000,weight:5}];let draw=0,col=0;const steps=[];
 for(let row=0;row<9;row++){col=Math.max(-4,Math.min(4,col+(fairInt(serverSeed,{clientSeed,nonce,game:'plinko',subIndex:`draw:${draw++}`},2)===0?-1:1)));steps.push(col);}
 let pick=fairInt(serverSeed,{clientSeed,nonce,game:'plinko',subIndex:`draw:${draw++}`},100),scaled=0;for(const item of old){if(pick<item.weight){scaled=item.scaled;break;}pick-=item.weight;}
 const legacy={version,algorithm:FAIRNESS_ALGORITHM,serverSeed,serverSeedHash:fairness.serverSeedHash,clientSeed,nonce,game:'plinko',input,outcome:{ballCount:1,risk:'high',balls:[{steps,multiplierScaled:String(scaled)}]}};
 assert.equal((await verifyFairRound(legacy)).ok,true);
});
test('client verifier reproduces Dice result',async()=>{const input={choice:'seven'},outcome=gen('dice',input).outcome;assert.equal((await verifyFairRound(record('dice',input,outcome))).ok,true);});
test('client verifier reproduces Coin result',async()=>{const input={choice:'tails'},outcome=gen('coin',input).outcome;assert.equal((await verifyFairRound(record('coin',input,outcome))).ok,true);});
test('client verifier reproduces Slot reels',async()=>{const outcome=gen('slot').outcome;assert.equal((await verifyFairRound(record('slot',{},outcome))).ok,true);});
test('tampering with the recorded result causes verification failure',async()=>{const input={choice:'heads'},outcome=gen('coin',input).outcome,tampered={...outcome,side:outcome.side==='heads'?'tails':'heads'};assert.equal((await verifyFairRound(record('coin',input,tampered))).ok,false);});
