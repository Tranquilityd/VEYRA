import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  REWARD_GAMES, NON_REWARD_GAMES, createArcadeChallenge, verifyArcadeRound,
  issueArcadeRoundToken, verifyArcadeRoundToken, neonEscapeParams, nBackParams,
} from '../server/arcade-protocol.js';
const handler=readFileSync(new URL('../api/arcade/session.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../src/games/arcadeRewards.js',import.meta.url),'utf8');
const games=readFileSync(new URL('../src/ui/arcadeGames.js',import.meta.url),'utf8');
const overlay=readFileSync(new URL('../src/ui/GameOverlay.js',import.meta.url),'utf8');
const schema=readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8');

const deterministic=seed=>{let x=seed;return()=>((x=(x*1664525+1013904223)>>>0)/2**32);};
function neonSolution(v){let x=500,y=500;const actions=[];for(let t=0;t<v.ticks;t++){const[sx,sy]=v.path[t],a=[Math.abs(sx-x)>10?Math.sign(sx-x):0,Math.abs(sy-y)>10?Math.sign(sy-y):0];actions.push(a);let[dx,dy]=a;if(dx&&dy){dx*=Math.SQRT1_2;dy*=Math.SQRT1_2;}x=Math.max(0,Math.min(1000,x+dx*v.speed));y=Math.max(0,Math.min(1000,y+dy*v.speed));}return{actions};}
const nbackSolution=v=>({sequenceId:v.sequenceId,responses:v.sequence.slice(v.n).map((cell,i)=>({index:i+v.n,match:cell===v.sequence[i]}))});

test('all four cabinets use server-authoritative rewards and Basketball remains separate',()=>{
 assert.deepEqual([...REWARD_GAMES].sort(),['memrush','nback','neonescape','tileshift']);
 assert.deepEqual([...NON_REWARD_GAMES],['basketball']);
 assert.match(games,/export function neonEscapeGame/);assert.match(games,/export function nbackGame/);
 assert.doesNotMatch(overlay,/zdodgeGame|zshooterGame/);
});

test('Memory Rush and Tile Shift retain exact server challenge verification',()=>{
 const m=createArcadeChallenge('memrush',1,1000,()=>.42);assert.equal(verifyArcadeRound(m.verifier,m.public.cells),true);assert.equal(verifyArcadeRound(m.verifier,[]),false);
 let tile;for(let n=1;n<1000&&!tile;n++){const c=createArcadeChallenge('tileshift',1,1000,deterministic(n)),b=c.public.board,t=c.public.target;for(let a=0;a<b.length;a++)for(let d=a+1;d<b.length;d++){const z=b.slice();[z[a],z[d]]=[z[d],z[a]];if(z.every((v,i)=>v===t[i]))tile={c,moves:[[a,d]]};}}
 assert.ok(tile);assert.equal(verifyArcadeRound(tile.c.verifier,tile.moves),true);assert.equal(verifyArcadeRound(tile.c.verifier,[]),false);
});

test('Neon Escape challenge is deterministic, bounded, progressively harder, and replay-verifiable',()=>{
 const early=createArcadeChallenge('neonescape',1,1000,deterministic(7)),late=createArcadeChallenge('neonescape',15,1000,deterministic(7));
 assert.equal(early.public.kind,'neonescape');assert.ok(early.public.ticks<=120);assert.ok(late.public.safeRadius<early.public.safeRadius);assert.ok(late.public.hazards.length>=early.public.hazards.length);assert.ok(neonEscapeParams(20).ticks<=120);
 const solution=neonSolution(early.verifier);assert.equal(verifyArcadeRound(early.verifier,solution),true);
 assert.equal(verifyArcadeRound(early.verifier,{actions:solution.actions.slice(1)}),false,'missing action');
 const impossible=structuredClone(solution);impossible.actions[0]=[9,0];assert.equal(verifyArcadeRound(early.verifier,impossible),false,'impossible movement');
 const stationary={actions:Array(late.public.ticks).fill([0,0])};assert.equal(verifyArcadeRound(late.verifier,stationary),false,'hazard/safe-zone failure');
 assert.equal(verifyArcadeRound(early.verifier,{actions:Array(121).fill([0,0])}),false,'work bound');
});

test('N-Back server generates sequence and validates identity, order, count, and every answer',()=>{
 const c=createArcadeChallenge('nback',8,1000,deterministic(11)),solution=nbackSolution(c.verifier);assert.equal(c.public.kind,'nback');assert.equal(c.public.n,nBackParams(8).n);assert.equal(verifyArcadeRound(c.verifier,solution),true);
 assert.equal(verifyArcadeRound(c.verifier,{...solution,sequenceId:crypto.randomUUID()}),false,'altered sequence id');
 assert.equal(verifyArcadeRound(c.verifier,{...solution,responses:solution.responses.slice(1)}),false,'missing response');
 assert.equal(verifyArcadeRound(c.verifier,{...solution,responses:[...solution.responses,solution.responses[0]]}),false,'extra/duplicate response');
 const wrong=structuredClone(solution);wrong.responses[0].match=!wrong.responses[0].match;assert.equal(verifyArcadeRound(c.verifier,wrong),false,'incorrect answer');
 const order=structuredClone(solution);order.responses[0].index++;assert.equal(verifyArcadeRound(c.verifier,order),false,'wrong order');
});

test('round tokens bind game, round, session, and player',()=>{const old=process.env.API_SESSION_SECRET;process.env.API_SESSION_SECRET=crypto.randomBytes(48).toString('hex');try{const d={roundId:crypto.randomUUID(),sessionId:crypto.randomUUID(),userId:crypto.randomUUID(),game:'neonescape'},token=issueArcadeRoundToken(d);assert.equal(verifyArcadeRoundToken(token,d),d.roundId);for(const changed of [{...d,game:'nback'},{...d,userId:crypto.randomUUID()},{...d,sessionId:crypto.randomUUID()}])assert.equal(verifyArcadeRoundToken(token,changed),null);assert.equal(verifyArcadeRoundToken(token.slice(0,-1)+'x',d),null);}finally{old===undefined?delete process.env.API_SESSION_SECRET:process.env.API_SESSION_SECRET=old;}});

test('API never accepts client score, waves, reward, game change, or final result authority',()=>{assert.doesNotMatch(handler,/input\.(waves|score|reward)/);assert.match(handler,/waves=waves\+1,score=score\+1/);assert.match(handler,/FOR UPDATE/);assert.match(handler,/round\.status !== 'issued'/);assert.match(handler,/Number\(round\.wave\) !== Number\(session\.waves\) \+ 1/);assert.match(handler,/now < new Date\(round\.not_before\)/);assert.ok(client.includes("JSON.stringify({ action: 'finish', sessionId: state.id })"));});

test('schema enforces ordered one-time rounds and one credit per game session',()=>{assert.match(schema,/UNIQUE\(game_session_id, wave\)/);assert.match(schema,/status IN \('issued','completed','rejected'\)/);assert.match(schema,/UNIQUE\(game_session_id\)/);assert.match(schema,/neonescape/);assert.match(schema,/nback/);});
