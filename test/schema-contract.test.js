import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema=readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8');
const account=readFileSync(new URL('../api/account/[route].js',import.meta.url),'utf8');
const route=name=>{const m=account.match(new RegExp('// ---- route: '+name+' ----\\n([\\s\\S]*?)// ---- end route: '+name+' ----'));if(!m)throw new Error(`route ${name} missing from api/account/[route].js`);return m[1];};
const social=route('socialVerification');
const withdrawals=route('withdrawals');
const adminWithdrawals=readFileSync(new URL('../server/admin-withdrawals-handler.js',import.meta.url),'utf8');
const identityService=readFileSync(new URL('../server/identity.js',import.meta.url),'utf8');
const identityRouter=readFileSync(new URL('../api/identity/[route].js',import.meta.url),'utf8');

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

test('schema contains every permanent-identity field used by the identity API',()=>{
  for(const column of ['username','username_normalized','username_created_at']){
    assert.ok(identityService.includes(column)||identityRouter.includes(column),column);
    assert.match(schema,new RegExp(`\\b${column}\\b`));
  }
  assert.match(schema,/users_username_normalized_unique/);
  assert.match(schema,/users_username_normalized_format/);
  assert.match(schema,/users_username_pairing/);
  assert.match(schema,/identity_attempts/);
  assert.match(schema,/identity_attempts_rate/);
  // The identity columns are added, never declared inside the original users table,
  // so the migration stays additive and existing rows keep working.
  const usersTable=schema.match(/CREATE TABLE IF NOT EXISTS users \(([\s\S]*?)\n\);/);
  assert.ok(usersTable,'the original users table must still be declared');
  assert.doesNotMatch(usersTable[1],/username/,'identity columns must not be baked into the original table definition');
  assert.match(usersTable[1],/wallet_address text NOT NULL UNIQUE/,'wallet ownership record is unchanged');
});

test('every identity migration statement is safe to re-run',()=>{
  const block=schema.slice(schema.indexOf('-- Phase 1 — permanent .veyra identity layer.'));
  assert.ok(block.length>0,'identity migration block must exist');
  const statements=block.split(';').map((s)=>s.trim())
    .filter((s)=>s&&!s.startsWith('--'))
    .filter((s)=>/username|identity_attempts/i.test(s));
  assert.ok(statements.length>=6,`expected the full identity block, found ${statements.length} statements`);
  for(const statement of statements){
    const additive=/IF NOT EXISTS/i.test(statement);
    const recreated=/DROP (CONSTRAINT|INDEX) IF EXISTS/i.test(statement)||/ADD CONSTRAINT/i.test(statement)&&/IF NOT EXISTS/i.test(statement);
    const constraintAdd=/ALTER TABLE users ADD CONSTRAINT/i.test(statement);
    assert.ok(additive||recreated||constraintAdd,`not re-runnable: ${statement.slice(0,80)}`);
    assert.doesNotMatch(statement,/DROP TABLE|TRUNCATE|DELETE FROM|ALTER COLUMN .* DROP/i);
  }
});

test('schema contains every private-transfer field used by the Phase 3 API',()=>{
  const privateTransfer=readFileSync(new URL('../server/private-transfer.js',import.meta.url),'utf8');
  const router=readFileSync(new URL('../api/private-transfer/[route].js',import.meta.url),'utf8');
  for(const column of ['protocol_version','scheme_id','spending_public_key','viewing_public_key','meta_address','fingerprint','sisk_public_key','enrollment_signature','wallet_class','status']){
    assert.ok(privateTransfer.includes(column)||router.includes(column),column);
    assert.match(schema,new RegExp(`\\b${column}\\b`));
  }
  assert.match(schema,/private_transfer_identities/);
  assert.match(schema,/private_transfer_identities_user_id_key|user_id uuid NOT NULL UNIQUE/);
  assert.match(schema,/private_transfer_keys_distinct/);
  assert.match(schema,/private_transfer_announcements/);
  assert.match(schema,/private_transfer_payments/);
  assert.match(schema,/private_transfer_attempts/);
  // Additive table set, and never a private-key column anywhere in it.
  // Comments are allowed to explain the rule; the DDL itself must never declare such a column.
  const block=schema.slice(schema.indexOf('Phase 3: private')).replace(/--[^\n]*/g,'');
  assert.doesNotMatch(block,/spending_private_key|viewing_private_key|stealth_private_key|seed|mnemonic/i);
  assert.doesNotMatch(block,/wallet_address/);
});
