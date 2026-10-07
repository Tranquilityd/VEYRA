// Veyra — Phase 2: consolidated account dispatcher.
//
// `api/account/[route].js` replaced five single-purpose entry points with one
// Vercel Serverless Function. Public URLs, methods, body limits, authentication,
// Turnstile placement, idempotency/locking, audit calls, status codes and JSON
// shapes must all be preserved per route — nothing may be normalised into one
// shared behaviour.
//
// Routing is proven two ways, because a live database is out of scope for a unit
// test: (1) at runtime, through method enforcement, the 401 authentication gate
// and unknown-route handling; and (2) from source, by reading each route's own
// delimited region in the dispatcher, so a route can only pass its own checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const account = readFileSync(new URL('../api/account/[route].js', import.meta.url), 'utf8');
const route = (name) => {
  const m = account.match(new RegExp('// ---- route: ' + name + ' ----\\n([\\s\\S]*?)// ---- end route: ' + name + ' ----'));
  if (!m) throw new Error(`route ${name} missing from api/account/[route].js`);
  return m[1];
};
const { default: handler } = await import('../api/account/[route].js');

const makeRes = () => {
  const headers = new Map();
  return {
    statusCode: 0, payload: null,
    setHeader(key, value) { headers.set(key.toLowerCase(), value); },
    hasHeader(key) { return headers.has(key.toLowerCase()); },
    getHeader(key) { return headers.get(key.toLowerCase()); },
    end(raw) { this.payload = JSON.parse(raw); },
  };
};

// Mirrors how Vercel invokes the function: the dynamic segment arrives in `req.query.route`.
const call = async ({ method = 'GET', route: r, body = {} } = {}) => {
  const res = makeRes();
  await handler({ method, body, query: r === undefined ? {} : { route: r }, headers: {} }, res);
  return res;
};

test('account surface is a single function: the former entry points are gone', async () => {
  for (const gone of ['balance.js', 'referrals.js', 'withdrawals.js', 'social-verification.js', 'arcade/session.js']) {
    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(new URL(`../api/${gone}`, import.meta.url)), false, `api/${gone} must not exist`);
  }
  assert.match(account, /export default async function handler\(req, res\)/);
});

test('dispatcher maps exactly the four remaining route names', () => {
  for (const name of ['balance', 'withdrawals', 'social-verification', 'arcade-session']) {
    assert.match(account, new RegExp(`route === '${name}'`), `route ${name} must be dispatched`);
  }
  assert.match(account, /return notFound\(res\)/);
  assert.match(account, /typeof route !== 'string' \|\| route\.includes\('\/'\)/);
  assert.doesNotMatch(account, /route === 'referrals'/);
});

test('unknown, empty and nested account routes return the standard NOT_FOUND body', async () => {
  for (const r of ['login', 'referrals', 'balance/extra', 'withdrawals/../balance', 'arcade-session/extra', '', 'balance\u0000']) {
    const res = await call({ route: r });
    assert.equal(res.statusCode, 404, `route=${JSON.stringify(r)}`);
    assert.deepEqual(res.payload, { ok: false, error: 'NOT_FOUND' }, `route=${JSON.stringify(r)}`);
  }
  const missing = await call({});
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.payload, { ok: false, error: 'NOT_FOUND' });
});

test('per-route method enforcement is unchanged', async () => {
  const matrix = [
    ['balance', ['GET']],
    ['withdrawals', ['GET', 'POST']],
    ['social-verification', ['GET', 'POST']],
    ['arcade-session', ['POST']],
  ];
  for (const [r, allowed] of matrix) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const res = await call({ method, route: r });
      if (allowed.includes(method)) {
        assert.equal(res.statusCode, 401, `${method} ${r} must reach the auth gate`);
        assert.equal(res.payload.error, 'UNAUTHORIZED', `${method} ${r}`);
      } else {
        assert.equal(res.statusCode, 405, `${method} ${r} must be rejected`);
        assert.equal(res.payload.error, 'METHOD_NOT_ALLOWED', `${method} ${r}`);
        assert.equal(res.getHeader('allow'), allowed.join(', '), `${method} ${r} Allow header`);
      }
    }
  }
});

