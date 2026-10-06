// Phase 3 — private transfer cryptography.
//
// These tests exercise Veyra's dependency-free client crypto and cross-verify every
// primitive that matters against an independent implementation (viem / @noble /
// node:crypto). Hand-rolled maths is never trusted on its own evidence.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, recoverAddress, recoverMessageAddress } from 'viem';
import { secp256k1 } from '@noble/curves/secp256k1';

import { keccak256Bytes, keccak256Utf8, bytesToHex, hexToBytes } from '../src/stealth/keccak.js';
import {
  N, P, GX, GY, isOnCurve, multiplyG, pointAdd, compressPoint, decompressPoint,
  addressFromPoint, randomScalar, scalarToHex, recoverPublicKey, addressFromSignature,
} from '../src/stealth/secp256k1.js';
import { scrypt, BACKUP_SCRYPT_PARAMS } from '../src/stealth/scrypt.js';
import {
  ANNOUNCER_ADDRESS, ANNOUNCE_SELECTOR, ANNOUNCEMENT_TOPIC, CHAIN_ID, PROTOCOL_VERSION, SCHEME_ID,
  metaFingerprint, parseMetaAddress, buildMetaAddress, validateEphemeralPublicKey,
  validateProtocolRecord, validateResolvedRecord, findForbiddenResolvedField,
} from '../src/stealth/protocol.js';
import { deriveStealthAddress, deriveStealthPrivateKey, sharedSecretHash, hashToScalar, viewTagOf, verifyStealthKeypair, scanAnnouncement, scanAnnouncements } from '../src/stealth/derive.js';
import { encodeAnnounceCalldata, decodeAnnounceCalldata, validateAnnouncementInput, isNativeMetadata } from '../src/stealth/announcement.js';
import {
  identityFromRoots, deriveIdentityRootsFromSignature, recoveryMessage, verifyRecoveredFingerprint,
  enrollmentMessage, personalMessageHash, splitSignature, addressFromPersonalSignature,
} from '../src/stealth/recovery.js';
import { encryptBackup, decryptBackup, validateBackupEnvelope, BACKUP_FORMAT, BACKUP_VERSION } from '../src/stealth/backup.js';
import { signDigest, addressForPrivateKey, signNativeTransfer } from '../src/stealth/signer.js';

const keyHex = (scalar) => '0x' + scalar.toString(16).padStart(64, '0');
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const secret = () => randomScalar();

/* ------------------------------------------------------------------ keccak */
test('keccak256 matches viem for varied inputs', () => {
  const cases = ['', 'a', 'hello world', 'Veyra — private transfers', 'x'.repeat(300), '1234567890'.repeat(40)];
  for (const value of cases) {
    assert.equal(bytesToHex(keccak256Utf8(value)), keccak256(new TextEncoder().encode(value)));
  }
  for (let i = 0; i < 5; i += 1) {
    const bytes = randomBytes(1 + i * 7);
    assert.equal(bytesToHex(keccak256Bytes(bytes)), keccak256(new Uint8Array(bytes)));
  }
});

/* ------------------------------------------------------------------ secp256k1 */
test('curve constants and generators are consistent', () => {
  const g = multiplyG(1n);
  assert.equal(g.x, GX);
  assert.equal(g.y, GY);
  assert.ok(isOnCurve(g));
  assert.ok(isOnCurve(multiplyG(2n)));
  assert.equal(multiplyG(N), null, 'n*G must be the point at infinity');
  const k = secret();
  assert.equal(multiplyG(k).x, secp256k1.ProjectivePoint.BASE.multiply(k).toAffine().x);
});

test('scalar multiplication and addition agree with @noble', () => {
  for (let i = 0; i < 12; i += 1) {
    const a = secret();
    const b = secret();
    const mine = pointAdd(multiplyG(a), multiplyG(b)).x;
    const theirs = secp256k1.ProjectivePoint.BASE.multiply(a).add(secp256k1.ProjectivePoint.BASE.multiply(b)).toAffine().x;
    assert.equal(mine, theirs);
  }
});

test('compression round-trips and addresses match the wallet implementation', () => {
  for (let i = 0; i < 8; i += 1) {
    const k = secret();
    const point = multiplyG(k);
    const compressed = compressPoint(point);
    assert.equal(compressed.length, 33);
    assert.ok(compressed[0] === 0x02 || compressed[0] === 0x03);
    const back = decompressPoint(compressed);
    assert.equal(back.x, point.x);
    assert.equal(back.y, point.y);
    const address = addressFromPoint(point, keccak256Bytes);
    assert.equal(address, privateKeyToAccount(keyHex(k)).address.toLowerCase());
  }
});

test('isOnCurve rejects points that are not on secp256k1', () => {
  assert.equal(isOnCurve({ x: 1n, y: 1n }), false);
  assert.equal(isOnCurve({ x: 1n, y: 2n }), false);
  assert.equal(isOnCurve({}), false);
  assert.equal(isOnCurve(null), true, 'the point at infinity is a valid curve element');
});

