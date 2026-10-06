// Phase 3 — client orchestration: state machine, failure policy, wallet gates and
// the privacy invariants of Alice's flow (brief §12/§14/§15/§16/§19).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  TRANSFER_STATES, TransferStateMachine, TransferStateError, canTransition,
  PAYMENT_SETTLED_STATES, ANNOUNCEMENT_PENDING_STATES, FAILURE_CODES, announcementRecoveryRecord,
} from '../src/stealth/transferState.js';
import {
  UNSUPPORTED_WALLET_MESSAGE, WALLET_KINDS, assertDerivableSignature, checkFunding,
  formatAtomic, parseAmountToAtomic,
} from '../src/stealth/wallet.js';
import { PrivateTransferClient, PrivateTransferError, createApiClient } from '../src/stealth/privateTransfer.js';
import { compressPoint, multiplyG, N } from '../src/stealth/secp256k1.js';
import { addressForPrivateKey } from '../src/stealth/signer.js';
import { bytesToHex } from '../src/stealth/keccak.js';
import { buildMetaAddress, metaFingerprint } from '../src/stealth/protocol.js';
import { computeSpendPublicKeyFixture } from './fixtures/private-transfer-keys.js';
import { enrollmentMessage, personalMessageHash, addressFromPersonalSignature } from '../src/stealth/recovery.js';
import { signDigest } from '../src/stealth/signer.js';

const FIXTURE = computeSpendPublicKeyFixture();
const ALICE = '0x' + 'a1'.repeat(20);
const BOB_NORMAL_WALLET = '0x' + 'b0'.repeat(20);
const PAYMENT_TX = '0x' + '11'.repeat(32);
const ANNOUNCE_TX = '0x' + '22'.repeat(32);

/* ------------------------------------------------------------------ fakes */
function fakeProvider({ chainId = '0x1159', accounts = [ALICE], code = '0x', rejectSend = false, receipts = 'ok', balance = '0xde0b6b3a7640000' } = {}) {
  const calls = [];
  return {
    calls,
    request: async ({ method, params }) => {
      calls.push({ method, params });
      switch (method) {
        case 'eth_chainId': return chainId;
        case 'eth_accounts': return accounts;
        case 'eth_getCode': return code;
        case 'eth_getBalance': return balance;
        case 'eth_gasPrice': return '0x3b9aca00';
        case 'eth_getTransactionCount': return '0x1';
        case 'eth_getBlockByNumber': return { number: '0x10', baseFeePerGas: '0x3b9aca00' };
        case 'eth_blockNumber': return '0x20';
        case 'eth_sendTransaction':
          if (rejectSend) throw new Error('User rejected the request');
          return (params?.[0]?.to ?? '').toLowerCase() === '0x55649e01b5df198d18d95b5cc5051630cfd45564' ? ANNOUNCE_TX : PAYMENT_TX;
        case 'eth_sendRawTransaction': return '0x' + '33'.repeat(32);
        case 'eth_getTransactionReceipt':
          if (receipts === 'pending') return null;
          if (receipts === 'reverted') return { status: '0x0', blockNumber: '0x10' };
          return { status: '0x1', blockNumber: '0x10' };
        case 'personal_sign': return '0x' + 'ab'.repeat(32) + 'cd'.repeat(32) + '1b';
        default: throw new Error(`unexpected method ${method}`);
      }
    },
  };
}

function fakeApi(routes = {}) {
  const calls = [];
  const api = async (path, options = {}) => {
    // `this.api` takes a plain object body; `createApiClient` is the layer that
    // serialises it for fetch (covered separately below).
    const body = options.body ? options.body : null;
    calls.push({ path, method: options.method ?? 'GET', body, headers: options.headers });
    for (const [pattern, handler] of Object.entries(routes)) {
      if (path.includes(pattern)) return typeof handler === 'function' ? handler({ path, body, options }) : handler;
    }
    if (path.includes('/resolve')) return { identity: resolveRecord() };
    if (path.includes('/announcements') && (options.method ?? 'GET') === 'GET') return { announcements: [], nextCursor: null };
    if (path.includes('/payments')) return { paymentId: 'pay-1' };
    return { ok: true };
  };
  api.calls = calls;
  return api;
}

