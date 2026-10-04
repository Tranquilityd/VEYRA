export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!res.hasHeader?.('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function method(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader('Allow', allowed.join(', '));
  json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  return false;
}

export async function body(req, maxBytes = 16_384) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) throw new Error('BODY_TOO_LARGE');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('INVALID_JSON'); }
}

export function fail(res, error) {
  const chainErrors = ['BLOCKCHAIN_UNCONFIGURED','CLAIM_CONTRACT_INTERFACE_REQUIRED','CLAIM_NOT_ELIGIBLE','CLAIM_NOT_AUTHORIZED','CLAIM_ALREADY_CLAIMED','WAGER_NOT_CONFIRMED','ONCHAIN_SESSION_ID_MISSING','CASINO_SIGNER_ADDRESS_MISMATCH','CONTRACT_MISMATCH','CONTRACT_METHOD_MISMATCH','CONTRACT_EVENT_MISSING','VERIFICATION_FIELD_MISSING','TRANSACTION_USER_MISMATCH','TRANSACTION_AMOUNT_MISMATCH','TRANSACTION_SESSION_MISMATCH','TRANSACTION_NONCE_MISMATCH'];
  const arcadeErrors = ['ARCADE_REWARD_UNAVAILABLE','ARCADE_SESSION_CLOSED','ARCADE_SESSION_EXPIRED','ARCADE_SESSION_LIMIT','ARCADE_ROUND_REPLAY','ARCADE_ROUND_EXPIRED','ARCADE_ROUND_TOKEN_INVALID','ARCADE_ROUND_OUT_OF_ORDER','ARCADE_ROUND_TOO_FAST','ARCADE_ROUND_INVALID'];
  const safe = ['INVALID_JSON', 'BODY_TOO_LARGE', 'UNAUTHORIZED', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'VERIFICATION_REQUIRED', 'INSUFFICIENT_ARCADE_BALANCE', 'TURNSTILE_REQUIRED', 'TURNSTILE_FAILED', 'TURNSTILE_UNAVAILABLE', 'CAPTCHA_REQUIRED', 'CAPTCHA_FAILED', 'CAPTCHA_UNAVAILABLE', ...arcadeErrors, ...chainErrors];
  const code = safe.includes(error.message) ? error.message : 'INTERNAL_ERROR';
  if (code === 'INTERNAL_ERROR') console.error(error);
  const status = code === 'UNAUTHORIZED' ? 401 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : ['BLOCKCHAIN_UNCONFIGURED','CLAIM_CONTRACT_INTERFACE_REQUIRED'].includes(code) ? 503 : chainErrors.includes(code) ? 422 : code === 'INTERNAL_ERROR' ? 500 : 400;
  json(res, status, { ok: false, error: code });
}
