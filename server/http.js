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
  const identityErrors = ['USERNAME_REQUIRED','USERNAME_TOO_SHORT','USERNAME_TOO_LONG','USERNAME_INVALID_CHARACTERS','USERNAME_MUST_START_WITH_LETTER','USERNAME_MUST_END_WITH_LETTER_OR_NUMBER','USERNAME_CONSECUTIVE_UNDERSCORES','USERNAME_RESERVED','USERNAME_TAKEN','USERNAME_ALREADY_CLAIMED','TOO_MANY_ATTEMPTS'];
  const identityConflicts = ['USERNAME_TAKEN','USERNAME_ALREADY_CLAIMED'];
  // Phase 3 — private transfer. Additive: existing codes keep their exact behaviour.
  const privateTransferErrors = ['PRIVATE_TRANSFER_NOT_ENROLLED','PRIVATE_TRANSFER_ALREADY_ENROLLED','PRIVATE_TRANSFER_USERNAME_REQUIRED','PRIVATE_TRANSFER_INVALID_META_ADDRESS','PRIVATE_TRANSFER_INVALID_PUBLIC_KEY','PRIVATE_TRANSFER_KEYS_NOT_DISTINCT','PRIVATE_TRANSFER_FINGERPRINT_MISMATCH','PRIVATE_TRANSFER_INVALID_SIGNATURE','PRIVATE_TRANSFER_SIGNATURE_REQUIRED','PRIVATE_TRANSFER_INVALID_ANNOUNCEMENT','PRIVATE_TRANSFER_DUPLICATE_ANNOUNCEMENT','PRIVATE_TRANSFER_UNSUPPORTED_CHAIN','PRIVATE_TRANSFER_UNSUPPORTED_SCHEME','PRIVATE_TRANSFER_UNSUPPORTED_PROTOCOL_VERSION','PRIVATE_TRANSFER_MALFORMED_RECORD','PRIVATE_TRANSFER_ADDRESS_PRESENT','RECIPIENT_NOT_ENROLLED','PRIVATE_TRANSFER_INVALID_INPUT'];
  const privateTransferConflicts = ['PRIVATE_TRANSFER_ALREADY_ENROLLED','PRIVATE_TRANSFER_DUPLICATE_ANNOUNCEMENT'];
  const safe = ['INVALID_JSON', 'BODY_TOO_LARGE', 'UNAUTHORIZED', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'VERIFICATION_REQUIRED', 'INSUFFICIENT_ARCADE_BALANCE', 'TURNSTILE_REQUIRED', 'TURNSTILE_FAILED', 'TURNSTILE_UNAVAILABLE', 'CAPTCHA_REQUIRED', 'CAPTCHA_FAILED', 'CAPTCHA_UNAVAILABLE', ...arcadeErrors, ...chainErrors, ...identityErrors, ...privateTransferErrors];
  const code = safe.includes(error.message) ? error.message : 'INTERNAL_ERROR';
  if (code === 'INTERNAL_ERROR') console.error(error);
  const status = (() => {
    if (code === 'UNAUTHORIZED') return 401;
    if (code === 'NOT_FOUND' || code === 'PRIVATE_TRANSFER_NOT_ENROLLED' || code === 'RECIPIENT_NOT_ENROLLED') return 404;
    if (code === 'TOO_MANY_ATTEMPTS') return 429;
    if (code === 'CONFLICT' || identityConflicts.includes(code) || privateTransferConflicts.includes(code)) return 409;
    if (code === 'PRIVATE_TRANSFER_ADDRESS_PRESENT') return 500;
    if (code.startsWith('PRIVATE_TRANSFER_')) return 400;
    if (code === 'BLOCKCHAIN_UNCONFIGURED' || code === 'CLAIM_CONTRACT_INTERFACE_REQUIRED') return 503;
    if (chainErrors.includes(code)) return 422;
    if (code === 'INTERNAL_ERROR') return 500;
    return 400;
  })();
  json(res, status, { ok: false, error: code });
}