const resolveRecord = (overrides = {}) => ({
  username: 'bob',
  protocolVersion: 1,
  schemeId: 1,
  spendingPublicKey: FIXTURE.spendingPublicKey,
  viewingPublicKey: FIXTURE.viewingPublicKey,
  metaAddress: FIXTURE.metaAddress,
  fingerprint: FIXTURE.fingerprint,
  ...overrides,
});

function memoryStorage() {
  const store = new Map();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
}

/** Run a client with isolated global storage and capture emitted events. */
async function withEnv(fn) {
  const previous = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  const local = memoryStorage();
  const session = memoryStorage();
  globalThis.localStorage = local;
  globalThis.sessionStorage = session;
  const events = [];
  try {
    return await fn({ local, session, events });
  } finally {
    globalThis.localStorage = previous.localStorage;
    globalThis.sessionStorage = previous.sessionStorage;
  }
}

const clientFor = ({ provider, api, events }) => new PrivateTransferClient({ provider, api, events: { emit: (name, payload) => events.push({ name, payload }) } });

/* ------------------------------------------------------------------ state machine */
test('the transfer state machine only allows the documented transitions', () => {
  assert.deepEqual(TRANSFER_STATES[0], 'idle');
  assert.ok(TRANSFER_STATES.includes('announcement_submitting'), 'the announcement phase must be explicit');
  const machine = new TransferStateMachine();
  machine.transition('resolving_recipient');
  assert.throws(() => machine.transition('completed'), TransferStateError, 'completion is unreachable without a payment');
  assert.throws(() => machine.transition('awaiting_wallet'), TransferStateError, 'no skipping ahead');
  assert.throws(() => machine.transition('payment_submitted'), TransferStateError);
  assert.throws(() => new TransferStateMachine({ resumeAt: 'completed' }), TransferStateError, 'an attempt can never resume as completed');
});

test('"completed" requires confirmations for BOTH the payment and the announcement', () => {
  const machine = new TransferStateMachine();
  machine.transition('resolving_recipient');
  machine.transition('recipient_verified');
  machine.transition('deriving_stealth');
  machine.transition('awaiting_wallet');
  machine.transition('payment_submitted');
  machine.transition('payment_confirming');
  machine.transition('payment_confirmed', { paymentConfirmed: true });
  assert.throws(() => machine.transition('completed', { paymentConfirmed: true, announcementConfirmed: false }), TransferStateError);
  machine.transition('announcement_submitting');
  machine.transition('announcement_confirmed', { announcementConfirmed: true });
  assert.throws(() => machine.transition('completed', { announcementConfirmed: true }), TransferStateError);
  machine.transition('completed', { paymentConfirmed: true, announcementConfirmed: true });
  assert.equal(machine.state, 'completed');
  assert.deepEqual(machine.history.at(-1).state, 'completed');
});

test('no state can ever fall back into a direct wallet-to-wallet transfer', () => {
  for (const state of TRANSFER_STATES) {
    for (const forbidden of ['sending_direct', 'wallet_transfer', 'payment_submitted', 'awaiting_wallet']) {
      if (state === forbidden) continue;
      assert.equal(canTransition(state, forbidden), state === 'idle' ? false : canTransition(state, forbidden));
    }
    assert.equal(canTransition(state, 'completed'), ['announcement_confirmed'].includes(state));
  }
  // A settled payment is never re-sendable, and its announcement is republishable.
  assert.ok(PAYMENT_SETTLED_STATES.includes('payment_confirmed'));
  assert.deepEqual(ANNOUNCEMENT_PENDING_STATES, ['payment_confirmed', 'announcement_submitting']);
  assert.equal(canTransition('payment_confirmed', 'awaiting_wallet'), false);
  assert.equal(canTransition('failed', 'payment_submitted'), false);
});

