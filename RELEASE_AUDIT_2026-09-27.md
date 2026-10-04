# VEYRAWLD Pre-Release Audit

**Date:** 2026-09-27  
**Audited production URL:** `https://veyra-tawny.vercel.app/`  
**Production deployment observed:** `dpl_HFJduiyBqACLjWeDLwtcKozA69qt` (`veyra-7kqd8hbr4-vercle6.vercel.app`)  
**Deployment performed during audit:** **No**

## Overall status: NOT READY

Automated checks are green, production public assets and unauthenticated authorization boundaries passed safe probes, and two confirmed release-surface/database-contract defects were fixed locally. However, release approval is blocked by one unresolved **HIGH** issue: Arcade rewards are not genuinely server-authoritative. The finish endpoint accepts client-reported wave counts and validates only elapsed time and broad bounds, so an authenticated client can wait and report unearned waves without proving gameplay.

A second release gate is manual verification. This environment cannot complete a real human hCaptcha, approve a wallet signature, spend LitVM testnet funds, use real mobile touch hardware, or exercise authenticated admin/database state without provided test accounts. Those flows are marked **NEEDS MANUAL TEST**, not passed.

## Test results

| Command/check | Result |
|---|---|
| `npm run check` | **PASS** |
| `npm test` | **PASS — 111/111** |
| `npm run build:static` | **PASS** |
| `npm run test:integration` | **PASS — same 107-test suite at the time it ran** |
| `npm run test:e2e:casino` | **FAIL — configured runner `scripts/run-casino-e2e.js` is missing** |
| Production unauthenticated API probes | **PASS — 14/14 expected statuses** |
| Production referenced top-level asset crawl | **PASS — 12/12 resources returned HTTP 200** |
| Static client secret-name scan | **PASS** |
| LiteForge RPC `eth_chainId` | **PASS — `0x1159` / 4441** |
| Casino contract code check | **PASS — bytecode present at configured address** |

## Systems checked

| System | Status | Evidence / limitation |
|---|---|---|
| Core boot and world source | **NEEDS MANUAL TEST** | Boot/world-entry regression tests pass; asset crawl passes. Real rendering, movement, collision, NPCs, animals, interiors, camera, FPS and long-play behavior require browser/device playtesting. |
| Desktop controls | **NEEDS MANUAL TEST** | Bindings inspected; no interactive browser session was available. |
| Mobile landscape/touch/joystick | **NEEDS MANUAL TEST** | Responsive/orientation code exists; real touch hardware and viewport testing remain required. |
| Portrait orientation guard | **PASS (code/test)** | Existing orientation regression passes; visual device confirmation remains desirable. |
| Pause system | **PASS (code/test)** | `PlayState.paused` remains the sole authority; update paths return while paused; map visibility follows pause state; 4 dedicated pause tests pass. |
| Guide | **PASS (code/test), NEEDS visual manual** | Open/close/Escape/input interception and content assertions pass; mobile/desktop visual scroll should be manually confirmed. |
| Credits/Support | **PASS (code/test)** | Safe external links, clipboard fallback, pause ownership and responsive styles tested. |
| Wallet/LitVM frontend | **NEEDS MANUAL TEST** | Chain configuration inspected and RPC chain verified. Connect/reject/switch/disconnect/reconnect and balance display require an actual wallet. |
| Casino UI and server flow | **PASS (static/unit), NEEDS funded E2E** | Server authorization, transaction verification, settlement ordering, claim reconciliation and duplicate protections inspected/tested. Real signatures, reverts and claims require testnet funds. |
| Plinko | **PASS (unit/static), NEEDS visual E2E** | Current v2 tables, RTP tests, deterministic verification, historical v1 support, wei accounting, claim delay and locking tests pass. Physics animation needs browser observation. |
| Fairness | **PASS (unit/code)** | HMAC commitment/reveal and client reproduction pass for all games; seed commitment checked before result generation; server secret is not returned before reveal. |
| Arcade gameplay | **NEEDS MANUAL TEST** | Mechanics inspected, but full canvas interactions and difficulty progression were not executed in a browser. |
| Arcade reward authority | **FAIL — HIGH** | Client reports waves; server checks only elapsed time/bounds. See blocker AR-01. |
| Basketball | **PASS (code), NEEDS manual play** | 60-second timing, local score and `noReward:true` confirmed in code. |
| Arcade withdrawals | **PASS (code/test), NEEDS authenticated staging E2E** | Minimum, reservation, idempotency, row/advisory locking, one-time verification and deduction-on-sent are covered. Real admin/player workflow remains manual. |
| Casino payment/claim security | **PASS (code/unit), NEEDS on-chain E2E** | Auth ownership filters, verified contract/event/user/session/nonce/amount, unique DB constraints, deadlines and signer checks exist. Actual contract rejection cases need funded testing. |
| hCaptcha/site entry | **PASS (unit/live negative probe), NEEDS one human success test** | Production selects hCaptcha and correct public key; invalid token failed; unverified GET returned false; cookie/session is signed HttpOnly and fail-closed. Human token completion was not automated. |
| Admin system | **PASS (code/live unauthorized probe), NEEDS authenticated admin E2E** | HttpOnly Secure Strict cookie, CSRF, same-origin, role checks and login rate limiting present. Dashboard/review/payment actions need an admin test session. |
| APIs/backend | **PASS for inspected boundaries; NEEDS fault-injection integration** | Safe errors, body limits, method checks and auth probes passed. Database/external-service failure behavior is not fully integration-tested. |
| Database/state | **NEEDS MANUAL/STAGING migration validation** | Race-control patterns inspected. Schema drift was fixed locally; applying against a staging clone is required before production. |
| Branding | **PASS** | Production HTML title is VEYRAWLD; prohibited phase strings absent; favicon/manifest/OG/Twitter assets resolve. |
| Performance/memory | **NEEDS MANUAL TEST** | No browser profiler, long session, throttled network or device memory run was possible. |
| Full user journey | **NEEDS MANUAL TEST** | Blocked by human hCaptcha, wallet signature, funded testnet account, authenticated balances and admin review. |

