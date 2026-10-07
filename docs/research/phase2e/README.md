# Phase 2E — Live LiteForge testnet validation (execution package)

**Status of this artifact: PREPARED AND VERIFIED OFFLINE — NOT YET EXECUTED LIVE.**
The environment in which this package was authored has **no outbound egress to the LiteForge RPC**
(transport-level TLS failure), so **no transaction was created, signed, funded or broadcast** and
**no transaction hash exists**. Everything below is the exact procedure to run the same test from an
environment that can reach the RPC. Run it, then paste the produced `results/*.json` files back.

> Terminology: this proves **recipient-address privacy / recipient unlinkability** — never
> "anonymity". Public: sender, amount, timing, the stealth address, the announcement, the spend.
> Hidden: the link from the payment to the recipient's normal wallet.

---

## 0. What is being proved

The real on-chain ERC-5564 **scheme-1** lifecycle, native zkLTC, no Lunaria, no mixer, no custody,
no new contract:

```
Alice ──native zkLTC 0.001──▶ S            (fresh stealth address, scheme 1)
Alice ──announce(1,S,R,tag)──▶ 0x5564…5564 (canonical ERC-5564 announcer)
Bob   ──local scan (viewing key never leaves his machine)──▶ detects S
Bob   ──p_stealth = p_spend + h, verified p_stealth·G == S──▶ spends S ──▶ fresh T
Observer ── public chain only ──▶ cannot link S to Bob's normal wallet
```

