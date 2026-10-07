// Veyra — Phase 1: identity API router.
// Follows the consolidated `[route].js` convention already used by
// `api/admin/[route].js` and `api/blockchain/[route].js`, so the identity
// surface stays a single serverless function.
//
//   GET  /api/identity/me                          authenticated owner identity
//   GET  /api/identity/availability?username=NAME  public availability probe
//   POST /api/identity/claim     { username }      authenticated permanent claim
//   GET  /api/identity/lookup?username=NAME        public identity projection
import { requireAuth } from '../../server/auth.js';
import { db } from '../../server/db.js';
import { body, fail, json, method } from '../../server/http.js';
import {
  checkAvailability, claimIdentity, enforceIdentityRateLimit, identityIpHash,
  publicIdentity, readIdentity, resolveIdentityRecord,
} from '../../server/identity.js';

const query = (req, key) => {
  const value = req.query?.[key];
  return Array.isArray(value) ? value[0] : value;
};

export default async function handler(req, res) {
  const route = Array.isArray(req.query?.route) ? req.query.route[0] : req.query?.route;
  try {
    if (route === 'me') return await me(req, res);
    if (route === 'availability') return await availability(req, res);
    if (route === 'claim') return await claim(req, res);
    if (route === 'lookup') return await lookup(req, res);
    return json(res, 404, { ok: false, error: 'NOT_FOUND' });
  } catch (error) {
    fail(res, error);
  }
}

// The player's own record. Wallet address is only ever returned to its owner.
async function me(req, res) {
  if (!method(req, res, ['GET'])) return;
  const auth = requireAuth(req);
  json(res, 200, { ok: true, identity: await readIdentity(db(), auth.sub) });
}

// Public so onboarding can validate a name before a claim. Rate-limited because
// availability is inherently enumeration-sensitive.
async function availability(req, res) {
  if (!method(req, res, ['GET'])) return;
  const sql = db();
  await enforceIdentityRateLimit(sql, { ipHash: identityIpHash(req), action: 'availability' });
  json(res, 200, { ok: true, availability: await checkAvailability(sql, query(req, 'username')) });
}

async function claim(req, res) {
  if (!method(req, res, ['POST'])) return;
  const auth = requireAuth(req);
  const sql = db();
  await enforceIdentityRateLimit(sql, { ipHash: identityIpHash(req), action: 'claim' });
  const input = await body(req, 2048);
  json(res, 201, { ok: true, identity: await claimIdentity(sql, { userId: auth.sub, rawUsername: input.username }) });
}

// Resolves `lester.veyra` to its public identity only. The internal user id is
// deliberately not exposed; later phases resolve it server-side.
async function lookup(req, res) {
  if (!method(req, res, ['GET'])) return;
  const sql = db();
  await enforceIdentityRateLimit(sql, { ipHash: identityIpHash(req), action: 'lookup' });
  const record = await resolveIdentityRecord(sql, query(req, 'username'));
  if (!record) throw new Error('NOT_FOUND');
  json(res, 200, { ok: true, identity: publicIdentity(record) });
}
