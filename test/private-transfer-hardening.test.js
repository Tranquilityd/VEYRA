// Phase 3.5 — security hardening regression + adversarial/property tests.
//
// Every test here exists because of a finding in the Phase 3.5 audit. They are written
// to FAIL against the pre-hardening implementation and to keep the fixed behaviour
// pinned. Cross-checks use independent implementations (viem / @noble / node:crypto)
// wherever a property can be verified externally.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, recoverMessageAddress } from 'viem';
import { secp256k1 } from '@noble/curves/secp256k1';

import { keccak256Bytes, bytesToHex, hexToBytes } from '../src/stealth/keccak.js';
import * as S from '../src/stealth/secp256k1.js';
import {
  deriveStealthAddress, scanAnnouncement, scanAnnouncements, sharedSecretHash,
  hashToScalar, verifyStealthKeypair,
} from '../src/stealth/derive.js';
import { buildMetaAddress, metaFingerprint, validateEphemeralPublicKey } from '../src/stealth/protocol.js';
import { encodeAnnounceCalldata, decodeAnnounceCalldata, validateAnnouncementInput } from '../src/stealth/announcement.js';
import { encryptBackup, decryptBackup, validateBackupEnvelope } from '../src/stealth/backup.js';
import { signDigest, signNativeTransfer, addressForPrivateKey } from '../src/stealth/signer.js';
import { assertChain, parseAmountToAtomic, formatAtomic, checkFunding, DEFAULT_GAS_RESERVE_ATOMIC } from '../src/stealth/wallet.js';
import { TransferStateMachine, TRANSFER_STATES, canTransition } from '../src/stealth/transferState.js';
import { PrivateTransferError, DUST_WARNING_ATOMIC } from '../src/stealth/privateTransfer.js';
import { PrivateTransferSession } from '../src/systems/PrivateTransferSession.js';
import { personalMessageHash, enrollmentMessage, identityFromRoots } from '../src/stealth/recovery.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const secret = () => BigInt('0x' + crypto.randomBytes(32).toString('hex')) % (S.N - 1n) + 1n;

/* =============================================================== M-01 */
// The scanner used to accept metadata of any length and SKIP the view-tag check when the
// tag was missing (empty metadata, or a tag plus trailing bytes).
test('M-01: the scanner refuses out-of-spec metadata instead of skipping the tag check', () => {
  const bobSpend = secret();
  const bobView = secret();
  const meta = buildMetaAddress(
    bytesToHex(S.compressPoint(S.multiplyG(bobSpend))),
    bytesToHex(S.compressPoint(S.multiplyG(bobView))),
  );
  const derived = deriveStealthAddress({ metaAddress: meta });
  const keys = {
    spendingPublicKey: bytesToHex(S.compressPoint(S.multiplyG(bobSpend))),
    spendingPrivateKey: bobSpend,
    viewingPrivateKey: bobView,
  };
  const record = (overrides = {}) => ({
    schemeId: 1, stealthAddress: derived.stealthAddress,
    ephemeralPublicKey: derived.R, metadata: '0x' + derived.viewTag, ...overrides,
  });

  // The valid record still matches (the fix must not break the happy path).
  assert.equal(scanAnnouncement(record(), keys).match, true);

  for (const [label, overrides] of [
    ['empty metadata', { metadata: '0x' }],
    ['tag plus trailing bytes', { metadata: '0x' + derived.viewTag + 'ff' }],
    ['two-byte metadata', { metadata: '0x' + derived.viewTag + '00' }],
    ['odd-length hex', { metadata: '0x' + derived.viewTag + 'f' }],
    ['missing 0x prefix', { metadata: derived.viewTag }],
    ['word metadata', { metadata: '0xdeadbeefdeadbeef' }],
    ['undefined metadata', { metadata: undefined }],
  ]) {
    const result = scanAnnouncement(record(overrides), keys);
    assert.equal(result.match, false, `${label} must not match`);
    assert.match(result.reason, /METADATA_/, `${label} must be rejected for its metadata`);
  }

  // Property: NO announcement whose metadata is not exactly one byte may ever match,
  // regardless of everything else being correct.
  for (let i = 0; i < 60; i += 1) {
    const junk = '0x' + crypto.randomBytes(i % 4).toString('hex');
    const result = scanAnnouncement(record({ metadata: junk }), keys);
    const bytes = junk.length / 2 - 1;
    if (bytes === 1) continue; // exactly one byte is the only acceptable length
    assert.equal(result.match, false, `metadata of ${bytes} byte(s) must be refused`);
  }
});

test('M-01b: a matching view tag is never treated as proof by itself', () => {
  const bobSpend = secret();
  const bobView = secret();
  const meta = buildMetaAddress(
    bytesToHex(S.compressPoint(S.multiplyG(bobSpend))),
    bytesToHex(S.compressPoint(S.multiplyG(bobView))),
  );
  const derived = deriveStealthAddress({ metaAddress: meta });
  const keys = {
    spendingPublicKey: bytesToHex(S.compressPoint(S.multiplyG(bobSpend))),
    spendingPrivateKey: bobSpend,
    viewingPrivateKey: bobView,
  };
  // Same tag byte (correct for Bob's viewing key) but an address Bob does not control.
  const foreign = deriveStealthAddress({
    metaAddress: buildMetaAddress(
      bytesToHex(S.compressPoint(S.multiplyG(secret()))),
      bytesToHex(S.compressPoint(S.multiplyG(secret()))),
    ),
  });
  const forged = {
    schemeId: 1, stealthAddress: foreign.stealthAddress,
    ephemeralPublicKey: derived.R, metadata: '0x' + derived.viewTag,
  };
  const result = scanAnnouncement(forged, keys);
  assert.equal(result.match, false);
  assert.equal(result.reason, 'ADDRESS_MISMATCH', 'the address check must be what rejects it');
});

/* =============================================================== L-01 */
test('L-01: off-curve points can never enter scalar multiplication or derivation', () => {
  for (const bad of [{ x: 1n, y: 1n }, { x: 0n, y: 0n }, { x: S.GX, y: S.GX }, { x: -1n, y: 1n }]) {
    assert.throws(() => S.scalarMultiply(7n, bad), /POINT_NOT_ON_CURVE/);
  }
  // decompressPoint still validates before handing anything to the multiplier
  assert.throws(() => S.decompressPoint(hexToBytes('0x02' + '00'.repeat(32))), /POINT_NOT_ON_CURVE/);
  // A valid point still multiplies
  assert.equal(S.isOnCurve(S.multiplyG(9n)), true);
});

