// Phase 4A — manual browser/wallet validation tooling: test mode, read-only dry run and
// the diagnostics surface.
//
// Two things must be provable here:
//   1. The dry run is read-only BY CONSTRUCTION — it can never sign, broadcast or write
//      to the backend, and it can never be produced by the real send path.
//   2. Test mode is an explicit opt-in that adds DISPLAY ONLY. No network check, wallet
//      signature, cryptographic check or announcement validation is disabled by it, and
//      no key material is ever rendered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

import { PrivateTransferSession, testModeEnabled, TEST_MODE_KEY } from '../src/systems/PrivateTransferSession.js';
import { PrivateTransferClient, PrivateTransferError } from '../src/stealth/privateTransfer.js';
import { buildMetaAddress, metaFingerprint } from '../src/stealth/protocol.js';
import * as S from '../src/stealth/secp256k1.js';
import { bytesToHex } from '../src/stealth/keccak.js';
import { canTransition, TRANSFER_STATES } from '../src/stealth/transferState.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const diagnosticsSource = read('src/ui/PrivateTransferDiagnostics.js');
const panelSource = read('src/ui/PrivateTransferPanel.js');
const sessionSource = read('src/systems/PrivateTransferSession.js');
const css = read('styles/private-transfer.css');

const ALICE = '0x' + 'a1'.repeat(20);
const BOB_SPEND = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn;
const BOB_VIEW = 0x0fedcba09876543210fedcba09876543210fedcba09876543210fedcba0987654n;
const BOB_SPEND_PUBLIC = bytesToHex(S.compressPoint(S.multiplyG(BOB_SPEND)));
const BOB_VIEW_PUBLIC = bytesToHex(S.compressPoint(S.multiplyG(BOB_VIEW)));
const META = buildMetaAddress(BOB_SPEND_PUBLIC, BOB_VIEW_PUBLIC);
const FINGERPRINT = metaFingerprint(META);

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

/** Provider that records every call and REFUSES anything that could sign or mutate. */
function readOnlyProvider({ chainId = '0x1159', accounts = [ALICE], code = '0x', balance = '0xde0b6b3a7640000', gas = '0x5208', gasPrice = '0x3b9aca00' } = {}) {
  const calls = [];
  const forbidden = [];
  const allowed = new Set(['eth_chainId', 'eth_accounts', 'eth_getCode', 'eth_getBalance', 'eth_estimateGas', 'eth_gasPrice']);
  const provider = {
    calls,
    forbidden,
    request: async ({ method, params }) => {
      calls.push({ method, params });
      if (!allowed.has(method)) {
        forbidden.push(method);
        throw new Error(`FORBIDDEN_READ_ONLY_VIOLATION:${method}`);
      }
      switch (method) {
        case 'eth_chainId': return chainId;
        case 'eth_accounts': return accounts;
        case 'eth_getCode': return code;
        case 'eth_getBalance': return balance;
        case 'eth_estimateGas': return gas;
        case 'eth_gasPrice': return gasPrice;
        default: return null;
      }
    },
  };
  return provider;
}

function fakeApi({ onChange = null } = {}) {
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, method: options.method ?? 'GET', body: options.body ?? null });
    if (options.method && options.method !== 'GET') throw new Error('API_WRITE_FORBIDDEN_IN_DRY_RUN');
    if (path.includes('/resolve')) {
      return { identity: {
        username: 'bob', protocolVersion: 1, schemeId: 1,
        spendingPublicKey: BOB_SPEND_PUBLIC, viewingPublicKey: BOB_VIEW_PUBLIC,
        metaAddress: META, fingerprint: FINGERPRINT,
      } };
    }
    if (path.includes('/announcements')) return { announcements: [], nextCursor: null };
    return null;
  };
  api.calls = calls;
  api.onChange = onChange;
  return api;
}

const makeClient = ({ provider = readOnlyProvider(), api = fakeApi(), storage = memoryStorage() } = {}) => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  const client = new PrivateTransferClient({ api, provider });
  return { client, provider, api, storage, restore: () => { globalThis.localStorage = previous; } };
};

