import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema=readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8');
const social=readFileSync(new URL('../api/social-verification.js',import.meta.url),'utf8');
const withdrawals=readFileSync(new URL('../api/withdrawals.js',import.meta.url),'utf8');
const adminWithdrawals=readFileSync(new URL('../server/admin-withdrawals-handler.js',import.meta.url),'utf8');

test('schema contains every social-proof persistence field used by the API',()=>{
  for(const column of ['screenshot_data','screenshot_mime','attempt_number']){
    assert.ok(social.includes(column));
    assert.match(schema,new RegExp(`\\b${column}\\b`));
  }
  assert.match(schema,/social_user_attempt_unique/);
});

test('schema matches current idempotent manual-withdrawal workflow',()=>{
  for(const column of ['idempotency_key','payment_reference','sent_at','sent_by','cancelled_at','cancelled_by','failure_reason']){
    assert.ok(withdrawals.includes(column)||adminWithdrawals.includes(column),column);
    assert.match(schema,new RegExp(`\\b${column}\\b`));
  }
  assert.match(schema,/status IN \('pending','sent','cancelled','failed'\)/);
  assert.match(schema,/withdrawal_user_idempotency_unique/);
});
