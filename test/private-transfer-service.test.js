// Phase 3 — private transfer service, API guards and privacy invariants.
// Exercised against a fake postgres client so ordering, validation and the SQL that
// is actually issued are tested as real behaviour rather than as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRIVATE_TRANSFER_RATE_LIMITS, assertNoWalletAddress, attachAnnouncementToPayment,
  enforcePrivateTransferRateLimit, enrollPrivateTransferIdentity, listAnnouncements,
  listPrivateTransferPayments, publicPrivateTransferIdentity, readPrivateTransferIdentity,
  recordAnnouncement, recordPrivateTransferPayment, resolvePrivateTransferIdentity,
  validateAnnouncementInput, validateEnrollmentInput,
} from '../server/private-transfer.js';
import privateTransferRouter from '../api/private-transfer/[route].js';
import { computeSpendPublicKeyFixture } from './fixtures/private-transfer-keys.js';
import { enrollmentMessage, personalMessageHash } from '../src/stealth/recovery.js';
import { signDigest, addressForPrivateKey } from '../src/stealth/signer.js';
import { N } from '../src/stealth/secp256k1.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const routerSource = read('api/private-transfer/[route].js');
const schema = read('db/schema.sql');

const USER = { id: '22222222-2222-4222-8222-222222222222', username: 'alice' };
const FIXTURE = computeSpendPublicKeyFixture();

/** Minimal postgres-tagged-template double that records every statement. */
function fakeSql(state = {}) {
  const calls = [];
  const run = (strings, ...values) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ text, values });
    if (/FROM users WHERE id=/.test(text)) return Promise.resolve(state.userRow ? [state.userRow] : []);
    if (/username_normalized=/.test(text)) return Promise.resolve(state.lookupRows ?? []);
    if (/FROM private_transfer_identities i JOIN users/.test(text)) return Promise.resolve(state.ownIdentityRows ?? []);
    if (/FROM private_transfer_identities WHERE user_id=/.test(text)) {
      if (/i\.id/.test(text)) return Promise.resolve(state.ownIdentityRows ?? []);
      return Promise.resolve(state.existingIdentityRows ?? []);
    }
    if (/INSERT INTO private_transfer_identities/.test(text)) return Promise.resolve(state.insertedIdentityRows ?? []);
    if (/FROM private_transfer_identities i WHERE i\.user_id=/.test(text)) return Promise.resolve(state.resolveIdentityRows ?? []);
    if (/INSERT INTO private_transfer_announcements/.test(text)) return Promise.resolve(state.insertedAnnouncementRows ?? [{ id: 7, created_at: 'now' }]);
    if (/FROM private_transfer_announcements WHERE transaction_hash=/.test(text)) return Promise.resolve(state.duplicateAnnouncementRows ?? []);
    if (/FROM private_transfer_announcements/.test(text)) return Promise.resolve(state.announcementRows ?? []);
    if (/INSERT INTO private_transfer_payments/.test(text)) return Promise.resolve(state.insertedPaymentRows ?? [{ id: 'pppppppp-pppp-4ppp-8ppp-pppppppppppp' }]);
    if (/FROM private_transfer_payments WHERE payment_tx_hash=/.test(text)) return Promise.resolve(state.duplicatePaymentRows ?? []);
    if (/UPDATE private_transfer_payments/.test(text)) return Promise.resolve(state.updatedPaymentRows ?? [{ id: 'pppppppp-pppp-4ppp-8ppp-pppppppppppp', status: 'announcement_confirmed' }]);
    if (/FROM private_transfer_payments WHERE user_id=/.test(text)) return Promise.resolve(state.paymentRows ?? []);
    if (/SELECT count\(\*\)::int AS count FROM private_transfer_attempts/.test(text)) return Promise.resolve([{ count: state.attempts ?? 0 }]);
    if (/INSERT INTO private_transfer_attempts/.test(text)) return Promise.resolve([]);
    if (/INSERT INTO audit_logs/.test(text)) return Promise.resolve([]);
    return Promise.resolve([]);
  };
  run.calls = calls;
  run.json = (value) => value;
  return run;
}

