// Veyra — Phase 1: THE canonical .veyra username rules.
//
// This module is the single source of truth for username validation and
// normalization. It is imported by the browser client (live onboarding
// validation) and by the Vercel serverless identity endpoints, so the rules can
// never drift apart. `db/schema.sql` mirrors USERNAME_PATTERN as a CHECK
// constraint, which is the final database-level authority.
//
// A username is stored as its bare body (`lester`) and displayed with the
// suffix (`lester.veyra`). The suffix is never part of stored data.
import { isReservedUsername } from './reservedUsernames.js';

export const USERNAME_SUFFIX = 'veyra';
export const USERNAME_SUFFIX_DISPLAY = '.veyra';
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

// Structural rule, mirrored exactly by the CHECK constraint in db/schema.sql:
//   must start with a letter
//   must end with a letter or number
//   only lowercase letters, numbers and underscores
//   never two underscores in a row
export const USERNAME_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
export const USERNAME_PATTERN_SQL = '^[a-z][a-z0-9]*(_[a-z0-9]+)*$';

// Human-readable rule summary shared by the onboarding UI and the API messages.
export const USERNAME_RULES_TEXT =
  '3–20 characters · letters, numbers and underscores · starts with a letter · ends with a letter or number · no double underscores';

// Stable machine codes. The client maps these to friendly copy and the API
// returns them unchanged, so no raw server text is ever surfaced.
export const USERNAME_REASONS = Object.freeze({
  REQUIRED: 'USERNAME_REQUIRED',
  TOO_SHORT: 'USERNAME_TOO_SHORT',
  TOO_LONG: 'USERNAME_TOO_LONG',
  INVALID_CHARACTERS: 'USERNAME_INVALID_CHARACTERS',
  MUST_START_WITH_LETTER: 'USERNAME_MUST_START_WITH_LETTER',
  MUST_END_WITH_LETTER_OR_NUMBER: 'USERNAME_MUST_END_WITH_LETTER_OR_NUMBER',
  CONSECUTIVE_UNDERSCORES: 'USERNAME_CONSECUTIVE_UNDERSCORES',
  RESERVED: 'USERNAME_RESERVED',
});

const MESSAGES = Object.freeze({
  [USERNAME_REASONS.REQUIRED]: 'Choose a Veyra username.',
  [USERNAME_REASONS.TOO_SHORT]: `Usernames need at least ${USERNAME_MIN_LENGTH} characters.`,
  [USERNAME_REASONS.TOO_LONG]: `Usernames can be at most ${USERNAME_MAX_LENGTH} characters.`,
  [USERNAME_REASONS.INVALID_CHARACTERS]: 'Use only lowercase letters, numbers and underscores.',
  [USERNAME_REASONS.MUST_START_WITH_LETTER]: 'Usernames must start with a letter.',
  [USERNAME_REASONS.MUST_END_WITH_LETTER_OR_NUMBER]: 'Usernames must end with a letter or number.',
  [USERNAME_REASONS.CONSECUTIVE_UNDERSCORES]: 'Usernames cannot contain two underscores in a row.',
  [USERNAME_REASONS.RESERVED]: 'This username is reserved by Veyra.',
});

// Accepts `lester`, `Lester`, ` lester `, `@lester`, `lester.veyra` and
// `LESTER.VEYRA`. Presentation noise is stripped; the rules are then applied to
// the normalized body only.
export function normalizeUsernameInput(raw) {
  const value = String(raw ?? '').trim().replace(/^@+/, '');
  return value.replace(/\.veyra\.?$/i, '').trim().toLowerCase();
}

export const formatDisplayName = (username) =>
  username ? `${String(username).toLowerCase()}${USERNAME_SUFFIX_DISPLAY}` : null;

/**
 * Validate and normalize a candidate username.
 * Always returns the same shape so callers never need to guess:
 *   { ok, username, displayName, reserved, reason, message }
 * `username` is the normalized body (null when invalid), never the suffix form.
 */
export function validateUsername(raw) {
  const username = normalizeUsernameInput(raw);
  const invalid = (reason) => ({ ok: false, username: null, displayName: null, reserved: false, reason, message: MESSAGES[reason] });

  if (!username) return invalid(USERNAME_REASONS.REQUIRED);
  if (username.length < USERNAME_MIN_LENGTH) return invalid(USERNAME_REASONS.TOO_SHORT);
  if (username.length > USERNAME_MAX_LENGTH) return invalid(USERNAME_REASONS.TOO_LONG);
  if (/[^a-z0-9_]/.test(username)) return invalid(USERNAME_REASONS.INVALID_CHARACTERS);
  if (!/^[a-z]/.test(username)) return invalid(USERNAME_REASONS.MUST_START_WITH_LETTER);
  if (!/[a-z0-9]$/.test(username)) return invalid(USERNAME_REASONS.MUST_END_WITH_LETTER_OR_NUMBER);
  if (username.includes('__')) return invalid(USERNAME_REASONS.CONSECUTIVE_UNDERSCORES);
  // Defensive: the ordered checks above must accept exactly what the canonical
  // pattern (and therefore the SQL CHECK constraint) accepts.
  if (!USERNAME_PATTERN.test(username)) return invalid(USERNAME_REASONS.INVALID_CHARACTERS);

  const reserved = isReservedUsername(username);
  return {
    ok: !reserved,
    username: reserved ? null : username,
    displayName: reserved ? null : formatDisplayName(username),
    reserved,
    reason: reserved ? USERNAME_REASONS.RESERVED : null,
    message: reserved ? MESSAGES[USERNAME_REASONS.RESERVED] : '',
  };
}

// True only when the name is syntactically valid and not reserved.
export const isClaimableUsername = (raw) => validateUsername(raw).ok;
