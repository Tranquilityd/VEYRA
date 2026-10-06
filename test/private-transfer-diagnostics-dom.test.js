// Phase 4A — the browser surface under a minimal DOM shim.
//
// The real validation is manual (a real browser + a real EIP-1193 wallet); these tests
// exist so the DOM code paths the tester will hit are EXECUTED here first: building the
// panel, building the diagnostics panel, toggling test mode, rendering every row and
// running the dry run. They also prove the rendered text never contains key material.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

/* ------------------------------------------------------------------ DOM shim */
class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...names) { for (const name of names) this.set.add(name); }
  remove(...names) { for (const name of names) this.set.delete(name); }
  contains(name) { return this.set.has(name); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this.className = '';
    this.id = '';
    this.type = '';
    this.rows = 0;
    this.checked = false;
    this.readOnly = false;
    this.placeholder = '';
    this.autocomplete = '';
    this.autocapitalize = '';
    this.spellcheck = true;
    this.inputMode = '';
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = new Map();
    this.classList = new FakeClassList();
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  replaceChildren(...nodes) { this.children = []; for (const node of nodes) this.appendChild(node); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  async fire(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) await handler(event);
  }
  /** Every piece of text rendered anywhere below this node. */
  collectText() {
    const out = [this.textContent];
    for (const child of this.children) out.push(child.collectText());
    return out.filter(Boolean).join('\n');
  }
}

function installDom() {
  const registry = new Map();
  const document = {
    body: new FakeElement('body'),
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => {
      if (!registry.has(id)) { const el = new FakeElement('div'); el.id = id; registry.set(id, el); }
      return registry.get(id);
    },
    addEventListener() {},
  };
  globalThis.document = document;
  globalThis.location = { search: '' };
  return { document, registry };
}

/* ------------------------------------------------------------------ fakes */
const ALICE = '0x' + 'a1'.repeat(20);
const BOB_SPEND = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn;
const BOB_VIEW = 0x0fedcba09876543210fedcba09876543210fedcba09876543210fedcba0987654n;

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

function eventBus() {
  const handlers = new Map();
  return {
    on(name, handler) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(handler); },
    emit(name, payload) { for (const handler of handlers.get(name) ?? []) handler(payload); },
  };
}

async function makeHarness({ chainId = '0x1159', code = '0x', search = '?veyra-private-test=1' } = {}) {
  const dom = installDom();
  globalThis.location.search = search;
  globalThis.localStorage = memoryStorage();

  const { keccak256Bytes, bytesToHex } = await import('../src/stealth/keccak.js');
  const S = await import('../src/stealth/secp256k1.js');
  const { buildMetaAddress, metaFingerprint } = await import('../src/stealth/protocol.js');
  const spendPublic = bytesToHex(S.compressPoint(S.multiplyG(BOB_SPEND)));
  const viewPublic = bytesToHex(S.compressPoint(S.multiplyG(BOB_VIEW)));
  const metaAddress = buildMetaAddress(spendPublic, viewPublic);

  const providerCalls = [];
  const forbidden = [];
  const provider = {
    request: async ({ method, params }) => {
      providerCalls.push(method);
      if (!['eth_chainId', 'eth_accounts', 'eth_getCode', 'eth_getBalance', 'eth_estimateGas', 'eth_gasPrice'].includes(method)) {
        forbidden.push(method);
        throw new Error(`FORBIDDEN:${method}`);
      }
      if (method === 'eth_chainId') return chainId;
      if (method === 'eth_accounts') return [ALICE];
      if (method === 'eth_getCode') return code;
      if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
      if (method === 'eth_estimateGas') return '0x5208';
      if (method === 'eth_gasPrice') return '0x3b9aca00';
      return null;
    },
  };
  globalThis.__VEYRA_LITVM_WALLET_ADAPTER__ = { provider };

  const apiCalls = [];
  const api = async (path, options = {}) => {
    apiCalls.push({ path, method: options.method ?? 'GET' });
    if (path.includes('/resolve')) {
      return { identity: { username: 'bob', protocolVersion: 1, schemeId: 1, spendingPublicKey: spendPublic, viewingPublicKey: viewPublic, metaAddress, fingerprint: metaFingerprint(metaAddress) } };
    }
    if (path.includes('/announcements')) return { announcements: [], nextCursor: null };
    return null;
  };

  const game = {
    events: eventBus(),
    audio: { play() {} },
    identity: { snapshot: () => ({ username: 'alice' }) },
    walletSession: { account: ALICE, state: 'connected' },
  };
  const { PrivateTransferSession } = await import('../src/systems/PrivateTransferSession.js');
  const session = new PrivateTransferSession(game);
  session.client.api = api;
  game.privateTransfer = session;

  return { dom, game, session, providerCalls, forbidden, apiCalls, spendPublic, viewPublic, metaAddress };
}