/* ------------------------------------------------------------------ scrypt/KDF */
test('scrypt matches node:crypto at Veyra backup parameters', () => {
  const salt = hexToBytes('0x' + 'ab'.repeat(32));
  const mine = scrypt(new TextEncoder().encode('passphrase-1234'), salt, BACKUP_SCRYPT_PARAMS);
  const theirs = scryptSync('passphrase-1234', Buffer.from(salt), BACKUP_SCRYPT_PARAMS.dkLen, {
    N: BACKUP_SCRYPT_PARAMS.N, r: BACKUP_SCRYPT_PARAMS.r, p: BACKUP_SCRYPT_PARAMS.p, maxmem: 1 << 30,
  });
  assert.equal(bytesToHex(mine), '0x' + theirs.toString('hex'));
  assert.equal(BACKUP_SCRYPT_PARAMS.N, 2 ** 15);
});

test('scrypt matches the RFC 7914 published vectors', () => {
  const vectors = [
    { pw: '', salt: '', N: 16, r: 1, p: 1, dkLen: 64, out: '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906' },
    { pw: 'password', salt: 'NaCl', N: 1024, r: 8, p: 16, dkLen: 64, out: 'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640' },
    { pw: 'pleaseletmein', salt: 'SodiumChloride', N: 16384, r: 8, p: 1, dkLen: 64, out: '7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887' },
  ];
  for (const vector of vectors) {
    const result = scrypt(new TextEncoder().encode(vector.pw), new TextEncoder().encode(vector.salt), {
      N: vector.N, r: vector.r, p: vector.p, dkLen: vector.dkLen,
    });
    assert.equal(bytesToHex(result), '0x' + vector.out, `RFC 7914 vector N=${vector.N}`);
  }
});

/* ------------------------------------------------------------------ protocol records */
test('meta-address parsing accepts the 66-byte two-key form only', () => {
  const spend = secret();
  const view = secret();
  const meta = buildMetaAddress('0x' + bytesToHex(compressPoint(multiplyG(spend))).slice(2), '0x' + bytesToHex(compressPoint(multiplyG(view))).slice(2));
  const parsed = parseMetaAddress(meta);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.metaAddress, meta.toLowerCase());

  // The 33-byte single-key form MUST be refused (Phase 2D finding, Veyra policy).
  const single = 'st:eth:0x' + bytesToHex(compressPoint(multiplyG(spend))).slice(2);
  const refused = parseMetaAddress(single);
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'META_ADDRESS_SINGLE_KEY_REFUSED');

  // Off-curve spend key, duplicated keys, bad prefix and bad length all refused.
  assert.equal(parseMetaAddress('st:eth:0x' + '02'.repeat(33)).ok, false);
  assert.equal(parseMetaAddress(meta.replace(meta.slice(-66), meta.slice(-66))).ok, true);
  // A meta-address whose two halves are the same key is refused too.
  const sameKeyMeta = '0x' + parsed.spendingPublicKey.slice(2) + parsed.spendingPublicKey.slice(2);
  assert.equal(parseMetaAddress(sameKeyMeta).ok, false);
  assert.equal(parseMetaAddress(sameKeyMeta).error, 'META_ADDRESS_SINGLE_KEY_REFUSED');
  assert.throws(() => buildMetaAddress(parsed.spendingPublicKey, parsed.spendingPublicKey), /META_ADDRESS_SINGLE_KEY_REFUSED/);
  assert.equal(parseMetaAddress('0x' + '02'.repeat(33)).ok, false);
  assert.equal(parseMetaAddress('st:eth:0xdeadbeef').ok, false);
});

test('ephemeral public keys are validated before use', () => {
  assert.equal(validateEphemeralPublicKey('0x' + bytesToHex(compressPoint(multiplyG(secret()))).slice(2)).ok, true);
  // x = 0 and x = p−1 have no matching y on secp256k1 (7 and 2 are non-residues mod p).
  assert.equal(validateEphemeralPublicKey('0x02' + '00'.repeat(32)).ok, false, 'x=0 is not on the curve');
  assert.equal(validateEphemeralPublicKey('0x02' + 'ff'.repeat(32)).ok, false, 'x=p-1 is not on the curve');
  assert.equal(validateEphemeralPublicKey('0x04' + '11'.repeat(64)).ok, false, 'uncompressed form not accepted');
  assert.equal(validateEphemeralPublicKey('0x' + '02'.repeat(32)).ok, false, 'wrong length');
  assert.equal(validateEphemeralPublicKey('not-hex').ok, false);
});

