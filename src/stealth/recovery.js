// Veyra — Phase 3: wallet-signature key recovery and enrollment binding (Phase 2D.8/2D.9).
//
// THE RECOVERY SIGNATURE IS SECRET-EQUIVALENT.
// Anyone who obtains it can re-derive Bob's stealth spending and viewing keys
// (§2D.8 "replay/phishing"). It must therefore never be transmitted to the Veyra
// backend, never logged, never persisted, never placed in a URL. Only the two
// derived public keys and the meta-address leave the client.
//
// By contrast the ENROLLMENT signature below is over a *different*, domain-separated
// message and is not key-deriving; it exists so the backend can prove that the
// wallet which owns `.veyra` username authorised this exact meta-address and
// stealth-identity signing key (SISK). It is safe to transmit — see
// `docs/VEYRA-PRIVATE-TRANSFER-ARCHITECTURE.md` §2D.9 and the Phase 3 section.
import { keccak256Bytes, hexToBytes, bytesToHex, keccak256Utf8 } from './keccak.js';
import { N, multiplyG, compressPoint, addressFromSignature } from './secp256k1.js';
import { CHAIN_ID, PROTOCOL_VERSION, SCHEME_ID, buildMetaAddress, metaFingerprint } from './protocol.js';

export const RECOVERY_DOMAIN = 'veyra.identity';
export const ENROLLMENT_DOMAIN = 'veyra.identity.enrollment';
export const RECOVERY_VERSION = 'v1';

/**
 * The frozen Phase 2D.8 recovery message. Changing a single character requires a
 * new version (`v2`) — never a silent edit — because the message feeds the key
 * derivation and old backups/funds depend on it.
 */
export function recoveryMessage(username, { chainId = CHAIN_ID, version = RECOVERY_VERSION } = {}) {
  if (!username) throw new Error('USERNAME_REQUIRED');
  return `Veyra stealth identity ${version}\nusername: ${username}\nchainId: ${chainId}\ndomain: ${RECOVERY_DOMAIN}`;
}

/**
 * Enrollment binding message: binds the `.veyra` username, chain, protocol version,
 * meta-address and the SISK public key to the user's wallet signature. Distinct
 * domain from the recovery message so the two can never be confused or replayed
 * into each other.
 */
export function enrollmentMessage({ username, metaAddress, siskPublicKey, chainId = CHAIN_ID, protocolVersion = PROTOCOL_VERSION }) {
  if (!username) throw new Error('USERNAME_REQUIRED');
  if (!metaAddress) throw new Error('META_ADDRESS_REQUIRED');
  if (!siskPublicKey) throw new Error('SISK_REQUIRED');
  return [
    `Veyra stealth identity enrollment v${protocolVersion}`,
    `username: ${username}`,
    `chainId: ${chainId}`,
    `domain: ${ENROLLMENT_DOMAIN}`,
    `metaAddress: ${String(metaAddress).toLowerCase()}`,
    `siskPublicKey: ${String(siskPublicKey).toLowerCase()}`,
    `schemeId: ${SCHEME_ID}`,
  ].join('\n');
}

/** Payment-intent binding for a stealth spend (covers destination + amount + chain). */
export function spendIntentMessage({ username, stealthAddress, destination, amountAtomic, chainId = CHAIN_ID }) {
  return [
    `Veyra stealth spend v${PROTOCOL_VERSION}`,
    `username: ${username}`,
    `chainId: ${chainId}`,
    `stealthAddress: ${String(stealthAddress).toLowerCase()}`,
    `destination: ${String(destination).toLowerCase()}`,
    `amountAtomic: ${String(amountAtomic)}`,
  ].join('\n');
}

const scalarFromHash = (hashBytes) => BigInt(bytesToHex(hashBytes)) % N;

/**
 * Derive the identity roots from a 65-byte EIP-191 signature (2D.3 #8 / 2D.8).
 * `spendPriv = keccak256(sig[0:32])`, `viewPriv = keccak256(sig[32:64])`.
 * The `v` byte is not used in the derivation.
 *
 * @param {string} signature 0x-prefixed 65-byte signature (SECRET-EQUIVALENT)
 */
