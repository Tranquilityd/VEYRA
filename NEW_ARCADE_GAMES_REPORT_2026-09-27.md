# VEYRAWLD Arcade Replacement Report

**Date:** 2026-09-27  
**Deployment:** **Not performed**  
**Production database:** **Not modified**

## Summary

Zombie Dodge and Zombie Shooter were removed from the active Arcade source, routes, cabinets, overlay selection, visuals, score board, Guide, and generated static build. They were replaced locally with:

1. **Neon Escape** — deterministic neon-arena movement survival.
2. **N-Back** — server-generated ordered working-memory challenges.

Both new games use the existing authenticated Arcade session/round/finalization architecture. Neither client can submit authoritative waves, scores, completed state, or reward values.

Memory Rush, Tile Shift, Basketball, casino, wallet, hCaptcha, site entry, withdrawal, admin, LitVM, Pause, Guide framework and map-pause behavior were not redesigned.

---

# 1. Files changed

- `api/arcade/session.js`
  - Round HMAC tokens now bind the persisted game ID as well as player, session and round.
  - Current game allowlist comes from the updated reward-game definitions.
- `server/arcade-protocol.js`
  - Added deterministic Neon Escape challenge generation and replay validation.
  - Added N-Back challenge generation and ordered-response validation.
  - Added game binding to round-token signatures.
  - Reward games are now Memory Rush, Tile Shift, Neon Escape and N-Back.
- `db/schema.sql`
  - Added the new game IDs to game-session and round constraints.
  - Added a non-reward historical placeholder migration for retired game rows.
- `src/games/arcadeLogic.js`
  - Replaced retired game registry entries.
  - Removed obsolete zombie difficulty, payout and lane helpers.
- `src/games/arcadeRewards.js`
  - Updated game display names.
- `src/ui/arcadeGames.js`
  - Removed both zombie gameplay implementations.
  - Added Neon Escape canvas gameplay.
  - Added N-Back canvas gameplay.
  - Added desktop keyboard and mobile pointer/touch controls.
- `src/ui/GameOverlay.js`
  - Replaced retired overlay routes with the two new games.
- `src/core/Game.js`
  - Updated Arcade game registration.
- `src/systems/ArcadeFloor.js`
  - Replaced the two physical cabinet routes.
- `src/entities/ArcadeCabinet.js`
  - Replaced zombie attract-mode art with Neon Escape and N-Back displays.
- `src/world/interiors.js`
  - Replaced posters, accents and best-score board labels.
- `index.html`
  - Removed Zombie Guide cards.
  - Added accurate Neon Escape and N-Back rules and reward-verification descriptions.
- `src/tests.js`
  - Updated built-in localhost browser checks for the new cabinet roster and routes.
- `test/guide.test.js`
  - Updated Guide expectations.
- `test/arcade-security.test.js`
  - Added deterministic protocol/security tests for both new games.
- `test/new-arcade-ui.test.js`
  - Added route-removal, controls, Guide and UI integration checks.
- `test/e2e/arcade-flow.test.js`
  - Added database-backed completion, concurrency, arbitrary score/reward and credit tests for both games.
- `static-site/`
  - Regenerated locally by the required static build.

## Files removed

No whole files were deleted. Obsolete zombie-specific implementations were removed from their shared modules so Memory Rush and Tile Shift remained untouched.

The only remaining retired identifiers are deliberately confined to:

- A database migration that safely converts historical rows to `legacy_nonreward`.
- Tests proving old game IDs are rejected.

No retired identifier exists in active `index.html`, `src/`, `api/`, `server/`, or generated `static-site/` output.

---

# 2. Neon Escape architecture

## Gameplay

- Futuristic neon canvas arena; no pixel art and no 3D.
- Player movement supports:
  - WASD
  - Arrow keys
  - Direct touch/pointer steering in mobile landscape
- Every wave starts with a visible countdown.
- The player must remain inside a moving illuminated safe zone while laser/electric sweep patterns approach.
- HUD shows wave, verified waves cleared, best result, current objective and remaining survival time.
- Visual elements include grid lighting, safe-zone glow, warning lasers, player glow, wave transitions, particles and a polished game-over card.