test('resolved records never contain a wallet address field', () => {
  const spend = secret();
  const view = secret();
  const metaAddress = buildMetaAddress('0x' + bytesToHex(compressPoint(multiplyG(spend))).slice(2), '0x' + bytesToHex(compressPoint(multiplyG(view))).slice(2));
  const record = {
    username: 'bob', metaAddress, spendingPublicKey: bytesToHex(compressPoint(multiplyG(spend))),
    viewingPublicKey: bytesToHex(compressPoint(multiplyG(view))), protocolVersion: PROTOCOL_VERSION,
    schemeId: SCHEME_ID, fingerprint: metaFingerprint(metaAddress), walletAddress: '0xdeadbeef',
  };
  const validated = validateResolvedRecord(record);
  assert.equal(validated.ok, false, 'a record carrying a wallet address must be rejected outright');
  assert.equal(validated.error, 'WALLET_ADDRESS_IN_RECORD');
  // The clean projection of the same record validates, and contains no address field.
  const clean = { ...record };
  delete clean.walletAddress;
  const accepted = validateResolvedRecord(clean);
  assert.equal(accepted.ok, true);
  assert.equal(findForbiddenResolvedField(accepted), null);
  assert.equal(JSON.stringify(accepted).toLowerCase().includes('walletaddress'), false);
});

test('protocol constants pin the live LiteForge deployment', () => {
  assert.equal(CHAIN_ID, 4441);
  assert.equal(SCHEME_ID, 1);
  assert.equal(ANNOUNCER_ADDRESS, '0x55649E01B5Df198D18D95b5cc5051630cfD45564');
  assert.equal(ANNOUNCE_SELECTOR, '0x4d1f9583');
});

/**
 * Phase 4A.1 regression: `ANNOUNCEMENT_TOPIC` shipped as a fabricated placeholder for
 * three phases (it shared only the first 4 bytes of the real topic0, which is why a
 * naive prefix check would have passed). The value is now DERIVED here rather than
 * compared to a hard-coded string, so the test proves the constant is the true
 * ERC-5564 topic and fails the moment anything else is put back.
 */
test('ANNOUNCEMENT_TOPIC is the real ERC-5564 Announcement topic (derived, not pasted)', async () => {
  const SIGNATURE = 'Announcement(uint256,address,address,bytes,bytes)';
  const STALE_PLACEHOLDER = '0x5f0eab80282628ba6b6a9f7b4b0f4e0f8f0a5b1f4e6d4b8f0c9e6d3a1b2c3d4e';

  // (1) shape: 0x + exactly 64 lowercase hex characters = 32 bytes
  assert.equal(typeof ANNOUNCEMENT_TOPIC, 'string');
  assert.match(ANNOUNCEMENT_TOPIC, /^0x[0-9a-f]{64}$/, 'topic0 must be 32 bytes of lowercase hex');
  assert.equal((ANNOUNCEMENT_TOPIC.length - 2) / 2, 32);

  // (2) independently derived: Veyra's own keccak over the event signature (bytes, so an
  //     accidental UTF-8 round trip cannot pass) …
  const { keccak256Bytes, keccak256Utf8, bytesToHex } = await import('../src/stealth/keccak.js');
  const signatureBytes = new TextEncoder().encode(SIGNATURE);
  assert.equal(bytesToHex(keccak256Bytes(signatureBytes)), ANNOUNCEMENT_TOPIC);
  assert.equal(bytesToHex(keccak256Utf8(SIGNATURE)), ANNOUNCEMENT_TOPIC);

  // … and a second implementation entirely (viem), so the constant is pinned to the
  // canonical signature rather than to Veyra's keccak being wrong in the same way.
  const { keccak256 } = await import('viem');
  assert.equal(keccak256(signatureBytes), ANNOUNCEMENT_TOPIC);
  assert.equal(keccak256(SIGNATURE), ANNOUNCEMENT_TOPIC, 'viem string form must agree too');

  // (3) the exact known-answer value, recorded in the Phase 2/3 architecture doc.
  assert.equal(ANNOUNCEMENT_TOPIC, '0x5f0eab8057630ba7676c49b4f21a0231414e79474595be8e4c432fbf6bf0f4e7');

  // (4) it is NOT the stale placeholder (fail if anyone restores it), and the stale value
  //     is not merely "a different valid topic": it is not the hash of anything real.
  assert.notEqual(ANNOUNCEMENT_TOPIC, STALE_PLACEHOLDER);

  // Negative controls: the derivation is sensitive to the exact signature, so a
  // near-miss signature cannot produce (or explain) the constant.
  const nearMisses = [
    'Announcement(uint256,address,bytes,bytes)',          // one address parameter short
    'Announcement(uint256,address,address,bytes)',        // metadata argument missing
    'Announcement(uint256,address,address,bytes,bytes,uint256)', // extra argument
    'Announcements(uint256,address,address,bytes,bytes)', // plural event name
    'announcement(uint256,address,address,bytes,bytes)',  // wrong case
  ];
  for (const nearMiss of nearMisses) {
    const derived = bytesToHex(keccak256Bytes(new TextEncoder().encode(nearMiss)));
    assert.notEqual(derived, ANNOUNCEMENT_TOPIC, `${nearMiss} must not hash to the topic`);
    assert.notEqual(derived, STALE_PLACEHOLDER, `${nearMiss} must not hash to the placeholder either`);
  }

  // (5) the executable source of truth contains the verified topic and NO copy of the
  //     stale placeholder anywhere (a restored placeholder in any module fails this).
  const source = read('src/stealth/protocol.js');
  assert.match(source, new RegExp(ANNOUNCEMENT_TOPIC));
  const staleScan = [];
  for (const file of ['src/stealth/protocol.js', 'src/stealth/announcement.js', 'src/stealth/derive.js', 'src/stealth/privateTransfer.js', 'server/private-transfer.js']) {
    assert.equal(read(file).includes(STALE_PLACEHOLDER), false, `${file} must not contain the stale placeholder`);
    staleScan.push(file);
  }
  assert.equal(staleScan.length, 5);
  // The placeholder's only distinguishing feature was its 4-byte prefix match.
  assert.equal(ANNOUNCEMENT_TOPIC.slice(0, 10), STALE_PLACEHOLDER.slice(0, 10), 'the stale value did share this prefix (documented in the fix)');
  assert.notEqual(ANNOUNCEMENT_TOPIC.slice(0, 10), ANNOUNCEMENT_TOPIC.slice(0, 12), 'sanity: not comparing the topic to itself');

  // (6) the documented reference matches the code (no doc/code divergence).
  const doc = read('docs/VEYRA-PRIVATE-TRANSFER-ARCHITECTURE.md');
  assert.ok(doc.includes(ANNOUNCEMENT_TOPIC), 'the architecture doc must record this exact topic');

  // (7) nothing else in the fix moved: announcer and selector are untouched.
  assert.equal(ANNOUNCER_ADDRESS, '0x55649E01B5Df198D18D95b5cc5051630cfD45564');
  assert.equal(ANNOUNCE_SELECTOR, '0x4d1f9583');
});

