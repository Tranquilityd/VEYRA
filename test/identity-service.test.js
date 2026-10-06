// Phase 1 — identity service, API guards and database constraints.
// The service is exercised with a fake postgres client, so claim ordering,
// atomicity and error mapping are tested as real behaviour rather than as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IDENTITY_RATE_LIMITS, checkAvailability, claimIdentity, enforceIdentityRateLimit,
  identityIpHash, publicIdentity, readIdentity, resolveIdentityRecord,
} from '../server/identity.js';
import { USERNAME_REASONS } from '../src/identity/username.js';
import identityRouter from '../api/identity/[route].js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('db/schema.sql');
const routerSource = read('api/identity/[route].js');

const USER = { id: '11111111-1111-4111-8111-111111111111', wallet_address: '0xAbC0000000000000000000000000000000000001' };

/**
 * Minimal postgres-tagged-template double. Every statement is recorded so the
 * tests can assert both the outcome and the shape of the SQL that produced it.
 */
function fakeSql(state = {}) {
  const calls = [];
  const run = (strings, ...values) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    calls.push({ text, values });
    if (/INSERT INTO identity_attempts/.test(text)) return Promise.resolve([]);
    if (/FROM identity_attempts/.test(text)) return Promise.resolve([{ count: state.attempts ?? 0 }]);
    if (/INSERT INTO audit_logs/.test(text)) return Promise.resolve([]);
    if (/pg_advisory_xact_lock/.test(text)) return Promise.resolve([]);
    if (/UPDATE users SET username/.test(text)) {
      if (state.uniqueViolation) { const error = new Error('duplicate key value violates unique constraint'); error.code = '23505'; return Promise.reject(error); }
      return Promise.resolve(state.updateRows ?? []);
    }
    if (/FOR UPDATE/.test(text)) return Promise.resolve(state.currentRows ?? []);
    if (/username_created_at/.test(text)) return Promise.resolve(state.userRows ?? []);
    if (/1 AS taken/.test(text)) return Promise.resolve(state.takenRows ?? []);
    if (/SELECT id, username FROM users/.test(text)) return Promise.resolve(state.lookupRows ?? []);
    return Promise.resolve([]);
  };
  run.calls = calls;
  run.json = (value) => value;
  run.begin = async (fn) => fn(run);
  return run;
}

const statement = (sql, pattern) => sql.calls.find((call) => pattern.test(call.text));

// ------------------------------------------------------------------- readIdentity
test('readIdentity returns the owner identity, with or without a username', async () => {
  const claimed = await readIdentity(fakeSql({ userRows: [{ wallet_address: USER.wallet_address, username: 'lester', username_created_at: new Date('2026-10-04') }] }), USER.id);
  assert.equal(claimed.username, 'lester');
  assert.equal(claimed.displayName, 'lester.veyra');
  assert.equal(claimed.hasUsername, true);
  assert.equal(claimed.walletAddress, USER.wallet_address);

  const legacy = await readIdentity(fakeSql({ userRows: [{ wallet_address: USER.wallet_address, username: null, username_created_at: null }] }), USER.id);
  assert.equal(legacy.username, null);
  assert.equal(legacy.displayName, null);
  assert.equal(legacy.hasUsername, false, 'existing users without a username stay valid');
});

test('readIdentity rejects an unknown user', async () => {
  await assert.rejects(() => readIdentity(fakeSql({ userRows: [] }), USER.id), /NOT_FOUND/);
});

// --------------------------------------------------------------- availability
test('availability reports a free, valid username', async () => {
  const result = await checkAvailability(fakeSql({ takenRows: [] }), 'lester');
  assert.deepEqual(result, { username: 'lester', displayName: 'lester.veyra', valid: true, available: true, reserved: false, reason: null, message: '' });
});

test('availability reports a taken username without leaking the owner', async () => {
  const sql = fakeSql({ takenRows: [{ taken: 1 }] });
  const result = await checkAvailability(sql, 'lester');
  assert.equal(result.valid, true);
  assert.equal(result.available, false);
  assert.equal(result.reason, 'USERNAME_TAKEN');
  assert.equal(result.reserved, false);
  assert.equal('userId' in result, false);
  assert.equal('walletAddress' in result, false);
  assert.ok(!JSON.stringify(result).includes(USER.wallet_address));
  // The probe must never select identifying columns.
  assert.match(statement(sql, /1 AS taken/).text, /SELECT 1 AS taken FROM users WHERE username_normalized/);
});

