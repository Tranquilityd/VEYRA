import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyTurnstileToken } from '../server/turnstile.js';
const withdrawals=fs.readFileSync(new URL('../api/withdrawals.js',import.meta.url),'utf8');
const panel=fs.readFileSync(new URL('../src/ui/ArcadeBalancePanel.js',import.meta.url),'utf8');
const widget=fs.readFileSync(new URL('../src/ui/TurnstileWidget.js',import.meta.url),'utf8');
const build=fs.readFileSync(new URL('../scripts/build-static.js',import.meta.url),'utf8');

const valid='abcdefghijklmnopqrstuvwxyz0123456789TOKEN';
function withSecret(fn){const old=process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY='test-secret-server-only';return Promise.resolve().then(fn).finally(()=>{if(old==null)delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;else process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY=old;});}

test('Turnstile accepts a successful server-side Siteverify response',()=>withSecret(async()=>{
 let request;
 const result=await verifyTurnstileToken({token:valid,remoteIp:'203.0.113.4',expectedAction:'arcade_withdrawal',fetchImpl:async(url,opts)=>{request={url,opts};return{ok:true,json:async()=>({success:true,hostname:'veyra.example',action:'arcade_withdrawal'})};}});
 assert.equal(result.success,true);assert.match(request.url,/siteverify/);assert.match(String(request.opts.body),/secret=test-secret-server-only/);assert.match(String(request.opts.body),/response=/);assert.match(String(request.opts.body),/remoteip=203.0.113.4/);
}));

test('missing and malformed tokens fail before Cloudflare is called',()=>withSecret(async()=>{
 let calls=0;for(const token of ['',null,'short token'])await assert.rejects(()=>verifyTurnstileToken({token,expectedAction:'arcade_withdrawal',fetchImpl:async()=>{calls++;}}),/TURNSTILE_REQUIRED/);assert.equal(calls,0);
}));

test('invalid, expired, duplicate, and unavailable verification fail closed',()=>withSecret(async()=>{
 await assert.rejects(()=>verifyTurnstileToken({token:valid,expectedAction:'arcade_withdrawal',fetchImpl:async()=>({ok:true,json:async()=>({success:false,'error-codes':['timeout-or-duplicate']})})}),/TURNSTILE_FAILED/);
 await assert.rejects(()=>verifyTurnstileToken({token:valid,expectedAction:'arcade_withdrawal',fetchImpl:async()=>{throw new Error('network')}}),/TURNSTILE_UNAVAILABLE/);
}));

test('Turnstile actions are mandatory and cross-flow tokens are rejected',()=>withSecret(async()=>{
 const response=action=>async()=>({ok:true,json:async()=>({success:true,action})});
 await assert.doesNotReject(()=>verifyTurnstileToken({token:valid,expectedAction:'arcade_withdrawal',fetchImpl:response('arcade_withdrawal')}));
 for(const action of ['site_entry','wrong_action',undefined])await assert.rejects(()=>verifyTurnstileToken({token:valid,expectedAction:'arcade_withdrawal',fetchImpl:response(action)}),/TURNSTILE_FAILED/);
 await assert.doesNotReject(()=>verifyTurnstileToken({token:valid,expectedAction:'site_entry',fetchImpl:response('site_entry')}));
 await assert.rejects(()=>verifyTurnstileToken({token:valid,expectedAction:'site_entry',fetchImpl:response('arcade_withdrawal')}),/TURNSTILE_FAILED/);
}));

test('withdrawal verifies its action before the existing database transaction',()=>{
 const validation=withdrawals.indexOf("throw new Error('INVALID_INPUT')"),verify=withdrawals.indexOf('await verifyTurnstileToken'),transaction=withdrawals.indexOf('sql.begin');assert.ok(validation>=0&&verify>validation&&transaction>verify);
 assert.match(withdrawals,/turnstileToken/);assert.match(withdrawals,/expectedAction:'arcade_withdrawal'/);assert.match(panel,/action:'arcade_withdrawal'/);assert.match(withdrawals,/status='pending'/);assert.doesNotMatch(withdrawals,/balance=balance-/);
});

test('client uses public build key, sends one consumed token, and handles expiry/errors',()=>{
 assert.match(build,/process\.env\.NEXT_PUBLIC_TURNSTILE_SITE_KEY/);assert.doesNotMatch(build,/CLOUDFLARE_TURNSTILE_SECRET_KEY/);assert.match(widget,/expired-callback/);assert.match(widget,/error-callback/);assert.match(widget,/consume\(\)/);assert.match(panel,/turnstileToken/);assert.match(panel,/VERIFYING & SUBMITTING/);
});