## Difficulty

Difficulty is derived exclusively from the server wave number:

- More simulation ticks/longer survival duration.
- Smaller safe-zone radius.
- Faster/more complex safe-zone drift.
- Narrower laser gaps.
- More frequent laser barriers.
- Increased laser width.
- Hard caps keep submitted work bounded.

There are no player-, wallet-, history-, balance- or streak-specific parameters.

## Server-issued challenge

Each challenge contains:

- Arena size.
- Tick duration and bounded tick count.
- Player movement speed.
- Safe-zone radius.
- Deterministic safe-zone path for each tick.
- Timed laser hazard records, axes, positions, widths and safe gaps.
- Server-derived wave number.
- HMAC-bound round token.
- Expiry.

## Verification

The client submits only a bounded list of movement vectors. The server:

1. Requires exactly one action for every issued simulation tick.
2. Rejects more than 120 actions.
3. Accepts only integer axes from `-1`, `0`, or `1`.
4. Applies the configured diagonal normalization and server movement speed.
5. Replays the player position from the authoritative start point.
6. Checks arena boundaries.
7. Checks safe-zone containment on every tick.
8. Replays timed laser collisions and safe gaps.
9. Rejects early/impossible completion using server timestamps.
10. Advances exactly one persisted wave only after the complete replay succeeds.

A client cannot submit a final location, survival boolean, wave count, score or reward as authority.

---

# 3. N-Back architecture

## Gameplay

- Clean futuristic grid with one highlighted position per sequence step.
- Desktop controls:
  - `M` or Right Arrow: Match
  - `N` or Left Arrow: No Match
- Large overlay buttons provide mobile landscape touch controls.
- HUD shows:
  - Current N level
  - Wave
  - Sequence position and length
  - Verified rounds cleared
  - Current response state
- Correct/incorrect feedback is visually and audibly presented.
- Missing a required response ends the round.

## Difficulty

Server wave progression controls:

- N increases from 1 through 4.
- Grid grows from 3×3 to 5×5.
- Sequence length grows from 9 through 28 positions.
- Presentation interval decreases with a fixed lower bound.
- Response timing decreases with a fixed lower bound.
- Match distribution is server-generated and not player-specific.

## Server-issued challenge

Each challenge includes:

- Cryptographically random sequence.
- Random UUID sequence identity.
- N value.
- Grid size.
- Sequence length/content.
- Presentation and response timing configuration.
- Server-derived wave.
- HMAC-bound round token and expiry.

The generator intentionally creates both matches and non-matches while preventing accidental non-forced matches from biasing the sequence.

## Verification

The client submits only:

- Issued sequence identity.
- Ordered response objects containing the sequence index and Match/No-Match choice.

The server independently:

1. Confirms sequence identity.
2. Calculates the required response count as `sequence length − N`.
3. Rejects missing, extra or duplicate responses.
4. Enforces exact index order.
5. Calculates every correct answer from the stored sequence.
6. Rejects any incorrect answer.
7. Applies server timing/expiry checks.
8. Advances one wave only after all responses are correct.

No client score or completion flag is accepted.

---

# 4. Shared server-authoritative reward design

Both games use the existing flow:

`wallet-authenticated session → server round → game/player/session-bound HMAC token → server verification → persisted wave → server finalization → Arcade Game Balance`

The HMAC now binds:

- Round UUID
- Game session UUID
- Authenticated player UUID
- Persisted game ID

Finalization continues to accept only:

```json
{ "action": "finish", "sessionId": "..." }
```

The server derives:

- Completed waves
- Score/progression
- Reward amount
- Final validation state

The existing reward rate remains unchanged: `0.00001 zkLTC` per server-verified round. No separate balance system was created.

Existing safeguards remain:

- `FOR UPDATE` session and round locking.
- Unique `(game_session_id, wave)`.
- One terminal round consumption.
- One reward-history credit per game session.
- Maximum 100 rewarded rounds.
- One-hour session expiry.
- Ten-minute round expiry.
- Server `not_before` completion bound.
- Atomic reward credit and history write.

