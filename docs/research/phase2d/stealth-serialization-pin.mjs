#!/usr/bin/env node
/* ============================================================================================
 * Phase 2D research harness — ERC-5564 scheme-1 SERIALIZATION PIN + key-recovery derivation pins
 * ============================================================================================
 * RESEARCH ONLY. Not imported by the application, not part of any production path.
 *
 * WHY THIS FILE EXISTS
 *   EIP-5564 scheme 1 pins the *shape* of the algorithm (ECDH, keccak, point addition) but NOT the
 *   byte serialization of the shared secret, and not the exact tag/scalar rules. Two conforming
 *   implementations can therefore derive different stealth addresses from the same inputs. This
 *   harness pins the exact convention used by the canonical third-party implementation
 *   (@scopelift/stealth-address-sdk, src/utils/crypto/generateStealthAddress.ts, read 2026-10-04)
 *   and re-verifies it against: (a) upstream public test vectors, (b) a real LiteForge announce()
 *   transaction, (c) public registry data fetched in Phase 2D, (d) an independent legacy-math
 *   curve checker.
 *
 * KEY MATERIAL / SAFETY
 *   - No private key, seed phrase, or secret-bearing signature is embedded in this file.
 *   - Spend/view/stealth keys are generated in memory per run and discarded.
 *   - The only fixed scalar is the universally published test vector "scalar 1" (address check).
 *   - On-chain samples are PUBLIC data (announce calldata, registry event logs).
 *
 * Provenance of quoted data:
 *   - upstream vector meta-address + view-tag vector: ScopeLift/stealth-address-sdk test suite
 *   - real announce() calldata: LiteForge tx 0xb1c9895e…6d53 (block 56,046,328), read via Blockscout
 *   - registry logs: LiteForge ERC-6538-shaped registry 0x6538E6bf…6538, /logs, read 2026-10-04
 *
 * Exit code 0 = every assertion passed; 1 = at least one failed.
 * ============================================================================================ */

import { randomBytes } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak256, encodeFunctionData, decodeFunctionData, parseAbi, hexToBytes, bytesToHex } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';

/* ------------------------------------------------------------------ harness plumbing */
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
}
const strip = (h) => (typeof h === 'string' && h.startsWith('0x') ? h.slice(2) : h);
const hex = (u8) => '0x' + Buffer.from(u8).toString('hex');
const bytes = (h) => hexToBytes(h.startsWith('0x') ? h : '0x' + h);
const N = secp256k1.CURVE.n;
const G = secp256k1.ProjectivePoint.BASE;
const randomScalar = () => {
  for (;;) {
    const s = BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex'));
    if (s > 0n && s < N) return s;
  }
};
const pointOf = (pub) => secp256k1.ProjectivePoint.fromHex(strip(pub));
const pubkeyOf = (priv, compressed = true) => secp256k1.getPublicKey(priv, compressed);
/** Pinned address rule: keccak256(uncompressed pubkey x‖y)[12:]. Accepts 33-B or 65-B encodings. */
const addressOf = (pub) => '0x' + keccak256(pointOf(pub).toRawBytes(false).slice(1)).slice(-40);
/** Pinned ECDH + hash rule: shared point serialized COMPRESSED (33 B) and hashed with keccak256. */
const ecdhHash = (privA, pubB) => keccak256(secp256k1.getSharedSecret(privA, pointOf(pubB).toRawBytes(true), true));
/** Pinned scalar rule: keccak output read as a big-endian scalar; reduction mod n is a no-op in practice. */
const scalarFrom = (hash) => BigInt(hash) % N;
const viewTagOf = (hash) => hash.slice(2, 4);

/* independent (no library) secp256k1 x-validity test — legacy Legendre math, corrected in 2C */
const P_FIELD = 2n ** 256n - 2n ** 32n - 977n;
function modpow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
function xOnSecp256k1(compressed) {
  const h = strip(compressed);
  if (h.length !== 66) return false;
  const prefix = parseInt(h.slice(0, 2), 16);
  if (prefix !== 2 && prefix !== 3) return false;
  const x = BigInt('0x' + h.slice(2));
  if (x >= P_FIELD) return false;
  const y2 = (x * x % P_FIELD * x + 7n) % P_FIELD;
  return y2 === 0n || modpow(y2, (P_FIELD - 1n) / 2n, P_FIELD) === 1n;
}