test('availability flags reserved and structurally invalid names', async () => {
  const reserved = await checkAvailability(fakeSql(), 'admin');
  assert.equal(reserved.valid, false);
  assert.equal(reserved.reserved, true);
  assert.equal(reserved.reason, USERNAME_REASONS.RESERVED);
  assert.equal(reserved.available, false);

  const invalid = await checkAvailability(fakeSql(), 'les-ter');
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reserved, false);
  assert.equal(invalid.reason, USERNAME_REASONS.INVALID_CHARACTERS);
});

test('availability normalizes before probing the database', async () => {
  const sql = fakeSql();
  await checkAvailability(sql, '@Lester.VEYRA');
  assert.deepEqual(statement(sql, /1 AS taken/).values, ['lester']);
});

// --------------------------------------------------------------------- lookup
test('resolveIdentityRecord maps a .veyra name to the internal user id', async () => {
  const sql = fakeSql({ lookupRows: [{ id: USER.id, username: 'lester' }] });
  const record = await resolveIdentityRecord(sql, 'Lester.VEYRA');
  assert.deepEqual(record, { userId: USER.id, username: 'lester' });
  assert.deepEqual(statement(sql, /SELECT id, username FROM users/).values, ['lester']);
});

test('resolveIdentityRecord returns null for unknown, invalid and reserved names', async () => {
  assert.equal(await resolveIdentityRecord(fakeSql({ lookupRows: [] }), 'nobody'), null);
  assert.equal(await resolveIdentityRecord(fakeSql(), 'les-ter'), null);
  assert.equal(await resolveIdentityRecord(fakeSql(), 'admin'), null);
});

test('publicIdentity exposes only the public projection', () => {
  const projected = publicIdentity({ userId: USER.id, username: 'lester' });
  assert.deepEqual(projected, { username: 'lester', displayName: 'lester.veyra' });
  assert.deepEqual(Object.keys(projected).sort(), ['displayName', 'username']);
  assert.equal(publicIdentity(null), null);
  // The internal id and wallet must never be part of a public identity payload.
  assert.ok(!JSON.stringify(projected).includes(USER.id));
  assert.match(routerSource, /publicIdentity\(record\)/);
});

// ---------------------------------------------------------------------- claim
test('an authenticated user can permanently claim an available username', async () => {
  const sql = fakeSql({
    currentRows: [{ id: USER.id, wallet_address: USER.wallet_address, username: null }],
    takenRows: [],
    updateRows: [{ username: 'lester', username_created_at: new Date('2026-10-04T10:00:00Z') }],
  });
  const identity = await claimIdentity(sql, { userId: USER.id, rawUsername: 'Lester' });
  assert.equal(identity.username, 'lester');
  assert.equal(identity.displayName, 'lester.veyra');
  assert.equal(identity.hasUsername, true);
  assert.equal(identity.walletAddress, USER.wallet_address, 'the wallet remains the ownership record');
  assert.ok(statement(sql, /INSERT INTO audit_logs/), 'the claim is audited');
  assert.match(statement(sql, /UPDATE users SET username/).text, /username_normalized IS NULL/, 'the update must be an atomic compare-and-set');
  assert.match(statement(sql, /pg_advisory_xact_lock/).text, /pg_advisory_xact_lock/, 'same-name claims are serialized');
});

test('claiming writes the normalized body and never the .veyra suffix', async () => {
  const sql = fakeSql({
    currentRows: [{ id: USER.id, wallet_address: USER.wallet_address, username: null }],
    updateRows: [{ username: 'player_1', username_created_at: new Date() }],
  });
  await claimIdentity(sql, { userId: USER.id, rawUsername: 'Player_1.veyra' });
  const update = statement(sql, /UPDATE users SET username/);
  assert.equal(update.values[0], 'player_1');
  assert.equal(update.values[1], 'player_1');
});

test('a user cannot claim a second username', async () => {
  const sql = fakeSql({ currentRows: [{ id: USER.id, wallet_address: USER.wallet_address, username: 'lester' }] });
  await assert.rejects(() => claimIdentity(sql, { userId: USER.id, rawUsername: 'jide' }), /USERNAME_ALREADY_CLAIMED/);
  assert.equal(statement(sql, /UPDATE users SET username/), undefined, 'no write is attempted for an existing identity');
});

test('an already-used username can never be claimed by another user', async () => {
  const sql = fakeSql({
    currentRows: [{ id: '22222222-2222-4222-8222-222222222222', wallet_address: '0xOther', username: null }],
    takenRows: [{ taken: 1 }],
  });
  await assert.rejects(() => claimIdentity(sql, { userId: '22222222-2222-4222-8222-222222222222', rawUsername: 'lester' }), /USERNAME_TAKEN/);
});