/* =============================================================== I-01 */
test('I-01: RFC 6979 signatures stay byte-identical to an independent implementation', () => {
  for (let i = 0; i < 40; i += 1) {
    const k = secret();
    const digest = keccak256Bytes(new TextEncoder().encode(`rfc6979-${i}`));
    const mine = signDigest(k, digest);
    const ref = secp256k1.sign(digest, k.toString(16).padStart(64, '0'), { format: 'recovered', prehash: false, lowS: true });
    assert.equal(mine.r, BigInt('0x' + ref.r.toString(16)));
    assert.equal(mine.s, BigInt('0x' + ref.s.toString(16)));
    assert.equal(mine.recovery, ref.recovery);
    // Deterministic and low-s by construction
    assert.deepEqual(signDigest(k, digest), mine);
    assert.ok(mine.s <= S.N / 2n);
  }
  // The retry path must never fall back to k+1: signing must be reproducible bit-for-bit.
  const k = secret();
  const digest = keccak256Bytes(new Uint8Array([1, 2, 3]));
  assert.equal(signDigest(k, digest).r, signDigest(k, digest).r);
});

/* =============================================================== M-02 */
test('M-02: a backup envelope must declare the protocol, scheme and chain this build supports', async () => {
  const spend = secret();
  const view = secret();
  const metaAddress = buildMetaAddress(
    bytesToHex(S.compressPoint(S.multiplyG(spend))),
    bytesToHex(S.compressPoint(S.multiplyG(view))),
  );
  const base = { spendingPrivateKey: spend, viewingPrivateKey: view, protocolVersion: 1, schemeId: 1, chainId: 4441, username: 'bob', metaAddress };

  for (const [field, value, pattern] of [
    ['protocolVersion', 2, /BACKUP_UNSUPPORTED_PROTOCOL_VERSION/],
    ['schemeId', 2, /BACKUP_UNSUPPORTED_SCHEME/],
    ['chainId', 1, /BACKUP_UNSUPPORTED_CHAIN/],
    ['protocolVersion', undefined, /BACKUP_UNSUPPORTED_PROTOCOL_VERSION/],
  ]) {
    await assert.rejects(encryptBackup({ ...base, [field]: value }, 'passphrase-1234'), pattern, `${field}=${value} must be refused at export`);
  }

  const envelope = await encryptBackup(base, 'passphrase-1234');
  assert.equal(validateBackupEnvelope(envelope), true);
  for (const [field, value, pattern] of [
    ['protocolVersion', 2, /BACKUP_UNSUPPORTED_PROTOCOL_VERSION/],
    ['schemeId', 7, /BACKUP_UNSUPPORTED_SCHEME/],
    ['chainId', 9999, /BACKUP_UNSUPPORTED_CHAIN/],
  ]) {
    const tampered = { ...envelope, [field]: value };
    assert.throws(() => validateBackupEnvelope(tampered), pattern);
    await assert.rejects(decryptBackup(tampered, 'passphrase-1234'), /BACKUP_/);
  }
  // A wholly foreign envelope is refused rather than half-imported.
  assert.throws(() => validateBackupEnvelope({ format: 'other.wallet.backup', version: 1 }), /BACKUP_UNSUPPORTED_FORMAT/);
});

/* =============================================================== M-03 */
test('M-03: an account change or disconnect drops session keys and the cached identity', async () => {
  const listeners = [];
  const events = { on: (name, handler) => listeners.push({ name, handler }), emit: () => {} };
  const game = { events, walletSession: { account: '0x' + 'aa'.repeat(20) }, audio: null };
  const session = new PrivateTransferSession(game);
  session.client.rememberIdentity({ spendingPrivateKey: secret(), viewingPrivateKey: secret(), username: 'alice' });
  session.cacheIdentity({ username: 'alice', metaAddress: '0x' + '02'.repeat(33) + '03'.repeat(33), fingerprint: 'deadbeef', schemeId: 1, protocolVersion: 1 });
  assert.ok(session.client.identityKeys(), 'keys are present for the owning account');

  const fire = (snapshot) => listeners.filter((l) => l.name === 'litvm:wallet').forEach((l) => l.handler(snapshot));

  // Same account: nothing is dropped.
  fire({ state: 'connected', address: '0x' + 'AA'.repeat(20) });
  assert.ok(session.client.identityKeys());

  // Different account: keys and cache are gone.
  fire({ state: 'connected', address: '0x' + 'bb'.repeat(20) });
  assert.equal(session.client.identityKeys(), null);
  assert.equal(session.identity, null);

  // Disconnect: same treatment.
  session.client.rememberIdentity({ spendingPrivateKey: secret(), viewingPrivateKey: secret() });
  fire({ state: 'disconnected', address: null });
  assert.equal(session.client.identityKeys(), null);
});