/* ------------------------------------------------------------------ derivation */
test('stealth derivation follows Phase 2D exactly', () => {
  const spend = secret();
  const view = secret();
  const spendingPublicKey = '0x' + bytesToHex(compressPoint(multiplyG(spend))).slice(2);
  const viewingPublicKey = '0x' + bytesToHex(compressPoint(multiplyG(view))).slice(2);
  const metaAddress = buildMetaAddress(spendingPublicKey, viewingPublicKey);

  const derived = deriveStealthAddress({ metaAddress });
  assert.equal(derived.stealthPublicKey.length, 68, '33 bytes + 0x prefix');
  assert.equal(derived.R.length, 68, '33 bytes + 0x prefix');
  assert.match(derived.stealthAddress, /^0x[0-9a-f]{40}$/);
  assert.match(derived.viewTag, /^[0-9a-f]{2}$/);

  // view tag = first byte of keccak256(compressed shared secret)
  const R = decompressPoint(hexToBytes(derived.R));
  const shared = sharedSecretHash(view, R);
  assert.equal(shared, derived.sharedHash);
  assert.equal(viewTagOf(shared), derived.viewTag);

  // P_stealth = P_spend + h*G ; p_stealth = p_spend + h (mod n)
  const h = hashToScalar(shared);
  const expected = pointAdd(multiplyG(h), multiplyG(spend));
  assert.equal(bytesToHex(compressPoint(expected)), derived.stealthPublicKey);
  const pStealth = deriveStealthPrivateKey({ spendingPrivateKey: spend, sharedHash: shared });
  assert.equal(pStealth, (spend + h) % N);
  assert.equal(addressForPrivateKey(pStealth), derived.stealthAddress);
  assert.equal(verifyStealthKeypair({ stealthPrivateKey: pStealth, expectedPublicKey: derived.stealthPublicKey }), true);
});

test('every payment gets a fresh ephemeral key and a fresh stealth address', () => {
  const spend = secret();
  const view = secret();
  const metaAddress = buildMetaAddress('0x' + bytesToHex(compressPoint(multiplyG(spend))).slice(2), '0x' + bytesToHex(compressPoint(multiplyG(view))).slice(2));
  const addresses = new Set();
  const ephemerals = new Set();
  for (let i = 0; i < 24; i += 1) {
    const derived = deriveStealthAddress({ metaAddress });
    addresses.add(derived.stealthAddress);
    ephemerals.add(derived.R);
  }
  assert.equal(addresses.size, 24, 'no stealth address may ever repeat');
  assert.equal(ephemerals.size, 24, 'no ephemeral key may ever repeat');
});

test('the sender cannot spend: only the recipient derives the stealth private key', () => {
  const spend = secret();
  const view = secret();
  const metaAddress = buildMetaAddress('0x' + bytesToHex(compressPoint(multiplyG(spend))).slice(2), '0x' + bytesToHex(compressPoint(multiplyG(view))).slice(2));
  const derived = deriveStealthAddress({ metaAddress });
  // The sender knows r and R but not p_spend: it can only derive the address, never the key.
  assert.equal(typeof derived.stealthPrivateKey, 'undefined');
  assert.equal(derived.spendingPrivateKey, undefined);
  assert.ok(!('p_stealth' in derived));
});