/* ============================================================ A. SERIALIZATION PINS */
check('A01 keccak256("") vector', keccak256('0x') === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
check('A02 address vector: scalar 1 -> 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
  addressOf(pubkeyOf(1n)) === '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', addressOf(pubkeyOf(1n)));
check('A03 viem/accounts privateKeyToAddress agrees with pinned rule (scalar 1)',
  privateKeyToAddress('0x' + 1n.toString(16).padStart(64, '0')).toLowerCase() === addressOf(pubkeyOf(1n)));
check('A04 WRONG variant diverges: keccak256(compressed key) != pinned address (this was the 2C bug)',
  '0x' + keccak256(pubkeyOf(1n, true)).slice(-40) !== addressOf(pubkeyOf(1n)));
check('A05 WRONG variant diverges: keccak256(x-only 32 B) != pinned address',
  '0x' + keccak256(pubkeyOf(1n, true).slice(1)).slice(-40) !== addressOf(pubkeyOf(1n)));

/* --- meta-address parsing: EIP format + reference-SDK tolerance + Veyra policy --- */
const UPSTREAM_META = '0x033404e82cd2a92321d51e13064ec13a0fb0192a9fdaaca1cfb47b37bd27ec13970390ad5eca026c05ab5cf4d620a2ac65241b11df004ddca360e954db1b26e3846e';
const UPSTREAM_SPEND = '033404e82cd2a92321d51e13064ec13a0fb0192a9fdaaca1cfb47b37bd27ec1397';
const UPSTREAM_VIEW = '0390ad5eca026c05ab5cf4d620a2ac65241b11df004ddca360e954db1b26e3846e';
function parseMetaAddress(input) {
  const payload = strip(input.includes(':') ? input.slice(input.lastIndexOf(':') + 1) : input);
  if (!/^[0-9a-fA-F]+$/.test(payload)) return { ok: false, reason: 'non-hex payload' };
  if (payload.length !== 66 && payload.length !== 132) return { ok: false, reason: `bad payload length ${payload.length} hex chars` };
  const singleKeyForm = payload.length === 66;
  const spendPub = payload.slice(0, 66);
  const viewPub = singleKeyForm ? spendPub : payload.slice(66, 132);
  return { ok: true, singleKeyForm, spendPub, viewPub, raw: payload };
}
/** Veyra policy: single-key (spend==view) meta-addresses MUST be refused — sharing a viewing key
 *  would otherwise disclose spending capability. */
const acceptForVeyra = (parsed) => parsed.ok && !parsed.singleKeyForm;
const upstream = parseMetaAddress('st:eth:' + UPSTREAM_META);
check('A06 URI parse: st:<chain>:0x<66B> accepted', upstream.ok && !upstream.singleKeyForm, upstream.reason || '');
check('A07 parsed spending key == upstream published half', upstream.spendPub === UPSTREAM_SPEND);
check('A08 parsed viewing key == upstream published half', upstream.viewPub === UPSTREAM_VIEW);
check('A09 both upstream keys are on secp256k1 (independent Legendre math)',
  xOnSecp256k1(upstream.spendPub) && xOnSecp256k1(upstream.viewPub));
const single = parseMetaAddress('0x' + UPSTREAM_SPEND);
check('A10 single-key 33-B form is PARSED by reference-SDK convention (spend==view)', single.ok && single.singleKeyForm);
check('A11 Veyra policy REFUSES the single-key form (viewing key must not double as spending key)', acceptForVeyra(single) === false);
check('A12 malformed meta-address rejected (odd length)', parseMetaAddress('0x1234').ok === false);

/* --- ECDH serialization: the interop-critical pin --- */
const recvSpendPriv = randomScalar();
const recvViewPriv = randomScalar();
const Pspend = pointOf(pubkeyOf(recvSpendPriv));
const Pview = pointOf(pubkeyOf(recvViewPriv));
const ephPriv = randomScalar();
const ephPub = pubkeyOf(ephPriv);
const sCompressed = secp256k1.getSharedSecret(ephPriv, pubkeyOf(recvViewPriv), true);
const sIndependent = Pview.multiply(ephPriv);                 // independent path: point scalar-mult
const sUncompressed = sIndependent.toRawBytes(false);
const sXOnly = sIndependent.toRawBytes(false).slice(1, 33);
check('A13 ECDH shared secret is the 33-byte COMPRESSED point (prefix 02/03)',
  sCompressed.length === 33 && (sCompressed[0] === 2 || sCompressed[0] === 3), `${sCompressed.length} bytes`);
check('A14 noble getSharedSecret == independent point multiplication (byte-for-byte)',
  Buffer.compare(Buffer.from(sCompressed), Buffer.from(sIndependent.toRawBytes(true))) === 0);
const hC = keccak256(sCompressed), hU = keccak256(sUncompressed), hX = keccak256(sXOnly);
check('A15 DIVERGENCE DEMO: compressed / uncompressed / x-only serializations yield three different hashes (must be pinned)',
  hC !== hU && hU !== hX && hC !== hX);
check('A16 ECDH symmetry: keccak(r·V) == keccak(v·R)',
  hC === ecdhHash(recvViewPriv, ephPub));
check('A17 view tag = most-significant byte of the hash', viewTagOf(hC) === hC.slice(2, 4));
const UPSTREAM_HASH = '0x158ce29a3dd0c8dca524e5776c2ba6361c280e013f87eee5eb799a713a939501';
check('A18 upstream view-tag vector: 0x158ce29a… -> 0x15', viewTagOf(UPSTREAM_HASH) === '15');

/* --- scalar + point derivation pins --- */
const sh = scalarFrom(hC);
const pStealth = (recvSpendPriv + sh) % N;
const Pstealth = Pspend.add(G.multiply(sh));
check('A19 hash->scalar: 0 < sh < n and mod-n reduction is currently a no-op', sh > 0n && sh < N && (BigInt(hC) % N) === BigInt(hC));
check('A20 h < n for this sample means keccak output is used directly (reduction matters only with prob < 2^-128)',
  BigInt(hC) < N);
check('A21 stealth public key P = P_spend + sh·G is a valid 33-B compressed point',
  (() => { try { Pstealth.assertValidity(); return Pstealth.toRawBytes(true).length === 33; } catch { return false; } })());
check('A22 SCALAR-ADDITION EDGE CASE: (n-1)·G + 2·G == 1·G (mod-n reduction proven on curve)',
  Buffer.compare(
    Buffer.from(pointOf(pubkeyOf(N - 1n)).add(G.multiply(2n)).toRawBytes(true)),
    Buffer.from(pubkeyOf(1n))) === 0);
check('A23 core identity: p_stealth·G == P_spend + sh·G (byte-for-byte, compressed)',
  Buffer.compare(Buffer.from(pubkeyOf(pStealth)), Buffer.from(Pstealth.toRawBytes(true))) === 0);
check('A24 stealth address derived via pinned rule == viem privateKeyToAddress(p_stealth)',
  addressOf(Pstealth.toRawBytes(true)) === privateKeyToAddress('0x' + pStealth.toString(16).padStart(64, '0')).toLowerCase());

/* --- announcement encoding --- */
const ANNOUNCER_ABI = parseAbi([
  'function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)',
  'event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)',
]);
const S = addressOf(Pstealth.toRawBytes(true));
const tag = viewTagOf(hC);
const calldata = encodeFunctionData({ abi: ANNOUNCER_ABI, args: [1n, S, hex(ephPub), '0x' + tag] });
check('A25 announce() selector == 0x4d1f9583', calldata.slice(0, 10) === '0x4d1f9583', calldata.slice(0, 10));
const decoded = decodeFunctionData({ abi: ANNOUNCER_ABI, data: calldata });
check('A26 encode->decode round trip preserves schemeId / stealthAddress / ephemeralPubKey / metadata',
  decoded.args[0] === 1n && decoded.args[1].toLowerCase() === S.toLowerCase() &&
  decoded.args[2].toLowerCase() === hex(ephPub).toLowerCase() && decoded.args[3] === '0x' + tag);
/* real LiteForge announce() calldata, byte-for-byte */
const REAL_ANNOUNCE_RAW_INPUT =
  '0x4d1f95830000000000000000000000000000000000000000000000000000000000000001000000000000000000000000949dfa2a5cd195403ccf455625678865a8f1e0ab000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000002102f0976880154ebf19f151149f7efdc56bcf700162aada12f76870bec0287e70df0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000019f00000000000000000000000000000000000000000000000000000000000000';
const rb = bytes(REAL_ANNOUNCE_RAW_INPUT);
const at = (start, len) => bytesToHex(rb.slice(start, start + len)).slice(2);  // hex of bytes[start, start+len)
const w = (i) => at(4 + i * 32, 32);                                           // i-th ABI word (selector is 4 B)
const realEphLen = Number(BigInt('0x' + w(4)));                                // head: [schemeId, stealth, off, off] => len at word 4
const realEph = '0x' + at(164, realEphLen);                                    // eph data starts at 4 + 128 + 32
const realMetaLen = Number(BigInt('0x' + w(7)));                               // meta len after 64 B of eph padding
const realMeta = '0x' + at(260, realMetaLen);
const reEncoded = encodeFunctionData({ abi: ANNOUNCER_ABI, args: [1n, '0x949DFA2a5CD195403CCf455625678865A8F1e0AB', realEph, realMeta] });
check('A27 real announce tx: calldata is 292 bytes and decodes schemeId=1, eph 33 B, meta 1 B (view tag 0x9f)',
  rb.length === 292 && BigInt('0x' + w(0)) === 1n && realEphLen === 33 && realMetaLen === 1 && realMeta === '0x9f');
check('A28 ABI re-encode reproduces the REAL on-chain calldata byte-for-byte',
  reEncoded.toLowerCase() === REAL_ANNOUNCE_RAW_INPUT.toLowerCase());

/* --- malformed ephemeral key handling (includes a REAL invalid on-chain key) --- */
function scannerCheck({ schemeId, stealthAddress, ephPub, viewTag }, spendPub, viewPriv) {
  if (schemeId !== 1) return { match: false, reason: 'unsupported schemeId' };
  let E;
  try { E = pointOf(ephPub); E.assertValidity(); } catch { return { match: false, reason: 'invalid ephemeral key (rejected, no crash)' }; }
  const h = ecdhHash(viewPriv, E.toRawBytes(true));
  if (viewTagOf(h) !== viewTag) return { match: false, reason: 'view-tag miss' };
  const cand = addressOf(pointOf(spendPub).add(G.multiply(scalarFrom(h))).toRawBytes(true));
  return { match: cand.toLowerCase() === stealthAddress.toLowerCase(), reason: cand.toLowerCase() === stealthAddress.toLowerCase() ? 'match' : 'address mismatch' };
}
const malformed = [
  ['bad prefix 0x04', '04'.padEnd(68, '0')],
  ['x not on curve', '02' + 'ff'.repeat(32)],
  ['truncated 32 B', '02' + 'ab'.repeat(31)],
  ['all-zero', '00'.repeat(33)],
  ['REAL on-chain invalid key (tx 0xb1c9895e)', '02f0976880154ebf19f151149f7efdc56bcf700162aada12f76870bec0287e70df'],
];
let malformedRejected = 0;
for (const [label, bad] of malformed) {
  let r;
  try { r = scannerCheck({ schemeId: 1, stealthAddress: S, ephPub: '0x' + bad, viewTag: tag }, pubkeyOf(recvSpendPriv), recvViewPriv); }
  catch (e) { r = { match: 'THREW', reason: String(e) }; }
  if (r.match === false && /rejected/.test(r.reason)) malformedRejected++;
}
check('A29 all 5 malformed/real-invalid ephemeral keys are rejected gracefully (no crash, no match)',
  malformedRejected === malformed.length, `${malformedRejected}/${malformed.length}`);
check('A30 own Legendre checker agrees with noble on all malformed samples',
  malformed.every(([, bad]) => xOnSecp256k1(bad) === (() => { try { pointOf(bad).assertValidity(); return true; } catch { return false; } })()));

/* --- public registry data fetched in Phase 2D (ERC-6538-shaped registry logs) --- */
const REGISTRY_2D = [
  ['55,575,524', '023f9831902cd1c8d2eb36f512972b53ca6ab5d3fd7a3ace4e03d75d81aebc6fd60313abfd5d7b8653912806965e13c193a5cc23bdbb25cb97b98b5a768a23f1aebd'],
  ['55,573,929', '0353cd6f133a099603929b1e073e6af5f1c74d1013f29f8e5077768a6fe27be81403786cfdb132d197209876f219a74cbc56572444bc2f4256497df158a34e1afa3f'],
  ['55,572,885', '020d341601950d67bb6b3c2e04170d386dacdad46370ce7fe6e279ef999a7f745b03706e30fcf05f1d0f018910054c5fc42e1fc45c82c760e1e789be10037e1671b5'],
  ['44,245,733', '03c606bf5b994779734b8a7dccbf612195763d02243780152b194c9c6ac22a356002669c9dfe14b663ce65016b8ae1dd2c57fabb9e41d3d2f9706cbbf69121bd4d41'],
  ['34,373,123', '021e39302c7342533599a1fb33da0502284fb1dae5872f68b70743302229182dcf022166365c68243efba4e68998f56b017eba5183e53b07fe695a9853d222b3659e'],
  ['34,318,271', '029be7490930893e83ee6677d8a3562aea673a2dd03dab785bd3c28164fa811d460309d79b2b01217b9a01e36fa6bbc49d6f2876083b9fd19a85aee5eaa30ce327b2'],
];
let regParsed = 0, regPrefixOk = 0, regCurveAgree = 0, regInvalid = 0;
for (const [, meta] of REGISTRY_2D) {
  const p = parseMetaAddress(meta);
  if (p.ok && !p.singleKeyForm) regParsed++;
  if (p.ok && (p.spendPub.slice(0, 2) === '02' || p.spendPub.slice(0, 2) === '03') && (p.viewPub.slice(0, 2) === '02' || p.viewPub.slice(0, 2) === '03')) regPrefixOk++;
  const own = p.ok && xOnSecp256k1(p.spendPub) && xOnSecp256k1(p.viewPub);
  const noble = (() => { try { pointOf(p.spendPub).assertValidity(); pointOf(p.viewPub).assertValidity(); return true; } catch { return false; } })();
  if (own === noble) regCurveAgree++;
  if (!own) regInvalid++;
}
check('A31 all 6 fresh 2D registry meta-addresses parse as 66-B two-key records', regParsed === 6, `${regParsed}/6`);
check('A32 all registered spend/view keys carry 02/03 compressed prefixes', regPrefixOk === 6, `${regPrefixOk}/6`);
check('A33 own-math vs noble curve verdicts agree on all 6 registry records', regCurveAgree === 6, `${regCurveAgree}/6`);
check('A34 registry finding recorded: invalid registered keys ' + regInvalid + '/6 (informational, not a spec violation of our parser)', true, `${regInvalid}/6 invalid`);

/* ============================================================ R. KEY-RECOVERY DERIVATION PINS */
/* Adopted convention (canonical community implementation, ScopeLift generateKeysFromSignature):
 *   spendPriv = keccak256(sig[0:32])        viewPriv = keccak256(sig[32:64])
 * The 65th byte (v / recovery) is NOT used for derivation, but the signature MUST be 65 bytes.
 * Veyra extension under test here: the signed MESSAGE carries domain + username + chainId, so keys
 * are bound to (app, username, chain) — changing any of them changes the derived keys. */
const DERIVATION_MSG = (username, chainId) =>
  `Veyra stealth identity v1\nusername: ${username}\nchainId: ${chainId}\ndomain: veyra.identity`;

function msgHash(msg) { return keccak256(new TextEncoder().encode(msg)); }
function sign65(msg, priv, extraEntropy) {
  // scheme-1 recovery emulation: deterministic RFC-6979 ECDSA over keccak256(message), lowS, 65-byte r‖s‖v
  const sig = secp256k1.sign(bytes(msgHash(msg)), priv, {   // noble rejects '0x'-prefixed strings
    lowS: true,
    format: 'recovered',
    ...(extraEntropy ? { extraEntropy } : {}),
  });
  return hex(concat(sig.toCompactRawBytes(), Uint8Array.of(sig.recovery + 27)));
}
function concat(a, b) { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
function deriveFromSignature(sigHex) {
  const sig = bytes(sigHex);
  if (sig.length !== 65) return { ok: false, reason: `signature must be 65 bytes, got ${sig.length}` };
  const spendPriv = BigInt(keccak256(sig.slice(0, 32))) % N;
  const viewPriv = BigInt(keccak256(sig.slice(32, 64))) % N;
  if (spendPriv === 0n || viewPriv === 0n) return { ok: false, reason: 'derived zero scalar' };
  const spendPub = hex(pubkeyOf(spendPriv));
  const viewPub = hex(pubkeyOf(viewPriv));
  return { ok: true, spendPriv, viewPriv, spendPub, viewPub, meta: (spendPub + viewPub.slice(2)) };
}
const walletPriv = randomScalar();
const sigA = sign65(DERIVATION_MSG('bob', 4441), walletPriv);
const sigA2 = sign65(DERIVATION_MSG('bob', 4441), walletPriv);
check('R01 signature is exactly 65 bytes (132 hex chars) — the form wallets must produce',
  sigA.length === 132, `${sigA.length} hex chars`);
check('R02 same wallet + same message -> byte-identical signature (RFC-6979 determinism)', sigA === sigA2);
const dA = deriveFromSignature(sigA);
check('R03 signature halves derive valid nonzero spend/view scalars (both < n)', dA.ok && dA.spendPriv < N && dA.viewPriv < N);
check('R04 derived spending key != viewing key (two independent keys)', dA.spendPriv !== dA.viewPriv);
check('R05 derived meta-address is a 66-B two-key record with 02/03 prefixes', parseMetaAddress(dA.meta).ok && !parseMetaAddress(dA.meta).singleKeyForm && /^(02|03)/.test(strip(dA.meta).slice(0, 2)) && /^(02|03)/.test(strip(dA.meta).slice(66, 68)));
const dA2 = deriveFromSignature(sign65(DERIVATION_MSG('bob', 4441), walletPriv));
check('R06 re-derivation reproduces the identical meta-address (deterministic root)', dA.meta === dA2.meta);
const dB = deriveFromSignature(sign65(DERIVATION_MSG('bob', 4442), walletPriv));
check('R07 chain binding: chainId change -> different spend + view keys', dB.spendPub !== dA.spendPub && dB.viewPub !== dA.viewPub);
const dC = deriveFromSignature(sign65(DERIVATION_MSG('bob2', 4441), walletPriv));
check('R08 username binding: username change -> different spend + view keys', dC.spendPub !== dA.spendPub && dC.viewPub !== dA.viewPub);
const sigOther = (() => {
  // emulate a NON-deterministic wallet: sign the same message with extra entropy
  return sign65(DERIVATION_MSG('bob', 4441), walletPriv, new Uint8Array(32).fill(9));
})();
const dOther = deriveFromSignature(sigOther);
check('R09 HAZARD PIN: a different (still valid) signature over the SAME message derives DIFFERENT keys', dOther.ok && dOther.meta !== dA.meta);
const fingerprint = (meta) => keccak256(meta).slice(2, 10);
check('R10 fingerprint check catches the hazard: re-derived fingerprint != pinned fingerprint',
  fingerprint(dOther.meta) !== fingerprint(dA.meta));
const compact = (() => { const s = secp256k1.sign(bytes(msgHash(DERIVATION_MSG('bob', 4441))), walletPriv, { lowS: true }).toCompactRawBytes(); return hex(s); })();
check('R11 64-byte compact (ERC-2098) signature is REFUSED by the 65-byte requirement',
  deriveFromSignature(compact).ok === false, deriveFromSignature(compact).reason);
const dD = deriveFromSignature(sign65('sign in to veyra', walletPriv));
check('R12 wrong message (phishing variant) derives different keys', dD.ok && dD.meta !== dA.meta);

/* ============================================================ G. FUNDING / GAS ARITHMETIC */
const SPEND_GAS = 21000n;
const cost = (gasPriceWei) => SPEND_GAS * gasPriceWei;
check('G01 21,000 gas at 1 Gwei = 0.000021 zkLTC (native spend cost)',
  cost(1_000_000_000n) === 21_000_000_000_000n, `${cost(1_000_000_000n)} wei`);
check('G02 recommended 0.001 zkLTC reserve sustains 47 spends at 1 Gwei', 1_000_000_000_000_000n / cost(1_000_000_000n) === 47n);
check('G03 at 50 Gwei a single spend exceeds the 0.001 reserve (wallet must warn/refuse)', cost(50_000_000_000n) > 1_000_000_000_000_000n);

/* ============================================================ REPORT */
console.log('--- assertion detail ---');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
const summary = {
  phase: '2D',
  artifact: 'stealth-serialization-pin.mjs',
  mode: 'OFFLINE_SERIALIZATION_PIN + PUBLIC_DATA_REVALIDATION',
  note: 'No transaction broadcast. No secret material embedded or printed. Keys generated in-memory per run.',
  pins: {
    sharedSecretSerialization: 'ECDH point, compressed 33 B (02/03), keccak256, no x-only/uncompressed fallback',
    tagRule: 'most-significant byte of keccak256(shared point)',
    scalarRule: 'keccak output read big-endian, reduced mod n (reduction is a no-op except with prob < 2^-128)',
    addressRule: 'keccak256(uncompressed pubkey x||y)[12:]',
    stealthKeyRule: 'p_stealth = (p_spend + sh) mod n; P_stealth = P_spend + sh·G',
    recoveryRule: 'spendPriv = keccak256(sig[0:32]); viewPriv = keccak256(sig[32:64]); 65-byte sig required',
  },
  registry2D: { records: REGISTRY_2D.length, invalidKeys: regInvalid },
  assertions: { total: results.length, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length },
};
console.log(JSON.stringify(summary, null, 2));
process.exit(results.every((r) => r.pass) ? 0 : 1);
