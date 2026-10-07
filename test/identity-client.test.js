// Phase 1 — client identity system and onboarding surface contracts.
// src/systems/VeyraIdentity.js is exercised against a stubbed fetch so the
// local-first validation, availability probing and error mapping are covered as
// real behaviour. The visual layer is asserted the same way the existing
// UI-contract suites assert it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { VeyraIdentity } from '../src/systems/VeyraIdentity.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const panel = read('src/ui/IdentityPanel.js');
const identityCss = read('styles/identity.css');
const html = read('index.html');
const game = read('src/core/Game.js');

const IDENTITY = { username: 'lester', displayName: 'lester.veyra', walletAddress: '0xAbC0000000000000000000000000000000000001', hasUsername: true, usernameCreatedAt: '2026-10-04T10:00:00.000Z' };

function stubStorage() {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  return store;
}

const createEvents = () => {
  const handlers = new Map();
  return {
    on(name, handler) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(handler); },
    emit(name, payload) { for (const handler of handlers.get(name) || []) handler(payload); },
  };
};

function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    calls.push({ path, options });
    const entry = Object.entries(routes).find(([key]) => path.startsWith(key));
    const resolve = entry ? entry[1] : () => ({ status: 404, body: { error: 'NOT_FOUND' } });
    const result = typeof resolve === 'function' ? await resolve(path, options) : resolve;
    const status = result.status ?? 200;
    return { ok: status < 400, status, json: async () => result.body };
  };
  return calls;
}

async function withFetch(routes, fn) {
  const original = globalThis.fetch;
  const calls = stubFetch(routes);
  try { return await fn(calls); } finally { globalThis.fetch = original; }
}

const token = (store) => store.set('veyra:api-session', 'session-token');

// ------------------------------------------------------------------- loading
test('identity loads for an authenticated wallet and is exposed as .veyra', async () => {
  const store = stubStorage();
  token(store);
  await withFetch({ '/api/identity/me': { body: { ok: true, identity: IDENTITY } } }, async () => {
    const identity = new VeyraIdentity(createEvents());
    const snapshot = await identity.load();
    assert.equal(snapshot.username, 'lester');
    assert.equal(snapshot.displayName, 'lester.veyra');
    assert.equal(snapshot.hasUsername, true);
    assert.equal(snapshot.loaded, true);
    assert.equal(snapshot.error, null);
    assert.equal(identity.displayNameOr('0xFallback'), 'lester.veyra');
  });
});

test('existing players without a username stay valid and are not blocked', async () => {
  const store = stubStorage();
  token(store);
  await withFetch({ '/api/identity/me': { body: { ok: true, identity: { username: null, displayName: null, walletAddress: IDENTITY.walletAddress, hasUsername: false } } } }, async () => {
    const identity = new VeyraIdentity(createEvents());
    const snapshot = await identity.load();
    assert.equal(snapshot.hasUsername, false);
    assert.equal(snapshot.displayName, null);
    assert.equal(identity.displayNameOr('MAIN WALLET'), 'MAIN WALLET', 'falls back to the wallet label');
  });
});

test('an unauthenticated player never calls the identity API', async () => {
  stubStorage();
  await withFetch({ '/api/identity/me': { body: { ok: true, identity: IDENTITY } } }, async (calls) => {
    const identity = new VeyraIdentity(createEvents());
    const snapshot = await identity.load();
    assert.equal(snapshot.hasUsername, false);
    assert.equal(calls.length, 0);
  });
});

test('a failing identity service degrades gracefully instead of breaking the game', async () => {
  const store = stubStorage();
  token(store);
  await withFetch({ '/api/identity/me': { status: 500, body: { error: 'INTERNAL_ERROR' } } }, async () => {
    const identity = new VeyraIdentity(createEvents());
    const snapshot = await identity.load();
    assert.equal(snapshot.hasUsername, false);
    assert.equal(snapshot.error, 'INTERNAL_ERROR');
    assert.equal(snapshot.loaded, true, 'a failed load still completes so onboarding is not retried in a loop');

    const offline = new VeyraIdentity(createEvents());
    const networkFailure = await withFetch({}, async () => {
      globalThis.fetch = async () => { throw new Error('offline'); };
      return offline.load();
    });
    assert.equal(networkFailure.error, 'INTERNAL_ERROR');
  });
});