/* ------------------------------------------------------------------ scanning */
test('recipient scan detects its own announcement and rejects the others', () => {
  const bobSpend = secret();
  const bobView = secret();
  const bobMeta = buildMetaAddress('0x' + bytesToHex(compressPoint(multiplyG(bobSpend))).slice(2), '0x' + bytesToHex(compressPoint(multiplyG(bobView))).slice(2));
  const eveSpend = secret();
  const eveView = secret();
  const eveMeta = buildMetaAddress('0x' + bytesToHex(compressPoint(multiplyG(eveSpend))).slice(2), '0x' + bytesToHex(compressPoint(multiplyG(eveView))).slice(2));

  const toBob = deriveStealthAddress({ metaAddress: bobMeta });
  const toEve = deriveStealthAddress({ metaAddress: eveMeta });

  const records = [
    { schemeId: 1, stealthAddress: toEve.stealthAddress, ephemeralPublicKey: toEve.R, metadata: '0x' + toEve.viewTag },
    { schemeId: 1, stealthAddress: toBob.stealthAddress, ephemeralPublicKey: toBob.R, metadata: '0x' + toBob.viewTag },
    { schemeId: 2, stealthAddress: toBob.stealthAddress, ephemeralPublicKey: toBob.R, metadata: '0x' + toBob.viewTag },
    { schemeId: 1, stealthAddress: toBob.stealthAddress, ephemeralPublicKey: '0x' + '02'.repeat(33), metadata: '0x' + toBob.viewTag },
    { schemeId: 1, stealthAddress: toBob.stealthAddress, ephemeralPublicKey: toBob.R, metadata: '0xdeadbeef' },
  ];

  const spendingPublicKey = '0x' + bytesToHex(compressPoint(multiplyG(bobSpend))).slice(2);
  const bobKeys = { spendingPublicKey, spendingPrivateKey: bobSpend, viewingPrivateKey: bobView };
  const bobViewTagged = scanAnnouncements(records, bobKeys);
  assert.equal(bobViewTagged.length, 1, 'exactly one record belongs to Bob');
  assert.equal(bobViewTagged[0].stealthAddress, toBob.stealthAddress);
  const expectedKey = deriveStealthPrivateKey({
    spendingPrivateKey: bobSpend,
    sharedHash: sharedSecretHash(bobView, decompressPoint(hexToBytes(toBob.R))),
  });
  assert.equal(bobViewTagged[0].stealthPrivateKey, expectedKey);
  assert.equal(addressForPrivateKey(expectedKey), toBob.stealthAddress, 'the scanned key really controls the announced address');

  // A wrong viewing key finds nothing even though the view tag matches.
  const stranger = scanAnnouncements(records, { ...bobKeys, viewingPrivateKey: secret() });
  assert.equal(stranger.length, 0);

  // A tag match with a foreign stealth address must NOT be reported as a match.
  const collided = scanAnnouncement(
    { schemeId: 1, stealthAddress: toEve.stealthAddress, ephemeralPublicKey: toBob.R, metadata: '0x' + toBob.viewTag },
    bobKeys,
  );
  assert.equal(collided.match, false);
  assert.equal(collided.reason, 'ADDRESS_MISMATCH');
});

test('scan ignores records that are malformed rather than crashing', () => {
  const spend = secret();
  const view = secret();
  const spendingPublicKey = '0x' + bytesToHex(compressPoint(multiplyG(spend))).slice(2);
  const junk = [
    null, undefined, {}, { schemeId: 1 }, { schemeId: 1, ephemeralPublicKey: 'x', stealthAddress: 'y', metadata: 'z' },
    { schemeId: 1, ephemeralPublicKey: '0x02' + '00'.repeat(32), stealthAddress: '0x' + '11'.repeat(20), metadata: '0x00' },
  ];
  assert.deepEqual(scanAnnouncements(junk, { spendingPublicKey, viewingPrivateKey: view }), []);
});

/* ------------------------------------------------------------------ announcement ABI */
test('announce calldata is byte-identical to viem encodeFunctionData', async () => {
  const { encodeFunctionData, parseAbi } = await import('viem');
  const abi = parseAbi(['function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPublicKey, bytes metadata)']);
  const stealthAddress = '0x' + 'ab'.repeat(20);
  const ephemeralPublicKey = '0x' + bytesToHex(compressPoint(multiplyG(secret()))).slice(2);
  const metadata = '0x' + '8c';

  const mine = encodeAnnounceCalldata({ schemeId: 1, stealthAddress, ephemeralPublicKey, metadata });
  const theirs = encodeFunctionData({ abi, functionName: 'announce', args: [1n, stealthAddress, ephemeralPublicKey, metadata] });
  assert.equal(mine, theirs);
  assert.ok(mine.startsWith(ANNOUNCE_SELECTOR));

  const decoded = decodeAnnounceCalldata(mine);
  assert.equal(decoded.schemeId, 1);
  assert.equal(decoded.stealthAddress, stealthAddress);
  assert.equal(decoded.ephemeralPublicKey, ephemeralPublicKey);
  assert.equal(decoded.metadata, metadata);
  assert.equal(isNativeMetadata(decoded.metadata), true);
});

