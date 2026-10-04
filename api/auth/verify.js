import { issueSession, verifyChallenge } from '../../server/auth.js';
import { body, fail, json, method } from '../../server/http.js';
export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try {
    const user = await verifyChallenge(await body(req));
    json(res, 200, { ok: true, token: issueSession(user), user: { id: user.id, wallet: user.wallet_address, createdAt: user.created_at } });
  } catch (e) { fail(res, e); }
}
