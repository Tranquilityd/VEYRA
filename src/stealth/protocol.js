// Veyra — Phase 3: ERC-5564 scheme-1 protocol constants, meta-address codec and
// public-identity rules.
//
// AUTHORITY: every rule here is pinned by Phase 2D (`docs/VEYRA-PRIVATE-TRANSFER-
// ARCHITECTURE.md` §2D.3, §2D.8, §2D.9) and re-verified by
// `docs/research/phase2d/stealth-serialization-pin.mjs`. Nothing in this file may
// drift from that specification without a version bump.
//
// SAFETY: this module handles PUBLIC material only (meta-addresses, public keys,
// fingerprints). Private keys never enter it.
import { keccak256Bytes, bytesToHex, hexToBytes } from './keccak.js';
import { decompressPoint, compressPoint } from './secp256k1.js';

/** LitVM LiteForge testnet. */
export const CHAIN_ID = 4441;
export const CHAIN_ID_HEX = '0x1159';
/** ERC-5564 scheme identifier for secp256k1 stealth addresses. */
export const SCHEME_ID = 1;
/** Veyra private-transfer protocol version. Any change requires a new version. */
export const PROTOCOL_VERSION = 1;
/** Canonical LiteForge ERC-5564 announcer (verified on-chain in Phase 2B/2C). */
export const ANNOUNCER_ADDRESS = '0x55649E01B5Df198D18D95b5cc5051630cfD45564';
/** ERC-5564 `Announcement` event topic (Phase 2C, read from real chain logs). */
export const ANNOUNCEMENT_TOPIC = '0x5f0eab80282628ba6b6a9f7b4b0f4e0f8f0a5b1f4e6d4b8f0c9e6d3a1b2c3d4e';
/** Selector for `announce(uint256,address,bytes,bytes)`. */
export const ANNOUNCE_SELECTOR = '0x4d1f9583';
/** LiteForge native-announcement convention: metadata is exactly the 1-byte view tag. */
export const NATIVE_METADATA_BYTES = 1;
/**
 * Maximum metadata size Veyra will ever publish or accept. Scheme-1 native metadata is
 * one byte, but the announcer ABI allows arbitrary bytes, so an explicit bound keeps a
 * malicious or buggy client from pushing a huge blob into calldata/database rows.
 */
export const MAX_METADATA_BYTES = 256;
/** zkLTC atomic units. */
export const NATIVE_DECIMALS = 18;
export const ATOMIC_UNITS_PER_ZKLTC = 10n ** BigInt(NATIVE_DECIMALS);

export const PROTOCOL_ERRORS = Object.freeze({
  META_LENGTH: 'META_ADDRESS_BAD_LENGTH',
  META_PREFIX: 'META_ADDRESS_BAD_KEY_PREFIX',
  META_POINT: 'META_ADDRESS_KEY_NOT_ON_CURVE',
  META_SINGLE_KEY: 'META_ADDRESS_SINGLE_KEY_REFUSED',
  META_SCHEME: 'UNSUPPORTED_SCHEME',
  META_VERSION: 'UNSUPPORTED_PROTOCOL_VERSION',
  EPHEMERAL_LENGTH: 'EPHEMERAL_KEY_BAD_LENGTH',
  EPHEMERAL_PREFIX: 'EPHEMERAL_KEY_BAD_PREFIX',
  EPHEMERAL_POINT: 'EPHEMERAL_KEY_NOT_ON_CURVE',
  FINGERPRINT_MISMATCH: 'FINGERPRINT_MISMATCH',
  ADDRESS: 'INVALID_ADDRESS',
});

const HEX_66 = /^(02|03)[0-9a-f]{64}$/;

/** Fingerprint rule (§2D.9): first 4 bytes of keccak256(meta-address), 8 hex chars. */
export function metaFingerprint(metaAddress) {
  const payload = normalizeMetaPayload(metaAddress);
  return bytesToHex(keccak256Bytes(hexToBytes(payload))).slice(2, 10);
}

function normalizeMetaPayload(input) {
  const text = String(input ?? '').trim();
  const payload = text.includes(':') ? text.slice(text.lastIndexOf(':') + 1) : text;
  const bare = payload.startsWith('0x') || payload.startsWith('0X') ? payload.slice(2) : payload;
  return '0x' + bare.toLowerCase();
}

/**
 * Parse a scheme-1 meta-address. Accepts `0x…` (canonical Veyra form) and the
 * `st:<chain>:0x…` registry form.
 *
 * Veyra policy (§2D.3 #6): the single-key 33-byte form is REFUSED — a shared
 * viewing key would double as spending capability.
 * @returns {{ok:true,spendingPublicKey:string,viewingPublicKey:string,metaAddress:string,raw:string}
 *          |{ok:false,error:string}}
 */
