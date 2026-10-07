/* ============================================================================================
 * Phase 2E — pinned ERC-5564 scheme-1 primitives (RESEARCH TOOLING — not production code)
 * ============================================================================================
 * Serialization pins are exactly those established in Phase 2D and continuously re-verified by
 * docs/research/phase2d/stealth-serialization-pin.mjs (49/49 PASS):
 *   - ECDH shared point serialized COMPRESSED (33 bytes, prefix 02/03), hashed with keccak256
 *   - view tag = most-significant byte of that hash
 *   - scalar = keccak output read big-endian, reduced mod n (reduction is a no-op w.p. < 2^-128)
 *   - address = keccak256(uncompressed pubkey x||y)[12:]
 *   - P_stealth = P_spend + h*G ; p_stealth = (p_spend + h) mod n
 *   - meta-address = spendPub(33) || viewPub(33)  (single-key form REFUSED by Veyra policy)
 *   - announcement metadata for this deployment = 1-byte view tag
 *
 * No private material is ever stored in this module; callers pass keys in memory.
 * ============================================================================================ */

import { randomBytes } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import {
  keccak256, encodeFunctionData, decodeFunctionData, parseAbi, hexToBytes, bytesToHex,
} from 'viem';

export const CHAIN_ID = 4441;
export const SCHEME_ID = 1;
export const ANNOUNCER = '0x55649E01B5Df198D18D95b5cc5051630cfD45564';
export const REGISTRY = '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538';
export const RPC_DEFAULT = 'https://liteforge.rpc.caldera.xyz/http';
export const EXPLORER_DEFAULT = 'https://liteforge.explorer.caldera.xyz';

export const N = secp256k1.CURVE.n;
export const G = secp256k1.ProjectivePoint.BASE;

export const ANNOUNCER_ABI = parseAbi([
  'function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)',
  'event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)',
]);

/* ------------------------------------------------------------------ primitives */
export const strip = (h) => (typeof h === 'string' && h.startsWith('0x') ? h.slice(2) : h);
export const hex = (u8) => '0x' + Buffer.from(u8).toString('hex');
export const bytes = (h) => hexToBytes(h.startsWith('0x') ? h : '0x' + h);

export function randomScalar() {
  for (;;) {
    const s = BigInt('0x' + Buffer.from(randomBytes(32)).toString('hex'));
    if (s > 0n && s < N) return s;
  }
}

export const pointOf = (pub) => secp256k1.ProjectivePoint.fromHex(strip(pub));
export const pubkeyOf = (priv, compressed = true) => secp256k1.getPublicKey(priv, compressed);

/** Ethereum/LitVM address rule. Accepts 33-B or 65-B point encodings. Never hashes compressed keys. */
export function addressOfPoint(point) {
  return '0x' + keccak256(point.toRawBytes(false).slice(1)).slice(-40);
}
export function addressOfPub(pub) {
  return addressOfPoint(pointOf(pub));
}
export function privateKeyHex(priv) {
  return '0x' + priv.toString(16).padStart(64, '0');
}

/* ------------------------------------------------------------------ meta-address */
/** Build the 66-byte scheme-1 meta-address P||V (both compressed, 33 bytes each). */
export function buildMetaAddress(spendPub, viewPub) {
  const s = strip(typeof spendPub === 'string' ? spendPub : hex(spendPub));
  const v = strip(typeof viewPub === 'string' ? viewPub : hex(viewPub));
  if (s.length !== 66 || v.length !== 66) throw new Error('compressed public keys must be 33 bytes');
  return '0x' + s + v;
}