test('disconnecting the wallet clears the identity', async () => {
  const store = stubStorage();
  token(store);
  await withFetch({ '/api/identity/me': { body: { ok: true, identity: IDENTITY } } }, async () => {
    const events = createEvents();
    const identity = new VeyraIdentity(events);
    await identity.load();
    assert.equal(identity.snapshot().hasUsername, true);
    events.emit('litvm:wallet', { state: 'disconnected' });
    assert.equal(identity.snapshot().hasUsername, false);
    assert.equal(identity.snapshot().displayName, null);
  });
});

// ------------------------------------------------------- live availability
test('structurally invalid names are answered locally without a network call', async () => {
  stubStorage();
  await withFetch({ '/api/identity/availability': { body: { ok: true, availability: { valid: true, available: true } } } }, async (calls) => {
    const identity = new VeyraIdentity(createEvents());

    assert.equal((await identity.checkUsername('les-ter')).status, 'invalid');
    assert.equal((await identity.checkUsername('ab')).status, 'invalid');
    assert.equal((await identity.checkUsername('1lester')).status, 'invalid');
    assert.equal((await identity.checkUsername('le__ster')).status, 'invalid');
    assert.equal((await identity.checkUsername('admin')).status, 'reserved');
    assert.equal((await identity.checkUsername('')).status, 'empty');
    assert.equal(calls.length, 0, 'no availability request is spent on an unclaimable name');
  });
});

test('a valid name is probed and reported as available or taken', async () => {
  stubStorage();
  const available = await withFetch({ '/api/identity/availability': { body: { ok: true, availability: { username: 'lester', displayName: 'lester.veyra', valid: true, available: true, reserved: false } } } }, async (calls) => {
    const identity = new VeyraIdentity(createEvents());
    const result = await identity.checkUsername('Lester.VEYRA');
    assert.equal(result.status, 'available');
    assert.equal(result.displayName, 'lester.veyra');
    assert.equal(calls[0].path, '/api/identity/availability?username=lester', 'the normalized name is sent');
    return result;
  });
  assert.equal(available.message, 'lester.veyra is available');

  await withFetch({ '/api/identity/availability': { body: { ok: true, availability: { valid: true, available: false, reserved: false, message: 'That username is already taken.' } } } }, async () => {
    const identity = new VeyraIdentity(createEvents());
    const result = await identity.checkUsername('lester');
    assert.equal(result.status, 'taken');
    assert.equal(result.reason, 'USERNAME_TAKEN');
  });
});

test('availability reports reserved names and friendly rate-limit errors', async () => {
  stubStorage();
  await withFetch({ '/api/identity/availability': { body: { ok: true, availability: { valid: false, available: false, reserved: true, reason: 'USERNAME_RESERVED', message: 'This username is reserved by Veyra.' } } } }, async () => {
    const identity = new VeyraIdentity(createEvents());
    assert.equal((await identity.checkUsername('lester')).status, 'reserved');
  });

  await withFetch({ '/api/identity/availability': { status: 429, body: { error: 'TOO_MANY_ATTEMPTS' } } }, async () => {
    const identity = new VeyraIdentity(createEvents());
    const result = await identity.checkUsername('lester');
    assert.equal(result.status, 'error');
    assert.match(result.message, /Too many attempts/);
  });
});

