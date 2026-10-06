-- Veyra Phase 10 — external PostgreSQL schema.
-- Apply with your provider's migration console. PostgreSQL 15+ recommended.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL UNIQUE,
  referral_code text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  social_verified_at timestamptz
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS social_verified_at timestamptz;

-- Phase 1 — permanent .veyra identity layer.
-- Purely additive and nullable: existing wallet accounts keep working with no
-- username, and `users.id` / `users.wallet_address` remain the immutable
-- identifiers. A username is permanently bound to one existing user row and is
-- never reassigned.
--   username            canonical bare body, e.g. `lester` (never `lester.veyra`)
--   username_normalized lowercase uniqueness key (the final authority)
--   username_created_at claim timestamp; NULL means "no username yet"
ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_normalized text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_created_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_normalized_unique
  ON users(username_normalized) WHERE username_normalized IS NOT NULL;
-- Database-level format authority. Mirrors USERNAME_PATTERN in
-- src/identity/username.js: starts with a letter, ends with a letter or number,
-- lowercase letters/numbers/underscores only, and never two underscores in a row.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_normalized_format;
ALTER TABLE users ADD CONSTRAINT users_username_normalized_format CHECK (
  username_normalized IS NULL OR (
    username_normalized ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'
    AND char_length(username_normalized) BETWEEN 3 AND 20
  )
);
-- A named username is always stored with its normalized form and claim time.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_pairing;
ALTER TABLE users ADD CONSTRAINT users_username_pairing CHECK (
  (username IS NULL AND username_normalized IS NULL AND username_created_at IS NULL)
  OR (username IS NOT NULL AND username_normalized IS NOT NULL AND username_created_at IS NOT NULL)
);