/** Parse `st:<chain>:0x<66B>` or bare hex. Reports the reference-SDK single-key form separately. */
export function parseMetaAddress(input) {
  const s = String(input);
  const payload = strip(s.includes(':') ? s.slice(s.lastIndexOf(':') + 1) : s);
  if (!/^[0-9a-fA-F]+$/.test(payload)) return { ok: false, reason: 'non-hex payload' };
  if (payload.length !== 66 && payload.length !== 132) {
    return { ok: false, reason: `bad payload length ${payload.length} hex chars (need 66 or 132)` };
  }
  const singleKeyForm = payload.length === 66;
  const spendPub = payload.slice(0, 66);
  const viewPub = singleKeyForm ? spendPub : payload.slice(66, 132);
  for (const [name, k] of [['spend', spendPub], ['view', viewPub]]) {
    if (!/^(02|03)/.test(k)) return { ok: false, reason: `${name} key lacks 02/03 compressed prefix` };
    try { pointOf(k).assertValidity(); } catch { return { ok: false, reason: `${name} key is not a valid secp256k1 point` }; }
  }
  return { ok: true, singleKeyForm, spendPub, viewPub, raw: payload };
}

/** Veyra policy: refuse single-key meta-addresses (a shared viewing key would grant spend capability). */
export function acceptMetaAddressForVeyra(input) {
  const p = parseMetaAddress(input);
  if (!p.ok) return p;
  if (p.singleKeyForm) return { ok: false, reason: 'single-key meta-address refused by Veyra policy (spend and view must be separate)' };
  return p;
}

/* ------------------------------------------------------------------ ephemeral key validation (MANDATORY before ECDH) */
/** R must be exactly 33 bytes, prefix 02/03, and a valid secp256k1 point. */
export function validateEphemeralKey(R) {
  const h = strip(typeof R === 'string' ? R : hex(R));
  if (h.length !== 66) return { ok: false, reason: `ephemeral key must be 33 bytes, got ${h.length / 2}` };
  if (!/^(02|03)/.test(h)) return { ok: false, reason: `invalid compressed prefix 0x${h.slice(0, 2)} (must be 02/03)` };
  try {
    const p = pointOf(h);
    p.assertValidity();
    return { ok: true, point: p };
  } catch (e) {
    return { ok: false, reason: 'not a valid secp256k1 point (off-curve)' };
  }
}

/* ------------------------------------------------------------------ ECDH / derivation */
/** Pinned: keccak256 of the COMPRESSED 33-byte shared point. */
export function sharedSecretHash(privateKey, counterpartyPub) {
  const shared = secp256k1.getSharedSecret(privateKey, pointOf(counterpartyPub).toRawBytes(true), true);
  return keccak256(shared);
}
export const hashToScalar = (h) => BigInt(h) % N;
export const viewTagOf = (h) => h.slice(2, 4);

/** Sender side. r is SECRET — never persist or log it. */
export function deriveStealthAddress({ meta, r: explicitR }) {
  const parsed = acceptMetaAddressForVeyra(meta);
  if (!parsed.ok) throw new Error('meta-address rejected: ' + parsed.reason);
  const r = explicitR ?? randomScalar();
  const R = pubkeyOf(r, true);
  const sharedHash = sharedSecretHash(r, parsed.viewPub);
  const h = hashToScalar(sharedHash);
  const P_stealth = pointOf(parsed.spendPub).add(G.multiply(h));
  const S = addressOfPoint(P_stealth);
  return {
    r, R: hex(R), sharedHash, h, viewTag: viewTagOf(sharedHash),
    P_stealth: P_stealth.toRawBytes(true), S,
  };
}

/** Recipient side scan. Uses ONLY public announcement fields + the viewing private key (client-side). */
export function scanAnnouncement({ schemeId, stealthAddress, ephemeralPubKey, metadata }, { spendPub, viewPriv }) {
  if (schemeId !== SCHEME_ID) return { match: false, reason: `unsupported schemeId ${schemeId}` };
  const v = validateEphemeralKey(ephemeralPubKey);
  if (!v.ok) return { match: false, reason: `invalid ephemeral key: ${v.reason}` };
  const providedTag = typeof metadata === 'string' && metadata.length >= 4 ? metadata.slice(2, 4) : null;
  const sharedHash = sharedSecretHash(viewPriv, ephemeralPubKey);
  const computedTag = viewTagOf(sharedHash);
  if (providedTag !== null && computedTag !== providedTag) {
    return { match: false, reason: `view-tag miss (announced 0x${providedTag}, computed 0x${computedTag})` };
  }
  const h = hashToScalar(sharedHash);
  const candidate = addressOfPoint(pointOf(spendPub).add(G.multiply(h)));
  const match = candidate.toLowerCase() === String(stealthAddress).toLowerCase();
  return {
    match, reason: match ? 'full derivation match' : 'derived address mismatch',
    sharedHash, h, computedTag, candidateAddress: candidate,
  };
}

