# Veyra — Private zkLTC Transfer Architecture (Phase 2A Research)

**Status:** research / verification only. No production code was written or changed.
**Date:** 2026-10-04
**Author context:** pre-Phase-2 investigation for the Veyra project (LitVM, chain 4441).
**Phase 2B addendum (2026-10-04):** on-chain verification completed — see §23–§40 at the end of this
document. The Phase 2A blocker "verify on-chain state first" (open question §19a) is **resolved for
testnet**: the canonical ERC-5564 announcer and ERC-6538 registry are deployed at the canonical
addresses, are standard-conformant, and are in use, and Lunaria's router is a verified contract on
LiteForge. The conclusion (**B**) is unchanged in substance, strengthened in evidence, with three
details corrected in §39. Nothing was implemented and no transaction was sent.
**Phase 2C addendum (2026-10-04):** controlled stealth-payment proof — see §2C.1–§2C.15 at the end.
(The 2C research harness was corrected in Phase 2D — address derivation now standard — and re-runs
44/44; no 2C conclusion changed.)
**Phase 2E addendum (2026-10-04):** live LiteForge testnet validation — see §2E.1–§2E.14 at the end.
The environment has **no egress to the LiteForge RPC** (all required JSON-RPC methods blocked at
transport), so the live lifecycle was **stopped, not simulated**: no account funded, no transaction
created, **no hash invented**. A complete, offline-verified execution package (48/48 dry-run
assertions) is ready at `docs/research/phase2e/`. Verdict: **C — BLOCKED**.
**Phase 2D addendum (2026-10-04):** exact scheme-1 serialization pinned against the canonical
third-party implementation + key-recovery specification + failure/threat model — see §2D.1–§2D.14.
The networked testnet portion (funding, Alice → S, announcement, Bob detection, S → T spend) is
**BLOCKED by this environment** (no JSON-RPC egress ⇒ no broadcast) and is reported as **not
executed**; no transaction exists. Verdict: **B — CONDITIONAL PASS**.
The complete lifecycle was **proven offline (43/43 assertions)** and cross-validated against real
LiteForge data (including a byte-for-byte reproduction of a real `announce()` calldata). The
on-chain transaction half could **not** be executed from this environment (no network egress →
no broadcast, no faucet, no funded disposable account). A new finding: **3 of 6 sampled real
on-chain ephemeral keys are not valid secp256k1 points**, so a standard scanner cannot process
those announcements — Lunaria's implementation must not be assumed interoperable. Verdict: **B —
CONDITIONAL PASS.** No transaction was created; no funds were used; only documentation and one
research harness were added.
**Conclusion:** **B — PARTIALLY READY.** Recipient-address privacy is achievable today with a
verified standard (ERC-5564 / ERC-6538) and there is already a live implementation on LitVM
LiteForge. Amount, sender and timing privacy are **not** achievable with any available mechanism,
and the path to production is blocked by LitVM mainnet availability plus Veyra-specific wallet-model
work.

---

## 1. The question

Can Veyra implement a non-custodial, privacy-preserving zkLTC transfer where:

1. Alice sends to `bob.veyra`
2. Alice never receives Bob's normal wallet address
3. Alice does not need to know it
4. Bob does not need to publicly expose it
5. A normal explorer cannot simply identify Bob's normal wallet as the recipient
6. Alice authorizes with her own wallet
7. Bob can receive and spend normally
8. Veyra never custodies private keys
9. The privacy is not a frontend-only trick

Answer: **1–4, 6, 8, 9 are achievable. 5 is achievable for the payment itself, conditionally.
7 is the weak point** — see §7 (spend-time linkage) and §12.

---

## 2. Privacy levels (A–H), stated precisely

| Level | Property | Achievable with the recommended design? |
|---|---|---|
| A | UI hides Bob's address | Yes — but insufficient on its own |
| B | API does not return Bob's address | Yes — but insufficient on its own |
| C | Transaction-level: the tx does not directly expose Bob's address | **Yes** — the payment goes to a one-time stealth address |
| D | Linkage: observer cannot correlate the mechanism with Bob's wallet | **Yes for the payment, conditionally after the fact** (a later sweep to a publicly-Bob address reveals it retroactively) |
| E | Amount privacy | **No** — the transferred value is public |
| F | Sender privacy | **No** — Alice is the publicly visible payer |
| G | Recipient privacy | **Yes** — the stealth address is not derivable from Bob's identity by an observer |
| H | Full transaction privacy | **No** — the transaction exists, is public, and carries sender, amount and timing |

Do not describe any Veyra transfer as "anonymous". The correct claim is:
**"the recipient's wallet address is not revealed to the sender or to the public chain."**

---

## 3. LitVM capabilities (verified)

Source: official LitVM documentation (`docs.litvm.com`: Welcome, About, Architecture, FAQ,
`$LITVM & $zkLTC`, Add to Your Wallet, Remix) and `testnet.litvm.com`, accessed 2026-10-04.

- LitVM is an **Arbitrum Orbit / Nitro** rollup, EVM-compatible (EVM version **Shanghai**, effective
  gas limit 32,000,000, variable block time), settling first on Ethereum and later on Litecoin.
- **zkLTC is the native gas token and base asset** — not an ERC-20 by default. Value transfers are
  ordinary EVM value transfers (`to`, `value`), and gas is paid in zkLTC.
- Testnet **LiteForge, chain ID 4441**, RPC `https://liteforge.rpc.caldera.xyz/http`,
  explorer `https://liteforge.explorer.caldera.xyz`. **Mainnet: "coming soon"** — no chain ID or
  date published. Third-party sources suggest H2 2026; treat as unverified.
- Full EVM equivalence: standard Solidity, Hardhat/Foundry/Remix, standard ERC standards.
- **No privacy or confidentiality feature is documented anywhere in the LitVM protocol.** There is
  no shielded transfer, no confidential token, no private pool, and no stealth-address support in
  the core protocol. Privacy is expected to come from third-party protocols (see §5).
- **MWEB is a Litecoin L1 feature** (MimbleWimble extension blocks, UTXO-level). It is not exposed
  inside LitVM's EVM state, and LitVM's LTC bridge locks LTC in a **Taproot** address on Litecoin.
  Claims that LitVM L2 transactions are "shielded by MWEB" are **third-party and unsupported by
  official documentation**. MWEB-style value-blinding does not exist for zkLTC balances on LitVM.

*What this does not prove:* that no privacy contract is deployed on LiteForge. I could not query
chain state — see §13 (tooling limitation).

---

## 4. SilentSwap (verified, and why it is not the answer)

Source, primary: `docs.silentswap.com` (SDK docs, "how it works", deposits, use-cases, references),
the published npm packages `@silentswap/sdk@2.3.0`, `@silentswap/chains@2.3.0`,
`@silentswap/assets@2.3.0` (read via the npm registry + jsDelivr), and `silentswap.com`.
Source, secondary: SilentSwap's own long-form post, plus third-party reviews.

- **What it is:** a non-custodial, privacy-oriented **cross-chain swap/bridge aggregator**, now
  shipping a V3 SDK. Flow: `quote` → show the user every output → `placeOrder` → the user's wallet
  **deposits** the source asset → the backend fulfils → the gateway deposit is claimed with a
  **notary** signature → the SDK tracks the order.
- **Where the funds go:** the deposit is a transaction to a SilentSwap contract
  (`SilentSwapGateway` / `SilentSwapDepositor`). Deployments exist **only on Base (8453)** and
  **BNB Chain (56)**. `GATEWAY_CHAIN_ID = 56`. The gateway has on-chain **notary / claimer /
  attestor** signer roles and an owner EOA.
- **Supported recipient chains:** `RECIPIENT_CHAINS = { 8453: Base, 56: BNB Chain }` — exactly two.
  Ethereum, Arbitrum, Optimism and Polygon are noted as "future config-only adds".
- **Supported assets:** USDC, USDT, DAI, WETH, WBTC, and native gas assets; UTXO assets (BTC, LTC)
  route through **ChangeNOW** — a centralised exchange service. Payouts are **USDC-denominated with
  a 10 USDC minimum** in the supported routes.
- **LitVM (4441) and zkLTC are in neither registry.** There is no source-chain entry, no recipient
  chain entry, and no asset entry for zkLTC. Nothing in the SDK can express
  "zkLTC on LitVM → zkLTC on LitVM".