## Bugs and findings

### AR-01 — Client can report unearned Arcade waves

- **Severity:** **HIGH — RELEASE BLOCKER**
- **Status:** Unresolved; no speculative architecture change made.
- **Affected code:** `api/arcade/session.js`
- **Reproduction (safe/local code path):** Start an authenticated Arcade session, wait long enough for the broad `MIN_SECONDS` bound, then submit `finish` with a chosen `waves` value. The endpoint does not receive or verify game events, challenge state, input sequence, per-wave proof, or server-maintained progression. It computes reward from the client value: `waves * RATE`.
- **Root cause:** The backend is authoritative only over elapsed time, bounds, idempotent session completion and balance crediting—not over the actual game outcome. The client remains the source of the rewarded wave count.
- **Impact:** An authenticated user can automate fabricated but time-plausible sessions and accrue Arcade Game Balance, which can enter the manual withdrawal workflow.
- **Required fix direction:** Introduce server-issued, game-specific session/challenge state and verifiable progress/events, or temporarily make affected games non-rewarding until authoritative validation exists. A mere tighter timer is insufficient.
- **Why not silently fixed:** Correct repair changes the Arcade reward protocol and requires product/security decisions plus migration and gameplay integration.

### REL-01 — Public query parameters enabled development casino/test/debug modes

- **Severity:** **MEDIUM**
- **Status:** **Fixed locally; not deployed**
- **Reproduction:** On a public hostname, `?casinoMock=1` selected `DevelopmentMockAdapter`; `?test` rendered the browser self-test panel; `?debug` enabled the debug renderer.
- **Root cause:** Query flags were not hostname-gated.
- **Impact:** The mock did not produce backend/on-chain claims, but it exposed non-production behavior and could mislead users or complicate release support.
- **Fix:** Restricted all three flags to `localhost` or `127.0.0.1`.
- **Regression tests:** `test/release-surface.test.js`.

### DB-01 — Checked-in schema did not match current social/withdrawal APIs

- **Severity:** **HIGH for fresh deployment/recovery; fixed locally**
- **Status:** **Fixed locally; staging migration validation required; not deployed**
- **Reproduction:** Compare API SQL with `db/schema.sql`. APIs reference `screenshot_data`, `screenshot_mime`, `attempt_number`, `idempotency_key`, `payment_reference`, sent/cancelled metadata and current statuses, but the schema lacked those fields and retained obsolete withdrawal states.
- **Root cause:** Runtime/API evolution was not carried into the canonical schema.
- **Impact:** A fresh database or disaster-recovery migration could build an incompatible schema; social verification and withdrawals would fail.
- **Fix:** Added current columns, status constraint and uniqueness indexes using `CREATE` definitions plus idempotent `ALTER ... ADD COLUMN IF NOT EXISTS` statements.
- **Regression tests:** `test/schema-contract.test.js`.
- **Remaining step:** Apply and validate on a staging clone before production. Existing obsolete rows, if any, must be reviewed before changing the status constraint.

