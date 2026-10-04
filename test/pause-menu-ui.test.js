import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles/pause-menu.css',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/ui/UIManager.js',import.meta.url),'utf8');
const play=readFileSync(new URL('../src/states/PlayState.js',import.meta.url),'utf8');

const pause=html.slice(html.indexOf('<!-- ============ PAUSE'),html.indexOf('<!-- ============ VEYRA GUIDE'));

test('pause menu has one organized branded action hierarchy without fake actions',()=>{
  assert.match(pause,/class="pause-header"/);
  assert.match(pause,/class="pause-brand-logo"[^>]*assets\/brand\/veyrawld-logo\.jpg/);
  assert.match(pause,/id="pause-title">PAUSED/);
  const order=['btn-resume','btn-guide','btn-controls-2','btn-credits','btn-support','btn-sound-pause','btn-quit'].map(id=>pause.indexOf(`id="${id}"`));
  assert.ok(order.every((v,i)=>v>=0&&(i===0||v>order[i-1])));
  assert.doesNotMatch(pause,/settings/i);
});

test('all existing pause controls retain their authoritative bindings',()=>{
  for(const id of ['resume','guideButton','controls2','creditsButton','sndPause','quit']) assert.ok(ui.includes(`this.el.${id}`),id);
  assert.match(ui,/this\.el\.resume\.addEventListener\('click', \(\) => g\.togglePause\(\)\)/);
  assert.match(ui,/this\.el\.quit\.addEventListener\('click'.*g\.toMenu\(\)/);
  assert.match(ui,/pauseSoundLabel.*Sound: Off.*Sound: On/s);
});

test('pause remains PlayState-owned and freezes updates while preserving minimap visibility behavior',()=>{
  assert.match(play,/this\.paused = !this\.paused/);
  assert.match(play,/this\.game\.ui\.showPause\(this\.paused\)/);
  assert.match(play,/if \(this\.paused\) return/);
  assert.match(ui,/showPause\(on\).*minimap\.setPausedHidden\(on\)/);
  assert.doesNotMatch(ui,/creditsOpen.*paused\s*=/s);
});

test('pause presentation is responsive, accessible and reduced-motion safe',()=>{
  assert.match(pause,/role="dialog" aria-modal="true" aria-labelledby="pause-title"/);
  assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-height:520px\) and \(orientation:landscape\)/);
  assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/overflow-y:auto/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
