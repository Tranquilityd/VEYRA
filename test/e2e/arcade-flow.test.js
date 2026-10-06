import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import authHandler from '../../api/auth/[route].js';
import arcadeHandler from '../../api/account/[route].js';
import adminWithdrawalsHandler from '../../server/admin-withdrawals-handler.js';
import { issueAdminSession } from '../../server/admin.js';
import { db, closeDatabaseForTests } from '../../server/db.js';

if (process.env.NODE_ENV !== 'test' || !process.env.E2E_DATABASE_URL || process.env.DATABASE_URL !== process.env.E2E_DATABASE_URL) {
  throw new Error('Isolated E2E test must run through npm run test:e2e:casino with E2E_DATABASE_URL');
}
const schema = await readFile(new URL('../../db/schema.sql', import.meta.url), 'utf8');
const makeReq = (body = {}, token = null) => ({ method: 'POST', body, headers: token ? { authorization: `Bearer ${token}` } : {} });
const makeRes = () => ({ statusCode: 0, payload: null, setHeader() {}, hasHeader() { return false; }, end(raw) { this.payload = JSON.parse(raw); } });
// The Arcade session handler now lives in the consolidated account dispatcher;
// `req.query.route` is what Vercel populates for `api/account/[route].js`.
const call = async (body, token) => { const res = makeRes(); await arcadeHandler({ ...makeReq(body, token), query: { route: 'arcade-session' } }, res); return res; };
// Auth runs through the consolidated dispatcher; `req.query.route` is what
// Vercel populates for `api/auth/[route].js`.
const authCall = async (route, body) => { const res = makeRes(); await authHandler({ ...makeReq(body), query: { route } }, res); return res; };
const neonActions = c => { let x=500,y=500; const actions=[]; for(let t=0;t<c.ticks;t++){const [sx,sy]=c.path[t],a=[Math.abs(sx-x)>10?Math.sign(sx-x):0,Math.abs(sy-y)>10?Math.sign(sy-y):0];actions.push(a);let[dx,dy]=a;if(dx&&dy){dx*=Math.SQRT1_2;dy*=Math.SQRT1_2;}x=Math.max(0,Math.min(1000,x+dx*c.speed));y=Math.max(0,Math.min(1000,y+dy*c.speed));} return actions; };
const nbackResponses = c => c.sequence.slice(c.n).map((cell,i)=>({index:i+c.n,match:cell===c.sequence[i]}));

async function login(account) {
  const c = await authCall('challenge', { wallet: account.address });
  const signature = await account.signMessage({ message: c.payload.message });
  const v = await authCall('verify', { wallet: account.address, nonce: c.payload.nonce, signature });
  assert.equal(v.statusCode, 200); return v.payload.token;
}

