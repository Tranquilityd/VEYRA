import { createChallenge } from '../../server/auth.js';
import { body, fail, json, method } from '../../server/http.js';
export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  try { const input = await body(req); const out = await createChallenge(input.wallet); json(res, 200, { ok: true, ...out }); }
  catch (e) { fail(res, e); }
}
