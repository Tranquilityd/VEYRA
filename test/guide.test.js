import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/ui/UIManager.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles/guide.css',import.meta.url),'utf8');

test('pause menu exposes an accessible Veyra Guide dialog',()=>{
  assert.match(html,/id="btn-guide"[^>]*>[\s\S]*?<span>GUIDE<\/span><\/button>/);
  assert.match(html,/id="modal-guide"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html,/id="btn-close-guide"[^>]*aria-label="Close VEYRAWLD Guide"/);
  assert.match(html,/id="guide-scroll"[^>]*tabindex="0"/);
});

test('Guide opens only from paused play and closes without toggling game state',()=>{
  assert.match(ui,/states\.get\('play'\)\?\.paused/);
  const guideBlock=ui.slice(ui.indexOf('const openGuide'),ui.indexOf('const toggleSound'));
  assert.doesNotMatch(guideBlock,/togglePause\s*\(/);
  assert.match(guideBlock,/e\.key === 'Escape'[^\n]*closeGuide/);
  assert.match(guideBlock,/stopImmediatePropagation/);
  assert.match(guideBlock,/btn-guide|guideButton/);
});

test('Guide documents authoritative network, balances, games and withdrawal flow',()=>{
  for(const text of ['Chain ID 4441','0.0005 to 1 zkLTC','0.005 zkLTC','@HeisHim94','@VEYRAWLD','Memory Rush','Tile Shift','Neon Escape','N-Back','Basketball','no Arcade Balance reward','HMAC-SHA256','96.5% / 3.5%','97% / 3%','94.5% / 5.5%']) assert.ok(html.includes(text),text);
});

test('Guide is responsive, scrollable and honors reduced motion',()=>{
  assert.match(css,/overflow-y:auto/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/pointer-events:auto/);
});
