// Veyra — Phase 1: reserved .veyra usernames.
//
// These names are platform/system identities. They can never be claimed by a
// player, are rejected by the browser AND by the serverless identity endpoints,
// and are enforced from this one list so the two can never disagree.
//
// TO ADD MORE RESERVED NAMES: append them to RESERVED_USERNAMES below, in
// lowercase. Nothing else needs to change — validation, the availability
// endpoint, the claim endpoint, and the test suite all read this list.
// Names are compared after normalization, so `Admin`, `ADMIN` and `admin` are
// all covered by the single entry `admin`.
export const RESERVED_USERNAMES = Object.freeze([
  // Core platform and support identities
  'admin', 'administrator', 'support', 'system', 'official', 'veyra',
  'staff', 'moderator', 'mod', 'mods', 'security', 'help',
  // Financial / infrastructure identities
  'casino', 'arcade', 'wallet', 'treasury', 'bot', 'root', 'owner',
  // Obvious infrastructure / placeholder names that must never belong to a player
  'api', 'www', 'null', 'undefined', 'veyrawld',
]);

const RESERVED_SET = new Set(RESERVED_USERNAMES);

// Reserved lookup is always performed on an already-normalized (lowercase) value.
export const isReservedUsername = (value) => RESERVED_SET.has(String(value ?? '').toLowerCase());
