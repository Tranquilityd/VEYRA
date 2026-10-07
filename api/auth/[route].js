// Veyra — Phase 1: auth API router.
//
// Follows the consolidated `[route].js` convention already used by
// `api/admin/[route].js`, `api/blockchain/[route].js`, `api/identity/[route].js`
// and `api/private-transfer/[route].js`, so the wallet sign-in surface stays a
// single serverless function instead of two.
//
//   POST /api/auth/challenge  { wallet }                    → { ok, address, nonce, message }
//   POST /api/auth/verify     { wallet, nonce, signature }  → { ok, token, user }
//
// Both routes are POST-only and keep their previous behaviour exactly: the same
// default body limit (`server/http.js` — 16 384 bytes), the same challenge
// generation and nonce hashing, the same signature verification and single-use
// nonce consumption, the same status codes, error codes and JSON shapes.
import { createChallenge, issueSession, verifyChallenge } from '../../server/auth.js';
import { body, fail, json, method } from '../../server/http.js';

export default async function handler(req, res) {
  const route = Array.isArray(req.query?.route) ? req.query.route[0] : req.query?.route;
  try {
    if (route === 'challenge') return await challenge(req, res);
    if (route === 'verify') return await verify(req, res);
    return json(res, 404, { ok: false, error: 'NOT_FOUND' });
  } catch (error) {
    fail(res, error);
  }
}

/** Former single-purpose challenge entry point — behaviour unchanged. */
async function challenge(req, res) {
  if (!method(req, res, ['POST'])) return;
  try { const input = await body(req); const out = await createChallenge(input.wallet); json(res, 200, { ok: true, ...out }); }
  catch (e) { fail(res, e); }
}

/** Former single-purpose verify entry point — behaviour unchanged. */
async function verify(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const user = await verifyChallenge(await body(req));
    json(res, 200, { ok: true, token: issueSession(user), user: { id: user.id, wallet: user.wallet_address, createdAt: user.created_at } });
  } catch (e) { fail(res, e); }
}