/** Bob's stealth spending key: p_stealth = (p_spend + h) mod n. */
export function stealthPrivateKeyFrom(pSpend, h) {
  return (pSpend + h) % N;
}

/** Public, non-secret identity fingerprint (4 bytes / 8 hex chars). Safe to display and pin. */
export function metaFingerprint(meta) {
  return '0x' + keccak256(meta.startsWith('0x') ? meta : '0x' + meta).slice(2, 10);
}

/* ------------------------------------------------------------------ announcement */
export function buildAnnounceCalldata({ schemeId = SCHEME_ID, stealthAddress, ephemeralPubKey, viewTag }) {
  /** Accepts a 0x-hex string OR raw bytes; never re-hex-encodes a string. */
  const norm = (v) => {
    if (typeof v === 'string') return v.startsWith('0x') ? v : '0x' + v;
    return hex(v);
  };
  const tag = norm(viewTag);
  if (tag.length !== 4) throw new Error(`view tag must be exactly 1 byte, got ${tag.length - 2} hex chars`);
  const eph = norm(ephemeralPubKey);
  if (strip(eph).length !== 66) throw new Error(`ephemeral public key must be 33 bytes, got ${strip(eph).length / 2}`);
  return encodeFunctionData({
    abi: ANNOUNCER_ABI,
    args: [BigInt(schemeId), stealthAddress, eph, tag],
  });
}
export function decodeAnnounceCalldata(data) {
  const d = decodeFunctionData({ abi: ANNOUNCER_ABI, data });
  return { schemeId: Number(d.args[0]), stealthAddress: d.args[1], ephemeralPubKey: d.args[2], metadata: d.args[3] };
}

/* ------------------------------------------------------------------ recovery model (Phase 2D spec) */
export function recoveryMessage(username, chainId = CHAIN_ID) {
  return `Veyra stealth identity v1\nusername: ${username}\nchainId: ${chainId}\ndomain: veyra.identity`;
}
/** Canonical convention: spend = keccak(sig[0:32]), view = keccak(sig[32:64]); 65-byte signature required. */
export function deriveKeysFromSignature(signature) {
  const h = strip(String(signature));
  if (!/^[0-9a-fA-F]+$/.test(h)) return { ok: false, reason: 'signature is not hex' };
  if (h.length !== 130) return { ok: false, reason: `signature must be 65 bytes (130 hex chars), got ${h.length / 2}` };
  const b = bytes(h);
  const spendPriv = BigInt(keccak256(b.slice(0, 32))) % N;
  const viewPriv = BigInt(keccak256(b.slice(32, 64))) % N;
  if (spendPriv === 0n || viewPriv === 0n) return { ok: false, reason: 'derived zero scalar' };
  if (spendPriv === viewPriv) return { ok: false, reason: 'derived identical spend/view keys' };
  const spendPub = hex(pubkeyOf(spendPriv, true));
  const viewPub = hex(pubkeyOf(viewPriv, true));
  return { ok: true, spendPriv, viewPriv, spendPub, viewPub, meta: buildMetaAddress(spendPub, viewPub) };
}

/* ------------------------------------------------------------------ misc
 * NOTE: intentionally no helper returns a private key bundled with an address object.
 * Callers keep private scalars in local scope and register them with the orchestrator's
 * redaction filter; `privateKeyHex()` is the only conversion helper provided. */
