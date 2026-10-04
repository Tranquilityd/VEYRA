import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const overlay=fs.readFileSync(new URL('../src/ui/GameOverlay.js',import.meta.url),'utf8');
const wagering=fs.readFileSync(new URL('../src/games/casinoWagering.js',import.meta.url),'utf8');

const hooks=['casino_wager_started','casino_wager_confirmed','casino_game_started','plinko_peg_hit','plinko_pocket_hit','result_revealed','win_small','win_medium','win_large','loss','claim_started','claim_confirmed','round_reset'];

test('shared casino feedback hooks are layered on the existing event bus',()=>{
 for(const hook of hooks)assert.match(overlay,new RegExp(hook),hook);
 assert.match(overlay,/this\.game\.events\.emit\(type/);
 assert.match(overlay,/feedback: \(type,detail\) => this\._feedback/);
});

test('transaction presentation is driven by real wager and claim promises',()=>{
 assert.match(overlay,/await this\.wagerGateway\.wager[\s\S]*casino_wager_confirmed/);
 assert.match(overlay,/await this\.wagerGateway\.claim[\s\S]*claim_confirmed/);
 assert.match(overlay,/_txVisual\('wager','PLACING WAGER','Securing your wager\.\.\.',v\.amount\)/);
 assert.match(overlay,/_renderPayoutState\('CLAIMING WINNINGS','Sending your winnings…',true\)/);
 assert.match(overlay,/_renderPayoutState\('✓ WINNINGS CLAIMED','Confirmed on LitVM',false,true\)/);
 assert.doesNotMatch(overlay,/_txVisual\('claim','CLAIMING WINNINGS'/);
 assert.doesNotMatch(overlay,/setTimeout\([^\n]*(WAGER CONFIRMED|CLAIM CONFIRMED)/);
});

test('result intensity derives from actual payout-to-wager ratio',()=>{
 assert.match(overlay,/ratio=Number\(amount\)\/Math\.max\(Number\(wager\.amount\|\|this\.bet\)/);
 assert.match(overlay,/ratio>=5\?'win_large':ratio>=2\?'win_medium':'win_small'/);
 assert.match(overlay,/if \(!\(Number\(amount\) > 0\)\) \{ this\._feedback\('loss'/);
});

test('unwanted side status text components are removed from layout',()=>{
 assert.doesNotMatch(overlay,/this\.modeEl\s*=/);
 assert.doesNotMatch(overlay,/this\.wagerInfo\s*=/);
 assert.doesNotMatch(overlay,/this\.msgEl\s*=/);
 assert.match(overlay,/this\.resultEl=mk/);
});

test('every casino settlement enforces result rendering before a real 2000ms delay',()=>{
 assert.match(overlay,/_showCasinoResult\(summary,payout,presentation\)/);
 assert.match(overlay,/await new Promise\(resolve=>setTimeout\(resolve,2000\)\)/);
 assert.match(overlay,/return this\._settleCasinoResult\(summary,payout\)/);
 assert.match(overlay,/settleResult: \(summary, payout, presentation\) => this\._revealThenSettle/);
 const reveal=overlay.indexOf('await new Promise(resolve=>setTimeout(resolve,2000))');
 const settle=overlay.indexOf('return this._settleCasinoResult(summary,payout)',reveal);
 assert.ok(reveal>=0&&settle>reveal);
});

test('wins automatically claim after reveal while zero payouts never submit a claim',()=>{
 const reveal=overlay.indexOf('await new Promise(resolve=>setTimeout(resolve,2000))');
 const settle=overlay.indexOf('return this._settleCasinoResult(summary,payout)',reveal);
 const zeroGuard=overlay.indexOf("if (!(Number(amount) > 0))",settle);
 const claim=overlay.indexOf('await this.wagerGateway.claim(wager, amount)',zeroGuard);
 assert.ok(reveal>=0&&settle>reveal&&zeroGuard>settle&&claim>zeroGuard);
 assert.match(overlay,/AUTOMATIC CLAIM IN 2 SECONDS/);
 assert.match(overlay,/CLAIMING WINNINGS/);
 assert.match(overlay,/Sending your winnings…/);
 assert.match(overlay,/✓ WINNINGS CLAIMED/);
 assert.match(overlay,/GAME OUTCOME/);
 assert.match(overlay,/this\.outcomeEl=mk/);
 assert.match(overlay,/panel\.appendChild\(this\.outcomeEl\)/);
 assert.match(overlay,/gridTemplateRows: '48px minmax\(0,1fr\) 86px'/);
 assert.match(overlay,/this\.outcomeEl\.style\.gridRow='3'/);
 assert.match(overlay,/_renderPayoutState\('CLAIMING WINNINGS','Sending your winnings…',true\)/);
 assert.match(overlay,/_renderPayoutState\('✓ WINNINGS CLAIMED','Confirmed on LitVM',false,true\)/);
});

test('claim success is not downgraded by balance refresh and retries reconcile already-claimed sessions',()=>{
 assert.match(wagering,/balance:await this\._safeBalance\(\),tracking/);
 assert.match(wagering,/existing\?\.status==='claimed'/);
 assert.match(wagering,/alreadyClaimed:true/);
 assert.match(overlay,/retry tracking, not payout/);
 assert.match(overlay,/this\.retryClaimBtn\.style\.display = 'block'/);
});

test('wager entry trims valid amounts and visibly reports every pre-submit failure',()=>{
 assert.match(overlay,/String\(this\.wagerInput\.value\|\|''\)\.trim\(\)/);
 assert.match(overlay,/_txVisual\('error','WAGER BLOCKED',message\)/);
 assert.match(overlay,/_txVisual\('error','BALANCE CHECK FAILED',message\)/);
 assert.match(overlay,/_txVisual\('error','INVALID WAGER',v\.message\)/);
});

test('non-Plinko games reset after successful terminal sessions and compact controls do not cover status',()=>{
 assert.match(overlay,/_scheduleNonPlinkoReset\(\)/);
 assert.match(overlay,/if\(this\.openId==='plinko'\)return/);
 assert.match(overlay,/this\._clearResult\(\);this\._roundVisual\(\)/);
 assert.match(overlay,/height:40px!important;min-height:40px!important;max-height:40px!important/);
});

test('focused transaction animation respects reduced motion without redesign effects',()=>{
 assert.match(overlay,/prefers-reduced-motion:reduce/);
 assert.match(overlay,/casino-chip/);
 assert.match(overlay,/casino-spinner/);
 assert.match(overlay,/round-info/);
 assert.match(overlay,/wagerInput\.placeholder/);
 assert.doesNotMatch(overlay,/casino-fx/);
 assert.match(overlay,/cancelAnimationFrame\(this\._raf\)/);
});