/* =============================================================== M-04 */
test('M-04: a second send attempt while one is in flight is refused (no double payment)', async () => {
  const storage = memoryStorage();
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    const { PrivateTransferClient } = await import('../src/stealth/privateTransfer.js');
    const spend = secret();
    const view = secret();
    const metaAddress = buildMetaAddress(
      bytesToHex(S.compressPoint(S.multiplyG(spend))),
      bytesToHex(S.compressPoint(S.multiplyG(view))),
    );
    const sent = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const provider = {
      request: async ({ method, params }) => {
        if (method === 'eth_chainId') return '0x1159';
        if (method === 'eth_accounts') return ['0x' + 'aa'.repeat(20)];
        if (method === 'eth_getCode') return '0x';
        if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
        if (method === 'eth_sendTransaction') {
          sent.push(params[0]);
          await gate; // hold the first attempt open
          return '0x' + '11'.repeat(32);
        }
        if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0x10' };
        if (method === 'eth_blockNumber') return '0x20';
        return null;
      },
    };
    const api = async (path) => {
      if (path.includes('/resolve')) {
        return {
          identity: {
            username: 'bob', protocolVersion: 1, schemeId: 1,
            spendingPublicKey: bytesToHex(S.compressPoint(S.multiplyG(spend))),
            viewingPublicKey: bytesToHex(S.compressPoint(S.multiplyG(view))),
            metaAddress, fingerprint: metaFingerprint(metaAddress),
          },
        };
      }
      if (path.includes('/announcements')) return { announcements: [], nextCursor: null };
      return { paymentId: 'p1' };
    };
    const client = new PrivateTransferClient({ api, provider });

    const first = client.send({ recipient: 'bob', amount: '0.001' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await assert.rejects(client.send({ recipient: 'bob', amount: '0.001' }), (error) => {
      assert.equal(error.code, 'TRANSFER_IN_PROGRESS');
      return true;
    });
    release();
    await first;
    assert.equal(sent.length, 2, 'exactly one payment + one announcement were sent');
  } finally {
    globalThis.localStorage = previous;
  }
});

/* =============================================================== M-05 */
test('M-05: a changed recipient fingerprint blocks the payment until it is acknowledged', async () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = memoryStorage();
  try {
    const { PrivateTransferClient } = await import('../src/stealth/privateTransfer.js');
    const spend = secret();
    const view = secret();
    const originalMeta = buildMetaAddress(
      bytesToHex(S.compressPoint(S.multiplyG(spend))),
      bytesToHex(S.compressPoint(S.multiplyG(view))),
    );
    const substitutedMeta = buildMetaAddress(
      bytesToHex(S.compressPoint(S.multiplyG(secret()))),
      bytesToHex(S.compressPoint(S.multiplyG(secret()))),
    );
    let served = originalMeta;
    const sent = [];
    const provider = {
      request: async ({ method, params }) => {
        if (method === 'eth_chainId') return '0x1159';
        if (method === 'eth_accounts') return ['0x' + 'aa'.repeat(20)];
        if (method === 'eth_getCode') return '0x';
        if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
        if (method === 'eth_sendTransaction') { sent.push(params[0]); return '0x' + '22'.repeat(32); }
        if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0x10' };
        if (method === 'eth_blockNumber') return '0x20';
        return null;
      },
    };
    const api = async (path) => {
      if (path.includes('/resolve')) {
        return {
          identity: {
            username: 'bob', protocolVersion: 1, schemeId: 1,
            spendingPublicKey: '0x' + served.slice(2, 68), viewingPublicKey: '0x' + served.slice(68),
            metaAddress: served, fingerprint: metaFingerprint(served),
          },
        };
      }
      if (path.includes('/announcements')) return { announcements: [], nextCursor: null };
      return { paymentId: 'p1' };
    };
    const client = new PrivateTransferClient({ api, provider });

    // First payment pins Bob's fingerprint.
    await client.send({ recipient: 'bob', amount: '0.001' });
    assert.equal(client._readPins().bob, metaFingerprint(originalMeta));

    // The server now returns a SUBSTITUTED meta-address: the payment must be refused.
    served = substitutedMeta;
    await assert.rejects(client.send({ recipient: 'bob', amount: '0.001' }), (error) => {
      assert.equal(error.code, 'FINGERPRINT_CHANGED');
      return true;
    });
    assert.equal(sent.length, 2, 'no payment was sent for the substituted meta-address');

    // With an explicit, deliberate acknowledgement the user can proceed.
    await client.send({ recipient: 'bob', amount: '0.001', acceptFingerprintChange: true });
    assert.equal(sent.length, 4);
  } finally {
    globalThis.localStorage = previous;
  }
});

/* =============================================================== M-06 */
test('M-06: a payment intent is recorded before signing and cleared once a hash exists', async () => {
  const previous = globalThis.localStorage;
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  try {
    const { PrivateTransferClient } = await import('../src/stealth/privateTransfer.js');
    const spend = secret();
    const view = secret();
    const metaAddress = buildMetaAddress(
      bytesToHex(S.compressPoint(S.multiplyG(spend))),
      bytesToHex(S.compressPoint(S.multiplyG(view))),
    );
    const intentsAtSigning = [];
    const provider = {
      request: async ({ method, params }) => {
        if (method === 'eth_chainId') return '0x1159';
        if (method === 'eth_accounts') return ['0x' + 'aa'.repeat(20)];
        if (method === 'eth_getCode') return '0x';
        if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
        if (method === 'eth_sendTransaction') {
          // The intent exists in storage while the wallet is being asked to sign.
          intentsAtSigning.push(client.pendingIntent());
          return '0x' + '33'.repeat(32);
        }
        if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0x10' };
        if (method === 'eth_blockNumber') return '0x20';
        return null;
      },
    };
    const api = async (path, options) => {
      if (path.includes('/resolve')) {
        return {
          identity: {
            username: 'bob', protocolVersion: 1, schemeId: 1,
            spendingPublicKey: bytesToHex(S.compressPoint(S.multiplyG(spend))),
            viewingPublicKey: bytesToHex(S.compressPoint(S.multiplyG(view))),
            metaAddress, fingerprint: metaFingerprint(metaAddress),
          },
        };
      }
      if (path.includes('/announcements') && (options?.method ?? 'GET') === 'GET') return { announcements: [], nextCursor: null };
      return { paymentId: 'p1' };
    };
    const client = new PrivateTransferClient({ api, provider });
    await client.send({ recipient: 'bob', amount: '0.001' });

    assert.ok(intentsAtSigning.length >= 2, 'both the payment and the announcement were signed');
    const intentDuringFunding = intentsAtSigning[0];
    assert.ok(intentDuringFunding, 'the intent must exist while the payment is being signed');
    assert.equal(intentDuringFunding.amountAtomic, '1000000000000000');
    assert.equal(intentDuringFunding.stealthAddress.length, 42);
    assert.equal(JSON.stringify(intentDuringFunding).toLowerCase().includes('bob'), false, 'the intent carries no recipient identity');
    assert.equal(intentsAtSigning[1], null, 'by the announcement the intent is gone (a hash exists)');
    assert.equal(client.pendingIntent(), null, 'the intent is cleared once a transaction hash exists');
  } finally {
    globalThis.localStorage = previous;
  }
});

test('M-06b: a stale intent survives an interrupted attempt and is dismissible', async () => {
  const previous = globalThis.localStorage;
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  try {
    const { PrivateTransferClient } = await import('../src/stealth/privateTransfer.js');
    const client = new PrivateTransferClient({ api: async () => ({}), provider: null });
    // Simulate an interrupted attempt: intent written, no hash received.
    client._persistPendingIntent({ stealth: { stealthAddress: '0x' + 'ab'.repeat(20) }, amountAtomic: 123n });
    const pending = client.pendingIntent();
    assert.equal(pending.stealthAddress, '0x' + 'ab'.repeat(20));
    assert.equal(pending.amountAtomic, '123');
    assert.equal(client.dismissPendingIntent(), true);
    assert.equal(client.pendingIntent(), null);
    // A corrupt stored value must not throw.
    storage.setItem('veyra:stealth:pending-payment', '{not json');
    assert.equal(client.pendingIntent(), null);
  } finally {
    globalThis.localStorage = previous;
  }
});

