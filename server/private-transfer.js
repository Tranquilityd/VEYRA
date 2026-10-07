// Veyra — Phase 3: private transfer service (server side).
//
// WHAT THE BACKEND IS ALLOWED TO KNOW (brief §2/§3/§13)
//   * the authenticated user id and `.veyra` username,
//   * the PUBLIC protocol material: protocol version, scheme id, the two compressed
//     stealth public keys, the 66-byte meta-address, the public fingerprint and the
//     public stealth-identity signing key (SISK),
//   * public on-chain announcement data (stealth address, ephemeral public key,
//     metadata, transaction hash).
//
// WHAT IT MUST NEVER RECEIVE, DERIVE OR RETURN
//   * any private key, viewing key, spending key, stealth private key, seed or
//     mnemonic — there is no column for them and no code path that accepts them,
//   * the wallet address of a recipient — `publicPrivateTransferIdentity()` is the
//     only projection and it cannot emit an address field,
//   * the recovery signature (it is key-deriving; only the enrollment signature,
//     over a different domain, is transmitted).
//
// Functions take `sql` explicitly so behaviour is unit-testable against a fake
// postgres client, exactly like `server/identity.js`.
import crypto from 'node:crypto';
import { audit } from './audit.js';
import { env } from './env.js';
import { resolveIdentityRecord } from './identity.js';
// Curve validation is shared with the browser client on purpose: an announcement or
// enrollment record that the client would refuse must never be accepted here, and
// echoing the same validation is what keeps Veyra from reproducing the malformed
// ephemeral keys observed from third-party transactions in Phase 2C.
import { parseMetaAddress, validateEphemeralPublicKey } from '../src/stealth/protocol.js';
import { addressFromPersonalSignature, enrollmentMessage } from '../src/stealth/recovery.js';
import { normalizeWallet } from './auth.js';

export const PRIVATE_TRANSFER_PROTOCOL_VERSION = 1;
export const PRIVATE_TRANSFER_SCHEME_ID = 1;

export const PRIVATE_TRANSFER_RATE_LIMITS = Object.freeze({
  resolve: { max: 60, window: '1 minute' },
  announcements: { max: 60, window: '1 minute' },
  enroll: { max: 8, window: '1 hour' },
  // Authenticated reconciliation writes are cheap for us to store but still bounded, so a
  // compromised or buggy client cannot fill the table (Phase 3.5 finding I-02).
  payments: { max: 30, window: '1 hour' },
});

export const PRIVATE_TRANSFER_ACTIONS = Object.freeze(['resolve', 'announcements', 'enroll', 'payments']);

/** Errors that may be surfaced verbatim to the client (allowlist, never widened). */
export const PRIVATE_TRANSFER_ERRORS = Object.freeze([
  'PRIVATE_TRANSFER_NOT_ENROLLED',
  'PRIVATE_TRANSFER_ALREADY_ENROLLED',
  'PRIVATE_TRANSFER_USERNAME_REQUIRED',
  'PRIVATE_TRANSFER_INVALID_META_ADDRESS',
  'PRIVATE_TRANSFER_INVALID_PUBLIC_KEY',
  'PRIVATE_TRANSFER_KEYS_NOT_DISTINCT',
  'PRIVATE_TRANSFER_FINGERPRINT_MISMATCH',
  'PRIVATE_TRANSFER_INVALID_SIGNATURE',
  'PRIVATE_TRANSFER_SIGNATURE_REQUIRED',
  'PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT',
  'PRIVATE_TRANSFER_DUPLICATE_ANNOUNCEMENT',
  'PRIVATE_TRANSFER_UNSUPPORTED_CHAIN',
  'PRIVATE_TRANSFER_UNSUPPORTED_SCHEME',
  'PRIVATE_TRANSFER_UNSUPPORTED_PROTOCOL_VERSION',
  'PRIVATE_TRANSFER_MALFORMED_RECORD',
  'PRIVATE_TRANSFER_ADDRESS_PRESENT',
  'RECIPIENT_NOT_ENROLLED',
  'TOO_MANY_ATTEMPTS',
  'INVALID_INPUT',
  'NOT_FOUND',
  'CONFLICT',
]);