### TEST-01 — Casino E2E npm script points to a missing file

- **Severity:** **MEDIUM**
- **Status:** Unresolved.
- **Reproduction:** `npm run test:e2e:casino` exits with `MODULE_NOT_FOUND` for `scripts/run-casino-e2e.js`.
- **Root cause:** `package.json` references a runner absent from the workspace.
- **Impact:** There is no runnable automated browser-level casino release test despite the script claiming one.
- **Required fix:** Restore the intended runner and its documented browser prerequisites, or replace the script with a real maintained E2E suite. Do not mask this with a no-op.

### SEC-01 — hCaptcha response hostname/sitekey are not explicitly pinned server-side

- **Severity:** **LOW hardening observation**
- **Status:** Not changed, per instruction to avoid refactoring a working critical boundary without a demonstrated bypass.
- **Evidence:** `verifyHcaptchaToken` checks success and action but does not compare returned hostname or send the expected sitekey in `/siteverify`.
- **Mitigation currently present:** The configured public sitekey passes hCaptcha hostname configuration for `veyra-tawny.vercel.app`; rejected/missing/unavailable tokens fail closed.
- **Recommendation:** Confirm hCaptcha account semantics, then add explicit sitekey and allowed-hostname checks with tests in a separately reviewed security change.

### OPS-01 — Production database shape was not directly introspected

- **Severity:** **MEDIUM operational gap**
- **Status:** Needs staging/manual verification.
- **Reason:** Secret database credentials were not read or printed, and no destructive production migration was run.
- **Required check:** Use a read-only schema query or staging clone to compare columns, constraints and indexes against `db/schema.sql`.

### LOW observations

- Plinko emits several `console.debug` geometry/result lifecycle messages in production. No seed secret/private key is logged, but they add console noise.
- Auth challenges and admin login-attempt rows have no visible retention cleanup in the inspected schema/code. This is an operational growth concern, not an immediate authorization bypass.

## Security assessment

### Secrets exposure — PASS

- Static output scan found no references to server secret variable names checked: hCaptcha secret, API session secret, casino signer private key, admin session/password material, or database credentials.
- Vercel lists sensitive values as hidden/secret. Values were not retrieved or printed.
- No server seed secret is exposed before casino reveal.

### Authentication — PASS with manual gaps

- Wallet authentication uses a random, expiring, one-use challenge and verifies the wallet signature.
- Challenge consumption is atomic (`used_at IS NULL` update).
- API bearer sessions are HMAC signed and expiring.
- Site-entry session is purpose-scoped, HMAC signed, ten minutes, HttpOnly, Secure in production and SameSite=Strict.
- Manual wallet and successful human hCaptcha flows remain required.

### Authorization / IDOR — PASS in inspected routes

- Player records are consistently filtered by `auth.sub`.
- Claims, transactions, balances, social submissions and withdrawals are user-scoped.
- Admin endpoints use signed admin cookie, role, CSRF and same-origin controls.
- Safe production probes returned 401 for player/admin data without credentials.

### Payment and claim security — PASS in code/unit; funded E2E required

- Wagers are verified against the configured contract, event, wallet and amount before resolution.
- Claim authorization is generated from server-stored session/wager/payout data.
- Claim transactions verify contract event, wallet, amount, session and nonce.
- Claim rows, transaction hashes and nonces are unique; DB rows are locked during authorization.
- Contract bytecode exists at `0xd2c36B83B1Ca788743E3E9b339e043b6B04e3273` on chain 4441.
- Real wrong-player/wrong-session/expired/replay transactions need testnet E2E confirmation.

### Withdrawal security — PASS in code/unit; authenticated staging E2E required

- Minimum 0.005 enforced server-side.
- Requests use user-bound destination wallet, one-time Turnstile, idempotency key, advisory lock and row locks.
- Pending amounts are reserved; balance deduction occurs only in the admin `sent` transaction.
- Cancelled/failed requests do not deduct.
- Ordinary users have no endpoint to mark a withdrawal sent.

### Replay protection