test('reserved and invalid usernames are rejected before any database write', async () => {
  for (const [value, expected] of [['admin', /USERNAME_RESERVED/], ['les-ter', /USERNAME_INVALID_CHARACTERS/], ['ab', /USERNAME_TOO_SHORT/], ['1lester', /USERNAME_MUST_START_WITH_LETTER/], ['le__ster', /USERNAME_CONSECUTIVE_UNDERSCORES/], ['', /USERNAME_REQUIRED/]]) {
    const sql = fakeSql({ currentRows: [{ id: USER.id, wallet_address: USER.wallet_address, username: null }] });
    await assert.rejects(() => claimIdentity(sql, { userId: USER.id, rawUsername: value }), expected);
    assert.equal(sql.calls.length, 0, `"${value}" must not reach the database`);
  }
});

test('simultaneous claims of one username cannot both succeed', async () => {
  // Winner: the row is still unclaimed when the guarded UPDATE runs.
  const winner = fakeSql({
    currentRows: [{ id: USER.id, wallet_address: USER.wallet_address, username: null }],
    takenRows: [],
    updateRows: [{ username: 'lester', username_created_at: new Date() }],
  });
  assert.equal((await claimIdentity(winner, { userId: USER.id, rawUsername: 'lester' })).username, 'lester');

  // Loser A: the other transaction committed first, so the pre-check sees it taken.
  const loserPrecheck = fakeSql({
    currentRows: [{ id: '22222222-2222-4222-8222-222222222222', wallet_address: '0xOther', username: null }],
    takenRows: [{ taken: 1 }],
  });
  await assert.rejects(() => claimIdentity(loserPrecheck, { userId: '22222222-2222-4222-8222-222222222222', rawUsername: 'lester' }), /USERNAME_TAKEN/);

  // Loser B: the claims interleave and the unique index is the final authority.
  const loserIndex = fakeSql({
    currentRows: [{ id: '33333333-3333-4333-8333-333333333333', wallet_address: '0xThird', username: null }],
    takenRows: [],
    uniqueViolation: true,
  });
  await assert.rejects(() => claimIdentity(loserIndex, { userId: '33333333-3333-4333-8333-333333333333', rawUsername: 'lester' }), /USERNAME_TAKEN/);

  // Loser C: two simultaneous claims by the SAME user lose the compare-and-set.
  const loserSameUser = fakeSql({
    currentRows: [{ id: USER.id, wallet_address: USER.wallet_address, username: null }],
    takenRows: [],
    updateRows: [],
  });
  await assert.rejects(() => claimIdentity(loserSameUser, { userId: USER.id, rawUsername: 'lester' }), /USERNAME_ALREADY_CLAIMED/);
});

test('claim errors carry stable codes, never raw database text', async () => {
  const sql = fakeSql({
    currentRows: [{ id: USER.id, wallet_address: USER.wallet_address, username: null }],
    takenRows: [{ taken: 1 }],
  });
  await assert.rejects(() => claimIdentity(sql, { userId: USER.id, rawUsername: 'lester' }), (error) => {
    assert.equal(error.message, 'USERNAME_TAKEN');
    return true;
  });
});

// ---------------------------------------------------------------- rate limiting
test('identity rate limits are enforced per action', async () => {
  const under = fakeSql({ attempts: IDENTITY_RATE_LIMITS.claim.max - 1 });
  await enforceIdentityRateLimit(under, { ipHash: 'hash', action: 'claim' });
  assert.ok(statement(under, /INSERT INTO identity_attempts/), 'an allowed attempt is recorded');

  const over = fakeSql({ attempts: IDENTITY_RATE_LIMITS.claim.max });
  await assert.rejects(() => enforceIdentityRateLimit(over, { ipHash: 'hash', action: 'claim' }), /TOO_MANY_ATTEMPTS/);
  assert.equal(statement(over, /INSERT INTO identity_attempts/), undefined);
});

test('availability and lookup are rate limited more tightly than ordinary reads', async () => {
  assert.ok(IDENTITY_RATE_LIMITS.availability.max > 0);
  assert.ok(IDENTITY_RATE_LIMITS.lookup.max > 0);
  assert.ok(IDENTITY_RATE_LIMITS.claim.max < IDENTITY_RATE_LIMITS.availability.max, 'claiming is limited harder than probing');
  const sql = fakeSql();
  await assert.rejects(() => enforceIdentityRateLimit(sql, { ipHash: 'hash', action: 'nonsense' }), /INVALID_INPUT/);
});

test('rate limiting skips safely when no client IP hash is available', async () => {
  const sql = fakeSql();
  await enforceIdentityRateLimit(sql, { ipHash: null, action: 'claim' });
  assert.equal(sql.calls.length, 0);
});