/* --------------------------------------------------------------- primitives */
const HEX = {
  pubkey: /^0x(02|03)[0-9a-f]{64}$/,
  meta: /^0x(02|03)[0-9a-f]{64}(02|03)[0-9a-f]{64}$/,
  fingerprint: /^[0-9a-f]{8}$/,
  address: /^0x[0-9a-f]{40}$/,
  txHash: /^0x[0-9a-f]{64}$/,
  signature: /^0x[0-9a-f]{130}$/,
  metadata: /^0x[0-9a-f]{2}([0-9a-f]{2})*$/,
};

/**
 * Fields that must never reach the client through this surface. `stealthAddress`
 * is intentionally absent: it is a fresh, single-use address that the sender has
 * to know in order to pay it, and it is not the recipient's wallet.
 */
export const FORBIDDEN_FIELD_PATTERN = /^(wallet_address|walletAddress|address|ownerAddress|recipientAddress|normalWalletAddress|publicWalletAddress|eoaAddress|signerAddress|withdrawalAddress)$/;

/** Fail closed: any record carrying a wallet-shaped field is refused, not scrubbed. */
export function assertNoWalletAddress(record) {
  if (!record || typeof record !== 'object') return true;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (FORBIDDEN_FIELD_PATTERN.test(key) && value !== null && value !== undefined && value !== '') {
      throw new Error('PRIVATE_TRANSFER_ADDRESS_PRESENT');
    }
  }
  return true;
}

const lower = (value) => String(value ?? '').trim().toLowerCase();

/** Point-on-curve check (33-byte compressed, prefix 02/03, on secp256k1). */
function isCompressedPoint(value) {
  const text = lower(value);
  if (!HEX.pubkey.test(text)) return false;
  return validateEphemeralPublicKey(text).ok === true;
}

/** 66-byte, two distinct, on-curve keys. */
function isMetaAddress(value) {
  const text = lower(value);
  if (!HEX.meta.test(text)) return false;
  return parseMetaAddress(text).ok === true;
}

/**
 * The ONLY public projection of a private-transfer identity.
 * There is no parameter that can add a wallet address to this object.
 */
export function publicPrivateTransferIdentity(record) {
  if (!record) return null;
  // Fail closed BEFORE projecting: a backend regression that starts selecting a
  // wallet column must break loudly here rather than quietly dropping the field.
  assertNoWalletAddress(record);
  const identity = {
    username: record.username ?? null,
    protocolVersion: Number(record.protocol_version ?? record.protocolVersion ?? PRIVATE_TRANSFER_PROTOCOL_VERSION),
    schemeId: Number(record.scheme_id ?? record.schemeId ?? PRIVATE_TRANSFER_SCHEME_ID),
    spendingPublicKey: lower(record.spending_public_key ?? record.spendingPublicKey),
    viewingPublicKey: lower(record.viewing_public_key ?? record.viewingPublicKey),
    metaAddress: lower(record.meta_address ?? record.metaAddress),
    fingerprint: lower(record.fingerprint),
    siskPublicKey: record.sisk_public_key ? lower(record.sisk_public_key) : lower(record.siskPublicKey),
    status: record.status ?? 'active',
    createdAt: record.created_at ?? record.createdAt ?? null,
  };
  assertNoWalletAddress(identity);
  return identity;
}

