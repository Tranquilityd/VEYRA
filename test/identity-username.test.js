// Phase 1 — canonical .veyra username rules (src/identity/username.js).
// These are real behaviour tests against the single shared implementation that
// both the browser and the serverless endpoints import.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN, USERNAME_PATTERN_SQL,
  USERNAME_REASONS, USERNAME_SUFFIX_DISPLAY, formatDisplayName, isClaimableUsername,
  normalizeUsernameInput, validateUsername,
} from '../src/identity/username.js';
import { RESERVED_USERNAMES, isReservedUsername } from '../src/identity/reservedUsernames.js';

const reason = (value) => validateUsername(value).reason;

test('accepts the documented valid usernames', () => {
  for (const name of ['lester', 'jide', 'lester123', 'player_1', 'veyra123', 'abc']) {
    const result = validateUsername(name);
    assert.equal(result.ok, true, `${name} should be valid`);
    assert.equal(result.username, name);
    assert.equal(result.displayName, `${name}.veyra`);
    assert.equal(result.reason, null);
  }
});

test('rejects names shorter than the minimum and longer than the maximum', () => {
  assert.equal(reason('a'), USERNAME_REASONS.TOO_SHORT);
  assert.equal(reason('ab'), USERNAME_REASONS.TOO_SHORT);
  assert.equal(reason(''), USERNAME_REASONS.REQUIRED);
  assert.equal(reason('   '), USERNAME_REASONS.REQUIRED);
  assert.equal(validateUsername('abc').ok, true, 'exactly the minimum is valid');
  assert.equal(validateUsername('a'.repeat(USERNAME_MAX_LENGTH)).ok, true, 'exactly the maximum is valid');
  assert.equal(reason('a'.repeat(USERNAME_MAX_LENGTH + 1)), USERNAME_REASONS.TOO_LONG);
  assert.equal(USERNAME_MIN_LENGTH, 3);
  assert.equal(USERNAME_MAX_LENGTH, 20);
});

test('rejects a leading number or underscore', () => {
  assert.equal(reason('1lester'), USERNAME_REASONS.MUST_START_WITH_LETTER);
  assert.equal(reason('_lester'), USERNAME_REASONS.MUST_START_WITH_LETTER);
  assert.equal(reason('9abc'), USERNAME_REASONS.MUST_START_WITH_LETTER);
});

test('rejects a trailing underscore', () => {
  assert.equal(reason('lester_'), USERNAME_REASONS.MUST_END_WITH_LETTER_OR_NUMBER);
  assert.equal(validateUsername('lester1').ok, true);
});

test('rejects spaces, hyphens and special characters', () => {
  assert.equal(reason('les ter'), USERNAME_REASONS.INVALID_CHARACTERS);
  assert.equal(reason('les-ter'), USERNAME_REASONS.INVALID_CHARACTERS);
  assert.equal(reason('lester!'), USERNAME_REASONS.INVALID_CHARACTERS);
  assert.equal(reason('les.ter'), USERNAME_REASONS.INVALID_CHARACTERS);
  assert.equal(reason('lester@veyra'), USERNAME_REASONS.INVALID_CHARACTERS);
  assert.equal(reason('lester$'), USERNAME_REASONS.INVALID_CHARACTERS);
});

test('rejects consecutive underscores', () => {
  assert.equal(reason('le__ster'), USERNAME_REASONS.CONSECUTIVE_UNDERSCORES);
  assert.equal(reason('a___b'), USERNAME_REASONS.CONSECUTIVE_UNDERSCORES);
  assert.equal(validateUsername('le_ster').ok, true, 'a single underscore is allowed');
  assert.equal(validateUsername('a_b_c').ok, true);
});

test('normalizes case, whitespace, the @ prefix and the .veyra suffix', () => {
  assert.equal(normalizeUsernameInput('  LeStEr  '), 'lester');
  assert.equal(normalizeUsernameInput('@lester'), 'lester');
  assert.equal(normalizeUsernameInput('lester.veyra'), 'lester');
  assert.equal(normalizeUsernameInput('LESTER.VEYRA'), 'lester');
  assert.equal(normalizeUsernameInput('@Lester.Veyra'), 'lester');

  const upper = validateUsername('LESTER');
  assert.equal(upper.ok, true, 'claiming is case-insensitive, so uppercase input normalizes');
  assert.equal(upper.username, 'lester');
  assert.equal(upper.displayName, 'lester.veyra');
});

