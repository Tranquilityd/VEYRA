# Phase 4A — Manual browser + wallet validation of private `.veyra → .veyra` transfers

> ### STOP RULE
> **Do not perform a real private transfer during Phase 4A. That belongs to Phase 4B.**
> Phase 4A validates the browser, the wallet connection and the network detection through
> **read-only** diagnostics and a **dry run that cannot broadcast**. No wallet signature is
> needed, no transaction is signed, and no zkLTC leaves the wallet. After step 11 below,
> stop and report.

**Status:** tooling and documentation complete and verified offline; **the manual run has not
been performed yet** — it is the tester's (your) job, on a machine that can reach LitVM
LiteForge and with a real EIP-1193 wallet. The Vercel Preview must be created by you
(Section 3.1) — the deployment was **not** created by the agent, and no Preview URL is
claimed here.

**Scope discipline:** Phase 4A adds *no* product features, deploys *no* contract, moves *no*
real funds, re-implements *no* cryptography, and weakens *no* check. It adds a clearly marked
test mode (diagnostics) and a read-only dry run, plus this document. The private-transfer
protocol is byte-for-byte the Phase 3 behaviour audited in Phase 3.5.

---

## 1. What is validated, and how (read this before reporting results)

| Layer | What it covers | Status |
|-------|----------------|--------|
| Unit + security tests | crypto vs viem/@noble/node:crypto, state machine, service, UI copy rules, Phase 3.5 hardening + Phase 4A tooling | **automated, `npm test` = 347/347** |
| DOM-shim tests | the real panel + diagnostics classes are instantiated, wired and rendered in a minimal fake DOM (dry run included) | **automated, 7/7** in `test/private-transfer-diagnostics-dom.test.js` |
| Static delivery check | 105-module import graph resolves; every reachable module is present in the built `static-site/`; the site serves 200s for the new files | **automated, performed** |
| **Real browser** | rendering, layout, gestures, DevTools console/network | **NOT performed — you must run it** |
| **Real wallet** | MetaMask (or compatible EOA), chain detection, signatures, account/chain events | **NOT performed — you must run it** |
| **Live blockchain** | a real zkLTC payment to a stealth address + real `announce(…)` + a real stealth spend | **NOT performed — out of scope for Phase 4A** |

Honest summary: everything below the "real browser" line is unverified until you run it, and
nothing here claims a live-chain result. **Live LiteForge end-to-end validation remains pending.**

---

## 2. Prerequisites

1. **Two testnet accounts** (MetaMask or any EIP-1193 EOA wallet):
   Alice (sender) and Bob (recipient). MetaMask is the reference; smart-contract wallets,
   multisig, account-abstraction and ERC-2098 compact-signature wallets are **refused by
   design** and are expected to fail.
2. **Testnet zkLTC for Alice only.** Use the same disposable testnet funding source you used
   in Phase 2E. Never use a mainnet wallet or real funds. Bob needs nothing on-chain.
3. **A running Veyra backend.** Enrollment, `.veyra` resolution and announcements are
   server-backed, so the full flow needs the API + Postgres (Section 3). Without it you can
   still exercise the wallet, chain-state and dry-run parts (Section 3, Option B).
4. **A browser with DevTools** (desktop is easiest) and the LiteForge network available to
   that machine. The development sandbox cannot reach the LiteForge RPC, so this phase
   cannot be executed from inside Veyra's build environment.

### LiteForge network (canonical values — already hard-coded in the app)

| Field | Value |
|-------|-------|
| Network name | LitVM LiteForge |
| Chain ID | `4441` |
| Hex chain ID | `0x1159` |
| RPC URL | `https://liteforge.rpc.caldera.xyz/http` |
| Native asset | zkLTC (18 decimals) |
| Announcer (ERC-5564) | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` |

The wallet may prompt to add/switch the network during **Connect**; that is an explicit
wallet approval. Veyra never switches networks silently, and it never switches at all after
connect — a wrong chain simply stays blocked.

---

## 3. Running the app

### 3.1 Option P — Vercel Preview (the Phase 4A.2 path, recommended)

The Preview is deployed from this branch, **never from `main`**, and never aliased to
production. Production is `https://veyra-tawny.vercel.app` and must stay untouched.