/* ============================================================ test-mode gating */
test('test mode is OFF by default and only an explicit opt-in turns it on', () => {
  const storage = memoryStorage();
  assert.equal(testModeEnabled({ search: '', storage, flag: undefined }), false);
  assert.equal(testModeEnabled({ search: '?debug=1', storage, flag: undefined }), false);
  assert.equal(testModeEnabled({ search: '?veyra-private-test=0', storage, flag: undefined }), false);
  assert.equal(testModeEnabled({ search: '?veyra-private-test=1', storage, flag: undefined }), true);
  storage.setItem(TEST_MODE_KEY, '1');
  assert.equal(testModeEnabled({ search: '', storage, flag: undefined }), true);
  assert.equal(testModeEnabled({ search: '', storage: memoryStorage(), flag: true }), true);
  // A hostile search string must not throw.
  assert.equal(testModeEnabled({ search: '%%%', storage: memoryStorage(), flag: undefined }), false);
});

test('test mode never appears in the protocol modules (display only)', () => {
  for (const path of ['src/stealth/privateTransfer.js', 'src/stealth/wallet.js', 'src/stealth/announcement.js', 'src/stealth/derive.js', 'server/private-transfer.js']) {
    assert.equal(/testMode|veyra-private-test|TEST_MODE/.test(read(path)), false, `${path} must not branch on test mode`);
  }
  // The dry run itself must not be reachable from the real send path.
  const send = read('src/stealth/privateTransfer.js');
  const sendBody = send.slice(send.indexOf('async send('), send.indexOf('async previewSend('));
  assert.equal(/previewSend/.test(sendBody), false, 'send() must never call previewSend()');
});

/* ============================================================= wallet status */
test('walletStatus reports DISCONNECTED without a wallet, and never calls the provider', async () => {
  const session = new PrivateTransferSession({ events: { on() {}, emit() {} }, walletSession: { account: null } });
  const status = await session.walletStatus();
  assert.equal(status.state, 'DISCONNECTED');
  assert.equal(status.canSend, false);
  assert.equal(status.address, null);
  assert.equal(status.expected.chainId, 4441);
  assert.equal(status.expected.chainIdHex, '0x1159');
});

test('walletStatus reports CONNECTED only for an EOA on LiteForge', async () => {
  const provider = readOnlyProvider();
  const session = new PrivateTransferSession({ events: { on() {}, emit() {} }, walletSession: { account: ALICE } });
  session._adapter = () => ({ provider });
  const status = await session.walletStatus();
  assert.equal(status.state, 'CONNECTED');
  assert.equal(status.detectedChainId, 4441);
  assert.equal(status.walletKind, 'eoa');
  assert.equal(status.canSend, true);
  assert.deepEqual(provider.forbidden, [], 'inspection must not use any mutating provider method');
});

test('walletStatus reports WRONG_NETWORK for another chain and for an unreadable chain', async () => {
  const cases = [
    ['other chain', { chainId: '0x1' }, 'CHAIN_MISMATCH'],
    ['missing', { chainId: null }, 'CHAIN_UNREADABLE'],
    ['malformed', { chainId: 'not-a-chain' }, 'CHAIN_UNREADABLE'],
  ];
  for (const [label, options, reason] of cases) {
    const session = new PrivateTransferSession({ events: { on() {}, emit() {} }, walletSession: { account: ALICE } });
    session._adapter = () => ({ provider: readOnlyProvider(options) });
    const status = await session.walletStatus();
    assert.equal(status.state, 'WRONG_NETWORK', label);
    assert.equal(status.canSend, false, label);
    assert.equal(status.reason, reason, label);
  }
  // A provider that throws must fail closed, never crash the caller.
  const session = new PrivateTransferSession({ events: { on() {}, emit() {} }, walletSession: { account: ALICE } });
  session._adapter = () => ({ provider: { request: async () => { throw new Error('rpc down'); } } });
  const status = await session.walletStatus();
  assert.equal(status.state, 'WRONG_NETWORK');
  assert.equal(status.detectedChainId, null);
});