/* ------------------------------------------------------------------ enrollment */
test('enrollment stores public material and returns a projection with no address', async () => {
  const sql = fakeSql({ userRow: { username: 'alice', wallet_address: FIXTURE.walletAddress }, existingIdentityRows: [], insertedIdentityRows: [{ ...FIXTURE.row }] });
  const identity = await enrollPrivateTransferIdentity(sql, {
    userId: USER.id,
    input: FIXTURE.enrollmentInput,
  });
  assert.equal(identity.metaAddress, FIXTURE.enrollmentInput.metaAddress);
  assert.equal(identity.fingerprint, FIXTURE.enrollmentInput.fingerprint);
  assert.equal(JSON.stringify(identity).toLowerCase().includes('wallet'), false);
  assert.equal(JSON.stringify(identity).includes(FIXTURE.enrollmentInput.enrollmentSignature), false, 'the signature is never echoed back');
  const insert = sql.calls.find((call) => /INSERT INTO private_transfer_identities/.test(call.text));
  assert.ok(insert, 'the identity insert must run');
  assert.equal(sql.calls.some((call) => /private_key|seed|mnemonic/i.test(call.text)), false);
  const audit = sql.calls.find((call) => /INSERT INTO audit_logs/.test(call.text));
  assert.ok(audit);
  assert.equal(JSON.stringify(audit.values).toLowerCase().includes('wallet'), false, 'audit metadata carries no address');
});

test('enrollment refuses malformed or dangerous payloads', () => {
  assert.throws(() => validateEnrollmentInput({ ...FIXTURE.enrollmentInput, schemeId: 2 }), /PRIVATE_TRANSFER_UNSUPPORTED_SCHEME/);
  assert.throws(() => validateEnrollmentInput({ ...FIXTURE.enrollmentInput, protocolVersion: 2 }), /PRIVATE_TRANSFER_UNSUPPORTED_PROTOCOL_VERSION/);
  assert.throws(() => validateEnrollmentInput({ ...FIXTURE.enrollmentInput, metaAddress: 'st:eth:0x' + '02'.repeat(33) }), /PRIVATE_TRANSFER_INVALID_META_ADDRESS/);
  assert.throws(() => validateEnrollmentInput({ ...FIXTURE.enrollmentInput, viewingPublicKey: FIXTURE.enrollmentInput.spendingPublicKey }), /PRIVATE_TRANSFER_KEYS_NOT_DISTINCT/);
  assert.throws(() => validateEnrollmentInput({ ...FIXTURE.enrollmentInput, enrollmentSignature: '0x' + '11'.repeat(64) }), /PRIVATE_TRANSFER_INVALID_SIGNATURE/);
  assert.throws(() => validateEnrollmentInput({ ...FIXTURE.enrollmentInput, enrollmentSignature: '' }), /PRIVATE_TRANSFER_SIGNATURE_REQUIRED/);
  assert.throws(() => validateEnrollmentInput({ ...FIXTURE.enrollmentInput, spendingPrivateKey: '0xdead' }), /PRIVATE_TRANSFER_INVALID_INPUT/, 'a private key may never be part of an enrollment payload');
  assert.throws(() => validateEnrollmentInput({ ...FIXTURE.enrollmentInput, seedPhrase: 'correct horse' }), /PRIVATE_TRANSFER_INVALID_INPUT/);
});

test('a second enrollment is refused instead of silently replacing a funded identity', async () => {
  const sql = fakeSql({ userRow: { username: 'alice', wallet_address: FIXTURE.walletAddress }, existingIdentityRows: [{ id: 'existing' }] });
  await assert.rejects(
    enrollPrivateTransferIdentity(sql, { userId: USER.id, input: FIXTURE.enrollmentInput }),
    /PRIVATE_TRANSFER_ALREADY_ENROLLED/,
  );
  assert.equal(sql.calls.some((call) => /INSERT INTO private_transfer_identities/.test(call.text)), false);
});

test('enrollment requires a claimed .veyra username', async () => {
  const sql = fakeSql({ userRow: { username: null, wallet_address: FIXTURE.walletAddress } });
  await assert.rejects(enrollPrivateTransferIdentity(sql, { userId: USER.id, input: FIXTURE.enrollmentInput }), /PRIVATE_TRANSFER_USERNAME_REQUIRED/);
});

