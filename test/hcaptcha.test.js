import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyHcaptchaToken } from '../server/hcaptcha.js';

const valid='abcdefghijklmnopqrstuvwxyz0123456789HCAPTCHA';
function withSecret(fn){const old=process.env.HCAPTCHA_SECRET_KEY;process.env.HCAPTCHA_SECRET_KEY='test-hcaptcha-secret-server-only';return Promise.resolve().then(fn).finally(()=>{if(old==null)delete process.env.HCAPTCHA_SECRET_KEY;else process.env.HCAPTCHA_SECRET_KEY=old;});}

test('hCaptcha verifies site-entry tokens through the official siteverify endpoint',()=>withSecret(async()=>{
 let request;const result=await verifyHcaptchaToken({token:valid,remoteIp:'203.0.113.4',expectedAction:'site_entry',fetchImpl:async(url,opts)=>{request={url,opts};return{ok:true,json:async()=>({success:true,hostname:'veyra.example',challenge_ts:new Date().toISOString()})};}});
 assert.equal(result.success,true);assert.equal(request.url,'https://api.hcaptcha.com/siteverify');assert.match(String(request.opts.body),/secret=test-hcaptcha-secret-server-only/);assert.match(String(request.opts.body),/response=/);assert.match(String(request.opts.body),/remoteip=203.0.113.4/);
}));

test('hCaptcha fails closed for missing, rejected, unavailable, and malformed results',()=>withSecret(async()=>{
 let calls=0;await assert.rejects(()=>verifyHcaptchaToken({token:'',expectedAction:'site_entry',fetchImpl:async()=>{calls++;}}),/CAPTCHA_REQUIRED/);assert.equal(calls,0);
 await assert.rejects(()=>verifyHcaptchaToken({token:valid,expectedAction:'site_entry',fetchImpl:async()=>({ok:true,json:async()=>({success:false,'error-codes':['invalid-input-response']})})}),/CAPTCHA_FAILED/);
 await assert.rejects(()=>verifyHcaptchaToken({token:valid,expectedAction:'site_entry',fetchImpl:async()=>{throw new Error('network')}}),/CAPTCHA_UNAVAILABLE/);
 await assert.rejects(()=>verifyHcaptchaToken({token:valid,expectedAction:'site_entry',fetchImpl:async()=>({ok:true,json:async()=>({unexpected:true})})}),/CAPTCHA_UNAVAILABLE/);
 await assert.rejects(()=>verifyHcaptchaToken({token:valid,expectedAction:'wrong_action',fetchImpl:async()=>({ok:true,json:async()=>({success:true})})}),/CAPTCHA_FAILED/);
}));

test('hCaptcha client integration remains public-key-only and provider-selected',()=>{
 const widget=fs.readFileSync(new URL('../src/ui/HCaptchaWidget.js',import.meta.url),'utf8');const gate=fs.readFileSync(new URL('../src/ui/SiteEntryGate.js',import.meta.url),'utf8');const build=fs.readFileSync(new URL('../scripts/build-static.js',import.meta.url),'utf8');
 assert.match(widget,/js\.hcaptcha\.com\/1\/api\.js\?render=explicit&onload=/);assert.match(widget,/HCAPTCHA_SITE_KEY/);assert.doesNotMatch(widget,/HCAPTCHA_SECRET_KEY/);assert.match(gate,/SITE_ENTRY_CAPTCHA_PROVIDER==='hcaptcha'/);assert.match(gate,/action:'site_entry'/);assert.match(gate,/captchaToken/);assert.match(build,/NEXT_PUBLIC_HCAPTCHA_SITE_KEY/);assert.doesNotMatch(build,/HCAPTCHA_SECRET_KEY/);
});