- **Privacy model:** the deposit calldata does not reveal the recipient, and fulfilment happens off
  the public chain, so the *public* chain does not contain a clean sender→recipient edge. But the
  SDK client must supply `outputs[].address` (the recipient's **real** address), and the operator
  (plus ChangeNOW, plus Relay) necessarily knows the deposit→payout mapping. It is
  "unlinkable on-chain, fully known to the operator", not anonymous.
- SilentSwap's earlier (V2) marketing describes TEE execution, per-swap seeds and single-use
  facilitator routing accounts, and states it is **not a pooled mixer** and performs KYT.
- **LitVM's own announcement** ("Introducing: Litecoin Web3 Privacy", 2026-08-26) is a
  high-level roadmap post: "LitVM is introducing a native privacy layer for Litecoin Web3,
  beginning with SilentSwap interoperability for LTC and zkLTC." It contains **no** contracts,
  no mechanism, no date, and uses the future tense. It does not describe zkLTC→zkLTC same-chain
  payments.

**Verdict:** SilentSwap is a legitimate, non-custodial privacy *swap/bridge* aggregator. It cannot
serve Veyra's use case today: wrong chain, wrong asset, wrong primitive (swap, not payment), a
10-USDC-style floor, an operator + CEX-rail trust surface, and a client that must know the
recipient's address. Rejected. It may become relevant later as a "break the link" hop, not as the
transfer rail.

---

## 5. Stealth addresses — the mechanism that does work (verified)

Sources: **ERC-5564** ("Stealth Addresses", Final, eips.ethereum.org) and **ERC-6538**
("Stealth Meta-Address Registry", Final) — both read in full, including their
Security Considerations and Deployment Method sections.

**Mechanism (secp256k1 scheme, `schemeId = 1`):**

- Bob holds two key pairs — a **spending** key and a **viewing** key — and publishes the
  concatenation of the two public keys as a **stealth meta-address**
  (`st:litvm:0x<spendingPub><viewingPub>`). This is *not* his wallet address and does not reveal it.
- Alice generates a random ephemeral key, computes the ECDH shared secret with Bob's **viewing**
  public key, derives `P_stealth = P_spend + hash(s)·G`, and pays that one-time address.
- Alice publishes an **announcement** (`ERC5564Announcer.announce(schemeId, stealthAddress,
  ephemeralPubKey, metadata)`), whose first metadata byte is a **view tag** for fast filtering.
  For the **native token** the standard defines the metadata layout explicitly
  (bytes 2–5 `0xeeeeeeee`, address `0xEeee…EEeE`, then the amount) — **native zkLTC is a
  first-class case of the standard.**
- Bob scans announcements with his **viewing private key** (view-tag filter first, then full
  derivation) and can spend with `p_stealth = p_spend + hash(s)`.

**Why an explorer cannot link it:** deriving the stealth address from the announcement requires
either Alice's ephemeral private key or Bob's viewing private key. Neither is on-chain. Publishing
the meta-address does not help an observer: the ECDH shared secret is not computable from public
keys. The security of the scheme therefore rests on the viewing key and on discarding the
ephemeral key.

**Canonical contracts (deployable on any EVM chain, including LitVM):**

| Contract | Address | Deployment |
|---|---|---|
| `ERC5564Announcer` | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` | CREATE2 via the deterministic deployer `0x4e59b44847b379578588920ca78fbf26c0b4956c`, salt `0xd0103a29…b4447` |
| `ERC6538Registry` | `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538` | same deployer, salt `0x7cac4e51…8da078` |

Both are unowned, immutable singletons with no admin, no upgrade path and no funds — a chain can
adopt them without trusting anyone. They are CC0 reference implementations published in the EIPs.

**The EIP's own stated limitations (not my inventions):**

- *"The funding of the stealth address wallet represents a known issue that might breach privacy.
  The wallet that funds the stealth address MUST NOT have any physical connection to the stealth
  address owner."*
- Recipients must later pay gas from the stealth address; the EIP suggests the **sender** may attach
  a small amount to sponsor it (for zkLTC: add a little extra native value).
- Announcements are an uncounted externality for recipients → spam/DoS is a known, unsolved-by-gas
  concern; parsing providers may filter or charge a toll.
- View tags reduce the security margin from 128 to 124 bits (privacy only, not correctness).

**Independent production evidence (third-party, but consistent):** Umbra (ERC-5564/6538, keys
derived client-side from one wallet signature, no server key access) and Fluidkey are described as
live stealth-address products; a TypeScript stealth library exists for another Arbitrum Orbit chain
(Robinhood Chain) and ships consolidation and time-decorrelated exit tooling — the same Orbit stack
family as LitVM.

### 5.1 Lunaria — an existing LitVM implementation (verified as far as possible)

`lunariaprotocol.com`, and the **official LitVM ecosystem directory** at `testnet.litvm.com`
(accessed 2026-10-04), which lists: *"Lunaria — Private payment links using stealth addresses."*

- "Lunaria uses stealth addresses, the same cryptography standardized in ERC-5564."
- "Connect your wallet and sign a single message. That derives your stealth keys … **The key never
  leaves your device.**"
- "Built on canonical ERC-5564 / ERC-6538 contracts audited by Trail of Bits … 0 custody, keys and
  scanning stay client-side."
- **"Native zkLTC payments do not use the router and do not pay its fee."** The 1% router exists only
  for ERC-20s (bundling announcement + transfer + a gas reserve into one atomic call); the
  native path is the plain standard flow.
- Its own honest disclosure: **"LitVM transactions, amounts, and bridge activity remain public."**
- Testnet-only: the router is "custom testnet software", "unaudited", "Not for mainnet use"; the SDK
  docs are "in preparation". A deployed router address is published
  (`0xbEa56424D71f88eEe33eA6539cF6ee76498D67E7`).

**What this proves:** the mechanism works on LitVM with native zkLTC, it is listed by LitVM itself,
and the privacy claim is being made the same way the EIP defines it — including the honest
admission that amounts remain public.
**What this does not prove:** that the audit exists, that the contracts are byte-for-byte the
canonical ones, or that an independent party has verified the deployment. I could not query the
chain (§13).

---

## 6. Shielded pools / zk-value transfers

**Feasibility on EVM:** yes in principle — Groth16/PLONK verifiers run on any EVM-equivalent chain,
and a contract can hold native zkLTC (as Tornado-style pools hold native ETH).

**But for Veyra, today: not viable.**

- **Nothing exists on LitVM.** No pool, no pool operator, no verifier, no relayer. It would be a
  from-scratch build: contract + circuit + **trusted setup ceremony** + independent audit + a
  relayer network + operational monitoring.
- **Anonymity set.** A shielded pool's privacy is the size and diversity of the pool. On a testnet
  with a small user base, a deposit/withdrawal pair is trivially correlatable by amount and timing.
  Real amount privacy requires fixed denominations, which conflicts with "send 10 zkLTC".
- **Deposits are public.** Entering the pool is a visible on-chain transaction from Alice's wallet;
  only the exit can be unlinked, and only with a relayer paying gas on Bob's behalf.
- **Trusted setup + relayer = new trust assumptions** that Veyra would have to own and explain.
- **Regulatory exposure.** Tornado Cash's contracts were sanctioned by OFAC in August 2022 and
  delisted on 2025-03-21 after *Van Loon v. Treasury* (5th Cir.: immutable smart contracts are not
  "property"). That improves the legal picture, but developers of such protocols have faced criminal
  charges, and a mixer-shaped product is reputationally hostile for a consumer game with a casino.
  Veyra explicitly does not want to be a mixer.
- **It solves problems Veyra does not have.** Bob does not need to hide *that he was paid*; he needs
  his *wallet address* not to be attached to the payment. That is precisely what stealth addresses do
  without pools, without custody, and without a road to mixers.

---

## 7. The real limitation: spend-time linkage

This is the single most important design constraint and it must not be hidden from users.

A stealth payment is unlinkable **at the time of payment**. The link is revealed later **by Bob's own
behaviour**, if Bob moves the funds to an address that the public associates with him:

1. **Sweep/consolidation** — Bob sweeps the stealth balance into his normal Veyra wallet (the one that
   plays the casino, withdraws, and holds his balance). That transfer is public, and it links
   `stealth address → Bob's wallet` retroactively; combined with the earlier public
   `Alice → stealth address` transfer, the whole chain `Alice → stealth → Bob` becomes readable.
2. **Gas funding** — if Bob's withdrawal is funded by an address tied to him, the same link appears.
3. **Unique amounts and timing** — an observer watching Alice's wallet sees "10 zkLTC out to a fresh
   address at 14:02"; that is enough to correlate with anything else happening at that moment.

Consequences for Veyra's product model:

- Veyra's current model is one authenticated wallet per user (`users.id ↔ wallet_address`), and all
  gameplay (casino wagers, arcade, withdrawals, balance display) is anchored to that wallet.
- Received stealth funds therefore land **outside** the account the app knows. Making them usable
  requires either (a) a sweep → link, or (b) supporting stealth-address balances and spending
  directly from stealth keys → a genuine wallet-model change.
- There is no way to make a *receiving-only* privacy layer also *spend* privately into an existing
  public account. Time-decorrelated exits reduce, but do not remove, this.
- **Therefore Veyra must either accept and disclose the linkage, or make stealth balances a
  first-class spendable address type.** This is the principal Phase 2 design decision.

---

## 8. Relayer analysis

| Question | Answer for the recommended design |
|---|---|
| Is a relayer required? | **No**, for the payment. Alice's own wallet sends the transfer and (optionally) the announcement, paying gas in her own zkLTC — exactly like Veyra's existing wager transaction. |
| Is a relayer required later? | **Only if** Bob wants to spend without holding gas at the stealth address. The EIP recommends the sender attaching a small gas reserve instead, which is simpler and adds no third party. |
| What would a relayer learn? | The stealth address, the amount, and the timing — all already public. If a relayer sponsored the *exit*, it would learn the destination address and the IP of the exiting client. That link is the dangerous one. |
| Would Veyra run one? | **Not in Phase 2.** Nothing in the recommended flow needs it. |
| What can Veyra's backend see? | With client-side keys: the `.veyra` ↔ meta-address mapping (public data), and whatever the client chooses to report. It **cannot** link a stealth address to a user without a viewing key. That is the property to protect — Veyra must not hold viewing keys server-side in v1. |
| Does a third party see the graph? | Not in the stealth design. SilentSwap's design *does* have such an observer (its backend, its notary/attestor keys, ChangeNOW, Relay) — one more reason it is rejected. |

**Design rule:** the recommended architecture must keep the property "even Veyra cannot link the
payment to Bob without Bob's viewing key". Any convenience feature that requires a server-side
viewing key (e.g. push notifications) must be opt-in, per-user, and disclosed as a trade-off
(auditor-style viewing keys can *find* payments but cannot *spend* them).

---

## 9. Wallet signing experience

| Step | What Alice signs | Notes |
|---|---|---|
| One-time setup (Bob) | `signMessage("…Veyra stealth keys…")` — **no transaction, no gas** | Deterministic RFC-6979 signature; the client derives spending + viewing keys and the meta-address. Must be reproducible: EOAs (MetaMask, Rabby, Coinbase, Trust, Rainbow) are RFC-6979-deterministic; smart-contract wallets (EIP-1271) may not be, so the derived keys must be backed up. |
| Send (Alice) | **1 transaction** signing of the native zkLTC transfer to the stealth address | Reuses Veyra's existing `eth_sendTransaction` pattern (the adapter already sends native `value`). |
| Announce | **A 2nd signature** (`announce(...)` to the announcer) — or bundled into a single transaction with a tiny ownerless "pay + announce" helper contract | Without the helper, the honest UX is "two confirmations". With the helper it is one — but the helper is new, auditable-in-a-day code that must be deployed and reviewed. Do not promise one confirmation until the helper exists and is audited. |
| Spend (Bob) | 1 transaction from the stealth address (gas paid from the received amount or from Alice's attached reserve) | Requires Veyra to be able to sign with a derived key, client-side. |

Network switching is not required: everything is on LitVM/4441.

---

## 10. Recipient experience

Bob needs: `bob.veyra` (already exists), one wallet signature at setup, and software that scans
announcements. He does **not** need to publish his wallet address, generate a wallet per payment,
approve individual incoming transfers, or interact with Alice.

What Bob does need that does not exist in Veyra today:

- **Detection** — announcements must be scanned with his viewing key. Client-side scanning (as
  Lunaria and Umbra do) is the privacy-preserving choice; a server-side scanner requires handing
  Veyra a viewing key (Fluidkey's trade-off).
- **A decision about funds** — spend in place (wallet-model change) or sweep (linkage).
- **Recovery** — if the derived keys are lost, funds are unrecoverable. A one-time key backup is
  mandatory UX, not optional.

---

## 11. Non-custodial assessment

| Component | Custody | Assessment |
|---|---|---|
| Stealth transfer (recommended) | **None.** Alice's wallet signs; Bob's keys are derived client-side from his own signature; Veyra never holds a key and cannot move funds. | ✅ Complies |
| SilentSwap | Non-custodial at the contract level, but the deposit is held by the gateway and released by an operator notary, with ChangeNOW/Relay in the fulfilment path. | ⚠️ Trust surface, and unusable for zkLTC anyway |
| Shielded pool | Contract-mediated, non-custodial, but requires a trusted setup and a relayer. | ⚠️ Trust assumptions |

Veyra must **never** store spending keys, viewing keys (v1) or derived stealth private keys on its
servers. This is a hard rule for Phase 2.

---

## 12. Explorer visibility analysis (recommended mechanism, native zkLTC)

| Information | Visible to explorer? | Visible to sender (Alice)? | Visible to recipient (Bob)? |
|---|---|---|---|
| Alice's address | **YES** (payer) | YES | YES |
| Bob's normal wallet address | **NO** | **NO** (only the meta-address) | YES (his own) |
| Temporary / stealth address | **YES** (transfer recipient) | YES | YES (after scanning) |
| Transaction amount | **YES** | YES | YES |
| Transaction hash | YES | YES | YES |
| Contract address | Announcer (`0x5564…5564`) if announced on-chain; a plain value transfer has none | YES | YES |
| Token movement | YES — native zkLTC leaves Alice, arrives at the stealth address | YES | YES |
| Timing | YES | YES | YES |
| Link between Alice and Bob | **NO** on-chain | **YES** (Alice knows) | YES |
| Link after a sweep to Bob's normal wallet | **YES — the link becomes public** | YES | YES |

Network-level observers and RPC providers still see IP addresses and the submitting client; that is
out of scope of the on-chain mechanism and must be stated.

---

## 13. Evidence, sources and verification limits

**Primary sources (official / normative):**

- `docs.litvm.com` — Welcome, About, Architecture, FAQ, `$LITVM & $zkLTC`, Add to Your Wallet,
  Remix (LitVM architecture, zkLTC as native gas token, network parameters, mainnet phases;
  no privacy feature documented).
- `litvm.com/blog/introducing-litecoin-web3-privacy` (2026-08-26) — the official privacy-layer
  announcement; high-level only; "will support both LTC and zkLTC"; no mechanism, no contracts.
- `testnet.litvm.com` — official ecosystem directory listing Lunaria.
- `eips.ethereum.org/EIPS/eip-5564` and `/eip-6538` — the standards, canonical addresses,
  deployment method, security considerations, native-token metadata layout.
- `docs.silentswap.com` + `silentswap.com` + npm packages `@silentswap/sdk@2.3.0`,
  `@silentswap/chains@2.3.0`, `@silentswap/assets@2.3.0` (registry source read directly) —
  supported chains/assets, gateway/notary model, deposit flow, minimums.
- `lunariaprotocol.com` — the LitVM stealth implementation.

**Third-party sources (labelled, used only as corroboration):** Umbra/Fluidkey ecosystem write-ups;
the Tornado Cash OFAC sanction (2022-08-08) and delisting (2025-03-21) legal summaries;
Litecoin MWEB explainers; Litecoin.watch and coingabbar LitVM articles (⚠️ both describe
"Polygon CDK" — **contradicted by official LitVM docs, which say Arbitrum Orbit**; third-party
articles also claim MWEB-backed shielded L2 transactions, which official docs do not support).

**Verification limitation — read this before trusting any on-chain claim:** the sandbox in which
this research was performed has **no outbound network access** (all `curl`/RPC calls fail with a TLS
connect error). I could **not**:
- query the LiteForge RPC (`eth_chainId`, `eth_getCode`, `eth_getLogs`);
- confirm that the ERC-5564 announcer / ERC-6538 registry are deployed on chain 4441, or at which
  addresses;
- confirm Lunaria's deployed contracts or audit.

Everything above about deployed state is therefore **documentary evidence**, not independently
verified chain state. Phase 2's first task must be to verify it on-chain.

---

## 14. Feasibility matrix

| Approach | Recipient address hidden from sender | Recipient hidden on explorer | Non-custodial | zkLTC compatible | LitVM compatible | Practical |
|---|---|---|---|---|---|---|
| Direct transfer | NO | NO | YES | YES | YES | YES (but fails the requirement) |
| **Stealth address (ERC-5564/6538)** | **YES** | **YES** (payment; conditional on no linkable sweep) | **YES** | **YES** (native layout defined in the standard) | **YES** (live on LiteForge testnet) | **PARTIALLY** — testnet tooling, needs key management + scanning + a spend policy |
| Shielded pool | YES | YES (with a relayer and fixed denominations) | YES | Possible (contract holds native value) | Only as a new deployment | **NO today** — nothing exists; trusted setup, audit, relayer, tiny anonymity set |
| SilentSwap | PARTIAL (it needs Bob's address; the *link* is what it hides) | NO (the payout lands in Bob's normal address) | Claimed; deposit + notary + CEX rails | **NO** — zkLTC is not in any registry | **NO** — LitVM is not a source or recipient chain | **NO** today |
| Lunaria (LitVM stealth implementation) | YES | YES | YES | YES (native path, no router) | YES (LiteForge, in the official directory) | **PARTIALLY** — testnet, unaudited router, SDK docs pending, third-party dependency |

---

## 15. Threat model

| # | Adversary | What can realistically be hidden | What cannot |
|---|---|---|---|
| 1 | Sender (Alice) | Bob's wallet address; the link to Bob's identity | The amount; that she paid; the stealth address |
| 2 | Recipient (Bob) | — (he sees his own payment) | Alice's address is visible to him |
| 3 | Block explorer / indexer | The stealth→Bob link (without a viewing key) | Sender, amount, timing, the existence of the payment |
| 4 | Random chain observer | Same as above | Same as above |
| 5 | Veyra backend | The link (no viewing key server-side in v1) | That Alice paid *someone*; the amount; the `.veyra` ↔ meta-address mapping (public) |
| 6 | Privacy-mechanism operator | Operating party does not exist in the stealth design | — |
| 7 | Relayer | Not used for payments | — |
| 8 | Wallet provider | — | Address, and possibly IP; a wallet can see everything its user sees |
| 9 | Network observer / RPC | — | IP, timing, and the submitting client |

---

## 16. Recommended architecture (contingent — do not build yet)

1. **Recipient setup.** Bob signs one fixed message. Client derives `(p_spend, p_view)` and the
   meta-address. Veyra stores only the **meta-address** (public) against `users.id`; keys stay on
   the device, with a mandatory backup step.
2. **Identity integration.** `bob.veyra → users.id → stealth_meta_address`. The public identity API
   returns the **meta-address**, never the wallet address (this preserves Phase 1's contract).
3. **Send.** Alice enters `bob.veyra` + amount → Veyra resolves the meta-address → the client
   derives a fresh stealth address → Alice signs the native zkLTC transfer (reusing the existing
   adapter's `eth_sendTransaction` + `value` path) → an announcement is published.
4. **Detection.** A Veyra-run announcement **indexer** serves the public announcement log; Bob's
   client scans it locally with his viewing key. No server-side keys.
5. **Display.** A "Private payments" view listing detected notes, with an explicit, permanent notice:
   *amount and sender are public; the recipient address is not.*
6. **Spend policy** (the open decision): spend-in-place from stealth addresses, or an explicit
   "move to my main wallet (this makes the link public)" action — never a silent automatic sweep.
7. **Contracts.** Canonical `ERC5564Announcer` + `ERC6538Registry` deployed to LitVM (verify first
   whether they already exist at the canonical addresses). Optionally, a minimal ownerless
   "pay-and-announce" helper for single-confirmation UX — audited before mainnet use.

---

## 17. Rejected approaches

| Rejected | Why |
|---|---|
| Direct wallet→wallet transfer | Exposes Bob's address to Alice and to everyone; fails the requirement outright. |
| UI/API-only hiding (levels A + B) | The on-chain transaction still names Bob's wallet. Explicitly disallowed as "fake privacy". |
| SilentSwap as the rail | No LitVM, no zkLTC, USDC-only with a 10-USDC floor, a swap/bridge primitive rather than a payment, and operator/notary/CEX trust. |
| Shielded pool / Tornado-style mixer | Nothing deployed on LitVM; needs a trusted setup, an audit, a relayer and an anonymity set that a testnet cannot provide; regulatory and reputational risk; solves a broader problem than Veyra has ("Veyra is not a mixer"). |
| MWEB-based shielding for L2 balances | MWEB is a Litecoin L1 UTXO feature; it cannot hold or shield LitVM EVM state. |
| Veyra-held keys / custodial "internal transfers" | Violates the non-custodial rule and would be fake blockchain privacy. |
| Server-side viewing keys (for v1) | Would let Veyra link every payment to its recipient, recreating the exact graph we are trying to avoid. May be offered later as an explicit, opt-in notification trade-off. |

---

## 18. Privacy guarantees (exact)

With the stealth design, on a LitVM chain where the canonical contracts are deployed and no linkable
sweep occurs:

- **Guaranteed:** Bob's wallet address is not derivable from the payment transaction by any party that
  does not hold Bob's viewing private key or Alice's ephemeral private key.
- **Guaranteed:** Alice never receives or needs Bob's wallet address (she receives a meta-address).
- **Guaranteed:** Veyra, its indexer, and its backend cannot link a stealth payment to a user without
  a viewing key it deliberately does not hold.
- **Guaranteed:** No custody; Veyra cannot move user funds.

## 18b. What cannot be guaranteed

- **Amounts are public.** The transferred value is visible on-chain.
- **The sender is public.** Alice's wallet is the visible payer.
- **Timing and existence are public.** An observer sees that a payment happened, when, and how much.
- **A linkable spend breaks the guarantee retroactively.** Any transfer from the stealth address to
  an address publicly associated with Bob links the whole path.
- **The recipient can be de-anonymised by off-chain metadata** (IP, wallet provider, screenshots,
  shared invoices).
- **Small value sets are correlatable.** If Alice's outbound amount is unique, the payment is easy to
  identify as *hers* (not as *Bob's*).
- **Nothing here is "anonymous".** The correct word is "unlinkable recipient".

---

## 19. Open questions (must be answered before Phase 2 is approved)

1. Are `ERC5564Announcer` / `ERC6538Registry` deployed on chain 4441, and at which addresses?
   (Cannot be checked from this environment.)
2. Is Lunaria's claimed Trail of Bits audit public? What is its scope?
3. Is Lunaria's SDK published, and is it intended for third-party integration, or is it
   infrastructure Veyra should run itself (indexer + canonical contracts)?
4. Does LitVM mainnet have a date (official)? Nothing is published beyond "coming soon".
5. Which spend policy does Veyra want — spend-in-place or disclosed sweep?
6. Is a one-confirmation experience required, justifying a new audited helper contract?
7. Legal/AMSL posture for a game holding a stealth-payment feature.

---

## 20. Proposed Phase 2 architecture (conditional — requires the blockers in §19 to be resolved)

```
bob.veyra
  ↓ resolve (server; returns ONLY the stealth meta-address)
stealth meta-address  ·  st:litvm:0x<pendingPub><viewingPub>   (never Bob's wallet address)
  ↓ one-time derive (client)
stealth address + ephemeral pubkey + view tag
  ↓ wallet signing (Alice's wallet; existing eth_sendTransaction pattern)
native zkLTC transfer  →  stealth address        [1st signature]
announce(schemeId, stealth, ephPub, metadata)    [2nd signature, or bundled by a helper]
  ↓
announcement indexer (public log, no keys)
  ↓ client-side scan with Bob's viewing key
recipient detection (view tag → full check)
  ↓
private balance (stealth address) — NOT the main Veyra balance
  ↓ explicit user action (never automatic)
spend in place, or disclosed sweep to the main wallet (which publishes the link)
```

**Contracts:** canonical ERC-5564 announcer + ERC-6538 registry (verify/deploy); optionally one
minimal ownerless pay-and-announce helper (audited) for one-confirmation sends.
**APIs:** `POST /api/identity/stealth` (register meta-address, authenticated); a public
announcement feed (`GET /api/stealth/announcements?since=`) that serves public chain data only.
**Database:** `stealth_meta_addresses(user_id, scheme_id, meta_address, created_at)` — public data
only; optional `stealth_payments` cache **only if** the user opts into server-side scanning (viewing
key), otherwise no payment table at all.
**Wallet interactions:** `signMessage` once at setup; `eth_sendTransaction` to the stealth address;
`announce` transaction; later a spend transaction signed with the derived key.
**Signatures:** 1 setup message (no gas), 1–2 per payment, 1 per spend.
**Frontend:** "Private payments" section on the identity panel, a send flow from the identity chip,
a detected-payments list, and a permanent public-visibility notice.
**Backend:** meta-address resolution, announcement indexing, no key material.
**Failure states:** unknown/reserved username; recipient without a meta-address; announcement
failure after a successful transfer (recoverable — the funds arrived, the recipient can be notified
off-chain); indexer outage; lost derived keys (unrecoverable funds — hence the backup step).
**Security model:** server-side validation, authenticated endpoints, rate limits, no key material,
no custody, and idempotency keyed on the on-chain transaction hash.
**Privacy model:** as §18/§18b — recipient-unlinkable, everything else public.
**Fees:** none in v1 (only network gas). Do not add a fee to the native path.
**Idempotency / replay:** transfers are idempotent by transaction hash; announcements deduplicated
by `(tx hash, log index)`. There is no server-side "claim", so there is nothing to double-credit.
**Confirmations:** at least the existing `requiredConfirmations: 1`, with a longer display delay for
received payments; consider requiring more before treating a payment as settled.
**Recovery:** a mandatory one-time stealth-key backup at setup; the registry must be re-registerable
if a key is ever rotated.

---

## 21. Phase 2 test plan

Standard suites: username resolution (`.veyra` → user → meta-address), unauthorized meta-address
lookup, **wallet-address non-disclosure in every API response**, transfer authorization, duplicate
submission, replay, confirmation handling, failed transaction, insufficient balance, indexer outage,
lost-key recovery flow, and a UI test asserting the public-visibility notice is always present.

**The objective privacy test (must-have):**

> *Given Alice's transaction hash and all publicly available blockchain data, can an observer
> identify Bob's normal Veyra wallet address?*

How to run it:

1. Deploy the flow on LiteForge testnet with two real accounts.
2. Execute a payment Alice → `bob.veyra`; record the transaction hash.
3. Feed **only** the hash into an analysis script that enumerates every publicly available source:
   the transaction and its receipt, all logs/announcements, transfers in and out of every address
   involved, the ERC-6538 registry, the explorer's API, and Veyra's **public** APIs.
4. The script attempts linkage via: direct address equality with Bob's wallet; any outflow from the
   stealth address to an address in Veyra's known-wallet set; amount/timing correlation; and any
   published mapping from `.veyra` to a wallet address.
5. **Pass** = no path from the transaction to Bob's wallet.
6. **Negative control** = the same script run against a *direct* wallet→wallet transfer must
   **fail** (i.e. detect the link). Without the control, a passing test proves nothing.
7. Variant A: run the script as Veyra's backend (same public data) — it must also fail to link.
8. Variant B: after a deliberate sweep by Bob to his main wallet, the script must succeed — this
   documents the limitation rather than hiding it, and guards against anyone re-introducing an
   automatic sweep.

---

## 22. Bottom line

- The **recipient-privacy half** of the requirement is solved by an existing, final standard
  (ERC-5564/6538), it is compatible with LitVM's EVM and with native zkLTC, and there is already a
  live LitVM testnet implementation listed in LitVM's own ecosystem directory.
- The **"anonymous transfer" half of the requirement cannot be met** — amounts, sender, timing and
  the existence of the payment are public by construction, and any linkable spend reveals the link.
- Phase 2 should not start until: (a) the on-chain state is verified (contracts deployed where we
  think they are), (b) LitVM mainnet has a date, (c) the spend policy is decided, and (d) the
  one-time key backup UX is designed.

**Conclusion: B — PARTIALLY READY.**

---

# Phase 2B — On-chain verification (added 2026-10-04)

**Status:** verification only. No code written, no transaction sent, no funds moved, no contract
deployed, no change to any Veyra payment path. This section **adds** to Phase 2A and corrects three
Phase 2A details (§39); it does not rewrite the Phase 2A analysis.

**Method:** (a) the public LiteForge chain index (Blockscout v2 REST API at
`liteforge.explorer.caldera.xyz`); (b) an **independent Keccak-256 implementation** written for this
phase and self-tested against public vectors before use (`keccak256("")` and `keccak256("abc")` both
match); (c) the verified source of a contract read directly from the explorer. Every cryptographic
claim below was recomputed locally rather than taken from a website.

---

## 23. Verification environment — what was and was not possible

| Required item | Status |
|---|---|
| `eth_chainId`, `eth_blockNumber`, `net_version`, `eth_getCode`, `eth_getLogs` over raw JSON-RPC | **RPC verification unavailable from this environment.** The sandbox has no general HTTPS egress (TLS handshake to Cloudflare-fronted hosts fails), and the available page-fetch tool cannot issue HTTP POST, which JSON-RPC requires. |
| Chosen alternative | The Blockscout **index** of the same chain (`/api/v2/...`). It is chain-derived data, but it is *not* a raw RPC call — every finding below is labelled accordingly. |
| Etherscan-compatible API (`?module=proxy&action=eth_getCode`) | Not supported by this explorer (`{"message":"Unknown module"}`). |
| Independent signature verification | **Yes** — pure-JS Keccak-256, tested against public vectors. |
| Sending a transaction | **No.** Not requested, not needed, not done. All work is read-only. |

Repeated for the record: **RPC verification is unavailable from this environment.** The LiteForge
explorer's indexed data is the strongest available evidence and is used throughout as
**VERIFIED ON-CHAIN (explorer index)**. Anything from websites/pages is **VERIFIED FROM
DOCUMENTATION** (and marked with a level). Nothing in this section is fabricated or inferred as
fact where evidence is missing.

Source-quality levels used: **L1** on-chain state / verified contract source; **L2** official
standards (EIP text) and official LitVM docs; **L3** vendor material (Lunaria site, its security.txt);
L4 third-party write-ups; L5 social posts. No L3–L5 item is used below to assert an L1 fact.

---

## 24. ERC-5564 announcer — VERIFIED ON-CHAIN (deployed, active, standard-conformant)

| Item | Value |
|---|---|
| Address (canonical ERC-5564 announcer) | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` |
| Contract type | Contract. One real tx to it has `type: "contract_call"`, `method: "0x4d1f9583"`, status `ok`, and emits the announcement log. Blockscout's *address summary* wrongly labels it `is_contract:false` / "EOA"; the **transaction objects** classify the same address `is_contract:true` and the calls emit logs. The transaction objects are decisive: an EOA cannot be called with calldata that emits events. |
| Activity | ≈10,546 transactions; `has_logs: true`; native balance 0 (it never holds funds — it only emits events) |
| Topic0 of its logs | `0x5f0eab8057630ba7676c49b4f21a0231414e79474595be8e4c432fbf6bf0f4e7` |
| My independent Keccak-256 of `Announcement(uint256,address,address,bytes,bytes)` | `0x5f0eab8057630ba7676c49b4f21a0231414e79474595be8e4c432fbf6bf0f4e7` → **MATCH** |
| Method selector in real calldata | `0x4d1f9583`; my Keccak of `announce(uint256,address,bytes,bytes)` = `0x4d1f9583…` → **MATCH** (the EIP-5564 interface `IERC5564Announcer.announce`) |
| Scheme used in every sampled log | `schemeId = 1` (secp256k1) |

**A real announcement, decoded byte-exactly** (tx `0xb1c9895e5b63f8c9629e5aa942d4df6c452d47f60550fa8d58ea1edbbcc06d53`,
block 56,046,328, from EOA `0x4F2BB14B…7979`, value 0, gas used 28,336, status ok):

```
announce(schemeId = 1,
         stealthAddress = 0x949DFA2a5CD195403CCf455625678865A8F1e0AB,
         ephemeralPubKey = 0x02f0976880154ebf19f151149f7efdc56bcf700162aada12f76870bec0287e70df,  // 33 bytes, 0x02 prefix ⇒ valid compressed secp256k1 point
         metadata = 0x9f)                                                                    // 1 byte only
```

Topics are `[Announcement-sig, schemeId, stealthAddress, caller]` — i.e. the **sender's address is
public** (by design; ERC-5564 hides the *recipient*). The 33-byte ephemeral public key and the 1-byte
**view tag** are public; **no amount, no token and no Bob-identifying data are in this log**.

Two facts worth carrying into design:

- For native zkLTC payments observed on LiteForge the metadata is **a single view-tag byte** — not the
  richer `0xeeeeeeee`-style layout described in Phase 2A. Less metadata on-chain is better for
  privacy, and it must be what the client emits, but see §39 (correction #2).
- **Announcements are permissionless and are not proof of payment.** The sampled announcement above
  names a stealth address whose address record shows **no transactions and no transfers at all**. A
  spam/intent-only announcement therefore exists in the wild; scanning and detection must be based on
  the *payment*, with the announcement as a hint (see §32, §38).

---

## 25. ERC-6538 registry — VERIFIED ON-CHAIN (deployed, standard-conformant, in use)

| Item | Value |
|---|---|
| Address (canonical ERC-6538 registry) | `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538` |
| Contract | `is_contract: true` in both the address object and transaction objects; `has_logs: true` |
| Observed log range | blocks 34,373,123 → 55,575,524 — i.e. long-lived, used over a wide period |
| Event topic0 | `0x4e739a47dfa4fd3cfa92f8fe760cebe125565927e5c422cb28e7aa388a067af9`; my Keccak of `StealthMetaAddressSet(address,uint256,bytes)` matches exactly |
| Real registration tx | `0x6c8ede1ffa067c985194b8bc5e0bf29fdd2f8a19b5f76be18d0bc92f01db6764`, from `0xEfe29e79…2183` (EOA), to the registry, method `0x042c7aa3` = my Keccak of `registerKeys(uint256,bytes)`, status ok |
| Payload | `schemeId = 1`, `bytes = 66 bytes` = **two 33-byte compressed secp256k1 public keys** (`0x023f9831…` spending, `0x0313abfd…` viewing) — exactly the ERC-5564 meta-address format |
| Distinct registrants | At least six different addresses in one sample page — this is used infrastructure, not a ghost deployment |

Consequence: on LiteForge 4441 the three pieces of the standard — **the registry (publish a
meta-address), the announcer (publish a payment notice), scheme 1 (secp256k1)** — all exist, are
canonical, and are being exercised by real EOAs. Phase 2A's open blocker "verify on-chain state
first" is **resolved** for testnet.

---

## 26. Lunaria — implementation verified on-chain; key-derivation internals NOT verified

| Item | Value |
|---|---|
| Router address | `0xbEa56424D71f88eEe33eA6539cF6ee76498D67E7` |
| Status | `is_contract: true`, `is_verified: true`, **name `LunariaPaymentRouter`**, creator `0x2dD9b6…ADF70` |
| Source (read from the explorer, not from the website) | `src/LunariaPaymentRouter.sol`, Solidity 0.8.27, `ReentrancyGuard`, OpenZeppelin `SafeERC20`/`Math` |
| Standard use | `uint256 public constant SCHEME_ID = 1`; constructor takes the **canonical announcer address** and requires `announcer.code.length != 0`; calls `ANNOUNCER.announce(SCHEME_ID, stealthAddress, ephemeralPublicKey, metadata)` |
| Scope | **ERC-20 only.** `sendTokenPayment(address token, address stealthAddress, uint256 grossAmount, bytes ephemeralPublicKey, bytes metadata, bytes32 ref) payable`; validation requires the stealth address to have **no code** (`StealthAddressNotEOA`), token must be a contract, `msg.value` must be non-zero (the *native gas reserve*) and is forwarded to the stealth address atomically |
| Metadata format (contract constant) | `ERC20_METADATA_LENGTH = 23`, `FORMAT_VERSION = 1`, `ASSET_TYPE_ERC20 = 1` |
| Fee | `FEE_BPS` immutable, capped at `MAX_FEE_BPS = 1000`; NatSpec warns `ref` must be a **static** integrator id, "never use a per-payment value" |
| Self-declared status in source | "Immutable, permissionless, **unaudited**, and intended for LiteForge testnet evaluation only" |

**Live usage decoded from chain data** (same payer EOA, three `sendTokenPayment` calls):
`grossAmount = 1,000 × 10^18` of token `0x308CBcd9…5951`; `value = 100000000000000` wei =
**0.0001 zkLTC attached as the recipient's gas reserve**; `ref = bytes32(0)`; metadata of exactly
23 bytes, e.g. `0x580101 308CBcd9…5951` = `viewTag(0x58) || version(0x01) || assetType(0x01) || token`
— matching the contract's own constants. The named stealth address
`0x9895613B603058333881dd54E235dba5AF0aB41D` shows `has_token_transfers: true`,
`has_tokens: true`, **no top-level transactions and no sweep** — funds arrived (token + native
reserve) and were not moved at the time of inspection.

Two conclusions:

1. **The implementation is real, deployed, verified and in use** on LiteForge, and it is built on the
   canonical announcer — independent of anything Lunaria's website claims (L1 evidence).
2. **Native zkLTC does not go through this router** (no function accepts the native asset as the
   paid asset; the ERC-20 path needs the token contract). For native payments the sender performs the
   ordinary two steps — value transfer to the stealth address, then `announce(...)` — which means
   **no contract dependency, no router fee, and no router risk** for Veyra's native-zkLTC use case.
   This confirms the Phase 2A position.

**What is still NOT verified (and matters):** Lunaria's *key derivation and recovery* internals.
Its SDK is **not published on npm** (npm registry search, 2026-10-04: no stealth-related Lunaria
package exists), the audit document is not public, and its site's "one-signature key derivation",
"client-side keys" statements are L3 vendor claims. §7's question — *exactly how Bob's stealth keys
are derived, stored and recovered, and whether the signature is deterministic* — remains open and is
a hard condition in §40.

---

## 27. Native zkLTC mechanics — VERIFIED ON-CHAIN

| Question | Answer | Evidence |
|---|---|---|
| Is zkLTC the EVM native currency? | **Yes** — it is the value asset *and* the gas token | Value-carrying contract calls (`value: 100000000000000` = 0.0001 zkLTC) with `transaction_types: ["coin_transfer","contract_call",…]`; fees denominated in the same token (e.g. `fee 1286960000000` wei for a 128,696-gas call ≈ 0.0000013 zkLTC at 0.01 Gwei/gas) |
| Does an EOA `eth_sendTransaction` with `value` work? | **Yes** — that is precisely Veyra's existing, code-verified send path | `src/systems/LitvmWalletAdapter.js` already sends native `value` for wagers (Phase 2A §9) |
| Is an approval / wrapped token / contract required to move native zkLTC to a stealth address? | **No** | Native transfer = ordinary EVM value transfer to any EOA; nothing in the observed data suggests otherwise |
| Can a stealth recipient pay gas from what it receives? | **Yes, if the sender leaves a reserve** — this is exactly the design EIP-5564 recommends and what Lunaria implements (attached reserve) | Lunaria forwards `msg.value` (0.0001 zkLTC) to the stealth address; for a native payment the reserve can simply be added to the same transfer |

**Concrete hypothetical payment** (Alice → Bob, native): expected ABI/RPC shape:

```
tx1  from: Alice's wallet (EOA, e.g. 0xA11CE…)
     to:   stealth address computed from Bob's meta-address (fresh EOA, e.g. 0x9f3C…)
     value: 10.01 zkLTC        // 10 zkLTC payment + 0.01 zkLTC gas reserve for Bob's later spend
     data: 0x                  // plain native transfer; ~21,000 gas
tx2  from: Alice's wallet
     to:   0x55649E01B5Df198D18D95b5cc5051630cfD45564      // announcer
     value: 0
     data: 0x4d1f9583 || abi(schemeId=1, stealthAddress, ephemeralPubKey(33B), metadata=viewTag(1B))
```

**Exactly what becomes public after tx1+tx2:** Alice's address (the sender — never private in this
scheme); the stealth address; the **amount (10.01 zkLTC)**; the block/timestamp; the ephemeral public
key; the 1-byte view tag; the fact that *some* stealth payment happened; and every later spend *from*
that stealth address and its destination. **Not public:** any link from the stealth address to Bob,
Bob's meta-address, his viewing/spending keys, or his `.veyra` mapping.

---

## 28. ERC-5564 step by step (who knows what)

| # | Step | Public | Alice secret | Bob secret |
|---|---|---|---|---|
| 1 | Bob generates spending keypair `(p, P=p·G)` and viewing keypair `(v, V=v·G)` | — | — | `p`, `v` |
| 2 | Bob publishes meta-address `st:litvm:0xP‖V` (registry and/or Veyra profile) | `P`, `V` | — | — |
| 3 | Alice resolves `bob.veyra` → meta-address | `P`, `V` | — | — |
| 4 | Alice draws ephemeral `r` (one per payment, never reused) | — | `r` | — |
| 5 | Alice computes shared secret `s = H(r·V)` and `R = r·G` | `R` | `r`, `s` | — |
| 6 | Alice computes stealth point `S = P + s·G`, takes its address | `S` | `r`, `s` | — |
| 7 | Alice sends native zkLTC **to `S`** (with gas reserve) | `S`, amount, sender, time | — | — |
| 8 | Alice calls `announce(1, S, R, viewTag)` | `S`, `R`, `viewTag`, caller | — | — |
| 9 | Bob scans announcements; for each computes `s' = H(v·R)` and the view tag; on match recomputes `P + s'·G` and compares to `S` | — | — | `v`, `s'` |
| 10 | Bob derives the stealth private key `k = p + s'` (mod n) | — | — | `p`, `s'`, `k` |
| 11 | Bob signs from `S` to spend | From `S`, value, destination, time | — | `k` |

The partial-match (view-tag) step 9 is only a filter; the full check (step 6-style recomputation)
is what cryptographically decides ownership. Nothing in steps 1–11 requires a server, a relayer, a
custodian or a new contract for native zkLTC.

---

## 29. Key derivation — the critical open item

Scheme 1 is **ECDH over secp256k1** with the additions above; the derivation *math* is settled and
standardized (L2: EIP-5564). What the Phase 2B verification adds is what is *not* settled:

| Question | Status |
|---|---|
| Which keys must Bob back up? | Spending key + viewing key (or whatever deterministic root reproduces them). **Loss of the spending key = permanent loss of any funds at stealth addresses derived from it.** |
| Is Bob's existing Veyra wallet key enough? | **No, not by itself.** The stealth keys are distinct keys derived *from* a wallet signature (at least in Lunaria's model) or generated separately. A plain wallet address has no derivable viewing key. |
| How is the keypair created, and is it deterministic? | **UNVERIFIED.** Lunaria documents "one-signature key derivation" (L3), but its SDK is not published, so the exact signed message, hash-to-scalar method, storage and determinism (RFC-6979 vs. non-deterministic signing) could not be independently confirmed. |
| Does Veyra need to hold anything? | **No.** Viewing/spending keys must never reach Veyra. Veyra stores only the *public* meta-address + a profile choice. No Veyra-held recovery key. |
| What must be decided before any UI | The **recovery contract**: (a) deterministic derivation from a wallet signature, plus (b) an explicit encrypted export/backup of the viewing key *and* spending key, plus (c) a documented loss scenario. |

**This is the primary reason the verdict is conditional, not GO.**

---

## 30. Wallet compatibility

| Wallet class | Send (Alice) | Derive stealth keys (Bob) | Notes |
|---|---|---|---|
| EOA, MetaMask-style, EIP-1193/6963 | **Yes** — ordinary `eth_sendTransaction` with `value` + a contract call | Yes **if** signing is deterministic | Veyra's existing adapter is exactly this (`provider.request`); browser extensions sign deterministically in practice, but this must be tested per-wallet, not assumed |
| Hardware wallets | Yes | Risky | Some hardware/firmware sign with randomized nonces or require on-device confirmation of a message the user does not understand; a non-reproducible signature breaks derivation (funds become unrecoverable). Explicitly to be tested, or excluded. |
| Smart-contract wallets (ERC-1271, multisig, account abstraction) | Yes | **No** | There is no private key to derive from; signature is produced by contract logic. **Documented as incompatible with a signature-derived stealth root** — not silently excluded. Would need an exportable separate key (explicitly out of scope). |

Also note: the send path costs **two signatures** per payment (transfer + announce) unless a helper
contract bundles them; no bundling helper for native zkLTC exists on LiteForge today, and building
one is out of scope for this phase.

---

## 31. Bob's stealth wallet model — recommendation

| Model | Privacy | Usability | Scanning | Backup/recovery | Wallet compat | Cost | Verdict |
|---|---|---|---|---|---|---|---|
| **A. One meta-address, fresh stealth address per payment** | Good: every payment has its own address; a single meta-address is the only public artifact | Alice needs nothing new (resolve once) | Scan all announcements (+ optionally filter) | Needs the stealth key backup model | Works with EOAs | 2 txs/send | **Recommended** (standard ERC-5564 usage; smallest public surface; best understood) |
| B. Multiple reusable identities (several meta-addresses) | Marginally better compartmentalisation | Worse (Alice must choose/label; more registry entries) | More per-identity bookkeeping | More keys to back up | Works | 2 txs/send | Not recommended now |
| C. Other standard-compliant approach (e.g. derived sub-identities published per-payment) | Similar to A | Worse | Similar | Similar | Works | extra registration tx | Not recommended |

Recommendation: **Option A.** One meta-address per `.veyra` (bound to `user.id`, not to a wallet
address), a fresh stealth address for every payment, no reuse.

---

## 32. Payment scanning architecture

Ranked by privacy and honesty (Veyra must not require Bob's viewing key):

| Option | Viewing key exposure | Verdict |
|---|---|---|
| **Local scan of public announcements in Bob's client** | none — key never leaves the device | **Recommended.** Public logs are pulled (own RPC or public index); all matching done client-side. |
| Veyra-side index of public announcements (no keys) | none, but Veyra learns *when* Bob might be a recipient | Acceptable as a convenience cache; must not require keys |
| Veyra-side scanner with viewing key | **Veyra could read all Bob's payments** | Rejected by requirement |
| Third-party indexer | key custody risk / trust | Rejected |

**Can Veyra link `Bob.veyra ↔ payment X` without the viewing key?** Yes, partially, and this must be
stated rather than denied: because Veyra itself stores the public `username → meta-address` mapping
(needed for `bob.veyra` resolution), and because the chain tells Veyra nothing about which
meta-address a given announcement was for (that requires `v`), Veyra cannot link a raw announcement
by itself — **but** it can link the moment a *payment to Bob* is followed by Bob acting as a sender
or by Veyra-assisted flow data (e.g. Bob's client asking "check announcements for my meta-address").
Design rule: the scanning API must not accept or require a meta-address/username query per payment;
clients should fetch a *full* announcement range and filter locally, so Veyra cannot infer which
payments are Bob's. This is a design constraint, not a cryptographic guarantee.

---

## 33. Spending, gas funding and the sweep test

- Spending mechanics: `k = p + s'` (mod n) reconstructs a normal secp256k1 key; the stealth address
  is a plain EOA, so spending is an ordinary signed transaction (reuse Veyra's existing adapter
  pattern). No contract call required to spend.
- Gas: the stealth address has no gas unless funded. Evaluated options:

| Option | Privacy | Cost/complexity | Linkability | Choice |
|---|---|---|---|---|
| **A. Sender includes a reserve in the payment** | Best | Zero for Bob; small for Alice | Adds no new address to the graph | **SELECTED** — EIP-5564 recommends it and Lunaria implements it (0.0001 zkLTC observed) |
| B. Bob funds from another address | Mediocre | Manual | **Creates a funding link** to an address Bob controls | Fallback only |
| C. Relayer | Weakest | New infrastructure, must be trusted/paid | Relayer learns timing/links; a business dependency | Rejected (no relayer in the design) |
| D. Contract helper | Neutral | New contract; not needed for native | Contract must be trusted | Rejected |
| E. Bob keeps a small "gas jar" per stealth address | Neutral | Operational burden | Jar↔stealth links if reused | Not needed given A |

- **Sweep test (mandatory question):** using only public data, can an observer conclude `S belongs to
  B` after `S → B_main`? **Yes.** The outflow transaction publicly names `B_main` as recipient, and
  the graph `Alice → S → B_main` is complete and trivially readable. Therefore: **never sweep to a
  `.veyra`-linked or otherwise publicly-known address.** Instead, `S → T` (a fresh stealth address)
  preserves unlinkability, and spending can also be directed to a merchant/exchange deposit address
  or further stealth addresses. Veyra's documented policy must say this in the eventual UI.
- Can Veyra support `Bob.veyra → Alice.veyra` with fresh stealth addresses? Yes — that is simply the
  same one-way flow in the other direction, with roles swapped. It preserves the same properties and
  the same limitations.

---

## 34. Linkability test (attacker model, read-only)

Attacker has: Alice's address, Bob's main wallet address, all public chain data, all public Veyra
identity data, announcements, contract state. Attacker lacks: viewing key, spending key, any private
data.

| Test | Result |
|---|---|
| Address equality (stealth vs. Bob's wallets) | Negative — no equality exists by construction |
| Transaction graph (funding/spending edges into/out of `S`) | Negative for the payment itself; **positive** if Bob ever spends `S` to an address publicly linked to him (sweep) |
| Amount/timing correlation | Weak-but-real: if Alice's outbound amount is distinctive and Bob's only known balance change matches, a human can hypothesize. Not a proof of the link |
| Announcement metadata | No recipient-identifying field; **view tag alone** in native case; `S`, `R`, caller public |
| Registry state | Meta-address is public but not linked to `S` without `v` |
| Funding patterns | The sender (Alice) is public and linked to the payment by design; the recipient is not |

**Result:** with the recommended policy (no linked sweep, no reuse, sender-reserve gas), the public
record does **not** establish `payment → Bob`. It *does* establish `Alice → some fresh address`, the
amount, and the timing. The protection is **recipient unlinkability** — never "anonymity".

---

## 35. Backend visibility test (read-only)

Veyra holds: `.veyra` names, `user.id`, public meta-addresses, auth data. No viewing/spending keys.

| Test | Result |
|---|---|
| Reconstruct a `Bob.veyra → payment X` mapping from public chain data alone | **No** — matching an announcement to a meta-address requires `v`, which Veyra must never hold |
| Link via its own stored `username → meta-address` table | Only if it also correlates *client query patterns* (e.g. per-user scan requests). Mitigation: full-range scans, no per-metadata-address queries, no per-user announcement endpoints |
| Link via payment amounts/timing + auth session data (e.g. "Bob logged in at 14:02") | **Possible in principle** if Veyra correlates off-chain telemetry with on-chain timing. This is an operational-privacy limit, not a cryptographic one, and must be documented in the UI/help text |

Honest statement for the docs: Veyra cannot *read* stealth payments, but Veyra is an
identity-anchored service, so its **query pattern** is a privacy surface; the design must minimise
it and the limitation must be stated.

---

## 36. Recovery and backup model (required before UI)

| Scenario | Recoverable? |
|---|---|
| Phone lost, same wallet re-connected (deterministic signature, same derivation) | **Yes, if** derivation is deterministic and reproducible |
| Seed restore into a new device/wallet provider | **Only if** the provider reproduces the same signature byte-for-byte; cross-provider restoration is **not** guaranteed — this must be tested per wallet |
| Browser storage cleared | Yes for *keys* if they are re-derivable from the wallet; **no** for locally cached history (should be re-derivable by rescanning chain data) |
| Stealth key backup lost, wallet still present | Recoverable if derivation is deterministic; otherwise **funds are lost** |
| Wallet rotated to a new address | Old stealth keys are **not** derivable from the new wallet. Old announcements remain on chain, but without the old keys they cannot be spent. Re-registration under the same `.veyra` requires Veyra-side profile update + user-held old key backup |
| Malicious/incorrect implementation storing keys server-side | **Forbidden** — no Veyra-held secret, ever |

Requirement: the eventual UI must state plainly that *losing the stealth key loses the funds at
stealth addresses*, and offer an explicit encrypted export (viewing key + spending key) before use.

---

## 37. Identity lifecycle

- The `.veyra` name maps to `user.id`, and the meta-address is **profile data**, not the wallet.
  Wallet changes do not have to destroy the identity, but old stealth funds do require the old keys.
- Re-registration/migration: the username↔meta-address binding must be transactional and versioned;
  past payments are unaffected (they are already on chain), future resolution uses the current
  binding.
- **Username takeover / meta-address substitution is the top design-level attack:** whoever controls
  resolution controls where future payments go. Mitigations to specify: bind resolution to
  `user.id`; require wallet-signature authorisation to *change* a meta-address; show a short
  fingerprint of the meta-address to the payer; never let username expiry silently reassign a
  meta-address to a new owner while payers still have cached resolutions.

---

## 38. Security review (condensed)

| # | Risk | Impact | Mitigation required |
|---|---|---|---|
| 1 | Malicious/spam announcements | Noise, CPU on scan | Filter by view tag; treat announcement as a *hint* and confirm the actual transfer exists; cap scan ranges |
| 2 | Fake meta-address (substitution by a compromised backend or phisher) | **Theft** — Alice could pay an attacker | Wallet-signed meta-address updates; fingerprint display; optional registry read-back for verification |
| 3 | XSS / malicious extension stealing derived stealth keys | **Theft** | Keys only in memory during use; explicit encrypted export; strict CSP; never localStorage-raw |
| 4 | Malicious RPC / indexer (lying about announcements or balances) | Misdetection, head-of-line manipulation | Cross-check with a second source for *balance* before spending; local recomputation of ownership |
| 5 | Key loss | **Permanent fund loss** | Backup/export flow before first receive; clear warnings |
| 6 | Address reuse | **Retroactive linkage** | Fresh stealth address per payment, enforced in the derivation code |
| 7 | Sweep linkage | **Retroactive linkage** | Policy: never sweep to a linked address; stealth→stealth; UI warning |
| 8 | Gas funding from a linked address | Retroactive linkage | Use sender-attached reserve; never top-up a stealth address from a known wallet |
| 9 | Wallet incompatibility (SCW, non-deterministic signing) | Fund loss / unusable | Detect and refuse unsupported wallets; test determinism per wallet before enabling |
| 10 | Duplicate/replayed announcements or stale view tags | False positives | Verify on-chain transfer value/asset, not just the log |
| 11 | Incorrect view tag / invalid ephemeral key | Missed or bogus detection | Validate point prefixes/lengths (observed: 33-byte `0x02…`), ignore malformed |
| 12 | Timing/session correlation by Veyra itself | Metadata leakage | Full-range scans; no per-user announcement queries; document the limitation |
| 13 | Rollback/reset of the testnet chain | Lost testnet state | Do not develop fund-bearing expectations on testnet; no mainnet claim |

---

## 39. Corrections to Phase 2A (previous → new evidence → corrected)

| # | Previous (Phase 2A) | New evidence (Phase 2B) | Corrected conclusion |
|---|---|---|---|
| 1 | "The on-chain deployment of ERC-5564/6538 on LiteForge is not yet verified" (open blocker §19a) | Canonical announcer and registry both `is_contract:true` in tx objects, emitting standard-verified events, with ~10.5k announcements and many registrants; real `announce`/`registerKeys` calldata decoded | **Deployed, canonical and in use on LiteForge 4441.** Blocker resolved for testnet. (Raw RPC still unavailable from this environment; evidence is the chain index.) |
| 2 | Native-token announcements were expected to carry the EIP's richer metadata layout (view tag + `0xeeeeeeee` + amount) | Decoded a real announcement: metadata is **exactly 1 byte** (the view tag); Lunaria's ERC-20 metadata is 23 bytes (`viewTag‖version‖assetType‖token`), matching its contract constant | **Metadata is scheme/implementation-defined; on LiteForge the observed native format is a bare view tag, and it contains no amount.** (Good for privacy; do not build assumptions that depend on amount-in-metadata.) |
| 3 | Lunaria described as a LitVM stealth implementation listed in the ecosystem directory, with an ERC-20 router whose audit was unverified | **Router verified on-chain**: `LunariaPaymentRouter` (`is_verified`), canonical-announcer-only, ERC-20-only, gas-reserve forwarding, `ref` must be static, source states "unaudited… testnet evaluation only"; three live payments decoded; **no native-asset function** | **Implementation verified and live; native zkLTC bypasses it entirely** (no fee, no contract dependency for Veyra's native use case). Audit/derivation internals remain unverified — see §29. |

Nothing else in Phase 2A is contradicted: silent-payment privacy levels, the spend-time linkage
warning, the relayer rejection, and "not anonymous" all stand.

---

## 40. Phase 2B verdict

**B — CONDITIONAL GO** (unchanged in substance from Phase 2A, materially strengthened in evidence).

What is now verified: the standard exists on LiteForge and is used (L1); native zkLTC is a plain
value-transfer asset with the sender able to attach a gas reserve, so no approval, contract, wrapped
token or relayer is needed (L1); announcements carry no recipient-identifying data (L1); a real
implementation with verified source exists and is live (L1); Veyra's existing wallet adapter already
performs the exact transaction shape required (code-verified).

What is **not** verified, and therefore the conditions: (1) the stealth-key derivation, storage,
backup and recovery model (Lunaria SDK unpublished; signing determinism untested); (2) the client-side
scanner and spend flow (not built — out of scope); (3) wallet-class compatibility beyond EOA
(hardware/SCW not tested, SCW documented as incompatible); (4) mainnet (LitVM mainnet not available);
(5) all UI/UX privacy rules (no linked sweeps, no per-user scan queries, meta-address fingerprints,
fund-loss warnings) which are design commitments, not yet implemented code.

**GO would be wrong today** because recovery and derivation are unresolved and because two
design-level attacks (meta-address substitution, linked sweep/funding) have no implemented
mitigations yet. **NO-GO would also be wrong**: the mechanism demonstrably works on this chain with
this asset, and the remaining work is bounded, client-side, and does not require new protocols.

**Nothing was implemented. No funds were moved. No transaction was sent.**

---

# Phase 2C — Controlled stealth payment proof (added 2026-10-04)

**Status:** controlled verification. **No transaction was created or broadcast. No funds were
requested or spent. No production code, API, database table, contract or relayer was added.**
The only repository changes are documentation and one clearly-labelled research harness
(`docs/research/phase2c/stealth-lifecycle-sim.mjs`), which is not imported by the application.

**Mode actually achieved:** *OFFLINE CRYPTOGRAPHIC PROOF + REAL-CHAIN DATA VALIDATION* — the full
stealth lifecycle was executed and verified end-to-end **offline** (43/43 assertions), and every
step was cross-validated against transactions that already exist on LiteForge chain 4441.

---

## 2C.1 Test environment and the broadcast blocker (read this first)

| Item | Status |
|---|---|
| Chain | LiteForge, chain id **4441** (documented in LitVM docs; corroborated by the LiteForge explorer domain and Veyra's `config/deployments/liteforge.json`). Raw `eth_chainId` could not be issued — see below. |
| Explorer / index | `https://liteforge.explorer.caldera.xyz` (Blockscout v2 API) — reachable and used for all real-chain evidence. |
| RPC | `https://liteforge.rpc.caldera.xyz/http` — **not usable from this environment.** Egress re-tested: HTTPS fails at TLS (`SSL_ERROR_SYSCALL`), HTTP/80 returns an empty reply, and `fetch` fails outright. The available page-fetch tool cannot issue POST, which JSON-RPC requires. **RPC verification unavailable from this environment.** |
| Wallet / funding | **No funded account was available or used.** No faucet could be reached (all faucets require POST). No personal or production wallet was touched. |
| Private keys | Generated in memory only, printed nowhere, written nowhere, discarded on exit. None exist in the repository, the logs or this document. |
| Transactions broadcast | **0** — impossible from this environment. |

**Consequence:** the *on-chain* half of the requested proof (Alice signs a payment; Bob signs a
spend) could not be executed here. That is an environmental limitation, not a finding about the
mechanism. Everything else in this section was executed and verified. A networked environment with
two disposable funded testnet keys is required to complete the on-chain half (see §2C.14).

---

## 2C.2 Disposable test actors (public values from the recorded run)

| Actor | Role | Public address (recorded run) |
|---|---|---|
| Alice | sender, disposable EOA | `0x739ede2f7fe6a3fd2e6990ce2df477739b7173b7` |
| Bob — normal wallet | Bob's ordinary wallet, **never used as the recipient** | `0x568c043e6d8a3c5d988a8229e65e7ee97f0fd99e` |
| Bob — stealth identity | spending + viewing keypairs (private keys never persisted) | meta-address below |
| Observer | unrelated third party used for the negative control | `0x133b4ee4fb89d6920e379293897b556f7852b0e7` |

None of these accounts hold funds. Addresses are per-run (the script regenerates keys on every
execution; the assertions are deterministic, the values are not).

---

## 2C.3 The exact stealth key model — standard vs. vendor vs. verified

| Element | Source | Status |
|---|---|---|
| Curve `y² = x³ + 7 mod p`, `p = 2²⁵⁶ − 2³² − 977`, keys are 33-byte compressed points | EIP-5564 (L2) | standard-defined; **verified in this phase** (both keys of a generated meta-address validated) |
| Meta-address = `st:<chain>:0x ‖ P_spend(33B) ‖ P_view(33B)`, scheme id **1** | EIP-5564 / ERC-6538 (L2); on-chain usage on 4441 (L1) | standard-defined; **verified on-chain** (66-byte payload, valid prefixes, real `registerKeys(1, …)` tx) |
| Sender: random `p_ephemeral` → `P_ephemeral`; `s = p_ephemeral · P_view`; `sh = h(s)`; view tag = most-significant byte of `sh`; `P_stealth = P_spend + sh·G` | EIP-5564 §Initial Implementation (L2) | standard-defined; **verified in this phase** (ECDH symmetry + address binding, 43 assertions) |
| `h(·)` = keccak256, with the shared secret serialized as the **33-byte compressed ECDH point** | reference-implementation convention (L2/L3) | **NOT pinned by the EIP text itself.** This phase implements the mainstream convention and verifies internal consistency; the exact serialization used by any third party (including Lunaria, whose SDK is unpublished) is UNVERIFIED and is an interoperability risk |
| Recipient scan: `s' = p_view · P_ephemeral`; view-tag filter; recompute `P_spend + sh'·G` and compare addresses | EIP-5564 (L2) | standard-defined; **verified in this phase** (detection + two negative controls) |
| Spending key `p_stealth = p_spend + sh` | EIP-5564 (L2) | standard-defined; **verified in this phase** (`p_stealth·G` reproduces the stealth address exactly) |
| View tag = 1 byte; metadata may carry more | EIP-5564 says the first metadata byte MUST be the view tag | standard-defined; **observed on-chain**: LiteForge native announcements carry **only** the view tag (1 byte) |
| Lunaria's specific derivation (message signed, hash-to-scalar, storage, determinism) | vendor site (L3) | **UNVERIFIED** — SDK not published on npm; no source |

---

## 2C.4 Derivation procedure executed (and how each value was checked)

1. **Bob's keys** — `p_spend`, `p_view` from the OS CSPRNG (rejected if 0 or ≥ n);
   `P = priv·G` in 33-byte compressed form. *Checked:* both points decompress and pass
   `assertValidity()`.
2. **Meta-address** — `st:litvm:0x<P_spend><P_view>`; 66 bytes, prefixes 0x02/0x03.
   *Checked:* length, prefixes, both keys on-curve, and that it contains no wallet address.
3. **Alice's ephemeral key** — fresh random `r` per payment → `R = r·G` (33 bytes).
   *Checked:* correct length/prefix; a second payment yields a different `R` and a different `S`.
4. **Shared secret** — `s = r·P_view` (Alice) and `s' = p_view·R` (Bob). *Checked:* the two
   keccak hashes are **identical** (ECDH symmetry).
5. **Hash-to-scalar** — `sh = keccak256(s) mod n`; **view tag** = first byte.
   *Checked:* view tag is exactly 1 byte and matches on both sides.
6. **Stealth address** — `P_stealth = P_spend + sh·G`; address = `keccak256(P_stealth)[12:]`.
   *Checked:* S ≠ Alice, S ≠ Bob's normal wallet, S is not derivable from Bob's wallet address.
7. **Bob's detection** — view-tag filter, then full recomputation. *Checked:* match on the correct
   announcement; **no match** for an unrelated observer and for a wrong viewing key.
8. **Stealth spending key** — `p_stealth = (p_spend + sh) mod n`. *Checked:* `address(p_stealth·G) === S`
   — i.e. **Bob provably controls the funds cryptographically**, even though no on-chain spend could
   be broadcast from this environment.

---

## 2C.5 Announcement encoding — validated against a real transaction

The canonical announcer is `0x55649E01B5Df198D18D95b5cc5051630cfD45564` (Phase 2B: live contract).
This phase **re-encoded a real LiteForge announcement byte-for-byte** and compared it with the
on-chain calldata of tx `0xb1c9895e…6d53` (block 56,046,328):

| Field | Decoded value |
|---|---|
| selector | `0x4d1f9583` = `announce(uint256,address,bytes,bytes)` |
| schemeId | `1` |
| stealthAddress | `0x949DFA2a5CD195403CCf455625678865A8F1e0AB` |
| ephemeralPubKey | 33 bytes |
| metadata | **1 byte** = `0x9f` (view tag only) |
| total calldata | 292 bytes — **reproduced byte-for-byte from the decoded fields** |

This proves the encoding/decoding model Veyra would use is exactly what the chain executes. Note
the EIP's *recommended* richer metadata (native: `0xeeeeeeee` + placeholder address + amount) is
**not** what is used in practice on LiteForge; the observed metadata carries no amount.

---

## 2C.6 Recipient-side scan (executed, offline)

Bob scanned the announcement using **only public data plus his viewing key**, in a local script —
the viewing key never left the process. Result: **detected**, `full derivation match`; he then
recovered the stealth private key and verified it reproduces `S`. Controls: an unrelated observer
and a wrong viewing key both produced **no match** (view-tag filter miss).

---

## 2C.7 NEW FINDING — half of the sampled third-party ephemeral keys are not valid curve points

While cross-validating against real chain data, six `ephemeralPublicKey` values were sampled from
real LiteForge transactions (one native announcement, five Lunaria router payments) and checked with
**two independent implementations** (decompression in `@noble/curves`, and an independent
Legendre-symbol test written for this phase, with 6/6 agreement between them):

| Source transaction | Ephemeral key (prefix) | Valid secp256k1 point? |
|---|---|---|
| `0xb1c9895e` native announce (no payment received) | `02f0976880…` | **NO** |
| `0xe0e141eb` router payment | `02a444e65b…` | yes |
| `0x31e54b82` router payment | `02eb4f4972…` | yes |
| `0x6c0cccac` router payment — **990 lsZKLTC actually delivered** | `0265935e51…` | **NO** |
| `0xfb34518c` router payment | `028e45bc58…` | yes |
| `0x74d60e7c` router payment | `02c0411a54…` | **NO** |

*Interpretation (careful, evidence-bound):* a valid ERC-5564 ephemeral public key is always a curve
point. Three of six sampled values are not, which is statistically what one expects from
**33-byte random-looking values carrying a 0x02/0x03 prefix** rather than real public keys. The
Lunaria router contract (source-verified) validates only *length* and *prefix*, so such values pass
through. Consequence: **a standard ERC-5564 scanner cannot process those announcements** — the
ECDH step is impossible — and at least one of them corresponds to a payment whose funds were
actually delivered. The cause is unknown: Lunaria's SDK is unpublished (npm search returned no
stealth package), so its key generation, serialization and curve cannot be inspected. What is
certain is the *observable* fact and its *interop consequence*.

**Blocking implication for Veyra:** do **not** derive Veyra's implementation from Lunaria's
contracts, SDK or data; implement ERC-5564 scheme 1 independently, generate valid points, and
**validate incoming ephemeral keys** (length, prefix, on-curve) before use.

---

## 2C.8 Native zkLTC payment mechanics (verified from chain data; not executed by us)

| Question | Answer | Evidence |
|---|---|---|
| Native zkLTC is the gas token and the value asset | yes | value-carrying contract calls with `coin_transfer`; fees in the same token |
| Approval / wrapped token / ERC-20 / Veyra contract / relayer needed? | **no** to all | plain EVM value transfer to an EOA; no approval calls exist in the observed flow |
| What a payment looks like | `tx1` transfer `amount + gas reserve` to S; `tx2` `announce(1, S, R, viewTag)` | real txs; byte-for-byte calldata reproduction |
| Observed gas reserve used by the live implementation | **0.0001 zkLTC** attached as `value` | router txs `0x6c0cccac`, `0xe0e141eb`, `0x31e54b82`, `0xfb34518c`, `0x74d60e7c` |
| Gas price range observed on 4441 | ≈0.01 – 1.72 Gwei | the same transactions |
| Cost of a 21,000-gas native transfer at the worst observed price (~2 Gwei) | ≈0.000042 zkLTC | arithmetic on observed gas price |
| Cost of an announce call (28,336 gas observed) | ≈0.000057 zkLTC at 2 Gwei | decoded real tx |
| **Recommended reserve** | **0.001 zkLTC** (≈24× a worst-case spend; still negligible) | Lunaria's 0.0001 is only ~2.4× a worst-case 21,000-gas spend — thin |

---

## 2C.9 Privacy tests

| Test | Method | Result |
|---|---|---|
| Observer cannot link the announcement to Bob | offline scan with observer keys + wrong viewing key | **no match** (both controls) |
| Public graph `Alice → S → T` (T fresh, no link to Bob) | analytical, based on the verified data model | Bob is **not** identifiable from the graph; no field in the payment or announcement references him |
| Intentionally bad case `S → Bob's public wallet` | analytical | the outflow transaction names Bob's address — the relationship becomes **obvious**; this limitation is documented and must be enforced against in any future UI |
| Explorer observer test (Alice → S → Bob) | real third-party data (2B/2C): stealth addresses carry no identity link; no public mapping S ↔ owner exists | **no cryptographic link**; statistical correlation (unique amounts, timing) remains possible and is **not** claimed impossible |
| Backend visibility | Veyra holds `.veyra`, `user.id`, the public meta-address, auth data, no keys | Veyra **cannot** decode announcements. It **can** correlate operationally (per-user queries, login timing, telemetry, IP/session). Recommendation: client-side scanning, full-range announcement fetches, no per-user announcement endpoints; document the residual risk |

---

## 2C.10 Reuse tests (why both rules must be enforced)

* **Ephemeral key reuse:** demonstrated deterministically — reusing `r` yields the *same* stealth
  address and the *same* view tag, publicly linking the two payments to one recipient.
  **Production requirement: never reuse an ephemeral key.**
* **Stealth address reuse:** two payments arriving at the same `S` are trivially linkable on-chain.
  **Production requirement: one payment = one fresh stealth address.**

---

## 2C.11 Recovery model (required before any UI)

| Scenario | Verdict |
|---|---|
| Browser refresh / page reload (keys re-derivable, no state loss) | recoverable *if* keys are in memory or deterministically re-derived |
| Logout / login, cleared local storage, reopened app | recoverable **only if** derivation from a wallet signature is deterministic — **unverified** |
| Same wallet restored in the same provider | conditionally recoverable (same caveat) |
| Different wallet provider | **not guaranteed** — cross-provider signature reproduction unverified |
| New device with the same seed | conditionally recoverable (same caveat) |
| Stealth key backup lost, wallet intact | recoverable only if derivation is deterministic; otherwise **funds permanently lost** |
| Stealth key backup present | always recoverable, independent of any provider |

No recovery mechanism is invented here. **Requirement:** the derivation contract must be pinned and
tested (message, method, determinism) *and* an explicit encrypted export of both stealth keys must
exist before any UI ships; the UI must state plainly that losing the stealth key loses the funds.

---

## 2C.12 Wallet compatibility and signature count (not testable here)

| Item | Status |
|---|---|
| Veyra's current wallet path | EIP-1193 `provider.request` (`eth_sendTransaction`, `eth_getBalance`, chain add/switch) — compatible with the **send** side |
| Signing a setup message for key derivation | **not tested** (no wallet provider in this environment); determinism must be proven per wallet before use |
| Signing *from* a stealth address | **not possible with a normal wallet provider** — the stealth key is a new key; spending requires local signing with the derived key and direct RPC broadcast. This means no hardware-wallet support for spending and a different UX/security model; must be documented, not hidden |
| Smart-contract wallets (ERC-1271, multisig, AA) | **incompatible** with signature-derived stealth roots (no private key exists) — must be detected and refused rather than silently mis-supported |
| Signature count — Alice, native payment | **2 confirmations** (transfer + announce). A bundling helper does not exist for native zkLTC; the ERC-20 router bundles but is out of scope and carries a fee |
| Signature count — Bob, receive | 0 |
| Signature count — Bob, spend | 1 (local key, direct broadcast) |
| Signature count — Bob, first-time setup | 0 or 1 (1 only if signature-derived keys are adopted — unverified) |

---

## 2C.13 Failure and hostile-input handling

| Case | Behaviour verified / required | Funds at risk? | Privacy at risk? | Mitigation |
|---|---|---|---|---|
| Malformed ephemeral key (bad prefix / not on curve / truncated) | **verified**: rejected without crashing | no | no | validate length/prefix/on-curve before ECDH |
| Announcement with no payment | detected in the wild (2B); scanner must verify the actual transfer | no | no | treat announcements as hints; confirm balance/transfer |
| Wrong view tag / wrong scheme id | **verified**: ignored | no | no | filter before expensive math |
| Duplicate announcement | **verified**: idempotent | no | no | dedupe by (tx, log index) |
| Reused stealth address / ephemeral key | **verified**: linkable | no | **yes** | enforce freshness in code |
| Insufficient gas reserve | not executed; arithmetic shows 0.0001 can be marginal | **yes** (stuck funds) | no | reserve ≥0.001; surface a warning |
| Wallet signature failure / non-deterministic signing | not testable here | **yes** (unrecoverable keys) | no | test per wallet; offer key export |
| RPC / indexer failure, reorg, rollback | not tested | no (chain state is authoritative) | no | rescan; never trust a single indexer for spending decisions |
| Corrupted local key state | reasoned | **yes** if the only copy is lost | no | encrypted export; multiple backups |
| Meta-address substitution (compromised resolution) | not executed | **yes** (payment to attacker) | yes | wallet-signed meta-address updates + fingerprint display |

---

## 2C.14 What remains to be executed (to close the on-chain half)

1. Run in an environment with network egress; generate two disposable keys (Alice, Bob).
2. Fund both from the LiteForge testnet faucet (small amount; never real funds).
3. Execute: Alice → S (native value + reserve) and `announce(1, S, R, viewTag)`; record hashes.
4. Run the scanner locally (this script's logic) against the live announcement stream; confirm
   detection; derive the stealth key; spend a small amount from S to a fresh address T; never to a
   wallet linked to Bob.
5. Re-run the linkability test with an independent party (and with Veyra's backend perspective) and
   record the result.
6. Prove signature determinism for at least the two wallet classes Veyra intends to support.

**Evidence quality:** all real-chain facts in this section are L1 (chain index, verified contract
source, plus this phase's independent keccak and curve math). The EIP algorithm is L2. Lunaria's
derivation is L3 and remains unverified. No L3–L5 source is used to assert an L1 fact.

---

## 2C.15 Phase 2C verdict

**B — CONDITIONAL PASS.** The complete cryptographic lifecycle (meta-address → derivation → payment
encoding → announcement → scan → detection → stealth-key control) is **proven and verified offline
with 43/43 assertions**, and every step is cross-validated against real LiteForge data. The on-chain
transaction half could **not** be executed from this environment (no network egress, no funded
disposable account, no broadcast capability), and a new third-party interop defect was discovered.
Phase 2 implementation must not start until the blockers in the report are cleared.

# Phase 2D — Networked-validation attempt, exact serialization pin, and key-recovery specification (added 2026-10-04)

**Outcome of this phase: INCOMPLETE BY ENVIRONMENT — verdict B (CONDITIONAL PASS).** The networked
testnet half of the brief (fund disposable accounts, Alice → stealth address, announcement, Bob
detection, Bob → fresh destination spend, observer tests) **could not be executed**: this
environment has no usable outbound network path for JSON-RPC. The live portion is therefore
**STOPPED**, exactly as the brief requires, and reported as blocked. Everything below is either
(a) an exact cryptographic specification pinned against the canonical third-party implementation,
(b) a re-validation against already-public LiteForge data, or (c) an explicit statement of what
remains unproven. **No transaction hash in this section exists; no transaction was created, signed
or broadcast; no testnet funds were obtained; no disposable accounts were created.**

---

## 2D.1 Network capability (brief §2) — what is blocked and how it was proven

| Probe | Result |
|---|---|
| `curl https://example.com` (generic HTTPS) | **FAIL** — TCP connects, TLS aborts (`SSL_ERROR_SYSCALL`, curl exit 35) |
| `curl` to LiteForge RPC host, GET and POST | **FAIL** — same TLS abort |
| Node `fetch()` to any https origin | **FAIL** |
| Raw JSON-RPC POST (required for all chain state and broadcast) | **IMPOSSIBLE** — transport blocked |
| `gh api` (GitHub REST) | **WORKS** — used to read public source code |
| `fetch_page` tool | **WORKS** — used for read-only web/Blockscout API reads |

**All five required JSON-RPC methods are blocked at the transport layer**: `eth_chainId`,
`eth_getBalance`, `eth_getTransactionCount`, `eth_estimateGas`, `eth_sendRawTransaction`.
The mandatory statement therefore applies: **“RPC verification unavailable from this
environment.”** There is no broadcast path, no faucet access and no funded disposable account.
The live/networked portion of Phase 2D is stopped; nothing was faked, and no hash was invented.

## 2D.2 Testnet transaction evidence (brief §3 / §22) — NONE

No payment transaction, no announcement transaction, no spend transaction, no destination wallet,
no test accounts and no funds. The read-only explorer API was used **only** to re-verify public
data (2D.3, 2D.7). This is explicitly **not** a substitute for the required live proof, and the
brief's stop condition (broadcast unavailable) is triggered and reported.

## 2D.3 Exact scheme-1 serialization (brief §5 — CRITICAL)

EIP-5564 fixes the *shape* of scheme 1 (`s = r·V`; `h = keccak(s)`; view tag = most-significant
byte of `h`; `P_stealth = P_spend + h·G`; `p_stealth = p_spend + h mod n`) but does **not** pin the
byte serialization of the ECDH shared point, the byte→scalar rule or the address rule. Two
“conforming” implementations can therefore derive different stealth addresses from identical
inputs. The convention below was **read from the canonical open-source implementation**
(`@scopelift/stealth-address-sdk` 1.0.0-beta.5 — `src/utils/crypto/generateStealthAddress.ts`,
`computeStealthKey.ts`, `checkStealthAddress.ts`, `src/utils/helpers/generateKeysFromSignature.ts`,
fetched from GitHub on 2026-10-04) and is now **pinned by test** in
`docs/research/phase2d/stealth-serialization-pin.mjs`:

1. **ECDH shared secret** = the shared point serialised **compressed, 33 bytes (prefix 02/03)**;
   `keccak256(33-byte compressed)`. Uncompressed (65 B) and x-only (32 B) serialisations produce
   *different* hashes — proven by assertion A15. This is the single most important interop pin.
2. **View tag** = first byte of the hash (upstream test vector `0x158ce29a…` → `0x15`, assertion A18).
3. **Hash→scalar**: keccak output read big-endian and reduced mod n. The reduction is a no-op
   except with probability < 2⁻¹²⁸; the canonical implementation relies on the same effective rule.
4. **Stealth point**: `P_stealth = P_spend + h·G`; **stealth key**: `p_stealth = (p_spend + h) mod n`;
   verified `p_stealth·G == S` byte-for-byte, including the mod-n wrap case (assertions A20–A23).
5. **Address rule**: `address = keccak256(uncompressed pubkey x‖y)[12:]` (standard EVM derivation;
   cross-checked against viem's own `privateKeyToAddress`, assertions A02–A05, A24).
6. **Meta-address**: 66 bytes, `spendPub(33)‖viewPub(33)`, both compressed. The reference SDK also
   tolerates a 33-byte single-key form (spend == view); **Veyra MUST refuse that form** because a
   shared viewing key would double as spending capability (assertions A10–A12).
7. **Announcement**: selector `0x4d1f9583`; the observed LiteForge native convention for
   `metadata` is **the 1-byte view tag only** (no amount, no token). Re-verified byte-for-byte
   against real chain calldata (assertions A27–A28).
8. **Recovery derivation** (community convention, §2D.8):
   `spendPriv = keccak256(sig[0:32])`, `viewPriv = keccak256(sig[32:64])`, signature **must** be
   exactly 65 bytes (r‖s‖v); the v byte is not used in derivation (assertions R01–R11).

**Correction to the Phase 2C harness (found in 2D):** the 2C research harness derived addresses by
hashing whatever key encoding it was given, which produced *non-standard* address strings for
compressed inputs (the ECDH/keccak/scalar math and every 2C conclusion were unaffected; only the
“address” strings were wrong). The 2C harness is corrected in place and now re-runs **44/44 PASS**;
its recorded result was 43/43 at delivery time. The 2D harness regression-pins the correct rule.

**Harness result (2D):** `stealth-serialization-pin.mjs` — **49/49 PASS, exit 0** (A01–A34
serialization, R01–R12 recovery, G01–G03 gas arithmetic).

## 2D.4 Alice → stealth address (not executed — specified)

One fresh ephemeral key `r` per payment; `S` derived exactly as 2D.3-4; a **native zkLTC** transfer
to `S` (no ERC-20, no approval, no wrap, no contract call, no mixer, no shielded pool, no custody,
no new contract). One payment = one fresh `S` (offline proof: fresh `r` ⇒ fresh `S`, fresh tag,
fresh `R`). Recorded evidence in a real run would be `{txHash, S, amount, R, viewTag, block}`;
none exists because broadcast is blocked. Funding arithmetic is pinned (G01–G03): a 21,000-gas
native spend costs `0.000021` zkLTC at 1 Gwei; the recommended `0.001` zkLTC reserve sustains 47
such spends at 1 Gwei and must warn/refuse at prices where a single spend exceeds the reserve
(> ~47.6 Gwei).

## 2D.5 Bob local scanning (logic proven offline; not executed on-chain)

Filter by `schemeId == 1`, validate `R` (length, 02/03 prefix, on-curve), check the view tag, then
ECDH with the **viewing key on the client only** and recompute the candidate stealth point/address;
match ⇒ payment is Bob's. The viewing key is never sent to any backend. Controls proven offline:
correct key detects; wrong viewing key does not; an unrelated observer does not; unsupported
schemeId is ignored; a wrong view tag is filtered before the expensive step. **Hostile input:** a
real on-chain `ephemeralPublicKey` that is not a valid curve point is rejected without crashing and
without a false match (assertions A29–A30). The 2C finding stands: **3 of 6 sampled real
on-chain ephemeral keys were not valid secp256k1 points**; scanners must reject them, and senders
must never announce an unvalidated `R`.

## 2D.6 Bob → fresh destination spend (not executed — key side pinned)

`p_stealth = (p_spend + h) mod n`; `p_stealth·G == S` is proven; spending is a native zkLTC
transfer `S → T` where `T` is fresh and **never** Bob's normal wallet. The derived key must be
reconstructed in the client (memory) and used to sign locally; the key must never be sent to a
server. Hardware wallets cannot sign from `S` unless they can import a raw key — spend is therefore
a software-key operation (documented limitation, §2D.10).

## 2D.7 Privacy observations as an external observer (no on-chain experiment possible)

Structure (what each party can see), with the explicit terminology rule:
**this is recipient-address privacy / recipient unlinkability — NOT anonymity.**

* **Public:** sender address, amount, timing, the payment transaction, the stealth address `S`, the
  announcement (schemeId, `S`, `R`, view tag, caller), the eventual spend, and gas funding.
* **Hidden:** the link `payment → Bob's normal wallet` / `→ bob.veyra`. That is the entire privacy
  claim, and it holds only until a linkable action (sweep to a linked wallet, reuse, correlation).
* **Test A** (observer cannot identify Bob's wallet from `Alice → S`): expected YES hidden;
  **not executed on-chain** (blocked); consistent with all public data reviewed.
* **Test B** (`S → fresh T`): expected to preserve unlinkability; **not executed** (blocked).
* **Test C** (`S → Bob's normal wallet`): destroys unlinkability by construction (documented as a
  deliberate negative control, not performed).
* **Amount/timing correlation**, **ephemeral-key reuse**, **address reuse**, **gas-funding
  linkage**, **backend telemetry**, **indexer surveillance** are all real and are itemised in
  §2D.13.

## 2D.8 Key-recovery specification (brief §12)

**Determination:** the stealth spending/viewing roots **can be deterministically re-derived from an
EIP-1193 message signature** using the canonical convention (not an invented scheme), *and* an
encrypted backup is still required. This is **specified here but NOT demonstrated** (no wallet,
no network in this environment) — it must **not** be claimed solved until demonstrated and
falsification-tested.

* **Root derivation:** wallet signs a canonical message; signature must be exactly 65 bytes
  (r‖s‖v); `spendPriv = keccak256(r)`, `viewPriv = keccak256(s)`; both must be valid non-zero
  scalars; public keys must be valid compressed points; meta = `spendPub‖viewPub`.
* **Exact signed message / domain (spec v1, frozen with test vectors before implementation):**
  `"Veyra stealth identity v1\nusername: <username>\nchainId: 4441\ndomain: veyra.identity"`,
  signed with `personal_sign` (EIP-191) or the equivalent EIP-712 domain-bound typed data — the
  wallet-class decision must be validated per wallet (§2D.10). Versioning: any change ⇒ `v2`, never
  silent.
* **Chain + username binding:** proven — changing `chainId` or `username` changes the derived keys
  (R07/R08). **Wallet binding:** keys are bound to the signing key; a different seed/wallet derives
  different keys for the same username ⇒ the client **must** verify the re-derived meta-address
  against the pinned fingerprint before use (R09/R10 hazard: a different valid signature over the
  same message derives *different* keys — silent divergence would be fund loss).
* **Replay/phishing:** anyone obtaining the signature can re-derive the keys ⇒ the signature is
  secret-equivalent: never log, never transmit, never store; display the exact message before
  signing; consider EIP-712 for readable consent.
* **Encrypted backup (primary durability, required at enrollment):** versioned blob containing
  `{spendPriv, viewPriv, username, chainId, metaFingerprint, version}` encrypted with an AEAD
  (AES-256-GCM or XChaCha20-Poly1305) under a key derived from a user passphrase via a memory-hard
  KDF (Argon2id/scrypt); stored locally and optionally server-side as an **opaque** blob the server
  cannot decrypt. Recovery = decrypt in the browser. Wrong passphrase ⇒ authenticated failure, no
  partial state. Corrupted blob ⇒ refuse loudly, never silently regenerate.
* **Failure behaviour:** if neither re-derivation (fingerprint match) nor backup decrypts, the funds
  at existing stealth addresses are **permanently lost** — the UI must say so verbatim.

| Scenario | Recoverable? | How | Requirement |
|---|---|---|---|
| A cleared browser storage, wallet present | Yes | re-derive + fingerprint check | deterministic signing |
| B reinstall, wallet seed available | Yes | re-derive + fingerprint check | deterministic signing |
| C same wallet, same device | Yes | re-derive | — |
| D same wallet, other device | Yes | re-derive (same seed) + fingerprint check | deterministic signing |
| E other wallet provider | Only if same private key imported | re-derive + fingerprint check | deterministic signing |
| F seed-phrase restore | Yes | restore wallet → re-derive + fingerprint check | deterministic signing |
| G wallet seed lost, no backup | **No — permanent loss** | — | backup is mandatory |

## 2D.9 Meta-address authentication (brief §13)

**Threat:** substitution of the meta-address served for `bob.veyra` ⇒ payments to an attacker,
irreversible. Username is **permanent** (no rename, no transfer).

**Specified model:** (1) immutable username; (2) enrollment generates spend/view keys and registers
a **versioned signed record** — signed by a **dedicated stealth-identity signing key (SISK)** that
is published with the record and is *not* the user's normal wallet key (no wallet-address leakage);
(3) the username↔SISK binding is established at enrollment by a wallet signature over
`{domain, username, chainId, meta-address, version}` and preserved in the user's encrypted backup
(and server-side only as required record data), so the legitimate owner can prove/repair it;
(4) clients display a **fingerprint** (first 4 bytes of `keccak256(meta)`, 8 hex chars) and **pin it
on first use**, warning loudly on any change; (5) updates require `version+1`, a new signed record
and a cool-down/notification — **no silent updates**; (6) high-value senders should verify the
fingerprint out-of-band.

**Residual trust (stated plainly):** at *first* resolution a malicious identity backend could serve
a substituted record and a matching SISK; only out-of-band fingerprint verification (or an optional
on-chain registration, which links a fresh address on-chain and is therefore weaker for privacy)
closes that gap. Substitution is therefore **mitigable to a defined residual risk — NOT fully
solved**; it is reported as such and must not be described as solved.

## 2D.10 Wallet compatibility (brief §14)

| Wallet class | Sign for derivation? | Hold/spend stealth funds? | Verdict |
|---|---|---|---|
| EOA, browser (EIP-1193) | Yes, if the 65-byte signature form and deterministic (RFC-6979) signing are confirmed | Yes, via locally reconstructed key (software) | **Supported with fingerprint check** |
| EOA, hardware | Yes (message signing), device/chain support dependent | **No** — cannot import a raw derived key unless the device supports it | Supported for enrollment; spend limitation documented |
| Smart-contract wallet (ERC-1271 / ERC-4337) | **No** — no plain 65-byte ECDSA signature | No — the stealth address is EOA-style; SCW cannot control it natively | **DETECT AND REFUSE** at enrollment (clear message; never silently broken) |
| Multisig | No — not a single 65-byte signature | No | **DETECT AND REFUSE** |
| Any wallet returning 64-byte compact (ERC-2098) signatures | **No** as-is | No | Refuse / request the standard 65-byte form (R11) |

## 2D.11 UX confirmation counts (brief §15)

* **Alice (native path, no relay):** 2 wallet approvals, 2 on-chain confirmations — (1) native
  transfer to `S`, (2) `announce()` call by Alice's own wallet. If the two are ever combined into one
  transaction it requires a contract (out of scope this phase); the UI must not pretend they are one.
* **Bob:** 0 confirmations to *receive* (scanning is local); 1 message signature at enrollment;
  1 wallet approval + 1 confirmation to spend.
* Never hide multiple confirmations behind a single misleading dialog.

## 2D.12 Failure tests (brief §16)

Legend: **OBS** = observed in the offline harnesses / existing public chain data; **SPEC** =
specified (implementation must enforce); none of these were executed on-chain.

| # | Scenario | Expected | Evidence | Production handling |
|---|---|---|---|---|
| 1 | Alice balance too low | tx rejected pre-broadcast | SPEC | pre-flight balance check; clear error; no partial state |
| 2 | Insufficient gas for spend | OOG revert | SPEC | estimate + reserve warning; refuse to sign |
| 3 | Malformed `R` (bad prefix / truncated / x-not-on-curve) | skip, no match, no crash | **OBS** (A29–A30; real invalid key) | validate `R` before any ECDH; count and continue |
| 4 | Unsupported schemeId | ignored | **OBS** (2C) | filter `schemeId == 1` |
| 5 | Incorrect view tag | filtered early | **OBS** (2C) | tag check before ECDH |
| 6 | Duplicate announcement | idempotent | **OBS** (2C) | dedupe by (txHash, logIndex) |
| 7 | Duplicate stealth address (reuse) | publicly linkable | **OBS** (reuse demo) | one-time ephemeral key enforcement; warn on reuse |
| 8 | Wallet signature rejected by user | no keys derived | SPEC | abort cleanly; never fall back to a weaker path |
| 9 | Non-deterministic wallet signature | different keys | **OBS** (R09–R10) | fingerprint check; refuse spend; restore from backup |
| 10 | 64-byte / SCW signature | refused | **OBS** (R11) | “unsupported wallet class” at enrollment |
| 11 | RPC failure mid-flow | unknown tx state | SPEC | never blind-retry; re-check by hash/nonce; explicit state |
| 12 | Indexer delay | announcement not visible yet | SPEC | backoff retries; no false “not received” |
| 13 | Tx dropped/replaced/reorg | settlement uncertain | SPEC | confirmations policy; rebroadcast with new nonce; re-derive |
| 14 | Corrupted local stealth state | cannot spend | SPEC | restore from encrypted backup; fingerprint verify; never regenerate silently |
| 15 | Meta-address mismatch/substitution | payment to attacker | SPEC | pinning + versioned signed records (§2D.9); residual TOFU risk stated |
| 16 | Ephemeral-key reuse by sender | linkability | **OBS** (reuse demo) | fresh `r` per payment, enforced client-side |
| 17 | Announcement without a payment (spam) | no funds at `S` | **OBS** on-chain (2C/2B) | verify balance at `S` before reporting “received” |
| 18 | Sweep to a linked wallet | public link | SPEC (structural) | discourage; default to `S → fresh T`; explicit warning |

No failure path may silently lose funds; every path above must surface state to the user.

## 2D.13 Threat model (brief §17)

**Public:** sender, amount, timing, transaction, stealth address, announcement, eventual spend,
gas-funding trail. **Hidden:** the link from the payment to the recipient's normal wallet /
`.veyra` identity. **Explicit:** recipient-address privacy / recipient unlinkability — **not
“anonymity”**, never described as perfect.

Attack surfaces: (i) amount correlation — unique amounts are a fingerprint; (ii) timing
correlation — payment announced/submitted in the same block pattern reveals the app; (iii) address
reuse — same `S` for two payments links them; (iv) ephemeral-key reuse — repeats `S` and tag;
(v) sweep-to-main linkage — the single biggest unlinkability break; (vi) gas-funding linkage — the
address that funds the spend can reveal Bob; (vii) backend telemetry — the identity backend sees
`bob.veyra` resolutions and can correlate with announced payments even without viewing keys;
(viii) compromised device — keys plus backup passphrase ⇒ total loss; (ix) compromised viewing key
— reveals which payments are Bob's (not the spend authority); (x) malicious frontend — can exfiltrate
the viewing key/meta-address; (xi) malicious metadata / indexer surveillance — spam and ordering
attacks; scanners must be robust and rate-limit-tolerant. Each is mitigated only by the client-side
rules specified here; on-chain there is no mitigation, and this must be stated to users.

## 2D.14 Remaining blockers (brief §18)

1. **No networked execution possible from this environment** — the entire live lifecycle
   (Alice → `S` → announcement → Bob → `S` → `T`) is unproven on-chain. This is the phase blocker.
2. **Recovery not demonstrated** with a real wallet; specification only (§2D.8).
3. **Meta-address substitution not fully solved** — TOFU residual at first resolution (§2D.9).
4. **No scanner/stealth-wallet implementation** exists (out of scope; the harness only proves logic).
5. **LiteForge native metadata convention** observed as view-tag-only; Veyra must define its own
   canonical metadata and validate `R` on the sending side (Lunaria's unvalidated-key behaviour
   must not be reproduced). Lunaria internals remain **UNVERIFIED** (no source, no npm package).
6. **Wallet-class determinism untested empirically**; refusal rules are specified, not exercised.

**Phase 2D verdict: B — CONDITIONAL PASS.** The crypto specification and serialization are pinned
and validated offline against the canonical implementation and real chain data; the required
networked testnet proof is **blocked by the environment and is reported as not executed**. The
phase is not marked passed. No production implementation was started; no contract, API, UI, DB or
wallet behaviour was changed. Research artifacts: `docs/research/phase2d/stealth-serialization-pin.mjs`
(49/49 PASS) and the corrected `docs/research/phase2c/stealth-lifecycle-sim.mjs` (44/44 PASS).

# Phase 2E — Live LiteForge testnet validation (added 2026-10-04)

**Status: BLOCKED — not executed.** The environment in which this phase was attempted has **no
outbound egress to the LiteForge RPC**. Every required JSON-RPC method fails at the transport layer
(TLS handshake reset, `OpenSSL SSL_connect: SSL_ERROR_SYSCALL`), so the live lifecycle could not be
run. Per the brief, the networked portion was **stopped rather than simulated**:
**no account was funded, no transaction was created, signed or broadcast, and no transaction hash
exists in this section** — none is invented. What was delivered instead is a complete, offline-
verified execution package plus the verification results that *can* be obtained here.

---

## 2E.1 Environment (what is blocked and how it was proven)

| Probe | Result |
|---|---|
| DNS for `liteforge.rpc.caldera.xyz` | resolves (IPv6/IPv4) |
| TLS handshake to the RPC host | **fails** — `unexpected eof while reading`, 0 bytes read |
| `eth_chainId`, `eth_getBalance`, `eth_getTransactionCount`, `eth_estimateGas`, `eth_sendRawTransaction`, `eth_getTransactionReceipt`, `eth_getLogs` | **all blocked at transport** |
| Generic HTTPS control (`https://example.com`) | **fails** (same TLS reset) — not RPC-specific |
| Allowlisted egress that does work | `registry.npmjs.org`, `api.github.com` only |
| Read-only explorer API via an out-of-sandbox fetcher | **works** (used for read-only corroboration only) |

No attempt was made to circumvent the egress controls. The environment cannot broadcast, therefore
the mandated statement is: **"PHASE 2E LIVE VALIDATION BLOCKED — NETWORK EGRESS UNAVAILABLE."**

Read-only corroboration obtained (explorer, 2026-10-04): gas prices slow 0.44 / average 0.49 /
fast 1.05 Gwei; average block time **227 s**; previously recorded transactions remain queryable
(e.g. announce tx `0xb1c9895e…` still `status: ok` at block 56,046,328, 292-byte calldata
unchanged) — i.e. the chain is intact and the 2B/2C evidence is still valid.

## 2E.2 Exact test configuration prepared

The lifecycle is fully scripted in `docs/research/phase2e/live-lifecycle.mjs` (research tooling; not
wired into the application) with a shared pinned-primitives module
`docs/research/phase2e/lib/stealth.mjs`:

| Setting | Value |
|---|---|
| Chain | 4441 / `0x1159` — the script **refuses any other chain id** |
| Asset | native zkLTC (no ERC-20, no wrap, no approval) |
| Scheme id | 1 |
| Announcer | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` |
| Payment | `0.001` zkLTC (overspend guarded; Alice funded ≥ 0.0025) |
| Message format | `announce(uint256,address,bytes,bytes)`, metadata = 1-byte view tag |
| Confirmations | payment 3, announcement 1, spend 1 (flags to change) |
| Actors | Alice, Bob (normal wallet + separate spend/view keys, 66-B meta-address), Observer, fresh T |
| Key custody | `~/.veyra-phase2e/keys.json`, mode 0600, refuses in-repo paths; secrets redacted from all output; leak guard blocks any results file containing secret material |

## 2E.3 Transaction lifecycle (planned; NOT executed)

```
Alice ──0.001 zkLTC──▶ S        [payment]      NOT BROADCAST
Alice ──announce(1,S,R,tag)──▶ announcer        NOT BROADCAST
Bob   ──local scan (viewing key client-side)──▶ detect S
Bob   ──p_stealth = (p_spend + h) mod n──▶ S ──native──▶ fresh T   [spend]  NOT BROADCAST
```
Every command refuses to treat an unconfirmed transaction as received, and the `pay` step aborts
unless `p_stealth·G == S` verifies locally *before* the transfer.

## 2E.4 Cryptographic derivation (verified offline — 48/48)

`live-lifecycle.mjs dry-run` executes 48 assertions with **zero network and zero key files**:
48/48 PASS, exit 0. It re-proves, in the same code path the live run uses: the address rule (and the
divergence of the wrong rules), 66-byte two-key meta-address construction and single-key refusal,
ephemeral-key validation (bad prefix / off-curve / truncated / all-zero / the real on-chain invalid
key), stealth derivation `p_stealth·G == S`, ECDH symmetry, view-tag rule, freshness vs reuse,
announcement selector + metadata + **byte-for-byte reproduction of a real LiteForge `announce()`
calldata**, meta-address substitution detection, recovery-model determinism and binding, the AEAD
backup round trip, and funding/gas arithmetic. The two cryptographic primitives embedded in the
browser probe were independently validated against `@noble/curves`/`viem` (12/12 scalars, 7/7 keccak
vectors including 135/136/137-byte padding edge cases).

## 2E.5 Payment transaction — **NONE**

No hash. No amount moved. Offline evidence for the payment step is limited to derivation, address
validation and gas arithmetic; the on-chain payment remains **unproven**.

## 2E.6 Announcement transaction — **NONE**

No hash, no event emitted. The only announcement evidence remains Phase 2B/2C's *reading* of
third-party announcements plus the byte-for-byte calldata reproduction — not a Veyra announcement.

## 2E.7 Bob scan — logic proven offline, not run on real chain data

The scan path (validate R → scheme filter → view tag → ECDH with the viewing key → derive candidate
S → compare) passes with the positive case and all negatives (Alice's key, observer, random viewing
key, wrong tag, invalid R, unsupported scheme, wrong S, duplicate). In the CLI both roles run
locally; the design requires the indexer to serve **public fields only** — the viewing key never
leaves the client. The live scan of a *real Veyra announcement* is unproven.

## 2E.8 Bob spend — derivation proven offline, not executed

`p_stealth·G == S` is proven in-process and in the dry run. The actual spend `S → fresh T` with a
native transfer signed by the derived key is **unproven**. The script asserts T is fresh and is not
Bob's normal wallet, Alice, the observer or S before sending.

## 2E.9 Privacy analysis (structural; no live observation possible)

| Information | Public? | Reveals Bob? |
|---|---|---|
| Sender (Alice) | YES | NO |
| Amount | YES | NO |
| Timing | YES | POSSIBLY CORRELATABLE |
| Stealth address S | YES | NO DIRECT LINK |
| Ephemeral key R | YES | NO DIRECT LINK |
| Announcement | YES | NO DIRECT LINK |
| Bob normal wallet | SHOULD REMAIN HIDDEN | — |
| S → fresh T | YES | NO DIRECT LINK |
| S → Bob normal wallet | YES | **YES / LINKED** (privacy-breaking control) |

**The claim is recipient-address privacy / recipient unlinkability — not anonymity.** Bob's normal
wallet is never funded and never appears in the payment path, so no gas-funding link exists; the
only structural link is a future sweep into a wallet already tied to Bob (which is why auto-sweeping
is forbidden). The live test (Tests A/B/C in the brief) remains **unexecuted**.

## 2E.10 Recovery — local model verified; real-wallet behaviour pending

Recovery tests executed here (local signer, disposable key): identical input → byte-identical
signature (RFC-6979); derived roots and meta-address reproducible; cleared-state, restored-wallet,
alternate-wallet, altered-username, altered-chain-id and wrong-message scenarios all behave as
specified (mismatch detectable); 64-byte compact signatures refused; AES-256-GCM + scrypt backup
round-trips and fails closed on a wrong passphrase; the backup blob contains no plaintext key
material. **Not verified: real browser-wallet determinism** — that requires an actual wallet and is
prepared as `docs/research/phase2e/sign-check.html`, an offline page that signs the canonical message
twice, refuses the compact form, and prints only the public meta-address fingerprint. The
Phase 2D conclusion stands: the mechanism is **specified and locally validated, not yet demonstrated
against a real wallet**.

## 2E.11 Wallet compatibility — specified, not empirically confirmed

EOA (EIP-1193): supported with fingerprint pinning. Hardware wallets: enrollment only — they cannot
sign from the derived stealth key without raw-key import, a limitation that must be disclosed.
Smart-contract wallets, multisig and ERC-2098 compact signers: **unsupported — must be detected and
refused** rather than silently broken. The browser probe is the empirical test for the derivation
half of this matrix.

## 2E.12 Failure tests — offline battery verified; live-safe tests prepared

Offline (all pass): malformed R (bad prefix, off-curve, truncated), unsupported scheme id, wrong view
tag, wrong stealth address, duplicate announcement idempotence, incorrect recovery signature,
fingerprint mismatch, meta-address mismatch/substitution. Prepared for the networked run (recorded
as EXPECTED / OBSERVED / PRODUCTION RESPONSE): insufficient balance and cannot-pay-gas (pre-flight
estimation only — **nothing is broadcast**), RPC failure, announcement-without-payment, indexer
delay/stale data. Not injectable on a live testnet: genuine reorg, transaction replacement and a
public-network RPC outage; policy is specified (treat unconfirmed as pending, re-check by hash and
nonce, never conclude absence from a single empty query).

## 2E.13 Confirmation behaviour (measured from the public chain)

Average block time ≈ 227 s ⇒ ~4 min per block, ~11 min for a 3-confirmation payment. Policy: **3
confirmations before reporting PAYMENT RECEIVED**; 1 confirmation for announcement indexing; the UI
must never report a pending transaction as received. Observed gas prices at authoring time: 0.44 /
0.49 / 1.05 Gwei (slow/average/fast); real 21,000-gas transfer ≈ 0.000009–0.000022 zkLTC at those
prices, which the 0.001 payment comfortably covers for Bob's spend.

## 2E.14 Remaining risks and blockers

1. **The entire live lifecycle is unproven** — no payment, announcement, detection or spend on a
   real chain. This is the phase's blocker and the reason for the verdict below.
2. **Real-wallet signing determinism is untested**; if a wallet is non-deterministic, the
   signature-derived identity is unusable and the encrypted backup becomes mandatory.
3. **Meta-address substitution** remains mitigable-but-not-eliminated (first-resolution TOFU), as
   specified in §2D.9.
4. **Wallet-class refusals** (SCW/multisig/compact) are specified but not exercised against real
   wallets.
5. **Lunaria remains a non-dependency and unverified**; Veyra's implementation validates R and
   rejects the malformed-key acceptance observed in the wild (3 of 6 sampled on-chain ephemeral keys
   were not valid curve points).

**Phase 2E verdict: C — BLOCKED** (network egress unavailable ⇒ live validation impossible).
The package that executes it is complete and offline-verified (48/48), so the phase can be finished
in one sitting from any networked host.

**Artifacts:** `docs/research/phase2e/README.md` (execution procedure),
`docs/research/phase2e/live-lifecycle.mjs` (orchestrator), `docs/research/phase2e/lib/stealth.mjs`
(pinned primitives), `docs/research/phase2e/sign-check.html` (real-wallet probe),
`docs/research/phase2e/results/` (public results, leak-guarded).

---

# Phase 3 — Production implementation (added 2026-10-06)

This section documents what is now implemented in the repository. It does not
supersede §2C–§2E: the Phase 2D serialization and derivation rules are implemented
verbatim, and the Phase 2E live-validation status is unchanged.

**Live LiteForge end-to-end validation remains pending.**

## 3.1 What was built

| Layer | Files | Notes |
| --- | --- | --- |
| Client crypto (dependency-free ESM, no bundler, no CDN) | `src/stealth/keccak.js`, `secp256k1.js`, `scrypt.js` | Hand-rolled and cross-verified against `viem`, `@noble/curves` and `node:crypto` in tests; production code never depends on them. |
| Protocol | `src/stealth/protocol.js`, `derive.js`, `announcement.js`, `recovery.js`, `backup.js` | Scheme 1, 33-byte compressed keys, meta-address = 66-byte `spend‖view`, single-key form refused, view tag = first byte of `keccak256(compressed ECDH point)`. |
| Local signing | `src/stealth/signer.js` | RFC 6979 deterministic ECDSA (low-s, recovery id), RLP + EIP-155 legacy and EIP-1559 type-2 native-transfer serialization, `eth_sendRawTransaction` broadcast. Byte-compared against `viem` in tests. |
| Orchestration | `src/stealth/transferState.js`, `wallet.js`, `privateTransfer.js` | Explicit state machine (including `announcement_submitting`), wallet capability gates, amount/funding checks, announcement-retry path. |
| Server | `server/private-transfer.js`, `api/private-transfer/[route].js` | Public material only; curve-validated; rate-limited; unfiltered announcement pages; no per-user route. |
| Database | `db/schema.sql` (Phase 3 block) | `private_transfer_identities`, `private_transfer_announcements`, `private_transfer_payments`, `private_transfer_attempts`. Additive `CREATE TABLE IF NOT EXISTS`; no private-key and no wallet-address column. |
| UI | `src/ui/PrivateTransferPanel.js`, `src/systems/PrivateTransferSession.js`, `styles/private-transfer.css`, `index.html` (`#chip-private`) | Create/recover, backup export/import, send, notice-only retry, local scan. |

## 3.2 What the backend can and cannot see

Can store/return: user id, `.veyra` username, `protocol_version`, `scheme_id`, the two
compressed public keys, the 66-byte meta-address, the public fingerprint, the SISK
public key, enrollment signature (a public binding artifact), and public on-chain
announcement data.

Never receives, derives or returns: spending key, viewing key, stealth private key,
seed, mnemonic, the recovery signature, or **any** wallet address of a recipient.
`publicPrivateTransferIdentity()` is an allowlist projection that additionally fails
closed (`PRIVATE_TRANSFER_ADDRESS_PRESENT`) if a wallet-shaped field ever appears.

`private_transfer_payments` deliberately stores no recipient identity (no username, no
meta-address, no address), so the database cannot be turned into a `.veyra → .veyra`
transfer graph.

## 3.3 Enrollment, recovery and backup

- **Create** signs the frozen §2D.8 recovery message
  (`Veyra stealth identity v1\nusername: …\nchainId: 4441\ndomain: veyra.identity`)
  and derives `spendPriv = keccak256(sig[0:32])`, `viewPriv = keccak256(sig[32:64])`.
  The recovery signature never leaves the device.
- **Enrollment** transmits only public material plus a signature over a *different*,
  domain-separated message (`… domain: veyra.identity.enrollment …`). That message also
  binds the SISK public key — a deliberate strengthening over §2D.9's field list (the
  binding must cover the key that is being published).
  The **server verifies that signature**: it rebuilds the message and recovers the
  signer with ECDSA public-key recovery (`recoverPublicKey`/`addressFromSignature`),
  then compares it to `users.wallet_address`. A meta-address can therefore never be
  registered on a client's word alone, and a signature from any other wallet (or over
  a different meta-address) is rejected with `PRIVATE_TRANSFER_INVALID_SIGNATURE`.
  The recovery implementation is cross-checked against `viem`'s
  `recoverMessageAddress`/`recoverAddress` in the test suite.
- **Recover** is a separate user action. A fingerprint mismatch refuses automatic
  recovery (never silently generates a new identity) and directs the user to the
  encrypted backup.
- **Backup**: AES-256-GCM (96-bit IV, 128-bit tag) with scrypt (`N=2^15, r=8, p=1`);
  the public envelope fields are the AAD, so tampering with the metadata fails
  authentication. The blob is stored in IndexedDB (sessionStorage fallback), never in
  localStorage, never uploaded, never logged, never placed in a URL.
  Wrong passphrase and tampered blob are indistinguishable (`BACKUP_AUTHENTICATION_FAILED`).

## 3.4 Send flow and failure policy

`resolving_recipient → recipient_verified → deriving_stealth → awaiting_wallet →
payment_submitted → payment_confirming → payment_confirmed → announcement_submitting →
announcement_confirmed → completed`.

- A fresh ephemeral scalar, a fresh shared secret and therefore a fresh stealth address
  are generated per payment; there is no reuse path and no fallback to the recipient's
  normal wallet anywhere in the code.
- The ephemeral key is generated locally and validated (33 bytes, prefix `02/03`,
  on-curve) before broadcast, so Veyra cannot reproduce the malformed-key transactions
  observed from third parties in Phase 2C.
- `completed` is unreachable unless **both** the payment and the announcement have the
  required confirmations (payment default 2, announcement default 1; configurable).
- If the payment settles and the announcement fails, the non-secret recovery record is
  persisted and only the announcement is republished (`PUBLISH PAYMENT NOTICE ONLY`).
  **The zkLTC payment is never re-sent.**
- No failure path converts into a direct wallet-to-wallet transfer; the only exits are
  `failed` (announcement pending) or `cancelled`.
- Gas is never hard-coded: the wallet estimates for the payment, and the stealth spend
  reads `eth_gasPrice`/`baseFeePerGas` at the moment of signing. A funding check keeps a
  gas reserve.

## 3.5 Wallet support

Standard EOAs are supported. Smart-contract / ERC-4337 / ERC-1271 accounts, multisig
accounts and wallets that return 64-byte compact (ERC-2098) signatures are **refused**
before anything is signed, with exactly:

> Private transfer identity setup is not supported by this wallet type yet.

## 3.6 Privacy surface

- The scan endpoint is public, unfiltered and cursor-paginated; there is no
  `/api/private-transfer/<username>/…` route, so the backend cannot be asked "which
  announcements belong to `bob.veyra`".
- Removed from the payment-reporting path: the recipient's username, meta-address and
  fingerprint. Only public protocol values and transaction hashes are sent.
- Scanning happens locally with the viewing key; the viewing key is never transmitted.
- Spending from a stealth address verifies `p_stealth·G == P_stealth` before signing, is
  signed locally (raw transaction), and warns when the destination is a wallet that is
  publicly the recipient's own.
- Copy: "Recipient-address privacy"; "Bob's normal wallet address is not exposed by this
  payment." The word "anonymous" (and any untraceability claim) appears nowhere in the
  shipped surface — enforced by `test/private-transfer-ui.test.js`.

## 3.7 Tests

`test/private-transfer-crypto.test.js` (29), `private-transfer-client.test.js` (20),
`private-transfer-service.test.js` (19), `private-transfer-ui.test.js` (13), plus new
assertions in `test/schema-contract.test.js`. Cross-checks are against independent
implementations (viem keccak / ABI encoding / transaction serialization / signature
recovery, @noble ECDSA, node:crypto scrypt, RFC 7914 vectors). `npm test` = **281/281**;
`npm run check` exit 0; `npm run build:static` OK.

## 3.8 Migration

`npm run db:migrate` applies the additive Phase 3 block (four tables, indexes,
constraints). No existing table is altered and no existing row is touched.

## 3.9 Remaining limitations (unchanged by this phase)

- **Live LiteForge end-to-end validation remains pending.** Every on-chain step in this
  phase is implemented, tested offline and blocked only by network egress from the
  development sandbox (Phase 2E). No transaction hash is claimed for it.
- Anonymity is not provided and not claimed: amounts and timing are public.
- Spending out of a stealth address to a wallet that is publicly yours re-links the funds.
- Wallet-signature recovery is verified offline only; real-wallet determinism for every
  EOA implementation remains unconfirmed.

# Phase 3.5 — Security audit & hardening (added 2026-10-06)

Audit of the Phase 3 private-transfer surface only: `src/stealth/*`, the session bridge,
the panel + CSS, `server/private-transfer.js`, `api/private-transfer/[route].js` and the
Phase 3 block of `db/schema.sql`. No product features were added, no architecture was
redesigned, no contract was deployed, no funds moved, no transaction was broadcast, and
no test was weakened, removed or relaxed to accommodate the implementation.

## 3.5.1 Method and evidence base

* **Independent implementations.** Every primitive was compared against an implementation
  other than Veyra's: `viem@2.56.8` (`keccak256`, `encodeFunctionData`, `signTransaction`,
  `recoverTransactionAddress`, `privateKeyToAccount`), `@noble/curves@1.9.1`,
  `@noble/hashes@1.8.0` and Node's `node:crypto`. Those packages are development-only and
  **do not enter the browser bundle** (verified: the built `static-site/` contains no
  external import, no `node:crypto`, no CommonJS).
* **Adversarial harness.** A throwaway differential harness ran **3,672 assertions with 0
  failures** across keccak boundaries (0–1,089 bytes incl. 135/136/137 and 1088/1089),
  200+ scalar-multiplication vectors, compress/decompress both ways, 400 full stealth
  derivations, address-derivation negatives, announcement ABI vs viem, 27 raw-transaction
  vectors, 50 backup envelopes with a tamper matrix, `scrypt` vs `node:crypto`, and amount
  parsing. Five initial failures were all harness artifacts (an object-spread that made a
  "scheme 2" probe actually carry `schemeId: 1`; `new Uint8Array(<viem hex string>)`;
  double `0x` prefixing; mutating ABI padding; asserting the pre-hardening unbounded
  metadata length). The harness was deleted after the run; its durable assertions live in
  `test/private-transfer-hardening.test.js`.
* **Regression-first tests.** Each finding got a failing test before the fix, then
  fails-before/passes-after was confirmed, then the full suite was re-run.
* **Gates.** `npm test` **312/312**, `npm run check` exit 0, `npm run build:static` OK,
  `npm audit` **0 vulnerabilities**.

## 3.5.2 Findings and remediation

No **CRITICAL** and no **HIGH** findings. Severity classes below are the brief's:
CRITICAL / HIGH / MEDIUM / LOW / INFORMATIONAL.

| ID | Severity | Finding | Remediation | Regression test |
|----|----------|---------|-------------|-----------------|
| M-01 | MEDIUM | `scanAnnouncement` skipped the view-tag check when metadata was not exactly two hex chars (empty, or a tag followed by trailing bytes) — a malformed announcement could be accepted without the tag check | metadata must be exactly one byte (`METADATA_LENGTH` / `METADATA_MALFORMED`) | `M-01`, `M-01b` |
| M-02 | MEDIUM | The encrypted backup envelope was not bound to protocol version / scheme / chain, so a blob from another context could be imported | export refuses to run without them; import refuses mismatches (`BACKUP_UNSUPPORTED_*`) | `M-02` |
| M-03 | MEDIUM | A wallet account change or disconnect left session key material and the cached identity in place — a later payment could be signed by a different account while the old identity stayed active | `litvm:wallet` listener; disconnect/failure clears unconditionally; account change drops memory keys and the cached identity and adopts the new address | `M-03` (plus the self-inflicted variant below) |
| M-04 | MEDIUM | Double-click / re-entry could submit two payments | `_inFlight` guard → `TRANSFER_IN_PROGRESS`, and re-entrancy guards on all seven panel buttons | `M-04`, panel guard scan |
| M-05 | MEDIUM | A server-returned meta-address change silently redirected the payment; import could adopt a foreign identity | TOFU gate: a changed fingerprint for a previously paid username refuses to pay (`FINGERPRINT_CHANGED`) unless the caller explicitly acknowledges; import verifies the expected fingerprint (`BACKUP_FINGERPRINT_MISMATCH`) | `M-05`, `M-05b` |
| M-06 | MEDIUM | A reload between signing and receipt could lead to paying twice with no warning | non-secret pending-payment intent written **before** `eth_sendTransaction`, cleared once a hash exists, surfaced as a dismissible warning that survives the reload | `M-06`, `M-06b` |
| M-06c | MEDIUM | (found while hardening M-06) a receipt **timeout** is the one case where the payment may have settled unseen; a revert is definitive | timeout keeps the warning *and names the transaction hash*; a revert (status `0x0`) clears it; failures before a hash clear it; announcement-phase failures never touch it | `M-06c` |
| M-07 | MEDIUM | (self-inflicted, caught by the new tests) the first M-06 implementation read `let submittedHash` from the outer `catch`; a `catch` block is a **sibling** scope of its `try`, so the reference threw `ReferenceError` and masked the real error | cleanup state that an outer catch needs is declared before the `try`; the same scan was run over every `catch` in the Phase 3 surface (one other hit was a scanner false positive from nested scopes) | `M-06c`; `catch`-scope scan documented in 3.5.3 |
| L-01 | LOW | `scalarMultiply` accepted off-curve points, so a malformed point could enter derivation | `POINT_NOT_ON_CURVE` refusal; generator frozen | `L-01` |
| L-02 | LOW | `assertChain` could surface a raw `TypeError` for a malformed/missing `eth_chainId` | fails closed as `WRONG_NETWORK` | `L-02` |
| L-03 | LOW | The metadata length bound was unstated | `MAX_METADATA_BYTES = 256`, enforced by the validator and the decoder | `L-03` |
| L-04 | LOW | The announcement **decoder** accepts non-canonical ABI padding, so two different calldata blobs can decode to the same record | deliberately unchanged: the decoder exists to audit third-party calldata (Phase 2E found real announcements with invalid keys — these must stay decodable). The encoder is strict and the record is keyed by transaction hash, so no dedup ambiguity exists. Documented instead of "fixed". | padding case pinned in the harness; `modified calldata` test mutates a data byte |
| I-01 | INFORMATIONAL | RFC 6979 retry did not advance the HMAC state (deviation from §3.2) | `createNonceGenerator` advances per retry; output remains byte-identical to viem/noble | `I-01` |
| I-02 | INFORMATIONAL | Authenticated announcement/payment POSTs were not rate limited | `announcements` 30/h, `payments` 30/h (resolve 60/min, enroll 8/h), with the DB action whitelist widened | `I-02`, limiter tests |
| I-03 | INFORMATIONAL | No dust/gas-reserve honesty | `DUST_WARNING_ATOMIC` (0.0001 zkLTC) surfaced in the send result; `gasReserveAtomic` configurable (default 0.001 zkLTC) | `I-03` |

### Verified sound (no change required)

* **keccak-256** byte-identical to viem/@noble at every tested length including SHA-3 block
  boundaries; no accidental UTF-8 path (`keccak256Utf8` is separate and explicit).
* **secp256k1**: `1`, `2`, `n−1`, `≥n`, `zero`, infinity, truncated/oversized/invalid
  encodings all behave correctly; compress↔decompress round-trips.
* **Derivation**: 400/400 payments produced 400 distinct stealth addresses; `r·V == v·R`;
  `s·G == P_stealth`; the ephemeral key is never reused by production code while a
  deliberately reused `r` is detectable; a view-tag collision alone is rejected
  (`ADDRESS_MISMATCH`), proving the tag is only an optimisation and full derivation always
  runs.
* **Address derivation** is `keccak256(x‖y)[12:]` on the *unprefixed uncompressed* point,
  and provably not the compressed/prefixed/hex-text/UTF-8 variants (negative controls made
  non-vacuous during the audit).
* **ERC-5564 ABI**: selector `0x4d1f9583`, byte-identical to viem for valid records; the
  announcer target is the frozen constant `0x55649E01B5Df198D18D95b5cc5051630cfD45564` —
  a hostile `announcerAddress`/`schemeId`/`chainId` constructor option cannot redirect the
  transaction; the encoder refuses off-curve ephemeral keys (so Veyra can never reproduce
  the malformed keys observed in Phase 2C) while the decoder still parses them for audit.
* **Raw transactions**: 27 vectors byte-identical to `viem.signTransaction` (EIP-155 and
  1559, chain 4441, nonce/gas/value/destination/calldata/access list, leading zeros, large
  values), low-s, RFC 6979 determinism, `recoveredSender == expectedWallet`, tamper
  rejection.
* **Enrollment**: the server rebuilds `enrollmentMessage` from the **authenticated user's**
  stored username and requires the recovered signer to equal `users.wallet_address`; a
  body-supplied username is never signed over, a cross-username replay fails
  (`PRIVATE_TRANSFER_INVALID_SIGNATURE`), re-enrollment is refused, and signature payloads
  containing `private|seed|mnemonic` are rejected.
* **Username parity**: the Phase 3 resolve path calls Phase 1's `resolveIdentityRecord`, so
  there is exactly one normaliser (case, `.veyra` suffix, surrounding whitespace, reserved
  names, zero-width/full-width lookalikes, length). Inputs Phase 1 rejects never reach the
  database — no oracle distinguishes "exists but not enrolled" from "unknown".
* **Server/DB privacy**: `publicPrivateTransferIdentity()` fails closed
  (`PRIVATE_TRANSFER_ADDRESS_PRESENT`) if a wallet-shaped field ever reaches it; the
  payment writer touches no username/meta-address/recipient/wallet column; no query joins
  payments to announcements or identities; there is no `/announcements/:username` route
  (all routes are authenticated, single-segment, with explicit method checks) and the
  viewing key is never transmitted.
* **Storage/DOM**: no logging, telemetry, cookie or URL sink carries key material; hostile
  usernames cannot become markup (no `innerHTML`); the localStorage cache holds only public
  material and pins.
* **Amounts**: integer-only (BigInt) with no float path; `0`, `-1`, scientific notation and
  >18 decimals are rejected.
* **State machine**: an exhaustive walk of all transitions proves `completed` is
  unreachable without both confirmations, `payment_failed` never becomes `completed`, and
  `announcement_failed` never triggers another payment (announcement retry is a separate,
  payment-free path).
* **Backup**: AES-256-GCM with unique salt+IV per envelope, public metadata bound as AAD,
  authenticated failure on any tamper (ciphertext/salt/IV/AAD/metadata/wrong passphrase),
  scrypt identical to `node:crypto`; empty/short passphrases refused; long (>2,000 char)
  multi-byte Unicode passphrases work; no Unicode folding is applied.
* **Build/dependencies**: `static-site/` contains no secret material (the only long hex
  constants are the curve prime/order/generator and the public ERC-5564 topic);
  `npm audit` 0 vulnerabilities; the crypto path stays dependency-free.

## 3.5.3 Remaining risks, assumptions and limitations

* **TOFU is documented, not solved.** The recipient fingerprint is pinned on first use; an
  already-known name whose fingerprint changes refuses to pay until the user acknowledges
  it, and an import must match the expected fingerprint. The residual risk is **first use**:
  if the backend is compromised *before* Alice ever pays a given name, the first
  meta-address she pins could be the attacker's. Removing that would require an external
  trust root (a directory signing key, an on-chain registry read, or a social-verification
  scheme) — deliberately **not** added, because it would be an unsafe centralised trust
  mechanism and an architecture change.
* **Correlation is inherent and not denied.** The backend sees the authenticated user, the
  enrollment time, the submission times of payments and announcements and a rate-limit IP
  hash; the chain sees amounts and timing. Veyra claims **recipient-address privacy and
  unlinkability**, never anonymity. A per-username announcement index would be an oracle,
  and none exists; scanning is local with the viewing key.
* **Browser memory is best-effort.** `forgetIdentity()` / `clear()` drop key material and
  the cached identity, but JavaScript strings and BigInts cannot be guaranteed zeroised; a
  compromised page or extension at signing time is out of scope. Nothing is rendered to the
  DOM, and the panel has no debug view.
* **Wallet support is EOA-only.** Smart-contract wallets, multisig, account abstraction and
  ERC-2098 compact signatures are refused with a clear message; signature recovery is proven
  against viem/`@noble`, not against every real wallet implementation.
* **Gas/dust figures are estimates, not guarantees.** `gasReserveAtomic` (default 0.001
  zkLTC) is a configurable safety margin and the 0.0001 zkLTC dust warning is advisory; no
  reserve is universally sufficient, and no universal-reserve promise is made.
* **Operational records retained on purpose.** Announcement rows, payment reconciliation
  rows (sender-only, no recipient identity), enrollment records and recovery records are
  kept because they are needed for retry, accounting, recovery and duplicate-submission
  refusal; each is documented above with the reason.
* **Decoder/validator leniency.** `decodeAnnounceCalldata` tolerates non-canonical ABI
  padding so that real third-party calldata (including invalid keys) stays auditable; the
  encoder and the scanner stay strict.
* **Maintenance note.** A `catch` block is a sibling scope of its `try`: bindings declared
  with `let`/`const` inside the `try` are invisible in the `catch`. Cleanup state must be
  declared before the `try` (finding M-07). A scan for this pattern over the Phase 3 surface
  found no other occurrence.

## 3.5.4 Live validation status

* **Live LiteForge end-to-end validation remains pending.** Phase 3.5 sent no transaction,
  deployed no contract and used no real wallet or funds; every result above is offline and
  reproducible with the pinned development dependencies. The Phase 2E network-egress
  blocker is unchanged, and no transaction hash is claimed anywhere in this audit.

## 3.5.5 Verification result

`npm test` **312/312** (Phase 3.5 adds `test/private-transfer-hardening.test.js`, 30 tests,
on top of the Phase 3 281 plus the two Phase 3 tests whose expectations were tightened),
`npm run check` exit 0, `npm run build:static` OK, `npm audit` 0 vulnerabilities, and the
differential harness 3,672/0. The audit verdict does not rest on `npm test` alone: it rests
on byte-for-byte agreement with independent implementations, adversarial/property checks,
source-level invariants (no second normaliser, no join that links payer to payee, no
configurable announcer, no `innerHTML`, no secret sink), and the explicit acceptance of the
documented TOFU residual — with no CRITICAL or HIGH finding outstanding.
