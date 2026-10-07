import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSiteEntryHandler } from '../api/site-entry.js';
import { issueSiteEntrySession,readSiteEntrySession,SITE_ENTRY_TTL_MS } from '../server/site-entry.js';
import { authorizeSiteEntryTransition } from '../src/systems/siteEntryAuthorization.js';
let GameClass;
async function gameClass(){if(!GameClass){globalThis.window||={};window.dispatchEvent||=()=>{};window.addEventListener||=()=>{};globalThis.navigator||={maxTouchPoints:0,userAgent:''};GameClass=(await import('../src/core/Game.js')).Game;}return GameClass;}

const oldSecret=process.env.API_SESSION_SECRET;
process.env.API_SESSION_SECRET='site-entry-tests-use-a-secret-of-at-least-32-characters';
process.on('exit',()=>{if(oldSecret==null)delete process.env.API_SESSION_SECRET;else process.env.API_SESSION_SECRET=oldSecret;});

function response(){return{statusCode:0,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},hasHeader(k){return k.toLowerCase() in this.headers;},end(value){this.body=JSON.parse(value);}};}
function request(method,body={},cookie=''){return{method,body,headers:{host:'veyra.test',origin:'https://veyra.test',cookie},socket:{remoteAddress:'203.0.113.8'}};}
async function call({method='POST',body={},cookie='',verify=async()=>({success:true})}={}){const req=request(method,body,cookie),res=response();await createSiteEntryHandler({verify})(req,res);return res;}

test('successful site-entry verification creates a short-lived HttpOnly entry session',async()=>{
 let received;const res=await call({body:{turnstileToken:'valid-site-entry-token-123456'},verify:async input=>{received=input;return{success:true};}});
 assert.equal(res.statusCode,200);assert.equal(res.body.verified,true);assert.ok(res.body.expiresAt>Date.now());assert.equal(received.token,'valid-site-entry-token-123456');assert.equal(received.expectedAction,'site_entry');
 const cookie=res.headers['set-cookie'];assert.match(cookie,/veyra_site_entry=/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.doesNotMatch(cookie,/valid-site-entry-token/);
 const value=decodeURIComponent(cookie.match(/veyra_site_entry=([^;]+)/)[1]);const state=readSiteEntrySession(request('GET',{},`veyra_site_entry=${encodeURIComponent(value)}`));assert.equal(state.purpose,'site_entry');assert.ok(state.exp-state.iat<=SITE_ENTRY_TTL_MS);
});

test('valid entry cookie survives refresh check and expired state fails closed',async()=>{
 const issued=issueSiteEntrySession(1000);assert.equal(readSiteEntrySession(request('GET',{},`veyra_site_entry=${encodeURIComponent(issued.token)}`),1001)?.purpose,'site_entry');assert.equal(readSiteEntrySession(request('GET',{},`veyra_site_entry=${encodeURIComponent(issued.token)}`),1000+SITE_ENTRY_TTL_MS),null);
 const expired=await call({method:'GET',cookie:`veyra_site_entry=${encodeURIComponent(issued.token)}`});assert.equal(expired.body.verified,false);
});

test('missing and malformed site-entry requests fail without authorization',async()=>{
 for(const body of [[],{}, {turnstileToken:''}]){let verifyCalls=0;const res=await call({body,verify:async()=>{verifyCalls++;throw new Error('TURNSTILE_REQUIRED');}});assert.notEqual(res.body.verified,true);assert.equal(res.headers['set-cookie'],undefined);if(Array.isArray(body))assert.equal(verifyCalls,0);}
});

test('invalid, expired, duplicate, and unavailable Turnstile results never create entry authorization',async()=>{
 for(const code of ['TURNSTILE_FAILED','TURNSTILE_FAILED','TURNSTILE_FAILED','TURNSTILE_UNAVAILABLE']){const res=await call({body:{turnstileToken:'rejected-site-entry-token-123'},verify:async()=>{throw new Error(code);}});assert.equal(res.statusCode,code==='TURNSTILE_UNAVAILABLE'?400:400);assert.equal(res.headers['set-cookie'],undefined);assert.equal(res.body.verified,undefined);assert.equal(res.body.error,code);}
});

test('central Play transition blocks missing and expired authorization',async()=>{
 const Game=await gameClass();for(const state of [{verified:false,expiresAt:null},{verified:true,expiresAt:Date.now()-1}]){
  let transitions=0;const original=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>state});
  try{const allowed=await Game.prototype.startPlay.call({states:{set(){transitions++;}}});assert.equal(allowed,false);assert.equal(transitions,0);}finally{globalThis.fetch=original;}
 }
});

test('valid server authorization permits Play and preserves world-entry parameters',async()=>{
 const Game=await gameClass();let transition;const original=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>({verified:true,expiresAt:Date.now()+60000})});
 try{const allowed=await Game.prototype.startPlay.call({states:{set:(name,value)=>{transition={name,value};}}});assert.equal(allowed,true);assert.equal(transition.name,'play');assert.equal(transition.value.fresh,true);assert.ok(Number.isFinite(transition.value.worldEntryStartedAt));}finally{globalThis.fetch=original;}
});

test('transition authorization helper fails closed on network and malformed state',async()=>{
 assert.equal(await authorizeSiteEntryTransition(async()=>{throw new Error('offline');}),false);assert.equal(await authorizeSiteEntryTransition(async()=>({ok:true,json:async()=>({verified:true})})),false);
});

test('site-entry endpoint is isolated from Arcade withdrawals and balances',()=>{
 const entry=fs.readFileSync(new URL('../api/site-entry.js',import.meta.url),'utf8');const account=fs.readFileSync(new URL('../api/account/[route].js',import.meta.url),'utf8');const route=name=>{const m=account.match(new RegExp('// ---- route: '+name+' ----\\n([\\s\\S]*?)// ---- end route: '+name+' ----'));if(!m)throw new Error(`route ${name} missing from api/account/[route].js`);return m[1];};const withdrawal=route('withdrawals');const admin=fs.readFileSync(new URL('../server/admin-withdrawals-handler.js',import.meta.url),'utf8');
 assert.doesNotMatch(entry,/\bdb\s*\(|withdrawals|arcade_balances|balance\s*[+-]=|blockchain/i);assert.match(withdrawal,/await verifyTurnstileToken/);assert.match(withdrawal,/const row=await sql\.begin/);assert.ok(withdrawal.indexOf('await verifyTurnstileToken')<withdrawal.indexOf('const row=await sql.begin'));assert.match(admin,/balance=balance-/);
});

test('landing CTA is server-gated while the existing withdrawal Turnstile remains present',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');const ui=fs.readFileSync(new URL('../src/ui/UIManager.js',import.meta.url),'utf8');const gate=fs.readFileSync(new URL('../src/ui/SiteEntryGate.js',import.meta.url),'utf8');const withdrawal=fs.readFileSync(new URL('../src/ui/ArcadeBalancePanel.js',import.meta.url),'utf8');
 assert.match(html,/id="btn-play"[^>]*disabled/);assert.match(html,/site-entry-challenge/);assert.match(ui,/await this\.siteEntryGate\.authorize\(\)/);assert.match(gate,/action:'site_entry'/);assert.match(gate,/credentials:'same-origin'/);assert.doesNotMatch(gate,/localStorage/);assert.match(withdrawal,/action:'arcade_withdrawal'/);assert.match(withdrawal,/turnstileToken/);assert.match(withdrawal,/REQUEST WITHDRAWAL/);
});