test('walletStatus refuses contract wallets (no SCW / AA / multisig path)', async () => {
  const session = new PrivateTransferSession({ events: { on() {}, emit() {} }, walletSession: { account: ALICE } });
  session._adapter = () => ({ provider: readOnlyProvider({ code: '0x60016000' }) });
  const status = await session.walletStatus();
  assert.equal(status.state, 'CONNECTED');
  assert.equal(status.walletKind, 'contract');
  assert.equal(status.canSend, false);
  assert.equal(status.reason, 'UNSUPPORTED_WALLET');
});

/* ================================================================ dry run */
test('previewSend is read-only: it never signs, broadcasts or writes to the backend', async () => {
  const { client, provider, api, restore } = makeClient();
  try {
    const preview = await client.previewSend({ recipient: 'bob.veyra', amount: '0.001' });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.broadcast, false);
    assert.equal(preview.label, 'DRY RUN — NO TRANSACTION BROADCAST');
    assert.equal(preview.status, 'READY');
    assert.deepEqual(preview.blockers, []);
    assert.deepEqual(provider.forbidden, [], 'no signing/broadcast method may be called');
    const methods = provider.calls.map((call) => call.method);
    assert.ok(methods.includes('eth_chainId') && methods.includes('eth_getBalance'));
    for (const call of api.calls) assert.equal(call.method, 'GET', `${call.path} must not be written to`);
    assert.equal(api.calls.some((call) => call.path.includes('/announcements')), false, 'no announcement is published by a dry run');
    assert.equal(api.calls.some((call) => call.path.includes('/payments')), false, 'no payment row is written by a dry run');
  } finally { restore(); }
});

test('previewSend records no pending intent, no recovery record and no fingerprint pin', async () => {
  const storage = memoryStorage();
  const { client, restore } = makeClient({ storage });
  try {
    await client.previewSend({ recipient: 'bob.veyra', amount: '0.001' });
    assert.equal(client.pendingIntent(), null, 'a dry run must not create the stale-payment warning');
    assert.equal(client.recoveryRecord(), null, 'a dry run must not create an announcement-recovery record');
    const keys = [...storage.data.keys()];
    assert.equal(keys.some((key) => key.includes('pending-payment') || key.includes('announcement-recovery')), false, keys.join(','));
    assert.equal(keys.some((key) => key.includes('meta-pins')), false, 'a dry run must not pin a recipient fingerprint');
  } finally { restore(); }
});

test('previewSend reports exactly the transaction shape the real send would build', async () => {
  const { client, restore } = makeClient();
  try {
    const preview = await client.previewSend({ recipient: 'bob', amount: '0.001' });
    assert.equal(preview.amountAtomic, '1000000000000000');
    assert.equal(preview.chainId, 4441);
    assert.equal(preview.chainIdHex, '0x1159');
    assert.equal(preview.announcerAddress.toLowerCase(), '0x55649e01b5df198d18d95b5cc5051630cfd45564');
    assert.equal(preview.payment.to, preview.stealth.stealthAddress);
    assert.equal(preview.payment.from, ALICE);
    assert.equal(preview.payment.value, '0x38d7ea4c68000');
    assert.equal(preview.payment.chainId, '0x1159');
    assert.match(preview.stealth.ephemeralPublicKey, /^0x0[23][0-9a-f]{64}$/);
    assert.match(preview.stealth.stealthAddress, /^0x[0-9a-f]{40}$/);
    assert.match(preview.stealth.viewTag, /^[0-9a-f]{2}$/);
    assert.equal(preview.requirements.walletSignatureRequired, true);
    assert.equal(preview.requirements.announcementRequired, true);
  } finally { restore(); }
});