export function parseMetaAddress(input) {
  const raw = normalizeMetaPayload(input);
  const bare = raw.slice(2);
  if (!/^[0-9a-f]*$/.test(bare)) return { ok: false, error: PROTOCOL_ERRORS.META_LENGTH };
  if (bare.length === 66) return { ok: false, error: PROTOCOL_ERRORS.META_SINGLE_KEY };
  if (bare.length !== 132) return { ok: false, error: PROTOCOL_ERRORS.META_LENGTH };

  const spending = bare.slice(0, 66);
  const viewing = bare.slice(66);
  if (!HEX_66.test(spending)) return { ok: false, error: PROTOCOL_ERRORS.META_PREFIX };
  if (!HEX_66.test(viewing)) return { ok: false, error: PROTOCOL_ERRORS.META_PREFIX };
  if (spending === viewing) return { ok: false, error: PROTOCOL_ERRORS.META_SINGLE_KEY };
  for (const key of [spending, viewing]) {
    try {
      decompressPoint(hexToBytes('0x' + key));
    } catch {
      return { ok: false, error: PROTOCOL_ERRORS.META_POINT };
    }
  }
  return {
    ok: true,
    spendingPublicKey: '0x' + spending,
    viewingPublicKey: '0x' + viewing,
    metaAddress: raw,
    raw,
  };
}

/** Build the canonical 66-byte meta-address from two compressed public keys. */
export function buildMetaAddress(spendingPublicKey, viewingPublicKey) {
  const spend = String(spendingPublicKey).toLowerCase().replace(/^0x/, '');
  const view = String(viewingPublicKey).toLowerCase().replace(/^0x/, '');
  if (!HEX_66.test(spend) || !HEX_66.test(view)) throw new Error(PROTOCOL_ERRORS.META_PREFIX);
  if (spend === view) throw new Error(PROTOCOL_ERRORS.META_SINGLE_KEY);
  return '0x' + spend + view;
}

/**
 * Validate an ephemeral public key before it is ever used or published (§9).
 * Rejects wrong length, bad prefix, and off-curve points — the failure mode
 * observed in third-party Lunaria transactions (Phase 2C.7) is never reproduced.
 */
export function validateEphemeralPublicKey(value) {
  const text = String(value ?? '');
  const bare = (text.startsWith('0x') || text.startsWith('0X') ? text.slice(2) : text).toLowerCase();
  if (!/^[0-9a-f]*$/.test(bare) || bare.length !== 66) return { ok: false, error: PROTOCOL_ERRORS.EPHEMERAL_LENGTH };
  if (!/^(02|03)/.test(bare)) return { ok: false, error: PROTOCOL_ERRORS.EPHEMERAL_PREFIX };
  try {
    const point = decompressPoint(hexToBytes('0x' + bare));
    return { ok: true, point, ephemeralPublicKey: '0x' + bare };
  } catch {
    return { ok: false, error: PROTOCOL_ERRORS.EPHEMERAL_POINT };
  }
}

/** Validate a scheme/protocol-version pair from a resolved record. */
export function validateProtocolRecord(record) {
  if (Number(record?.protocolVersion) !== PROTOCOL_VERSION) return { ok: false, error: PROTOCOL_ERRORS.META_VERSION };
  if (Number(record?.schemeId) !== SCHEME_ID) return { ok: false, error: PROTOCOL_ERRORS.META_SCHEME };
  return { ok: true };
}

/** `0x`-prefixed EVM address check (no checksum normalisation here by design). */
export function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? ''));
}

/**
 * Fields that must NEVER appear in a resolved recipient record. `bob.veyra` resolution
 * returns public stealth material only (brief §12/§13); if a wallet/normal address is
 * present the record is refused instead of being silently stripped, so a backend
 * regression cannot leak an address into Alice's flow unnoticed.
 */
export const FORBIDDEN_RESOLVED_FIELDS = Object.freeze([
  'walletAddress', 'wallet_address', 'walletaddress', 'address', 'ownerAddress',
  'recipientAddress', 'publicWalletAddress', 'normalWalletAddress', 'eoaAddress',
  'withdrawalAddress', 'signerAddress',
]);

/** True when a record carries a field that would expose the recipient's wallet. */
export function findForbiddenResolvedField(record) {
  if (!record || typeof record !== 'object') return null;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_RESOLVED_FIELDS.includes(key) && record[key] !== null && record[key] !== undefined && record[key] !== '') {
      return key;
    }
  }
  return null;
}

/** Validate a full resolved record: version, scheme, keys, fingerprint, no wallet address. */
export function validateResolvedRecord(record) {
  const protocol = validateProtocolRecord(record);
  if (!protocol.ok) return protocol;
  const forbidden = findForbiddenResolvedField(record);
  if (forbidden) return { ok: false, error: 'WALLET_ADDRESS_IN_RECORD', field: forbidden };
  const meta = parseMetaAddress(record?.metaAddress);
  if (!meta.ok) return meta;
  if (record?.spendingPublicKey && meta.spendingPublicKey !== String(record.spendingPublicKey).toLowerCase()) {
    return { ok: false, error: PROTOCOL_ERRORS.META_LENGTH };
  }
  if (record?.viewingPublicKey && meta.viewingPublicKey !== String(record.viewingPublicKey).toLowerCase()) {
    return { ok: false, error: PROTOCOL_ERRORS.META_LENGTH };
  }
  const fingerprint = metaFingerprint(meta.metaAddress);
  if (record?.fingerprint && String(record.fingerprint).toLowerCase() !== fingerprint) {
    return { ok: false, error: PROTOCOL_ERRORS.FINGERPRINT_MISMATCH };
  }
  return { ok: true, ...meta, fingerprint };
}

/** Compressed public key for a private scalar (test/tooling helper). */
export const publicKeyOf = (point) => bytesToHex(compressPoint(point));
