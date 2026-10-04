import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const html=read('index.html'),logic=read('src/games/arcadeLogic.js'),ui=read('src/ui/arcadeGames.js'),overlay=read('src/ui/GameOverlay.js'),floor=read('src/systems/ArcadeFloor.js'),world=read('src/world/interiors.js');

test('retired Zombie games have no active card, route, gameplay, cabinet, poster, or Guide entry',()=>{
 for(const source of [html,logic,ui,overlay,floor,world]){
  assert.doesNotMatch(source,/Zombie Dodge|Zombie Shooter|zdodge|zshooter/);
 }
});

test('Neon Escape has polished deterministic arena presentation and desktop/mobile controls',()=>{
 assert.match(logic,/neonescape.*Neon Escape/);
 assert.match(overlay,/neonEscapeGame/);assert.match(floor,/ArcadeCabinet\('neonescape'/);
 for(const text of ['pointerdown','pointermove','ArrowLeft','KeyW','countdown','safeRadius','challenge.hazards','submitArcadeRound(\'neonescape\'']) assert.ok(ui.includes(text),text);
 assert.match(html,/Neon Escape/);assert.match(html,/server-replayed action sequences/);
});

test('N-Back has explicit match controls, progressive status, verified sequence identity, and Guide rules',()=>{
 assert.match(logic,/nback.*N-Back/);assert.match(overlay,/nbackGame/);assert.match(floor,/ArcadeCabinet\('nback'/);
 for(const text of ['MATCH  [M / →]','NO MATCH  [N / ←]','sequenceId','responses','N=${c.n}','submitArcadeRound(\'nback\'']) assert.ok(ui.includes(text),text);
 assert.match(html,/N-Back/);assert.match(html,/N steps earlier/);assert.match(html,/Every ordered response is independently checked/);
});
