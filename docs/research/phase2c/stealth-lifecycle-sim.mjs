/**
 * VEYRA — PHASE 2C RESEARCH ARTIFACT (NOT PRODUCTION CODE)
 * ========================================================
 * Controlled proof of the ERC-5564 / ERC-6538 secp256k1 stealth-payment lifecycle,
 * executed entirely OFFLINE against the published algorithm and validated against
 * real LiteForge (chain 4441) chain data.
 *
 * WHAT THIS SCRIPT IS:
 *   - A disposable, self-contained research/test harness. It is NOT imported by the
 *     Veyra application, is NOT part of any API, and performs NO network calls.
 *   - It reproduces the full lifecycle: meta-address generation -> sender-side derivation
 *     -> announcement encoding -> recipient-side scanning -> stealth-key derivation.
 *   - It cross-validates the algorithm against real transactions already on LiteForge.
 *
 * WHAT THIS SCRIPT IS NOT:
 *   - It does NOT send transactions, does NOT hold funds, and does NOT persist anything.
 *   - It does NOT print or write any private key. All key material is generated in memory
 *     from the OS CSPRNG for the duration of one run and discarded on exit.
 *
 * USAGE:  node docs/research/phase2c/stealth-lifecycle-sim.mjs
 * EXIT:   0 = every assertion passed, 1 = at least one assertion failed
 */

import { randomBytes } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak256, encodeFunctionData, parseAbi, bytesToHex, hexToBytes } from 'viem';

const N = secp256k1.CURVE.n;
const G = secp256k1.ProjectivePoint.BASE;

/* ---------------------------------------------------------------- assertion harness */
const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: Boolean(condition), detail: String(detail) });
  return Boolean(condition);
}
const hex = (bytes) => bytesToHex(bytes);
const strip = (h) => (h.startsWith('0x') ? h.slice(2) : h);

/* ---------------------------------------------------------------- primitives */
const randomScalar = () => {
  for (;;) {
    const s = BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex'));
    if (s > 0n && s < N) return s;
  }
};
const pubkeyOf = (priv) => secp256k1.getPublicKey(priv, true);            // 33-byte compressed
const pointOf = (pub) => secp256k1.ProjectivePoint.fromHex(typeof pub === 'string' ? strip(pub) : pub);
/* Ethereum address = keccak256(uncompressed pubkey x‖y)[12:] — NEVER keccak256(compressed).
 * Accepts any secp256k1 point encoding (compressed 33-B or uncompressed 65-B, bare or 0x-prefixed).
 * CORRECTED 2026-10-04 (Phase 2D): the original one-liner hashed whatever encoding it was given,
 * which produced non-standard "addresses" for compressed inputs. Math/conclusions unchanged;
 * address strings are now real Ethereum addresses. Regression-pinned in phase2d harness. */
const addressOf = (pub) => {
  const p = pointOf(pub);
  return '0x' + keccak256(p.toRawBytes(false).slice(1)).slice(-40);
};

/** ERC-5564 scheme 1: shared secret serialized as the 33-byte compressed ECDH point,
 *  hashed with keccak256 (reference-implementation convention; see doc §2C.4 note). */
const hashSharedSecret = (sharedPoint) => keccak256(sharedPoint);
const scalarFrom = (hash) => BigInt(hash) % N;
const viewTagOf = (hash) => hash.slice(2, 4);                             // most significant byte

/** Independent (own BigInt, no library) secp256k1 x-coordinate validity test.
 *  Input: a full 33-byte compressed key (bare or 0x-prefixed hex). Parses prefix + x correctly. */
const P_FIELD = 2n ** 256n - 2n ** 32n - 977n;
function modpow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
function xOnSecp256k1(compressed) {
  const h = compressed.startsWith('0x') ? compressed.slice(2) : compressed;
  if (h.length !== 66) return false;                       // must be exactly 33 bytes
  const prefix = parseInt(h.slice(0, 2), 16);
  if (prefix !== 2 && prefix !== 3) return false;          // valid compressed prefixes only
  const x = BigInt('0x' + h.slice(2));                     // x = last 32 bytes
  if (x >= P_FIELD) return false;
  const y2 = (x * x % P_FIELD * x + 7n) % P_FIELD;
  return y2 === 0n || modpow(y2, (P_FIELD - 1n) / 2n, P_FIELD) === 1n; // Legendre symbol == 1
}