test('announcement validation refuses malformed input before broadcast', () => {
  const good = '0x' + bytesToHex(compressPoint(multiplyG(secret()))).slice(2);
  assert.equal(validateAnnouncementInput({ schemeId: 1, stealthAddress: '0x' + '11'.repeat(20), ephemeralPublicKey: good, metadata: '0x8c' }).ok, true);
  assert.equal(validateAnnouncementInput({ schemeId: 2, stealthAddress: '0x' + '11'.repeat(20), ephemeralPublicKey: good, metadata: '0x8c' }).ok, false);
  assert.equal(validateAnnouncementInput({ schemeId: 1, stealthAddress: '0x11', ephemeralPublicKey: good, metadata: '0x8c' }).ok, false);
  assert.equal(validateAnnouncementInput({ schemeId: 1, stealthAddress: '0x' + '11'.repeat(20), ephemeralPublicKey: '0x02' + '00'.repeat(32), metadata: '0x8c' }).ok, false, 'off-curve ephemeral key');
  assert.equal(validateAnnouncementInput({ schemeId: 1, stealthAddress: '0x' + '11'.repeat(20), ephemeralPublicKey: good, metadata: '0x' }).ok, false, 'missing view tag');
});

test('EIP-191 personal message hashing matches viem', () => {
  for (const message of ['', 'a', 'hello world', 'Veyra stealth identity v1\nusername: bob\nchainId: 4441\ndomain: veyra.identity']) {
    const mine = bytesToHex(personalMessageHash(message));
    const theirs = keccak256(new TextEncoder().encode(`\x19Ethereum Signed Message:\n${new TextEncoder().encode(message).length}${message}`));
    assert.equal(mine, theirs);
  }
});

test('ECDSA public-key recovery matches viem (the server-side enrollment check)', async () => {
  for (let i = 0; i < 5; i += 1) {
    const k = secret();
    const account = privateKeyToAccount(keyHex(k));
    const message = `Veyra stealth identity enrollment v1\ncheck ${i}`;
    const signature = await account.signMessage({ message });
    assert.equal(addressFromPersonalSignature({ message, signature }), (await recoverMessageAddress({ message, signature })).toLowerCase());
    // The same signature over a different message must NOT recover the wallet.
    assert.notEqual(addressFromPersonalSignature({ message: `${message} `, signature }), account.address.toLowerCase());

    // Raw-digest recovery, cross-checked against viem's own signature format.
    const digest = keccak256Bytes(new TextEncoder().encode(`raw ${i}`));
    const rawSignature = await account.sign({ hash: bytesToHex(digest) });
    const { r, s: sigS, recovery } = splitSignature(rawSignature);
    const point = recoverPublicKey({ r, s: sigS, recovery, hash: digest });
    assert.ok(isOnCurve(point));
    assert.equal(
      addressFromSignature({ r, s: sigS, recovery, hash: digest, keccak: keccak256Bytes }),
      (await recoverAddress({ hash: bytesToHex(digest), signature: rawSignature })).toLowerCase(),
    );
  }
});

test('legacy 27/28 recovery bytes are normalised and bad signatures are refused', () => {
  assert.equal(splitSignature('0x' + '11'.repeat(32) + '22'.repeat(32) + '1c').recovery, 1);
  assert.equal(splitSignature('0x' + '11'.repeat(32) + '22'.repeat(32) + '01').recovery, 1);
  assert.throws(() => splitSignature('0x' + '11'.repeat(64)), /SIGNATURE_MUST_BE_65_BYTES/);
  assert.throws(() => splitSignature('0x' + '11'.repeat(32) + '22'.repeat(32) + '09'), /INVALID_RECOVERY_ID/);
  assert.throws(() => recoverPublicKey({ r: 0n, s: 1n, recovery: 0, hash: keccak256Bytes(new Uint8Array([1])) }), /INVALID_SIGNATURE_VALUES/);
  assert.throws(() => recoverPublicKey({ r: 1n, s: 1n, recovery: 9, hash: keccak256Bytes(new Uint8Array([1])) }), /INVALID_RECOVERY_ID/);
});

