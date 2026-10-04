import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const entry=read('../src/systems/WorldEntrySequence.js');
const play=read('../src/states/PlayState.js');
const game=read('../src/core/Game.js');
const player=read('../src/entities/Player.js');
const html=read('../index.html');
const ui=read('../src/ui/UIManager.js');
const balanceCss=read('../styles/balance-cards.css');

test('world entry uses named validated city spawn and exact control timing',()=>{
 assert.match(entry,/CITY_START_SPAWN/);
 assert.match(entry,/onRoad\(x,y\)/);
 assert.match(entry,/world\.collide\(x,y,model\.player\.radius\+12\)/);
 assert.match(entry,/Math\.hypot\(n\.x-x,n\.y-y\)<90/);
 assert.match(entry,/this\.duration=this\.reduced\?1:3\.6/);
 assert.match(entry,/this\.controlAt=this\.reduced\?1:3\.1/);
});

test('entry sequence owns input and camera then guarantees cleanup',()=>{
 assert.match(game,/play\?\.worldEntry\?\.controlsLocked/);
 assert.match(play,/new WorldEntrySequence/);
 assert.match(play,/this\.worldEntry\.cleanup\(\)/);
 assert.match(entry,/catch\{this\.cleanup\(true\);\}/);
 assert.match(entry,/p\.entryVisibility=1/);
 assert.match(entry,/this\.game\.input\.reset\(\)/);
 assert.match(player,/this\.entryVisibility==null\?1/);
});

test('entry visual phases and reduced-motion fallback remain lightweight',()=>{
 for(const timing of ['1.35','2.05','2.55','3.35'])assert.match(entry,new RegExp(timing.replace('.','\\.')));
 assert.match(entry,/const count=this\.reduced\?8:28/);
 assert.match(entry,/Welcome to Veyra/);
 assert.doesNotMatch(entry,/requestAnimationFrame|setInterval/);
});

test('balance cards retain authoritative ids and animate only on value changes',()=>{
 for(const id of ['wallet-amount','zk-amount','chip-wallet','chip-zk'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/class="balance-icon zkl-tcoin"/);
 assert.match(html,/class="balance-icon arcade-token"/);
 assert.match(ui,/_pulseBalance\(this\.el\.walletChip,'_lastMainBalance',s\.mainBalance\)/);
 assert.match(ui,/_pulseBalance\(this\.el\.zkChip,'_lastArcadeBalance',arcade\)/);
 assert.match(balanceCss,/balance-updated/);
 assert.match(balanceCss,/prefers-reduced-motion:reduce/);
});