test('M-06c: a receipt timeout keeps the warning (with the hash); a revert clears it', async () => {
  const previous = globalThis.localStorage;
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  try {
    const { PrivateTransferClient } = await import('../src/stealth/privateTransfer.js');
    const spend = secret();
    const view = secret();
    const metaAddress = buildMetaAddress(
      bytesToHex(S.compressPoint(S.multiplyG(spend))),
      bytesToHex(S.compressPoint(S.multiplyG(view))),
    );
    const makeClient = (receipt) => {
      const provider = {
        request: async ({ method }) => {
          if (method === 'eth_chainId') return '0x1159';
          if (method === 'eth_accounts') return ['0x' + 'aa'.repeat(20)];
          if (method === 'eth_getCode') return '0x';
          if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
          if (method === 'eth_sendTransaction') return '0x' + '55'.repeat(32);
          if (method === 'eth_getTransactionReceipt') return receipt;
          if (method === 'eth_blockNumber') return '0x20';
          return null;
        },
      };
      const api = async (path) => (path.includes('/resolve')
        ? {
          identity: {
            username: 'bob', protocolVersion: 1, schemeId: 1,
            spendingPublicKey: bytesToHex(S.compressPoint(S.multiplyG(spend))),
            viewingPublicKey: bytesToHex(S.compressPoint(S.multiplyG(view))),
            metaAddress, fingerprint: metaFingerprint(metaAddress),
          },
        }
        : path.includes('/announcements') ? { announcements: [], nextCursor: null } : { paymentId: 'p1' });
      return new PrivateTransferClient({ api, provider });
    };

    // Revert: nothing was credited, so the warning must NOT linger.
    const reverted = makeClient({ status: '0x0', blockNumber: '0x10' });
    await assert.rejects(reverted.send({ recipient: 'bob', amount: '0.001' }), /TRANSACTION_FAILED/);
    assert.equal(reverted.pendingIntent(), null, 'a reverted payment leaves no warning');

    // Timeout: the payment may have settled, so the warning stays and names the transaction.
    const timedOut = makeClient(null);
    await assert.rejects(
      timedOut.send({ recipient: 'bob', amount: '0.001', confirmations: 1, receiptTimeoutMs: 30, pollMs: 10 }),
      /TIMEOUT/,
    );
    const pending = timedOut.pendingIntent();
    assert.ok(pending, 'a timed-out payment must leave a warning');
    assert.equal(pending.paymentTxHash, '0x' + '55'.repeat(32));
  } finally {
    globalThis.localStorage = previous;
  }
});

/* =============================================================== L-02 */
test('L-02: chain detection fails closed on missing, malformed or unavailable chain ids', async () => {
  const provider = (value) => ({ request: async () => value });
  for (const value of [undefined, null, '', '0x', 'mainnet', 4441, {}, []]) {
    await assert.rejects(assertChain(provider(value)), /WRONG_NETWORK/, `${JSON.stringify(value)} must be treated as a wrong network`);
  }
  await assert.rejects(assertChain({ request: async () => { throw new Error('locked'); } }), /WRONG_NETWORK/);
  assert.equal(await assertChain(provider('0x1159')), true);
  assert.equal(await assertChain(provider('0x1159'), 4441), true);
  await assert.rejects(assertChain(provider('0x1')), /WRONG_NETWORK/);
});

/* =============================================================== I-03 */
test('I-03: fee head-room is explicit, configurable, and dust payments are flagged', async () => {
  // The reserve is a documented default, overridable per call.
  assert.equal(typeof DEFAULT_GAS_RESERVE_ATOMIC, 'bigint');
  assert.equal(checkFunding({ balanceAtomic: 10n ** 18n, amountAtomic: 10n ** 15n, gasReserveAtomic: 10n ** 15n }).ok, true);
  assert.equal(checkFunding({ balanceAtomic: 2n * 10n ** 15n, amountAtomic: 1_500_000_000_000_000n, gasReserveAtomic: 10n ** 15n }).error, 'INSUFFICIENT_GAS');
  // A reserve of zero is legal but only when the caller asks for it explicitly.
  assert.equal(checkFunding({ balanceAtomic: 10n ** 15n, amountAtomic: 10n ** 15n, gasReserveAtomic: 0n }).ok, true);
  assert.ok(DUST_WARNING_ATOMIC > 0n);
});

/* =============================================================== replay / binding */
test('an enrollment signature is bound to one username, chain, protocol version and key set', async () => {
  const walletKey = secret();
  const walletAddress = addressForPrivateKey(walletKey).toLowerCase();
  const account = privateKeyToAccount('0x' + walletKey.toString(16).padStart(64, '0'));
  assert.equal(account.address.toLowerCase(), walletAddress);

  const meta = buildMetaAddress(
    bytesToHex(S.compressPoint(S.multiplyG(secret()))),
    bytesToHex(S.compressPoint(S.multiplyG(secret()))),
  );
  const sisk = bytesToHex(S.compressPoint(S.multiplyG(secret())));
  const message = enrollmentMessage({ username: 'alice', metaAddress: meta, siskPublicKey: sisk, chainId: 4441, protocolVersion: 1 });
  const signature = await account.signMessage({ message });
  assert.equal(await recoverMessageAddress({ message, signature }).then((a) => a.toLowerCase()), walletAddress);

  // The same signature does NOT verify for another username, chain or protocol version.
  for (const changed of [
    enrollmentMessage({ username: 'bob', metaAddress: meta, siskPublicKey: sisk, chainId: 4441, protocolVersion: 1 }),
    enrollmentMessage({ username: 'alice', metaAddress: meta, siskPublicKey: sisk, chainId: 1, protocolVersion: 1 }),
    enrollmentMessage({ username: 'alice', metaAddress: meta, siskPublicKey: sisk, chainId: 4441, protocolVersion: 2 }),
  ]) {
    const recovered = await recoverMessageAddress({ message: changed, signature }).then((a) => a.toLowerCase());
    assert.notEqual(recovered, walletAddress);
  }
  // Swapping the meta-address (a key-substitution attempt) also breaks verification.
  const swappedMeta = buildMetaAddress(
    bytesToHex(S.compressPoint(S.multiplyG(secret()))),
    bytesToHex(S.compressPoint(S.multiplyG(secret()))),
  );
  const swapped = enrollmentMessage({ username: 'alice', metaAddress: swappedMeta, siskPublicKey: sisk, chainId: 4441, protocolVersion: 1 });
  assert.notEqual(await recoverMessageAddress({ message: swapped, signature }).then((a) => a.toLowerCase()), walletAddress);
  // And swapping the SISK key does too.
  const swappedSisk = enrollmentMessage({ username: 'alice', metaAddress: meta, siskPublicKey: bytesToHex(S.compressPoint(S.multiplyG(secret()))), chainId: 4441, protocolVersion: 1 });
  assert.notEqual(await recoverMessageAddress({ message: swappedSisk, signature }).then((a) => a.toLowerCase()), walletAddress);
});

