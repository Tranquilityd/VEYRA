# VEYRA — Phase 2C / 2D / 2E research package — transfer instructions

**Date:** 2026-10-04 · **Prepared for:** hand-off to a GitHub-connected agent session
**Package:** `veyra-phase2-research.tar.gz` (83,169 bytes)
**Checksum file:** `veyra-phase2-research.tar.gz.sha256`
**SHA-256:** `ec73624fabab332d67c0072a83fae51e6a9a9ec2746505d96fb832fbc6dd849e`

> Research/documentation only. **No private keys, seed phrases, credentials, or tokens are inside.**
> No wallet was created, and no blockchain transaction was ever signed or broadcast.
> Live on-chain validation (Phase 2E) is **BLOCKED — not executed** (no RPC egress in the authoring
> environment). Do not fabricate transaction hashes.

---

## How to transfer

1. Download these two files to your device:
   - `veyra-phase2-research.tar.gz`
   - `veyra-phase2-research.tar.gz.sha256`
2. In the GitHub-connected Agent session, attach the archive to a message using the **+** upload button.
3. Paste the restoration prompt below into the same message.
4. The agent should verify, extract into the repo, run the three harnesses, and report before touching anything else.

## Files inside the archive

| Path in archive | Size | What it is |
|---|---|---|
| `docs/VEYRA-PRIVATE-TRANSFER-ARCHITECTURE.md` | 122,851 B | Full architecture doc — Phase 2A–2E findings |
| `docs/research/phase2c/stealth-lifecycle-sim.mjs` | 20,160 B | 2C offline lifecycle proof (44/44) |
| `docs/research/phase2d/stealth-serialization-pin.mjs` | 23,865 B | 2D serialization + recovery pins (49/49) |
| `docs/research/phase2e/live-lifecycle.mjs` | 54,020 B | 2E live orchestrator (pay/announce/scan/spend) |
| `docs/research/phase2e/lib/stealth.mjs` | 11,055 B | Pinned ERC-5564 scheme-1 primitives |
| `docs/research/phase2e/sign-check.html` | 10,481 B | Browser wallet-determinism probe (offline) |
| `docs/research/phase2e/README.md` | 13,295 B | Execution procedure (Termux-friendly) |
| `docs/research/phase2e/results/.gitkeep` | 0 B | Results dir (empty by design) |

## RESTORATION PROMPT (copy-paste into the new Agent session)

```text
I am attaching Veyra research artifacts (Phase 2C/2D/2E) as an archive:
veyra-phase2-research.tar.gz, with checksum file veyra-phase2-research.tar.gz.sha256
(SHA-256 ec73624fabab332d67c0072a83fae51e6a9a9ec2746505d96fb832fbc6dd849e).

This is RESEARCH AND DOCUMENTATION ONLY — a private-recipient-transfer study for the
Veyra project (ERC-5564 stealth addresses, scheme 1, native zkLTC, LiteForge testnet 4441).

Do this:
1. Verify the SHA-256 checksum, then extract the archive into the repository root so it
   produces: docs/VEYRA-PRIVATE-TRANSFER-ARCHITECTURE.md, docs/research/phase2c/,
   docs/research/phase2d/, docs/research/phase2e/.
2. Do NOT modify production code, package.json, or package-lock.json. Do NOT commit unless
   I explicitly ask.
3. For verification only, install the pinned research dependencies (not saved to the manifest):
   npm install --no-save --no-package-lock viem@2.56.8 @noble/curves@1.9.1 @noble/hashes@1.8.0
4. Run all three research harnesses; each must pass and exit 0:
     node docs/research/phase2c/stealth-lifecycle-sim.mjs        (expect 44/44 PASS)
     node docs/research/phase2d/stealth-serialization-pin.mjs    (expect 49/49 PASS)
     node docs/research/phase2e/live-lifecycle.mjs dry-run       (expect 48/48 PASS)
   If any fails, STOP and report.
5. Rules that apply to this material:
   - Phase 2E live on-chain validation is BLOCKED and was never executed. Never fabricate
     transaction hashes or network results; re-run only from a network-capable environment.
   - No private keys, seeds, or credentials are in the package; never add any.
   - Do NOT use Lunaria as a dependency (its announcements contained malformed ephemeral keys).
   - No mixers, no custodial intermediaries, no new contracts, no mainnet, no real funds.
   - Never claim "anonymity" — the term is recipient-address privacy / recipient unlinkability.
6. Then report what you verified (harness results + file inventory) and STOP.
```

## Reference facts (pinned, do not re-derive differently)

| Item | Value |
|---|---|
| Chain | LiteForge 4441 / `0x1159` (native zkLTC) |
| Scheme id | 1 (ERC-5564) |
| Announcer | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` |
| Registry | `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538` |
| Serialization | ECDH point compressed 33 B → keccak256; view tag = first byte; address = keccak256(uncompressed x‖y)[12:] |
| Announce metadata | 1-byte view tag (LiteForge native convention) |