test('the enrollment signature must come from the wallet that owns the username', async () => {
  // A signature over the same message from a DIFFERENT wallet is refused: the backend
  // never trusts a client's claim about which keys belong to an account.
  const otherKey = (BigInt(FIXTURE.walletPrivateKey) + 987654321n) % N;
  const message = enrollmentMessage({
    username: 'alice',
    metaAddress: FIXTURE.enrollmentInput.metaAddress,
    siskPublicKey: FIXTURE.enrollmentInput.siskPublicKey,
    chainId: 4441,
    protocolVersion: 1,
  });
  const { r, s, recovery } = signDigest(otherKey, personalMessageHash(message));
  const foreignSignature = '0x' + r.toString(16).padStart(64, '0') + s.toString(16).padStart(64, '0') + recovery.toString(16).padStart(2, '0');
  assert.notEqual(addressForPrivateKey(otherKey), FIXTURE.walletAddress);

  const sql = fakeSql({ userRow: { username: 'alice', wallet_address: FIXTURE.walletAddress }, existingIdentityRows: [] });
  await assert.rejects(
    enrollPrivateTransferIdentity(sql, { userId: USER.id, input: { ...FIXTURE.enrollmentInput, enrollmentSignature: foreignSignature } }),
    /PRIVATE_TRANSFER_INVALID_SIGNATURE/,
  );
  assert.equal(sql.calls.some((call) => /INSERT INTO private_transfer_identities/.test(call.text)), false);

  // A signature over a different meta-address (i.e. a swapped key) is refused too.
  const swappedMessage = enrollmentMessage({
    username: 'alice',
    metaAddress: FIXTURE.enrollmentInput.metaAddress,
    siskPublicKey: FIXTURE.enrollmentInput.siskPublicKey,
    chainId: 4441,
    protocolVersion: 1,
  }).replace('username: alice', 'username: alice ');
  const swapped = signDigest(FIXTURE.walletPrivateKey, personalMessageHash(swappedMessage));
  const swappedSignature = '0x' + swapped.r.toString(16).padStart(64, '0') + swapped.s.toString(16).padStart(64, '0') + swapped.recovery.toString(16).padStart(2, '0');
  await assert.rejects(
    enrollPrivateTransferIdentity(fakeSql({ userRow: { username: 'alice', wallet_address: FIXTURE.walletAddress }, existingIdentityRows: [] }),
      { userId: USER.id, input: { ...FIXTURE.enrollmentInput, enrollmentSignature: swappedSignature } }),
    /PRIVATE_TRANSFER_INVALID_SIGNATURE/,
  );
});

/* ------------------------------------------------------------------ projections */
test('the public projection cannot carry a wallet-shaped field', () => {
  // The projection is an allowlist AND it fails closed: any record that carries a
  // wallet-shaped field is refused loudly rather than quietly dropped.
  assert.throws(() => publicPrivateTransferIdentity({ ...FIXTURE.row, wallet_address: '0x' + 'ab'.repeat(20) }), /PRIVATE_TRANSFER_ADDRESS_PRESENT/);
  assert.throws(() => publicPrivateTransferIdentity({ ...FIXTURE.row, recipientAddress: '0xabc' }), /PRIVATE_TRANSFER_ADDRESS_PRESENT/);
  const projected = publicPrivateTransferIdentity({ ...FIXTURE.row });
  assert.equal(JSON.stringify(projected).includes('abababab'), false);
  assert.throws(() => assertNoWalletAddress({ recipientAddress: '0xabc' }), /PRIVATE_TRANSFER_ADDRESS_PRESENT/);
  assert.throws(() => assertNoWalletAddress({ address: '0xabc' }), /PRIVATE_TRANSFER_ADDRESS_PRESENT/);
  const ok = publicPrivateTransferIdentity({ ...FIXTURE.row, username: 'bob' });
  assert.equal(ok.username, 'bob');
  assert.equal(Object.keys(ok).includes('walletAddress'), false);
  assert.equal(Object.keys(ok).includes('address'), false);
});

/* ------------------------------------------------------------------ resolution */
test('resolution returns public stealth material only', async () => {
  const resolved = await resolvePrivateTransferIdentity(fakeSql({
    takenRows: [],
    userRows: [],
    lookupRows: [{ id: USER.id, username: 'bob' }],
    resolveIdentityRows: [{ protocol_version: 1, scheme_id: 1, ...FIXTURE.row }],
  }), 'bob');
  assert.equal(resolved.username, 'bob');
  assert.equal(resolved.metaAddress, FIXTURE.row.meta_address.toLowerCase());
  assert.equal(JSON.stringify(resolved).toLowerCase().includes('wallet'), false);
  assert.equal(Object.values(resolved).some((value) => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value.toLowerCase())), false, 'no 20-byte address may appear in a resolved record');
});