test('IP hashing never stores the raw address', () => {
  const previous = process.env.API_SESSION_SECRET;
  process.env.API_SESSION_SECRET = 'test-session-secret-that-is-long-enough';
  try {
    const hash = identityIpHash({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, socket: {} });
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok(!hash.includes('203.0.113.7'));
    assert.equal(hash, identityIpHash({ headers: { 'x-forwarded-for': '203.0.113.7' }, socket: {} }), 'only the first forwarded address is used');
    assert.notEqual(hash, identityIpHash({ headers: { 'x-forwarded-for': '203.0.113.8' }, socket: {} }));
  } finally {
    if (previous === undefined) delete process.env.API_SESSION_SECRET; else process.env.API_SESSION_SECRET = previous;
  }
});

// ------------------------------------------------------------------ API guards
function fakeRes() {
  return {
    statusCode: 0, body: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    hasHeader(key) { return key in this.headers; },
    end(payload) { this.body = JSON.parse(payload); },
  };
}
const call = async (req) => {
  const res = fakeRes();
  await identityRouter(req, res);
  return res;
};

test('identity endpoints reject unauthenticated claims and identity reads', async () => {
  for (const route of ['claim', 'me']) {
    const res = await call({ method: route === 'claim' ? 'POST' : 'GET', query: { route }, headers: {}, body: { username: 'lester' } });
    assert.equal(res.statusCode, 401, `${route} must require a wallet session`);
    assert.equal(res.body.error, 'UNAUTHORIZED');
  }
});

test('identity endpoints reject unsupported methods and unknown routes', async () => {
  const wrongMethod = await call({ method: 'GET', query: { route: 'claim' }, headers: {} });
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.body.error, 'METHOD_NOT_ALLOWED');

  const unknown = await call({ method: 'GET', query: { route: 'delete-everything' }, headers: {} });
  assert.equal(unknown.statusCode, 404);
});

test('the router delegates to the shared service and never trusts client identity', () => {
  assert.match(routerSource, /requireAuth\(req\)/);
  assert.match(routerSource, /userId: auth\.sub/, 'the authenticated session supplies the user id');
  assert.doesNotMatch(routerSource, /input\.userId|body\.userId|query\.userId/, 'a client-supplied user id is never accepted');
  for (const route of ['me', 'availability', 'claim', 'lookup']) assert.match(routerSource, new RegExp(`route === '${route}'`));
  // Authentication must complete before the database client is created.
  for (const name of ['me', 'claim']) {
    const body = routerSource.match(new RegExp(`async function ${name}\\(req, res\\) \\{([\\s\\S]*?)\\n\\}`))?.[1];
    assert.ok(body, `${name} handler must exist`);
    assert.ok(body.indexOf('requireAuth(req)') >= 0, `${name} must authenticate`);
    assert.ok(body.indexOf('requireAuth(req)') < body.indexOf('db()'), `${name} must authenticate before touching the database`);
  }
});

// --------------------------------------------------------- database constraints
test('the identity migration is additive, nullable and non-destructive', () => {
  for (const column of ['username', 'username_normalized', 'username_created_at']) {
    assert.match(schema, new RegExp(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${column}\\b`));
  }
  assert.doesNotMatch(schema, /DROP TABLE\s+(IF EXISTS\s+)?users/i);
  assert.doesNotMatch(schema, /TRUNCATE/i);
  assert.doesNotMatch(schema, /DELETE FROM users/i);
  assert.doesNotMatch(schema, /ALTER TABLE users ALTER COLUMN wallet_address/i);
});

test('the database is the final authority on uniqueness and format', () => {
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS users_username_normalized_unique[\s\S]*?ON users\(username_normalized\) WHERE username_normalized IS NOT NULL/);
  assert.match(schema, /users_username_normalized_format CHECK/);
  assert.match(schema, /username_normalized ~ '\^\[a-z\]\[a-z0-9\]\*\(_\[a-z0-9\]\+\)\*\$'/);
  assert.match(schema, /char_length\(username_normalized\) BETWEEN 3 AND 20/);
  assert.match(schema, /users_username_pairing CHECK/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS identity_attempts/);
  assert.match(schema, /action IN \('availability','lookup','claim'\)/);
  assert.match(schema, /identity_attempts_rate ON identity_attempts\(ip_hash, action, attempted_at DESC\)/);
});

test('the primary key and existing user columns are untouched', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS users \(\s*id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\),\s*wallet_address text NOT NULL UNIQUE,/);
  for (const column of ['referral_code', 'created_at', 'last_activity_at', 'social_verified_at']) {
    assert.match(schema, new RegExp(`\\b${column}\\b`));
  }
  assert.doesNotMatch(schema, /PRIMARY KEY \(wallet_address\)/);
  assert.doesNotMatch(schema, /username_normalized text UNIQUE/);
});