-- Database-backed identity rate limits (mirrors admin_login_attempts). IPs are
-- stored only as a keyed HMAC, never in raw form.
CREATE TABLE IF NOT EXISTS identity_attempts (
  id bigserial PRIMARY KEY,
  ip_hash text NOT NULL,
  action text NOT NULL CHECK (action IN ('availability','lookup','claim')),
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS identity_attempts_rate ON identity_attempts(ip_hash, action, attempted_at DESC);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_address text NOT NULL,
  nonce_hash text NOT NULL, message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_challenge_lookup ON auth_challenges(wallet_address, nonce_hash, expires_at);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id bigserial PRIMARY KEY, ip_hash text NOT NULL, succeeded boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_login_rate ON admin_login_attempts(ip_hash, attempted_at DESC);

CREATE TABLE IF NOT EXISTS arcade_balances (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance numeric(24,8) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned numeric(24,8) NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_withdrawn numeric(24,8) NOT NULL DEFAULT 0 CHECK (lifetime_withdrawn >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  game text NOT NULL CHECK (game IN ('memrush','tileshift','neonescape','nback','legacy_nonreward')),
  score bigint NOT NULL DEFAULT 0 CHECK (score >= 0), waves integer NOT NULL DEFAULT 0 CHECK (waves >= 0),
  reward numeric(24,8) NOT NULL DEFAULT 0 CHECK (reward >= 0),
  started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
  validation_status text NOT NULL DEFAULT 'started' CHECK (validation_status IN ('started','pending','validated','rejected')),
  validation_reason text, client_session_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_sessions_user_time ON game_sessions(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS game_sessions_client_id ON game_sessions(user_id, client_session_id) WHERE client_session_id IS NOT NULL;
-- Preserve historical rows from retired cabinets without exposing those game IDs
-- through the current API or UI.
ALTER TABLE game_sessions DROP CONSTRAINT IF EXISTS game_sessions_game_check;
UPDATE game_sessions SET game='legacy_nonreward' WHERE game IN ('zdodge','zshooter');
ALTER TABLE game_sessions ADD CONSTRAINT game_sessions_game_check CHECK (game IN ('memrush','tileshift','neonescape','nback','legacy_nonreward'));

-- Server-authoritative reward rounds. Only challenges persisted here may advance
-- a rewarded session; one round exists per server-derived wave and is consumed once.
CREATE TABLE IF NOT EXISTS arcade_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game text NOT NULL CHECK (game IN ('memrush','tileshift','neonescape','nback')),
  wave integer NOT NULL CHECK (wave >= 1 AND wave <= 100),
  challenge jsonb NOT NULL,
  verifier jsonb NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','completed','rejected')),
  not_before timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(game_session_id, wave)
);
CREATE INDEX IF NOT EXISTS arcade_rounds_user_time ON arcade_rounds(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS arcade_rounds_expiry ON arcade_rounds(status, expires_at) WHERE status='issued';

CREATE TABLE IF NOT EXISTS arcade_reward_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  game_session_id uuid REFERENCES game_sessions(id), amount numeric(24,8) NOT NULL CHECK (amount > 0),
  balance_after numeric(24,8) NOT NULL CHECK (balance_after >= 0), reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(game_session_id)
);
CREATE INDEX IF NOT EXISTS reward_history_user_time ON arcade_reward_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS casino_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  game text NOT NULL CHECK (game IN ('plinko','slot','dice','coin')),
  wager numeric(24,8) NOT NULL CHECK (wager >= 0.0005 AND wager <= 1),
  result jsonb, payout numeric(24,8) CHECK (payout >= 0), wager_tx_hash text, payout_tx_hash text,
  status text NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification','wager_confirmed','resolved','paid','failed','rejected')),
  started_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS casino_sessions_user_time ON casino_sessions(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS casino_wager_tx_unique ON casino_sessions(wager_tx_hash) WHERE wager_tx_hash IS NOT NULL;

-- Phase 12: one immutable claim entitlement per winning casino session.
-- Authorization data may contain a public proof/signature, never a signer key or seed phrase.
CREATE TABLE IF NOT EXISTS casino_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  casino_session_id uuid NOT NULL UNIQUE REFERENCES casino_sessions(id),
  user_id uuid NOT NULL REFERENCES users(id),
  player_wallet text NOT NULL,
  wager numeric(24,8) NOT NULL CHECK (wager >= 0.0005 AND wager <= 1),
  payout numeric(24,8) NOT NULL CHECK (payout > 0),
  claim_nonce text UNIQUE,
  authorization_payload jsonb,
  authorization_reference text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','authorized','submitted','confirmed','failed','expired','claimed')),
  transaction_hash text UNIQUE,
  failure_reason text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  authorized_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  claimed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS casino_claims_user_time ON casino_claims(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS casino_claims_status ON casino_claims(status, updated_at) WHERE status IN ('pending','authorized','submitted');

CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referrer_id uuid NOT NULL REFERENCES users(id),
  referred_user_id uuid NOT NULL UNIQUE REFERENCES users(id), referral_code text NOT NULL,
  qualification_status text NOT NULL DEFAULT 'pending' CHECK (qualification_status IN ('pending','qualified','rejected')),
  reward_status text NOT NULL DEFAULT 'not_earned' CHECK (reward_status IN ('not_earned','pending','credited','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(), qualified_at timestamptz, rewarded_at timestamptz,
  CHECK (referrer_id <> referred_user_id)
);
CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals(referrer_id, created_at DESC);
-- Reward amounts/qualification rules are supplied by verified backend policy, never the client.
ALTER TABLE arcade_reward_history ADD COLUMN IF NOT EXISTS referral_id uuid REFERENCES referrals(id);
CREATE UNIQUE INDEX IF NOT EXISTS reward_history_referral_unique ON arcade_reward_history(referral_id) WHERE referral_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS social_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  x_username text NOT NULL, screenshot_reference text NOT NULL,
  screenshot_data bytea, screenshot_mime text,
  attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  submitted_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_at timestamptz, reviewer text, review_note text
);
ALTER TABLE social_verifications ADD COLUMN IF NOT EXISTS screenshot_data bytea;
ALTER TABLE social_verifications ADD COLUMN IF NOT EXISTS screenshot_mime text;
ALTER TABLE social_verifications ADD COLUMN IF NOT EXISTS attempt_number integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS social_user_time ON social_verifications(user_id, submitted_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS social_user_attempt_unique ON social_verifications(user_id, attempt_number);

CREATE TABLE IF NOT EXISTS withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  amount numeric(24,8) NOT NULL CHECK (amount > 0), wallet text NOT NULL, transaction_hash text,
  payment_reference text, idempotency_key text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled','failed')),
  requested_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  sent_at timestamptz, sent_by text, cancelled_at timestamptz, cancelled_by text, failure_reason text
);
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS sent_by text;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS cancelled_by text;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS failure_reason text;
-- Preserve legacy rows while translating retired workflow states to their current
-- manual-payment equivalents before installing the current constraint.
ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_status_check;
UPDATE withdrawals SET status=CASE status
  WHEN 'eligible' THEN 'pending'
  WHEN 'submitted' THEN 'sent'
  WHEN 'confirmed' THEN 'sent'
  WHEN 'rejected' THEN 'cancelled'
  ELSE status END
WHERE status IN ('eligible','submitted','confirmed','rejected');
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_status_check CHECK (status IN ('pending','sent','cancelled','failed'));
CREATE INDEX IF NOT EXISTS withdrawals_user_time ON withdrawals(user_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_user_idempotency_unique ON withdrawals(user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_tx_unique ON withdrawals(transaction_hash) WHERE transaction_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS blockchain_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('casino_wager','casino_payout','arcade_withdrawal')),
  amount numeric(24,8) CHECK (amount >= 0), contract_address text NOT NULL,
  transaction_hash text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed')),
  related_entity_type text, related_entity_id uuid, block_number numeric(30,0), confirmations integer NOT NULL DEFAULT 0,
  failure_reason text, submitted_at timestamptz NOT NULL DEFAULT now(), checked_at timestamptz,
  confirmed_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS blockchain_tx_user_time ON blockchain_transactions(user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS blockchain_tx_pending ON blockchain_transactions(status, checked_at) WHERE status='pending';

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY, user_id uuid REFERENCES users(id), action text NOT NULL,
  entity_type text NOT NULL, entity_id text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_time ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_logs(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Phase 3: private (.veyra -> .veyra) stealth transfers.
--
-- These tables hold PUBLIC protocol material only. There is deliberately no
-- column for a spending/viewing/stealth private key, no seed, no mnemonic and
-- no wallet address: the backend never receives, derives or stores any of them.
-- `private_transfer_announcements` and `private_transfer_payments` also carry no
-- recipient identity, so the database cannot be used to build a transfer graph.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private_transfer_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  protocol_version integer NOT NULL CHECK (protocol_version = 1),
  scheme_id integer NOT NULL CHECK (scheme_id = 1),
  spending_public_key text NOT NULL CHECK (spending_public_key ~ '^0x(02|03)[0-9a-f]{64}$'),
  viewing_public_key text NOT NULL CHECK (viewing_public_key ~ '^0x(02|03)[0-9a-f]{64}$'),
  meta_address text NOT NULL CHECK (meta_address ~ '^0x(02|03)[0-9a-f]{64}(02|03)[0-9a-f]{64}$'),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{8}$'),
  sisk_public_key text NOT NULL CHECK (sisk_public_key ~ '^0x(02|03)[0-9a-f]{64}$'),
  enrollment_signature text NOT NULL CHECK (enrollment_signature ~ '^0x[0-9a-f]{130}$'),
  wallet_class text NOT NULL DEFAULT 'eoa' CHECK (wallet_class IN ('eoa','contract')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','pending')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT private_transfer_keys_distinct CHECK (spending_public_key <> viewing_public_key)
);
CREATE INDEX IF NOT EXISTS private_transfer_identities_meta ON private_transfer_identities(meta_address);
CREATE INDEX IF NOT EXISTS private_transfer_identities_fingerprint ON private_transfer_identities(fingerprint);

-- Public announcement ledger (mirror of what is already on-chain, never a filter
-- surface for a single user). No user_id: the scan endpoint must not be an oracle.
CREATE TABLE IF NOT EXISTS private_transfer_announcements (
  id bigserial PRIMARY KEY,
  chain_id integer NOT NULL DEFAULT 4441 CHECK (chain_id = 4441),
  scheme_id integer NOT NULL DEFAULT 1 CHECK (scheme_id = 1),
  stealth_address text NOT NULL CHECK (stealth_address ~ '^0x[0-9a-f]{40}$'),
  ephemeral_public_key text NOT NULL CHECK (ephemeral_public_key ~ '^0x(02|03)[0-9a-f]{64}$'),
  metadata text NOT NULL CHECK (metadata ~ '^0x[0-9a-f]{2}([0-9a-f]{2})*$'),
  transaction_hash text NOT NULL UNIQUE CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  block_number numeric(30,0),
  submitted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS private_transfer_announcements_recent ON private_transfer_announcements(created_at DESC, id DESC);

-- Sender-side reconciliation for a payment that already settled on-chain. Stores
-- no recipient identity: `stealth_address`/`ephemeral_public_key` are public
-- protocol values, and the row exists so an announcement can be republished
-- WITHOUT ever re-sending zkLTC.
CREATE TABLE IF NOT EXISTS private_transfer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain_id integer NOT NULL DEFAULT 4441 CHECK (chain_id = 4441),
  scheme_id integer NOT NULL DEFAULT 1 CHECK (scheme_id = 1),
  protocol_version integer NOT NULL DEFAULT 1 CHECK (protocol_version = 1),
  stealth_address text NOT NULL CHECK (stealth_address ~ '^0x[0-9a-f]{40}$'),
  ephemeral_public_key text NOT NULL CHECK (ephemeral_public_key ~ '^0x(02|03)[0-9a-f]{64}$'),
  view_tag text NOT NULL CHECK (view_tag ~ '^0x[0-9a-f]{2}$'),
  amount_atomic numeric(78,0) NOT NULL CHECK (amount_atomic > 0),
  payment_tx_hash text CHECK (payment_tx_hash ~ '^0x[0-9a-f]{64}$'),
  announcement_tx_hash text CHECK (announcement_tx_hash ~ '^0x[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'payment_submitted'
    CHECK (status IN ('payment_submitted','payment_confirming','payment_confirmed','announcement_submitting','announcement_confirmed','completed','failed')),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS private_transfer_payments_user_time ON private_transfer_payments(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS private_transfer_payments_tx_unique ON private_transfer_payments(payment_tx_hash) WHERE payment_tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS private_transfer_payments_pending ON private_transfer_payments(status) WHERE status IN ('payment_confirmed','announcement_submitting');

-- Enumeration-sensitive endpoints (resolve, announcements) get their own limiter
-- so the Phase 1 identity limiter table keeps its original action whitelist.
CREATE TABLE IF NOT EXISTS private_transfer_attempts (
  id bigserial PRIMARY KEY,
  ip_hash text NOT NULL,
  action text NOT NULL CHECK (action IN ('resolve','announcements','enroll','payments')),
  attempted_at timestamptz NOT NULL DEFAULT now()
);
-- Widening the action whitelist for databases created before 'payments' existed. Safe to
-- re-run: the constraint is dropped and re-added with the current allowed set.
ALTER TABLE private_transfer_attempts DROP CONSTRAINT IF EXISTS private_transfer_attempts_action_check;
ALTER TABLE private_transfer_attempts ADD CONSTRAINT private_transfer_attempts_action_check
  CHECK (action IN ('resolve','announcements','enroll','payments'));
CREATE INDEX IF NOT EXISTS private_transfer_attempts_rate ON private_transfer_attempts(ip_hash, action, attempted_at DESC);