test('an unenrolled recipient and an unknown name are indistinguishable', async () => {
  const unknown = fakeSql({ lookupRows: [] });
  assert.equal(await resolvePrivateTransferIdentity(unknown, 'ghost'), null);

  const unenrolled = fakeSql({ userRows: [{ id: USER.id, username: 'bob' }], lookupRows: [{ id: USER.id, username: 'bob' }], resolveIdentityRows: [] });
  await assert.rejects(resolvePrivateTransferIdentity(unenrolled, 'bob'), /RECIPIENT_NOT_ENROLLED/);
  assert.equal(unenrolled.calls.some((call) => /wallet_address/.test(call.text)), false, 'resolution must never select a wallet column');
});

test('a resolve for a scheme-1 record with a foreign version is refused', async () => {
  const sql = fakeSql({ lookupRows: [{ id: USER.id, username: 'bob' }], resolveIdentityRows: [{ ...FIXTURE.row, protocol_version: 2, scheme_id: 1 }] });
  await assert.rejects(resolvePrivateTransferIdentity(sql, 'bob'), /PRIVATE_TRANSFER_UNSUPPORTED_PROTOCOL_VERSION/);
});

/* ------------------------------------------------------------------ rate limits */
test('the private-transfer rate limiter bounds enumeration-sensitive actions', async () => {
  assert.deepEqual(Object.keys(PRIVATE_TRANSFER_RATE_LIMITS).sort(), ['announcements', 'enroll', 'payments', 'resolve']);
  // Limits must bound abuse without making normal wallet use unreliable.
  assert.ok(PRIVATE_TRANSFER_RATE_LIMITS.resolve.max >= 30, 'a scanning user needs head-room');
  assert.ok(PRIVATE_TRANSFER_RATE_LIMITS.announcements.max >= 30);
  assert.ok(PRIVATE_TRANSFER_RATE_LIMITS.payments.max >= 20);
  assert.ok(PRIVATE_TRANSFER_RATE_LIMITS.enroll.max >= 3, 'a user may retry enrollment a few times');
  // The payments limiter is wired into the write path.
  const blocked = fakeSql({ attempts: PRIVATE_TRANSFER_RATE_LIMITS.payments.max });
  await assert.rejects(
    recordPrivateTransferPayment(blocked, { userId: USER.id, ipHash: 'abc', input: { stealthAddress: FIXTURE.stealthAddress, ephemeralPublicKey: FIXTURE.ephemeralPublicKey, viewTag: '0x' + FIXTURE.viewTag, amountAtomic: '1', paymentTxHash: '0x' + 'ef'.repeat(32) } }),
    /TOO_MANY_ATTEMPTS/,
  );
  const under = fakeSql({ attempts: 3 });
  await enforcePrivateTransferRateLimit(under, { ipHash: 'abc', action: 'resolve' });
  assert.equal(under.calls.some((call) => /INSERT INTO private_transfer_attempts/.test(call.text)), true);

  const over = fakeSql({ attempts: PRIVATE_TRANSFER_RATE_LIMITS.resolve.max });
  await assert.rejects(enforcePrivateTransferRateLimit(over, { ipHash: 'abc', action: 'resolve' }), /TOO_MANY_ATTEMPTS/);
  await assert.rejects(enforcePrivateTransferRateLimit(over, { ipHash: 'abc', action: 'bogus' }), /INVALID_INPUT/);
});

/* ------------------------------------------------------------------ announcements */
test('announcements are validated, stored once and paginated without a user filter', async () => {
  const input = { schemeId: 1, stealthAddress: FIXTURE.stealthAddress, ephemeralPublicKey: FIXTURE.ephemeralPublicKey, metadata: '0x' + FIXTURE.viewTag, transactionHash: '0x' + 'ab'.repeat(32), chainId: 4441 };
  const sql = fakeSql({});
  const saved = await recordAnnouncement(sql, { userId: USER.id, input });
  assert.equal(saved.duplicate, false);
  assert.equal(saved.announcement.stealthAddress, input.stealthAddress);

  const duplicate = fakeSql({ duplicateAnnouncementRows: [{ id: 7 }] });
  const again = await recordAnnouncement(duplicate, { userId: USER.id, input });
  assert.equal(again.duplicate, true);
  assert.equal(duplicate.calls.some((call) => /INSERT INTO private_transfer_announcements/.test(call.text)), false);

  const rows = Array.from({ length: 3 }, (_, index) => ({
    id: index + 1, chain_id: 4441, scheme_id: 1, stealth_address: FIXTURE.stealthAddress,
    ephemeral_public_key: FIXTURE.ephemeralPublicKey, metadata: '0x' + FIXTURE.viewTag,
    transaction_hash: '0x' + 'cd'.repeat(32), block_number: null,
  }));
  const page = await listAnnouncements(fakeSql({ announcementRows: rows }), { cursor: 0, limit: 2 });
  assert.equal(page.announcements.length, 2);
  assert.equal(page.nextCursor, 2);
  assert.equal(JSON.stringify(page).includes('user_id'), false);
});

