import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const overlay=fs.readFileSync(new URL('../src/ui/GameOverlay.js',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../src/games/casinoWagering.js',import.meta.url),'utf8');
const plinko=overlay.slice(overlay.indexOf('function plinkoGame'),overlay.indexOf('// ================= SLOT'));

test('Plinko frontend exposes 1-5 balls and normalized risk values',()=>{
 assert.match(plinko,/for\(let n=1;n<=5;n\+\+\)/);
 assert.match(plinko,/\['low','medium','high'\]/);
 assert.match(plinko,/\{ballCount,risk\}/);
});

test('Plinko sends one resolution request with ball count and risk',()=>{
 assert.match(plinko,/resolveOutcome\('plinko',[\s\S]*\{ballCount,risk\}\)/);
 assert.match(gateway,/payload\.ballCount=context\.ballCount\?\?1/);
 assert.match(gateway,/payload\.risk=context\.risk\?\?'medium'/);
 assert.equal((plinko.match(/confirmWager\('plinko'\)/g)||[]).length,1);
});

test('Plinko maps authoritative per-ball results and aggregate payout',()=>{
 assert.match(plinko,/result\.balls\.map\(ball=>ball\.multiplier\)/);
 assert.match(plinko,/data\.payoutWei/);
 assert.match(plinko,/result\.totalPayoutWei/);
 assert.match(plinko,/NO WINNINGS/);
 assert.doesNotMatch(plinko,/Math\.random/);
});

test('Plinko locks wager, ball, risk, and drop controls during a round',()=>{
 assert.match(plinko,/api\.setControlsLocked\(v\)/);
 assert.match(plinko,/countBtns\.forEach\(x=>x\.b\.disabled=v\)/);
 assert.match(plinko,/riskBtns\.forEach\(x=>x\.b\.disabled=v\)/);
 assert.match(plinko,/dropBtn\.disabled=v/);
});

test('all Plinko balls start together before bounded trajectory validation can block them',()=>{
 assert.match(plinko,/sims=targets\.map/);
 assert.match(plinko,/trajectory=fallbackTrajectory\(target,g,i\)/);
 assert.match(plinko,/state='animate'/);
 assert.match(plinko,/const buildTrajectory=/);
 assert.match(plinko,/performance\.now\(\)>deadline/);
 assert.match(plinko,/using assigned-pocket fallback/);
 assert.doesNotMatch(plinko,/if\(sims\.some\(sim=>!sim\.trajectory\)\)/);
 assert.match(plinko,/segmentClear/);
 assert.match(plinko,/sim\.pathTime=Math\.min\(trajectory\.duration,sim\.pathTime\+step\)/);
 assert.match(plinko,/sim\.vy\+=gravity\*step/);
 assert.match(plinko,/if\(progress>=1\)\{sim\.inPocket=true/);
 assert.match(plinko,/if\(sim\.landing\)/);
 assert.match(plinko,/1-Math\.exp\(-step\*9\)/);
});

test('Plinko selectors use compact segmented controls',()=>{
 assert.match(plinko,/gridTemplateColumns:'repeat\(5,1fr\)'/);
 assert.match(plinko,/gridTemplateColumns:'repeat\(3,1fr\)'/);
 assert.match(plinko,/height:'28px'/);
 assert.match(plinko,/api\.wagerPanel/);
 assert.match(plinko,/BALL_R=3\.6,PEG_R=2\.2/);
 assert.match(plinko,/visibleSlotWidth\(g\)\*\.45\/2/);
 assert.match(plinko,/centerInside=Math\.abs\(sim\.x-sim\.target\)<=landingZoneHalf\(g\)/);
 assert.match(plinko,/slowEnough=Math\.abs\(sim\.vx\)<=7&&Math\.abs\(sim\.vy\)<=11/);
 assert.match(plinko,/SLOT_H=20/);
 assert.match(plinko,/targetBin=visualBin\(b\)/);
 assert.match(plinko,/sim\.target=slotX\(sim\.targetBin,g\)/);
 assert.match(plinko,/high:\[S\(10000,'10×'\)[\s\S]*S\(0,'0×'\)[\s\S]*S\(10000,'10×'\)\]/);
});

test('Plinko resets exactly once only after a successful terminal state',()=>{
 assert.match(plinko,/if\(id!==roundId\|\|resetDone\|\|state!=='terminal'\)return/);
 assert.match(plinko,/state='terminal'/);
 assert.match(plinko,/setTimeout\(\(\)=>resetRound\(id\),1200\)/);
 assert.match(plinko,/ballCount=DEFAULT_BALLS;risk=DEFAULT_RISK/);
 assert.match(plinko,/sims\.length=0;trails\.length=0;flashes\.length=0/);
 assert.doesNotMatch(plinko,/const summary=mk/);
 assert.match(plinko,/api\.clearResult\(\)/);
 assert.match(plinko,/scheduleReset\(roundId\)/);
});

test('Plinko uses mapped direct-entry pockets and no post-landing target drag',()=>{
 assert.match(plinko,/entry=\{x:target,y:map\.entryY\}/);
 assert.match(plinko,/if\(progress>=1\)\{sim\.inPocket=true/);
 assert.match(plinko,/mouthHalf=slotPitch\(g\)\/2-BALL_R/);
 assert.match(plinko,/pocketL=sim\.target-pocketHalf/);
 assert.match(plinko,/for\(let i=0;i<=slots\.length;i\+\+\)/);
 assert.match(plinko,/boardBounds\(g\)\.width\/RISK_SLOTS\[risk\]\.length/);
 assert.match(plinko,/boardBounds\(g\)\.left\+slotPitch\(g\)\*\(bin\+\.5\)/);
 assert.match(plinko,/debugHost=\['localhost','127\.0\.0\.1'\]/);
 assert.doesNotMatch(plinko,/sim\.x\+=\(sim\.target-sim\.x\)\*spring/);
});