**How to create the Preview (pick one):**

| Route | Steps |
|-------|-------|
| **A. Vercel dashboard** | Vercel → project **veyra-tawny** → *Deployments* → **Deploy** / *Create Deployment* → branch **`arena/01a1073e-veyra`** → confirm the environment is **Preview** → Deploy. Copy the resulting `…-git-arena-01a1073e-veyra-….vercel.app` URL. |
| **B. Git integration** | If the Vercel project has GitHub Git integration with *Preview Deployments* enabled for all branches, the push of `arena/01a1073e-veyra` (`a877544`) already queues a Preview build; find it under *Deployments*. As of this writing **no Vercel check-run or status was posted for `a877544` on GitHub**, so this route is not currently producing a deployment — use A or C. |
| **C. Vercel CLI** | On your own machine, from a checkout of the branch: `npx vercel` (answer *Link to existing project* → **veyra-tawny**, environment **Preview**) or `npx vercel deploy` for a one-off Preview URL. No `--prod`, ever. |

**Environment variables.** A Preview inherits nothing automatically. Set these for the
**Preview** environment in Vercel → project → *Settings → Environment Variables* (values are
yours; never commit them):

| Variable | Needed for | Without it |
|----------|-----------|------------|
| `API_SESSION_SECRET` (≥ 32 chars) | login sessions **and** the site-entry cookie | entry gate can never verify |
| `DATABASE_URL` | `.veyra` identity, enrollment, resolution, announcements | resolve returns `INTERNAL_ERROR` (500) |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` (or `HCAPTCHA_SECRET_KEY` + `SITE_ENTRY_CAPTCHA_PROVIDER=hcaptcha`) | the entry CAPTCHA | cannot pass the gate |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (build-time, public) | the CAPTCHA widget in the page | widget renders "temporarily unavailable" |
| `WALLET_CHALLENGE_DOMAIN` (optional) | cosmetic text inside the sign-in message | shows the default text; not host-validated |

**The entry gate matters.** The HUD — and therefore the **PRIVATE TRANSFER** chip and the
diagnostics panel — sits behind the site-entry verification (`/api/site-entry`). That check
**fails closed**: with no session, no env vars or no CAPTCHA, it answers
`{"ok":true,"verified":false}` and the app stays on the entry screen. That is correct
security behaviour, not a bug: to reach the diagnostics in a Preview you must configure the
four variables above (or validate wallet/chain behaviour on a local full-stack run instead).
Do **not** ask for, and do not add, a gate bypass.

**What you can validate in the Preview, by configuration level**

| With… | You can validate |
|--------|------------------|
| No env vars | app boots, modules load, entry gate is visibly *locked* (fail-closed proof), no console/module errors |
| Env vars but no wallet | everything above + the gate, `.veyra` identity state, resolution, test mode, diagnostics rendering |
| Env vars + wallet | all of the above + wallet detection, chain **4441** detection, wrong-network blocking, and the read-only dry run |

### Option A — full stack locally (required for enroll / resolve / announcements)

```bash
npm install
# Postgres + VEYRA_* environment as documented in README.md / BACKEND.md
npm run db:migrate          # additive Phase 3 tables
npx vercel dev              # serves index.html + /api/* on one origin
```

Open the URL `vercel dev` prints (default `http://localhost:3000`) in the browser that has
the wallet extension.

### 3.2 Quick run — the exact Phase 4A.2 procedure

1. Open the **Vercel Preview URL** in Chrome (desktop; or Android Chrome over the HTTPS
   Preview host).
2. Open the Veyra private-transfer interface: press the **PRIVATE TRANSFER** chip in the HUD
   (or reach the panel the way Section 4 describes) — the chip is inside the play/HUD screen,
   so complete the entry verification first if the gate is showing.
3. Connect an EVM-compatible wallet (MetaMask or another EIP-1193 EOA wallet) and approve the
   LiteForge network prompt in the wallet — this is a **read-only connect**, no transaction.
4. Verify the displayed account and network information in the wallet panel and the
   diagnostics: address, wallet type, chain.
