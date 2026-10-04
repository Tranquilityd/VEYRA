import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/ui/UIManager.js',import.meta.url),'utf8');
const map=readFileSync(new URL('../src/ui/CityMinimap.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles/credits.css',import.meta.url),'utf8');

test('minimap follows existing pause transition without destruction or camera reset',()=>{
  assert.match(ui,/showPause\(on\).*minimap\.setPausedHidden\(on\)/);
  assert.match(map,/setPausedHidden\(hidden\)\{this\.root\.style\.visibility=hidden\?'hidden':'visible';\}/);
  const pauseVisibility=map.slice(map.indexOf('setPausedHidden'),map.indexOf('_resize'));
  assert.doesNotMatch(pauseVisibility,/remove\(|cam=null|visible=false/);
  assert.equal((html.match(/id="city-minimap"/g)||[]).length,0,'map remains dynamically created exactly once by CityMinimap');
});

test('Credits is an accessible pause-owned overlay with correct identity and links',()=>{
  assert.match(html,/id="btn-credits"[^>]*>[\s\S]*?<span>CREDITS<\/span><\/button>/);
  assert.match(html,/id="btn-support"[^>]*href="https:\/\/t\.me\/Heishim94"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>[\s\S]*?<span>SUPPORT<\/span><\/a>/);
  assert.match(html,/id="modal-credits"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html,/Created &amp; Developed by[\s\S]*TRANQUILITY/);
  assert.match(html,/Powered by LitVM/);
  assert.match(html,/LitVM LiteForge Testnet/);
  assert.match(html,/Chain ID<\/b>4441/);
  for(const url of ['https://x.com/VEYRAWLD','https://x.com/HeisHim94']){
    assert.match(html,new RegExp(`href="${url}" target="_blank" rel="noopener noreferrer"`));
  }
});

test('Credits open and close preserve authoritative pause state and Escape returns to pause',()=>{
  const creditsBlock=ui.slice(ui.indexOf('const openCredits'),ui.indexOf('const toggleSound'));
  assert.match(creditsBlock,/states\.get\('play'\)\?\.paused/);
  assert.doesNotMatch(creditsBlock,/togglePause\s*\(/);
  assert.match(creditsBlock,/e\.key === 'Escape'/);
  assert.match(creditsBlock,/closeCredits\(\)/);
  assert.match(creditsBlock,/stopImmediatePropagation/);
});

test('donation only copies the exact address and provides a manual fallback',()=>{
  const address='0xb4193324e92c8354fdbf7607421296bc7b6c7e74';
  assert.ok(html.includes(address));
  assert.ok(ui.includes(`const address = '${address}'`));
  assert.match(ui,/navigator\.clipboard\?\.writeText/);
  assert.match(ui,/COPIED ✓/);
  assert.match(ui,/donateFallback\.classList\.remove\('hidden'\)/);
  const donationBlock=ui.slice(ui.indexOf("const address = '0xb419"),ui.indexOf("document.addEventListener('keydown'"));
  assert.doesNotMatch(donationBlock,/wallet|localStorage|sessionStorage|sendTransaction|writeContract/i);
});

test('Credits presentation is responsive, scrollable and reduced-motion safe',()=>{
  assert.match(css,/grid-template-columns:repeat\(3/);
  assert.match(css,/@media\(max-width:650px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html,/class="guide-scroll credits-scroll"/);
});
