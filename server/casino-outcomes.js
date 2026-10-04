import crypto from 'node:crypto';
import { fairInt, FAIRNESS_ALGORITHM, FAIRNESS_VERSION } from './provably-fair.js';

export const PLINKO_MULTIPLIER_SCALE = 1000n;
export const ZKLTC_DECIMALS = 18;
// Existing casino persistence and claim authorization use numeric(24,8). Each
// per-ball payout is therefore rounded half-up to this integer quantum after
// the scaled-multiplier division has first been floored to wei. No floating-
// point value enters Plinko accounting.
export const CLAIM_DECIMALS = 8;
export const CLAIM_QUANTUM_WEI = 10n ** BigInt(ZKLTC_DECIMALS - CLAIM_DECIMALS);
export const PLINKO_RISKS = Object.freeze(['low', 'medium', 'high']);

const PLINKO_DISTRIBUTIONS = Object.freeze({
 low: Object.freeze([
  { scaled: 0, weight: 4 }, { scaled: 500, weight: 25 },
  { scaled: 1000, weight: 50 }, { scaled: 1500, weight: 16 },
  { scaled: 2000, weight: 5 },
 ]),
 medium: Object.freeze([
  { scaled: 0, weight: 13 }, { scaled: 500, weight: 29 },
  { scaled: 1000, weight: 32 }, { scaled: 1500, weight: 15 },
  { scaled: 2000, weight: 7 }, { scaled: 3000, weight: 3 },
  { scaled: 5000, weight: 1 },
 ]),
 high: Object.freeze([
  { scaled: 0, weight: 72 }, { scaled: 500, weight: 42 },
  { scaled: 1000, weight: 36 }, { scaled: 1500, weight: 20 },
  { scaled: 2000, weight: 14 }, { scaled: 3000, weight: 8 },
  { scaled: 5000, weight: 6 }, { scaled: 10000, weight: 2 },
 ]),
});

const SYMBOLS=['7','★','♦','','♥'];
const legacyPayout=(bet,mult)=>Number((Number(bet)*mult).toFixed(8));
const slotMult=([a,b,c])=>{if(a===b&&b===c){if(a==='')return 0;if(a==='7')return 25;if(a==='★')return 12;return 8;}return ((a&&a===b)||(b&&b===c)||(a&&a===c))?2:0;};

export function validatePlinkoSettings(input={}) {
 const ballCount=input.ballCount;
 const risk=input.risk;
 if(!Number.isInteger(ballCount)||ballCount<1||ballCount>5)throw new Error('INVALID_INPUT');
 if(typeof risk!=='string'||!PLINKO_RISKS.includes(risk))throw new Error('INVALID_INPUT');
 return {ballCount,risk};
}

export function parseZkLtcWei(value) {
 const text=String(value);
 if(!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text))throw new Error('INVALID_INPUT');
 const [whole,fraction='']=text.split('.');
 return BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'));
}

export function formatZkLtcWei(value) {
 const wei=BigInt(value);if(wei<0n)throw new Error('INVALID_INPUT');
 const text=wei.toString().padStart(19,'0');
 const whole=text.slice(0,-18),fraction=text.slice(-18).replace(/0+$/,'');
 return fraction?`${whole}.${fraction}`:whole;
}

export function splitPlinkoWager(totalWagerWei,ballCount) {
 if(!Number.isInteger(ballCount)||ballCount<1||ballCount>5)throw new Error('INVALID_INPUT');
 const total=BigInt(totalWagerWei);if(total<0n)throw new Error('INVALID_INPUT');
 const count=BigInt(ballCount),base=total/count,remainder=total%count;
 return Array.from({length:ballCount},(_,i)=>i===ballCount-1?base+remainder:base);
}

export function calculatePlinkoPayoutWei(shareWei,multiplierScaled) {
 const share=BigInt(shareWei),multiplier=BigInt(multiplierScaled);
 if(share<0n||multiplier<0n)throw new Error('INVALID_INPUT');
 const exactWei=(share*multiplier)/PLINKO_MULTIPLIER_SCALE;
 return ((exactWei+CLAIM_QUANTUM_WEI/2n)/CLAIM_QUANTUM_WEI)*CLAIM_QUANTUM_WEI;
}