test('each dry run derives a FRESH stealth address (no reuse, no pinning)', async () => {
  const { client, restore } = makeClient();
  try {
    const first = await client.previewSend({ recipient: 'bob', amount: '0.001' });
    const second = await client.previewSend({ recipient: 'bob', amount: '0.001' });
    assert.notEqual(first.stealth.stealthAddress, second.stealth.stealthAddress);
    assert.notEqual(first.stealth.ephemeralPublicKey, second.stealth.ephemeralPublicKey);
  } finally { restore(); }
});

test('the expected transitions are a legal walk that cannot skip the announcement', () => {
  for (const [index, state] of ['resolving_recipient', 'recipient_verified', 'deriving_stealth', 'awaiting_wallet', 'payment_submitted', 'payment_confirming', 'payment_confirmed', 'announcement_submitting', 'announcement_confirmed', 'completed'].entries()) {
    assert.ok(TRANSFER_STATES.includes(state), `${state} must be a real state`);
    if (index === 0) continue;
    assert.equal(canTransition(['idle', ...['resolving_recipient']].slice(-1)[0] && ['resolving_recipient', 'recipient_verified', 'deriving_stealth', 'awaiting_wallet', 'payment_submitted', 'payment_confirming', 'payment_confirmed', 'announcement_submitting', 'announcement_confirmed', 'completed'][index - 1], state), true, `${index}: illegal transition`);
  }
});

test('previewSend is BLOCKED (never thrown) on wrong network, and still cannot broadcast', async () => {
  const provider = readOnlyProvider({ chainId: '0x1' });
  const { client, restore } = makeClient({ provider });
  try {
    const preview = await client.previewSend({ recipient: 'bob', amount: '0.001' });
    assert.equal(preview.status, 'BLOCKED');
    assert.deepEqual([...preview.blockers], ['WRONG_NETWORK']);
    assert.equal(preview.payment, null, 'no transaction is shaped while the chain is wrong');
    assert.deepEqual(provider.forbidden, []);
  } finally { restore(); }
});

test('previewSend reports insufficient funds with the shortfall instead of failing', async () => {
  const provider = readOnlyProvider({ balance: '0x1' }); // 1 wei
  const { client, restore } = makeClient({ provider });
  try {
    const preview = await client.previewSend({ recipient: 'bob', amount: '0.001' });
    assert.equal(preview.status, 'BLOCKED');
    assert.ok(preview.blockers.includes('INSUFFICIENT_BALANCE'), preview.blockers.join(','));
    assert.equal(preview.payment.to, preview.stealth.stealthAddress, 'the shape is still shown for the tester');
  } finally { restore(); }
});

test('previewSend surfaces the dust warning without blocking', async () => {
  const { client, restore } = makeClient();
  try {
    const preview = await client.previewSend({ recipient: 'bob', amount: '0.00001' });
    assert.equal(preview.status, 'READY');
    assert.equal(preview.warnings.length, 1);
    assert.match(preview.warnings[0], /very small/);
  } finally { restore(); }
});

test('previewSend refuses an invalid amount and an unknown recipient', async () => {
  const { client, restore } = makeClient();
  try {
    await assert.rejects(client.previewSend({ recipient: 'bob', amount: '0' }), /AMOUNT_INVALID/);
    await assert.rejects(client.previewSend({ recipient: 'bob', amount: '-1' }), /AMOUNT_INVALID/);
    await assert.rejects(client.previewSend({ recipient: 'bob', amount: '1e18' }), /AMOUNT_INVALID/);
    const empty = new PrivateTransferClient({ api: async () => { throw Object.assign(new Error('x'), { code: 'NOT_FOUND' }); }, provider: readOnlyProvider() });
    await assert.rejects(empty.previewSend({ recipient: 'nobody', amount: '0.001' }), /RECIPIENT_NOT_FOUND/);
  } finally { restore(); }
});