/* ------------------------------------------------------------------ recovery + backup */
test('recovery roots come from the signature halves and bind the domain', async () => {
  const account = privateKeyToAccount(keyHex(secret()));
  const message = recoveryMessage('bob');
  assert.match(message, /username: bob/);
  assert.match(message, /chainId: 4441/);
  assert.match(message, /domain: veyra\.identity/);

  const signature = await account.signMessage({ message });
  const roots = deriveIdentityRootsFromSignature(signature);
  assert.equal(roots.spendingPrivateKey, BigInt(keccak256(hexToBytes('0x' + signature.slice(2, 66)))) % N);
  assert.equal(roots.viewingPrivateKey, BigInt(keccak256(hexToBytes('0x' + signature.slice(66, 130)))) % N);
  assert.notEqual(roots.spendingPrivateKey, roots.viewingPrivateKey, 'spend and view keys must be separate');

  const identity = identityFromRoots(roots);
  assert.deepEqual(verifyRecoveredFingerprint(identity, identity.fingerprint), { ok: true });
  assert.deepEqual(verifyRecoveredFingerprint(identity, 'deadbeef'), { ok: false, error: 'RECOVERY_FINGERPRINT_MISMATCH' });
  assert.equal(identity.metaAddress.length, 2 + 66 * 2);
  assert.equal(identity.spendingAddress, null, 'the identity never carries a wallet address');

  // Different wallets ⇒ different identities; the same wallet+message is stable.
  const again = deriveIdentityRootsFromSignature(await account.signMessage({ message }));
  assert.equal(again.spendingPrivateKey, roots.spendingPrivateKey);

  // 64-byte compact signatures are refused outright.
  assert.throws(() => deriveIdentityRootsFromSignature('0x' + '11'.repeat(64)), /SIGNATURE_MUST_BE_65_BYTES/);
});

test('enrollment message is a distinct, non-deriving domain', () => {
  const spend = secret();
  const view = secret();
  const metaAddress = buildMetaAddress('0x' + bytesToHex(compressPoint(multiplyG(spend))).slice(2), '0x' + bytesToHex(compressPoint(multiplyG(view))).slice(2));
  const message = enrollmentMessage({ username: 'bob', metaAddress, siskPublicKey: '0x' + '02'.repeat(33) });
  assert.notEqual(message, recoveryMessage('bob'));
  assert.match(message, /domain: veyra\.identity\.enrollment/);
  assert.match(message, new RegExp(metaAddress.slice(2, 18)));
});

test('backup encrypts with AES-256-GCM and rejects wrong passphrases and tampering', async () => {
  const spend = secret();
  const view = secret();
  const sisk = secret();
  const metaAddress = buildMetaAddress('0x' + bytesToHex(compressPoint(multiplyG(spend))).slice(2), '0x' + bytesToHex(compressPoint(multiplyG(view))).slice(2));
  const payload = {
    spendingPrivateKey: spend, viewingPrivateKey: view, siskPrivateKey: sisk,
    protocolVersion: PROTOCOL_VERSION, schemeId: SCHEME_ID, chainId: CHAIN_ID,
    username: 'bob', metaAddress, fingerprint: metaFingerprint(metaAddress),
  };
  const envelope = await encryptBackup(payload, 'correct horse battery staple');
  assert.equal(envelope.format, BACKUP_FORMAT);
  assert.equal(envelope.version, BACKUP_VERSION);
  assert.equal(validateBackupEnvelope(envelope), true);
  assert.equal(JSON.stringify(envelope).includes('correct horse'), false, 'the passphrase never enters the envelope');
  assert.equal(JSON.stringify(envelope).includes(keyHex(spend).slice(2)), false, 'plaintext keys never enter the envelope');

  const restored = await decryptBackup(envelope, 'correct horse battery staple');
  assert.equal(restored.spendingPrivateKey, spend);
  assert.equal(restored.viewingPrivateKey, view);
  assert.equal(restored.siskPrivateKey, sisk);
  assert.equal(restored.metadata.fingerprint, payload.fingerprint);
  assert.equal(restored.metadata.metaAddress, metaAddress);
  assert.equal(restored.metadata.username, 'bob');

  await assert.rejects(decryptBackup(envelope, 'wrong passphrase'), /BACKUP_AUTHENTICATION_FAILED/);

  // Tamper: flip a ciphertext byte and also the public metadata (bound as AAD).
  const tampered = structuredClone(envelope);
  tampered.ciphertext = tampered.ciphertext.slice(0, -2) + (tampered.ciphertext.endsWith('00') ? '01' : '00');
  await assert.rejects(decryptBackup(tampered, 'correct horse battery staple'), /BACKUP_AUTHENTICATION_FAILED/);

  const metaTampered = structuredClone(envelope);
  metaTampered.fingerprint = 'deadbeef';
  await assert.rejects(decryptBackup(metaTampered, 'correct horse battery staple'), /BACKUP_FINGERPRINT_MISMATCH|BACKUP_AUTHENTICATION_FAILED/);

  // Weak KDF parameters are refused by the validator (downgrade protection).
  const weak = structuredClone(envelope);
  weak.kdf.N = 256;
  assert.throws(() => validateBackupEnvelope(weak), /BACKUP_WEAK_KDF_PARAMS/);
  const unversioned = structuredClone(envelope);
  unversioned.version = 99;
  assert.throws(() => validateBackupEnvelope(unversioned), /BACKUP_UNSUPPORTED_VERSION/);
  assert.throws(() => validateBackupEnvelope(null), /BACKUP_MALFORMED/);
});

