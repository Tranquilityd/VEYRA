# VEYRAWLD Production-Clone Migration Rehearsal

**Date:** 2026-09-27  
**Result:** **PASS — synthetic representative clone rehearsal**  
**Production modified:** **No**  
**Production environment variables modified:** **No**  
**Deployment performed:** **No**

## Important scope statement

The disposable source was **not a byte-for-byte clone of the real Production database**. No read-only Production database URL or sanitized Production dump was available, and hidden Production credentials were not retrieved. The user explicitly selected the **synthetic representative data** option.

The rehearsal used the known pre-release schema shape plus representative linked records for every material subsystem, including retired game identifiers and every legacy withdrawal status. This validates the migration mechanics and constraints, but it cannot identify unknown drift or malformed data that may exist only in the real Production database.

---

# Migration result: PASS

Disposable database retained for review:

- Database: `veyra_prod_clone_rehearsal`
- Engine: local PostgreSQL 17
- Purpose: migration rehearsal only
- Current state: migrated and still present
- Production credentials/data: none

The exact release migration command was run against the clone:

```bash
DATABASE_URL='postgresql://…/veyra_prod_clone_rehearsal' npm run db:migrate
```

The command executed `scripts/migrate.js`, which applies `db/schema.sql`, and completed with:

```text
Veyra schema applied
```

The clone was not deleted.

---

# Representative source data

The pre-migration clone contained:

- Three player accounts with different account ages/social states.
- Three non-zero Arcade balances with lifetime-earned and lifetime-withdrawn values.
- Three historical Arcade sessions and reward-history records.
- Memory Rush plus both retired game identifiers.
- Two casino sessions: one paid and one resolved loss.
- One claimed casino entitlement.
- Two confirmed blockchain transaction records.
- Five withdrawals spanning `eligible`, `submitted`, `confirmed`, `rejected`, and `pending`.
- Two social-verification records including binary proof data.
- One referral.
- Three audit-log records.
- Authentication challenge and admin login-attempt history.

All data was synthetic. No real wallet keys, PII, screenshots, transaction hashes, secrets or Production records were used.

---

# Data preservation

## Row counts

| Table | Before | Immediately after migration | Difference |
|---|---:|---:|---:|
| `users` | 3 | 3 | 0 |
| `auth_challenges` | 1 | 1 | 0 |
| `admin_login_attempts` | 2 | 2 | 0 |
| `arcade_balances` | 3 | 3 | 0 |
| `game_sessions` | 3 | 3 | 0 |
| `arcade_reward_history` | 3 | 3 | 0 |
| `casino_sessions` | 2 | 2 | 0 |
| `casino_claims` | 1 | 1 | 0 |
| `referrals` | 1 | 1 | 0 |
| `social_verifications` | 2 | 2 | 0 |
| `withdrawals` | 5 | 5 | 0 |
| `blockchain_transactions` | 2 | 2 | 0 |
| `audit_logs` | 3 | 3 | 0 |
| `arcade_rounds` | table absent | 0 | new empty table |
| **Tracked existing rows** | **31** | **31** | **0** |

No existing row was deleted or duplicated.

## Exact-content checksums

The JSON-row checksums were identical before and after migration for:

- Players/accounts
- Authentication challenges
- Admin login attempts
- Arcade balances
- Arcade reward history
- Casino sessions
- Casino claims
- Referrals
- Social-verification records, including binary proof bytes
- Blockchain transactions
- Audit logs

Only two tables changed checksums, both because of the expected migration transforms:

1. `game_sessions`: two retired game IDs became `legacy_nonreward`.
2. `withdrawals`: four retired statuses were mapped to current statuses.

All IDs, owners, financial amounts, timestamps, rewards and foreign-key links in those rows remained present.

## Financial preservation

| Measurement | Before | After |
|---|---:|---:|
| Arcade current balance sum | `0.04250000` | `0.04250000` |
| Arcade lifetime-earned sum | `0.05750000` | `0.05750000` |
| Arcade lifetime-withdrawn sum | `0.01500000` | `0.01500000` |
| Withdrawal amount sum | `0.02600000` | `0.02600000` |
| Casino wager sum | `0.00150000` | `0.00150000` |
| Casino payout sum | `0.00150000` | `0.00150000` |
| Social proof binary bytes | 8 | 8 |

---

# Expected data transforms

## Legacy withdrawal statuses

| Before | After | Rows |
|---|---|---:|
| `eligible` | `pending` | 1 |
| `submitted` | `sent` | 1 |
| `confirmed` | `sent` | 1 |
| `rejected` | `cancelled` | 1 |
| `pending` | `pending` | 1 |

Final distribution:

- `pending`: 2
- `sent`: 2
- `cancelled`: 1
- Unexpected statuses: 0

## Retired Arcade game history

Two historical sessions using retired game identifiers were changed to `legacy_nonreward`.

- Historical session rows preserved: 2/2
- Historical reward-history foreign keys preserved: 2/2
- Historical reward amounts preserved
- Retired identifiers remaining after migration: 0

This prevents removed game routes from remaining valid while retaining accounting history.

---

# Schema result

## Migration applied

- Current `db/schema.sql` applied through the real `npm run db:migrate` path.
- New `arcade_rounds` table created.
- Current game-session game constraint installed.
- Current withdrawal-state constraint installed after legacy mapping.
- Existing social and withdrawal compatibility columns remained intact.
- Migration was reapplied through the E2E suite as an idempotency check and passed.

## New Arcade schema functional check

Inside a transaction, the rehearsal successfully created and linked:

