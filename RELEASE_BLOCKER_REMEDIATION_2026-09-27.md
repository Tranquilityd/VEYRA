# VEYRAWLD Release-Blocker Remediation Report

**Date:** 2026-09-27  
**Deployment performed:** **No**  
**Release-candidate status:** **READY FOR FINAL MANUAL REVIEW**  
**Current Production status:** unchanged; it does not contain this remediation and must not be treated as the updated release candidate.

## Executive decision

The original HIGH Arcade trust-boundary defect is fixed in the local release candidate. The client can no longer submit completed waves, rewarded score, or reward amount. Rewards are derived exclusively from one-time, server-issued rounds that the server independently verifies and serially advances under database row locks.

Memory Rush and Tile Shift support the new reward protocol. Zombie Dodge and Zombie Shooter remain playable but are explicitly non-reward games because their real-time physics cannot be securely replayed by the current backend. Basketball remains non-reward as before.

The missing casino E2E runner was recovered from the older project workspace, restored, updated to current interfaces, expanded, and successfully executed against a disposable local PostgreSQL 17 staging database. The E2E run also exercises Arcade reward and withdrawal concurrency.

No CRITICAL or HIGH code issue remains in the audited local candidate. Final browser/device/wallet testnet checks and validation on a clone of the actual Production database remain manual release gates.

---

# 1. Arcade reward security

## Old trust model

The prior protocol was:

1. Client requested an Arcade session ID.
2. Client played entirely local game state.
3. Client submitted `waves` and `score` to `api/arcade/session.js`.
4. Server checked only broad elapsed-time plausibility.
5. Server calculated `waves × 0.00001` and credited Arcade balance.

The server therefore protected idempotency and balance writes, but did not establish that the rewarded progression happened.

## New trust model

The new protocol is:

`authenticated client input → server-issued round → signed/bound round token → server-verifiable solution events → server-advanced session state → server-derived reward → atomic server credit`

### Exact mechanism

1. **Authenticated session start**
   - Server creates the `game_sessions` row.
   - Server decides whether that game supports rewards.
   - Client receives no authority over score, waves, or reward.

2. **One server-issued round at a time**
   - Server derives the next wave as `persisted waves + 1`.
   - Client cannot choose or skip the wave number.
   - Server generates the Memory Rush pattern or Tile Shift puzzle using cryptographic randomness.
   - Server persists the public challenge, private verifier state, order, timing bounds, expiry, owner and game.
   - Unique database constraint: `(game_session_id, wave)`.

3. **Bound progression token**
   - Round token is HMAC authenticated with the existing server session secret.
   - It binds the round UUID, game session UUID and authenticated user UUID.
   - Forging, moving to another session, or moving to another player fails verification.
   - A pending round can be re-fetched safely without creating a second round.

4. **Server-verifiable progression**
   - **Memory Rush:** server verifies that submitted selected cells are exactly the unique cells in the server-issued challenge—no missing, duplicate or foreign cells.
   - **Tile Shift:** server replays every submitted swap from the server-issued board, enforces index validity and move budget, and requires the final board to equal the server-issued target.
   - Server enforces the exact next wave, round ownership, issued state, earliest completion time and expiry.
   - An invalid solution or impossible completion rejects and closes the session.

5. **Server advancement**
   - Only successful verification performs `waves = waves + 1` and `score = score + 1`.
   - Those counters are never copied from client fields.
   - Round consumption and session advancement happen in one database transaction under `FOR UPDATE` locks.

6. **Server finalization and credit**
   - Client finalization submits only `{ action: 'finish', sessionId }`.
   - Server reads its persisted completed-round count.
   - Server calculates reward at the configured rate, capped by a 100-wave server limit.
   - Credit, reward history and session terminal state are written atomically.
   - Existing unique `arcade_reward_history.game_session_id` prevents a second credit.

### Important limitation, stated precisely

This protocol proves valid completion of server-issued game challenges in sequence. Like any browser game, it cannot prove that a human rather than automation entered the correct solution after seeing a challenge. It does prevent the original attack: arbitrary wave/score/reward claims, skipping rounds, replaying rounds, moving progression across identities/sessions, instant completion and duplicate balance credit.

