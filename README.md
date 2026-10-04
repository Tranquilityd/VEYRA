# VEYRA / VEYRAWLD

VEYRA is a browser-based 2D city, garden, casino, and arcade experience. The current project uses native browser ES modules and Canvas rendering, with Vercel serverless APIs, PostgreSQL persistence, wallet authentication, and an existing VeyraCasino deployment on LitVM LiteForge.

This repository contains the current working implementation. Preserve its gameplay, Lester character, world, art direction, UI, animations, economy, and blockchain architecture unless a separately approved change is required.

## Technology

- **Client:** HTML, CSS, JavaScript ES modules, Canvas 2D
- **Build:** a small Node.js copy/injection script (`scripts/build-static.js`)
- **Backend:** Vercel Functions under `api/`, implemented by handlers in `server/`
- **Database:** PostgreSQL through `postgres`
- **Blockchain:** `viem`, EIP-1193 browser wallets, LitVM LiteForge chain 4441
- **Contract tooling:** Solidity + Hardhat in `contracts/`
- **Tests:** Node's built-in test runner
- **Deployment:** Vercel, configured by `vercel.json`

There is no React/Vue/Angular bundler. Browser source is served as ES modules.

## Requirements

- Node.js 20 or later recommended
- npm
- PostgreSQL for database-backed APIs and E2E tests
- Vercel CLI for a close local reproduction of serverless routing (optional)

## Install

```bash
npm ci
```

Contract tooling is separate and only needed for contract compilation work:

```bash
cd contracts
npm ci
```

Do **not** redeploy the existing contract merely to set up the application.

## Environment configuration

Copy `.env.example` to `.env.local` and provide local/deployment values through your environment provider. `.env.local` is intentionally ignored.

```bash
cp .env.example .env.local
```

Important groups:

- `DATABASE_URL` — PostgreSQL connection used by server handlers.
- `API_SESSION_SECRET`, `WALLET_CHALLENGE_DOMAIN` — wallet-auth session/challenge configuration.
- `VEYRA_CASINO_SIGNER_PRIVATE_KEY`, `VEYRA_CASINO_SIGNER_ADDRESS` — server-side casino claim authorization. The private key must never enter Git.
- `HCAPTCHA_SECRET_KEY`, `CLOUDFLARE_TURNSTILE_SECRET_KEY` — server-only verification credentials.
- `NEXT_PUBLIC_*` CAPTCHA variables — public browser/build configuration.
- `LITVM_RPC_URL` / `LITEFORGE_RPC_URL` — optional RPC overrides.
- `E2E_DATABASE_URL` — isolated E2E database; never point destructive tests at Production.
- Deployment-only contract variables are documented in `.env.example` but are not needed to use the already-deployed contract.

Never copy real secrets into README files, issues, commits, or client-side `NEXT_PUBLIC_*` fields.

## Run locally

For the static client only:

```bash
npm run build:static
python3 -m http.server 3000 --directory static-site
```

Open `http://localhost:3000`. Server-backed authentication, balances, CAPTCHA, withdrawals, and casino settlement require the API environment.

For the closest local Vercel setup, install/authenticate the Vercel CLI outside the repository and run:

```bash
vercel dev
```

Use local/test credentials and an isolated database.

## Build

```bash
npm run build:static
```

This regenerates `static-site/` by copying the browser entry files, `src/`, styles, assets, and admin client, then injecting only approved public CAPTCHA settings. `static-site/` is generated and intentionally ignored by Git.

## Production deployment

Vercel uses:

- build command: `npm run build:static`
- output directory: `static-site`
- serverless functions: `api/**/*.js`
- configuration: `vercel.json`

Set environment variables in the deployment platform, apply `db/schema.sql` using the controlled migration process, and deploy the repository root. Do not commit `.vercel/`, `.env.local`, production database exports, or credentials.

There is no separate long-running production server command in this architecture: Vercel serves the generated static output and executes API files as serverless functions.

## Checks

```bash
npm run check
npm test
npm run build:static
```

Database-backed casino E2E testing is intentionally separate:

```bash
npm run test:e2e:casino
```

It requires an isolated `E2E_DATABASE_URL` and appropriate test configuration. Read `scripts/run-casino-e2e.js` before running it.

## Main structure

- `index.html` — browser document and UI shell.
- `src/main.js` — browser entry point; installs wallet support and boots `Game`.
- `src/core/` — loop, state machine, input, audio, saves, quality controls, and shared utilities.
- `src/states/` — boot, menu, outdoor play, interior state, and world rendering.
- `src/world/` — city/interior worlds, map data, camera, entities, venues, and interiors.
- `src/entities/` — Lester/player, rig and animator, NPCs, animals, buildings, vehicles, props, casino/arcade interactables.
- `src/visuals/` — Canvas painters, palette, lighting, sprites, and speech rendering.
- `src/systems/` — interactions, transitions, conversations, casino/arcade floors, wallet session, referrals, world entry, and game registry.
- `src/games/` — casino/arcade logic, wagering gateway, rewards, and provably-fair client verification.
- `src/ui/` — overlays, wallet/balance panels, CAPTCHA, minimap, orientation handling, and arcade games.
- `styles/` — existing visual presentation. Preserve it unless a visual change is explicitly approved.
- `assets/` — Lester and official VEYRAWLD imagery.
- `api/` — Vercel route entry points.
- `server/` — authentication, casino, blockchain verification, Arcade, admin, CAPTCHA, and database handlers.
- `db/schema.sql` — authoritative database schema.
- `config/` — deployed LitVM manifest and VeyraCasino ABI.
- `contracts/` — existing Solidity source and Hardhat tooling. The deployed address is recorded in `config/deployments/liteforge.json`.
- `admin/` — private admin client.
- `test/` — regression tests and retained fixtures.
- `docs/` — fairness documentation and migration/agent handoff material.

## Important development notes

- Preserve the current VEYRAWLD brand assets and metadata.
- Lester, the garden/city, camera, controls, animation timings, game economy, and UI are established systems—not placeholders to rewrite.
- Casino wagers use native zkLTC on LitVM LiteForge. Outcomes are server-authoritative and provably fair; payouts use signed on-chain claims.
- Arcade rewards must remain server-verifiable. Manual admin settlement remains separate from casino contract claims.
- Financial arithmetic must stay integer/atomic; do not introduce floating-point payout logic.
- Do not trust client-provided scores, rewards, outcomes, game identity, or hidden values.
- Do not run migrations, destructive tests, deployments, or contract scripts against Production without explicit approval and backups.
- Read `docs/VEYRA_PROJECT_STATE.md` and `docs/AGENT_HANDOFF.md` before substantial work.