Pinned cryptography (Phase 2D, re-verified by `../phase2d/stealth-serialization-pin.mjs` 49/49 and
by this package's `dry-run` 48/48):

| Element | Pinned value |
|---|---|
| ECDH shared point | serialized **compressed, 33 bytes (02/03)** |
| Hash | `keccak256(compressed shared point)` |
| View tag | most-significant byte of that hash |
| Scalar | hash read big-endian, reduced mod n (no-op w.p. < 2⁻¹²⁸) |
| Stealth point | `P_stealth = P_spend + h·G` ; `p_stealth = (p_spend + h) mod n` |
| Address | `keccak256(uncompressed pubkey x‖y)[12:]` |
| Meta-address | `0x` + spendPub(33B) + viewPub(33B); **single-key form refused** |
| Announcement | `announce(uint256,address,bytes,bytes)`, selector `0x4d1f9583`, metadata = 1-byte view tag |
| Announcer | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` |
| Chain | 4441 (`0x1159`) — the script **refuses any other chain id** |

---

## 1. Environment requirements

- Node.js ≥ 20 (developed on Node 22) with network access to `https://liteforge.rpc.caldera.xyz/http`
  (HTTPS + JSON-RPC POST: `eth_chainId`, `eth_getBalance`, `eth_getTransactionCount`,
  `eth_estimateGas`, `eth_sendRawTransaction`, `eth_getTransactionReceipt`, `eth_getLogs`).
- Dependencies used by the tooling (already dependencies of this repo / its transitive set):
  ```bash
  npm install --no-save --no-package-lock viem@2.56.8 @noble/curves@1.9.1 @noble/hashes@1.8.0
  ```
- **Disposable testnet accounts only.** No mainnet, no real wallets, no production keys.
- Testnet zkLTC from the LiteForge faucet (or an existing funded testnet wallet).
  Observed explorer gas prices at authoring time: slow 0.44 / average 0.49 / fast 1.05 Gwei.
- Observed average block time ≈ **227 s** — budget ~4 min per confirmation and ~45 min for the full
  sequence with the default confirmation policy.

## 2. Pre-flight (must pass before anything else)

```bash
cd <repo root>

# 1) research harness gate — both must pass
node docs/research/phase2c/stealth-lifecycle-sim.mjs          # expect 44/44 PASS, exit 0
node docs/research/phase2d/stealth-serialization-pin.mjs      # expect 49/49 PASS, exit 0

# 2) tooling + crypto verification, no network, no keys created — must pass
node docs/research/phase2e/live-lifecycle.mjs dry-run         # expect 48/48 PASS, exit 0
```

If any of the three fails, **STOP** — do not send funds.

## 3. Create the four disposable actors

```bash
node docs/research/phase2e/live-lifecycle.mjs prepare
```

- Private keys are written to `~/.veyra-phase2e/keys.json` with mode `0600`, **outside the
  repository** (the script refuses an in-repo path). Never commit, never share, delete when done.
- The tool prints only public data: Alice, Bob's normal wallet, Bob's 66-byte meta-address +
  fingerprint, the observer, fresh destination T, and the identity wallet.

**Fund ONLY Alice** with ≥ `0.0025` zkLTC (payment `0.001` + gas for the payment *and* the
announcement). Do **not** fund Bob's normal wallet, the observer, T, or S — the payment itself funds
Bob's later spend, which is exactly the property under test (S must not need gas money from Bob).

```bash
node docs/research/phase2e/live-lifecycle.mjs fund-check
```
Asserts chain id 4441, reads balances, measures the real gas price, and fails if Alice is short.

## 4. Run the lifecycle

```bash
# Alice -> S  (native zkLTC). Records tx hash, S, R, view tag, block, gas.
node docs/research/phase2e/live-lifecycle.mjs pay

# announce(1, S, R, 0x<tag>) to the canonical announcer. Verifies the emitted event.
node docs/research/phase2e/live-lifecycle.mjs announce

# Bob-side local scan of the REAL announcement + all negative tests.
node docs/research/phase2e/live-lifecycle.mjs scan

# Bob derives p_stealth, verifies p_stealth·G == S, spends S -> fresh T.
node docs/research/phase2e/live-lifecycle.mjs spend

# Independent observer privacy checks (read-only).
node docs/research/phase2e/live-lifecycle.mjs privacy
```

Or all of the above in one go: `node docs/research/phase2e/live-lifecycle.mjs all`

Useful flags:

| Flag | Default | Meaning |
|---|---|---|
| `--rpc <url>` | `https://liteforge.rpc.caldera.xyz/http` | RPC endpoint |
| `--payment-confirmations N` | 3 | confirmations before the payment counts as received |
| `--announce-confirmations N` | 1 | confirmations for the announcement (indexing only) |
| `--spend-confirmations N` | 1 | confirmations for the spend |
| `--amount 0.001` | 0.001 zkLTC | payment size |
| `--spend-amount X` | payment minus 2× gas | how much S sends to T |
| `--keys <path>` | `~/.veyra-phase2e/keys.json` | key file (must be outside the repo) |

Every command refuses to run on a chain id other than 4441, redacts secrets from all output, and
refuses to write a results file that contains secret material (leak guard).

## 5. Recovery tests (Phase 2D model)

```bash
node docs/research/phase2e/live-lifecycle.mjs recovery
```
Runs: signature determinism (local signer), cleared-state / restored-wallet / alternate-wallet /
altered-username / altered-chain-id scenarios, compact-64-byte-signature refusal, encrypted-backup
(AES-256-GCM + scrypt) round trip and wrong-passphrase failure. It writes only public fingerprints.

**Real-wallet determinism (cannot be tested from a CLI):** open `sign-check.html` in a browser with
the actual wallet, connect, run the probe. It compares two `personal_sign` signatures of the same
canonical message, refuses the 64-byte compact form, and shows the resulting public meta-address
fingerprint. It makes **no network requests** and never displays the signature or any private key.
Record: `DETERMINISTIC` / `NON-DETERMINISTIC` + the fingerprint. A non-deterministic wallet means the
signature-derived identity is unusable and the encrypted backup becomes the only recovery path.

## 6. Safe failure tests

```bash
node docs/research/phase2e/live-lifecycle.mjs failures
```
Runs pre-flight-only checks (insufficient balance, cannot-pay-gas — **nothing is broadcast**), RPC
failure handling, and the offline malformed-input battery (bad prefix, off-curve, truncated R,
unsupported scheme id, wrong view tag, duplicate announcement, announcement-without-payment,
indexer delay). Each row is recorded as EXPECTED / OBSERVED / PRODUCTION RESPONSE.

## 7. Optional tests (spend extra testnet funds only if you have them)

```bash
# reuse linkage demo: two payments to the SAME S (same r) vs fresh r — proves the
# "one payment = one fresh stealth address + one fresh ephemeral key" rule
node docs/research/phase2e/live-lifecycle.mjs reuse --confirm-extra-spend

# privacy-breaking control: sweep S -> Bob's normal wallet and show the public link
node docs/research/phase2e/live-lifecycle.mjs control --confirm-extra-spend
```
Both are labelled harmful-on-purpose; they are the empirical demonstration of *why* Veyra must not
auto-sweep stealth funds into the user's normal wallet.

## 8. What to record and return

Results are written to `docs/research/phase2e/results/` (public data only):
`actors.json`, `fund-check.json`, `state.json`, `failure-tests.json`, plus the console transcript.

Fill this table from `state.json` and the console output:

| Field | Value (from the live run) |
|---|---|
| Chain id | |
| Gas price measured | |
| Alice address | |
| Bob normal address | |
| Bob meta-address + fingerprint | |
| Payment tx hash + block + amount | |
| Stealth address S | |
| Ephemeral key R + view tag | |
| Announcement tx hash + block | |
| Announcement event fields (schemeId, S, caller, R, metadata) | |
| Bob detection (positive + all negatives) | |
| p_stealth·G == S | |
| Spend tx hash + block + T | |
| Privacy: Bob's normal wallet absent from all lifecycle txs | |
| Recovery: determinism + fingerprint + scenarios | |
| Recovery: browser probe result (`sign-check.html`) | |
| Wallet class used (EOA / hardware / SCW) | |
| Confirmation counts observed | |
| Failure-test rows | |

## 9. Confirmation policy (do not treat pending as received)

| Stage | Minimum before the UI may say "received" |
|---|---|
| Payment `Alice → S` | **3 confirmations** (default `--payment-confirmations 3`) |
| Announcement | 1 confirmation for indexing; a missing/unknown announcement must never be reported as "not received" |
| Spend `S → T` | 1 confirmation (optionally wait 3 for finality) |
| Pending / replaced / reorged | re-check by hash and nonce; never blind-retry; re-derive balances after a reorg |

## 10. Wallet compatibility (from the Phase 2D model; confirm empirically on the live run)

| Class | Sign for derivation | Hold/spend stealth funds | Verdict |
|---|---|---|---|
| EOA (browser, EIP-1193) | yes, if 65-byte + deterministic | yes (software key) | SUPPORTED — with fingerprint pinning |
| Hardware wallet | yes (message signing) | no (cannot import the derived key unless supported) | LIMITED — enrollment only; spend limitation must be disclosed |
| Smart-contract wallet (ERC-1271/4337) | no plain 65-byte ECDSA | no | **UNSUPPORTED — detect and refuse** |
| Multisig | no | no | **UNSUPPORTED — detect and refuse** |
| ERC-2098 compact (64-byte) signers | no | no | **UNSUPPORTED — refuse, request standard form** |

## 11. Recovery model (Phase 2D spec — summary)

- Deterministic root: `spendPriv = keccak256(sig[0:32])`, `viewPriv = keccak256(sig[32:64])`,
  signature must be exactly 65 bytes.
- Canonical signed message (v1):
  `"Veyra stealth identity v1\nusername: <username>\nchainId: 4441\ndomain: veyra.identity"`.
- Chain + username are bound (changing either derives a different identity).
- The signature is **secret-equivalent** (it re-derives the keys): never log, transmit or store it.
- Mandatory second path: encrypted backup (AES-256-GCM under a scrypt-derived key from a user
  passphrase) stored locally (optionally server-side as an opaque blob).
- Wallet seed lost + no backup ⇒ **permanent loss** of funds at existing stealth addresses.

## 12. Threat model in one table (fill the last column from the live run)

| Information | Public? | Reveals Bob? |
|---|---|---|
| Sender | YES | NO |
| Amount | YES | NO |
| Timing | YES | POSSIBLY CORRELATABLE |
| Stealth address S | YES | NO DIRECT LINK |
| Ephemeral key R | YES | NO DIRECT LINK |
| Announcement | YES | NO DIRECT LINK |
| Bob normal wallet | SHOULD REMAIN HIDDEN | — |
| S → fresh T | YES | NO DIRECT LINK |
| S → Bob normal wallet | YES | **YES / LINKED** |

Correlation surfaces that remain: unique amounts, timing, address reuse, ephemeral-key reuse,
gas-funding links, backend telemetry, compromised device or viewing key, malicious frontend,
malicious metadata, indexer surveillance.

## 13. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `RPC unreachable` / exit 2 | no egress to the RPC (this is the authoring environment's situation). Run where the RPC is reachable. |
| `refusing to store private keys inside the repository` | pass `--keys <path outside the repo>` |
| `Alice balance covers payment + gas` fails | top up Alice only |
| `S holds the payment` fails at scan | payment not yet mined/confirmed, or wrong RPC |
| `p_stealth*G == S` fails | derivation mismatch — **stop**, do not spend; report the S/R/tag values |
| `announce` event mismatch | wrong announcer address or metadata layout — stop and report |
| wait takes ~11 min on `pay` | expected: ~227 s blocks × 3 confirmations |

## 14. Files

| File | Purpose |
|---|---|
| `live-lifecycle.mjs` | orchestrator (all commands above) |
| `lib/stealth.mjs` | pinned scheme-1 primitives shared by the orchestrator |
| `sign-check.html` | browser probe for real-wallet signing determinism (offline page) |
| `results/` | PUBLIC results written by the live run (no secrets; leak-guarded) |
| `../phase2c/stealth-lifecycle-sim.mjs` | offline lifecycle proof (44/44) |
| `../phase2d/stealth-serialization-pin.mjs` | serialization + recovery pins (49/49) |