5. Confirm the network is identified as **chain ID 4441** (`0x1159`, LitVM LiteForge); switch
   the wallet to another chain and confirm the panel reports **WRONG NETWORK — transfers are
   blocked**.
6. Enable the Phase 4A test/diagnostic mode (Section 4): `?veyra-private-test=1`, or the
   **ENABLE TEST MODE** button in *How private transfers work*.
7. Run the **read-only diagnostics**: press **REFRESH WALLET STATUS** and read the sections
   (wallet, network, identity, transfer, announcement, stealth, recovery).
8. Optionally run **RUN DRY RUN** with a recipient/amount — it resolves, derives a fresh
   stealth address and reads the wallet, but **cannot** sign or broadcast.
9. Verify that **no transaction was requested or broadcast**: the wallet shows **no** approval
   prompt, and the diagnostics read `Broadcast: no` / `DRY RUN — NO TRANSACTION BROADCAST`.
10. Verify that **no zkLTC left the wallet**: the balance is unchanged and there is no new
    entry in the wallet's activity/history.
11. Record any failure or error verbatim (Section 11 template), then **stop**.

**Do not perform a real private transfer during Phase 4A. That belongs to Phase 4B.**

### Option B — static only locally (UI, wallet state, chain detection, dry run)

```bash
npm run build:static
python3 -m http.server 3000 --directory static-site
```

Open `http://localhost:3000`. Identity enrollment, resolution and announcements will fail
with a server error in this mode — that is expected, and it is a useful negative check that
nothing silently degrades into a wallet-to-wallet transfer.

> Serving the app from `file://` is **not** supported (ES modules + fetch). Use `http://localhost`.

---

## 4. Enabling test mode (diagnostics)

Test mode is **off by default** and is an explicit, per-browser opt-in. Any one of these:

1. Open the site with `?veyra-private-test=1` appended:
   `http://localhost:3000/?veyra-private-test=1`
2. In the running page's DevTools console: `localStorage.setItem('veyra:stealth:test-mode','1')`
   then reload.
3. Open the private-transfer panel (HUD chip **PRIVATE TRANSFER**), expand
   *“How private transfers work”* and press **ENABLE TEST MODE**.

A **TEST MODE — DIAGNOSTICS** panel appears (top-left; bottom sheet on small screens) and a
**DISABLE TEST MODE** button turns it off again. The panel is display-only. Test mode does
**not** disable, relax or bypass: network validation, wallet signatures, cryptographic
validation, announcement validation, rate limits, or any Phase 3.5 guard. It adds no route
and no API endpoint.

### What the diagnostics panel shows

| Section | Fields |
|---------|--------|
| Wallet & network | **CONNECTED / WRONG NETWORK / DISCONNECTED**, wallet address, detected chain id, expected chain id (`4441` / `0x1159`), wallet type (`eoa` / `contract` / unknown), whether sending is possible, reason |
| Identity & resolution | identity state (ENROLLED / NOT_ENROLLED), username, fingerprint (public, truncated), meta-address present, **key material in memory: yes/no**, session bound to account |
| Transfer / announcement / stealth / recovery | live transfer state, in-flight flag, pending-payment warning + its tx hash, announcement recovery record + its payment tx hash, last derived stealth address, last view tag, recovery-by-wallet-signature availability |
| Key-material guarantees | static “rendered = no” rows for private key, viewing key, spending key, seed/mnemonic, recovery secret — plus *rendered via textContent only* |
| Dry run | button + output (below) |

There is also an always-visible wallet line in the private-transfer panel itself
(`Wallet CONNECTED · LiteForge 4441 (0x1159) · eoa` / `Wallet WRONG NETWORK — detected 0x1,
expected 0x1159 …` / `Wallet DISCONNECTED …`).

---

## 5. Dry run — `DRY RUN — NO TRANSACTION BROADCAST`

In test mode, fill in the recipient and amount in the private-transfer panel and press
**RUN DRY RUN**. It shows, and nothing else:

* status `READY` or `BLOCKED` + the blockers (`WRONG_NETWORK`, `WALLET_DISCONNECTED`,
  `UNSUPPORTED_WALLET`, `INSUFFICIENT_BALANCE`, `INSUFFICIENT_GAS`, `FINGERPRINT_CHANGED`)
