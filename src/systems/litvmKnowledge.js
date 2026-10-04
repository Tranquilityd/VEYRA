// Official-source NPC knowledge. Records are intentionally explicit so every
// Litecoin/LitVM claim is auditable and future/planned work is never presented as live.
import { mulberry32 } from '../core/util.js';

export const NPC_FACTS = Object.freeze([
  {fact:'Litecoin is digital money for instant, near-zero-cost payments worldwide.',topic:'Litecoin payments',sourceName:'Litecoin.org',sourceUrl:'https://litecoin.org/',status:'current',personality:'friendly guide'},
  {fact:'Litecoin has a maximum supply of 84 million LTC.',topic:'Litecoin supply',sourceName:'Litecoin.org',sourceUrl:'https://litecoin.org/',status:'current',personality:'number sage'},
  {fact:'Litecoin Core is a full-node wallet that supports the network.',topic:'Litecoin wallets',sourceName:'Litecoin.org',sourceUrl:'https://litecoin.org/',status:'current',personality:'tech explorer'},
  {fact:'Litecoin is open-source software. Builders welcome!',topic:'Litecoin development',sourceName:'Litecoin.org',sourceUrl:'https://litecoin.org/',status:'current',personality:'builder'},
  {fact:'LitVM brings smart contracts to Litecoin with a zero-knowledge rollup.',topic:'LitVM architecture',sourceName:'LitVM Documentation',sourceUrl:'https://docs.litvm.com/',status:'current',personality:'arcane engineer'},
  {fact:'LitVM is an EVM-compatible rollup secured by Litecoin.',topic:'LitVM architecture',sourceName:'LitVM Documentation',sourceUrl:'https://docs.litvm.com/',status:'current',personality:'network scholar'},
  {fact:'LitVM uses Arbitrum Orbit for EVM compatibility.',topic:'LitVM technology',sourceName:'LitVM Documentation',sourceUrl:'https://docs.litvm.com/',status:'current',personality:'tech explorer'},
  {fact:'BitcoinOS Grail Bridge provides trustless LTC bridging for LitVM.',topic:'LitVM bridging',sourceName:'LitVM Documentation',sourceUrl:'https://docs.litvm.com/',status:'current',personality:'bridge keeper'},
  {fact:'LiteForge is LitVM’s live testnet. Adventure awaits!',topic:'LiteForge testnet',sourceName:'LiteForge Testnet Guide',sourceUrl:'https://www.litvm.com/blog/welcome-to-liteforge',status:'current',personality:'testnet scout'},
  {fact:'LiteForge uses zkLTC to cover network gas fees.',topic:'LiteForge gas',sourceName:'LiteForge Testnet Guide',sourceUrl:'https://www.litvm.com/blog/welcome-to-liteforge',status:'current',personality:'gas guide'},
  {fact:'LiteForge works with EVM-compatible wallets.',topic:'LiteForge wallets',sourceName:'LiteForge Testnet Guide',sourceUrl:'https://www.litvm.com/blog/welcome-to-liteforge',status:'current',personality:'wallet wizard'},
  {fact:'Developers familiar with Ethereum tooling can deploy on LitVM.',topic:'LitVM development',sourceName:'LiteForge Testnet Guide',sourceUrl:'https://www.litvm.com/blog/welcome-to-liteforge',status:'current',personality:'builder'},
  {fact:'LitVM’s vision includes Litecoin-powered DeFi, real-world assets and AI.',topic:'LitVM ecosystem vision',sourceName:'LitVM',sourceUrl:'https://www.litvm.com/',status:'planned',personality:'future seer'},
  {fact:'LitVM aims to unlock new uses for LTC and Litecoin-native assets.',topic:'LitVM mission',sourceName:'LitVM',sourceUrl:'https://www.litvm.com/',status:'planned',personality:'ecosystem dreamer'},
  {fact:'LitVM is designed as a programmable Web3 application layer on Litecoin.',topic:'LitVM applications',sourceName:'LitVM',sourceUrl:'https://www.litvm.com/',status:'current',personality:'Web3 scholar'},
]);

// Backward-compatible text view used by diagnostics.
export const LITVM_KNOWLEDGE = Object.freeze(NPC_FACTS.map(x=>x.fact));

export function makeKnowledgeDeck(seed=1){
 const rng=mulberry32(seed);let bag=[];
 const draw=()=>{if(!bag.length){bag=NPC_FACTS.map((_,i)=>i);for(let i=bag.length-1;i>0;i--){const j=(rng()*(i+1))|0;[bag[i],bag[j]]=[bag[j],bag[i]];}}return NPC_FACTS[bag.pop()];};
 return {next:()=>draw().fact,nextFact:draw,size:NPC_FACTS.length};
}

export const BUSY_LINES=['One sec, I’m playing 😅','Sorry, I’m busy 😅','One sec — I’m on a roll! 🎲','This seat’s taken 😄','Just one more round 🍀','Gimme a minute, friend 😉','Busy hands, happy heart 🃏'];
