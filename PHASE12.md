# Phase 12 — LiteForge Treasury and Airdrop-Style Claims

## Network boundary

- Testnet only: **LitVM LiteForge Testnet**
- Chain ID: **4441**
- Native currency: **zkLTC** (18 decimals)
- RPC: `https://liteforge.rpc.caldera.xyz/http`
- Configuration fails closed unless the verified contracts, roles, ABIs, treasury public address, and confirmation requirement are supplied.

## Wager architecture

The connected player wallet signs the verified wager-contract transaction. The backend does not trust client-reported value: it independently retrieves the transaction and receipt, checks the destination contract, decodes the configured method/event, verifies the player wallet and exact amount, and waits for the configured confirmations. The casino session cannot enter `wager_confirmed` until this verification succeeds. Only then may the Veyra backend resolve the round.

## Backend outcome architecture

Veyra's backend generates and records the outcome after a confirmed wager. Blockchain values are never used as outcome randomness. The record binds user, wallet (through the user record), game, wager, result, payout, wager transaction, and timestamps. A positive payout atomically creates one pending claim record for that session.

## Airdrop-style claim architecture

A unique `casino_claims` row is bound to one casino session, user, normalized player wallet, immutable wager, and backend payout. The browser requests a prepared claim by session ID; it cannot supply payout or recipient. Preparation fails closed at the unconfigured claim-contract boundary. Once the verified contract interface is supplied, the authorization adapter must populate only the contract-defined public claim payload/proof. The connected player's wallet submits the claim transaction. No treasury private-key payout path is present.

## Claim security

- Unique casino session, claim nonce, and transaction hash constraints.
- Authenticated user/session ownership checks.
- Connected-wallet and stored-wallet equality checks.
- Backend-owned payout and wager values.
- Independent RPC transaction, contract, decoded amount, decoded player, receipt, and confirmation verification.
- Claim tracking accepts only `authorized` or `submitted` claims.
- Replay/conflict protection in both claim and blockchain-transaction tables.
- No admin mutation or payment controls.
- No seed phrase, private key, signer secret, or treasury credential storage.

## Claim and transaction states

Claims: `pending`, `authorized`, `submitted`, `confirmed`, `failed`, `expired`, `claimed`.

Blockchain transactions: `pending`, `confirmed`, `failed` with block number, confirmation count, failure reason, timestamps, contract, amount, hash, user, and related entity.

The UI uses awaiting-signature, submitted, confirming, confirmed, and failed messages and never treats wallet acceptance as blockchain success.

## Treasury architecture

The dedicated treasury remains under the owner's personal recovery control. Only its public address belongs in verified normal configuration. No automatic funding or withdrawal operation exists. No backend treasury signer has been introduced.

## Contract information still required

1. Personally verified Treasury Wallet public address.
2. Verified deployed wager/settlement contract address.
3. Verified deployed claim contract address (if separate).
4. Verified ABI(s) and deployment/explorer references.
5. Exact wager function and/or event, parameter types/order, player field, amount field, and whether zkLTC is sent as native transaction value.
6. Exact claim function, claim event, player field, amount field, claim/session/nonce field, deadline field, and proof/signature format.
7. Verified authorization mechanism (Merkle, EIP-712, contract nonce, or the contract's actual alternative).
8. Required confirmation count.
9. Future arcade-withdrawal contract address/ABI, or confirmation that it remains disabled.
10. If and only if the verified authorization mechanism requires a signing service: signer role/public address and signing specification. Its private credential must be configured separately as a server-only Vercel secret and must never be supplied in chat or stored in PostgreSQL.
