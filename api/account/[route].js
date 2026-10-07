// Veyra — Phase 2: consolidated account API router.
//
// Four former single-purpose entry points — balance, withdrawals, social
// verification and the Arcade session protocol — now share one Vercel Serverless
// Function so the remaining account surface costs one function instead of four.
//
// Public URLs are unchanged (internal rewrites in `vercel.json`):
//
//   GET            /api/balance              → route 'balance'
//   GET, POST      /api/withdrawals          → route 'withdrawals'
//   GET, POST      /api/social-verification  → route 'social-verification'
//   POST           /api/arcade/session       → route 'arcade-session'
//
// Every handler below is the ORIGINAL implementation, moved without semantic
// change: same methods, same body limits (these differ per route — the social
// proof route keeps its 1 200 000-byte bound, everyone else keeps the 16 384-byte
// default), same authentication, same Turnstile gate and transaction ordering on
// withdrawals, same idempotency/advisory locking, same audit calls, same status
// codes, same JSON shapes. Nothing is normalised into a shared behaviour.

import { requireAuth } from '../../server/auth.js';
import { db } from '../../server/db.js';
import { fail, json, method, body } from '../../server/http.js';
import crypto from 'node:crypto';
import { audit } from '../../server/audit.js';
import { requestIp, verifyTurnstileToken } from '../../server/turnstile.js';
import { creditArcadeBalance } from '../../server/arcade-balance.js';
import { ARCADE_REWARD_RATE, MAX_REWARDED_WAVES, NON_REWARD_GAMES, REWARD_GAMES, SESSION_TTL_MS, createArcadeChallenge, issueArcadeRoundToken, verifyArcadeRound, verifyArcadeRoundToken } from '../../server/arcade-protocol.js';

export default async function handler(req, res) {
  const route = Array.isArray(req.query?.route) ? req.query.route[0] : req.query?.route;
  // Single-segment routes only: `api/account/[route].js` matches exactly one path
  // segment, so a nested path could never reach a handler by accident.
  if (typeof route !== 'string' || route.includes('/')) return notFound(res);
  if (route === 'balance') return balance(req, res);
  if (route === 'withdrawals') return withdrawals(req, res);
  if (route === 'social-verification') return socialVerification(req, res);
  if (route === 'arcade-session') return arcadeSession(req, res);
  return notFound(res);
}

const notFound = (res) => json(res, 404, { ok: false, error: 'NOT_FOUND' });

// ---- route: balance ----
async function balance(req, res) {
  if(!method(req,res,['GET']))return;
  try{const auth=requireAuth(req),sql=db();const rows=await sql`INSERT INTO arcade_balances(user_id) VALUES(${auth.sub}) ON CONFLICT(user_id) DO UPDATE SET updated_at=arcade_balances.updated_at RETURNING balance,lifetime_earned,lifetime_withdrawn,updated_at`;
   const [reserved,history,withdrawals]=await Promise.all([sql`SELECT COALESCE(SUM(amount),0) amount FROM withdrawals WHERE user_id=${auth.sub} AND status='pending'`,sql`SELECT amount,balance_after,reason,created_at FROM arcade_reward_history WHERE user_id=${auth.sub} ORDER BY created_at DESC LIMIT 25`,sql`SELECT id,amount,wallet,transaction_hash,payment_reference,status,requested_at,updated_at,completed_at,sent_at,failure_reason FROM withdrawals WHERE user_id=${auth.sub} ORDER BY requested_at DESC LIMIT 25`]);
   const balance=rows[0],r=Number(reserved[0].amount);json(res,200,{ok:true,balance:{...balance,reserved:reserved[0].amount,available:Math.max(0,Number(balance.balance)-r).toFixed(8)},rewardHistory:history,withdrawalHistory:withdrawals});
  }catch(e){fail(res,e);}
}
// ---- end route: balance ----

// ---- route: withdrawals ----
const AMOUNT=/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/,KEY=/^[A-Za-z0-9_-]{16,100}$/;
const MIN=0.005;