## Reward-enabled games

| Game | Reward status | Verification |
|---|---|---|
| Memory Rush | **Enabled** | Exact server-issued cell challenge and unique selected-cell solution |
| Tile Shift | **Enabled** | Server replay of bounded swap sequence to exact server target |
| Zombie Dodge | **Disabled** | Current random, frame-driven physics is not server-replayable |
| Zombie Shooter | **Disabled** | Current random, frame-driven physics is not server-replayable |
| Basketball | **Disabled** | Existing local timing game remains explicitly `noReward:true` |

Zombie Dodge and Zombie Shooter remain playable. Their game-over screens clearly state that rewards are disabled because physics progression is not server-verifiable. They cannot issue reward rounds or credit Arcade balance.

## Reward invariants

- Negative reward: impossible; reward is derived from a non-negative server wave count.
- Excessive reward: capped at 100 server-verified waves.
- Duplicate session reward: blocked by terminal state, row locking and unique reward-history constraint.
- Duplicate round: blocked by row status and unique `(session, wave)`.
- Replay: consumed round no longer has `issued` status.
- Forged session: user-scoped session query fails.
- Forged token: HMAC verification fails.
- Forged score/waves/reward: fields are not read by the API.
- Concurrent completion: row locks permit one consumer only.
- Instant progression: server `not_before` rejects it and closes the session.
- Expired session/round: progression rejected and session closed.

## Safe attack tests performed

| Attack | Result |
|---|---|
| Arbitrary completed waves on finish | Ignored; persisted server waves remain unchanged |
| Arbitrary score | Ignored; score advances only with a verified round |
| Arbitrary reward/negative reward | Ignored; reward calculated server-side |
| Skip to wave 99 | Ignored; server issued wave 1 from persisted state |
| Change game ID during round request | Ignored; server persisted game remained authoritative |
| Reuse another session token | Rejected: `ARCADE_ROUND_TOKEN_INVALID` |
| Change player identity | Rejected by user-scoped lookup/token binding |
| Alter token signature | Rejected |
| Wrong Memory cells | Rejected |
| Duplicate Memory cells | Rejected |
| Invalid Tile indexes | Rejected |
| Tile moves over budget | Rejected |
| Complete immediately with exact answer | Rejected: `ARCADE_ROUND_TOO_FAST`; reward remained zero |
| Continue expired session | Rejected: `ARCADE_SESSION_EXPIRED` |
| Two simultaneous completion calls | Exactly one HTTP 200; one rejected; one persisted wave |
| Two simultaneous finalization calls | Both reconcile to one terminal session; one reward-history row |
| Complete after finalization | Rejected: `ARCADE_SESSION_CLOSED` |
| Request reward round for Zombie Dodge | Rejected: `ARCADE_REWARD_UNAVAILABLE` |
| Finish Zombie Dodge with fake 1,000 waves/reward | Zero reward; `non_reward_game` |

---

# 2. Arcade withdrawal re-audit

The required manual workflow is preserved:

`server-authorized Arcade reward → Arcade Game Balance → player withdrawal request → admin review/manual payment → admin marks Sent → balance deduction`

Verified properties:

- Arcade balance can now be credited by rewarded gameplay only after verified server rounds.
- Referral credit remains a separate server-authorized source.
- Client does not write balance.
- Withdrawal remains manual; no smart-contract automatic withdrawal was introduced.
- Pending withdrawals reserve available balance.
- Player-bound destination wallet is preserved.
- Turnstile remains separate from site-entry hCaptcha.
- Admin transition uses `FOR UPDATE` on withdrawal and balance.
- Balance is deducted only for the admin `sent` transition.
- A concurrent double-`sent` E2E test returned success/reconciliation without double deduction.
- E2E assertion confirmed exactly one `withdrawal.sent` audit event and balance changed from `0.02000000` to `0.01000000` once.

---

# 3. Casino E2E runner

## Why it was missing

The active release workspace was not a Git repository and contained the npm script but not its runner or E2E test directory. Inspection of the permitted historical workspace `/home/user/veyra` found the intended files:

