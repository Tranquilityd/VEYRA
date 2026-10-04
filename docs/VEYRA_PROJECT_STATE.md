# VEYRA Project State

**Snapshot date:** 4 October 2026  
**Purpose:** migration-preservation record for the current working project.

## Current implementation

VEYRA/VEYRAWLD is a custom Canvas 2D browser game built from native JavaScript modules. It includes a navigable city and garden, Lester as the player character, NPCs and animals, venue transitions, casino and arcade interiors, playable casino/arcade experiences, wallet authentication, server-side persistence, social/referral/withdrawal systems, an admin surface, and LitVM casino settlement.

The browser entry is `index.html` → `src/main.js` → `src/core/Game.js`. A state machine controls Boot, Menu, outdoor Play, and Interior states. Vercel serves generated static assets and serverless API routes.

## Features implemented

- Cinematic branded landing/menu and site-entry CAPTCHA gate.
- Canvas-rendered modern city and south Garden District with camera, collision, lighting, buildings, props, fountain/waterfall, vehicles, residents, animals, conversations, and interaction prompts.
- Lester player character with dedicated rig, animator, movement, facing, and presentation assets.
- Casino and arcade buildings with exterior entry/exit transitions and dedicated interiors.
- Casino floor, regulars, machines, transaction feedback, wagering controls, game result presentation, and automatic winning-claim flow.
- Casino games represented by current code/tests: Plinko, Dice, Coin, and Slots, with deterministic provably-fair verification.
- Arcade systems including Basketball and server-authoritative cabinet games. Current tests cover Memory Rush, Tile Shift, Neon Escape, and N-Back; reward protocol is designed to reject client authority.
- Pause menu, Guide, Credits, minimap, orientation warning, responsive overlays, and reduced-motion handling.
- Wallet connection through EIP-1193/EIP-6963, LitVM chain add/switch, wallet signature authentication, persisted wallet session, wallet balance, and transaction receipt polling.
- Two-balance presentation: native wallet zkLTC and server-side Arcade balance.
- Referral, social verification, withdrawal request, and private admin review/settlement flows.
- hCaptcha/Turnstile integrations with server-side verification and fail-closed behavior.
- PostgreSQL schema and Vercel serverless backend.
- Existing VeyraCasino deployment on LitVM LiteForge, chain 4441, at `0xd2c36B83B1Ca788743E3E9b339e043b6B04e3273`.
- Native zkLTC wagers, EIP-712-authorized claims, replay protection, treasury funding, pause controls, and two-step owner/signer management.
- Local regression suite covering security boundaries, UI contracts, fairness reproduction, exact payout arithmetic, and release surfaces.

## Partially implemented or operationally dependent areas

- Full authenticated flows require configured serverless APIs, PostgreSQL, CAPTCHA credentials, and wallet support; a static-only server cannot reproduce them.
- Arcade withdrawals are deliberately manual admin payments, not automatic smart-contract withdrawals.
- Social verification depends on administrative review and external user evidence.
- Contract outcomes/randomness are not calculated on-chain. Server-side deterministic outcome generation and EIP-712 claim authorization remain required.
- Deployment and database migrations remain operational procedures rather than automatic local setup.
- `static-site/` is generated at build time and is not authoritative source.

## Known issues and risks

- A reported Production wallet connection failure has been observed before `POST /api/auth/challenge`; exact cause requires affected-browser/wallet-provider console evidence. Provider injection, permission, chain switch, or account request is the current boundary. Do not apply speculative wallet rewrites.
- Broad historical `eth_getLogs` calls to the public LiteForge RPC have timed out; narrow ranges or Blockscout address APIs are safer.
- LiteForge Blockscout can lag direct RPC state, including displayed contract balance.
- The deployed contract is not source-verified in the explorer.
- The casino contract accepts treasury funds but intentionally has no arbitrary owner withdrawal; migration/retirement funds can therefore be operationally inflexible.
- Winning settlement depends on the authorized backend signer and contract liquidity. Liability reservation is primarily an off-chain concern in this version.
- Wallet and claim flow spans browser wallet, RPC, backend tracking, database state, and a second claim transaction; interruption requires reconciliation/retry UX.
- The frontend restricts entered wagers to eight decimal places although zkLTC and the contract use 18 decimals. This is an intentional client constraint, not an observed accounting failure.

## Visual direction

The established direction is a polished, colorful, top-down/isometric-feeling Canvas city and garden combined with neon casino/arcade interiors and VEYRAWLD branding. The visual system is code-painted through `src/visuals/`, world/interior renderers, CSS overlays, and a small set of official raster assets.

Do not replace Lester, the garden, palette, official logo, typography hierarchy, landing presentation, interiors, UI effects, or transaction animations as incidental cleanup. External Google fonts are referenced by `index.html`; the application has existing semantic font roles and fallbacks.

## Character implementation

- `src/entities/Player.js` provides player entity behavior.
- `src/entities/LesterRig.js` defines Lester's rig/proportions.
- `src/entities/LesterAnimator.js` owns Lester animation state/timing.
- `assets/lester.png` and `assets/lester_head.jpg` are important character assets.
- `src/visuals/CharacterPainter.js` renders character presentation.
- NPCs, casino regulars, and animals are separate systems and should not be conflated with Lester.