test('backup envelope does not leak key material in its public fields', async () => {
  const spend = secret();
  const view = secret();
  const metaAddress = buildMetaAddress('0x' + bytesToHex(compressPoint(multiplyG(spend))).slice(2), '0x' + bytesToHex(compressPoint(multiplyG(view))).slice(2));
  const envelope = await encryptBackup(
    { spendingPrivateKey: spend, viewingPrivateKey: view, protocolVersion: 1, schemeId: 1, chainId: 4441, username: 'bob', metaAddress },
    'passphrase-abcdefgh',
  );
  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes(spend.toString(16)), false);
  assert.equal(envelope.passphrase, undefined);
  assert.equal(envelope.payload, undefined);
});

/* ------------------------------------------------------------------ local signing */
test('deterministic ECDSA matches @noble exactly', () => {
  for (let i = 0; i < 8; i += 1) {
    const k = secret();
    const digest = keccak256Bytes(new TextEncoder().encode(`veyra-sign-${i}`));
    const mine = signDigest(k, digest);
    const theirs = secp256k1.sign(digest, k.toString(16).padStart(64, '0'), { format: 'recovered', prehash: false });
    assert.equal(mine.r, BigInt('0x' + theirs.r.toString(16)));
    assert.equal(mine.s, BigInt('0x' + theirs.s.toString(16)));
    assert.equal(mine.recovery, theirs.recovery);
    assert.ok(mine.s <= N / 2n, 'low-s (EIP-2)');
  }
});

test('raw transactions are byte-identical to viem for both transaction types', async () => {
  for (let i = 0; i < 4; i += 1) {
    const k = secret();
    const account = privateKeyToAccount(keyHex(k));
    const base = {
      to: '0x' + 'ab'.repeat(20), value: BigInt(1000 + i * 7), nonce: i, gas: 21000n, chainId: CHAIN_ID,
    };
    const mine2 = signNativeTransfer({ privateKey: k, ...base, gasLimit: 21000n, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 500_000_000n, type: 'eip1559' });
    const theirs2 = await account.signTransaction({ ...base, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 500_000_000n, type: 'eip1559' });
    assert.equal(mine2.raw, theirs2);
    assert.equal(mine2.hash, keccak256(theirs2));

    const mine0 = signNativeTransfer({ privateKey: k, ...base, gasLimit: 21000n, gasPrice: 2_000_000_000n, type: 'legacy' });
    const theirs0 = await account.signTransaction({ ...base, gasPrice: 2_000_000_000n, type: 'legacy' });
    assert.equal(mine0.raw, theirs0);
    assert.equal(mine0.hash, keccak256(theirs0));
  }
});

test('transaction signing refuses bad recipients, zero values and missing gas data', () => {
  const k = secret();
  assert.throws(() => signNativeTransfer({ privateKey: k, to: '0xnope', value: 1n, nonce: 0, gasLimit: 21000n, chainId: CHAIN_ID, type: 'legacy', gasPrice: 1n }), /INVALID_RECIPIENT/);
  assert.throws(() => signNativeTransfer({ privateKey: k, to: '0x' + '11'.repeat(20), value: 0n, nonce: 0, gasLimit: 21000n, chainId: CHAIN_ID, type: 'legacy', gasPrice: 1n }), /AMOUNT_INVALID/);
  assert.throws(() => signNativeTransfer({ privateKey: k, to: '0x' + '11'.repeat(20), value: 1n, nonce: 0, gasLimit: 21000n, chainId: CHAIN_ID, type: 'eip1559' }), /GAS_PARAMETERS_REQUIRED/);
});

test('node:crypto can independently decrypt a Veyra backup envelope', async () => {
  const spend = secret();
  const view = secret();
  const metaAddress = buildMetaAddress('0x' + bytesToHex(compressPoint(multiplyG(spend))).slice(2), '0x' + bytesToHex(compressPoint(multiplyG(view))).slice(2));
  const envelope = await encryptBackup(
    { spendingPrivateKey: spend, viewingPrivateKey: view, protocolVersion: 1, schemeId: 1, chainId: 4441, username: 'bob', metaAddress },
    'passphrase-abcdefgh',
  );
  // node:crypto can decrypt what backup.js produced (independent AES-GCM path).
  const key = scryptSync('passphrase-abcdefgh', Buffer.from(hexToBytes('0x' + envelope.kdf.salt)), 32, {
    N: envelope.kdf.N, r: envelope.kdf.r, p: envelope.kdf.p, maxmem: 1 << 30,
  });
  const aad = Buffer.from(JSON.stringify([
    envelope.format, envelope.version, envelope.protocolVersion, envelope.schemeId,
    envelope.chainId, envelope.username, envelope.metaAddress, envelope.fingerprint,
    envelope.kdf.name, envelope.kdf.N, envelope.kdf.r, envelope.kdf.p, envelope.kdf.salt,
  ]));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(hexToBytes('0x' + envelope.cipher.iv)));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(hexToBytes('0x' + envelope.ciphertext).subarray(-16)));
  const body = Buffer.from(hexToBytes('0x' + envelope.ciphertext).subarray(0, -16));
  const plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
  const parsed = JSON.parse(plaintext.toString('utf8'));
  assert.equal(BigInt(parsed.spendingPrivateKey), spend);
  assert.equal(BigInt(parsed.viewingPrivateKey), view);
});
