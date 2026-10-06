// Veyra — Phase 1: permanent .veyra identity service.
//
// This is the only place that reads or writes identity columns. Route files in
// `api/identity/` stay thin, exactly like the existing admin/blockchain routers.
// Every function takes `sql` explicitly so the behaviour can be unit-tested
// against a fake postgres client without a live database.
//
// Identity is an ADDITIVE layer: `users.id` stays the immutable primary
// identifier and `users.wallet_address` stays the blockchain identity. A
// username is permanently attached to an existing authenticated user row.
import crypto from 'node:crypto';
import { audit } from './audit.js';
import { env } from './env.js';
import { USERNAME_REASONS, formatDisplayName, validateUsername } from '../src/identity/username.js';

// Database-backed rate limits, following the existing admin_login_attempts
// precedent. Availability/lookup are public and therefore enumeration-sensitive;
// claiming is a one-time action but is still limited.
export const IDENTITY_RATE_LIMITS = Object.freeze({
  availability: { max: 40, window: '1 minute', label: 'availability' },
  lookup: { max: 40, window: '1 minute', label: 'lookup' },
  claim: { max: 8, window: '1 hour', label: 'claim' },
});

export const IDENTITY_ACTIONS = Object.freeze(['availability', 'lookup', 'claim']);

// IPs are only ever stored as a keyed hash — never raw — and reuse the existing
// session secret so no new environment variable is introduced.
export function identityIpHash(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || 'unknown');
  const ip = forwarded.split(',')[0].trim();
  return crypto.createHmac('sha256', env.sessionSecret()).update(`veyra-identity:${ip}`).digest('hex');
}

async function recentAttempts(sql, { ipHash, action }) {
  // Intervals are code constants, never interpolated user input.
  const rows = action === 'claim'
    ? await sql`SELECT count(*)::int AS count FROM identity_attempts WHERE ip_hash=${ipHash} AND action='claim' AND attempted_at > NOW() - INTERVAL '1 hour'`
    : await sql`SELECT count(*)::int AS count FROM identity_attempts WHERE ip_hash=${ipHash} AND action=${action} AND attempted_at > NOW() - INTERVAL '1 minute'`;
  return rows[0]?.count ?? 0;
}

export async function enforceIdentityRateLimit(sql, { ipHash, action }) {
  const limit = IDENTITY_RATE_LIMITS[action];
  if (!limit) throw new Error('INVALID_INPUT');
  if (!ipHash) return;
  if (await recentAttempts(sql, { ipHash, action }) >= limit.max) throw new Error('TOO_MANY_ATTEMPTS');
  await sql`INSERT INTO identity_attempts(ip_hash,action) VALUES(${ipHash},${action})`;
}

/**
 * The authenticated player's own identity. Wallet address is returned only to
 * its owner.
 */
export async function readIdentity(sql, userId) {
  const rows = await sql`SELECT wallet_address, username, username_created_at FROM users WHERE id=${userId}`;
  const row = rows[0];
  if (!row) throw new Error('NOT_FOUND');
  return {
    username: row.username || null,
    displayName: row.username ? formatDisplayName(row.username) : null,
    walletAddress: row.wallet_address,
    hasUsername: Boolean(row.username),
    usernameCreatedAt: row.username_created_at || null,
  };
}

/**
 * Public availability probe. Deliberately returns only booleans and the
 * canonical echo of the requested name — never who owns it, never a user id,
 * never a wallet address.
 */
export async function checkAvailability(sql, rawUsername) {
  const result = validateUsername(rawUsername);
  if (!result.ok) {
    return {
      username: null, displayName: null, valid: false, available: false,
      reserved: result.reason === USERNAME_REASONS.RESERVED,
      reason: result.reason, message: result.message,
    };
  }
  const taken = await sql`SELECT 1 AS taken FROM users WHERE username_normalized=${result.username} LIMIT 1`;
  const available = !taken[0];
  return {
    username: result.username, displayName: result.displayName, valid: true,
    available, reserved: false,
    reason: available ? null : 'USERNAME_TAKEN',
    message: available ? '' : 'That username is already taken.',
  };
}

/**
 * Server-internal resolution of `lester.veyra` -> the owning Veyra user id.
 * The user id is intentionally never returned by an API route; this is the
 * foundation later phases (P2P transfers, friends, profiles) will build on.
 */
export async function resolveIdentityRecord(sql, rawUsername) {
  const result = validateUsername(rawUsername);
  if (!result.ok) return null;
  const rows = await sql`SELECT id, username FROM users WHERE username_normalized=${result.username} LIMIT 1`;
  if (!rows[0]) return null;
  return { userId: rows[0].id, username: rows[0].username };
}

// Public identity projection — the only shape lookup may expose.
export const publicIdentity = (record) =>
  record ? { username: record.username, displayName: formatDisplayName(record.username) } : null;

/**
 * Permanently claim a username for an already-authenticated user.
 * Order: syntax -> normalization -> reserved -> already-claimed -> uniqueness.
 * The `username_normalized IS NULL` guard makes the UPDATE an atomic
 * compare-and-set and the partial unique index is the final authority, so two
 * simultaneous claims can never both succeed.
 */
export async function claimIdentity(sql, { userId, rawUsername }) {
  const result = validateUsername(rawUsername);
  if (!result.ok) throw new Error(result.reason);
  const username = result.username;
  try {
    return await sql.begin(async (tx) => {
      // Serializes concurrent claims of the same normalized name.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`veyra-identity:${username}`}))`;
      const current = await tx`SELECT id, wallet_address, username FROM users WHERE id=${userId} FOR UPDATE`;
      if (!current[0]) throw new Error('NOT_FOUND');
      if (current[0].username) throw new Error('USERNAME_ALREADY_CLAIMED');
      const taken = await tx`SELECT 1 AS taken FROM users WHERE username_normalized=${username} LIMIT 1`;
      if (taken[0]) throw new Error('USERNAME_TAKEN');
      const rows = await tx`UPDATE users SET username=${username}, username_normalized=${username},
          username_created_at=NOW(), last_activity_at=NOW()
        WHERE id=${userId} AND username_normalized IS NULL
        RETURNING username, username_created_at`;
      if (!rows[0]) throw new Error('USERNAME_ALREADY_CLAIMED');
      await audit(tx, {
        userId, action: 'identity.claimed', entityType: 'user_identity', entityId: String(userId),
        metadata: { username, displayName: formatDisplayName(username) },
      });
      return {
        username: rows[0].username,
        displayName: formatDisplayName(rows[0].username),
        walletAddress: current[0].wallet_address,
        hasUsername: true,
        usernameCreatedAt: rows[0].username_created_at,
      };
    });
  } catch (error) {
    // Unique-violation fallback: the database remains the final authority even
    // if two claims interleave between the checks above.
    if (error?.code === '23505') throw new Error('USERNAME_TAKEN');
    throw error;
  }
}
