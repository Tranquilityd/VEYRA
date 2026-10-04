import crypto from 'node:crypto';
import { verifyMessage, getAddress } from 'viem';
import { db } from './db.js';
import { env } from './env.js';

const b64 = (value) => Buffer.from(value).toString('base64url');
const sign = (value) => crypto.createHmac('sha256', env.sessionSecret()).update(value).digest('base64url');

export function issueSession(user) {
  const payload = b64(JSON.stringify({ sub: user.id, wallet: user.wallet_address, exp: Date.now() + 7 * 864e5 }));
  return `${payload}.${sign(payload)}`;
}

export function readSession(token) {
  if (!token || typeof token !== 'string') throw new Error('UNAUTHORIZED');
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) throw new Error('UNAUTHORIZED');
  const expected = sign(payload);
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('UNAUTHORIZED');
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw new Error('UNAUTHORIZED'); }
  if (!data.sub || !data.wallet || data.exp < Date.now()) throw new Error('UNAUTHORIZED');
  return data;
}

export function requireAuth(req) {
  const value = req.headers.authorization || '';
  if (!value.startsWith('Bearer ')) throw new Error('UNAUTHORIZED');
  return readSession(value.slice(7));
}

export function normalizeWallet(value) {
  try { return getAddress(String(value)).toLowerCase(); } catch { throw new Error('INVALID_INPUT'); }
}

export async function createChallenge(wallet) {
  const address = normalizeWallet(wallet);
  const sql = db();
  const nonce = crypto.randomBytes(24).toString('hex');
  const message = `${env.challengeDomain()} wants you to sign in to Veyra.\nWallet: ${address}\nNonce: ${nonce}\nExpires in: 5 minutes\nThis request does not trigger a transaction.`;
  await sql`INSERT INTO auth_challenges (wallet_address, nonce_hash, message, expires_at)
    VALUES (${address}, ${crypto.createHash('sha256').update(nonce).digest('hex')}, ${message}, NOW() + INTERVAL '5 minutes')`;
  return { address, nonce, message };
}

export async function verifyChallenge({ wallet, nonce, signature }) {
  const address = normalizeWallet(wallet);
  const sql = db();
  const hash = crypto.createHash('sha256').update(String(nonce || '')).digest('hex');
  const rows = await sql`SELECT id, message FROM auth_challenges
    WHERE wallet_address=${address} AND nonce_hash=${hash} AND used_at IS NULL AND expires_at > NOW()
    ORDER BY created_at DESC LIMIT 1`;
  if (!rows[0]) throw new Error('UNAUTHORIZED');
  const valid = await verifyMessage({ address, message: rows[0].message, signature });
  if (!valid) throw new Error('UNAUTHORIZED');
  return sql.begin(async (tx) => {
    const consumed = await tx`UPDATE auth_challenges SET used_at=NOW() WHERE id=${rows[0].id} AND used_at IS NULL RETURNING id`;
    if (!consumed[0]) throw new Error('UNAUTHORIZED');
    const users = await tx`INSERT INTO users (wallet_address, last_activity_at)
      VALUES (${address}, NOW()) ON CONFLICT (wallet_address) DO UPDATE SET last_activity_at=NOW()
      RETURNING id, wallet_address, created_at`;
    return users[0];
  });
}