test('uniqueness key is always the normalized lowercase body', () => {
  // Case-insensitive uniqueness: every spelling collapses to one stored value.
  const spellings = ['lester', 'Lester', 'LESTER', '  lester ', '@lester', 'lester.veyra', 'Lester.VEYRA'];
  const normalized = new Set(spellings.map((value) => validateUsername(value).username));
  assert.deepEqual([...normalized], ['lester']);
});

test('never stores the .veyra suffix as part of the canonical username', () => {
  for (const value of ['lester', 'lester.veyra', 'player_1', '@jide.veyra']) {
    const result = validateUsername(value);
    assert.ok(result.username);
    assert.ok(!result.username.includes('.'), `${value} -> ${result.username} must not contain a dot`);
    assert.equal(result.displayName, `${result.username}${USERNAME_SUFFIX_DISPLAY}`);
  }
  assert.equal(formatDisplayName('lester'), 'lester.veyra');
  assert.equal(formatDisplayName(null), null);
});

test('rejects reserved platform usernames', () => {
  const required = ['admin', 'administrator', 'support', 'system', 'official', 'veyra',
    'staff', 'moderator', 'security', 'help', 'casino', 'arcade', 'wallet', 'treasury', 'bot', 'root'];
  for (const name of required) {
    assert.ok(RESERVED_USERNAMES.includes(name), `${name} must be reserved`);
    assert.equal(reason(name), USERNAME_REASONS.RESERVED, `${name} must be rejected`);
    assert.equal(validateUsername(name).reserved, true);
    assert.equal(isClaimableUsername(name), false);
  }
});

test('reserved protection is case-insensitive and survives normalization', () => {
  for (const spelling of ['Admin', 'ADMIN', '@admin', 'admin.veyra', '  SuPpOrT ']) {
    assert.equal(reason(spelling), USERNAME_REASONS.RESERVED, `${spelling} must be reserved`);
  }
  assert.equal(isReservedUsername('ADMIN'), true);
  assert.equal(isReservedUsername('lester'), false);
});

test('the reserved list is an immutable, extensible, lowercase list', () => {
  assert.ok(Array.isArray(RESERVED_USERNAMES));
  assert.ok(Object.isFrozen(RESERVED_USERNAMES));
  for (const name of RESERVED_USERNAMES) {
    assert.equal(name, name.toLowerCase(), `${name} must be stored lowercase`);
    assert.equal(validateUsername(name).username, null);
  }
});

test('reserved names are reported as reserved, not merely invalid', () => {
  const result = validateUsername('treasury');
  assert.equal(result.ok, false);
  assert.equal(result.reserved, true);
  assert.equal(result.reason, USERNAME_REASONS.RESERVED);
  assert.match(result.message, /reserved/i);
});

test('every valid username also satisfies the canonical pattern mirrored in SQL', () => {
  // db/schema.sql installs USERNAME_PATTERN_SQL as a CHECK constraint, so JS and
  // PostgreSQL must agree exactly on what is structurally acceptable.
  const sqlPattern = new RegExp(USERNAME_PATTERN_SQL);
  const samples = [
    'lester', 'jide', 'lester123', 'player_1', 'abc', 'a'.repeat(20), 'le_ster', 'a_b_c', 'z9',
    'ab', 'a'.repeat(21), '1lester', '_lester', 'lester_', 'le__ster', 'les-ter', 'les ter',
    'lester!', '', 'a', 'x_y_z_1', 'a1_b2_c3',
  ];
  for (const sample of samples) {
    const validHere = validateUsername(sample).ok;
    const structurallyValid = sqlPattern.test(sample)
      && sample.length >= USERNAME_MIN_LENGTH
      && sample.length <= USERNAME_MAX_LENGTH
      && !isReservedUsername(sample);
    assert.equal(validHere, structurallyValid, `JS and SQL rules disagree for "${sample}"`);
  }
  assert.ok(USERNAME_PATTERN.test('lester'));
  assert.ok(!USERNAME_PATTERN.test('le__ster'));
  assert.ok(!USERNAME_PATTERN.test('lester_'));
  assert.ok(!USERNAME_PATTERN.test('_lester'));
});

test('validation always returns the same complete shape', () => {
  for (const value of ['lester', 'admin', 'les-ter', '', 'ab', null, undefined, 42]) {
    const result = validateUsername(value);
    assert.deepEqual(Object.keys(result).sort(),
      ['displayName', 'message', 'ok', 'reason', 'reserved', 'username']);
    assert.equal(typeof result.ok, 'boolean');
    if (!result.ok) assert.equal(result.username, null, 'invalid input never yields a username');
    if (result.ok) assert.equal(result.message, '');
  }
});
