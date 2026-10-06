// Veyra — Phase 3: ERC-5564 `announce(...)` calldata encoding, decoding and validation.
//
// Hand-rolled ABI coding keeps the browser bundle dependency-free. The encoding is
// byte-for-byte identical to `viem.encodeFunctionData` — asserted in
// `test/private-transfer-announcement.test.js` — and Phase 2E already reproduced a
// real LiteForge `announce()` transaction byte-for-byte with this layout.
//
// PRIVACY/SECURITY: every field here is PUBLIC chain data. Nothing in this module
// may ever be handed a private key, a wallet signature, or Bob's normal address.
import {
  ANNOUNCE_SELECTOR, MAX_METADATA_BYTES, SCHEME_ID, NATIVE_METADATA_BYTES, isAddress, validateEphemeralPublicKey,
} from './protocol.js';

const WORD = 64;
const pad = (hex) => hex.padStart(WORD, '0');
const padRight = (hex) => {
  const remainder = hex.length % WORD;
  return remainder === 0 ? hex : hex + '0'.repeat(WORD - remainder);
};
const strip = (value) => String(value ?? '').replace(/^0x/i, '');
const word = (value) => pad(BigInt(value).toString(16));

const validateHexBytes = (value, label) => {
  const bare = strip(value);
  if (bare.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(bare)) throw new Error(`INVALID_${label}_HEX`);
  return bare.toLowerCase();
};

/**
 * Validate every announcement input BEFORE anything is signed or broadcast (§9).
 * @returns {{ok:true, schemeId:number, stealthAddress:string, ephemeralPublicKey:string, metadata:string}
 *          |{ok:false,error:string}}
 */
export function validateAnnouncementInput({ schemeId, stealthAddress, ephemeralPublicKey, metadata }) {
  if (Number(schemeId) !== SCHEME_ID) return { ok: false, error: 'UNSUPPORTED_SCHEME' };
  if (!isAddress(stealthAddress)) return { ok: false, error: 'INVALID_STEALTH_ADDRESS' };
  const ephemeral = validateEphemeralPublicKey(ephemeralPublicKey);
  if (!ephemeral.ok) return { ok: false, error: ephemeral.error };
  const metaHex = strip(metadata);
  if (metaHex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(metaHex)) return { ok: false, error: 'INVALID_METADATA' };
  const metadataBytes = metaHex.length / 2;
  if (metadataBytes === 0) return { ok: false, error: 'INVALID_METADATA' };
  if (metadataBytes > MAX_METADATA_BYTES) return { ok: false, error: 'METADATA_TOO_LONG' };
  return {
    ok: true,
    schemeId: SCHEME_ID,
    stealthAddress: String(stealthAddress).toLowerCase(),
    ephemeralPublicKey: ephemeral.ephemeralPublicKey,
    metadata: '0x' + metaHex.toLowerCase(),
    metadataBytes,
  };
}

/** True when metadata follows the LiteForge native convention (1-byte view tag). */
export const isNativeMetadata = (metadata) => strip(metadata).length / 2 === NATIVE_METADATA_BYTES;

/**
 * Encode `announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)`.
 * @returns {string} 0x-prefixed calldata beginning with 0x4d1f9583
 */
export function encodeAnnounceCalldata({ schemeId, stealthAddress, ephemeralPublicKey, metadata }) {
  const validated = validateAnnouncementInput({ schemeId, stealthAddress, ephemeralPublicKey, metadata });
  if (!validated.ok) throw new Error(validated.error);

  const ephemeralHex = strip(validated.ephemeralPublicKey);
  const metadataHex = strip(validated.metadata);
  const ephemeralTail = padRight(ephemeralHex);
  const metadataTail = padRight(metadataHex);

  const headLength = 4 * WORD;
  const ephemeralOffset = headLength;
  const metadataOffset = headLength + WORD + ephemeralTail.length;

  const head = [
    word(validated.schemeId),
    pad(strip(validated.stealthAddress).toLowerCase()),
    word(ephemeralOffset / 2),
    word(metadataOffset / 2),
  ].join('');

  const ephemeralSection = word(ephemeralHex.length / 2) + ephemeralTail;
  const metadataSection = word(metadataHex.length / 2) + metadataTail;

  return ANNOUNCE_SELECTOR + head + ephemeralSection + metadataSection;
}

/** Decode announcer calldata for validation/telemetry. Rejects malformed input. */
export function decodeAnnounceCalldata(data) {
  const hex = strip(data).toLowerCase();
  if (!hex.startsWith(strip(ANNOUNCE_SELECTOR))) throw new Error('UNSUPPORTED_SELECTOR');
  const body = hex.slice(8);
  const wordAt = (index) => body.slice(index * WORD, (index + 1) * WORD);
  if (body.length < 4 * WORD) throw new Error('TRUNCATED_CALLDATA');

  const schemeId = Number(BigInt('0x' + wordAt(0)));
  const stealthAddress = '0x' + wordAt(1).slice(24);
  const ephemeralOffset = Number(BigInt('0x' + wordAt(2))) * 2;
  const metadataOffset = Number(BigInt('0x' + wordAt(3))) * 2;

  const readBytes = (offset) => {
    if (!Number.isFinite(offset) || offset + WORD > body.length) throw new Error('TRUNCATED_CALLDATA');
    const length = Number(BigInt('0x' + body.slice(offset, offset + WORD)));
    const start = offset + WORD;
    const end = start + length * 2;
    if (end > body.length) throw new Error('TRUNCATED_CALLDATA');
    return '0x' + body.slice(start, end);
  };

  return {
    schemeId,
    stealthAddress,
    ephemeralPublicKey: readBytes(ephemeralOffset),
    metadata: readBytes(metadataOffset),
  };
}

/**
 * Structural validation of an announcement record coming from the index (server or
 * chain). An invalid record is dropped, never surfaced and never scanned.
 */
export function validateAnnouncementRecord(record) {
  const validated = validateAnnouncementInput({
    schemeId: record?.schemeId,
    stealthAddress: record?.stealthAddress,
    ephemeralPublicKey: record?.ephemeralPublicKey,
    metadata: record?.metadata,
  });
  if (!validated.ok) return validated;
  return {
    ok: true,
    schemeId: validated.schemeId,
    stealthAddress: validated.stealthAddress,
    ephemeralPublicKey: validated.ephemeralPublicKey,
    metadata: validated.metadata,
    viewTag: '0x' + strip(validated.metadata).slice(0, 2),
    blockNumber: record?.blockNumber ?? null,
    transactionHash: record?.transactionHash ?? null,
    logIndex: record?.logIndex ?? null,
  };
}
