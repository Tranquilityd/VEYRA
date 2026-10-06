// Veyra — Phase 3: encrypted local backup of the private stealth identity (Phase 2D.8).
//
// DESIGN
//   - AEAD: AES-256-GCM (WebCrypto `crypto.subtle`), 96-bit IV, 128-bit tag.
//   - KDF: scrypt (memory-hard, see ./scrypt.js) with the fixed production
//     parameters in BACKUP_SCRYPT_PARAMS.
//   - The public metadata of the envelope is passed as ADDITIONAL AUTHENTICATED
//     DATA, so tampering with the username / meta-address / fingerprint / version
//     makes decryption fail rather than silently yielding a mismatched identity.
//   - Wrong passphrase or corrupted blob ⇒ authenticated failure with no partial
//     state. The UI must then offer restore-from-wallet-signature or another
//     backup; it must NEVER silently generate a fresh identity.
//
// WHAT MUST NEVER HAPPEN
//   - The unencrypted payload is never transmitted to the backend, never logged,
//     never placed in a URL, and never written to localStorage.
//   - Browsers with a safer mechanism should persist the ENCRYPTED blob in
//     IndexedDB (see `persistEncryptedBackup`), not localStorage.
import { scrypt, BACKUP_SCRYPT_PARAMS } from './scrypt.js';
import { CHAIN_ID, PROTOCOL_VERSION, SCHEME_ID, metaFingerprint } from './protocol.js';
import { bytesToHex, hexToBytes } from './keccak.js';

export const BACKUP_FORMAT = 'veyra.stealth.backup';
export const BACKUP_VERSION = 1;
const GCM_IV_BYTES = 12;

/* ------------------------------------------------------------------ hex codec */
// The envelope is hex-encoded throughout (unprefixed), which is what
// `validateBackupEnvelope` checks and what makes the blob copy/paste-safe.
const toHex = (bytes) => bytesToHex(bytes).slice(2);
const fromHex = (text) => {
  const bare = String(text ?? '').replace(/^0x/i, '');
  return hexToBytes('0x' + (bare.length % 2 === 0 ? bare : '0' + bare));
};

const utf8 = (text) => new TextEncoder().encode(text);
const randomBytesAsync = (length, cryptoSource) => {
  const bytes = new Uint8Array(length);
  cryptoSource.getRandomValues(bytes);
  return bytes;
};

const stableEnvelopeAad = (envelope) => utf8(JSON.stringify([
  BACKUP_FORMAT, envelope.version, envelope.protocolVersion, envelope.schemeId,
  envelope.chainId, envelope.username, envelope.metaAddress, envelope.fingerprint,
  envelope.kdf.name, envelope.kdf.N, envelope.kdf.r, envelope.kdf.p, envelope.kdf.salt,
]));

/** Envelope fields that are public by definition (no secret material). */
const publicEnvelope = (envelope) => ({
  format: envelope.format,
  version: envelope.version,
  protocolVersion: envelope.protocolVersion,
  schemeId: envelope.schemeId,
  chainId: envelope.chainId,
  username: envelope.username,
  metaAddress: envelope.metaAddress,
  fingerprint: envelope.fingerprint,
  createdAt: envelope.createdAt,
  kdf: envelope.kdf,
  cipher: envelope.cipher,
  ciphertext: envelope.ciphertext,
});

/**
 * Encrypt the private identity material.
 *
 * @param {{spendingPrivateKey:bigint, viewingPrivateKey:bigint, siskPrivateKey?:bigint,
 *          protocolVersion:number, schemeId:number, chainId:number, username:string,
 *          metaAddress:string, fingerprint?:string, createdAt?:string}} secret
 * @param {string} passphrase user-controlled secret
 * @param {{crypto?:Crypto, kdfParams?:object}} [options]
 * @returns {Promise<object>} versioned, self-describing backup envelope (safe to store)
 */