const multiplierLabel=(scaled)=>{
 const whole=Math.trunc(scaled/1000),fraction=scaled%1000;
 return fraction?`${whole}.${String(fraction).padStart(3,'0').replace(/0+$/,'')}×`:`${whole}×`;
};

const selectPlinkoOutcome = (risk,randomInt=crypto.randomInt) => {
 const distribution=PLINKO_DISTRIBUTIONS[risk];if(!distribution)throw new Error('INVALID_INPUT');
 const total=distribution.reduce((sum,item)=>sum+item.weight,0);let draw=randomInt(total);
 if(!Number.isInteger(draw)||draw<0||draw>=total)throw new Error('INVALID_RANDOM_SOURCE');
 for(let index=0;index<distribution.length;index++){const item=distribution[index];if(draw<item.weight)return{...item,index};draw-=item.weight;}
 throw new Error('INVALID_RANDOM_SOURCE');
};
export function selectPlinkoMultiplier(risk,randomInt=crypto.randomInt) {return selectPlinkoOutcome(risk,randomInt).scaled;}

export function generatePlinkoOutcome(wager,input={},randomInt=crypto.randomInt) {
 const {ballCount,risk}=validatePlinkoSettings(input),totalWagerWei=parseZkLtcWei(wager);
 const shares=splitPlinkoWager(totalWagerWei,ballCount);
 const balls=shares.map((share,index)=>{
  let col=0;const steps=[];for(let row=0;row<9;row++){col=Math.max(-4,Math.min(4,col+(randomInt(2)===0?-1:1)));steps.push(col);}
  const selected=selectPlinkoOutcome(risk,randomInt),multiplierScaled=selected.scaled;
  const payoutWei=calculatePlinkoPayoutWei(share,multiplierScaled);
  return {index:index+1,bin:selected.index,steps,wagerShareWei:share.toString(),multiplier:multiplierLabel(multiplierScaled),multiplierScaled:String(multiplierScaled),payoutWei:payoutWei.toString()};
 });
 const totalPayoutWei=balls.reduce((sum,ball)=>sum+BigInt(ball.payoutWei),0n);
 return {ballCount,risk,balls,totalWagerWei:totalWagerWei.toString(),totalPayoutWei:totalPayoutWei.toString()};
}

export const shouldCreateCasinoClaim=(totalPayoutWei)=>BigInt(totalPayoutWei)>0n;

export function generateCasinoOutcome(game,wager,input={},options={}){
 let outcome,multiplier=0,payout,draw=0;
 const fairness=options.fairness||null;
 const randomInt=options.randomInt||(fairness?max=>fairInt(fairness.serverSeedSecret,{clientSeed:fairness.clientSeed,nonce:fairness.nonce,game,subIndex:`draw:${draw++}`},max):crypto.randomInt);
 if(game==='plinko'){
  outcome=generatePlinkoOutcome(wager,input,randomInt);
  payout=formatZkLtcWei(outcome.totalPayoutWei);
  multiplier=null;
 }else if(game==='slot'){
  const reels=[0,1,2].map(()=>SYMBOLS[randomInt(SYMBOLS.length)]);multiplier=slotMult(reels);outcome=reels;payout=legacyPayout(wager,multiplier);
 }else if(game==='dice'){
  const choice=String(input.choice||'');if(!['under','seven','over'].includes(choice))throw new Error('INVALID_INPUT');const faces=[randomInt(6)+1,randomInt(6)+1],total=faces[0]+faces[1];multiplier=choice==='seven'?(total===7?5:0):choice==='under'?(total<7?2:0):(total>7?2:0);outcome={faces,choice,total};payout=legacyPayout(wager,multiplier);
 }else if(game==='coin'){
  const choice=String(input.choice||'');if(!['heads','tails'].includes(choice))throw new Error('INVALID_INPUT');const side=randomInt(2)===0?'heads':'tails';multiplier=choice===side?2:0;outcome={side,choice};payout=legacyPayout(wager,multiplier);
 }else throw new Error('INVALID_INPUT');
 return {outcome,multiplier,payout,engine:'veyra-backend',rng:fairness?FAIRNESS_ALGORITHM:'node:crypto.randomInt',version:fairness?FAIRNESS_VERSION:2};
}

export const PLINKO_DISTRIBUTION_WEIGHTS = PLINKO_DISTRIBUTIONS;
