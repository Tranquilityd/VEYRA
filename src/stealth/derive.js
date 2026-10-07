// Veyra — Phase 3: ERC-5564 scheme-1 stealth derivation (sender + recipient).
//
// Every rule below is pinned by Phase 2D.3 and re-verified against the canonical
// implementation there. In one place, for the record:
//   1. ECDH shared point serialized COMPRESSED (33 bytes) then keccak256
//   2. view tag = most-significant byte of that hash
//   3. h = keccak output as a big-endian scalar reduced mod n
//   4. P_stealth = P_spend + h·G        p_stealth = (p_spend + h) mod n
//   5. address = keccak256(uncompressed x‖y)[12:]
//
// FRESHNESS (§2D.4, protocol rule D/E): the sender calls `deriveStealthAddress`
// once per payment with no injected `r`, so a fresh ephemeral key, a fresh shared
// secret and therefore a fresh stealth address are produced every time. There is
// no reuse path and no fallback to the recipient's normal wallet anywhere in this
// module — failure throws.
//
// SAFETY: `r`, `p_spend`, `p_stealth` and `v` (viewing private key) are secrets.
// This module never stores, caches, logs or serialises them; callers keep them in
// memory and are responsible for redaction.
import { keccak256Bytes, hexToBytes, bytesToHex } from './keccak.js';
import {
  N, scalarMultiply, multiplyG, pointAdd, compressPoint, decompressPoint,
  randomScalar, scalarToHex,
} from './secp256k1.js';
import { SCHEME_ID, NATIVE_METADATA_BYTES, parseMetaAddress, validateEphemeralPublicKey } from './protocol.js';

/**
 * Pinned ECDH rule: the shared point serialized compressed (33 B), keccak256'd.
 * @param {bigint} privateScalar local private scalar (secret)
 * @param {{x:bigint,y:bigint}|Uint8Array|string} counterpartyPublicKey public point
 */
export function sharedSecretHash(privateScalar, counterpartyPublicKey) {
  const point = typeof counterpartyPublicKey === 'object' && counterpartyPublicKey?.x !== undefined
    ? counterpartyPublicKey
    : decompressPoint(typeof counterpartyPublicKey === 'string' ? hexToBytes(counterpartyPublicKey) : counterpartyPublicKey);
  const shared = scalarMultiply(privateScalar, point);
  if (shared === null) throw new Error('ECDH_SHARED_POINT_AT_INFINITY');
  return bytesToHex(keccak256Bytes(compressPoint(shared)));
}

/** h = keccak output read big-endian, reduced mod n. */
export const hashToScalar = (hashHex) => BigInt(hashHex) % N;
/** View tag = first byte of the shared-secret hash. */
export const viewTagOf = (hashHex) => hashHex.slice(2, 4);
/** Address rule: keccak256(uncompressed x‖y)[12:]. */
export function addressOfPoint(point) {
  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  const x = point.x.toString(16).padStart(64, '0');
  const y = point.y.toString(16).padStart(64, '0');
  for (let i = 0; i < 32; i += 1) {
    uncompressed[i + 1] = parseInt(x.slice(i * 2, i * 2 + 2), 16);
    uncompressed[i + 33] = parseInt(y.slice(i * 2, i * 2 + 2), 16);
  }
  return '0x' + bytesToHex(keccak256Bytes(uncompressed.subarray(1))).slice(2 + 24);
}

/**
 * SENDER SIDE. Derive a fresh stealth address for a recipient meta-address.
 *
 * The private `r` is returned only because the caller needs it in memory to
 * publish nothing at all (it is never transmitted, stored or logged). Callers
 * that do not need it must drop it immediately.
 *
 * @param {{metaAddress?:string, spendingPublicKey?:string, viewingPublicKey?:string, r?:bigint}} params
 * @returns {{R:string, sharedHash:string, viewTag:string, stealthPublicKey:string,
 *            stealthAddress:string, h:bigint, r:bigint}}
 */
export function deriveStealthAddress(params = {}) {
  const meta = params.metaAddress
    ? parseMetaAddress(params.metaAddress)
    : parseMetaAddress((params.spendingPublicKey || '') + (params.viewingPublicKey || '').replace(/^0x/, '').padStart(0, ''));
  if (!meta.ok) throw new Error(meta.error);

  // Freshness rule: a fresh ephemeral scalar per call unless a test injects one.
  const r = params.r ?? randomScalar();
  if (r <= 0n || r >= N) throw new Error('EPHEMERAL_SCALAR_OUT_OF_RANGE');

  const R = scalarMultiply(r);
  const sharedHash = sharedSecretHash(r, meta.viewingPublicKey);
  const h = hashToScalar(sharedHash);
  const spendPoint = decompressPoint(hexToBytes(meta.spendingPublicKey));
  const stealthPoint = pointAdd(spendPoint, multiplyG(h));
  if (stealthPoint === null) throw new Error('STEALTH_POINT_AT_INFINITY');

  return {
    r,
    R: bytesToHex(compressPoint(R)),
    sharedHash,
    h,
    viewTag: viewTagOf(sharedHash),
    stealthPublicKey: bytesToHex(compressPoint(stealthPoint)),
    stealthAddress: addressOfPoint(stealthPoint),
  };
}

