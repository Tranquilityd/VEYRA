// Veyra — Phase 3: private transfer API router.
//
// Follows the consolidated `[route].js` convention used by `api/identity/[route].js`
// and `api/admin/[route].js`, so the whole private-transfer surface is one
// serverless function.
//
//   POST /api/private-transfer/enroll        authenticated; public material only
//   GET  /api/private-transfer/me            authenticated; own identity (public)
//   GET  /api/private-transfer/resolve       public, rate-limited; never an address
//   GET  /api/private-transfer/announcements public, rate-limited; unfiltered page
//   POST /api/private-transfer/announcements authenticated; public announcement
//   POST /api/private-transfer/payments      authenticated; reconciliation row
//   POST /api/private-transfer/payment-announcement    authenticated; attach tx hash
//   GET  /api/private-transfer/payments      authenticated; own reconciliation list
//
// There is deliberately NO route of the form /api/private-transfer/<username>/… :
// a per-user scan or announcement list would let anyone map a `.veyra` name to
// private payments (brief §10). Scanning happens locally in the browser.
import { requireAuth } from '../../server/auth.js';
import { db } from '../../server/db.js';
import { body, fail, json, method } from '../../server/http.js';
import {
  PRIVATE_TRANSFER_ERRORS, assertNoWalletAddress, attachAnnouncementToPayment,
  enforcePrivateTransferRateLimit, enrollPrivateTransferIdentity, listAnnouncements,
  listPrivateTransferPayments, privateTransferIpHash, readPrivateTransferIdentity,
  recordAnnouncement, recordPrivateTransferPayment, resolvePrivateTransferIdentity,
} from '../../server/private-transfer.js';

const query = (req, key) => {
  const value = req.query?.[key];
  return Array.isArray(value) ? value[0] : value;
};

export default async function handler(req, res) {
  const route = Array.isArray(req.query?.route) ? req.query.route[0] : req.query?.route;
  const segments = String(route ?? '').split('/').filter(Boolean);
  try {
    if (segments[0] === 'enroll' && segments.length === 1) return await enroll(req, res);
    if (segments[0] === 'me' && segments.length === 1) return await me(req, res);
    if (segments[0] === 'resolve' && segments.length === 1) return await resolve(req, res);
    if (segments[0] === 'announcements' && segments.length === 1) return await announcements(req, res);
    // Single-segment routes only: `api/private-transfer/[route].js` matches exactly one
    // path segment, so a nested path would silently 404 in production.
    if (segments[0] === 'payments' && segments.length === 1) return await payments(req, res);
    if (segments[0] === 'payment-announcement' && segments.length === 1) return await paymentAnnouncement(req, res);
    return json(res, 404, { ok: false, error: 'NOT_FOUND' });
  } catch (error) {
    fail(res, error);
  }
}

/** Authenticated enrollment. Accepts public material only. */
async function enroll(req, res) {
  if (!method(req, res, ['POST'])) return;
  const auth = requireAuth(req);
  const sql = db();
  await enforcePrivateTransferRateLimit(sql, { ipHash: privateTransferIpHash(req), action: 'enroll' });
  const input = await body(req, 4096);
  const identity = await enrollPrivateTransferIdentity(sql, { userId: auth.sub, input, walletClass: input.walletClass === 'contract' ? 'contract' : 'eoa' });
  assertNoWalletAddress(identity);
  json(res, 201, { ok: true, identity });
}

/** The caller's own identity. Public projection only — never a wallet address. */
async function me(req, res) {
  if (!method(req, res, ['GET'])) return;
  const auth = requireAuth(req);
  const identity = await readPrivateTransferIdentity(db(), auth.sub);
  if (!identity) throw new Error('PRIVATE_TRANSFER_NOT_ENROLLED');
  assertNoWalletAddress(identity);
  json(res, 200, { ok: true, identity });
}

/**
 * Public resolution of `bob.veyra` → public stealth material.
 * Rate-limited and enumeration-safe: an unenrolled account and an unknown account
 * are indistinguishable to the caller (both are 404 with a generic code).
 */
async function resolve(req, res) {
  if (!method(req, res, ['GET'])) return;
  const sql = db();
  await enforcePrivateTransferRateLimit(sql, { ipHash: privateTransferIpHash(req), action: 'resolve' });
  let identity;
  try {
    identity = await resolvePrivateTransferIdentity(sql, query(req, 'username'));
  } catch (error) {
    if (error.message === 'RECIPIENT_NOT_ENROLLED') return json(res, 404, { ok: false, error: 'NOT_FOUND' });
    throw error;
  }
  if (!identity) return json(res, 404, { ok: false, error: 'NOT_FOUND' });
  assertNoWalletAddress(identity);
  json(res, 200, { ok: true, identity });
}

/** Public paginated announcements. No per-user filter exists in this route. */
async function announcements(req, res) {
  // Method first (never read a query for a non-GET, never read a body for a GET).
  if (req.method !== 'GET' && req.method !== 'POST') return method(req, res, ['GET', 'POST']);
  if (req.method === 'GET') {
    const sql = db();
    await enforcePrivateTransferRateLimit(sql, { ipHash: privateTransferIpHash(req), action: 'announcements' });
    const page = await listAnnouncements(sql, { cursor: query(req, 'cursor'), limit: query(req, 'limit') });
    return json(res, 200, { ok: true, ...page });
  }
  if (req.method === 'POST') {
    const auth = requireAuth(req);
    const sql = db();
    const input = await body(req, 4096);
    const result = await recordAnnouncement(sql, { userId: auth.sub, input, ipHash: privateTransferIpHash(req) });
    return json(res, result.duplicate ? 200 : 201, { ok: true, announcementId: result.id, duplicate: result.duplicate });
  }
  return method(req, res, ['GET', 'POST']);
}

async function payments(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return method(req, res, ['GET', 'POST']);
  const auth = requireAuth(req);
  const sql = db();
  if (req.method === 'GET') {
    return json(res, 200, { ok: true, payments: await listPrivateTransferPayments(sql, { userId: auth.sub, limit: query(req, 'limit') }) });
  }
  if (req.method === 'POST') {
    const input = await body(req, 4096);
    const result = await recordPrivateTransferPayment(sql, { userId: auth.sub, input, ipHash: privateTransferIpHash(req) });
    return json(res, 201, { ok: true, ...result });
  }
  return method(req, res, ['GET', 'POST']);
}

/** Attach the announcement transaction to an existing payment (retry path only). */
async function paymentAnnouncement(req, res) {
  if (!method(req, res, ['POST'])) return;
  const auth = requireAuth(req);
  const input = await body(req, 2048);
  const result = await attachAnnouncementToPayment(db(), {
    userId: auth.sub,
    paymentId: input.paymentId,
    announcementTxHash: input.announcementTxHash,
    status: input.status,
  });
  json(res, 200, { ok: true, ...result });
}

export { PRIVATE_TRANSFER_ERRORS };
