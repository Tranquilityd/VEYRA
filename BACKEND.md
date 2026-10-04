# Veyra Phase 10 Backend

## Runtime model

This is a Vercel serverless API, not an always-running server. Every request is short,
stateless, and opens at most one pooled external PostgreSQL connection. There are no
workers, timers, queues, WebSockets, or filesystem persistence requirements.

## Provisioning

1. Create an external PostgreSQL database (a pooled/serverless URL is recommended).
2. Copy `.env.example` values into Vercel Project Settings. Never expose these variables
   through browser-prefixed names.
3. Run `DATABASE_URL='…' npm run db:migrate` once from a secure operator environment.
4. Deploy. Without `DATABASE_URL`/`API_SESSION_SECRET`, API functions fail closed; the
   static game still loads but cannot authenticate or credit rewards.

## Authentication

`POST /api/auth/challenge` with `{wallet}` returns a five-minute one-use message.
The wallet signs the message (not a transaction). `POST /api/auth/verify` with
`{wallet,nonce,signature}` consumes the challenge and returns a seven-day HMAC session.
Protected APIs require `Authorization: Bearer <token>`. Private keys never touch Veyra.

## API summary

- `GET /api/balance` — authoritative arcade balance, reward history, withdrawals.
- `POST /api/arcade/session` — `{action:'start',game,clientSessionId}` then
  `{action:'finish',sessionId,waves,score}`. Reward is calculated server-side at
  0.00001 zkLTC per validated wave inside one DB transaction. Client balances are ignored.
- `POST /api/casino/session` — records a transaction report as `pending_verification`.
  Client result/payout/status can never mark it confirmed or paid. A future verified
  LitVM chain adapter must perform those transitions.
- `GET|POST /api/referrals` — issue a server code/list referrals or redeem once.
  Qualification/reward state remains server-controlled.
- `GET|POST /api/social-verification` — list or submit username + object-storage reference.
- `GET|POST /api/withdrawals` — list or atomically reserve an eligible amount from the
  authoritative arcade balance. No private key and no fake transaction hash are used.
- `POST /api/admin/review` — social-verification approve/reject only, protected by the
  signed HttpOnly admin session, same-origin check, and CSRF token.

## Security invariants

- Browser localStorage/sessionStorage is not a balance database. Session storage may hold
  only the signed API authentication token.
- Reward credit, withdrawal eligibility, referral qualification, social status, and
  session validity are decided by server code and PostgreSQL constraints/transactions.
- Arcade credits are idempotent (`UNIQUE(game_session_id)`) and balance changes are
  transactionally paired with history and audit rows.
- Withdrawal requests lock the balance row and reserve funds atomically.
- Casino reports stay pending until independently verified on LitVM.
- API errors are sanitized; detailed failures stay in server logs.
- API responses use `Cache-Control: no-store`; request bodies are capped at 16 KiB.
- All list queries are indexed, time-ordered, and bounded.

## Database

`db/schema.sql` defines users, challenges, arcade balances, reward history, game sessions,
casino sessions, referrals, social verification, withdrawals, and append-only audit logs.
PostgreSQL is the production authority. SQLite is not used.

## Phase 11 private Admin Panel

The panel is served at `/admin/`. Its static login shell contains no credential or secret;
all data APIs require a server-verified HttpOnly admin cookie. Provision it with:

```bash
npm run admin:hash -- 'a long unique password'
```

Place the output in `ADMIN_PASSWORD_SCRYPT`, and configure `ADMIN_USERNAME` plus an
independent 32+ character `ADMIN_SESSION_SECRET` in Vercel. Apply the updated migration
so `users.social_verified_at` and `admin_login_attempts` exist.

Admin sessions expire after eight hours, use `Secure; HttpOnly; SameSite=Strict`, and
state-changing requests require both same-origin validation and a CSRF token carried
inside the signed session. Failed logins are IP-HMAC rate-limited and all login/review
actions are audited.