export function deriveIdentityRootsFromSignature(signature) {
  const text = String(signature ?? '');
  const bare = (text.startsWith('0x') || text.startsWith('0X') ? text.slice(2) : text).toLowerCase();
  if (!/^[0-9a-f]*$/.test(bare)) throw new Error('INVALID_SIGNATURE_ENCODING');
  const bytes = bare.length / 2;
  // 64-byte compact (ERC-2098) and every other form are refused here as well as by
  // the wallet-capability gate — Veyra never guesses at a non-standard encoding.
  if (bytes !== 65) throw new Error('SIGNATURE_MUST_BE_65_BYTES');
  if (bare.length % 2 !== 0) throw new Error('INVALID_SIGNATURE_ENCODING');

  const spendingPrivateKey = scalarFromHash(keccak256Bytes(hexToBytes('0x' + bare.slice(0, 64))));
  const viewingPrivateKey = scalarFromHash(keccak256Bytes(hexToBytes('0x' + bare.slice(64, 128))));
  if (spendingPrivateKey === 0n || viewingPrivateKey === 0n) throw new Error('DERIVED_ZERO_SCALAR');
  return { spendingPrivateKey, viewingPrivateKey };
}

/** Public identity material for a pair of private roots. */
export function identityFromRoots({ spendingPrivateKey, viewingPrivateKey }) {
  const spendingPoint = multiplyG(spendingPrivateKey);
  const viewingPoint = multiplyG(viewingPrivateKey);
  if (spendingPoint === null || viewingPoint === null) throw new Error('DERIVED_POINT_AT_INFINITY');
  const spendingPublicKey = bytesToHex(compressPoint(spendingPoint));
  const viewingPublicKey = bytesToHex(compressPoint(viewingPoint));
  const metaAddress = buildMetaAddress(spendingPublicKey, viewingPublicKey);
  return {
    spendingPublicKey,
    viewingPublicKey,
    metaAddress,
    fingerprint: metaFingerprint(metaAddress),
    spendingAddress: null, // never expose a wallet address for identity roots
  };
}

/** Convenience: signature → full public identity record. */
export function recoverIdentityFromSignature({ signature }) {
  const roots = deriveIdentityRootsFromSignature(signature);
  return { ...roots, ...identityFromRoots(roots) };
}

/**
 * Fingerprint gate (§2D.8): a re-derived identity is only accepted when it matches
 * the pinned fingerprint. A mismatch means the wallet produced a different
 * signature (non-deterministic signing, different account, different message) and
 * automatic recovery MUST be refused — never silently regenerate.
 */
export function verifyRecoveredFingerprint(derived, expectedFingerprint) {
  if (!expectedFingerprint) return { ok: false, error: 'FINGERPRINT_REQUIRED' };
  if (!derived?.fingerprint) return { ok: false, error: 'DERIVED_IDENTITY_REQUIRED' };
  const match = String(derived.fingerprint).toLowerCase() === String(expectedFingerprint).toLowerCase();
  return match ? { ok: true } : { ok: false, error: 'RECOVERY_FINGERPRINT_MISMATCH' };
}

/** EIP-191 personal_sign digest for an arbitrary message. */
export function personalMessageHash(message) {
  const body = new TextEncoder().encode(String(message));
  const header = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
  const payload = new Uint8Array(header.length + body.length);
  payload.set(header, 0);
  payload.set(body, header.length);
  return keccak256Bytes(payload);
}

/** Split a 0x-prefixed 65-byte signature into its ECDSA parts. */
export function splitSignature(signature) {
  const text = String(signature ?? '');
  const bare = (text.startsWith('0x') || text.startsWith('0X') ? text.slice(2) : text).toLowerCase();
  if (!/^[0-9a-f]+$/.test(bare) || bare.length !== 130) throw new Error('SIGNATURE_MUST_BE_65_BYTES');
  let v = parseInt(bare.slice(128, 130), 16);
  if (v >= 27) v -= 27; // some wallets still return the legacy 27/28 form
  if (v !== 0 && v !== 1) throw new Error('INVALID_RECOVERY_ID');
  return { r: BigInt('0x' + bare.slice(0, 64)), s: BigInt('0x' + bare.slice(64, 128)), recovery: v };
}

/**
 * Address that produced a `personal_sign` signature over `message`.
 * The SERVER uses this to prove an enrollment came from the wallet that owns the
 * `.veyra` username; a client can use it to check its own artifacts.
 */
export function addressFromPersonalSignature({ message, signature }) {
  const { r, s, recovery } = splitSignature(signature);
  return addressFromSignature({ r, s, recovery, hash: personalMessageHash(message), keccak: keccak256Bytes });
}

/** keccak256 of the recovery message — used for provenance/audit, not derivation. */
export const recoveryMessageHash = (username, options) =>
  bytesToHex(keccak256Utf8(recoveryMessage(username, options)));