- `scripts/run-casino-e2e.js`
- `test/e2e/casino-flow.test.js`

The runner was therefore a source-workspace omission, not an intentionally retired command.

## What was implemented

- Restored the real guarded runner.
- Preserved safeguards requiring a database explicitly named test/e2e.
- Preserved refusal of apparent Production databases.
- Remote databases require explicit opt-in.
- Updated the historical casino test for the current fairness commitment and current Plinko input contract.
- Added exact atomic-unit wager boundary coverage.
- Replaced financial `Number` tolerance in transaction verification with exact 18-decimal `parseEther` comparison.
- Changed casino session input validation to exact atomic-unit parsing and normalized storage.
- Added sequential execution of:
  1. Casino lifecycle E2E
  2. Arcade/concurrency/schema E2E

## Casino tests performed

- Real wallet challenge creation and cryptographic signature verification.
- Challenge replay rejection.
- Unauthenticated wager rejection.
- Minimum wager accepted.
- Maximum wager accepted.
- Below-minimum rejected.
- Above-maximum rejected.
- Invalid/NaN wager rejected.
- Exact wei-safe amount verification.
- Client-supplied outcome/payout ignored.
- Private fairness seed retained server-side and absent from creation response.
- ABI-encoded `WagerPlaced` fixture through the actual transaction-verification handler.
- Confirmed wager state transition.
- Server-generated Plinko outcome.
- Idempotent resolve and one claim entitlement.
- Missing on-chain session metadata rejection.
- Typed-data claim authorization and signer recovery.
- Private signer key absent from stored authorization.
- Unconfirmed session resolve/claim rejection.
- Wrong player rejection.
- Wrong payout amount rejection.
- Wrong session rejection.
- Wrong nonce rejection.
- Reverted/expired payout does not settle the session.
- Re-authorization uses a new nonce.
- Successful exact payout settlement.
- Duplicate payout hash/claim rejection.

### Browser-wallet items

Wallet UI rejection, extension popup behavior, the visible two-second reveal-to-claim delay, and real LiteForge transaction rejection still require final manual browser testing. The automated suite tests the actual backend authorization/verification boundaries with ABI-correct blockchain fixtures and ephemeral real signatures; it does not pretend a browser extension exists.

## E2E result

- Casino lifecycle: **PASS — 1/1 database-backed scenario**
- Arcade/concurrency/schema lifecycle: **PASS — 1/1 database-backed scenario**
- `npm run test:e2e:casino`: **PASS**

---

# 4. Database and migration validation

## Schema changes

Added `arcade_rounds` with:

- UUID primary key
- Session/user foreign keys
- Reward-game restriction
- Wave range check
- Public challenge JSON
- Server verifier JSON
- `issued/completed/rejected` state check
- `not_before` and expiry
- Unique `(game_session_id, wave)`
- User/time and issued-expiry indexes

Retained and validated:

- Unique reward history per game session
- Unique withdrawal idempotency key per user
- Unique withdrawal transaction hash
- Non-negative Arcade balance/lifetime checks
- Current social-verification fields and attempt index
- Current manual-withdrawal fields and statuses

## Legacy withdrawal migration

Before installing the current status constraint, legacy statuses are translated without deleting records:

- `eligible` → `pending`
- `submitted` → `sent`
- `confirmed` → `sent`
- `rejected` → `cancelled`

## Staging validation performed

A disposable local PostgreSQL 17 database named `veyra_e2e` was created. It was not Production and used no Production credentials.

Validated:

- Fresh schema creation.
- Schema reapplied over populated data.
- Existing users preserved.
- Existing withdrawal IDs preserved.
- Simulated legacy withdrawal statuses migrated to current equivalents.
- Current constraints accepted migrated rows.
- Concurrent Arcade round completion serialized correctly.
- Concurrent Arcade finalization credited once.
- Concurrent admin withdrawal `sent` deducted once.
- Required unique indexes and constraints actively enforced by the E2E paths.

## Remaining database manual gate

The disposable staging test proves migration mechanics and simulated legacy compatibility. A read-only schema/data assessment and migration rehearsal on a clone of the **actual Production database** is still required before deployment. No Production database migration was attempted.

---