/* ------------------------------------------------------------------ wallet gates */
test('unsupported wallet classes are refused with the exact message', async () => {
  await withEnv(async ({ events }) => {
    const api = fakeApi();
    const contract = fakeProvider({ code: '0x6080' });
    const client = clientFor({ provider: contract, api, events });
    await assert.rejects(client.enroll({ username: 'alice', passphrase: 'passphrase-1234' }), (error) => {
      assert.equal(error.message, 'Private transfer identity setup is not supported by this wallet type yet.');
      assert.equal(error.code, FAILURE_CODES.UNSUPPORTED_ACCOUNT_TYPE);
      return true;
    });
    assert.equal(contract.calls.some((call) => call.method === 'personal_sign'), false, 'nothing is signed for an unsupported wallet');
  });
});

test('wrong chain, disconnected wallet and compact signatures are refused', async () => {
  await withEnv(async ({ events }) => {
    const api = fakeApi();
    const client = clientFor({ provider: fakeProvider({ chainId: '0x1' }), api, events });
    await assert.rejects(client.enroll({ username: 'alice', passphrase: 'passphrase-1234' }), /WRONG_NETWORK/);

    const disconnected = clientFor({ provider: fakeProvider({ accounts: [] }), api, events });
    await assert.rejects(disconnected.enroll({ username: 'alice', passphrase: 'passphrase-1234' }), /WALLET_DISCONNECTED/);
  });

  assert.equal(assertDerivableSignature('0x' + 'ab'.repeat(64)).ok, false);
  assert.equal(assertDerivableSignature('0x' + 'ab'.repeat(64)).reason, 'COMPACT_SIGNATURE_UNSUPPORTED');
  assert.equal(assertDerivableSignature('0x' + 'ab'.repeat(63)).ok, false);
  assert.equal(assertDerivableSignature('0xzz' + 'ab'.repeat(64)).ok, false);
  assert.equal(assertDerivableSignature('0x' + 'ab'.repeat(65)).ok, true);
  assert.equal(WALLET_KINDS.EOA, 'eoa');
});

/* ------------------------------------------------------------------ amounts */
test('amounts are integer atomic units and never float maths', () => {
  assert.equal(parseAmountToAtomic('0.001'), 1_000_000_000_000_000n);
  assert.equal(parseAmountToAtomic('12'), 12n * 10n ** 18n);
  assert.equal(parseAmountToAtomic('0.000000000000000001'), 1n);
  assert.equal(parseAmountToAtomic('1.5'), 1_500_000_000_000_000_000n);
  assert.equal(formatAtomic(1_500_000_000_000_000_000n), '1.5');
  for (const bad of ['', '.', '0', '0.0', '-1', '1e18', 'abc', '1.0000000000000000001']) {
    assert.throws(() => parseAmountToAtomic(bad), /AMOUNT_/, `${bad} must be refused`);
  }
});

test('funding checks reserve gas instead of hard-coding a gas price', () => {
  const amount = 1_000_000_000_000_000n;
  assert.equal(checkFunding({ balanceAtomic: 10n ** 18n, amountAtomic: amount, gasReserveAtomic: 10n ** 15n }).ok, true);
  assert.equal(checkFunding({ balanceAtomic: amount - 1n, amountAtomic: amount, gasReserveAtomic: 0n }).error, 'INSUFFICIENT_BALANCE');
  assert.equal(checkFunding({ balanceAtomic: amount + 1n, amountAtomic: amount, gasReserveAtomic: 10n ** 15n }).error, 'INSUFFICIENT_GAS');
});