/** Validate an enrollment payload. Public material only — a private key here fails. */
export function validateEnrollmentInput(input = {}) {
  const protocolVersion = Number(input.protocolVersion);
  if (protocolVersion !== PRIVATE_TRANSFER_PROTOCOL_VERSION) throw new Error('PRIVATE_TRANSFER_UNSUPPORTED_PROTOCOL_VERSION');
  const schemeId = Number(input.schemeId);
  if (schemeId !== PRIVATE_TRANSFER_SCHEME_ID) throw new Error('PRIVATE_TRANSFER_UNSUPPORTED_SCHEME');

  const metaAddress = lower(input.metaAddress);
  if (!isMetaAddress(metaAddress)) throw new Error('PRIVATE_TRANSFER_INVALID_META_ADDRESS');

  const spendingPublicKey = lower(input.spendingPublicKey);
  const viewingPublicKey = lower(input.viewingPublicKey);
  if (!isCompressedPoint(spendingPublicKey) || !isCompressedPoint(viewingPublicKey)) throw new Error('PRIVATE_TRANSFER_INVALID_PUBLIC_KEY');
  if (spendingPublicKey === viewingPublicKey) throw new Error('PRIVATE_TRANSFER_KEYS_NOT_DISTINCT');
  if (metaAddress !== spendingPublicKey + viewingPublicKey.slice(2)) throw new Error('PRIVATE_TRANSFER_MALFORMED_RECORD');

  const fingerprint = lower(input.fingerprint);
  if (!HEX.fingerprint.test(fingerprint)) throw new Error('PRIVATE_TRANSFER_FINGERPRINT_MISMATCH');

  const siskPublicKey = lower(input.siskPublicKey);
  if (!isCompressedPoint(siskPublicKey)) throw new Error('PRIVATE_TRANSFER_INVALID_PUBLIC_KEY');

  const enrollmentSignature = lower(input.enrollmentSignature);
  if (!enrollmentSignature) throw new Error('PRIVATE_TRANSFER_SIGNATURE_REQUIRED');
  if (!HEX.signature.test(enrollmentSignature)) throw new Error('PRIVATE_TRANSFER_INVALID_SIGNATURE');

  // Defence in depth: refuse a payload that smuggles in a private key field at all.
  for (const key of Object.keys(input)) {
    if (/private|seed|mnemonic/i.test(key) && input[key]) throw new Error('PRIVATE_TRANSFER_INVALID_INPUT');
  }

  return {
    protocolVersion, schemeId, metaAddress, spendingPublicKey, viewingPublicKey,
    fingerprint, siskPublicKey, enrollmentSignature,
  };
}

/** Validate an announcement before it is stored. Mirrors the on-chain validation. */
export function validateAnnouncementInput(input = {}, { currentChainId = 4441 } = {}) {
  const chainId = Number(input.chainId ?? currentChainId);
  if (chainId !== currentChainId) throw new Error('PRIVATE_TRANSFER_UNSUPPORTED_CHAIN');
  const schemeId = Number(input.schemeId);
  if (schemeId !== PRIVATE_TRANSFER_SCHEME_ID) throw new Error('PRIVATE_TRANSFER_UNSUPPORTED_SCHEME');

  const stealthAddress = lower(input.stealthAddress);
  if (!HEX.address.test(stealthAddress)) throw new Error('PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT');
  const ephemeralPublicKey = lower(input.ephemeralPublicKey);
  if (!isCompressedPoint(ephemeralPublicKey)) throw new Error('PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT');
  const metadata = lower(input.metadata);
  if (!HEX.metadata.test(metadata)) throw new Error('PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT');

  const transactionHash = lower(input.transactionHash);
  if (!HEX.txHash.test(transactionHash)) throw new Error('PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT');

  return { chainId, schemeId, stealthAddress, ephemeralPublicKey, metadata, transactionHash };
}

/* --------------------------------------------------------------- rate limits */
export function privateTransferIpHash(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || 'unknown');
  const ip = forwarded.split(',')[0].trim();
  return crypto.createHmac('sha256', env.sessionSecret()).update(`veyra-private-transfer:${ip}`).digest('hex');
}

