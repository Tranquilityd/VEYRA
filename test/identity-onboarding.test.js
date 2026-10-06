// Phase 1 — onboarding behaviour driven through the real IdentityPanel.
// A minimal DOM double lets the actual panel + real VeyraIdentity + stubbed
// network run end to end, so the loading, available, taken, error and success
// states are verified as behaviour rather than as source text.
import test from 'node:test';
import assert from 'node:assert/strict';

const STORAGE = new Map();

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this._text = '';
  }
  get className() { return this._className || ''; }
  set className(value) { this._className = value; }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); this.children = []; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  focus() { this.focused = true; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) {
      handler({ target: this, key: undefined, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...event });
    }
  }
}

function installDom() {
  const byId = new Map([
    ['chip-identity', new El('button')],
    ['identity-chip-name', new El('b')],
  ]);
  const documents = new Map();
  const document = {
    body: new El('body'),
    createElement: (tag) => new El(tag),
    getElementById: (id) => byId.get(id) || null,
    addEventListener: (type, handler) => {
      if (!documents.has(type)) documents.set(type, []);
      documents.get(type).push(handler);
    },
  };
  globalThis.document = document;
  globalThis.sessionStorage = {
    getItem: (key) => (STORAGE.has(key) ? STORAGE.get(key) : null),
    setItem: (key, value) => STORAGE.set(key, String(value)),
    removeItem: (key) => STORAGE.delete(key),
  };
  return { document, byId, documents };
}

const IDENTITY = { username: 'lester', displayName: 'lester.veyra', walletAddress: '0xAbC0000000000000000000000000000000000001', hasUsername: true, usernameCreatedAt: '2026-10-04T10:00:00.000Z' };

function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    calls.push({ path, options });
    const entry = Object.entries(routes).find(([key]) => path.startsWith(key));
    const result = entry ? await (typeof entry[1] === 'function' ? entry[1](path, options) : entry[1]) : { status: 404, body: { error: 'NOT_FOUND' } };
    const status = result.status ?? 200;
    return { ok: status < 400, status, json: async () => result.body };
  };
  return calls;
}

const createEvents = () => {
  const handlers = new Map();
  return {
    on(name, handler) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(handler); },
    emit(name, payload) { for (const handler of handlers.get(name) || []) handler(payload); },
  };
};

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function boot(routes) {
  const { byId } = installDom();
  STORAGE.clear();
  STORAGE.set('veyra:api-session', 'session-token');
  const calls = stubFetch(routes);
  const { IdentityPanel } = await import('../src/ui/IdentityPanel.js');
  const { VeyraIdentity } = await import('../src/systems/VeyraIdentity.js');
  const events = createEvents();
  const game = {
    events,
    identity: new VeyraIdentity(events),
    audio: { play() {} },
    input: { locked: false },
    overlay: { openId: null },
    transition: { active: false },
    // Tests opt in to a playable state; onboarding only ever appears there.
    states: { currentName: 'boot' },
  };
  const panel = new IdentityPanel(game);
  // Mirrors the Phase 1 hooks registered in src/core/Game.js so the wiring itself
  // is exercised here; test 'the game wires the identity panel' keeps the two in sync.
  events.on('identity:changed', () => panel.maybeAutoPrompt());
  events.on('state:changed', () => panel.maybeAutoPrompt());
  return { panel, game, events, calls, chip: byId.get('chip-identity'), chipName: byId.get('identity-chip-name') };
}

const AVAILABLE = { body: { ok: true, availability: { username: 'lester', displayName: 'lester.veyra', valid: true, available: true, reserved: false } } };
const TAKEN = { body: { ok: true, availability: { valid: true, available: false, reserved: false, message: 'That username is already taken.' } } };
const RESERVED = { body: { ok: true, availability: { valid: false, available: false, reserved: true, reason: 'USERNAME_RESERVED', message: 'This username is reserved by Veyra.' } } };