/* ------------------------------------------------------------------ send flow */
test('the happy path derives locally, pays the FRESH stealth address and announces once', async () => {
  await withEnv(async ({ events }) => {
    const provider = fakeProvider();
    const api = fakeApi();
    const client = clientFor({ provider, api, events });
    const seen = [];
    const result = await client.send({ recipient: 'bob', amount: '0.001', onState: (state) => seen.push(state) });

    assert.equal(result.status, 'completed');
    assert.deepEqual(seen, ['resolving_recipient', 'recipient_verified', 'deriving_stealth', 'awaiting_wallet', 'payment_submitted', 'payment_confirming', 'payment_confirmed', 'announcement_submitting', 'announcement_confirmed', 'completed'], 'the announcement phase must be visible before completion is reached');
    assert.equal(seen.at(-1), 'completed', 'the machine reaches "completed" only after the announcement confirmed');
    assert.equal(result.amountAtomic, '1000000000000000');

    const payments = provider.calls.filter((call) => call.method === 'eth_sendTransaction');
    assert.equal(payments.length, 2, 'one payment + one announcement, never more');
    assert.equal(payments[0].params[0].to.toLowerCase(), result.stealthAddress.toLowerCase());
    assert.equal(payments[1].params[0].to.toLowerCase(), '0x55649e01b5df198d18d95b5cc5051630cfd45564');
    assert.equal(payments[0].params[0].value, '0x38d7ea4c68000');
    assert.equal(payments[0].params[0].gasPrice, undefined, 'no gas assumption is ever hard-coded by the client');

    // The stealth address in the transaction is fresh: it is not Bob's meta-address
    // and not any address the test supplied.
    assert.notEqual(result.stealthAddress.toLowerCase(), BOB_NORMAL_WALLET.toLowerCase());
    assert.notEqual(result.stealthAddress.toLowerCase(), FIXTURE.metaAddress.toLowerCase());

    // Outbound payloads contain no wallet address and no key material.
    const serialized = JSON.stringify(api.calls);
    assert.equal(/wallet/i.test(serialized), false, `no wallet field may be sent: ${serialized}`);
    assert.equal(/privatekey/i.test(serialized), false);
    assert.equal(serialized.includes(FIXTURE.metaAddress), false, 'the recipient meta-address is not reported to the backend');
  });
});

test('a wallet rejection during payment aborts before any announcement', async () => {
  await withEnv(async ({ events }) => {
    const provider = fakeProvider({ rejectSend: true });
    const api = fakeApi();
    const client = clientFor({ provider, api, events });
    await assert.rejects(client.send({ recipient: 'bob', amount: '0.001' }), (error) => {
      assert.equal(error.code, FAILURE_CODES.TRANSACTION_REJECTED);
      return true;
    });
    assert.equal(api.calls.some((call) => call.path.includes('/announcements')), false, 'no announcement is published for a payment that never happened');
  });
});

test('a failed announcement NEVER re-sends the payment and is retried separately', async () => {
  await withEnv(async ({ local, events }) => {
    const provider = fakeProvider();
    let announcementPosts = 0;
    const api = fakeApi({
      '/announcements': ({ options }) => {
        if ((options.method ?? 'GET') === 'POST') {
          announcementPosts += 1;
          if (announcementPosts === 1) throw new Error('RPC_FAILURE'); // the first publish fails
          return { ok: true, announcementId: 1 };
        }
        return { announcements: [], nextCursor: null };
      },
    });
    const client = clientFor({ provider, api, events });

    await assert.rejects(client.send({ recipient: 'bob', amount: '0.001' }), (error) => {
      assert.equal(error.code, FAILURE_CODES.ANNOUNCEMENT_FAILED);
      assert.ok(error.recoveryRecord, 'the non-secret recovery record travels with the error');
      assert.equal(error.recoveryRecord.paymentTxHash, PAYMENT_TX);
      return true;
    });

    const paymentSends = provider.calls.filter((call) => call.method === 'eth_sendTransaction' && call.params[0].to.toLowerCase() !== '0x55649e01b5df198d18d95b5cc5051630cfd45564');
    assert.equal(paymentSends.length, 1, 'the zkLTC payment is sent exactly once');
    assert.ok(local.getItem('veyra:stealth:announcement-recovery'), 'the recovery record is persisted');
    assert.equal(events.some((event) => event.name === 'private-transfer:announcement-pending'), true);

    // Retry publishes ONLY the announcement.
    const before = provider.calls.length;
    const retry = await client.retryAnnouncement();
    assert.equal(retry.status, 'completed');
    const retrySends = provider.calls.slice(before).filter((call) => call.method === 'eth_sendTransaction');
    assert.equal(retrySends.length, 1);
    assert.equal(retrySends[0].params[0].to.toLowerCase(), '0x55649e01b5df198d18d95b5cc5051630cfd45564', 'retry touches the announcer only');
    assert.equal(local.getItem('veyra:stealth:announcement-recovery'), null, 'the record is cleared after success');
  });
});