test('announcement validation rejects off-curve keys, bad chains and bad metadata', () => {
  const base = { schemeId: 1, stealthAddress: FIXTURE.stealthAddress, ephemeralPublicKey: FIXTURE.ephemeralPublicKey, metadata: '0x8c', transactionHash: '0x' + 'ab'.repeat(32), chainId: 4441 };
  assert.equal(validateAnnouncementInput(base).schemeId, 1);
  assert.throws(() => validateAnnouncementInput({ ...base, ephemeralPublicKey: '0x02' + '00'.repeat(32) }), /PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT/);
  assert.throws(() => validateAnnouncementInput({ ...base, ephemeralPublicKey: '0x04' + '11'.repeat(64) }), /PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT/);
  assert.throws(() => validateAnnouncementInput({ ...base, schemeId: 3 }), /PRIVATE_TRANSFER_UNSUPPORTED_SCHEME/);
  assert.throws(() => validateAnnouncementInput({ ...base, chainId: 1 }), /PRIVATE_TRANSFER_UNSUPPORTED_CHAIN/);
  assert.throws(() => validateAnnouncementInput({ ...base, metadata: '0x' }), /PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT/);
  assert.throws(() => validateAnnouncementInput({ ...base, transactionHash: '0x1234' }), /PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT/);
});

/* ------------------------------------------------------------------ payments */
test('payment reconciliation stores no recipient identity and is idempotent', async () => {
  const input = {
    stealthAddress: FIXTURE.stealthAddress, ephemeralPublicKey: FIXTURE.ephemeralPublicKey,
    viewTag: '0x' + FIXTURE.viewTag, amountAtomic: '2500000000000000', paymentTxHash: '0x' + 'ef'.repeat(32),
    status: 'payment_confirmed', recipientUsername: 'bob', recipientMetaAddress: FIXTURE.enrollmentInput.metaAddress,
  };
  const sql = fakeSql({});
  const result = await recordPrivateTransferPayment(sql, { userId: USER.id, input });
  assert.equal(result.paymentId, 'pppppppp-pppp-4ppp-8ppp-pppppppppppp');
  const insert = sql.calls.find((call) => /INSERT INTO private_transfer_payments/.test(call.text));
  assert.ok(insert);
  assert.equal(insert.text.includes('recipient'), false, 'no recipient column may exist in the payment row');
  assert.equal(JSON.stringify(insert.values).includes('bob'), false, 'the recipient username is never persisted');
  assert.equal(JSON.stringify(insert.values).includes(FIXTURE.enrollmentInput.metaAddress), false, 'the recipient meta-address is never persisted');

  const duplicate = fakeSql({ duplicatePaymentRows: [{ id: result.paymentId }] });
  const again = await recordPrivateTransferPayment(duplicate, { userId: USER.id, input });
  assert.equal(again.duplicate, true);
  assert.equal(duplicate.calls.some((call) => /INSERT INTO private_transfer_payments/.test(call.text)), false);
});

test('payment rows reject a zero amount, a bad view tag and a bad tx hash', async () => {
  const base = { stealthAddress: FIXTURE.stealthAddress, ephemeralPublicKey: FIXTURE.ephemeralPublicKey, viewTag: '0x' + FIXTURE.viewTag, amountAtomic: '1', paymentTxHash: '0x' + 'ef'.repeat(32) };
  await assert.rejects(recordPrivateTransferPayment(fakeSql({}), { userId: USER.id, input: { ...base, amountAtomic: '0' } }), /INVALID_INPUT/);
  await assert.rejects(recordPrivateTransferPayment(fakeSql({}), { userId: USER.id, input: { ...base, viewTag: '0x1234' } }), /PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT/);
  await assert.rejects(recordPrivateTransferPayment(fakeSql({}), { userId: USER.id, input: { ...base, paymentTxHash: 'nope' } }), /PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT/);
});