* recipient `.veyra` name and public fingerprint
* amount in zkLTC and atomic units
* chain id + hex, source wallet, wallet type
* the **fresh stealth address**, ephemeral public key and view tag for this payment
* the exact payment request shape (`to`, `value`, `chainId`) that the real send would hand
  to the wallet
* a best-effort fee estimate (gas × gas price), or `unavailable`
* the expected state-machine walk (`resolving_recipient → … → completed`)
* the dry-run note

Why it cannot secretly broadcast: `previewSend()` performs only reads —
`eth_accounts`, `eth_chainId`, `eth_getCode`, `eth_getBalance`, `eth_estimateGas`,
`eth_gasPrice` — plus the existing public `/resolve` GET. It never calls `personal_sign`,
never calls `eth_sendTransaction`, never POSTs anything, never writes a pending-payment
intent, never writes a recovery record and never pins a recipient fingerprint. The test
suite proves this with a provider that throws on any non-read method
(`test/private-transfer-diagnostics.test.js`), so a regression that made the dry run
sign or send would fail the suite immediately.

A dry run is **not** a payment: nothing on-chain changes, and the printed stealth address is
discarded (each dry run derives a new one).

---

## 6. Two-account manual walkthrough

Names are examples; use whatever `.veyra` names are actually available to you.

### Alice (sender)

1. Connect **Wallet A**, approve the network prompt, confirm the panel reads
   `Wallet CONNECTED · LiteForge 4441 (0x1159) · eoa`.
2. Claim Alice's `.veyra` username in the identity panel (Phase 1 flow) if not already claimed.
3. Enable test mode (Section 4) so the diagnostics are visible while you work.
4. Open **PRIVATE TRANSFER → CREATE PRIVATE IDENTITY**. Type a backup passphrase (≥ 8 chars;
   nothing is sent anywhere) and approve **two** wallet signature requests:
   * the recovery signature (key-deriving, never transmitted),
   * the enrollment signature (public domain, transmitted with the public keys).
   Expect: *“Your private transfer identity is ready.”* and the diagnostics showing
   `ENROLLED`, an 8-hex fingerprint, `key material in memory: yes`.
5. Press **EXPORT ENCRYPTED BACKUP** and store the JSON somewhere safe (it is the only way to
   restore on a wallet that does not reproduce the recovery signature). Never share it — it
   is passphrase-encrypted but it *is* your identity.
6. Type `bob.veyra` in **Recipient** and press Tab. Expect
   `bob.veyra · private-address fingerprint <hex>` and **no** wallet address anywhere.
7. Enter an amount (e.g. `0.001`) and press **RUN DRY RUN** — check the fresh stealth
   address, the chain id and the expected states. This is the moment to confirm nothing
   was broadcast (Section 5).
8. Only when you are ready, press **SEND PRIVATELY** (this is a real testnet transaction;
   read the checklist first).

### Bob (recipient)

1. In a second browser profile / wallet, connect **Wallet B** and claim Bob's `.veyra` name.
2. Enable test mode, then **CREATE PRIVATE IDENTITY** and export the backup, exactly as Alice did.
3. Leave Bob's private-transfer panel open. After Alice's payment + announcement:
   press **SCAN FOR PAYMENTS**. Scanning is local: the page fetches a public page of
   announcements and does the math with Bob's viewing key in the browser.
   The keys live in memory for the session only, so **after a reload Bob must first press
   RECOVER FROM WALLET SIGNATURE (or import his encrypted backup)** — otherwise scanning
   correctly answers *"Your private transfer identity is not unlocked in this session…"*.
   That message is the expected, safe behaviour, not a bug.