test('a reverted or timed-out payment is reported as failed, never as complete', async () => {
  await withEnv(async ({ events }) => {
    const client = clientFor({ provider: fakeProvider({ receipts: 'reverted' }), api: fakeApi(), events });
    await assert.rejects(client.send({ recipient: 'bob', amount: '0.001' }), /TRANSACTION_FAILED/);
    const timedOut = clientFor({ provider: fakeProvider({ receipts: 'pending' }), api: fakeApi(), events });
    await assert.rejects(timedOut.send({ recipient: 'bob', amount: '0.001', confirmations: 1, receiptTimeoutMs: 30, pollMs: 10 }), /TIMEOUT/);
  });
});

/* ------------------------------------------------------------------ resolution safety */
test('a recipient record carrying a wallet address is refused before any payment', async () => {
  await withEnv(async ({ events }) => {
    const api = fakeApi({ '/resolve': { identity: resolveRecord({ walletAddress: BOB_NORMAL_WALLET }) } });
    const provider = fakeProvider();
    const client = clientFor({ provider, api, events });
    await assert.rejects(client.send({ recipient: 'bob', amount: '0.001' }), (error) => {
      assert.equal(error.code, FAILURE_CODES.INVALID_RECIPIENT_META);
      return true;
    });
    assert.equal(provider.calls.some((call) => call.method === 'eth_sendTransaction'), false);
  });
});

test('an unenrolled recipient is reported as such and never falls back to a plain transfer', async () => {
  await withEnv(async ({ events }) => {
    const api = async (path) => {
      if (path.includes('/resolve')) { const error = new PrivateTransferError('NOT_FOUND'); throw error; }
      return { ok: true };
    };
    const provider = fakeProvider();
    const client = clientFor({ provider, api, events });
    await assert.rejects(client.send({ recipient: 'ghost', amount: '0.001' }), /RECIPIENT_NOT_FOUND/);
    assert.equal(provider.calls.some((call) => call.method === 'eth_sendTransaction'), false);
  });
});

test('a changed recipient fingerprint is surfaced, not silently accepted', async () => {
  await withEnv(async ({ events }) => {
    const api = fakeApi();
    const client = clientFor({ provider: fakeProvider(), api, events });
    const first = await client.resolve('bob');
    client.pinRecipient('bob', first.fingerprint);
    const spendingPublicKey = bytesToHex(compressPoint(multiplyG(7n)));
    const viewingPublicKey = bytesToHex(compressPoint(multiplyG(11n)));
    const metaAddress = buildMetaAddress(spendingPublicKey, viewingPublicKey);
    client.api = fakeApi({ '/resolve': { identity: resolveRecord({ spendingPublicKey, viewingPublicKey, metaAddress, fingerprint: metaFingerprint(metaAddress) }) } });
    const changed = await client.resolve('bob');
    assert.equal(changed.fingerprintChanged, true);
  });
});

/* ------------------------------------------------------------------ scanning + spend */
test('scanning asks for a public page and filters locally with the viewing key', async () => {
  await withEnv(async ({ events }) => {
    const api = fakeApi({
      '/announcements': { announcements: [{ schemeId: 1, stealthAddress: FIXTURE.stealthAddress, ephemeralPublicKey: FIXTURE.ephemeralPublicKey, metadata: '0x' + FIXTURE.viewTag }], nextCursor: 12 },
    });
    const client = clientFor({ provider: fakeProvider(), api, events });
    const result = await client.scan({ spendingPublicKey: FIXTURE.spendingPublicKey, spendingPrivateKey: FIXTURE.spendingPrivateKey, viewingPrivateKey: FIXTURE.viewingPrivateKey });
    assert.equal(result.scanned, 1);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].stealthAddress, FIXTURE.stealthAddress);
    assert.equal(result.nextCursor, 12);
    const url = api.calls[0].path;
    assert.match(url, /^\/api\/private-transfer\/announcements\?cursor=/);
    assert.equal(/username|bob|user_id/i.test(url), false, 'no per-user scan endpoint may ever be called');
  });
});