The role is hard-coded to `social_verifier`. `/api/admin/review` supports only social
approval/rejection. Approval atomically marks the submission and user's one-time
`social_verified_at`; withdrawal eligibility requires that timestamp. Dashboard casino
and withdrawal records are bounded read-only queries. There are no admin endpoints or UI
controls for payments, casino decisions, blockchain approvals, or fund movement.

## Phase 12 LitVM treasury integration

The server-only source of truth is `LITVM_CONTRACT_CONFIG_JSON`; its shape is documented
with null placeholders in `config/litvm-contracts.example.json`. `LITVM_RPC_URL` is kept
separate because a provider URL may contain a secret credential and is never returned to
the browser. The registry refuses to load unless the network is exactly LitVM Testnet,
chain ID/confirmations/token metadata are valid, addresses checksum correctly, ABIs are
non-empty, and every semantic role maps to an item that actually exists in its ABI.
Role keys are application semantics, not invented contract methods; `name`, argument/event
fields, addresses, and ABIs must all come from the verified deployment.

`GET /api/blockchain/config` publishes only the verified wallet-safe subset (optionally an
explicit `publicRpcUrl`). `POST /api/blockchain/transactions` independently fetches the
transaction and receipt, checks destination contract, decodes the configured method or
event, derives user and amount from chain data, compares them to authoritative database
records, counts confirmations, and then records `pending`, `confirmed`, or an actual
receipt-level `failed` state. It never accepts a client-supplied amount/status.

Tracked types are casino wager, casino payout, and arcade withdrawal. Confirmed records
update their related session/withdrawal transactionally. Reverted casino wagers are
failed; a reverted arcade withdrawal leaves its reserved withdrawal eligible for a new
user-signed contract attempt. Rechecking a hash is idempotent. There is no signer, private
key, seed, treasury secret, admin payment endpoint, worker, or manually approved payment.
The Admin Panel displays the tracker through a bounded read-only query only.

## Phase 13 wallet balances

Main Wallet zkLTC is read through the user's wallet adapter and is never stored as a Veyra
balance. Arcade Game Balance remains the PostgreSQL authority returned by `/api/balance`.
`server/arcade-balance.js` is the sole reusable transactional credit path for validated
arcade sessions and qualified referral rewards; referral qualification/amount policy is
not guessed. `arcade_reward_history.referral_id` makes referral credits idempotent.

## Casino outcome authority (architecture correction)

Blockchain is settlement-only. A confirmed wager updates the session to
`wager_confirmed`; only then may authenticated `POST /api/casino/session` with
`action: resolve` generate a result. The endpoint locks the row, generates exactly one
result with `server/casino-outcomes.js`, calculates payout from the recorded wager and
Veyra rules, stores both, and returns the same result on idempotent retries.

Plinko paths, slot reels, dice faces, and coin sides use `node:crypto.randomInt`. The
outcome module does not receive or inspect transaction hashes, block hashes, block
numbers, prevrandao, timestamps, RPC data, wallet balances, or contract state. Contracts
receive wagers and settle the already-recorded payout according to the later verified
adapter configuration; they do not choose results. The admin has no role.

## Initial Admin credentials and rotation

Production admin authentication is configured only with Vercel encrypted secrets:
`ADMIN_USERNAME`, `ADMIN_PASSWORD_SCRYPT`, and `ADMIN_SESSION_SECRET`. The deployed
frontend contains none of them. Generate a replacement hash with:

```bash
npm run admin:hash -- 'a new unique password of at least 14 characters'
```

Replace `ADMIN_PASSWORD_SCRYPT` in Vercel Project Settings → Environment Variables →
Production, then redeploy. Do not store the plaintext password in PostgreSQL or source.
Rotating `ADMIN_SESSION_SECRET` also invalidates every existing admin cookie. The initial
credentials are delivered out-of-band in the completion report and should be rotated on
first setup.

The dashboard exposes bounded read-only tables for users, referrals, game activity,
withdrawals, casino sessions, verified blockchain records, and audit logs. Social
approve/reject remains the only data mutation. An optional treasury address may be placed
inside the server-only `LITVM_CONTRACT_CONFIG_JSON` for settlement verification; it is
validated but omitted from public configuration. There is no signing-key configuration.