async function withdrawals(req, res) {
  if(!method(req,res,['GET','POST']))return;
  try{const auth=requireAuth(req),sql=db();
   if(req.method==='GET'){
    const [account,rows]=await Promise.all([
     sql`SELECT u.wallet_address,u.social_verified_at,COALESCE(b.balance,0) balance,
       COALESCE((SELECT SUM(w.amount) FROM withdrawals w WHERE w.user_id=u.id AND w.status='pending'),0) reserved,
       EXISTS(SELECT 1 FROM withdrawals w WHERE w.user_id=u.id AND w.status='sent') has_sent,
       (SELECT status FROM social_verifications s WHERE s.user_id=u.id ORDER BY submitted_at DESC LIMIT 1) verification_status
       FROM users u LEFT JOIN arcade_balances b ON b.user_id=u.id WHERE u.id=${auth.sub}`,
     sql`SELECT id,amount,wallet,transaction_hash,payment_reference,status,requested_at,updated_at,completed_at,sent_at,failure_reason FROM withdrawals WHERE user_id=${auth.sub} ORDER BY requested_at DESC LIMIT 50`
    ]);if(!account[0])throw new Error('NOT_FOUND');const a=account[0],available=Math.max(0,Number(a.balance)-Number(a.reserved));
    return json(res,200,{ok:true,account:{balance:a.balance,reserved:a.reserved,available:available.toFixed(8),wallet:a.wallet_address,minimum:MIN,verificationStatus:a.has_sent||a.social_verified_at?'not_required':a.verification_status||'verification_required'},withdrawals:rows});
   }
   const input=await body(req),raw=String(input.amount||''),amount=Number(raw),key=String(input.idempotencyKey||'');
   if(!AMOUNT.test(raw)||!Number.isFinite(amount)||amount<MIN||!KEY.test(key))throw new Error('INVALID_INPUT');
   // Verify the one-time challenge server-side before entering the existing
   // withdrawal transaction. Success never reserves or deducts Arcade Balance.
   await verifyTurnstileToken({token:input.turnstileToken,remoteIp:requestIp(req),expectedAction:'arcade_withdrawal'});
   const row=await sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${String(auth.sub)}))`;
    const duplicate=await tx`SELECT * FROM withdrawals WHERE user_id=${auth.sub} AND idempotency_key=${key}`;if(duplicate[0])return duplicate[0];
    const users=await tx`SELECT id,wallet_address,social_verified_at FROM users WHERE id=${auth.sub} FOR UPDATE`;if(!users[0])throw new Error('NOT_FOUND');
    const balances=await tx`INSERT INTO arcade_balances(user_id) VALUES(${auth.sub}) ON CONFLICT(user_id) DO UPDATE SET updated_at=arcade_balances.updated_at RETURNING balance`;
    const sent=await tx`SELECT EXISTS(SELECT 1 FROM withdrawals WHERE user_id=${auth.sub} AND status='sent') value`;
    if(!sent[0].value&&!users[0].social_verified_at)throw new Error('VERIFICATION_REQUIRED');
    const pending=await tx`SELECT COALESCE(SUM(amount),0) reserved FROM withdrawals WHERE user_id=${auth.sub} AND status='pending'`;
    const available=Number(balances[0].balance)-Number(pending[0].reserved);if(amount>available+1e-10)throw new Error('INSUFFICIENT_ARCADE_BALANCE');
    const ws=await tx`INSERT INTO withdrawals(user_id,amount,wallet,status,idempotency_key) VALUES(${auth.sub},${raw},${users[0].wallet_address},'pending',${key}) RETURNING *`;
    await audit(tx,{userId:auth.sub,action:'withdrawal.requested',entityType:'withdrawal',entityId:ws[0].id,metadata:{amount:raw,wallet:users[0].wallet_address,availableAfter:(available-amount).toFixed(8)}});return ws[0];
   });json(res,201,{ok:true,withdrawal:row});
  }catch(e){fail(res,e);}
}
// ---- end route: withdrawals ----

// ---- route: socialVerification ----
const IMAGE=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const validImage=(mime,b)=>mime==='image/png'?b.length>=8&&b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):mime==='image/jpeg'?b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff:mime==='image/webp'?b.length>=12&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP':false;

async function socialVerification(req, res) {
  if(!method(req,res,['GET','POST']))return;
  try{const auth=requireAuth(req),sql=db();
   if(req.method==='GET'){const [user,rows]=await Promise.all([sql`SELECT social_verified_at FROM users WHERE id=${auth.sub}`,sql`SELECT id,x_username,submitted_at,status,reviewed_at,reviewer,review_note,attempt_number FROM social_verifications WHERE user_id=${auth.sub} ORDER BY submitted_at DESC LIMIT 20`]);if(!user[0])throw new Error('NOT_FOUND');return json(res,200,{ok:true,status:user[0].social_verified_at?'not_required':rows[0]?.status||'verification_required',submissions:rows});}
   const input=await body(req,1_200_000),username=String(input.xUsername||'').trim().replace(/^@/,''),match=String(input.screenshotData||'').match(IMAGE);
   if(!/^[A-Za-z0-9_]{1,15}$/.test(username)||!match)throw new Error('INVALID_INPUT');const image=Buffer.from(match[2],'base64');if(image.length<1024||image.length>800_000||!validImage(match[1],image))throw new Error('INVALID_INPUT');
   const record=await sql.begin(async tx=>{const users=await tx`SELECT social_verified_at FROM users WHERE id=${auth.sub} FOR UPDATE`;if(!users[0])throw new Error('NOT_FOUND');if(users[0].social_verified_at)throw new Error('CONFLICT');const pending=await tx`SELECT id FROM social_verifications WHERE user_id=${auth.sub} AND status='pending'`;if(pending[0])throw new Error('CONFLICT');const attempts=await tx`SELECT COALESCE(MAX(attempt_number),0)+1 attempt FROM social_verifications WHERE user_id=${auth.sub}`;const rows=await tx`INSERT INTO social_verifications(user_id,x_username,screenshot_reference,screenshot_data,screenshot_mime,attempt_number) VALUES(${auth.sub},${username},${`db:${auth.sub}:${attempts[0].attempt}`},${image},${match[1]},${attempts[0].attempt}) RETURNING id,x_username,submitted_at,status,attempt_number`;await audit(tx,{userId:auth.sub,action:'social.submitted',entityType:'social_verification',entityId:rows[0].id,metadata:{attempt:attempts[0].attempt}});return rows[0];});
   json(res,201,{ok:true,submission:record});
  }catch(e){fail(res,e);}
}
// ---- end route: socialVerification ----

// ---- route: arcadeSession ----
const GAMES = new Set([...REWARD_GAMES, ...NON_REWARD_GAMES].filter(g => g !== 'basketball'));
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
const sessionExpired = session => Date.now() - new Date(session.started_at).getTime() > SESSION_TTL_MS;

async function rejectSession(tx, session, reason) {
  const rows = await tx`UPDATE game_sessions SET reward=0, ended_at=NOW(), validation_status='rejected',
    validation_reason=${reason}, updated_at=NOW() WHERE id=${session.id} RETURNING *`;
  return rows[0];
}

async function arcadeSession(req, res) {
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
// ---- end route: arcadeSession ----