The withdrawal path remains unchanged:

`Verified reward → Arcade Balance → Withdrawal Request → Admin Review → Manual Payment → Admin Sent → Deduction`

---

# 5. Retired games and routing

Removed from active code and output:

- Game registry entries.
- Cabinet routes.
- Overlay imports and dispatch branches.
- Full gameplay implementations.
- Zombie parameters, payouts and lane helpers.
- Attract screens.
- Interior posters and colors.
- Best-score labels.
- Reward display names.
- Guide cards.
- Browser test expectations.

A scan of active source and generated static output returned no retired Zombie game names or IDs.

Old IDs sent to the current API return `INVALID_INPUT` and cannot create a session or credit a balance.

---

# 6. Security tests

## Neon Escape

Tested:

- Valid reward session and challenge.
- Deterministic valid movement sequence.
- Successful server replay.
- Missing action.
- Invalid movement axis.
- Stationary path that leaves the advanced safe zone.
- More than the maximum bounded actions.
- Impossible completion timing.
- Forged token.
- Altered game binding.
- Altered player binding.
- Altered session binding.
- Skipped wave/game fields ignored.
- Replayed/duplicate completion.
- Concurrent completion: exactly one consumer succeeds.
- Arbitrary client score/reward ignored.
- Finalization creates one reward-history row.

## N-Back

Tested:

- Valid generated sequence.
- Correct full response set.
- Incorrect answer.
- Wrong index/order.
- Altered sequence identity.
- Missing response.
- Extra/duplicate response.
- Forged token.
- Altered player/session/game binding.
- Server timing protection.
- Replay and duplicate completion.
- Concurrent completion: exactly one consumer succeeds.
- Arbitrary client score/reward ignored.
- Finalization creates one reward-history row.

## Shared balance protection

- API source contains no reads of `input.waves`, `input.score`, or `input.reward`.
- Server increments progression only after verifier success.
- Finalization ignores forged financial/progression fields.
- Neither game can credit without at least one persisted completed server round.
- Existing concurrent admin `sent` protection continues to pass.

---

# 7. Test results

| Command | Result |
|---|---|
| `npm run check` | **PASS** |
| `npm test` | **PASS — 121/121** |
| `npm run build:static` | **PASS** |
| `npm run test:integration` | **PASS — 121/121** |
| `npm run test:e2e:casino` | **PASS** |
| Casino database-backed lifecycle | **PASS — 1/1** |
| Arcade/database/concurrency lifecycle | **PASS — 1/1** |
| Static server-secret scan | **PASS** |
| Retired active-source/static-output scan | **PASS — no matches** |

The E2E suite ran against the disposable local PostgreSQL `veyra_e2e` database. No Production database was accessed or changed.

---

# 8. Preserved systems

No intentional changes were made to:

- hCaptcha provider, sitekey or secret handling.
- Site-entry authorization.
- Wallet authentication.
- LitVM network, chain 4441, RPC or zkLTC configuration.
- Casino wager, outcome, fairness, claim or contract architecture.
- Arcade withdrawal workflow.
- Admin authentication or settlement.
- Social verification.
- Production environment variables.
- Vercel configuration.
- Memory Rush gameplay.
- Tile Shift gameplay.
- Basketball gameplay.
- Pause Menu, Guide framework or map-pause behavior.
- VEYRAWLD branding, logo or metadata.

---

# 9. Remaining issues/manual checks

No automated test failure remains.

Manual review is still required for:

1. Neon Escape keyboard feel, touch steering, challenge readability and late-wave difficulty on real desktop/mobile hardware.
2. N-Back presentation timing, button ergonomics, instruction clarity and difficulty progression on real devices.
3. Canvas scaling and overlay layout across supported landscape viewport sizes.
4. Audio/visual feedback and reduced-performance devices.
5. Authenticated wallet gameplay through several real testnet reward sessions.
6. Migration rehearsal on a clone of the actual Production database before any future deployment.

These local changes have **not** been deployed.