/* ------------------------------------------------------------------ tests */
test('the private-transfer panel builds and renders wallet state (DOM shim)', async () => {
  const harness = await makeHarness();
  const { PrivateTransferPanel } = await import('../src/ui/PrivateTransferPanel.js');
  const panel = new PrivateTransferPanel(harness.game);
  await panel.refresh();

  const text = panel.root.collectText();
  assert.match(text, /Private zkLTC Transfers/);
  const network = panel.root.children.flatMap(function walk(node) {
    return [node, ...node.children.flatMap(walk)];
  }).find((node) => node.className?.includes('private-network'));
  assert.ok(network, 'the network line must exist');
  assert.match(network.textContent, /Wallet CONNECTED · LiteForge 4441 \(0x1159\)/);
  assert.equal(network.dataset.state, 'ok');
  assert.deepEqual(harness.forbidden, [], 'rendering must not call any mutating provider method');

  // The diagnostics panel is mounted because test mode was explicitly requested.
  assert.ok(panel.diagnostics.root, 'diagnostics panel exists');
  assert.equal(panel.diagnostics.root.hidden, false);
  assert.equal(harness.dom.document.body.classList.contains('private-test-mode'), true);
});

test('without test mode the diagnostics stay hidden and no test surface is rendered', async () => {
  const harness = await makeHarness({ search: '' });
  const { PrivateTransferPanel } = await import('../src/ui/PrivateTransferPanel.js');
  const panel = new PrivateTransferPanel(harness.game);
  await panel.refresh();
  assert.equal(panel.diagnostics.root.hidden, true);
  assert.equal(harness.dom.document.body.classList.contains('private-test-mode'), false);
  // The toggle is still present (that is how a tester enables it) but nothing is exposed yet.
  assert.match(panel.testModeButton.textContent, /ENABLE TEST MODE/);
});

test('the in-panel test-mode toggle mounts and unmounts the diagnostics', async () => {
  const harness = await makeHarness({ search: '' });
  const { PrivateTransferPanel } = await import('../src/ui/PrivateTransferPanel.js');
  const panel = new PrivateTransferPanel(harness.game);
  await panel.refresh();
  await panel.testModeButton.fire('click');
  assert.equal(harness.session.testMode, true);
  assert.equal(panel.diagnostics.root.hidden, false);
  assert.equal(harness.dom.document.body.classList.contains('private-test-mode'), true);
  await panel.testModeButton.fire('click');
  assert.equal(harness.session.testMode, false);
  assert.equal(panel.diagnostics.root.hidden, true);
  assert.equal(harness.dom.document.body.classList.contains('private-test-mode'), false);
});