Preserve Lester's identity, movement feel, facing, animation timing, scale, and assets.

## Environment implementation

- `src/world/cityMap.js`, `cityAtlas.js`, `venues.js`, and `interiors.js` hold world data.
- `src/world/World.js` and `InteriorWorld.js` coordinate world state.
- `src/entities/buildCity.js` populates residents and environmental entities.
- `src/visuals/BuildingPainter.js`, `PropPainter.js`, `CasinoPainter.js`, `ArcadePainter.js`, `Lighting.js`, and related painters draw the environment.
- `src/world/Camera.js` and state renderers own camera/world presentation.
- Casino and arcade entry/exit use venue and transition systems rather than separate applications.

## Animation and audio

- Lester animation is owned by `LesterAnimator` and `LesterRig`.
- Transitions and world entry are coordinated by `TransitionSystem` and `WorldEntrySequence`.
- UI/transaction effects use existing DOM/CSS and event-bus hooks, including reduced-motion behavior.
- Canvas/world motion runs through `src/core/Loop.js` and game states.
- `src/core/AudioManager.js` owns audio behavior. No large standalone audio asset directory exists in this snapshot; audio is code/system-driven where used.

## Game mechanics and economy

- Casino: a wallet submits a native zkLTC wager to the deployed contract. The backend verifies the receipt/session event, resolves the deterministic game outcome, and signs an eligible winning claim. The wallet submits the claim on-chain. Zero payouts do not create claims.
- Provably fair: server seed commitment/reveal, client seed, nonce, ruleset/version, and client verification reproduce outcomes. Historical Plinko v1 verification is retained.
- Financial calculations use integer atomic units. Plinko ball splits preserve every wei.
- Arcade: server-generated challenges and ordered one-time round tokens are authoritative. Client scores/waves/reward values are not trusted.
- Arcade withdrawal: user requests are reserved/idempotent and admin settlement deducts balance only on the final sent/paid transition.

Do not merge the native casino treasury with the server-side Arcade balance model.

## Wallet and blockchain state

- Network: LitVM LiteForge testnet, chain ID 4441 (`0x1159`), native zkLTC, 18 decimals.
- RPC: `https://liteforge.rpc.caldera.xyz/http`.
- Deployment manifest: `config/deployments/liteforge.json`.
- ABI: `config/abi/VeyraCasino.json`.
- Solidity source: `contracts/contracts/VeyraCasino.sol`.
- Wallet adapter: `src/systems/LitvmWalletAdapter.js`.
- Auth/session: `src/systems/LitvmWalletSession.js`, `api/auth/`, and server auth handlers.
- Casino client gateway: `src/games/casinoWagering.js`.
- Receipt verification/tracking: `server/blockchain.js` and `server/blockchain-transactions-handler.js`.
- Claim preparation/signing: `server/casino-claims-handler.js` and `server/casino-signer.js`.

Do not redeploy, rotate signers, change network configuration, or alter treasury behavior as part of routine migration.

## Architectural decisions that must be preserved

1. Native ES modules and Canvas rendering; there is no framework migration requirement.
2. `src/` is authoritative client source; `static-site/` is generated.
3. Vercel route files remain thin entry points backed by reusable `server/` handlers.
4. Secrets remain server-only. Only explicitly named `NEXT_PUBLIC_*` values enter browser output.
5. Wallet authentication uses challenge/signature verification, not a trusted client address.
6. Blockchain transactions are independently verified against the manifest, receipt, event, wallet, amount, and confirmations.
7. Casino outcome authority and Arcade reward authority remain server-side and auditable.
8. Exact integer arithmetic is mandatory for financial values.
9. Production database/manual withdrawal state must not be edited directly.
10. Build output, dependency directories, caches, local environment files, and `.vercel/` metadata are not source.

## Things that must not be changed accidentally

- Lester files/assets and animation behavior.
- City/garden map, art direction, camera, movement, controls, and world-entry timing.
- Official VEYRAWLD logo, metadata, typography, landing, pause menu, Guide, Credits, and overlays.
- Casino/arcade mechanics, fairness versions, multipliers, timing, and reward security.
- LitVM chain 4441, deployed contract address, ABI, signer assumptions, and zkLTC decimals.
- Wallet authentication and claim security checks.
- Manual Arcade withdrawal settlement semantics.
- hCaptcha/site-entry configuration or security validation.
- Database schema/history without a rehearsed migration and backup.

## Recommended next development areas

These are recommendations, not permission to change Production:

1. Capture browser console/provider diagnostics for the unresolved wallet connection report and reproduce it before changing code.
2. Add wallet/device compatibility coverage using real supported wallet browsers in a safe test environment.
3. Improve durable pending-transaction recovery and explorer links without changing settlement rules.
4. Verify the existing contract source in Blockscout if deployment metadata supports it; do not redeploy.
5. Add monitoring for signer availability, contract liquidity, RPC health, and explorer indexing lag.
6. Continue security-focused regression/E2E testing against isolated databases and LitVM testnet values.
7. Any future contract-version work—liability reservation, treasury migration, on-chain commitments—must be separately designed, audited, and approved rather than added to the current deployment casually.