test('a superseded availability check cannot overwrite a newer result', async () => {
  stubStorage();
  await withFetch({
    '/api/identity/availability?username=lester': async () => { await new Promise((r) => setTimeout(r, 30)); return { body: { ok: true, availability: { valid: true, available: true } } }; },
    '/api/identity/availability?username=jide': { body: { ok: true, availability: { valid: true, available: false, message: 'That username is already taken.' } } },
  }, async () => {
    const identity = new VeyraIdentity(createEvents());
    const stale = identity.checkUsername('lester');
    const fresh = identity.checkUsername('jide');
    assert.equal((await fresh).status, 'taken');
    assert.equal(await stale, null, 'the late result is discarded');
  });
});

// --------------------------------------------------------------------- claim
test('claiming a username stores the identity and emits the change', async () => {
  const store = stubStorage();
  token(store);
  await withFetch({ '/api/identity/claim': { status: 201, body: { ok: true, identity: IDENTITY } } }, async (calls) => {
    const events = createEvents();
    const seen = [];
    events.on('identity:changed', (snapshot) => seen.push(snapshot));
    const identity = new VeyraIdentity(events);
    const snapshot = await identity.claim('Lester');
    assert.equal(snapshot.displayName, 'lester.veyra');
    assert.equal(snapshot.hasUsername, true);
    assert.equal(seen.at(-1).displayName, 'lester.veyra');
    assert.equal(JSON.parse(calls[0].options.body).username, 'lester', 'the normalized body is submitted');
    assert.match(calls[0].options.headers.Authorization, /^Bearer /, 'the claim is authenticated');
  });
});

test('a locally invalid claim is rejected before any request', async () => {
  const store = stubStorage();
  token(store);
  await withFetch({ '/api/identity/claim': { status: 201, body: { ok: true, identity: IDENTITY } } }, async (calls) => {
    const identity = new VeyraIdentity(createEvents());
    for (const value of ['ab', 'les-ter', 'admin', '1lester']) {
      await assert.rejects(() => identity.claim(value));
    }
    assert.equal(calls.length, 0);
  });
});

test('claim failures surface as friendly, coded errors', async () => {
  const store = stubStorage();
  token(store);
  await withFetch({ '/api/identity/claim': { status: 409, body: { error: 'USERNAME_TAKEN' } } }, async () => {
    const identity = new VeyraIdentity(createEvents());
    await assert.rejects(() => identity.claim('lester'), (error) => {
      assert.equal(error.code, 'USERNAME_TAKEN');
      assert.match(error.message, /already taken/);
      return true;
    });
  });

  await withFetch({ '/api/identity/claim': { status: 409, body: { error: 'USERNAME_ALREADY_CLAIMED' } } }, async () => {
    const identity = new VeyraIdentity(createEvents());
    await assert.rejects(() => identity.claim('lester'), (error) => {
      assert.match(error.message, /already has a permanent Veyra username/);
      return true;
    });
  });
});

test('permanent identity is only prompted once per session', async () => {
  const store = stubStorage();
  token(store);
  await withFetch({ '/api/identity/me': { body: { ok: true, identity: { username: null, hasUsername: false } } } }, async () => {
    const identity = new VeyraIdentity(createEvents());
    await identity.load();
    assert.equal(identity.shouldPrompt(), true);
    identity.markPrompted();
    assert.equal(identity.shouldPrompt(), false, 'the player is not asked repeatedly');
    assert.equal(store.get('veyra:identity-prompted'), '1');

    // A player who already has an identity is never prompted at all.
    const claimed = new VeyraIdentity(createEvents());
    claimed.identity = IDENTITY;
    assert.equal(claimed.shouldPrompt(), false);
  });
});

