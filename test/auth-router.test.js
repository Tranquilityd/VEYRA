// Veyra — Phase 1: consolidated auth dispatcher.
//
// `api/auth/[route].js` replaced two single-purpose entry points with one Vercel
// Serverless Function, so the wallet sign-in surface no longer consumes two of the
// twelve allowed functions. Public URLs, methods, body limits, status codes, error
// codes and JSON shapes must be preserved exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const routerSource = read('api/auth/[route].js');
const { default: handler } = await import('../api/auth/[route].js');

const makeRes = () => {
  const headers = new Map();
  return {
    statusCode: 0,
    payload: null,
    setHeader(key, value) { headers.set(key.toLowerCase(), value); },
    hasHeader(key) { return headers.has(key.toLowerCase()); },
    getHeader(key) { return headers.get(key.toLowerCase()); },
    end(raw) { this.payload = JSON.parse(raw); },
  };
};

// Mirrors how Vercel invokes the function: the dynamic segment arrives in `req.query.route`.
const call = async ({ method = 'POST', route, body = {} } = {}) => {
  const res = makeRes();
  await handler({ method, body, query: route === undefined ? {} : { route }, headers: {} }, res);
  return res;
};

test('auth surface is a single function: both former entry points are gone', () => {
  assert.equal(existsSync(new URL('../api/auth/verify.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../api/auth/challenge.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../api/auth/[route].js', import.meta.url)), true);
});

test('dispatcher preserves both auth paths and the project 404 shape', () => {
  assert.match(routerSource, /route === 'challenge'/);
  assert.match(routerSource, /route === 'verify'/);
  assert.match(routerSource, /json\(res, 404, \{ ok: false, error: 'NOT_FOUND' \}\)/);
});

test('unknown, empty and nested auth routes return the standard NOT_FOUND body', async () => {
  for (const route of ['login', 'challenge/extra', 'verify/extra', '']) {
    const res = await call({ route });
    assert.equal(res.statusCode, 404, `route=${route}`);
    assert.deepEqual(res.payload, { ok: false, error: 'NOT_FOUND' }, `route=${route}`);
  }
  const missing = await call({});
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.payload, { ok: false, error: 'NOT_FOUND' });
});

test('both auth routes remain POST-only', async () => {
  for (const route of ['challenge', 'verify']) {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await call({ method, route });
      assert.equal(res.statusCode, 405, `${method} ${route}`);
      assert.equal(res.payload.error, 'METHOD_NOT_ALLOWED', `${method} ${route}`);
      assert.equal(res.getHeader('allow'), 'POST', `${method} ${route}`);
    }
  }
});

test('challenge path reaches challenge generation and rejects an invalid wallet', async () => {
  // `createChallenge` normalises the wallet before any database work, so this
  // proves the route is wired to the real handler without needing a database.
  const res = await call({ route: 'challenge', body: { wallet: 'not-an-address' } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { ok: false, error: 'INVALID_INPUT' });
});

test('verify path reaches challenge verification and rejects an invalid wallet', async () => {
  const res = await call({ route: 'verify', body: { wallet: 'not-an-address', nonce: 'deadbeef', signature: '0x' } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { ok: false, error: 'INVALID_INPUT' });
});

test('route is also read from the array form Vercel can produce', async () => {
  const res = await call({ route: ['challenge'], body: { wallet: 'not-an-address' } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { ok: false, error: 'INVALID_INPUT' });
});