/**
 * RECIPIENT SIDE. Derive the stealth private key for a matched payment.
 * p_stealth = (p_spend + h) mod n, and the caller MUST verify
 * p_stealth·G == P_stealth before signing (§11) via `verifyStealthKeypair`.
 */
export function deriveStealthPrivateKey({ spendingPrivateKey, sharedHash }) {
  const h = hashToScalar(sharedHash);
  return (BigInt(spendingPrivateKey) + h) % N;
}

/** Pre-spend guard: the derived private key must control the announced address. */
export function verifyStealthKeypair({ stealthPrivateKey, expectedPublicKey }) {
  const derived = multiplyG(BigInt(stealthPrivateKey));
  if (derived === null) return false;
  const derivedHex = bytesToHex(compressPoint(derived));
  const expected = String(expectedPublicKey).toLowerCase();
  const normalised = expected.startsWith('0x') ? expected : '0x' + expected;
  return derivedHex === normalised;
}

/**
 * RECIPIENT SIDE SCAN of one public announcement record.
 *
 * Order (§10): validate scheme → validate ephemeral key → view tag → ECDH with the
 * viewing private key → recompute tag → derive candidate P_stealth → compare with
 * the announced stealth address. Nothing is revealed about a non-matching record.
 *
 * @param {{schemeId:number,stealthAddress:string,ephemeralPublicKey:string,metadata:string}} announcement
 * @param {{spendingPublicKey:string,viewingPrivateKey:bigint}} keys
 */
export function scanAnnouncement(announcement, keys) {
  if (Number(announcement?.schemeId) !== SCHEME_ID) {
    return { match: false, reason: 'UNSUPPORTED_SCHEME' };
  }
  const ephemeral = validateEphemeralPublicKey(announcement?.ephemeralPublicKey);
  if (!ephemeral.ok) return { match: false, reason: ephemeral.error };

  // Scheme 1 native metadata is EXACTLY one byte (the view tag). Anything else is either
  // a different metadata format or a malformed record, and must be rejected here rather
  // than silently scanned: a missing tag used to skip the tag check entirely
  // (Phase 3.5 finding M-01).
  const metadata = String(announcement?.metadata ?? '');
  const tagMatch = /^0x([0-9a-fA-F]{2})$/.exec(metadata);
  if (!tagMatch) {
    return {
      match: false,
      reason: metadata.replace(/^0x/i, '').length / 2 === NATIVE_METADATA_BYTES ? 'METADATA_MALFORMED' : 'METADATA_LENGTH',
    };
  }
  const announcedTag = tagMatch[1].toLowerCase();

  const sharedHash = sharedSecretHash(BigInt(keys.viewingPrivateKey), ephemeral.point);
  const computedTag = viewTagOf(sharedHash);
  if (announcedTag !== computedTag) {
    return { match: false, reason: 'VIEW_TAG_MISS' };
  }

  // Only the public spending key is needed to test a candidate; the viewing key
  // has already done its job in the ECDH step above.
  const spendPoint = decompressPoint(hexToBytes(String(keys.spendingPublicKey)));
  const h = hashToScalar(sharedHash);
  const candidate = pointAdd(spendPoint, multiplyG(h));
  if (candidate === null) return { match: false, reason: 'STEALTH_POINT_AT_INFINITY' };
  const candidateAddress = addressOfPoint(candidate);

  if (candidateAddress.toLowerCase() !== String(announcement.stealthAddress).toLowerCase()) {
    return { match: false, reason: 'ADDRESS_MISMATCH' };
  }

  const stealthPrivateKey = deriveStealthPrivateKey({
    spendingPrivateKey: keys.spendingPrivateKey,
    sharedHash,
  });
  if (!verifyStealthKeypair({ stealthPrivateKey, expectedPublicKey: bytesToHex(compressPoint(candidate)) })) {
    return { match: false, reason: 'KEYPAIR_VERIFICATION_FAILED' };
  }
  return {
    match: true,
    sharedHash,
    viewTag: computedTag,
    stealthAddress: candidateAddress,
    stealthPublicKey: bytesToHex(compressPoint(candidate)),
    stealthPrivateKey,
  };
}

/** Scan many announcements, returning only matches (§10: nothing else is shown). */
export function scanAnnouncements(announcements, keys) {
  const matches = [];
  for (const announcement of announcements || []) {
    const result = scanAnnouncement(announcement, keys);
    if (result.match) matches.push({ ...result, announcement });
  }
  return matches;
}

/** Serialise a private scalar for in-memory transport; never log this value. */
export const secretToHex = (scalar) => scalarToHex(scalar);