test('attaching an announcement transaction is owner-scoped and validated', async () => {
  const sql = fakeSql({});
  const result = await attachAnnouncementToPayment(sql, { userId: USER.id, paymentId: 'pppppppp-pppp-4ppp-8ppp-pppppppppppp', announcementTxHash: '0x' + '12'.repeat(32) });
  assert.equal(result.status, 'announcement_confirmed');
  const update = sql.calls.find((call) => /UPDATE private_transfer_payments/.test(call.text));
  assert.match(update.text, /user_id=\?/, 'the update is scoped to the authenticated owner');
  await assert.rejects(attachAnnouncementToPayment(fakeSql({}), { userId: USER.id, paymentId: 'x', announcementTxHash: 'bad' }), /PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT/);
  await assert.rejects(attachAnnouncementToPayment(fakeSql({ updatedPaymentRows: [] }), { userId: USER.id, paymentId: 'other-user-row', announcementTxHash: '0x' + '12'.repeat(32) }), /NOT_FOUND/);
});

test('the reconciliation list never joins a recipient identity', async () => {
  const sql = fakeSql({ paymentRows: [{ id: 'p1', stealth_address: FIXTURE.stealthAddress, ephemeral_public_key: FIXTURE.ephemeralPublicKey, view_tag: '0x' + FIXTURE.viewTag, amount_atomic: '10', payment_tx_hash: null, announcement_tx_hash: null, status: 'payment_confirmed', failure_reason: null, created_at: 'now' }] });
  const payments = await listPrivateTransferPayments(sql, { userId: USER.id });
  assert.equal(payments.length, 1);
  assert.equal(sql.calls.some((call) => /JOIN users/.test(call.text)), false);
  assert.equal(JSON.stringify(payments).toLowerCase().includes('username'), false);
});

test('reading your own identity is public-projection only', async () => {
  const sql = fakeSql({ ownIdentityRows: [{ id: 'i1', ...FIXTURE.row, username: 'alice' }] });
  const identity = await readPrivateTransferIdentity(sql, USER.id);
  assert.equal(identity.username, 'alice');
  assert.equal(sql.calls[0].text.includes('wallet_address'), false);
});

/* ------------------------------------------------------------------ routing surface */
test('the router exposes no per-user path (no announcement oracle)', () => {
  // Every route must be a single segment: a nested path would not match the
  // `[route].js` serverless function and would 404 in production.
  assert.doesNotMatch(routerSource, /segments\.length === 2/);
  assert.match(routerSource, /single-segment routes only/i);
  assert.doesNotMatch(routerSource, /username\}\/announcements|\/\$\{username\}\//, 'no route may embed a username in the path');
  assert.doesNotMatch(routerSource, /walletAddress|wallet_address/);
  assert.match(routerSource, /requireAuth/);
  assert.equal(typeof privateTransferRouter, 'function');
});

test('the schema keeps private keys out and addresses unlinkable', () => {
  const block = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS private_transfer_identities'));
  assert.match(block, /user_id uuid NOT NULL UNIQUE REFERENCES users\(id\)/);
  assert.match(block, /protocol_version integer NOT NULL CHECK \(protocol_version = 1\)/);
  assert.match(block, /scheme_id integer NOT NULL CHECK \(scheme_id = 1\)/);
  assert.match(block, /CONSTRAINT private_transfer_keys_distinct CHECK \(spending_public_key <> viewing_public_key\)/);
  assert.match(block, /status text NOT NULL DEFAULT 'active' CHECK \(status IN \('active','revoked','pending'\)\)/);
  assert.doesNotMatch(block, /private_key|spending_private|viewing_private|stealth_private|seed|mnemonic/);
  assert.doesNotMatch(block, /wallet_address/);

  const announcements = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS private_transfer_announcements'), schema.indexOf('CREATE TABLE IF NOT EXISTS private_transfer_payments'));
  assert.doesNotMatch(announcements, /user_id/, 'the public announcement ledger must not be user-keyed');
  assert.match(announcements, /transaction_hash text NOT NULL UNIQUE/);

  const payments = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS private_transfer_payments'), schema.indexOf('CREATE TABLE IF NOT EXISTS private_transfer_attempts'));
  assert.doesNotMatch(payments, /username|meta_address|wallet/, 'payment rows must carry no recipient identity');
  assert.match(payments, /announcement_tx_hash text CHECK/);
});