test('every authenticated account route requires Bearer authentication first', async () => {
  // requireAuth runs before db() in all four remaining handlers, so an anonymous request
  // must fail closed without any database access.
  for (const r of ['balance', 'withdrawals', 'social-verification', 'arcade-session']) {
    const res = await call({ method: r === 'arcade-session' || r === 'balance' ? (r === 'balance' ? 'GET' : 'POST') : 'GET', route: r });
    assert.equal(res.statusCode, 401, r);
    assert.deepEqual(res.payload, { ok: false, error: 'UNAUTHORIZED' }, r);
  }
});

test('body limits stay per-route — social proof keeps 1 200 000 bytes', () => {
  assert.match(route('socialVerification'), /await body\(req,\s*1_200_000\)/);
  for (const [name, limit] of [['withdrawals', 'default'], ['arcadeSession', 'default']]) {
    const region = route(name);
    assert.match(region, /await body\(req\)/, `${name} keeps the default bound`);
    assert.doesNotMatch(region, /body\(req,\s*1_200_000\)/, `${name} must not inherit the social bound`);
  }
  assert.doesNotMatch(route('balance'), /\bbody\(/, 'balance never reads a body');
  // the dispatcher itself must not impose a global limit
  const dispatcher = account.slice(account.indexOf('export default'), account.indexOf('// ---- route: balance ----'));
  assert.doesNotMatch(dispatcher, /\bbody\(/, 'the dispatcher must not body-limit globally');
});

test('withdrawal security controls and ordering are preserved in place', () => {
  const w = route('withdrawals');
  assert.match(w, /const MIN=0\.005/);
  assert.match(w, /verifyTurnstileToken/);
  assert.match(w, /expectedAction:'arcade_withdrawal'/);
  assert.match(w, /pg_advisory_xact_lock/);
  assert.match(w, /idempotency_key/);
  assert.match(w, /status='pending'/);
  assert.doesNotMatch(w, /input\.wallet/);
  assert.doesNotMatch(w, /SET balance=balance-/);
  assert.ok(w.indexOf("throw new Error('INVALID_INPUT')") < w.indexOf('await verifyTurnstileToken')
    && w.indexOf('await verifyTurnstileToken') < w.indexOf('const row=await sql.begin'),
    'validate -> CAPTCHA -> transaction ordering must be unchanged');
});

test('audit calls remain per route', () => {
  assert.equal((route('withdrawals').match(/\baudit\(/g) || []).length, 1);
  assert.equal((route('socialVerification').match(/\baudit\(/g) || []).length, 1);
  assert.equal((route('arcadeSession').match(/\baudit\(/g) || []).length, 3);
});

test('the Arcade route stays server-authoritative', () => {
  const a = route('arcadeSession');
  assert.doesNotMatch(a, /input\.(waves|score|reward)/);
  assert.match(a, /waves=waves\+1,score=score\+1/);
  assert.match(a, /FOR UPDATE/);
  assert.match(a, /round\.status !== 'issued'/);
  assert.match(a, /Number\(round\.wave\) !== Number\(session\.waves\) \+ 1/);
  assert.match(a, /createArcadeChallenge|verifyArcadeRound/);
  assert.match(a, /creditArcadeBalance/);
  assert.ok(a.indexOf('requireAuth') < a.indexOf('createArcadeChallenge'), 'auth precedes arcade logic');
});

test('route regions do not bleed into one another', () => {
  assert.doesNotMatch(route('balance'), /pg_advisory_xact_lock|verifyTurnstileToken|createArcadeChallenge/);
  assert.doesNotMatch(route('socialVerification'), /idempotency_key|pg_advisory_xact_lock/);
  assert.doesNotMatch(route('withdrawals'), /validImage|referral_code/);
});