// ------------------------------------------------------------ surface contracts
test('permanent identity offers no rename, release or transfer of an existing name', () => {
  const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  const routerSource = read('api/identity/[route].js');
  const serverSource = read('server/identity.js');

  // Only two verbs exist: read your identity, and claim it once.
  const methods = [...routerSource.matchAll(/method\(req, res, \[([^\]]*)\]\)/g)]
    .flatMap((match) => match[1].replace(/['"\s]/g, '').split(','))
    .filter(Boolean);
  assert.deepEqual([...new Set(methods)].sort(), ['GET', 'POST'], 'no rename/release/PUT/DELETE verb is routed');
  assert.match(routerSource, /method\(req, res, \['POST'\]\)/, 'claiming is POST-only');
  for (const source of [stripComments(routerSource), stripComments(serverSource)]) {
    assert.doesNotMatch(source, /\b(rename|release|reassign|transfer|unclaim|setUsername)\b/, 'permanence means no mutation path beyond the first claim');
  }

  // The only write to users.username is the compare-and-set guarded claim.
  assert.equal((serverSource.match(/UPDATE users SET username/g) || []).length, 1);
  assert.match(serverSource, /username_normalized IS NULL/, 'the single write only ever fills an empty slot');
  assert.match(serverSource, /WHERE id=\$\{userId\} AND username_normalized IS NULL/, 'the slot check is part of the update itself');
});

test('legacy wallet accounts are untouched by the identity layer', () => {
  const routerSource = read('api/identity/[route].js');
  const serverSource = read('server/identity.js');
  for (const source of [routerSource, serverSource]) {
    assert.doesNotMatch(source, /ALTER TABLE|DROP |TRUNCATE/i, 'no schema mutation from application code');
    assert.doesNotMatch(source, /wallet_address =|SET referral_code/i, 'the wallet and referral record are never modified');
  }
  // A claim only ever writes the three identity columns (plus the activity touch
  // that every authenticated action already performs).
  const update = serverSource.match(/UPDATE users SET ([\s\S]*?)WHERE/)?.[1] || '';
  for (const column of ['username_created_at', 'username_normalized', 'username']) assert.match(update, new RegExp(`\\b${column}\\b`));
  assert.doesNotMatch(update, /wallet_address|referral_code|social_verified_at|(?<!username_)created_at/, 'legacy columns stay out of the claim write');
  assert.match(update, /last_activity_at=NOW\(\)/, 'claiming counts as activity in the existing column');
});

test('the onboarding surface implements the documented states', () => {
  assert.match(panel, /Create Your Veyra Identity/);
  assert.match(panel, /CLAIM USERNAME/);
  assert.match(panel, /CLAIM \$\{this\.status\.displayName\.toUpperCase\(\)\}/);
  assert.match(panel, /MAYBE LATER/);
  assert.match(panel, /Your Veyra identity is ready\./);
  assert.match(panel, /identity-suffix/);
  assert.match(panel, /USERNAME_SUFFIX_DISPLAY/);
  assert.match(panel, /Enter'\) \{ e\.preventDefault\(\); this\._claim\(\)/);
  assert.match(panel, /DEBOUNCE_MS = 350/, 'live validation is debounced');
  assert.match(panel, /aria-live', 'polite'/);
  assert.match(panel, /identity-chip-name/);
});

test('the identity modal is non-blocking and never traps the player', () => {
  assert.match(panel, /maybeAutoPrompt\(\)/);
  assert.match(panel, /laterButton\.addEventListener/);
  assert.match(panel, /snapshot\.error[\s\S]*?unavailable right now[\s\S]*?keep playing/);
  assert.match(panel, /if \(!this\.wasLocked && !this\.game\.overlay\.openId\)/);
  // Escape is captured before InputManager can read it as Resume.
  assert.match(panel, /document\.addEventListener\('keydown'[\s\S]*?true\)/);
  assert.match(panel, /stopImmediatePropagation/);
});

test('the identity surface is responsive and honours reduced motion', () => {
  assert.match(identityCss, /@media\(max-height:560px\)/, 'horizontal mobile keeps the card reachable');
  assert.match(identityCss, /@media\(max-width:560px\)/);
  assert.match(identityCss, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(identityCss, /var\(--veyra-yellow\)/);
  assert.match(identityCss, /var\(--veyra-cobalt\)/);
  assert.match(identityCss, /var\(--veyra-coral\)/);
  assert.doesNotMatch(identityCss, /position:\s*fixed;\s*width:\s*[0-9]{3,}px/, 'no desktop-only fixed sizing');
});

test('the HUD exposes the identity chip and the game wires the system', () => {
  assert.match(html, /styles\/identity\.css/);
  assert.match(html, /id="chip-identity"/);
  assert.match(html, /id="identity-chip-name"/);
  assert.match(html, /VEYRA IDENTITY/);
  assert.match(game, /new VeyraIdentity\(this\.events\)/);
  assert.match(game, /new IdentityPanel\(this\)/);
  assert.match(game, /identity:changed', \(\) => this\.identityPanel\.maybeAutoPrompt\(\)/);
});

test('validation rules live in exactly one place', () => {
  const systemSource = read('src/systems/VeyraIdentity.js');
  const serverSource = read('server/identity.js');
  const routerSource = read('api/identity/[route].js');

  // Every layer imports the canonical module instead of restating the rules.
  assert.match(panel, /from '\.\.\/identity\/username\.js'/);
  assert.match(systemSource, /from '\.\.\/identity\/username\.js'/);
  assert.match(serverSource, /from '\.\.\/src\/identity\/username\.js'/);
  assert.match(routerSource, /from '\.\.\/\.\.\/server\/identity\.js'/);

  // No layer redeclares the character rules, the bounds or the suffix.
  for (const source of [panel, systemSource]) {
    assert.doesNotMatch(source, /const\s+USERNAME_(MIN_LENGTH|MAX_LENGTH|PATTERN)\s*=/);
    assert.doesNotMatch(source, /\[a-z0-9\]/, 'character rules must come from the canonical validator');
    assert.doesNotMatch(source, /'veyra'|"veyra"/, 'the suffix is imported, never hardcoded');
  }
  assert.doesNotMatch(serverSource, /\[a-z0-9\]/, 'the server relies on the canonical validator');
});

test('Phase 1 introduces no excluded blockchain or social features', () => {
  const identitySources = [panel, read('src/systems/VeyraIdentity.js'), identityCss].join('\n');
  for (const forbidden of ['sendTransaction', 'eth_sendTransaction', 'privateKey', 'private_key', 'mnemonic', 'walletconnect', 'marketplace', 'auction', 'friendRequest', 'socialFeed', 'avatar']) {
    assert.doesNotMatch(identitySources, new RegExp(forbidden, 'i'), `${forbidden} must not appear in the identity layer`);
  }
  // The identity layer never touches balances, casino, arcade or withdrawals.
  assert.doesNotMatch(identitySources, /withdraw|casino|arcade-?balance|referral/i);
});

test('identity endpoints expose no sequential or internal identifiers', () => {
  // Routes are addressed by the public username only; there is no /identity/<id>.
  assert.equal(existsSync(new URL('../api/identity/[id].js', import.meta.url)), false);
  assert.match(read('src/systems/VeyraIdentity.js'), /availability\?username=\$\{encodeURIComponent\(validated\.username\)\}/);
  assert.doesNotMatch(panel, /\$\{[^}]*\buserId\b/, 'the client never sends an internal user id');
  assert.doesNotMatch(panel, /identity-\d/, 'no id-suffixed surfaces');
});

test('wallet address remains the blockchain identity and is not replaced globally', () => {
  // The wallet chip and its address label must survive the identity layer.
  assert.match(html, /id="chip-wallet"/);
  assert.match(html, /id="wallet-address-short"/);
  assert.match(game, /new WalletPanel\(this\)/);
  assert.doesNotMatch(panel, /walletAddressShort\s*=\s*snapshot\.displayName/);
  assert.match(panel, /Owner wallet · \$\{short\(snapshot\.walletAddress\)\}/, 'the owning wallet is still shown to the owner');
});
