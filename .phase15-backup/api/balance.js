import { requireAuth } from '../server/auth.js';
import { db } from '../server/db.js';
import { fail, json, method } from '../server/http.js';
export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const auth = requireAuth(req), sql = db();
    const rows = await sql`INSERT INTO arcade_balances (user_id) VALUES (${auth.sub})
      ON CONFLICT (user_id) DO UPDATE SET updated_at=arcade_balances.updated_at
      RETURNING balance, lifetime_earned, lifetime_withdrawn, updated_at`;
    const history = await sql`SELECT amount, balance_after, reason, created_at FROM arcade_reward_history
      WHERE user_id=${auth.sub} ORDER BY created_at DESC LIMIT 25`;
    const withdrawals = await sql`SELECT id, amount, wallet, transaction_hash, status, requested_at, updated_at, completed_at
      FROM withdrawals WHERE user_id=${auth.sub} ORDER BY requested_at DESC LIMIT 25`;
    json(res, 200, { ok: true, balance: rows[0], rewardHistory: history, withdrawalHistory: withdrawals });
  } catch (e) { fail(res, e); }
}