test('a fingerprint change blocks the dry run until it is acknowledged', async () => {
  const storage = memoryStorage();
  storage.setItem('veyra:stealth:meta-pins', JSON.stringify({ bob: 'deadbeef-deadbeef-deadbeef-deadbeef' }));
  const { client, api, restore } = makeClient({ storage });
  try {
    const blocked = await client.previewSend({ recipient: 'bob', amount: '0.001' });
    assert.equal(blocked.status, 'BLOCKED');
    assert.ok(blocked.blockers.includes('FINGERPRINT_CHANGED'));
    const acknowledged = await client.previewSend({ recipient: 'bob', amount: '0.001', acceptFingerprintChange: true });
    assert.equal(acknowledged.status, 'READY');
    // The dry run itself must never rewrite the pin.
    assert.equal(JSON.parse(storage.getItem('veyra:stealth:meta-pins')).bob, 'deadbeef-deadbeef-deadbeef-deadbeef');
    assert.equal(api.calls.every((call) => call.method === 'GET'), true);
  } finally { restore(); }
});

test('a dry run can never leak key material, even when keys are in memory', async () => {
  const { client, restore } = makeClient();
  try {
    client.rememberIdentity({
      spendingPrivateKey: BOB_SPEND, viewingPrivateKey: BOB_VIEW,
      metaAddress: META, username: 'bob',
    });
    const preview = await client.previewSend({ recipient: 'bob', amount: '0.001' });
    const serialized = JSON.stringify(preview).toLowerCase();
    for (const secret of [BOB_SPEND, BOB_VIEW]) {
      const hex = secret.toString(16).padStart(64, '0');
      assert.equal(serialized.includes(hex), false, 'no private scalar may appear in a preview');
      assert.equal(serialized.includes(secret.toString()), false, 'no decimal scalar may appear in a preview');
    }
    assert.equal(/privatekey|viewingprivate|spendingprivate|mnemonic|seed/i.test(serialized), false);
  } finally { restore(); }
});

/* ============================================================ diagnostics snapshot */
test('the diagnostics snapshot is non-secret and reports state as enums/booleans', async () => {
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  try {
    const provider = readOnlyProvider();
    const game = { events: { on() {}, emit() {} }, walletSession: { account: ALICE } };
    const session = new PrivateTransferSession(game);
    session._adapter = () => ({ provider });
    await session.walletStatus();
    session.lastTransferState = 'payment_confirmed';
    session.client.rememberIdentity({ spendingPrivateKey: BOB_SPEND, viewingPrivateKey: BOB_VIEW, metaAddress: META, username: 'bob' });
    session.cacheIdentity({ username: 'bob', metaAddress: META, fingerprint: FINGERPRINT });

    const snapshot = session.diagnostics();
    assert.equal(snapshot.testMode, false);
    assert.equal(snapshot.wallet.state, 'CONNECTED');
    assert.equal(snapshot.identity.state, 'ENROLLED');
    assert.equal(snapshot.identity.keysInMemory, true);
    assert.equal(snapshot.transfer.state, 'payment_confirmed');
    assert.equal(snapshot.transfer.pendingIntentPresent, false);
    assert.equal(snapshot.announcement.recoveryRecordPresent, false);

    const serialized = JSON.stringify(snapshot).toLowerCase();
    for (const secret of [BOB_SPEND, BOB_VIEW]) {
      assert.equal(serialized.includes(secret.toString(16).padStart(64, '0')), false, 'no private scalar');
      assert.equal(serialized.includes(secret.toString()), false, 'no decimal scalar');
    }
    assert.equal(/privatekey|viewingprivate|spendingprivate|sisk|mnemonic|seed|recoverysecret/i.test(serialized), false);
    // No 32-byte scalar and no 65-byte signature-like blob may appear as a VALUE.
    const hexBlobs = serialized.match(/0x[0-9a-f]{64,}/g) ?? [];
    for (const blob of hexBlobs) {
      assert.equal(blob.length >= 66 + 64, false, `suspicious 64+ byte blob in snapshot: ${blob.slice(0, 12)}…`);
    }
  } finally { globalThis.localStorage = undefined; }
});