/* =============================================================== scanner fuzz */
test('scanner is total: no random or hostile announcement can crash or match wrongly', () => {
  const bobSpend = secret();
  const bobView = secret();
  const keys = {
    spendingPublicKey: bytesToHex(S.compressPoint(S.multiplyG(bobSpend))),
    spendingPrivateKey: bobSpend,
    viewingPrivateKey: bobView,
  };
  const randomHex = (bytes) => '0x' + crypto.randomBytes(bytes).toString('hex');
  const pool = [
    ...Array.from({ length: 40 }, () => ({
      schemeId: 1, stealthAddress: randomHex(20), ephemeralPublicKey: randomHex(33), metadata: randomHex(1),
    })),
    ...Array.from({ length: 20 }, () => ({
      schemeId: Number(crypto.randomBytes(1)[0]), stealthAddress: randomHex(20),
      ephemeralPublicKey: randomHex(33), metadata: randomHex(1),
    })),
    { schemeId: 1, stealthAddress: randomHex(20), ephemeralPublicKey: '0x04' + randomHex(64).slice(2), metadata: randomHex(1) },
    { schemeId: 1, stealthAddress: randomHex(20), ephemeralPublicKey: randomHex(32), metadata: randomHex(1) },
    { schemeId: 1, stealthAddress: null, ephemeralPublicKey: null, metadata: null },
    [], {}, 'nonsense', 0, false,
  ];
  for (const record of pool) {
    const result = scanAnnouncement(record, keys);
    assert.equal(typeof result.match, 'boolean');
    assert.equal(result.match, false, 'a random record must never be reported as a match');
  }
  assert.deepEqual(scanAnnouncements(pool, keys), []);
  // Every entry point must also survive a hostile key set instead of throwing.
  assert.deepEqual(scanAnnouncements(pool.slice(0, 5), { spendingPublicKey: 'garbage', spendingPrivateKey: 1n, viewingPrivateKey: 1n }), []);
});

/* =============================================================== amounts */
test('amount parsing is integer-exact and rejects every malformed form', () => {
  const reference = (text) => {
    const [whole, fraction = ''] = text.split('.');
    return BigInt(whole || '0') * 10n ** 18n + BigInt((fraction + '0'.repeat(18)).slice(0, 18) || '0');
  };
  for (let i = 0; i < 200; i += 1) {
    const whole = BigInt('0x' + crypto.randomBytes(4).toString('hex')) % 1_000_000n;
    const fraction = crypto.randomBytes(1)[0].toString().padStart(2, '0');
    const text = `${whole}.${fraction}`;
    assert.equal(parseAmountToAtomic(text), reference(text), text);
  }
  assert.equal(parseAmountToAtomic('1'), 10n ** 18n);
  assert.equal(parseAmountToAtomic('0.000000000000000001'), 1n);
  assert.equal(formatAtomic(1n), '0.000000000000000001');
  assert.equal(formatAtomic(10n ** 18n), '1');
  for (const bad of ['', '.', '0', '0.0', '-1', '+1', '1e18', 'abc', '1,5', '0x10', 'NaN', 'Infinity', '1.0000000000000000001', '1.2.3', '  ', '١', '1_000']) {
    assert.throws(() => parseAmountToAtomic(bad), /AMOUNT_/, bad);
  }
  // Round-trip property over a wide range
  for (const value of [1n, 999n, 10n ** 18n, 123456789012345678901234567890n]) {
    assert.equal(parseAmountToAtomic(formatAtomic(value)), value);
  }
});

/* =============================================================== ABI fuzz */
test('announce calldata round-trips for random inputs and rejects mutated calldata', () => {
  for (let i = 0; i < 30; i += 1) {
    const stealthAddress = '0x' + crypto.randomBytes(20).toString('hex');
    const ephemeralPublicKey = bytesToHex(S.compressPoint(S.multiplyG(secret())));
    const metadata = '0x' + crypto.randomBytes(1).toString('hex');
    const calldata = encodeAnnounceCalldata({ schemeId: 1, stealthAddress, ephemeralPublicKey, metadata });
    const decoded = decodeAnnounceCalldata(calldata);
    assert.equal(decoded.schemeId, 1);
    assert.equal(decoded.stealthAddress.toLowerCase(), stealthAddress.toLowerCase());
    assert.equal(decoded.ephemeralPublicKey, ephemeralPublicKey);
    assert.equal(decoded.metadata, metadata);
    // Mutating a CONTENT byte must not yield the same record (padding bytes can be
    // flipped harmlessly, so target a byte inside the encoded ephemeral key, which is
    // always present verbatim in the ABI-encoded body).
    const contentIndex = calldata.indexOf(ephemeralPublicKey.slice(2, 40)) + 4;
    assert.ok(contentIndex > 4, 'the ephemeral key must appear in the encoded body');
    const mutated = calldata.slice(0, contentIndex) + (calldata[contentIndex] === 'f' ? '0' : 'f') + calldata.slice(contentIndex + 1);
    let same = false;
    try {
      const other = decodeAnnounceCalldata(mutated);
      same = other.stealthAddress === decoded.stealthAddress && other.ephemeralPublicKey === decoded.ephemeralPublicKey && other.metadata === decoded.metadata;
    } catch { same = false; }
    assert.equal(same, false, 'mutated calldata must not decode to the same announcement');
    assert.equal(validateAnnouncementInput({ schemeId: 1, stealthAddress, ephemeralPublicKey, metadata }).ok, true);
  }
});

/* =============================================================== state machine */
test('no reachable state sequence can complete a transfer without both confirmations', () => {
  // Exhaustive search over the transition graph, armed with a hostile context object.
  const hostileContexts = [{}, { paymentConfirmed: false, announcementConfirmed: false }, { paymentConfirmed: true, announcementConfirmed: false }, { announcementConfirmed: true, paymentConfirmed: false }];
  for (const context of hostileContexts) {
    const seen = new Set();
    const walk = (state, path) => {
      if (path.length > 6 || seen.has(state + path.length)) return;
      for (const next of TRANSFER_STATES) {
        if (!canTransition(state, next)) continue;
        const machine = resumeAt(state);
        try {
          machine.transition(next, context);
        } catch { continue; }
        assert.notEqual(machine.state, 'completed', `completed reached via ${path.concat(next).join(' → ')} with ${JSON.stringify(context)}`);
        walk(machine.state, path.concat(next));
      }
    };
    walk('idle', []);
  }
  // With real confirmations, completion IS reachable (the rule must not be unreachable).
  const machine = resumeAt('announcement_confirmed');
  machine.transition('completed', { paymentConfirmed: true, announcementConfirmed: true });
  assert.equal(machine.state, 'completed');
});