export async function encryptBackup(secret, passphrase, options = {}) {
  const cryptoSource = options.crypto ?? globalThis.crypto;
  if (!cryptoSource?.subtle) throw new Error('WEBCRYPTO_UNAVAILABLE');
  if (!passphrase || String(passphrase).length < 8) throw new Error('PASSPHRASE_TOO_SHORT');
  if (!secret?.metaAddress) throw new Error('META_ADDRESS_REQUIRED');
  if (secret.spendingPrivateKey === undefined || secret.viewingPrivateKey === undefined) {
    throw new Error('PRIVATE_KEYS_REQUIRED');
  }
  // An envelope must state which protocol/scheme/chain it belongs to; a backup that
  // cannot say so must not be importable later (Phase 3.5 finding M-02).
  if (Number(secret.protocolVersion) !== PROTOCOL_VERSION) throw new Error('BACKUP_UNSUPPORTED_PROTOCOL_VERSION');
  if (Number(secret.schemeId) !== SCHEME_ID) throw new Error('BACKUP_UNSUPPORTED_SCHEME');
  if (Number(secret.chainId) !== CHAIN_ID) throw new Error('BACKUP_UNSUPPORTED_CHAIN');

  const kdfParams = { ...BACKUP_SCRYPT_PARAMS, ...(options.kdfParams || {}) };
  const salt = toHex(randomBytesAsync(16, cryptoSource));
  const iv = randomBytesAsync(GCM_IV_BYTES, cryptoSource);
  const fingerprint = secret.fingerprint || metaFingerprint(secret.metaAddress);

  const derived = scrypt(String(passphrase), fromHex(salt), kdfParams);
  const key = await cryptoSource.subtle.importKey('raw', derived, 'AES-GCM', false, ['encrypt']);

  const envelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    protocolVersion: secret.protocolVersion,
    schemeId: secret.schemeId,
    chainId: secret.chainId,
    username: secret.username,
    metaAddress: String(secret.metaAddress).toLowerCase(),
    fingerprint,
    createdAt: secret.createdAt || new Date().toISOString(),
    kdf: { name: 'scrypt', N: kdfParams.N, r: kdfParams.r, p: kdfParams.p, dkLen: kdfParams.dkLen, salt },
    cipher: { name: 'AES-256-GCM', iv: toHex(iv), tagLength: 128 },
    ciphertext: '',
  };

  const payload = utf8(JSON.stringify({
    spendingPrivateKey: '0x' + BigInt(secret.spendingPrivateKey).toString(16).padStart(64, '0'),
    viewingPrivateKey: '0x' + BigInt(secret.viewingPrivateKey).toString(16).padStart(64, '0'),
    ...(secret.siskPrivateKey !== undefined
      ? { siskPrivateKey: '0x' + BigInt(secret.siskPrivateKey).toString(16).padStart(64, '0') }
      : {}),
    protocolVersion: secret.protocolVersion,
    schemeId: secret.schemeId,
    chainId: secret.chainId,
    username: secret.username,
    metaAddress: envelope.metaAddress,
    fingerprint,
  }));

  const ciphertext = await cryptoSource.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: stableEnvelopeAad(envelope), tagLength: 128 },
    key,
    payload,
  );

  envelope.ciphertext = toHex(new Uint8Array(ciphertext));
  return publicEnvelope(envelope);
}

/**
 * Decrypt a backup envelope.
 *
 * @returns {Promise<{spendingPrivateKey:bigint, viewingPrivateKey:bigint, siskPrivateKey:bigint|null,
 *          metadata:object}>}
 * @throws on wrong passphrase, corrupted blob, unsupported version or tampered metadata
 */
export async function decryptBackup(envelope, passphrase, options = {}) {
  const cryptoSource = options.crypto ?? globalThis.crypto;
  if (!cryptoSource?.subtle) throw new Error('WEBCRYPTO_UNAVAILABLE');
  validateBackupEnvelope(envelope);
  if (!passphrase) throw new Error('PASSPHRASE_REQUIRED');

  const derived = scrypt(String(passphrase), fromHex(envelope.kdf.salt), {
    N: envelope.kdf.N, r: envelope.kdf.r, p: envelope.kdf.p, dkLen: envelope.kdf.dkLen ?? 32,
  });
  let key;
  try {
    key = await cryptoSource.subtle.importKey('raw', derived, 'AES-GCM', false, ['decrypt']);
  } catch {
    throw new Error('BACKUP_KEY_IMPORT_FAILED');
  }

  let plaintext;
  try {
    plaintext = await cryptoSource.subtle.decrypt(
      { name: 'AES-GCM', iv: fromHex(envelope.cipher.iv), additionalData: stableEnvelopeAad(envelope), tagLength: 128 },
      key,
      fromHex(envelope.ciphertext),
    );
  } catch {
    // Authenticated failure: wrong passphrase OR tampered/corrupted blob. The two
    // are deliberately indistinguishable to avoid an oracle.
    throw new Error('BACKUP_AUTHENTICATION_FAILED');
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(new Uint8Array(plaintext)));
  } catch {
    throw new Error('BACKUP_PAYLOAD_CORRUPT');
  }

  if (payload.metaAddress !== envelope.metaAddress || payload.fingerprint !== envelope.fingerprint) {
    // Defence in depth: the AAD already binds these, so this is unreachable unless
    // a future format change weakens AAD. Refuse loudly rather than trust it.
    throw new Error('BACKUP_METADATA_MISMATCH');
  }
  if (metaFingerprint(payload.metaAddress) !== envelope.fingerprint) {
    throw new Error('BACKUP_FINGERPRINT_MISMATCH');
  }

  return {
    spendingPrivateKey: BigInt(payload.spendingPrivateKey),
    viewingPrivateKey: BigInt(payload.viewingPrivateKey),
    siskPrivateKey: payload.siskPrivateKey ? BigInt(payload.siskPrivateKey) : null,
    metadata: {
      protocolVersion: payload.protocolVersion,
      schemeId: payload.schemeId,
      chainId: payload.chainId,
      username: payload.username,
      metaAddress: payload.metaAddress,
      fingerprint: payload.fingerprint,
      createdAt: envelope.createdAt,
    },
  };
}