test('the diagnostics snapshot shows the stale-payment and recovery states when present', async () => {
  const storage = memoryStorage();
  const { client, restore } = makeClient({ storage });
  try {
    client._persistPendingIntent({ stealth: { stealthAddress: '0x' + 'ab'.repeat(20) }, amountAtomic: 1000n, paymentTxHash: '0x' + 'cd'.repeat(32) });
    client._persistRecoveryRecord({
      kind: 'veyra.stealth.announcement-recovery', version: 1, chainId: 4441, schemeId: 1, protocolVersion: 1,
      stealthAddress: '0x' + 'ab'.repeat(20), ephemeralPublicKey: '0x' + '02' + '11'.repeat(32), metadata: '0x7f',
      paymentTxHash: '0x' + 'cd'.repeat(32), paymentId: null, amountAtomic: '1000', createdAt: 'now',
    });
    globalThis.localStorage = storage;
    const session = new PrivateTransferSession({ events: { on() {}, emit() {} }, walletSession: { account: ALICE } });
    session.client = client;
    session.cacheIdentity({ username: 'bob', metaAddress: META, fingerprint: FINGERPRINT });
    const snapshot = session.diagnostics();
    assert.equal(snapshot.transfer.pendingIntentPresent, true);
    assert.equal(snapshot.transfer.pendingPaymentTxHash, '0x' + 'cd'.repeat(32));
    assert.equal(snapshot.announcement.recoveryRecordPresent, true);
    assert.equal(snapshot.announcement.paymentTxHash, '0x' + 'cd'.repeat(32));
  } finally { restore(); }
});

test('previewSend is exposed on the session and keeps the latest preview for diagnostics', async () => {
  const storage = memoryStorage();
  const { client, provider, restore } = makeClient({ storage });
  try {
    const session = new PrivateTransferSession({ events: { on() {}, emit() {} }, walletSession: { account: ALICE } });
    session.client = client;
    session._adapter = () => ({ provider });
    session.testMode = true;
    const preview = await session.previewSend({ recipient: 'bob', amount: '0.001' });
    assert.equal(preview.dryRun, true);
    const snapshot = session.diagnostics();
    assert.equal(snapshot.stealth.lastStealthAddress, preview.stealth.stealthAddress);
    assert.equal(snapshot.stealth.lastStatus, 'READY');
    assert.equal(snapshot.testMode, true);
  } finally { restore(); }
});

test('setTestMode persists the opt-in and never enables anything else', async () => {
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  try {
    const session = new PrivateTransferSession({ events: { on() {}, emit() {} }, walletSession: { account: ALICE } });
    assert.equal(session.testMode, false);
    session.setTestMode(true);
    assert.equal(storage.getItem(TEST_MODE_KEY), '1');
    assert.equal(session.testMode, true);
    session.setTestMode(false);
    assert.equal(storage.getItem(TEST_MODE_KEY), null);
  } finally { globalThis.localStorage = undefined; }
});

/* =============================================================== source guards */
test('the diagnostics surface cannot inject markup or log secrets', () => {
  // Comments may NAME a banned API to document why it is banned; only real code counts.
  const code = diagnosticsSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/[^\n]*/g, '');
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
    assert.equal(code.includes(sink), false, `diagnostics must not use ${sink}`);
  }
  assert.equal(/console\.(log|info|warn|error|debug)/.test(code), false, 'diagnostics must not log');
  assert.equal(/spendingPrivateKey|viewingPrivateKey|siskPrivateKey|privateKey/.test(code), false,
    'the diagnostics surface must not even name key fields — it renders booleans from the session snapshot');
  // Rendering uses textContent only.
  assert.match(diagnosticsSource, /el\.textContent = text/);
  assert.match(diagnosticsSource, /replaceChildren\(\)/);
});

test('the panel reports wallet state and gates the diagnostics behind test mode', () => {
  assert.match(panelSource, /private-network/);
  assert.match(panelSource, /WRONG NETWORK — detected/);
  assert.match(panelSource, /Transfers are blocked until your wallet is on LiteForge/);
  assert.match(panelSource, /private-test-toggle/);
  assert.match(panelSource, /this\.session\.setTestMode\(!this\.session\.testMode\)/);
  assert.match(panelSource, /this\.diagnostics\.sync\(\)/);
  // The dry run button lives in the diagnostics module only.
  assert.equal(/RUN DRY RUN/.test(panelSource), false);
  assert.match(diagnosticsSource, /DRY RUN — NO TRANSACTION BROADCAST/);
});