4. Expect “*N private payment(s) found in M announcement(s)*” listing a **fresh private
   address** (never Bob's normal wallet). Record the reported address and compare it with
   Alice's dry run if you kept it.
5. Optional (Phase 2E logic, unchanged): a stealth spend is available from the client
   (`spendFromStealth`) and is intentionally **not** wired to a panel button in this phase —
   do not spend from stealth during Phase 4A unless you explicitly intend to test it.

Bob's ordinary wallet address is never returned by the `.veyra` lookup API or shown in any
UI surface — verify this in the Network tab (Section 9).

---

## 7. Manual test checklist

Copy this into your report and tick what you actually observed. Anything unticked is
unverified, not "passing".

**Identity**
- [ ] Alice can claim a `.veyra` username.
- [ ] Bob can claim a `.veyra` username.
- [ ] Duplicate username claim is rejected.
- [ ] Lookup does not reveal Bob's normal wallet address.

**Wallet**
- [ ] Wallet connects.
- [ ] Correct chain is detected.
- [ ] Wrong chain is rejected.
- [ ] Disconnect invalidates sensitive session state.
- [ ] Account switching invalidates stale session state.
- [ ] Reconnect works correctly.

**Backup**
- [ ] Alice can export encrypted backup.
- [ ] Bob can export encrypted backup.
- [ ] Correct backup imports successfully.
- [ ] Tampered backup is rejected.
- [ ] Wrong identity backup is rejected.
- [ ] No plaintext private material appears in UI/storage/logs.

**Private transfer**
- [ ] Alice resolves Bob's `.veyra`.
- [ ] No normal Bob wallet address is returned to Alice.
- [ ] A fresh stealth destination is generated.
- [ ] View-tag/address validation succeeds.
- [ ] Invalid announcement data is rejected.
- [ ] Duplicate/replayed data is rejected.
- [ ] Double-click/re-entry cannot create duplicate payment attempts.

**Transaction safety**
- [ ] Wrong network blocks transaction.
- [ ] Wallet signature is required.
- [ ] Reload does not silently create a second payment.
- [ ] Definitive transaction revert is handled as failure.
- [ ] Ambiguous receipt timeout retains the transaction hash.
- [ ] Announcement timeout creates the documented recovery path.
- [ ] Payment is never automatically resent merely because announcement publication failed.

---

## 8. Wallet edge cases (expected outcomes)

| # | Action | Expected |
|---|--------|----------|
| A | Disconnect the wallet, then try to send | Transfer blocked; the panel line reads `Wallet DISCONNECTED — connect and authenticate to use private transfers.`; identity/backup buttons are disabled and no signature is requested. Sending while disconnected additionally produces *"Connect your wallet and authenticate first."* |
| B | Switch the wallet to another chain (e.g. Ethereum) and try to send | Blocked: `WRONG NETWORK — detected 0x…, expected 0x1159`; **no** transaction and **no** signature request. Veyra does not switch the chain for you |
| C | While connected, switch account in the wallet | The private-transfer session is cleared: the cached identity is dropped and the keys are dropped from memory. The panel shows *"Connect and authenticate your wallet to use private transfers."* and the wallet reports *"Wallet account changed. Reconnect and authenticate the new address."* The new account must create/import/recover its own identity before it can do anything private |
| D | Click **SEND PRIVATELY** several times quickly | Exactly one attempt: further clicks are ignored while in flight (`TRANSFER_IN_PROGRESS`), all panel buttons are disabled, and only one `eth_sendTransaction` appears in the wallet |
| E | Reload the page *after* pressing send but before confirmation | A stale-payment warning appears on the panel (fresh address, amount, and the tx hash when known) and can only be dismissed by you — it never re-sends |
| F | Reject the wallet signature | Clean cancellation: `SIGNATURE_REJECTED` (or `TRANSACTION_REJECTED` for a tx), state `failed`, no announcement, no payment row, **no false success** |
| G | Let a transaction revert (status `0x0`) | Definitive failure `TRANSACTION_FAILED`; no announcement is attempted; **no** stale-payment warning is left behind (a revert cannot have moved funds) |
| H | Make the announcement fail after a settled payment | `ANNOUNCEMENT_FAILED`; the payment is **not** resent; the recovery record stays visible in diagnostics; **PUBLISH PAYMENT NOTICE ONLY** republishes just the announcement |

Extra cases worth a line in the report: MetaMask locked (should behave like A), “Add network”
rejected during connect (no half-connected state), and Bob scanning twice (same result, no
state change).

---

## 9. Console & Network audit (do this while the app runs)

**Console (DevTools → Console):**
* Clear it, then run the whole flow (connect, enroll, resolve, dry run, send, scan).
* Search the log for `0x` + 64 hex characters (a 32-byte scalar). Anything found is a
  finding — expect **none**. Key names to search for as well: `spendingPrivateKey`,
  `viewingPrivateKey`, `sisk`, `mnemonic`, `seed`, `signature` (the only acceptable
  occurrence is a *message* about a rejected signature, never a signature value).
* Expect no unhandled promise rejections; Veyra's own log calls around the private-transfer
  surface are only the server-side audit entries listed in the architecture doc.

**Network (DevTools → Network, filter `private-transfer`):**
* `GET /api/private-transfer/resolve?username=bob` → response body contains `username`,
  protocol/scheme ids, the two **public** keys, the meta-address and the fingerprint. It must
  **not** contain any wallet address, any private key, or Bob's normal wallet.
* `POST /api/private-transfer/enroll` → the public keys, meta-address, fingerprint, SISK
  **public** key and the enrollment signature. **No** recovery signature, no private keys.
* `POST /api/private-transfer/announcements` / `payments` → only public protocol fields and
  transaction hashes.
* Nothing sensitive in the URL/query string (usernames and cursors only).
* The dry run must produce **no** POST at all (only the resolve GET).

**Storage (DevTools → Application):**
* `localStorage` may contain: the public identity cache (`veyra:stealth:identity`, no keys),
  the pending-payment warning, the announcement-recovery record, recipient fingerprints and
  the test-mode flag. It must **never** contain a private key, viewing key or spending key —
  those live only in memory for the duration of an operation. `sessionStorage` holds only the
  wallet manual-disconnect flag.
* IndexedDB may hold only the **passphrase-encrypted** backup envelope.

---

## 10. Known limitations of this phase

* **No Preview deployment was created by the agent** (no Vercel credentials and no network
  egress to Vercel from the build environment) and no Preview URL is claimed anywhere in this
  document — create it yourself with Section 3.1 and paste the URL into your report.
* **The Vercel checks performed for Phase 4A.2 were static/offline**: the build was produced
  and served locally, all 13 serverless functions were confirmed to cold-start with no
  environment variables, the API router/auth/method/same-origin behaviour was exercised with
  no env configured (401/404/405/500 `INTERNAL_ERROR`, `Cache-Control: no-store`, no stack or
  secret in any body), the entry gate was confirmed to fail closed, the module graph was
  confirmed complete in the built output, and the built client was scanned for secret shapes.
  None of that is a substitute for opening the real Preview in a real browser.
* The **backend must be reachable** for enroll / resolve / announcements; without it only
  wallet, chain-state and dry-run behaviour can be validated (Option B), and in a Preview the
  entry gate will also stay locked (Section 3.1).
* The full flow requires **two accounts and testnet funds for Alice**; sourcing testnet
  zkLTC is outside Veyra's code (use the Phase 2E funding source).
* Phase 4A does not validate a live on-chain payment end-to-end, does not spend from a
  stealth address, and does not claim any anonymity property. Recipient-address privacy and
  unlinkability are the only claims, and amounts/timing stay public.
* Ledger-level privacy of a *stealth spend* is unchanged from Phase 2E: spending to a wallet
  that is publicly yours re-links the funds.
* The dry run’s fee estimate is a best-effort read; the wallet remains the authority on gas
  and may add its own limits.

---

## 11. Report template

```
Phase 4A manual validation
Wallet:            <MetaMask version / other, browser, OS>
Chain at start:    <id>  → after connect: <id>
Backend:           <vercel dev / deployed URL / static-only>
Test mode:         <how you enabled it>
Alice / Bob:       <usernames used>

Checklist:         <n>/30 ticked  (paste the list with ticks)
Edge cases A–H:    <observed result per case>
Console audit:     <clean / findings>
Network audit:     <clean / findings>
Dry run:           <READY/BLOCKED, blockers seen>
Payment attempt:   <not attempted / hash … / blocked by …>
Announcement:      <hash … / failed with recovery record / not attempted>
Bob scan:          <n payments found / none>
Blockers:          <anything that stopped you>
```

Then state explicitly which bullets you did **not** run, so the report distinguishes tested
from unverified.