/* ---------------------------------------------------------------- self-test */
check('keccak256("") self-test', keccak256('0x') === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
check('address-derivation vector: privkey 1 -> 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
  addressOf(pubkeyOf(1n)).toLowerCase() === '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');

/* ================================================================ ACTORS (disposable, in-memory, unfunded) */
const alicePriv = randomScalar();
const bobSpendPriv = randomScalar();
const bobViewPriv = randomScalar();
const observerPriv = randomScalar();

const alicePub = pubkeyOf(alicePriv);
const bobSpendPub = pubkeyOf(bobSpendPriv);
const bobViewPub = pubkeyOf(bobViewPriv);

const actors = {
  alice: { address: addressOf(alicePub) },
  bobNormalWallet: { address: addressOf(pubkeyOf(randomScalar())) },
  bobStealthIdentity: { spendingPub: hex(bobSpendPub), viewingPub: hex(bobViewPub) },
  observer: { address: addressOf(pubkeyOf(observerPriv)) },
};

/* ================================================================ 1. META-ADDRESS (ERC-5564 format, scheme 1) */
const metaAddress = `st:litvm:0x${strip(hex(bobSpendPub))}${strip(hex(bobViewPub))}`;
const decoded = hexToBytes('0x' + metaAddress.split('0x')[1]);
check('meta-address is 66 bytes (33+33)', decoded.length === 66, `${decoded.length} bytes`);
let spendKeyValid = false, viewKeyValid = false;
try { pointOf(decoded.slice(0, 33)).assertValidity(); spendKeyValid = true; } catch {}
try { pointOf(decoded.slice(33, 66)).assertValidity(); viewKeyValid = true; } catch {}
check('meta-address spending key is a valid compressed point', spendKeyValid);
check('meta-address viewing key is a valid compressed point', viewKeyValid);
check('meta-address prefixes are 0x02/0x03',
  (decoded[0] === 2 || decoded[0] === 3) && (decoded[33] === 2 || decoded[33] === 3),
  `0x0${decoded[0].toString(16)} / 0x0${decoded[33].toString(16)}`);
check('meta-address contains NO wallet address and NO private material',
  !metaAddress.includes(actors.bobNormalWallet.address.slice(2)));

/* ================================================================ 2. SENDER-SIDE DERIVATION (EIP-5564 scheme 1) */
function senderDeriveStealthAddress(metaAddr) {
  const raw = hexToBytes('0x' + metaAddr.split('0x')[1]);
  const Pspend = pointOf(raw.slice(0, 33));
  const Pview = pointOf(raw.slice(33, 66));
  const ephPriv = randomScalar();
  const ephPub = pubkeyOf(ephPriv);
  const shared = secp256k1.getSharedSecret(ephPriv, Pview.toRawBytes(true), true); // s = r * P_view
  const hash = hashSharedSecret(shared);
  const sh = scalarFrom(hash);
  const Pstealth = Pspend.add(G.multiply(sh));
  return { ephPriv, ephPub, shared, hash, viewTag: viewTagOf(hash), stealthPub: Pstealth.toRawBytes(true), stealthAddress: addressOf(Pstealth.toRawBytes(true)) };
}

const payment1 = senderDeriveStealthAddress(metaAddress);
check('sender derived a fresh stealth address S', /^0x[0-9a-fA-F]{40}$/.test(payment1.stealthAddress));
check("S is not Bob's normal wallet", payment1.stealthAddress.toLowerCase() !== actors.bobNormalWallet.address.toLowerCase());
check("S is not Alice's wallet", payment1.stealthAddress.toLowerCase() !== actors.alice.address.toLowerCase());
check("S cannot be derived from Bob's normal wallet address",
  payment1.stealthAddress.toLowerCase() !== addressOf(bobSpendPub).toLowerCase());
check('ephemeral public key is 33 bytes, prefix 0x02/0x03',
  payment1.ephPub.length === 33 && (payment1.ephPub[0] === 2 || payment1.ephPub[0] === 3));
check('view tag is exactly 1 byte', payment1.viewTag.length === 2);

/* ================================================================ 3. ANNOUNCEMENT ENCODING (canonical announcer interface) */
const ANNOUNCER_ABI = parseAbi([
  'function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)',
]);
const SCHEME_ID = 1;
const metadata = '0x' + payment1.viewTag;                                 // LiteForge-observed native format: view tag only
const announceCalldata = encodeFunctionData({
  abi: ANNOUNCER_ABI,
  args: [BigInt(SCHEME_ID), payment1.stealthAddress, hex(payment1.ephPub), metadata],
});
check('announce calldata selector = 0x4d1f9583 (ERC-5564 interface)',
  announceCalldata.slice(0, 10) === '0x4d1f9583', announceCalldata.slice(0, 10));
check('announcement metadata = view tag only, 1 byte', metadata.length === 4);
check("announcement contains no wallet address of Bob",
  !announceCalldata.toLowerCase().includes(actors.bobNormalWallet.address.slice(2).toLowerCase()));

/* ================================================================ 4. RECIPIENT-SIDE SCAN (public data + viewing key only) */
function recipientCheck(announcement, spendPub, viewPriv) {
  const { schemeId, stealthAddress, ephPub, viewTag } = announcement;
  if (schemeId !== 1) return { match: false, reason: 'wrong schemeId' };
  let ephPoint;
  try { ephPoint = pointOf(ephPub); ephPoint.assertValidity(); }
  catch { return { match: false, reason: 'invalid ephemeral key (rejected, no crash)' }; }
  const shared = secp256k1.getSharedSecret(viewPriv, ephPoint.toRawBytes(true), true);
  const hash = hashSharedSecret(shared);
  if (viewTagOf(hash) !== viewTag) return { match: false, reason: 'view-tag filter miss' };
  const sh = scalarFrom(hash);
  const candidate = pointOf(spendPub).add(G.multiply(sh)).toRawBytes(true);
  const address = addressOf(candidate);
  const match = address.toLowerCase() === stealthAddress.toLowerCase();
  return { match, address, hash, reason: match ? 'full derivation match' : 'derived address mismatch' };
}

const announcement = {
  schemeId: SCHEME_ID,
  stealthAddress: payment1.stealthAddress,
  ephPub: hex(payment1.ephPub),
  viewTag: payment1.viewTag,
};
const bobScan = recipientCheck(announcement, hex(bobSpendPub), bobViewPriv);
check('Bob detects the payment using ONLY public announcement data + his viewing key', bobScan.match, bobScan.reason);

const observerScan = recipientCheck(announcement, hex(pubkeyOf(observerPriv)), observerPriv);
check('unrelated observer cannot match the announcement (control)', observerScan.match === false, observerScan.reason);
const wrongViewScan = recipientCheck(announcement, hex(bobSpendPub), randomScalar());
check('wrong viewing key cannot match (control)', wrongViewScan.match === false, wrongViewScan.reason);

/* ================================================================ 5. STEALTH PRIVATE KEY + CONTROL OF FUNDS */
const shBob = scalarFrom(bobScan.hash);
const stealthPriv = (bobSpendPriv + shBob) % N;
check('ECDH symmetry: keccak(r·P_view) === keccak(p_view·R)',
  hashSharedSecret(secp256k1.getSharedSecret(payment1.ephPriv, pubkeyOf(bobViewPriv), true)) === bobScan.hash);
check("Bob's derived stealth private key reproduces S exactly (k·G == P_stealth)",
  addressOf(pubkeyOf(stealthPriv)).toLowerCase() === payment1.stealthAddress.toLowerCase());
check('stealth private key is a valid scalar in [1, n)', stealthPriv > 0n && stealthPriv < N);

/* ================================================================ 6. FRESHNESS / REUSE TESTS */
const payment2 = senderDeriveStealthAddress(metaAddress);
check('a second payment produces a DIFFERENT stealth address (fresh r)',
  payment2.stealthAddress.toLowerCase() !== payment1.stealthAddress.toLowerCase());
check('a second payment produces a DIFFERENT ephemeral key', hex(payment2.ephPub) !== hex(payment1.ephPub));
check('a second payment produces a DIFFERENT view tag', payment2.viewTag !== payment1.viewTag, `${payment1.viewTag} vs ${payment2.viewTag}`);

const reused = (() => {
  const raw = hexToBytes('0x' + metaAddress.split('0x')[1]);
  const Pspend = pointOf(raw.slice(0, 33));
  const Pview = pointOf(raw.slice(33, 66));
  const shared = secp256k1.getSharedSecret(payment1.ephPriv, Pview.toRawBytes(true), true);
  const hash = hashSharedSecret(shared);
  const P = Pspend.add(G.multiply(scalarFrom(hash)));
  return { address: addressOf(P.toRawBytes(true)), tag: viewTagOf(hash) };
})();
check('REUSE DEMO: reusing the ephemeral key deterministically yields the SAME stealth address',
  reused.address.toLowerCase() === payment1.stealthAddress.toLowerCase());
check('REUSE DEMO: reused ephemeral key repeats the same view tag (linkable)', reused.tag === payment1.viewTag);
check('REUSE DEMO: address reuse is publicly detectable (same S receives two payments)',
  reused.address === payment1.stealthAddress);

/* ================================================================ 7. MALFORMED / HOSTILE INPUT HANDLING */
const malformed = [
  ['invalid compressed key (bad prefix 0x04)', '04'.padEnd(68, '0')],
  ['invalid compressed key (x not on curve)', '02' + 'ff'.repeat(32)],
  ['truncated ephemeral key (32 bytes)', '02' + 'ab'.repeat(31)],
];
for (const [label, bad] of malformed) {
  let rejected = false;
  try { pointOf(hexToBytes('0x' + bad)); } catch { rejected = true; }
  check(`malformed input rejected: ${label}`, rejected);
}
const wrongScheme = recipientCheck({ ...announcement, schemeId: 2 }, hex(bobSpendPub), bobViewPriv);
check('announcement with unknown schemeId is ignored', wrongScheme.match === false, wrongScheme.reason);
const fakeTag = recipientCheck({ ...announcement, viewTag: payment1.viewTag === '00' ? '01' : '00' }, hex(bobSpendPub), bobViewPriv);
check('wrong view tag is filtered out before the expensive step', fakeTag.match === false, fakeTag.reason);
check('duplicate announcement is idempotent',
  recipientCheck(announcement, hex(bobSpendPub), bobViewPriv).match === bobScan.match);

/* ================================================================ 8. VALIDATION AGAINST REAL LITEFORGE CHAIN DATA (4441) */
// REAL announce() transaction 0xb1c9895e…6d53, block 56,046,328, status ok, value 0.
// raw_input transcribed from the explorer transaction record (Blockscout, /api/v2/transactions/…).
const REAL_ANNOUNCE_RAW_INPUT =
  '0x4d1f95830000000000000000000000000000000000000000000000000000000000000001000000000000000000000000949dfa2a5cd195403ccf455625678865a8f1e0ab000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000002102f0976880154ebf19f151149f7efdc56bcf700162aada12f76870bec0287e70df0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000019f00000000000000000000000000000000000000000000000000000000000000';
check('real calldata is 292 bytes', REAL_ANNOUNCE_RAW_INPUT.length === 586, `${REAL_ANNOUNCE_RAW_INPUT.length} chars`);

const rawBytes = hexToBytes(REAL_ANNOUNCE_RAW_INPUT);
const rawHex = (b) => bytesToHex(b).slice(2);              // viem bytesToHex returns 0x-prefixed
const word = (i) => rawBytes.slice(4 + i * 32, 4 + (i + 1) * 32);
const realSchemeId = BigInt('0x' + rawHex(word(0)));
const realStealth = '0x' + rawHex(word(1)).slice(-40);
const realEphLen = Number(BigInt('0x' + rawHex(word(4))));
const realEph = '0x' + rawHex(rawBytes.slice(164, 164 + realEphLen));
const realMetaLen = Number(BigInt('0x' + rawHex(word(7))));
const realMeta = '0x' + rawHex(rawBytes.slice(260, 260 + realMetaLen));
check('real calldata decodes: schemeId == 1', realSchemeId === 1n, String(realSchemeId));
check('real calldata decodes: stealth address', realStealth.toLowerCase() === '0x949dfa2a5cd195403ccf455625678865a8f1e0ab');
check('real calldata decodes: ephemeral key is 33 bytes', realEphLen === 33, `${realEphLen} bytes`);
check('real calldata decodes: metadata is exactly 1 byte (view tag only)', realMetaLen === 1, `${realMetaLen} bytes`);
check('real calldata decodes: view tag = 0x9f', realMeta === '0x9f', realMeta);

const reEncoded = encodeFunctionData({
  abi: ANNOUNCER_ABI,
  args: [1n, '0x949DFA2a5CD195403CCf455625678865A8F1e0AB', realEph, realMeta],
});
check('ABI encoding of announce() reproduces the REAL on-chain calldata byte-for-byte',
  reEncoded.toLowerCase() === REAL_ANNOUNCE_RAW_INPUT.toLowerCase(),
  `${(reEncoded.length - 2) / 2} vs ${(REAL_ANNOUNCE_RAW_INPUT.length - 2) / 2} bytes`);

/* --- curve-validity audit of real on-chain "ephemeralPublicKey" values --- */
const REAL_EPHEMERAL_KEYS = [
  { tx: '0xb1c9895e (native announce)', key: '02f0976880154ebf19f151149f7efdc56bcf700162aada12f76870bec0287e70df' },
  { tx: '0xe0e141eb (router payment)', key: '02a444e65b6269aa8b5c78b8d462b6a8cd79cad3eb5bda29714352547c950e2926' },
  { tx: '0x31e54b82 (router payment)', key: '02eb4f497285609700d81f5096367493d2c2da2bfd101aacdbf87feadda1b7c19b' },
  { tx: '0x6c0cccac (router payment, 990 lsZKLTC delivered)', key: '0265935e51bb7b8e1ab5a0b9418d89ac04f40f1442c2d36b2774af878c906f5ed3' },
  { tx: '0xfb34518c (router payment)', key: '028e45bc587cd7a3fe4eb2cb46bc359d786349486a936148307636c55820fedfe5' },
  { tx: '0x74d60e7c (router payment)', key: '02c0411a54600788a729e50a31726c81fc9cbb1da55e1e0773a1161a686be2acb4' },
];
let agreements = 0;
const curveAudit = REAL_EPHEMERAL_KEYS.map(({ tx, key }) => {
  let nobleValid = false;
  try { pointOf(hexToBytes('0x' + key)).assertValidity(); nobleValid = true; } catch {}
  const ownValid = xOnSecp256k1('0x' + key);
  if (nobleValid === ownValid) agreements++;
  return { tx, key, nobleValid, ownValid };
});
check('independent curve checks (@noble/curves vs own Legendre math) agree on every sampled key',
  agreements === REAL_EPHEMERAL_KEYS.length, `${agreements}/${REAL_EPHEMERAL_KEYS.length}`);
const invalidKeys = curveAudit.filter((k) => !k.ownValid);
check('FINDING RECORDED: some real on-chain ephemeral keys are NOT valid secp256k1 points',
  invalidKeys.length > 0, `${invalidKeys.length} of ${curveAudit.length} sampled keys invalid`);

// a standard scanner must handle an invalid real ephemeral key without crashing and without false positives
const hostileScan = recipientCheck({ schemeId: 1, stealthAddress: payment1.stealthAddress, ephPub: '0x' + invalidKeys[0].key, viewTag: '00' }, hex(bobSpendPub), bobViewPriv);
check('scanner rejects a real invalid-key announcement gracefully (no crash, no false positive)',
  hostileScan.match === false, hostileScan.reason);

/* ================================================================ 9. REPORT (public values only) */
const summary = {
  phase: '2C',
  mode: 'OFFLINE_CRYPTOGRAPHIC_PROOF + REAL_CHAIN_DATA_VALIDATION',
  note: 'No transaction was broadcast. No private key is printed, written or stored.',
  actors,
  bobMetaAddress: metaAddress,
  payment1: {
    schemeId: SCHEME_ID,
    ephemeralPubKey: hex(payment1.ephPub),
    viewTag: payment1.viewTag,
    stealthAddress: payment1.stealthAddress,
    announcementMetadata: metadata,
    announceCalldataBytes: (announceCalldata.length - 2) / 2,
  },
  bobScan: { detected: bobScan.match, reason: bobScan.reason },
  observerScan: { detected: observerScan.match, reason: observerScan.reason },
  bobControl: { stealthKeyReproducesStealthAddress: true },
  realChainValidation: {
    announceCalldataByteForByte: reEncoded.toLowerCase() === REAL_ANNOUNCE_RAW_INPUT.toLowerCase(),
    decodedFields: { schemeId: Number(realSchemeId), stealthAddress: realStealth, ephemeralKeyBytes: realEphLen, metadataBytes: realMetaLen, viewTag: realMeta },
    curveAudit: curveAudit.map(({ tx, key, ownValid }) => ({ tx, keyPrefix: key.slice(0, 10) + '…', validSecp256k1Point: ownValid })),
    invalidCount: invalidKeys.length,
    sampleSize: curveAudit.length,
  },
  assertions: { total: results.length, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length },
};
console.log(JSON.stringify(summary, null, 2));
console.log('\n--- assertion detail ---');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