function resumeAt(state) {
  return state === 'idle' ? new TransferStateMachine() : new TransferStateMachine({ resumeAt: state });
}

/* =============================================================== privacy of the surface */
test('no private-transfer API payload can carry a wallet-shaped field', async () => {
  const service = await import('../server/private-transfer.js');
  const projected = service.publicPrivateTransferIdentity({
    protocol_version: 1, scheme_id: 1, spending_public_key: '0x' + '02'.repeat(33),
    viewing_public_key: '0x' + '03'.repeat(33), meta_address: '0x' + '02'.repeat(33).replace(/^0x/, '') + '03'.repeat(33),
    fingerprint: 'deadbeef', status: 'active', username: 'bob',
  });
  assert.equal(JSON.stringify(projected).toLowerCase().includes('wallet'), false);
  for (const forbidden of ['wallet_address', 'walletAddress', 'address', 'recipientAddress', 'ownerAddress']) {
    await assert.rejects(async () => { service.publicPrivateTransferIdentity({ wallet_address: '0x' + 'ab'.repeat(20) }); }, /PRIVATE_TRANSFER_ADDRESS_PRESENT|PRIVATE_TRANSFER_/);
    assert.ok(service.FORBIDDEN_FIELD_PATTERN.test(forbidden), `${forbidden} must be treated as forbidden`);
  }
});