/** Structural validation before any crypto work (fail fast, no partial state). */
export function validateBackupEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') throw new Error('BACKUP_MALFORMED');
  if (envelope.format !== BACKUP_FORMAT) throw new Error('BACKUP_UNSUPPORTED_FORMAT');
  if (Number(envelope.version) !== BACKUP_VERSION) throw new Error('BACKUP_UNSUPPORTED_VERSION');
  if (envelope.kdf?.name !== 'scrypt') throw new Error('BACKUP_UNSUPPORTED_KDF');
  if (envelope.cipher?.name !== 'AES-256-GCM') throw new Error('BACKUP_UNSUPPORTED_CIPHER');
  if (Number(envelope.protocolVersion) !== PROTOCOL_VERSION) throw new Error('BACKUP_UNSUPPORTED_PROTOCOL_VERSION');
  if (Number(envelope.schemeId) !== SCHEME_ID) throw new Error('BACKUP_UNSUPPORTED_SCHEME');
  if (Number(envelope.chainId) !== CHAIN_ID) throw new Error('BACKUP_UNSUPPORTED_CHAIN');
  if (!/^[0-9a-fA-F]{32}$/.test(String(envelope.kdf.salt ?? ''))) throw new Error('BACKUP_MALFORMED_SALT');
  if (!/^[0-9a-fA-F]{24}$/.test(String(envelope.cipher.iv ?? ''))) throw new Error('BACKUP_MALFORMED_IV');
  if (!envelope.ciphertext || !/^[0-9a-fA-F]+$/.test(String(envelope.ciphertext))) throw new Error('BACKUP_MALFORMED_CIPHERTEXT');
  if (!/^0x[0-9a-fA-F]{132}$/.test(String(envelope.metaAddress ?? ''))) throw new Error('BACKUP_MALFORMED_META');
  if (envelope.fingerprint !== metaFingerprint(envelope.metaAddress)) throw new Error('BACKUP_FINGERPRINT_MISMATCH');
  const N = Number(envelope.kdf.N);
  if (!Number.isInteger(N) || N < 1024 || (N & (N - 1)) !== 0) throw new Error('BACKUP_WEAK_KDF_PARAMS');
  return true;
}

/**
 * Persist the ENCRYPTED envelope in IndexedDB (preferred) so it survives local
 * storage clearing while never living beside the passphrase. Falls back to
 * sessionStorage for environments without IndexedDB.
 *
 * The unencrypted payload is never stored anywhere by this module.
 */
export async function persistEncryptedBackup(envelope, { username = envelope.username, indexedDB: idb = globalThis.indexedDB } = {}) {
  validateBackupEnvelope(envelope);
  const record = { id: `veyra-stealth-backup:${username}`, envelope, storedAt: new Date().toISOString() };
  if (!idb) {
    // IndexedDB unavailable: keep it for the session only, never localStorage.
    globalThis.sessionStorage?.setItem(record.id, JSON.stringify(record));
    return { storage: 'sessionStorage', id: record.id };
  }
  await new Promise((resolve, reject) => {
    const open = idb.open('veyra-private-transfer', 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains('backups')) open.result.createObjectStore('backups', { keyPath: 'id' });
    };
    open.onerror = () => reject(new Error('BACKUP_STORAGE_UNAVAILABLE'));
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('backups', 'readwrite');
      tx.objectStore('backups').put(record);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(new Error('BACKUP_STORAGE_WRITE_FAILED')); };
    };
  });
  return { storage: 'indexedDB', id: record.id };
}

/** Read back the encrypted envelope (still encrypted — caller must decrypt). */
export async function loadEncryptedBackup({ username, indexedDB: idb = globalThis.indexedDB } = {}) {
  const id = `veyra-stealth-backup:${username}`;
  if (!idb) {
    const raw = globalThis.sessionStorage?.getItem(id);
    return raw ? JSON.parse(raw).envelope : null;
  }
  return new Promise((resolve, reject) => {
    const open = idb.open('veyra-private-transfer', 1);
    open.onerror = () => reject(new Error('BACKUP_STORAGE_UNAVAILABLE'));
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('backups', 'readonly');
      const request = tx.objectStore('backups').get(id);
      request.onsuccess = () => { db.close(); resolve(request.result?.envelope ?? null); };
      request.onerror = () => { db.close(); reject(new Error('BACKUP_STORAGE_READ_FAILED')); };
    };
  });
}

/** The verbatim message the UI must show before export (§2D.8 failure behaviour). */
export const RECOVERY_LOSS_WARNING =
  'Loss of both your wallet recovery capability and this encrypted backup can permanently prevent recovery of funds sent to your private addresses. Veyra cannot recover them for you.';
