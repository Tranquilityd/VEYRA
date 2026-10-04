# LitVM Builder Feedback Report — VeyraCasino

**Date:** 3 October 2026  
**Network:** LitVM LiteForge (chain ID 4441, native zkLTC)  
**Contract:** [`0xd2c36B83B1Ca788743E3E9b339e043b6B04e3273`](https://liteforge.explorer.caldera.xyz/address/0xd2c36B83B1Ca788743E3E9b339e043b6B04e3273)

## Executive summary

The existing VeyraCasino deployment is live, funded, unpaused, and internally consistent. Read-only RPC checks succeeded, and Blockscout records **46 successful contract transactions with no recorded failed transaction**: 28 wagers, 16 claims, one funding transfer, and deployment. Historical successful wagers use about **74.8k gas** and claims about **94.9k gas**. No transaction was submitted during this review.

The main strengths are low execution cost, simple native-token wagering, explicit replay protection, and a backend-to-contract settlement design that keeps outcomes reproducible while enforcing payouts on-chain. The main concerns are centralized outcome authorization, locked treasury funds, explorer/RPC indexing inconsistencies, historical-log RPC timeouts, and a multi-stage UX that can strand a user between wallet confirmation, backend tracking, game resolution, and claim submission.

## 1. What was tested

### Live, read-only inspection
- Verified deployed bytecode exists (**5,304 bytes**).
- Read contract state through the LiteForge RPC:
  - `MIN_WAGER`: **0.0005 zkLTC**
  - `MAX_WAGER`: **1 zkLTC**
  - `nextSessionId`: **75**
  - `paused`: **false**
  - owner: `0x69ddc4323F4DC443bfb8C1aAeb43b30Dbb8Ae044`
  - authorized signer: `0xb4193324e92c8354fdbf7607421296bc7b6c7e74`
  - pending signer: zero address
  - RPC contract/available balance observed during the audit: **0.40987501 zkLTC**
  - sampled gas price: **0.01 Gwei**
- Reviewed all 46 transactions returned by the explorer address API and sampled decoded event logs and receipts.
- Reviewed Solidity mechanics, ABI, deployment manifest, frontend wallet adapter, wager/claim gateway, backend transaction verifier, and claim-signing flow.
- Ran the repository test suite: **121 passed, 0 failed**. These are local regression tests, not additional live-chain transactions.

### Safety boundary
No wager, claim, administrative call, deployment, database write, or production change was performed. Failure behavior was assessed from source guards, read-only simulation capability, and existing chain history; no destructive or state-changing failure probe was sent.

## 2. What worked

- **Live contract health:** bytecode and expected state are present; the contract is unpaused and has no pending signer rotation.
- **Observed reliability:** all 46 indexed transactions have successful receipts. The set includes 28 `placeWager` calls and 16 `claimWinnings` calls.
- **Predictable gas:** wagers cluster tightly at **74,794–74,981 gas** (median **74,795**); claims at **94,853–94,925 gas** (median **94,885.5**). This consistency is useful for wallet estimates and game UX.
- **Low fees:** at the sampled 0.01 Gwei rate, representative execution cost is approximately **0.000000748 zkLTC** for a wager and **0.000000949 zkLTC** for a claim. Historical fees varied with network gas price but remained small in native-token terms.
- **Security controls:** wager bounds, pause support, reentrancy protection, EIP-712 authorization, deadline checks, session binding, nonce/session replay guards, two-step ownership, and two-step signer rotation are appropriate controls.
- **Accounting precision:** the frontend/backend use integer atomic values for financially sensitive paths; tests cover exact wei preservation and reject floating-point payout arithmetic.
- **End-to-end binding:** the backend independently verifies the wager receipt and extracts the emitted on-chain session ID before signing a payout. The authorization binds player, session, wager, payout, nonce, and deadline.
- **Native-token simplicity:** no allowance or token-approval transaction is needed. A wager is one payable call; a winning round is one later claim call.
- **LitVM fit:** EVM compatibility allowed standard EIP-1193 wallet calls, EIP-712 signatures, Solidity security primitives, JSON-RPC receipt verification, and Blockscout evidence without custom chain-specific contract code.

## 3. Problems discovered

### Infrastructure and developer tooling
1. **Broad historical `eth_getLogs` requests timed out.** Repeated 50,000-block queries over a 500,000-block window exceeded the public RPC response time. Address-scoped Blockscout APIs worked and were substantially more practical.
2. **RPC/explorer state discrepancy:** RPC returned **0.40987501 zkLTC**, while the explorer page displayed **0.31487501 zkLTC** and identified an older “last balance update” block. This indicates explorer indexing lag or stale derived state. Applications should trust direct RPC state for current balances and treat explorer values as eventually consistent.
3. **Contract source is not verified in Blockscout.** The explorer reports `is_verified: false`, so method decoding is limited and users cannot independently compare deployed bytecode against published Solidity through the explorer UI.
4. **Explorer confirmation-duration data is not sufficiently transparent.** The API returned `[0, 212.0]` for sampled transactions, but its unit and derivation are not obvious enough to present as measured user-perceived finality. Block timestamps alone also do not measure wallet-to-inclusion latency.

### Contract/economy design
5. **Treasury capital has no administrative recovery path.** The contract accepts treasury funding but provides no arbitrary withdrawal. This protects players from owner drains, but accidental overfunding, migration, incident response, or retirement can leave funds locked except through valid signed claims.
6. **Outcome trust remains off-chain.** Provably-fair seeds make results auditable after reveal, but the contract does not generate or verify game randomness/outcomes. The authorized signer remains the payout authority and availability dependency.
7. **Signer outage affects all wins.** If the signer/backend is unavailable, wagers can still be placed but winning claims cannot be newly authorized. Pause automation and operational monitoring are therefore important.
8. **Liquidity is checked only at claim time.** Multiple authorized payouts may collectively exceed treasury liquidity; an otherwise valid claim can fail depending on claim order. The backend should reserve liabilities before authorization and expose treasury coverage.
9. **Two on-chain transactions for a winning game:** wager and claim are separate wallet interactions. This is secure and explicit but adds signing friction; losses require only the wager.
10. **Session IDs are global and monotonic.** This is simple and reliable, but public activity volume and player-event relationships are observable. There is no per-game identifier in the contract event.

### Interaction and UX risks
11. **Multi-system reconciliation is complex.** The frontend waits for a receipt, then registers it with the backend, creates/resolves a game session, requests authorization, submits a claim, and tracks that receipt. RPC or API interruption between stages can leave a recoverable but confusing pending state.
12. **Frontend receipt polling uses a fixed two-second interval and 180-second timeout.** A timeout correctly tells users to check before retrying, but the UI needs a prominent explorer link and durable recovery queue to prevent accidental duplicate actions.
13. **Wallet-provider dependence precedes contract interaction.** Provider injection, chain switching, account permissions, and mobile in-wallet browsing can fail before any RPC transaction is sent. This is separate from contract reliability but materially affects perceived LitVM UX.
14. **Frontend wager validation displays eight decimal places while the contract accepts 18-decimal native values.** This is not an accounting bug, but it is a product constraint that should be stated clearly and kept synchronized with backend parsing.

## 4. Technical observations

- `placeWager()` stores the sender and value under a new session ID and emits `WagerPlaced`; no game outcome is computed on-chain.
- `claimWinnings()` verifies an EIP-712 signature and checks the player, original wager amount, session, deadline, nonce/session replay status, and available liquidity before transferring zkLTC.
- Checks-effects-interactions plus `ReentrancyGuard` appropriately protect native-token payout transfer.
- No arbitrary withdrawal reduces custodial abuse risk but makes this version operationally inflexible.
- The explorer currently shows **45 logs** and **46 total transactions**. `nextSessionId = 75` means the next allocation is 75; it does not imply the explorer address page currently exposes 74 wager transactions, because earlier deployment/test history and indexing scope must be considered.
- The public transaction history contains no revert evidence. This proves observed success, not universal reliability: rejected wallet requests and failed preflight simulations never appear on-chain.
- The repository’s 121 passing tests provide meaningful regression coverage for payout precision, fairness reproduction, transaction presentation, claim recovery, wager validation, and server-authoritative mechanics, but do not substitute for wallet/device testing or new live transactions.

## 5. Suggested improvements for LitVM

1. Increase public RPC log-query reliability, publish range limits, and return a clear “range too large” error rather than timing out.
2. Improve Blockscout indexing freshness and show explicit “indexed through block” metadata for balances, transactions, and logs.
3. Make confirmation-duration units and methodology explicit; expose RPC-received, sequenced, included, and finalized timestamps where available.
4. Provide a gaming-oriented SDK/reference flow for chain addition, wallet compatibility, receipt recovery, transaction replacement, and mobile wallet deep links.
5. Offer hosted WebSocket/event streams and webhooks for address/log monitoring so games do not need aggressive polling.
6. Provide verified-contract publishing guidance integrated into deployment tooling, including deterministic metadata and automatic Blockscout verification.
7. Publish operational status/history for RPC, explorer, sequencer, and faucet services, plus recommended client failover endpoints.
8. Provide sponsored-transaction/account-abstraction examples for repeat gaming interactions, while preserving explicit user consent and replay safety.
9. Add gaming examples for treasury-liability monitoring, batched settlement, commit/reveal, and verifiable randomness integrations.

## 6. Transaction hashes and evidence

| Evidence | Transaction | Result | Gas used |
|---|---|---:|---:|
| Contract deployment | [`0xda6569e711e1a4820fa690be7e00e7fa26d5cd3334e9d0e5e5bd98eded2d1ae0`](https://liteforge.explorer.caldera.xyz/tx/0xda6569e711e1a4820fa690be7e00e7fa26d5cd3334e9d0e5e5bd98eded2d1ae0) | Success | 1,314,695 |
| Minimum wager, session 71 | [`0x8681787bc99b53698ae320f1b2b7a2bcc4bc87b2da48d44838d80c04f92ca060`](https://liteforge.explorer.caldera.xyz/tx/0x8681787bc99b53698ae320f1b2b7a2bcc4bc87b2da48d44838d80c04f92ca060) | Success | 74,801 |
| 0.3 zkLTC wager, session 73 | [`0x147c391f7d88e394a2c44c96ef22a7e1059c21d6f7d235425df952824b1b00f3`](https://liteforge.explorer.caldera.xyz/tx/0x147c391f7d88e394a2c44c96ef22a7e1059c21d6f7d235425df952824b1b00f3) | Success | 74,801 |
| 0.17 zkLTC payout, session 67 | [`0x364bb34eb55540388dfe1f8a76665ede1f9eb789c3ddaed9d130f9f5c1586530`](https://liteforge.explorer.caldera.xyz/tx/0x364bb34eb55540388dfe1f8a76665ede1f9eb789c3ddaed9d130f9f5c1586530) | Success | 94,853 |
| 0.01 zkLTC payout, session 74 | [`0xfeb81fd5b7a84eff2d2ee55141a5457534cef517768123f7dd1a3dde1673b790`](https://liteforge.explorer.caldera.xyz/tx/0xfeb81fd5b7a84eff2d2ee55141a5457534cef517768123f7dd1a3dde1673b790) | Success | 94,909 |
| Treasury funding, 0.1 zkLTC | [`0x4a1de349222ebe9c3daaeb04b3404882a11985b36647fd534fe9c603643326f5`](https://liteforge.explorer.caldera.xyz/tx/0x4a1de349222ebe9c3daaeb04b3404882a11985b36647fd534fe9c603643326f5) | Success | 22,500 |

Evidence sources: direct LiteForge JSON-RPC state reads; LiteForge Blockscout address, transaction, and log APIs; deployed ABI/Solidity source; frontend/backend implementation; local test output. Explorer API review found **46/46 successful indexed transactions and zero failed receipts**.

## 7. Expansion opportunities on LitVM

- Add a new version with **liability reservation** and publicly readable solvency metrics before payout authorization.
- Anchor provably-fair server-seed commitments or periodic Merkle roots on-chain, allowing compact independent audit of many rounds.
- Add game identifiers and ruleset/version hashes to wager events for richer analytics and dispute evidence.
- Explore verifiable randomness or commit/reveal settlement for selected games where latency and cost are acceptable.
- Use batched or session-key transactions to reduce repeated wallet prompts, with strict spend limits and expiry.
- Add opt-in on-chain achievements, tournament entries, jackpots, and seasonal leaderboards without placing private gameplay data on-chain.
- Introduce a timelocked, event-emitting emergency treasury migration path in a future contract version, with a solvency floor and public notice period.
- Build an event indexer that reconciles RPC and explorer state and gives players a durable “resume pending wager/claim” experience.

## Conclusion

VeyraCasino demonstrates that LitVM LiteForge can support inexpensive, conventional EVM game settlement with stable gas usage and successful historical execution. The contract’s narrow responsibilities and replay-safe claims are strong. The most valuable next steps are better infrastructure observability on LitVM and, for a future Veyra contract version, explicit liability accounting, greater outcome verifiability, improved recovery UX, and a carefully governed treasury migration mechanism.