# 5. Full regression results

| Command | Result |
|---|---|
| `npm run check` | **PASS** |
| `npm test` | **PASS — 118/118** |
| `npm run build:static` | **PASS** |
| `npm run test:integration` | **PASS — 118/118** |
| `npm run test:e2e:casino` | **PASS — casino + Arcade/database E2E scenarios** |
| Static server-secret scan | **PASS** |

All package test/build scripts relevant to release validation now complete without unexplained failures. `db:migrate` was intentionally not run against Production. `admin:hash` is an operator utility, not a test.

---

# 6. Relevant audit repeat

| Area | Result |
|---|---|
| Casino outcome authority | **PASS — server generated** |
| Casino atomic amount validation | **PASS — exact wei comparison** |
| Casino claim authorization/replay | **PASS — E2E** |
| Plinko deterministic fairness and exact payout | **PASS — regression suite** |
| Arcade reward authority | **PASS for Memory Rush/Tile Shift** |
| Unverifiable Arcade games | **PASS — rewards disabled** |
| Arcade withdrawal lifecycle | **PASS — code/unit/E2E concurrency** |
| Wallet session/challenge security | **PASS — E2E backend; browser extension manual** |
| hCaptcha/site-entry | **PASS — unchanged, fail closed** |
| Admin auth/CSRF/manual payment | **PASS — unchanged; concurrent payment E2E** |
| API authorization/IDOR | **PASS in relevant handlers** |
| Replay protection | **PASS — round, session, challenge, wager, claim and withdrawal controls** |
| Balance integrity | **PASS — transactional credit/deduction tests** |
| Public development modes | **PASS locally — localhost/127.0.0.1 only** |
| VEYRAWLD branding/logo/metadata | **PASS — unchanged** |
| LitVM chain/RPC/contract architecture | **PASS — unchanged** |
| Pause/Guide/map behavior | **PASS — unchanged regressions** |
| Static secret exposure | **PASS** |

---

# 7. Production state

Current Production remains:

- Alias: `https://veyra-tawny.vercel.app/`
- Observed deployment ID: `dpl_HFJduiyBqACLjWeDLwtcKozA69qt`
- LitVM LiteForge Testnet chain ID: 4441
- Configured RPC and casino contract: unchanged
- hCaptcha provider/sitekey: unchanged
- VEYRAWLD branding and official logo: unchanged

Because deployment was explicitly prohibited, Production still runs the previous artifact and does **not** contain the new Arcade protocol, restored E2E files, exact casino amount hardening, or local development-flag guards. No Production claim is made for these local fixes.

---

# 8. Remaining release blockers and manual gates

## Remaining CRITICAL/HIGH issues

**None identified in the local release candidate.**

## Mandatory final manual review

1. Rehearse `db/schema.sql` on a clone of the actual Production database and inspect row counts/status mappings before and after.
2. Play authenticated Memory Rush and Tile Shift through multiple waves, exit and game-over finalization, refresh balance, and verify UI state on desktop/mobile.
3. Confirm Zombie Dodge, Zombie Shooter and Basketball visibly remain non-reward and cannot alter balance.
4. Real wallet extension tests: connect/reject/wrong network/switch/reconnect.
5. Funded LiteForge testnet wager/claim flow for every casino game, including user rejection, reverted transaction, two-second claim delay and refresh/retry.
6. Human hCaptcha entry success and expiry.
7. Authenticated admin review/manual payment on staging.
8. Mobile landscape, portrait guard, long-session performance and network interruption.
9. Review and approve the migration/deployment plan separately. Do not deploy automatically.

---

# 9. Files changed

- `api/arcade/session.js`
- `server/arcade-protocol.js`
- `server/http.js`
- `src/games/arcadeRewards.js`
- `src/ui/arcadeGames.js`
- `db/schema.sql`
- `api/casino/session.js`
- `server/blockchain-transactions-handler.js`
- `scripts/run-casino-e2e.js`
- `test/e2e/casino-flow.test.js`
- `test/e2e/arcade-flow.test.js`
- `test/arcade-security.test.js`
- Previously completed local development-mode/schema regression tests remain preserved.

**No deployment was performed.**