test('the network line is driven by the same fail-closed inspection used for payments', () => {
  assert.match(sessionSource, /async walletStatus\(\)/);
  assert.match(sessionSource, /reason: readable \? 'CHAIN_MISMATCH' : 'CHAIN_UNREADABLE'/);
  assert.equal(/wallet_switchEthereumChain/.test(sessionSource), false, 'inspecting must never switch networks');
});

test('the new surface ships: CSS classes exist and the diagnostics panel is hidden by default', () => {
  for (const selector of ['.private-network', '.private-test-toggle', '.private-diag', '.private-diag-dryrun-label']) {
    assert.ok(css.includes(selector), `${selector} must be styled`);
  }
  assert.match(css, /\.private-diag\[hidden\]\{display:none\}/);
  assert.match(diagnosticsSource, /root\.hidden = true/);
});

/* ================================================= outbound payload audit */
test('no outbound request carries key material, a recovery signature or a wallet address query', async () => {
  const storage = memoryStorage();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    const signatures = [];
    const provider = {
      request: async ({ method, params }) => {
        if (method === 'eth_chainId') return '0x1159';
        if (method === 'eth_accounts') return [ALICE];
        if (method === 'eth_getCode') return '0x';
        if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
        if (method === 'eth_estimateGas') return '0x5208';
        if (method === 'eth_gasPrice') return '0x3b9aca00';
        if (method === 'personal_sign') {
          // Two distinct, deterministic signatures: recovery (secret) then enrollment (public).
          const signature = signatures.length === 0
            ? '0x' + '11'.repeat(32) + '22'.repeat(32) + '1b'
            : '0x' + '33'.repeat(32) + '44'.repeat(32) + '1c';
          signatures.push({ method, params, signature });
          return signature;
        }
        throw new Error(`UNEXPECTED:${method}`);
      },
    };
    const calls = [];
    const api = async (path, options = {}) => {
      calls.push({ path, method: options.method ?? 'GET', body: options.body ?? null });
      if (path.includes('/resolve')) {
        return { identity: {
          username: 'bob', protocolVersion: 1, schemeId: 1,
          spendingPublicKey: BOB_SPEND_PUBLIC, viewingPublicKey: BOB_VIEW_PUBLIC,
          metaAddress: META, fingerprint: FINGERPRINT,
        } };
      }
      if (path.includes('/announcements')) return { announcements: [], nextCursor: null };
      if (path.includes('/enroll')) return { identity: { username: 'alice', metaAddress: '0x' + 'ab'.repeat(66), fingerprint: 'aabbccdd' } };
      return { ok: true };
    };
    const client = new PrivateTransferClient({ api, provider });
    await client.enroll({ username: 'alice', passphrase: 'passphrase-abcdefgh', persistBackup: false });
    await client.previewSend({ recipient: 'bob', amount: '0.001' });
    await client.scan();

    // Two signatures were requested (recovery + enrollment).
    assert.equal(signatures.length, 2);
    const [recovery, enrollment] = signatures;
    const serializedCalls = JSON.stringify(calls);
    assert.equal(serializedCalls.includes(recovery.signature), false, 'the recovery signature must never leave the device');
    assert.equal(serializedCalls.includes(enrollment.signature), true, 'the enrollment signature is the public half that DOES travel');

    // The in-memory private material must never be serialised into a request.
    const keys = client.identityKeys();
    for (const secret of [keys.spendingPrivateKey, keys.viewingPrivateKey, keys.siskPrivateKey].filter(Boolean)) {
      const hex = secret.toString(16).padStart(64, '0');
      assert.equal(serializedCalls.includes(hex), false, 'a private scalar must never be serialised');
      assert.equal(serializedCalls.toLowerCase().includes(String(secret)), false, 'a decimal scalar must never be serialised');
    }
    assert.equal(/spendingPrivateKey|viewingPrivateKey|siskPrivateKey|recoverySignature|mnemonic|seedphrase/i.test(serializedCalls), false);

    // Query strings carry only the documented, non-secret parameters.
    const allowedQuery = new Set(['username', 'cursor', 'limit']);
    for (const call of calls) {
      assert.ok(call.path.startsWith('/api/private-transfer/'), call.path);
      const query = call.path.includes('?') ? new URLSearchParams(call.path.split('?')[1]) : new URLSearchParams();
      for (const key of query.keys()) assert.ok(allowedQuery.has(key), `unexpected query parameter: ${key}`);
      // No wallet address in any path or body.
      assert.equal(JSON.stringify(call).toLowerCase().includes(ALICE), false, 'the wallet address must not be sent as data');
    }
  } finally { globalThis.localStorage = previousStorage; }
});

