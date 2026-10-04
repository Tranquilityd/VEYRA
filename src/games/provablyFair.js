export const FAIRNESS_VERSION='veyra-provably-fair-v2';
export const FAIRNESS_ALGORITHM='HMAC-SHA256';
const SYMBOLS=['7','★','♦','','♥'];
const DISTRIBUTIONS_BY_VERSION={
 'veyra-provably-fair-v1':{
  low:[{scaled:0,weight:1},{scaled:500,weight:20},{scaled:1000,weight:45},{scaled:1500,weight:25},{scaled:2000,weight:9}],
  medium:[{scaled:0,weight:8},{scaled:500,weight:22},{scaled:1000,weight:30},{scaled:1500,weight:20},{scaled:2000,weight:12},{scaled:3000,weight:6},{scaled:5000,weight:2}],
  high:[{scaled:0,weight:25},{scaled:500,weight:15},{scaled:1000,weight:15},{scaled:1500,weight:10},{scaled:2000,weight:10},{scaled:3000,weight:10},{scaled:5000,weight:10},{scaled:10000,weight:5}],
 },
 'veyra-provably-fair-v2':{
  low:[{scaled:0,weight:4},{scaled:500,weight:25},{scaled:1000,weight:50},{scaled:1500,weight:16},{scaled:2000,weight:5}],
  medium:[{scaled:0,weight:13},{scaled:500,weight:29},{scaled:1000,weight:32},{scaled:1500,weight:15},{scaled:2000,weight:7},{scaled:3000,weight:3},{scaled:5000,weight:1}],
  high:[{scaled:0,weight:72},{scaled:500,weight:42},{scaled:1000,weight:36},{scaled:1500,weight:20},{scaled:2000,weight:14},{scaled:3000,weight:8},{scaled:5000,weight:6},{scaled:10000,weight:2}],
 },
};
const bytes=s=>new TextEncoder().encode(String(s));
const hex=a=>[...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function sha256(value){return hex(await crypto.subtle.digest('SHA-256',bytes(value)));}
export async function fairnessDigest(serverSeed,{clientSeed,nonce,game,subIndex}){const key=await crypto.subtle.importKey('raw',bytes(serverSeed),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,bytes(`${clientSeed}:${nonce}:${game}:${subIndex}`)));}
export async function fairInt(serverSeed,base,subIndex,max){const digest=await fairnessDigest(serverSeed,{...base,subIndex});return Number(BigInt(`0x${digest.slice(0,13)}`)%BigInt(max));}
const plinkoPick=(distribution,draw)=>{for(const item of distribution){if(draw<item.weight)return item.scaled;draw-=item.weight;}throw new Error('Invalid Plinko distribution');};
export async function reproduceFairOutcome(record){
 const {serverSeed,clientSeed,nonce,game}=record;if(!serverSeed)throw new Error('Server seed has not been revealed.');const distributions=DISTRIBUTIONS_BY_VERSION[record.version];if(!distributions)throw new Error('Unsupported fairness version.');let draw=0;const next=max=>fairInt(serverSeed,{clientSeed,nonce,game},`draw:${draw++}`,max);
 if(game==='plinko'){const count=Number(record.input?.ballCount),risk=record.input?.risk,balls=[];for(let i=0;i<count;i++){let col=0;const steps=[];for(let row=0;row<9;row++){col=Math.max(-4,Math.min(4,col+((await next(2))===0?-1:1)));steps.push(col);}const distribution=distributions[risk],total=distribution.reduce((s,x)=>s+x.weight,0),scaled=plinkoPick(distribution,await next(total));balls.push({steps,multiplierScaled:String(scaled)});}return{ballCount:count,risk,balls};}
 if(game==='slot')return Promise.all([0,1,2].map(async()=>SYMBOLS[await next(SYMBOLS.length)]));
 if(game==='dice'){const faces=[await next(6)+1,await next(6)+1];return{faces,total:faces[0]+faces[1]};}
 if(game==='coin')return{side:(await next(2))===0?'heads':'tails'};
 throw new Error('Unsupported fairness game.');
}
export async function verifyFairRound(record){
 if(!DISTRIBUTIONS_BY_VERSION[record.version]||record.algorithm!==FAIRNESS_ALGORITHM)return{ok:false,reason:'Unsupported fairness version.'};
 if(await sha256(record.serverSeed)!==record.serverSeedHash)return{ok:false,reason:'Server seed does not match its commitment.'};
 const expected=await reproduceFairOutcome(record),actual=record.outcome;let ok=false;
 if(record.game==='plinko')ok=expected.ballCount===actual.ballCount&&expected.risk===actual.risk&&expected.balls.every((b,i)=>b.multiplierScaled===actual.balls?.[i]?.multiplierScaled&&JSON.stringify(b.steps)===JSON.stringify(actual.balls?.[i]?.steps));
 else if(record.game==='slot')ok=JSON.stringify(expected)===JSON.stringify(actual);
 else if(record.game==='dice')ok=JSON.stringify(expected.faces)===JSON.stringify(actual.faces);
 else if(record.game==='coin')ok=expected.side===actual.side;
 return{ok,reason:ok?'VERIFIED':'Recorded result does not match the committed fairness inputs.',expected};
}