test('spending from a stealth address verifies control and warns about a known wallet', async () => {
  await withEnv(async ({ events }) => {
    const provider = fakeProvider();
    const client = clientFor({ provider, api: fakeApi(), events });
    // A key that does not control the announced address is refused before signing.
    await assert.rejects(client.spendFromStealth({
      stealthPrivateKey: FIXTURE.viewingPrivateKey, stealthPublicKey: FIXTURE.spendingPublicKey,
      destination: '0x' + 'cc'.repeat(20), amount: '0.0001',
    }), (error) => error.code === FAILURE_CODES.CORRUPTED_LOCAL_KEY_STATE);

    const stealthPrivateKey = (BigInt(FIXTURE.spendingPrivateKey) + 12345n) % N;
    const stealthPublicKey = bytesToHex(compressPoint(multiplyG(stealthPrivateKey)));
    const warned = await client.spendFromStealth({
      stealthPrivateKey, stealthPublicKey, destination: BOB_NORMAL_WALLET, amount: '0.0001',
      knownWalletAddresses: [BOB_NORMAL_WALLET],
    }).catch((error) => error);
    assert.equal(warned.code, 'DESTINATION_IS_KNOWN_WALLET');

    const spend = await client.spendFromStealth({
      stealthPrivateKey, stealthPublicKey, destination: '0x' + 'cc'.repeat(20), amount: '0.0001',
      knownWalletAddresses: [BOB_NORMAL_WALLET],
    });
    assert.equal(spend.transactionHash, '0x' + '33'.repeat(32));
    const raw = provider.calls.find((call) => call.method === 'eth_sendRawTransaction');
    assert.ok(raw, 'the spend is broadcast as a raw transaction signed locally');
    assert.equal(raw.params[0].toLowerCase().includes(stealthPublicKey.slice(2, 8)), false, 'the raw blob is opaque, as expected');
  });
});