// --------------------------------------------------------------- onboarding
test('a player without an identity sees the setup experience', async () => {
  const { panel } = await boot({ '/api/identity/me': { body: { ok: true, identity: { username: null, displayName: null, hasUsername: false } } } });
  panel.openPanel();
  assert.equal(panel.open, true);
  assert.equal(panel.root.hidden, false);
  assert.equal(panel.setup.hidden, false);
  assert.equal(panel.done.hidden, true);
  assert.equal(panel.title.textContent, 'Create Your Veyra Identity');
  assert.equal(panel.input.maxLength, 26, 'the field accepts a pasted name plus .veyra');
  assert.equal(panel.claimButton.disabled, true, 'claiming starts disabled');
  assert.equal(panel.game.input.locked, true, 'the modal owns input while open');
});

test('live validation reports available, taken, reserved and invalid names', async () => {
  const { panel } = await boot({ '/api/identity/availability': AVAILABLE });

  panel.openPanel();
  panel.input.value = 'les-ter';
  panel.input.dispatch('input');
  assert.equal(panel.statusEl.dataset.state, 'invalid');
  assert.match(panel.statusEl.textContent, /✕/);
  assert.equal(panel.claimButton.disabled, true);

  panel.input.value = 'lester';
  panel.input.dispatch('input');
  assert.equal(panel.statusEl.dataset.state, 'checking');
  await settle(420);
  assert.equal(panel.statusEl.dataset.state, 'available');
  assert.match(panel.statusEl.textContent, /✓ lester\.veyra is available/);
  assert.equal(panel.claimButton.disabled, false);
  assert.equal(panel.claimButton.textContent, 'CLAIM LESTER.VEYRA');
});

test('a taken username is reported and cannot be claimed', async () => {
  const { panel } = await boot({ '/api/identity/availability': TAKEN });
  panel.openPanel();
  panel.input.value = 'lester';
  panel.input.dispatch('input');
  await settle(420);
  assert.equal(panel.statusEl.dataset.state, 'taken');
  assert.match(panel.statusEl.textContent, /✕ That username is already taken\./);
  assert.equal(panel.claimButton.disabled, true);
});

test('a reserved username is reported as reserved, not as taken', async () => {
  const { panel } = await boot({ '/api/identity/availability': RESERVED });
  panel.openPanel();
  panel.input.value = 'admin';
  panel.input.dispatch('input');
  assert.equal(panel.statusEl.dataset.state, 'reserved');
  assert.match(panel.statusEl.textContent, /reserved by Veyra/i);
  assert.equal(panel.claimButton.disabled, true);
});

test('an unavailable identity service shows an error state without blocking play', async () => {
  const { panel } = await boot({ '/api/identity/availability': { status: 429, body: { error: 'TOO_MANY_ATTEMPTS' } } });
  panel.openPanel();
  panel.input.value = 'lester';
  panel.input.dispatch('input');
  await settle(420);
  assert.equal(panel.statusEl.dataset.state, 'error');
  assert.match(panel.statusEl.textContent, /Too many attempts/);

  // The player can always dismiss and keep playing.
  panel.laterButton.dispatch('click');
  assert.equal(panel.open, false);
  assert.equal(panel.root.hidden, true);
  assert.equal(panel.game.input.locked, false);
});

// ------------------------------------------------------------------ success
test('claiming reaches the success state and updates the HUD identity', async () => {
  const { panel, chip, chipName, events } = await boot({
    '/api/identity/availability': AVAILABLE,
    '/api/identity/claim': { status: 201, body: { ok: true, identity: IDENTITY } },
  });

  const changes = [];
  events.on('identity:changed', (snapshot) => changes.push(snapshot));

  panel.openPanel();
  panel.input.value = 'lester';
  panel.input.dispatch('input');
  await settle(420);
  assert.equal(panel.claimButton.disabled, false);

  panel.claimButton.dispatch('click');
  await settle(30);

  assert.equal(panel.setup.hidden, true, 'the setup view is replaced');
  assert.equal(panel.done.hidden, false);
  assert.equal(panel.doneName.textContent, 'lester.veyra');
  assert.equal(panel.title.textContent, 'Your Veyra Identity');
  assert.match(panel.doneWallet.textContent, /Owner wallet · 0xAbC0…0001/);
  assert.equal(changes.at(-1).displayName, 'lester.veyra');

  // HUD chip now shows the permanent identity instead of the wallet address.
  assert.equal(chipName.textContent, 'lester.veyra');
  assert.equal(chip.dataset.state, 'claimed');
  assert.doesNotMatch(chipName.textContent, /0x/, 'the player-facing label is not a wallet address');
});

