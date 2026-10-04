import { requireAuth } from '../../server/auth.js';
import { db } from '../../server/db.js';
import { audit } from '../../server/audit.js';
import { creditArcadeBalance } from '../../server/arcade-balance.js';
import { body, fail, json, method } from '../../server/http.js';
import {
  ARCADE_REWARD_RATE, MAX_REWARDED_WAVES, NON_REWARD_GAMES, REWARD_GAMES, SESSION_TTL_MS,
  createArcadeChallenge, issueArcadeRoundToken, verifyArcadeRound, verifyArcadeRoundToken,
} from '../../server/arcade-protocol.js';

const GAMES = new Set([...REWARD_GAMES, ...NON_REWARD_GAMES].filter(g => g !== 'basketball'));
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
const sessionExpired = session => Date.now() - new Date(session.started_at).getTime() > SESSION_TTL_MS;

async function rejectSession(tx, session, reason) {
  const rows = await tx`UPDATE game_sessions SET reward=0, ended_at=NOW(), validation_status='rejected',
    validation_reason=${reason}, updated_at=NOW() WHERE id=${session.id} RETURNING *`;
  return rows[0];
}

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const auth = requireAuth(req), input = await body(req), sql = db();
    if (input.action === 'start') {
      if (!GAMES.has(input.game) || (input.clientSessionId && !/^[A-Za-z0-9_-]{8,80}$/.test(input.clientSessionId))) throw new Error('INVALID_INPUT');
      const rows = await sql`INSERT INTO game_sessions (user_id, game, client_session_id)
        VALUES (${auth.sub}, ${input.game}, ${input.clientSessionId || null})
        ON CONFLICT (user_id, client_session_id) WHERE client_session_id IS NOT NULL DO UPDATE SET updated_at=game_sessions.updated_at
        RETURNING id, game, started_at, validation_status, waves, score, reward`;
      const session = rows[0];
      await audit(sql, { userId: auth.sub, action: 'arcade.session_started', entityType: 'game_session', entityId: session.id,
        metadata: { rewardEnabled: REWARD_GAMES.has(session.game), protocol: 'server_round_v1' } });
      return json(res, 201, { ok: true, rewardEnabled: REWARD_GAMES.has(session.game), session });
    }

    if (!uuid(input.sessionId) || !['round', 'completeRound', 'finish'].includes(input.action)) throw new Error('INVALID_INPUT');
    const result = await sql.begin(async tx => {
      const found = await tx`SELECT * FROM game_sessions WHERE id=${input.sessionId} AND user_id=${auth.sub} FOR UPDATE`;
      const session = found[0];
      if (!session) return { error: 'NOT_FOUND' };
      if (session.validation_status !== 'started') {
        if (input.action === 'finish' && ['validated', 'rejected'].includes(session.validation_status)) return { session };
        return { error: 'ARCADE_SESSION_CLOSED' };
      }
      if (sessionExpired(session)) {
        await rejectSession(tx, session, 'session_expired');
        return { error: 'ARCADE_SESSION_EXPIRED' };
      }
      if (!REWARD_GAMES.has(session.game)) {
        if (input.action !== 'finish') return { error: 'ARCADE_REWARD_UNAVAILABLE' };
        return { session: await rejectSession(tx, session, 'non_reward_game'), rewardEnabled: false };
      }

      if (input.action === 'round') {
        const wave = Number(session.waves) + 1;
        if (wave > MAX_REWARDED_WAVES) return { error: 'ARCADE_SESSION_LIMIT' };
        let rounds = await tx`SELECT * FROM arcade_rounds WHERE game_session_id=${session.id} AND wave=${wave} FOR UPDATE`;
        let round = rounds[0];
        if (!round) {
          const challenge = createArcadeChallenge(session.game, wave);
          rounds = await tx`INSERT INTO arcade_rounds
            (game_session_id,user_id,game,wave,challenge,verifier,not_before,expires_at)
            VALUES (${session.id},${auth.sub},${session.game},${wave},${tx.json(challenge.public)},${tx.json(challenge.verifier)},${challenge.notBefore},${challenge.expiresAt})
            RETURNING *`;
          round = rounds[0];
        }
        if (round.status !== 'issued') return { error: 'ARCADE_ROUND_REPLAY' };
        if (Date.now() > new Date(round.expires_at).getTime()) {
          await rejectSession(tx, session, 'round_expired');
          return { error: 'ARCADE_ROUND_EXPIRED' };
        }
        return { round: { ...round.challenge, token: issueArcadeRoundToken({ roundId: round.id, sessionId: session.id, userId: auth.sub, game: session.game }), expiresAt: round.expires_at } };
      }

      if (input.action === 'completeRound') {
        const roundId = verifyArcadeRoundToken(input.roundToken, { sessionId: session.id, userId: auth.sub, game: session.game });
        if (!roundId) return { error: 'ARCADE_ROUND_TOKEN_INVALID' };
        const rounds = await tx`SELECT * FROM arcade_rounds WHERE id=${roundId} AND game_session_id=${session.id} AND user_id=${auth.sub} FOR UPDATE`;
        const round = rounds[0];
        if (!round) return { error: 'NOT_FOUND' };
        if (round.status !== 'issued') return { error: 'ARCADE_ROUND_REPLAY' };
        if (Number(round.wave) !== Number(session.waves) + 1) return { error: 'ARCADE_ROUND_OUT_OF_ORDER' };
        const now = Date.now();
        if (now < new Date(round.not_before).getTime()) {
          await rejectSession(tx, session, 'impossible_progression');
          return { error: 'ARCADE_ROUND_TOO_FAST' };
        }
        if (now > new Date(round.expires_at).getTime()) {
          await rejectSession(tx, session, 'round_expired');
          return { error: 'ARCADE_ROUND_EXPIRED' };
        }
        if (!verifyArcadeRound(round.verifier, input.events)) {
          await tx`UPDATE arcade_rounds SET status='rejected', completed_at=NOW() WHERE id=${round.id}`;
          await rejectSession(tx, session, 'invalid_round_solution');
          return { error: 'ARCADE_ROUND_INVALID' };
        }
        await tx`UPDATE arcade_rounds SET status='completed', completed_at=NOW() WHERE id=${round.id}`;
        const updated = (await tx`UPDATE game_sessions SET waves=waves+1,score=score+1,updated_at=NOW() WHERE id=${session.id}
          RETURNING id,game,waves,score,reward,validation_status`)[0];
        await audit(tx, { userId: auth.sub, action: 'arcade.round_completed', entityType: 'arcade_round', entityId: round.id,
          metadata: { game: session.game, wave: round.wave } });
        return { session: updated, completedWave: Number(round.wave) };
      }

      const waves = Number(session.waves);
      const reward = (waves / 100000).toFixed(5);
      const updated = (await tx`UPDATE game_sessions SET reward=${reward},ended_at=NOW(),validation_status='validated',
        validation_reason='server_rounds_verified',updated_at=NOW() WHERE id=${session.id} RETURNING *`)[0];
      if (waves > 0) await creditArcadeBalance(tx, { userId: auth.sub, amount: reward, source: 'arcade_session', sourceId: session.id });
      await audit(tx, { userId: auth.sub, action: 'arcade.session_validated', entityType: 'game_session', entityId: session.id,
        metadata: { waves, reward, rate: ARCADE_REWARD_RATE, protocol: 'server_round_v1' } });
      return { session: updated, rewardEnabled: true };
    });
    if (result.error) throw new Error(result.error);
    return json(res, 200, { ok: true, ...result });
  } catch (e) { fail(res, e); }
}