- Wallet challenges: one use.
- Wager hashes: unique.
- Casino claim per session: unique.
- Claim nonce/hash: unique and contract-verified.
- Withdrawals: per-user idempotency key plus reservation lock.
- Arcade completion: locked and terminal validation status, but the underlying score/wave authority is insufficient (AR-01).

### Client/server trust boundary

- Casino outcomes and payouts are server-generated and chain-gated.
- Withdrawal balances/status are server/database authoritative.
- Site entry is server-cookie authoritative.
- **Exception:** rewarded Arcade wave count is supplied by the client and only plausibility-checked.

## Production configuration

- Production alias: `https://veyra-tawny.vercel.app/`
- Observed deployment: `dpl_HFJduiyBqACLjWeDLwtcKozA69qt`
- Status: READY
- Functions: 11 output functions/items shown by Vercel inspection.
- Network: LitVM LiteForge Testnet
- Chain ID: 4441 (`0x1159` confirmed by RPC)
- RPC: `https://liteforge.rpc.caldera.xyz/http`
- Native currency: zkLTC, 18 decimals
- Casino contract: `0xd2c36B83B1Ca788743E3E9b339e043b6B04e3273`
- Contract bytecode: present (5,304 bytes returned)
- Required confirmations: 1
- hCaptcha provider: hCaptcha
- Public sitekey: configured as requested
- Production hCaptcha secret: present as hidden Vercel secret; not exposed
- Admin/session/signer/database environment variables: present by name; secret values not inspected
- Stable Preview alias was not changed.

## Production branding and asset checks

- Actual production title: `VEYRAWLD`
- Visible primary heading: `VEYRAWLD`
- Guide: `VEYRAWLD GUIDE`
- Credits: `VEYRAWLD CREDITS`
- `Phase 1`, `Development Phase`, and `Test Phase`: absent from production HTML
- Official logo, manifest, JS and all linked CSS resources returned HTTP 200.
- Supplied logo integrity remains covered by checksum regression test.

## API safe-probe summary

Expected responses were observed for:

- Unverified site-entry state: 200 with `verified:false`
- Invalid hCaptcha token: 400, no authorization
- Balance, withdrawals, social verification, referrals: 401 without wallet session
- Casino and Arcade session endpoints: 401 without wallet session
- Blockchain transaction and claim endpoints: 401 without wallet session
- Admin auth/dashboard: 401 without admin session
- Unsupported admin withdrawal GET: 405
- Public blockchain config: 200

No destructive production request was made.

## Remaining required manual checks

1. Human hCaptcha completion, cookie issuance, PLAY enablement, refresh and expiration.
2. Desktop gameplay: movement, collision boundaries, NPCs, animals, doors, interiors, camera and stuck recovery.
3. Real mobile landscape: joystick, run/interact/pause, Guide/Credits, orientation transitions and small screens.
4. Browser console/network waterfall: uncaught errors, missing nested module/assets and CSP/browser-specific issues.
5. Performance profile: first load, 30–60 minute session, repeated interiors, pause loops, arcade/casino loops and memory snapshots.
6. Wallet matrix: MetaMask/Rabby/mobile wallet, rejection, wrong chain, account switch, disconnect/reconnect and stale-state checks.
7. Funded LiteForge testnet casino journey for every game, including win/loss, rejected/reverted wager, delayed receipt, claim failure/retry/reload and duplicate-click attempts.
8. Plinko visual physics at all risks and 1–5 balls, including throttled CPU/reduced motion.
9. Authenticated Arcade gameplay and balance refresh—but do not approve release until AR-01 is resolved.
10. Social verification and withdrawal lifecycle with separate player/admin accounts on staging.
11. Read-only production DB schema comparison and concurrent staging tests for balances, claims and withdrawals.
12. Restore and run a real casino browser E2E suite.
13. Full 24-step player journey from a clean browser profile.

## Local files changed during the audit

- `src/games/casinoWagering.js` — restrict casino mock to localhost.
- `src/main.js` — restrict browser self-test panel to localhost.
- `src/core/Game.js` — restrict debug renderer to localhost.
- `db/schema.sql` — align canonical schema with current social verification and withdrawal APIs.
- `test/release-surface.test.js` — regression coverage for public dev flags.
- `test/schema-contract.test.js` — regression coverage for API/schema compatibility.
- Generated `static-site/` output from validation.

None of these changes were deployed.