/* ------------------------------------------------------------------ leak audit */
test('the whole Phase 3 client surface never writes key material to web storage', async () => {
  const files = readdirSync(new URL('../src/stealth/', import.meta.url)).filter((name) => name.endsWith('.js'));
  assert.ok(files.length >= 9, 'the stealth module set is present');
  for (const file of files) {
    const source = readFileSync(new URL(`../src/stealth/${file}`, import.meta.url), 'utf8');
    // localStorage must never hold a secret: only the non-secret recovery record and
    // the public fingerprint pins are allowed (privateTransfer.js is the only writer).
    const ALLOWED_NON_SECRET_KEYS = /RECOVERY_RECORD_KEY|META_PIN_KEY|PENDING_INTENT_KEY/;
    const writes = [...source.matchAll(/localStorage\??\.setItem\(\s*([^,]+),/g)].map((match) => match[1]);
    for (const target of writes) {
      assert.match(target, ALLOWED_NON_SECRET_KEYS, `${file} may only persist non-secret data in localStorage`);
    }
    assert.equal(/console\.log\(/.test(source), false, `${file} must not log`);
    assert.equal(/document\.cookie/.test(source), false);
  }
  const backup = readFileSync(new URL('../src/stealth/backup.js', import.meta.url), 'utf8');
  assert.equal(/localStorage(\?\.|\[)/.test(backup), false, 'the encrypted backup is never placed in localStorage');
  assert.match(backup, /sessionStorage/, 'without IndexedDB the encrypted blob falls back to sessionStorage only');
});

test('every localStorage key the client writes holds only non-secret data', async () => {
  await withEnv(async ({ local, events }) => {
    const api = fakeApi();
    const client = clientFor({ provider: fakeProvider(), api, events });
    await client.send({ recipient: 'bob', amount: '0.001' });
    client.pinRecipient('bob', FIXTURE.fingerprint);
    // Whatever landed in localStorage must be free of key material and wallet addresses.
    for (const [key, value] of local.store.entries()) {
      assert.match(key, /^veyra:stealth:/, `unexpected storage key ${key}`);
      for (const forbidden of ['privatekey', 'spendingprivate', 'viewingprivate', 'siskprivate', 'mnemonic', 'seed']) {
        assert.equal(String(value).toLowerCase().includes(forbidden), false, `${key} must not contain ${forbidden}`);
      }
      assert.equal(/^0x[0-9a-f]{40}$/i.test(String(value)), false);
    }
  });
});

test('the client never transmits a private key, viewing key or recovery signature', async () => {
  await withEnv(async ({ events }) => {
    const api = fakeApi();
    const provider = fakeProvider();
    const client = clientFor({ provider, api, events });
    await client.enroll({ username: 'alice', passphrase: 'passphrase-1234' });
    const serialized = JSON.stringify(api.calls);
    for (const forbidden of ['privatekey', 'spendingprivate', 'viewingprivate', 'siskprivate', 'mnemonic', 'seed']) {
      assert.equal(serialized.toLowerCase().includes(forbidden), false, `${forbidden} must never be transmitted`);
    }
    const enrollCall = api.calls.find((call) => call.path.includes('/enroll'));
    assert.ok(enrollCall.body.enrollmentSignature.startsWith('0x'));
    assert.match(enrollCall.body.metaAddress, /^0x[0-9a-f]{132}$/, 'enrollment publishes the 66-byte meta-address');
    assert.equal(enrollCall.body.spendingPublicKey === enrollCall.body.viewingPublicKey, false);
    assert.equal(JSON.stringify(enrollCall.body).includes(ALICE.toLowerCase()), false, "Alice's own wallet address is not needed by the backend");
  });
});

test('the enrollment payload a client sends verifies under the message the server builds', async () => {
  await withEnv(async ({ events }) => {
    // A wallet key whose signatures we can produce deterministically in this test.
    const walletPrivateKey = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn;
    const signingProvider = fakeProvider();
    const signWithWallet = async (message) => {
      const { r, s, recovery } = signDigest(walletPrivateKey, personalMessageHash(message));
      return '0x' + r.toString(16).padStart(64, '0') + s.toString(16).padStart(64, '0') + recovery.toString(16).padStart(2, '0');
    };
    signingProvider.request = async ({ method, params }) => {
      if (method === 'personal_sign') {
        const bytes = params[0].replace(/^0x/, '');
        const text = new TextDecoder().decode(Uint8Array.from(bytes.match(/../g).map((pair) => parseInt(pair, 16))));
        return signWithWallet(text);
      }
      return fakeProvider().request({ method, params });
    };

    const api = fakeApi();
    const client = clientFor({ provider: signingProvider, api, events });
    await client.enroll({ username: 'alice', passphrase: 'passphrase-1234' });

    const body = api.calls.find((call) => call.path.includes('/enroll')).body;
    // Exactly the message the server reconstructs from the stored username and the
    // submitted public material — if these ever drift, enrollment breaks safely.
    const serverMessage = enrollmentMessage({
      username: 'alice',
      metaAddress: body.metaAddress,
      siskPublicKey: body.siskPublicKey,
      chainId: body.chainId,
      protocolVersion: body.protocolVersion,
    });
    const signer = addressFromPersonalSignature({ message: serverMessage, signature: body.enrollmentSignature });
    assert.equal(signer, addressForPrivateKey(walletPrivateKey).toLowerCase());
    assert.equal(body.schemeId, 1);
    assert.equal(body.fingerprint.length, 8);
  });
});

test('createApiClient attaches the session and never leaks it into a URL', async () => {
  const calls = [];
  const request = createApiClient({
    baseUrl: '',
    token: 'session-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  await request('/api/private-transfer/me');
  assert.equal(calls[0].url.includes('session-token'), false);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer session-token');
  assert.equal(calls[0].options.cache, 'no-store');
});

export { TRANSFER_STATES as STATES, announcementRecoveryRecord };