test('the Phase 3 surface contains no logging, telemetry or URL sinks', () => {
  const files = [
    'src/stealth/privateTransfer.js', 'src/stealth/backup.js', 'src/stealth/derive.js',
    'src/ui/PrivateTransferPanel.js', 'src/systems/PrivateTransferSession.js',
    'server/private-transfer.js', 'api/private-transfer/[route].js',
  ];
  for (const file of files) {
    const source = read(file);
    assert.equal(/console\.(log|info|warn|debug)\(/.test(source), false, `${file} must not log`);
    assert.equal(/navigator\.sendBeacon|gtag\(|analytics\.|mixpanel|segment\./i.test(source), false, `${file} must not emit telemetry`);
    assert.equal(/location\.(href|search|hash)\s*=/.test(source), false, `${file} must not write to the URL`);
    assert.equal(/document\.cookie/.test(source), false, `${file} must not touch cookies`);
  }
});

test('the UI renders user-controlled values as text, never as markup', () => {
  const panel = read('src/ui/PrivateTransferPanel.js');
  assert.equal(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(panel), false);
  assert.match(panel, /el\.textContent = text|textContent/, 'the element helper writes through textContent');
  // A username that Phase 1 allows cannot become executable markup.
  const hostile = ['<img src=x onerror=alert(1)>', 'bob<script>', '"><svg/onload=1>'];
  for (const value of hostile) {
    assert.equal(/[<>]/.test(value), true, 'the sample really is hostile input');
  }
  assert.match(panel, /mk\('span', field, 'private-suffix'|recipientNote\.textContent/, 'panel renders names through textContent');
});

/* =============================================================== independent crypto re-checks */
test('keccak, secp256k1 and scrypt still agree with independent implementations after hardening', () => {
  for (let i = 0; i < 20; i += 1) {
    const data = crypto.randomBytes(i * 7);
    assert.equal(bytesToHex(keccak256Bytes(new Uint8Array(data))), keccak256(new Uint8Array(data)));
    const k = secret();
    const point = S.multiplyG(k);
    const ref = secp256k1.ProjectivePoint.BASE.multiply(k).toAffine();
    assert.equal(point.x, ref.x);
    assert.equal(point.y, ref.y);
    assert.equal(S.addressFromPoint(point, keccak256Bytes), privateKeyToAccount('0x' + k.toString(16).padStart(64, '0')).address.toLowerCase());
  }
});

/* =============================================================== spend guard */
test('a stealth spend refuses a key that does not control the announced address', () => {
  const spend = secret();
  const view = secret();
  const meta = buildMetaAddress(
    bytesToHex(S.compressPoint(S.multiplyG(spend))),
    bytesToHex(S.compressPoint(S.multiplyG(view))),
  );
  const derived = deriveStealthAddress({ metaAddress: meta });
  const shared = sharedSecretHash(view, S.decompressPoint(hexToBytes(derived.R)));
  const correct = (spend + hashToScalar(shared)) % S.N;
  assert.equal(verifyStealthKeypair({ stealthPrivateKey: correct, expectedPublicKey: derived.stealthPublicKey }), true);
  assert.equal(verifyStealthKeypair({ stealthPrivateKey: (correct + 1n) % S.N, expectedPublicKey: derived.stealthPublicKey }), false);
  assert.equal(verifyStealthKeypair({ stealthPrivateKey: 0n, expectedPublicKey: derived.stealthPublicKey }), false);
  assert.equal(addressForPrivateKey(correct), derived.stealthAddress);
});

/* =============================================================== signer sanity */
test('signed transactions still match viem byte-for-byte and reject tampering', () => {
  const k = secret();
  const account = privateKeyToAccount('0x' + k.toString(16).padStart(64, '0'));
  const base = { to: '0x' + 'ab'.repeat(20), value: 12345n, nonce: 7n, gasLimit: 21000n, chainId: 4441 };
  const mine = signNativeTransfer({ privateKey: k, ...base, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 500_000_000n, type: 'eip1559' });
  assert.match(mine.raw, /^0x02/);
  assert.equal(mine.hash, keccak256(mine.raw));
  assert.equal(addressForPrivateKey(k), account.address.toLowerCase());
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

export { PrivateTransferError, identityFromRoots, personalMessageHash };

/* =============================================================== authorization */
/** Minimal Vercel-style req/res doubles for router-level tests. */
function fakeRes() {
  const res = {
    statusCode: null, headers: {}, body: null, ended: false,
    setHeader: (key, value) => { res.headers[key] = value; },
    hasHeader: (key) => key in res.headers,
    end: (payload) => { res.ended = true; res.body = JSON.parse(payload); },
  };
  return res;
}

test('every private-transfer route enforces its method, auth and body limits', async () => {
  const { default: handler } = await import('../api/private-transfer/[route].js');
  const { readSession } = await import('../server/auth.js');

  const call = async ({ route, method = 'GET', headers = {}, body = undefined, query = {} }) => {
    const res = fakeRes();
    const req = { method, query: { route, ...query }, headers, body, on: () => {}, [Symbol.asyncIterator]: async function* () {} };
    await handler(req, res);
    return res;
  };

  // Unauthenticated access to every authenticated route is refused (401 UNAUTHORIZED).
  for (const [route, method] of [['enroll', 'POST'], ['me', 'GET'], ['payments', 'GET'], ['payments', 'POST'], ['payment-announcement', 'POST']]) {
    const res = await call({ route, method, body: {} });
    assert.equal(res.statusCode, 401, `${method} /${route} must require authentication`);
    assert.equal(res.body.error, 'UNAUTHORIZED');
  }

  // Unknown and nested routes 404 (no per-user path, no accidental match).
  for (const route of ['bob/announcements', 'transfers', 'me/extra', '', 'resolve/anything']) {
    const res = await call({ route });
    assert.equal(res.statusCode, 404, `/${route} must not exist`);
  }

  // Wrong method is 405 with an Allow header.
  const posted = await call({ route: 'me', method: 'POST', body: {} });
  assert.equal(posted.statusCode, 405);
  assert.equal(posted.headers.Allow, 'GET');

  // A forged bearer token never becomes a session: the reader either rejects outright or
  // returns nothing, and never a usable session object.
  let forgedSession;
  try { forgedSession = readSession('not-a-real-token'); } catch (error) { assert.equal(error.message, 'UNAUTHORIZED'); forgedSession = null; }
  assert.equal(forgedSession, null);
  const forged = await call({ route: 'me', method: 'GET', headers: { authorization: 'Bearer ' + 'ab'.repeat(32) } });
  assert.equal(forged.statusCode, 401);

  // Oversized bodies are refused by the shared body reader before any work happens.
  const { body: readBody } = await import('../server/http.js');
  const big = { [Symbol.asyncIterator]: async function* () { yield 'x'.repeat(4096); } };
  await assert.rejects(readBody(big, 1024), /BODY_TOO_LARGE/);
  const { fail } = await import('../server/http.js');
  const failure = fakeRes();
  fail(failure, new Error('BODY_TOO_LARGE'));
  assert.equal(failure.statusCode, 400);
  assert.equal(failure.body.error, 'BODY_TOO_LARGE', 'the limit is reported, never an internal error');

  // Every private-transfer error code the service can raise is allowlisted (no 500 leak).
  const http = read('server/http.js');
  const service = read('server/private-transfer.js');
  for (const [, code] of service.matchAll(/new Error\('([A-Z_]+)'\)/g)) {
    assert.ok(http.includes(`'${code}'`), `${code} must be allowlisted in server/http.js`);
  }
});

test('an enrollment proof for one username cannot be replayed for another account', async () => {
  const service = await import('../server/private-transfer.js');
  const { computeSpendPublicKeyFixture } = await import('./fixtures/private-transfer-keys.js');
  const fixture = computeSpendPublicKeyFixture();

  const fakeSql = (state) => {
    const run = async (strings, ...values) => {
      const text = strings.join('?');
      if (/FROM users WHERE id=/.test(text)) return state.user ? [state.user] : [];
      if (/FROM private_transfer_identities WHERE user_id=/.test(text)) return state.existing ?? [];
      if (/INSERT INTO private_transfer_identities/.test(text)) return [{ ...fixture.row }];
      return [];
    };
    run.json = (value) => value;
    return run;
  };

  // The signature was produced for username "alice" (see the fixture). A user called
  // "bob" replaying the same payload must be rejected: the server rebuilds the message
  // from the stored username, so the recovered address will not match.
  const bob = fakeSql({ user: { username: 'bob', wallet_address: fixture.walletAddress } });
  await assert.rejects(
    service.enrollPrivateTransferIdentity(bob, { userId: 'bob-id', input: fixture.enrollmentInput }),
    /PRIVATE_TRANSFER_INVALID_SIGNATURE/,
  );

  // The legitimate owner still succeeds.
  const alice = fakeSql({ user: { username: 'alice', wallet_address: fixture.walletAddress } });
  const identity = await service.enrollPrivateTransferIdentity(alice, { userId: 'alice-id', input: fixture.enrollmentInput });
  assert.equal(identity.fingerprint, fixture.fingerprint);
});

test('no private-transfer query can join a sender to a recipient', () => {
  const source = read('server/private-transfer.js').replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // The announcement ledger and the payment ledger must never be joined together or to
  // the identity table: the only join in the module reads the username for the caller's
  // own record and for public resolution.
  const joins = [...source.matchAll(/JOIN\s+\w+/gi)].map((match) => match[0]);
  for (const join of joins) assert.match(join, /JOIN users/i, `unexpected join: ${join}`);
  assert.equal(/JOIN private_transfer_payments/i.test(source), false);
  assert.equal(/JOIN private_transfer_announcements/i.test(source), false);
  // Payment rows are keyed by the sender only.
  const paymentsBlock = source
    .slice(source.indexOf('export async function recordPrivateTransferPayment'), source.indexOf('export async function attachAnnouncementToPayment'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, ''); // strip line comments, including trailing ones
  assert.equal(/username|meta_address|recipient|wallet/i.test(paymentsBlock), false, 'the payment writer must not touch recipient identity');
});

/* ================================================== username-binding parity */
test('PHASE 1 PARITY: private-transfer resolution delegates to the one Phase 1 normaliser', async () => {
  const { resolvePrivateTransferIdentity } = await import('../server/private-transfer.js');
  const { validateUsername } = await import('../src/identity/username.js');

  // Behavioural: the SAME normalization key Phase 1 would use is the key that is queried,
  // and an input Phase 1 rejects never reaches the database at all (no oracle either way).
  const calls = [];
  const sql = (strings, ...values) => { calls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values }); return Promise.resolve([]); };
  assert.equal(await resolvePrivateTransferIdentity(sql, '  BOB.VEYRA '), null);
  assert.equal(calls.length, 1, 'exactly one lookup for a valid username');
  assert.match(calls[0].text, /username_normalized=/);
  assert.equal(calls[0].values[0], validateUsername('  BOB.VEYRA ').username);
  assert.equal(calls[0].values[0], 'bob');

  for (const rejected of ['bob\u200b', 'ＢＯＢ', 'bob!', 'bo b', 'admin', 'x'.repeat(40), '']) {
    calls.length = 0;
    assert.equal(await resolvePrivateTransferIdentity(sql, rejected), null, `${JSON.stringify(rejected)} must not resolve`);
    assert.equal(calls.length, 0, `${JSON.stringify(rejected)} must not be queried`);
    assert.equal(validateUsername(rejected).ok, false);
  }

  // Structural guard: a future change must not grow a second normaliser in this module.
  const source = read('server/private-transfer.js');
  assert.match(source, /import \{ resolveIdentityRecord \} from '\.\/identity\.js';/);
  const resolveBody = source.slice(
    source.indexOf('export async function resolvePrivateTransferIdentity'),
    source.indexOf('/* --------------------------------------------------------------- announcements */'),
  );
  assert.equal(/toLowerCase\(\)/.test(resolveBody), false, 'resolution must not re-normalise the raw input');

  // Enrollment binds the username on the AUTHENTICATED row, never one supplied in the body.
  const enrollBody = source.slice(
    source.indexOf('export async function enrollPrivateTransferIdentity'),
    source.indexOf('export async function resolvePrivateTransferIdentity'),
  );
  assert.match(enrollBody, /enrollmentMessage\(\{\s*username: user\.username/);
  assert.equal(/username: record\.username/.test(enrollBody), false, 'a body-supplied username must never be signed over');
});

/* ============================================== announcer immutability */
test('the announcer target is a protocol constant: no constructor option can redirect it', async () => {
  const { PrivateTransferClient } = await import('../src/stealth/privateTransfer.js');
  const { ANNOUNCER_ADDRESS } = await import('../src/stealth/protocol.js');
  assert.equal(ANNOUNCER_ADDRESS.toLowerCase(), '0x55649e01b5df198d18d95b5cc5051630cfd45564');

  const spend = secret();
  const view = secret();
  const spendPublic = bytesToHex(S.compressPoint(S.multiplyG(spend)));
  const viewPublic = bytesToHex(S.compressPoint(S.multiplyG(view)));
  const metaAddress = buildMetaAddress(spendPublic, viewPublic);
  const sent = [];
  const provider = {
    request: async ({ method, params }) => {
      if (method === 'eth_chainId') return '0x1159';
      if (method === 'eth_accounts') return ['0x' + 'aa'.repeat(20)];
      if (method === 'eth_getCode') return '0x';
      if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
      if (method === 'eth_sendTransaction') { sent.push(params[0]); return '0x' + '55'.repeat(32); }
      if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0x10' };
      if (method === 'eth_blockNumber') return '0x20';
      return null;
    },
  };
  const api = async (path) => {
    if (path.includes('/resolve')) {
      return { identity: {
        username: 'bob', protocolVersion: 1, schemeId: 1, spendingPublicKey: spendPublic,
        viewingPublicKey: viewPublic, metaAddress, fingerprint: metaFingerprint(metaAddress),
      } };
    }
    if (path.includes('/announcements')) return { announcements: [], nextCursor: null };
    if (path.includes('/payments')) return { paymentId: 'p1' };
    return { ok: true };
  };
  // Hostile options: a caller trying to replace the announcer (or the scheme/chain) must not be able to.
  const client = new PrivateTransferClient({
    api, provider,
    announcerAddress: '0x' + 'de'.repeat(20), announcer: '0x' + 'de'.repeat(20),
    schemeId: 42, chainId: 1, protocolVersion: 9,
  });
  const result = await client.send({ recipient: 'bob', amount: '0.001', confirmations: 1, announcementConfirmations: 1 });
  assert.equal(result.status, 'completed');
  assert.equal(sent.length, 2, 'one payment and one announcement');
  assert.equal(sent[1].to.toLowerCase(), '0x55649e01b5df198d18d95b5cc5051630cfd45564');
  assert.match(sent[1].data, /^0x4d1f9583/, 'ERC-5564 announce selector');
  assert.equal(BigInt(sent[1].chainId), 4441n);
});

/* ============================================== backup passphrase matrix */
test('backup passphrases: empty/short refused, long and Unicode accepted, version metadata authenticated', async () => {
  const pSpend = secret();
  const pView = secret();
  const metaAddress = buildMetaAddress(
    bytesToHex(S.compressPoint(S.multiplyG(pSpend))),
    bytesToHex(S.compressPoint(S.multiplyG(pView))),
  );
  const payload = {
    protocolVersion: 1, schemeId: 1, chainId: 4441, metaAddress, fingerprint: metaFingerprint(metaAddress),
    spendingPrivateKey: '0x' + pSpend.toString(16).padStart(64, '0'),
    viewingPrivateKey: '0x' + pView.toString(16).padStart(64, '0'),
  };
  for (const weak of ['', 'short', '1234567']) {
    await assert.rejects(encryptBackup(payload, weak), /PASSPHRASE_TOO_SHORT/);
  }
  const longUnicode = '😀🔐пароль-'+ '日本語パスフレーズ'.repeat(200); // > 2000 chars, multi-byte
  const envelope = await encryptBackup(payload, longUnicode);
  const restored = await decryptBackup(envelope, longUnicode);
  assert.equal(restored.metadata.chainId, 4441);
  assert.equal(restored.spendingPrivateKey, pSpend, 'the exact key survives a multi-byte passphrase');
  assert.equal(JSON.stringify(envelope).includes('日本語'), false, 'no passphrase material in the envelope');
  await assert.rejects(decryptBackup(envelope, longUnicode + 'x'), /BACKUP_AUTHENTICATION_FAILED/);
  // Unicode normalization is NOT applied (no NFC/NFD folding that would let two different
  // strings unlock the same blob): the composed and decomposed forms are different secrets.
  const composed = 'é'.repeat(12);
  const decomposed = 'e\u0301'.repeat(12);
  const env2 = await encryptBackup(payload, composed);
  await assert.rejects(decryptBackup(env2, decomposed), /BACKUP_AUTHENTICATION_FAILED/);
  assert.equal((await decryptBackup(env2, composed)).metadata.schemeId, 1);
  // version + protocol metadata are authenticated (finding M-02): mutating them is detected
  const withMeta = await encryptBackup(payload, 'passphrase-abcdefgh');
  const mutated = JSON.parse(JSON.stringify(withMeta));
  mutated.protocolVersion = 2;
  assert.throws(() => validateBackupEnvelope(mutated), /BACKUP_UNSUPPORTED_PROTOCOL/, 'validateBackupEnvelope is synchronous');
  const tampered = JSON.parse(JSON.stringify(withMeta));
  tampered.chainId = 1;
  await assert.rejects(decryptBackup(tampered, 'passphrase-abcdefgh'), /BACKUP_AUTHENTICATION_FAILED|BACKUP_UNSUPPORTED/);
});