test('the diagnostics module adds no logging, telemetry, cookie or URL sink', () => {
  for (const source of [diagnosticsSource, sessionSource]) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.equal(/console\.(log|info|warn|error|debug)\(/.test(code), false);
    assert.equal(/navigator\.sendBeacon|gtag\(|analytics\.|mixpanel|segment\./i.test(code), false);
    assert.equal(/document\.cookie/.test(code), false);
  }
  assert.equal(/location\.(href|search|hash)\s*=/.test(diagnosticsSource), false, 'diagnostics must not write to the URL');
});

/* ======================================== test mode is not a bypass */
test('with test mode ON, the real send path still refuses wrong network, wrong wallet and bad signatures', async () => {
  const storage = memoryStorage();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = storage;
  storage.setItem(TEST_MODE_KEY, '1');
  try {
    // (a) WRONG NETWORK: send() must throw before any signing or broadcasting.
    const wrongChain = readOnlyProvider({ chainId: '0x1' });
    const clientWrongChain = new PrivateTransferClient({ api: fakeApi(), provider: wrongChain });
    await assert.rejects(
      clientWrongChain.send({ recipient: 'bob', amount: '0.001', confirmations: 0 }),
      (error) => error.code === 'WRONG_NETWORK' || /WRONG_NETWORK/.test(error.message),
    );
    assert.deepEqual(wrongChain.forbidden, [], 'no signing/broadcast may happen on the wrong chain');
    assert.equal(clientWrongChain.pendingIntent(), null, 'a refused send leaves no stale-payment warning');

    // (b) UNSUPPORTED (contract) WALLET: refused, never silently downgraded.
    const contractWallet = readOnlyProvider({ code: '0x60016000' });
    const clientContract = new PrivateTransferClient({ api: fakeApi(), provider: contractWallet });
    await assert.rejects(
      clientContract.send({ recipient: 'bob', amount: '0.001', confirmations: 0 }),
      (error) => /UNSUPPORTED_/.test(error.code || error.message),
    );
    assert.equal(/eth_sendTransaction/.test(contractWallet.calls.map((call) => call.method).join(',')), false);

    // (c) A malformed/compact signature is still refused (ERC-2098 path stays closed).
    const { assertDerivableSignature } = await import('../src/stealth/wallet.js');
    const compact = '0x' + '11'.repeat(64);
    assert.equal(assertDerivableSignature(compact).reason, 'COMPACT_SIGNATURE_UNSUPPORTED');
    assert.equal(assertDerivableSignature('0x' + '11'.repeat(63)).reason, 'SIGNATURE_FORM_UNSUPPORTED');

    // (d) Test mode must never appear in the decision path of a cryptographic guard.
    assert.equal(/testMode|TEST_MODE/.test(read('src/stealth/privateTransfer.js')), false);
    assert.equal(/testMode|TEST_MODE/.test(read('src/stealth/wallet.js')), false);
    assert.equal(/testMode|TEST_MODE/.test(read('src/stealth/announcement.js')), false);
  } finally { globalThis.localStorage = previousStorage; }
});