- A `neonescape` game session and wave-1 Arcade round.
- An `nback` game session and wave-1 Arcade round.

The test transaction observed two valid new round rows and was rolled back, leaving the preservation clone unchanged.

## Required indexes confirmed

- `game_sessions_client_id`
- `game_sessions_user_time`
- `arcade_rounds_user_time`
- `arcade_rounds_expiry`
- `reward_history_user_time`
- `withdrawal_user_idempotency_unique`
- `withdrawal_tx_unique`
- `social_user_attempt_unique`
- `casino_wager_tx_unique`

## Key constraints confirmed

### Arcade

- `game_sessions_game_check`
- Non-negative score, waves and reward checks
- Game-session user foreign key
- Arcade-round allowed-game, wave-range and state checks
- Arcade-round session and user foreign keys
- Unique `(game_session_id, wave)`
- Unique reward-history row per game session
- Reward-history session/user/referral foreign keys

### Withdrawals/social

- Positive withdrawal amount
- Current withdrawal-state constraint
- Withdrawal user foreign key
- Social attempt-number and state checks
- Social user foreign key

### Casino

- Casino game, wager, payout and status checks
- Casino session user foreign key
- Unique claim per casino session
- Unique claim nonce and transaction hash
- Claim session/user foreign keys
- Claim amount/status checks

## Foreign-key integrity

Post-migration orphan checks all returned zero:

- Game sessions → users: 0
- Arcade rewards → users: 0
- Arcade rewards → game sessions: 0
- Withdrawals → users: 0
- Social verifications → users: 0
- Casino sessions → users: 0
- Casino claims → casino sessions: 0
- Blockchain transactions → users: 0

No existing foreign-key relationship broke.

## Duplicate checks

- Duplicate wallets: 0
- Duplicate client sessions: 0
- Duplicate rewarded game sessions: 0
- Duplicate casino wager hashes: 0

---

# Concurrency result

Concurrency was rerun through the real database-backed E2E suite against a separate disposable test database so the retained migrated clone would not be polluted by test rows.

## Arcade completion/finalization: PASS

Verified:

- Two concurrent completion requests for the same round produce one successful consumer.
- Persisted waves advance exactly once.
- The round reaches `completed` once.
- Concurrent finalization creates one reward-history row.
- Arcade balance is credited once.
- Replayed completion after finalization is rejected.
- Neon Escape concurrent completion protection passes.
- N-Back concurrent completion protection passes.
- Arbitrary client score/wave/reward fields do not alter persisted authority.

## Withdrawal settlement: PASS

Verified:

- Two concurrent admin `sent` requests lock the same withdrawal.
- Balance deduction occurs exactly once.
- One `withdrawal.sent` audit record is created.
- Terminal reconciliation does not perform another deduction.

---

# Tests rerun

| Test | Result |
|---|---|
| Exact clone migration command | **PASS** |
| Post-migration row/checksum comparison | **PASS** |
| Foreign-key orphan checks | **PASS** |
| New Neon Escape/N-Back schema insertion in rollback transaction | **PASS** |
| `npm test` | **PASS — 121/121** |
| `npm run test:integration` | **PASS — 121/121** |
| `npm run test:e2e:casino` | **PASS** |
| Casino database lifecycle | **PASS — 1/1** |
| Arcade/database/concurrency lifecycle | **PASS — 1/1** |

---

# Problems and observations

## 1. Not a literal Production clone — operational limitation

**Severity:** MEDIUM operational limitation

The rehearsal used synthetic representative data because no sanitized Production dump or disposable Production branch was provided. It cannot prove that real Production contains no unknown schema drift, unexpected status values, malformed rows or data volume/locking concerns.

Before deployment, the strongest remaining check is to repeat this process on an actual provider-created branch/clone or sanitized dump.

## 2. Legacy sent records lack newly introduced sent metadata

**Severity:** LOW

The status migration maps legacy `submitted` and `confirmed` rows to `sent`, but does not invent:

- `sent_at`
- `sent_by`
- `payment_reference`

This is correct from a data-integrity perspective—the migration should not fabricate operator/payment evidence—but historical sent records may show blank metadata in admin displays.

## 3. Legacy game identifiers are intentionally collapsed

**Severity:** LOW / expected migration behavior

Retired game IDs are changed to `legacy_nonreward`. This preserves rows and financial links but intentionally removes the distinction between the two retired game types in `game_sessions.game`. Historical audit/reward records remain available, but game-level historical analytics for those two IDs would need a pre-migration export if that distinction must be retained.

## 4. Constraint replacement requires table locks

**Severity:** LOW operational consideration

The schema drops/recreates game-session and withdrawal check constraints and updates matching legacy rows. On the small representative clone this completed immediately. Production volume and lock duration were not measured; schedule the real migration during a controlled maintenance window after examining Production row counts.

## 5. Expected PostgreSQL NOTICE output

**Severity:** Informational

Reapplying the idempotent schema emits `already exists, skipping` notices for existing tables, columns and indexes. These were notices, not failures.

---

# Retained artifacts

- Disposable migrated database: `veyra_prod_clone_rehearsal`
- Synthetic seed: `test/fixtures/production-clone-representative.sql`
- Pre-migration checksums/counts: `test/fixtures/clone-before.snapshot`
- Post-migration checksums/counts: `test/fixtures/clone-after.snapshot`
- Schema/FK/index/constraint validation: `test/fixtures/clone-schema-validation.txt`
- Integrity/duplicate/status validation: `test/fixtures/clone-integrity-validation.txt`

The disposable clone remains present for review.

**No Production database operation or deployment was performed.**