export async function enforcePrivateTransferRateLimit(sql, { ipHash, action }) {
  const limit = PRIVATE_TRANSFER_RATE_LIMITS[action];
  if (!limit) throw new Error('INVALID_INPUT');
  if (!ipHash) return;
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM private_transfer_attempts
    WHERE ip_hash=${ipHash} AND action=${action}
      AND attempted_at > NOW() - (${limit.window})::interval`;
  if (count >= limit.max) throw new Error('TOO_MANY_ATTEMPTS');
  await sql`INSERT INTO private_transfer_attempts(ip_hash,action) VALUES(${ipHash},${action})`;
}

/* --------------------------------------------------------------- enrollment */
/**
 * Create the caller's private-transfer identity. Idempotent per user: a second
 * enrollment is refused with PRIVATE_TRANSFER_ALREADY_ENROLLED so a wallet that
 * produced a different signature can never silently replace a funded identity.
 */
export async function enrollPrivateTransferIdentity(sql, { userId, input, walletClass = 'eoa' }) {
  if (!userId) throw new Error('UNAUTHORIZED');
  const record = validateEnrollmentInput(input);

  const users = await sql`SELECT username, wallet_address FROM users WHERE id=${userId} LIMIT 1`;
  const user = users[0];
  if (!user) throw new Error('NOT_FOUND');
  if (!user.username) throw new Error('PRIVATE_TRANSFER_USERNAME_REQUIRED');

  // Prove the meta-address was authorised by the wallet that owns this username: the
  // backend never trusts a client's word about which keys belong to an account.
  const expectedMessage = enrollmentMessage({
    username: user.username,
    metaAddress: record.metaAddress,
    siskPublicKey: record.siskPublicKey,
    chainId: record.chainId ?? 4441,
    protocolVersion: record.protocolVersion,
  });
  let signer;
  try {
    signer = addressFromPersonalSignature({ message: expectedMessage, signature: record.enrollmentSignature });
  } catch {
    throw new Error('PRIVATE_TRANSFER_INVALID_SIGNATURE');
  }
  if (signer !== normalizeWallet(user.wallet_address)) throw new Error('PRIVATE_TRANSFER_INVALID_SIGNATURE');

  const existing = await sql`SELECT id FROM private_transfer_identities WHERE user_id=${userId} LIMIT 1`;
  if (existing[0]) {
    await audit(sql, { userId, action: 'private_transfer_enroll_rejected', entityType: 'private_transfer_identity', entityId: existing[0].id, metadata: { reason: 'already_enrolled' } });
    throw new Error('PRIVATE_TRANSFER_ALREADY_ENROLLED');
  }

  const inserted = await sql`INSERT INTO private_transfer_identities
    (user_id, protocol_version, scheme_id, spending_public_key, viewing_public_key, meta_address, fingerprint, sisk_public_key, enrollment_signature, wallet_class)
    VALUES (${userId}, ${record.protocolVersion}, ${record.schemeId}, ${record.spendingPublicKey}, ${record.viewingPublicKey},
            ${record.metaAddress}, ${record.fingerprint}, ${record.siskPublicKey}, ${record.enrollmentSignature}, ${walletClass})
    RETURNING id, protocol_version, scheme_id, spending_public_key, viewing_public_key, meta_address, fingerprint, sisk_public_key, status, created_at`;

  const row = { ...inserted[0], username: user.username };
  await audit(sql, {
    userId,
    action: 'private_transfer_enrolled',
    entityType: 'private_transfer_identity',
    entityId: row.id,
    // Public material only. The signature and the username stay out of the log.
    metadata: { fingerprint: row.fingerprint, schemeId: record.schemeId, protocolVersion: record.protocolVersion },
  });
  return publicPrivateTransferIdentity(row);
}

/** The caller's own identity (public fields only). */
export async function readPrivateTransferIdentity(sql, userId) {
  const rows = await sql`SELECT i.id, i.protocol_version, i.scheme_id, i.spending_public_key, i.viewing_public_key,
      i.meta_address, i.fingerprint, i.sisk_public_key, i.status, i.created_at, u.username
    FROM private_transfer_identities i JOIN users u ON u.id = i.user_id
    WHERE i.user_id=${userId} LIMIT 1`;
  if (!rows[0]) return null;
  return publicPrivateTransferIdentity(rows[0]);
}

/**
 * Resolve `bob.veyra` to PUBLIC stealth material.
 *
 * The join deliberately selects no wallet column — Phase 1's public lookup already
 * returns `{username, displayName}` and this function must not change that. A user
 * without an enrolled private-transfer identity yields RECIPIENT_NOT_ENROLLED, the
 * same answer a non-existent account produces for any other probe: there is no
 * oracle distinguishing "exists but not enrolled" from "does not exist", because the
 * enrollment check happens on the row we already resolved through Phase 1.
 */
export async function resolvePrivateTransferIdentity(sql, rawUsername) {
  const resolved = await resolveIdentityRecord(sql, rawUsername);
  if (!resolved) return null;
  const rows = await sql`SELECT i.protocol_version, i.scheme_id, i.spending_public_key, i.viewing_public_key,
      i.meta_address, i.fingerprint, i.sisk_public_key, i.status
    FROM private_transfer_identities i WHERE i.user_id=${resolved.userId} AND i.status='active' LIMIT 1`;
  if (!rows[0]) throw new Error('RECIPIENT_NOT_ENROLLED');
  const identity = publicPrivateTransferIdentity({ ...rows[0], username: resolved.username });
  if (identity.protocolVersion !== PRIVATE_TRANSFER_PROTOCOL_VERSION || identity.schemeId !== PRIVATE_TRANSFER_SCHEME_ID) {
    throw new Error('PRIVATE_TRANSFER_UNSUPPORTED_PROTOCOL_VERSION');
  }
  return identity;
}

/* --------------------------------------------------------------- announcements */
/**
 * Record a public announcement. Idempotent on the transaction hash so a retry
 * after a dropped response cannot create a duplicate row.
 */
export async function recordAnnouncement(sql, { userId = null, input, ipHash = null }) {
  const record = validateAnnouncementInput(input);
  // Authenticated, but still bounded: a compromised client must not be able to fill the
  // announcement table (Phase 3.5 finding I-02).
  if (ipHash) await enforcePrivateTransferRateLimit(sql, { ipHash, action: 'announcements' });
  const existing = await sql`SELECT id FROM private_transfer_announcements WHERE transaction_hash=${record.transactionHash} LIMIT 1`;
  if (existing[0]) return { id: existing[0].id, duplicate: true, announcement: { ...record, blockNumber: null } };

  const inserted = await sql`INSERT INTO private_transfer_announcements
    (chain_id, scheme_id, stealth_address, ephemeral_public_key, metadata, transaction_hash, block_number, submitted_by)
    VALUES (${record.chainId}, ${record.schemeId}, ${record.stealthAddress}, ${record.ephemeralPublicKey},
            ${record.metadata}, ${record.transactionHash}, ${input.blockNumber ?? null}, ${userId})
    RETURNING id, created_at`;
  await audit(sql, {
    userId,
    action: 'private_transfer_announced',
    entityType: 'private_transfer_announcement',
    entityId: String(inserted[0].id),
    metadata: { transactionHash: record.transactionHash }, // public on-chain data only
  });
  return { id: inserted[0].id, duplicate: false, announcement: { ...record, blockNumber: input.blockNumber ?? null } };
}

/**
 * Public, unfiltered, cursor-paginated announcement list. There is intentionally no
 * `username`/`userId` parameter: a per-user scan endpoint would be an oracle that
 * tells anyone which announcements belong to a given `.veyra` name (brief §10).
 */
export async function listAnnouncements(sql, { cursor = 0, limit = 100 } = {}) {
  const size = Math.max(1, Math.min(Number(limit) || 100, 200));
  const after = Number(cursor) || 0;
  const rows = await sql`SELECT id, chain_id, scheme_id, stealth_address, ephemeral_public_key, metadata, transaction_hash, block_number
    FROM private_transfer_announcements
    WHERE id > ${after}
    ORDER BY id ASC
    LIMIT ${size + 1}`;
  const page = rows.slice(0, size);
  const announcements = page.map((row) => ({
    id: Number(row.id),
    chainId: Number(row.chain_id),
    schemeId: Number(row.scheme_id),
    stealthAddress: row.stealth_address,
    ephemeralPublicKey: row.ephemeral_public_key,
    metadata: row.metadata,
    transactionHash: row.transaction_hash,
    blockNumber: row.block_number === null || row.block_number === undefined ? null : String(row.block_number),
  }));
  const nextCursor = rows.length > size ? Number(page[page.length - 1].id) : null;
  return { announcements, nextCursor };
}

/* --------------------------------------------------------------- payments */
const PAYMENT_STATUSES = Object.freeze([
  'payment_submitted', 'payment_confirming', 'payment_confirmed',
  'announcement_submitting', 'announcement_confirmed', 'completed', 'failed',
]);

/**
 * Record the sender-side, non-secret reconciliation row for a settled payment.
 * No recipient identity is stored (no username, no meta-address, no wallet), so the
 * table cannot be turned into a `.veyra → .veyra` transfer graph.
 */
export async function recordPrivateTransferPayment(sql, { userId, input, ipHash = null }) {
  if (!userId) throw new Error('UNAUTHORIZED');
  if (ipHash) await enforcePrivateTransferRateLimit(sql, { ipHash, action: 'payments' });
  const stealthAddress = lower(input.stealthAddress);
  const ephemeralPublicKey = lower(input.ephemeralPublicKey);
  const viewTag = lower(input.viewTag);
  const paymentTxHash = lower(input.paymentTxHash);
  if (!HEX.address.test(stealthAddress)) throw new Error('PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT');
  if (!isCompressedPoint(ephemeralPublicKey)) throw new Error('PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT');
  if (!/^0x[0-9a-f]{2}$/.test(viewTag)) throw new Error('PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT');
  if (!HEX.txHash.test(paymentTxHash)) throw new Error('PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT');
  const amount = BigInt(String(input.amountAtomic ?? '0'));
  if (amount <= 0n) throw new Error('INVALID_INPUT');
  const status = PAYMENT_STATUSES.includes(input.status) ? input.status : 'payment_submitted';

  const existing = await sql`SELECT id FROM private_transfer_payments WHERE payment_tx_hash=${paymentTxHash} LIMIT 1`;
  if (existing[0]) return { paymentId: existing[0].id, duplicate: true };

  const rows = await sql`INSERT INTO private_transfer_payments
    (user_id, chain_id, scheme_id, protocol_version, stealth_address, ephemeral_public_key, view_tag, amount_atomic, payment_tx_hash, status)
    VALUES (${userId}, 4441, ${PRIVATE_TRANSFER_SCHEME_ID}, ${PRIVATE_TRANSFER_PROTOCOL_VERSION},
            ${stealthAddress}, ${ephemeralPublicKey}, ${viewTag}, ${amount.toString()}, ${paymentTxHash}, ${status})
    RETURNING id`;
  await audit(sql, {
    userId,
    action: 'private_transfer_payment_recorded',
    entityType: 'private_transfer_payment',
    entityId: rows[0].id,
    metadata: { paymentTxHash, status }, // no recipient, no address
  });
  return { paymentId: rows[0].id, duplicate: false };
}

/** Attach the announcement transaction to a payment and advance its status. */
export async function attachAnnouncementToPayment(sql, { userId, paymentId, announcementTxHash, status = 'announcement_confirmed' }) {
  if (!userId) throw new Error('UNAUTHORIZED');
  const hash = lower(announcementTxHash);
  if (!HEX.txHash.test(hash)) throw new Error('PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT');
  const nextStatus = PAYMENT_STATUSES.includes(status) ? status : 'announcement_confirmed';
  const rows = await sql`UPDATE private_transfer_payments
    SET announcement_tx_hash=${hash}, status=${nextStatus}, updated_at=now()
    WHERE id=${paymentId} AND user_id=${userId}
    RETURNING id, status`;
  if (!rows[0]) throw new Error('NOT_FOUND');
  return { paymentId: rows[0].id, status: rows[0].status };
}

/** Sender-side reconciliation list. Never joined to a recipient identity. */
export async function listPrivateTransferPayments(sql, { userId, limit = 20 } = {}) {
  if (!userId) throw new Error('UNAUTHORIZED');
  const size = Math.max(1, Math.min(Number(limit) || 20, 50));
  const rows = await sql`SELECT id, stealth_address, ephemeral_public_key, view_tag, amount_atomic,
      payment_tx_hash, announcement_tx_hash, status, failure_reason, created_at
    FROM private_transfer_payments WHERE user_id=${userId} ORDER BY created_at DESC LIMIT ${size}`;
  return rows.map((row) => ({
    paymentId: row.id,
    stealthAddress: row.stealth_address,
    ephemeralPublicKey: row.ephemeral_public_key,
    viewTag: row.view_tag,
    amountAtomic: String(row.amount_atomic),
    paymentTxHash: row.payment_tx_hash,
    announcementTxHash: row.announcement_tx_hash,
    status: row.status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  }));
}
