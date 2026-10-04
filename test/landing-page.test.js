import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../styles/landing-refinement.css',import.meta.url),'utf8');
const identity=fs.readFileSync(new URL('../styles/veyra-identity.css',import.meta.url),'utf8');
const typography=fs.readFileSync(new URL('../styles/typography.css',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../src/ui/UIManager.js',import.meta.url),'utf8');

test('cinematic landing preserves the requested story hierarchy',()=>{
 for(const copy of ['STEP INTO VEYRA','A living city.','Take control of <b>Lester</b>','Something is happening beneath the city...','Games. Hidden places. Unexpected encounters.','And perhaps a few things you weren\'t supposed to find.','The city is waiting.'])assert.match(html,new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.doesNotMatch(html,/ENTER VEYRA/);
 assert.doesNotMatch(html,/id="btn-controls"/);
});

test('CTA has restrained invitation animation and cinematic entry transition',()=>{
 for(const token of ['ctaOrbit','ctaSweep','inviteLight','ctaSpark','ctaPress'])assert.match(css,new RegExp(token));
 assert.match(ui,/entering-city/);
 assert.match(ui,/setTimeout\(async\(\)=>\{if\(!await g\.startPlay\(\)\)/);
 assert.match(ui,/\},350\)/);
});

test('official Veyra palette and three-part typography system drive the landing identity',()=>{
 for(const color of ['#0800C3','#FFE800','#FF6100','#D80027','#7A6BB2','#3B000B'])assert.match(identity,new RegExp(color));
 for(const role of ['--veyra-display','--veyra-condensed','--veyra-clean'])assert.match(identity,new RegExp(role));
 assert.match(identity,/color:var\(--veyra-cobalt\)/);
 assert.match(identity,/background:var\(--veyra-yellow\)/);
 assert.match(html,/<strong>LitVM<\/strong>/);
 assert.match(html,/<strong>zkLTC<\/strong>/);
});

test('Google font loading and semantic font roles are explicit and efficient',()=>{
 for(const family of ['Audiowide','Orbitron','Oxanium','Rajdhani','Exo+2','Space+Grotesk','Michroma','Zen+Dots'])assert.match(html,new RegExp(family.replace('+','\\+')));
 for(const role of ['--font-display','--font-future','--font-action','--font-data','--font-copy','--font-reading','--font-mystery','--font-secret'])assert.match(typography,new RegExp(role));
 assert.match(typography,/\.logo,.boot-logo\{font-family:var\(--font-display\)/);
 assert.match(typography,/\.menu-invite \.btn-primary\{font-family:var\(--font-action\)/);
 assert.match(typography,/\.mystery-copy p:nth-child\(2\)\{font-family:var\(--font-mystery\)/);
});

test('portrait orientation warning remains intact',()=>{
 assert.match(html,/id="orientation-overlay"/);
 assert.match(html,/TURN YOUR PHONE SIDEWAYS/);
});