test('the diagnostics panel renders every section and no key material (DOM shim)', async () => {
  const harness = await makeHarness();
  const { PrivateTransferPanel } = await import('../src/ui/PrivateTransferPanel.js');
  const panel = new PrivateTransferPanel(harness.game);
  await panel.refresh();
  await panel.diagnostics.refreshWallet();

  const text = panel.diagnostics.root.collectText();
  for (const section of ['Wallet & network', 'Identity & resolution', 'Transfer, announcement, stealth & recovery', 'Dry run', 'Key-material guarantees']) {
    assert.ok(text.includes(section), `missing section: ${section}`);
  }
  assert.match(text, /CONNECTED/);
  assert.match(text, /Expected chain id/);
  assert.match(text, /4441 \(0x1159\)/);
  assert.match(text, /Private keys rendered\s*\n\s*no/i);
  assert.match(text, /Viewing key rendered\s*\n\s*no/i);
  assert.match(text, /Spending key rendered\s*\n\s*no/i);

  const spentHex = BOB_SPEND.toString(16).padStart(64, '0');
  const viewedHex = BOB_VIEW.toString(16).padStart(64, '0');
  assert.equal(text.includes(spentHex), false);
  assert.equal(text.includes(viewedHex), false);
  assert.equal(/\b(seed|mnemonic)\b/i.test(text.replace(/Seed \/ mnemonic rendered/g, '')), false);
});

test('RUN DRY RUN renders the preview and still never signs or broadcasts (DOM shim)', async () => {
  const harness = await makeHarness();
  const { PrivateTransferPanel } = await import('../src/ui/PrivateTransferPanel.js');
  const panel = new PrivateTransferPanel(harness.game);
  await panel.refresh();
  panel.recipient.value = 'bob.veyra';
  panel.amount.value = '0.001';

  await panel.diagnostics.dryButton.fire('click');

  const text = panel.diagnostics.dryOutput.collectText();
  assert.match(text, /DRY RUN — NO TRANSACTION BROADCAST/);
  assert.match(text, /Recipient\s*\n\s*bob\.veyra/);
  assert.match(text, /Status\s*\n\s*READY/);
  assert.match(text, /Broadcast\s*\n\s*no/);
  assert.match(text, /Announcer\s*\n\s*0x55649e01b5df198d18d95b5cc5051630cfd45564/i);
  assert.match(text, /Blockers\s*\n\s*none/);
  assert.deepEqual(harness.forbidden, [], 'the dry run must not call eth_sendTransaction or personal_sign');
  assert.ok(!harness.providerCalls.includes('eth_sendTransaction'));
  assert.equal(harness.apiCalls.every((call) => call.method === 'GET'), true);
  assert.equal(panel.diagnostics.dryButton.disabled, false, 'the button is re-enabled');
});

test('a wrong-network wallet renders WRONG NETWORK and blocks the real send path (DOM shim)', async () => {
  const harness = await makeHarness({ chainId: '0x1' });
  const { PrivateTransferPanel } = await import('../src/ui/PrivateTransferPanel.js');
  const panel = new PrivateTransferPanel(harness.game);
  await panel.refresh();
  const network = panel.root.children.flatMap(function walk(node) {
    return [node, ...node.children.flatMap(walk)];
  }).find((node) => node.className?.includes('private-network'));
  assert.equal(network.dataset.state, 'warn');
  assert.match(network.textContent, /Wallet WRONG NETWORK — detected 0x1, expected 0x1159/);
  assert.match(network.textContent, /Transfers are blocked until your wallet is on LiteForge \(chain 4441\)/);

  panel.recipient.value = 'bob';
  panel.amount.value = '0.001';
  await panel.diagnostics.dryButton.fire('click');
  assert.match(panel.diagnostics.dryOutput.collectText(), /Blockers\s*\n\s*WRONG_NETWORK/);
  assert.deepEqual(harness.forbidden, []);
});

test('a disconnected wallet renders DISCONNECTED and disables identity actions (DOM shim)', async () => {
  const harness = await makeHarness();
  harness.game.walletSession.account = null;
  globalThis.__VEYRA_LITVM_WALLET_ADAPTER__ = null;
  const { PrivateTransferPanel } = await import('../src/ui/PrivateTransferPanel.js');
  const panel = new PrivateTransferPanel(harness.game);
  await panel.refresh();
  const network = panel.root.children.flatMap(function walk(node) {
    return [node, ...node.children.flatMap(walk)];
  }).find((node) => node.className?.includes('private-network'));
  assert.equal(network.dataset.state, 'off');
  assert.match(network.textContent, /Wallet DISCONNECTED/);
  assert.equal(panel.createButton.disabled, true);
  assert.equal(panel.backupButton.disabled, true);
});
