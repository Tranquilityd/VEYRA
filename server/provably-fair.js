import crypto from 'node:crypto';

export const FAIRNESS_VERSION='veyra-provably-fair-v2';
export const FAIRNESS_ALGORITHM='HMAC-SHA256';
const CLIENT_SEED=/^[A-Za-z0-9._:-]{8,128}$/;

export function validateClientSeed(value){
 const seed=String(value||'');if(!CLIENT_SEED.test(seed))throw new Error('INVALID_INPUT');return seed;
}
export function createFairnessCommitment(clientSeed,nonce){
 const seed=validateClientSeed(clientSeed),serverSeed=crypto.randomBytes(32).toString('hex');
 return{version:FAIRNESS_VERSION,algorithm:FAIRNESS_ALGORITHM,clientSeed:seed,nonce:String(nonce),serverSeedHash:crypto.createHash('sha256').update(serverSeed).digest('hex'),serverSeedSecret:serverSeed};
}
export function hashServerSeed(serverSeed){return crypto.createHash('sha256').update(String(serverSeed)).digest('hex');}
export function fairnessDigest(serverSeed,{clientSeed,nonce,game,subIndex}){
 validateClientSeed(clientSeed);const message=`${clientSeed}:${nonce}:${game}:${subIndex}`;
 return crypto.createHmac('sha256',String(serverSeed)).update(message).digest('hex');
}
export function fairInt(serverSeed,context,maxExclusive){
 if(!Number.isSafeInteger(maxExclusive)||maxExclusive<1)throw new Error('INVALID_INPUT');
 const digest=fairnessDigest(serverSeed,context);
 // The first 13 hex digits are 52 deterministic bits, safely representable by JS.
 return Number(BigInt(`0x${digest.slice(0,13)}`)%BigInt(maxExclusive));
}
export function createFairRandomInt(serverSeed,base){
 return(maxExclusive,subIndex)=>fairInt(serverSeed,{...base,subIndex},maxExclusive);
}
export function publicFairness(commitment,{reveal=false}={}){
 const out={version:commitment.version,algorithm:commitment.algorithm,clientSeed:commitment.clientSeed,nonce:String(commitment.nonce),serverSeedHash:commitment.serverSeedHash};
 if(reveal)out.serverSeed=commitment.serverSeedSecret;return out;
}