test('database-backed server-authoritative Arcade rewards and replay/concurrency controls', async () => {
  const sql = db();
  await sql.unsafe(schema); // idempotent application over the casino E2E schema
  const before = (await sql`SELECT count(*)::int n FROM users`)[0].n;
  await sql.unsafe(schema);
  assert.equal((await sql`SELECT count(*)::int n FROM users`)[0].n, before, 'schema reapply preserves rows');

  const oldSecret = process.env.API_SESSION_SECRET, oldAdminSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.API_SESSION_SECRET ||= crypto.randomBytes(48).toString('hex');
  const a = privateKeyToAccount(generatePrivateKey()), b = privateKeyToAccount(generatePrivateKey());
  try {
    const tokenA = await login(a), tokenB = await login(b);

    // Exact solution submitted before the server's challenge window is impossible progression.
    const instant = await call({ action: 'start', game: 'memrush', clientSessionId: `e2e_${crypto.randomUUID().replaceAll('-', '')}` }, tokenA);
    const instantRound = await call({ action: 'round', sessionId: instant.payload.session.id }, tokenA);
    const tooFast = await call({ action: 'completeRound', sessionId: instant.payload.session.id, roundToken: instantRound.payload.round.token, events: instantRound.payload.round.cells }, tokenA);
    assert.equal(tooFast.payload.error, 'ARCADE_ROUND_TOO_FAST');
    assert.equal(Number((await sql`SELECT reward FROM game_sessions WHERE id=${instant.payload.session.id}`)[0].reward), 0);

    // Expired sessions cannot issue new progression or later receive a credit.
    const expired = await call({ action: 'start', game: 'tileshift', clientSessionId: `e2e_${crypto.randomUUID().replaceAll('-', '')}` }, tokenA);
    await sql`UPDATE game_sessions SET started_at=NOW()-INTERVAL '2 hours' WHERE id=${expired.payload.session.id}`;
    assert.equal((await call({ action: 'round', sessionId: expired.payload.session.id }, tokenA)).payload.error, 'ARCADE_SESSION_EXPIRED');

    const started = await call({ action: 'start', game: 'memrush', clientSessionId: `e2e_${crypto.randomUUID().replaceAll('-', '')}` }, tokenA);
    assert.equal(started.statusCode, 201); assert.equal(started.payload.rewardEnabled, true);
    const sessionId = started.payload.session.id;
    const issued = await call({ action: 'round', sessionId, game: 'tileshift', wave: 99 }, tokenA);
    assert.equal(issued.statusCode, 200);
    const round = issued.payload.round;
    assert.equal(round.kind, 'memrush'); assert.equal(round.wave, 1); // forged game/wave fields are ignored
    await sql`UPDATE arcade_rounds SET not_before=NOW()-INTERVAL '1 second' WHERE game_session_id=${sessionId}`;

    // Identity, session, token, solution and ordering attacks cannot advance state.
    assert.equal((await call({ action: 'completeRound', sessionId, roundToken: round.token, events: round.cells }, tokenB)).statusCode, 404);
    const other = await call({ action: 'start', game: 'memrush', clientSessionId: `e2e_${crypto.randomUUID().replaceAll('-', '')}` }, tokenA);
    assert.equal((await call({ action: 'completeRound', sessionId: other.payload.session.id, roundToken: round.token, events: round.cells }, tokenA)).payload.error, 'ARCADE_ROUND_TOKEN_INVALID');
    assert.equal((await call({ action: 'completeRound', sessionId, roundToken: `${round.token.slice(0, -1)}x`, events: round.cells }, tokenA)).payload.error, 'ARCADE_ROUND_TOKEN_INVALID');

    // Two simultaneous valid completions: exactly one consumes the row.
    const concurrent = await Promise.all([
      call({ action: 'completeRound', sessionId, roundToken: round.token, events: round.cells }, tokenA),
      call({ action: 'completeRound', sessionId, roundToken: round.token, events: round.cells }, tokenA),
    ]);
    assert.deepEqual(concurrent.map(r => r.statusCode).sort(), [200, 400]);
    assert.equal(Number((await sql`SELECT waves FROM game_sessions WHERE id=${sessionId}`)[0].waves), 1);
    assert.equal((await sql`SELECT count(*)::int n FROM arcade_rounds WHERE game_session_id=${sessionId} AND status='completed'`)[0].n, 1);

    // Client-supplied financial/outcome fields are ignored because finish has no such input contract.
    const finishes = await Promise.all([
      call({ action: 'finish', sessionId, waves: 999, score: 999999, reward: 999 }, tokenA),
      call({ action: 'finish', sessionId, waves: 0, score: 0, reward: -1 }, tokenA),
    ]);
    assert.ok(finishes.every(r => r.statusCode === 200));
    const session = (await sql`SELECT * FROM game_sessions WHERE id=${sessionId}`)[0];
    assert.equal(Number(session.waves), 1); assert.equal(Number(session.score), 1); assert.equal(String(session.reward), '0.00001000');
    assert.equal((await sql`SELECT count(*)::int n FROM arcade_reward_history WHERE game_session_id=${sessionId}`)[0].n, 1);
    assert.equal(String((await sql`SELECT balance FROM arcade_balances WHERE user_id=(SELECT user_id FROM game_sessions WHERE id=${sessionId})`)[0].balance), '0.00001000');
    assert.equal((await call({ action: 'completeRound', sessionId, roundToken: round.token, events: round.cells }, tokenA)).payload.error, 'ARCADE_SESSION_CLOSED');

    // Neon Escape uses bounded deterministic movement replay; one concurrent consumer wins.
    const neonStart=await call({action:'start',game:'neonescape',clientSessionId:`e2e_${crypto.randomUUID().replaceAll('-','')}`},tokenA);
    const neonId=neonStart.payload.session.id,neon=(await call({action:'round',sessionId:neonId},tokenA)).payload.round;
    await sql`UPDATE arcade_rounds SET not_before=NOW()-INTERVAL '1 second' WHERE game_session_id=${neonId}`;
    const neonEvents={actions:neonActions(neon)};
    const neonConcurrent=await Promise.all([call({action:'completeRound',sessionId:neonId,roundToken:neon.token,events:neonEvents,score:999,reward:999},tokenA),call({action:'completeRound',sessionId:neonId,roundToken:neon.token,events:neonEvents},tokenA)]);
    assert.deepEqual(neonConcurrent.map(r=>r.statusCode).sort(),[200,400]);
    await call({action:'finish',sessionId:neonId,waves:999,score:999,reward:999},tokenA);
    assert.equal(Number((await sql`SELECT waves FROM game_sessions WHERE id=${neonId}`)[0].waves),1);
    assert.equal((await sql`SELECT count(*)::int n FROM arcade_reward_history WHERE game_session_id=${neonId}`)[0].n,1);

    // N-Back validates sequence identity plus every ordered response and also consumes once.
    const nbStart=await call({action:'start',game:'nback',clientSessionId:`e2e_${crypto.randomUUID().replaceAll('-','')}`},tokenA);
    const nbId=nbStart.payload.session.id,nb=(await call({action:'round',sessionId:nbId},tokenA)).payload.round;
    await sql`UPDATE arcade_rounds SET not_before=NOW()-INTERVAL '1 second' WHERE game_session_id=${nbId}`;
    const nbEvents={sequenceId:nb.sequenceId,responses:nbackResponses(nb)};
    const nbConcurrent=await Promise.all([call({action:'completeRound',sessionId:nbId,roundToken:nb.token,events:nbEvents},tokenA),call({action:'completeRound',sessionId:nbId,roundToken:nb.token,events:nbEvents},tokenA)]);
    assert.deepEqual(nbConcurrent.map(r=>r.statusCode).sort(),[200,400]);
    await call({action:'finish',sessionId:nbId,score:5000,reward:5000},tokenA);
    assert.equal(Number((await sql`SELECT waves FROM game_sessions WHERE id=${nbId}`)[0].waves),1);
    assert.equal((await sql`SELECT count(*)::int n FROM arcade_reward_history WHERE game_session_id=${nbId}`)[0].n,1);

    // Concurrent admin "sent" requests lock the same withdrawal and deduct exactly once.
    process.env.ADMIN_SESSION_SECRET = crypto.randomBytes(48).toString('hex');
    const admin = issueAdminSession('e2e-admin');
    const userIdForWithdrawal = (await sql`SELECT user_id FROM game_sessions WHERE id=${sessionId}`)[0].user_id;
    await sql`UPDATE arcade_balances SET balance=0.02 WHERE user_id=${userIdForWithdrawal}`;
    const withdrawal = (await sql`INSERT INTO withdrawals(user_id,amount,wallet,status,idempotency_key)
      VALUES(${userIdForWithdrawal},0.01,${a.address.toLowerCase()},'pending',${crypto.randomUUID()}) RETURNING id`)[0];
    const adminCall = async () => {
      const req = { method:'POST', body:{ id:withdrawal.id, action:'sent', paymentReference:'e2e-manual-payment' }, headers:{
        cookie:`veyra_admin=${admin.token}`, 'x-csrf-token':admin.csrf, origin:'https://admin.e2e', host:'admin.e2e' } };
      const res = makeRes(); await adminWithdrawalsHandler(req,res); return res;
    };
    const sent = await Promise.all([adminCall(), adminCall()]);
    assert.ok(sent.every(r => r.statusCode === 200));
    assert.equal(String((await sql`SELECT balance FROM arcade_balances WHERE user_id=${userIdForWithdrawal}`)[0].balance), '0.01000000');
    assert.equal((await sql`SELECT count(*)::int n FROM audit_logs WHERE action='withdrawal.sent' AND entity_id=${withdrawal.id}`)[0].n, 1);

    // Retired game identifiers cannot create sessions or credit a balance.
    for (const game of ['zdodge','zshooter']) {
      const retired = await call({ action:'start', game, clientSessionId:`e2e_${crypto.randomUUID().replaceAll('-', '')}`, waves:1000, reward:1000 }, tokenA);
      assert.equal(retired.statusCode, 400); assert.equal(retired.payload.error, 'INVALID_INPUT');
    }

    // Simulate the retired withdrawal schema and prove migration preserves rows
    // while translating states into the current manual-payment lifecycle.
    const userId = (await sql`SELECT id FROM users WHERE wallet_address=${a.address.toLowerCase()}`)[0].id;
    await sql`ALTER TABLE withdrawals DROP CONSTRAINT withdrawals_status_check`;
    await sql`ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_status_check CHECK (status IN ('pending','eligible','submitted','confirmed','sent','cancelled','failed','rejected'))`;
    for (const status of ['eligible','submitted','confirmed','rejected']) {
      await sql`INSERT INTO withdrawals(user_id,amount,wallet,status) VALUES(${userId},0.01,${a.address.toLowerCase()},${status})`;
    }
    const idsBefore = (await sql`SELECT id FROM withdrawals WHERE user_id=${userId} ORDER BY id`).map(r => r.id);
    await sql.unsafe(schema);
    const migrated = await sql`SELECT id,status FROM withdrawals WHERE user_id=${userId} ORDER BY id`;
    assert.deepEqual(migrated.map(r => r.id), idsBefore);
    assert.deepEqual(migrated.map(r => r.status).sort(), ['cancelled','pending','sent','sent','sent']);
  } finally {
    oldSecret === undefined ? delete process.env.API_SESSION_SECRET : process.env.API_SESSION_SECRET = oldSecret;
    oldAdminSecret === undefined ? delete process.env.ADMIN_SESSION_SECRET : process.env.ADMIN_SESSION_SECRET = oldAdminSecret;
    await closeDatabaseForTests();
  }
});