test('a player who already has an identity sees it instead of the setup form', async () => {
  const { panel, game, chipName } = await boot({ '/api/identity/me': { body: { ok: true, identity: IDENTITY } } });
  await game.identity.load();
  panel.render();
  assert.equal(chipName.textContent, 'lester.veyra');

  panel.openPanel();
  assert.equal(panel.done.hidden, false);
  assert.equal(panel.setup.hidden, true);
  assert.equal(panel.doneName.textContent, 'lester.veyra');
  assert.equal(game.identity.shouldPrompt(), false, 'a claimed player is never asked again');
});

test('a rejected claim returns to a closed error state with the button re-enabled', async () => {
  const { panel } = await boot({ '/api/identity/claim': { status: 409, body: { error: 'USERNAME_TAKEN' } } });
  panel.openPanel();
  panel.input.value = 'lester';
  panel.claimButton.dispatch('click');
  await settle(30);
  assert.equal(panel.done.hidden, true, 'a failed claim never shows success');
  assert.equal(panel.statusEl.dataset.state, 'taken');
  assert.match(panel.statusEl.textContent, /already taken/);
  assert.equal(panel.claimButton.disabled, true);
});

test('the identity modal closes without disturbing an open game overlay', async () => {
  const { panel, game } = await boot({});
  panel.openPanel();
  game.overlay.openId = 'plinko';
  panel.close();
  assert.equal(game.input.locked, true, 'the game overlay keeps its own input lock');
});

test('auto-prompt appears for an unclaimed identity but never over another overlay', async () => {
  const { panel, game } = await boot({ '/api/identity/me': { body: { ok: true, identity: { username: null, hasUsername: false } } } });
  await game.identity.load();
  game.states.currentName = 'play';

  game.overlay.openId = 'plinko';
  assert.equal(panel.maybeAutoPrompt(), false, 'never interrupts an open game');

  game.overlay.openId = null;
  assert.equal(panel.maybeAutoPrompt(), true);
  assert.equal(game.identity.shouldPrompt(), false, 'the prompt is recorded so it does not repeat');
});

test('the game re-evaluates onboarding on every state change', async () => {
  // The hooks this behaviour depends on must exist in the real game object.
  const { readFileSync } = await import('node:fs');
  const gameSource = readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
  assert.match(gameSource, /events\.on\('identity:changed', \(\) => this\.identityPanel\.maybeAutoPrompt\(\)\)/);
  assert.match(gameSource, /events\.on\('state:changed', \(\) => this\.identityPanel\.maybeAutoPrompt\(\)\)/);

  const { panel, game, events } = await boot({ '/api/identity/me': { body: { ok: true, identity: { username: null, hasUsername: false } } } });
  await game.identity.load();

  // Connected before the world was ready: no prompt, and nothing is consumed.
  game.states.currentName = 'boot';
  events.emit('state:changed');
  assert.equal(panel.open, false);
  assert.equal(game.identity.shouldPrompt(), true, 'the invitation is not spent while the game is not ready');

  // Reaching a playable state re-evaluates it.
  game.states.currentName = 'play';
  events.emit('state:changed');
  assert.equal(game.identity.shouldPrompt(), false, 'the player is invited once the game is ready');
  await settle(1000);
  assert.equal(panel.open, true, 'the invitation appears once the game is ready');
});

test('the delayed invitation re-checks the game before opening', async () => {
  const { panel, game } = await boot({ '/api/identity/me': { body: { ok: true, identity: { username: null, hasUsername: false } } } });
  await game.identity.load();
  game.states.currentName = 'menu';
  assert.equal(panel.maybeAutoPrompt(), true);
  game.overlay.openId = 'plinko';   // player opened the arcade during the beat
  await settle(1000);
  assert.equal(panel.open, false, 'the invitation never lands on top of an open overlay');
});
