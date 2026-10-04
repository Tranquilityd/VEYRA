import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress,
  parseEther, recoverTypedDataAddress,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import challengeHandler from '../../api/auth/challenge.js';
import verifyHandler from '../../api/auth/verify.js';
import casinoSessionHandler from '../../api/casino/session.js';
import transactionHandler from '../../server/blockchain-transactions-handler.js';
import claimsHandler from '../../server/casino-claims-handler.js';
import { db, closeDatabaseForTests } from '../../server/db.js';
import { setBlockchainClientForTests, resetBlockchainClientForTests } from '../../server/blockchain.js';

if (process.env.NODE_ENV !== 'test' || !process.env.E2E_DATABASE_URL || process.env.DATABASE_URL !== process.env.E2E_DATABASE_URL) {
  throw new Error('Isolated E2E test must run through npm run test:e2e:casino with E2E_DATABASE_URL');
}

const abiDocument = JSON.parse(await readFile(new URL('../../config/abi/VeyraCasino.json', import.meta.url), 'utf8'));
const deployment = JSON.parse(await readFile(new URL('../../config/deployments/liteforge.json', import.meta.url), 'utf8'));
const schema = await readFile(new URL('../../db/schema.sql', import.meta.url), 'utf8');
const abi = abiDocument.abi;
const casino = getAddress(deployment.contracts.casino.address);
const WAGER_HASH = `0x${'11'.repeat(32)}`;
const GOOD_PAYOUT_HASH = `0x${'22'.repeat(32)}`;
const SESSION_ID = 900719925474099312345n;
const WAGER = '0.0005';
const PLAYER_OTHER = '0x0000000000000000000000000000000000000003';

const makeReq = (method, body = {}, token = null) => ({ method, body, headers: token ? { authorization: `Bearer ${token}` } : {} });
const makeRes = () => {
  const headers = new Map();
  return { statusCode: 0, payload: null, setHeader(k, v) { headers.set(k.toLowerCase(), v); }, hasHeader(k) { return headers.has(k.toLowerCase()); }, end(raw) { this.payload = JSON.parse(raw); } };
};
const call = async (handler, method, body, token) => { const res = makeRes(); await handler(makeReq(method, body, token), res); return res; };
const eventLog = (eventName, indexedArgs, dataTypes, dataValues) => ({
  address: casino,
  topics: encodeEventTopics({ abi, eventName, args: indexedArgs }),
  data: encodeAbiParameters(dataTypes, dataValues),
});

class FixtureClient {
  constructor() { this.transactions = new Map(); this.receipts = new Map(); this.latest = 200n; }
  add(hash, transaction, receipt) { this.transactions.set(hash, transaction); this.receipts.set(hash, receipt); }
  async getTransaction({ hash }) { const value = this.transactions.get(hash); if (!value) throw new Error('FIXTURE_TRANSACTION_MISSING'); return value; }
  async getTransactionReceipt({ hash }) { const value = this.receipts.get(hash); if (!value) { const e = new Error('fixture receipt missing'); e.name = 'ReceiptNotFoundError'; throw e; } return value; }
  async getBlockNumber() { return this.latest; }
}

const claimTypes = { ClaimAuthorization: [
  { name: 'player', type: 'address' }, { name: 'sessionId', type: 'uint256' },
  { name: 'wagerAmount', type: 'uint256' }, { name: 'payoutAmount', type: 'uint256' },
  { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
] };

test('isolated database-backed casino lifecycle', async () => {
  const sql = db();
  const existing = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','auth_challenges','casino_sessions','casino_claims','blockchain_transactions','audit_logs')`;
  assert.equal(existing.length, 0, 'E2E database must be empty and disposable');
  await sql.unsafe(schema);

  const playerKey = generatePrivateKey();
  const player = privateKeyToAccount(playerKey);
  const signerKey = generatePrivateKey();
  const signer = privateKeyToAccount(signerKey);
  process.env.API_SESSION_SECRET = crypto.randomBytes(48).toString('hex');
  process.env.VEYRA_CASINO_SIGNER_PRIVATE_KEY = signerKey;
  process.env.VEYRA_CASINO_SIGNER_ADDRESS = signer.address;

  const fixtures = new FixtureClient();
  setBlockchainClientForTests(fixtures);

  try {
    // Authentication: real challenge, signature verification, token, and replay rejection.
    const challenge = await call(challengeHandler, 'POST', { wallet: player.address });
    assert.equal(challenge.statusCode, 200);
    const loginSignature = await player.signMessage({ message: challenge.payload.message });
    const authenticated = await call(verifyHandler, 'POST', { wallet: player.address, nonce: challenge.payload.nonce, signature: loginSignature });
    assert.equal(authenticated.statusCode, 200);
    const token = authenticated.payload.token;
    assert.ok(token);
    const replay = await call(verifyHandler, 'POST', { wallet: player.address, nonce: challenge.payload.nonce, signature: loginSignature });
    assert.equal(replay.statusCode, 401);
    assert.equal((await sql`SELECT count(*)::int AS n FROM users`)[0].n, 1);
    assert.ok((await sql`SELECT used_at FROM auth_challenges`)[0].used_at);

    // Wager boundary and authentication checks use exact atomic units.
    const hashFor = n => `0x${n.toString(16).padStart(64, '0')}`;
    assert.equal((await call(casinoSessionHandler, 'POST', { game: 'plinko', wager: '0.0005', wagerTxHash: hashFor(101) }, null)).statusCode, 401);
    const boundaries = [['0.000499999999999999',400],['1.000000000000000001',400],['NaN',400],['abc',400],['0.0005',202],['1',202]];
    for (const [index, [wager, expected]] of boundaries.entries()) {
      assert.equal((await call(casinoSessionHandler, 'POST', { game: 'coin', wager, wagerTxHash: hashFor(102 + index), clientSeed: 'e2e-client-seed' }, token)).statusCode, expected, wager);
    }

    // Session creation rejects client authority over outcome and payout by ignoring those fields.
    const created = await call(casinoSessionHandler, 'POST', { game: 'plinko', wager: WAGER, wagerTxHash: WAGER_HASH, clientSeed: 'e2e-client-seed', outcome: 'client-forged', payout: '999' }, token);
    assert.equal(created.statusCode, 202);
    const backendSessionId = created.payload.session.id;
    let session = (await sql`SELECT * FROM casino_sessions WHERE id=${backendSessionId}`)[0];
    assert.equal(session.status, 'pending_verification');
    assert.ok(session.result?.fairness?.serverSeedSecret, 'private commitment is stored server-side');
    assert.equal(created.payload.session.fairness.serverSeedSecret, undefined, 'creation response never reveals the seed');
    assert.equal(session.result.outcome, undefined);
    assert.equal(session.payout, null);

    // Real ABI event fixture through the real transaction-verification path.
    fixtures.add(WAGER_HASH, {
      to: casino, from: player.address, input: '0xb1cc4348', value: parseEther(WAGER),
    }, {
      status: 'success', blockNumber: 190n,
      logs: [eventLog('WagerPlaced', { player: player.address, sessionId: SESSION_ID }, [{ type: 'uint256' }], [parseEther(WAGER)])],
    });
    const wagerTracked = await call(transactionHandler, 'POST', { type: 'casino_wager', transactionHash: WAGER_HASH }, token);
    assert.equal(wagerTracked.statusCode, 200);
    session = (await sql`SELECT * FROM casino_sessions WHERE id=${backendSessionId}`)[0];
    assert.equal(session.status, 'wager_confirmed');
    const wagerChain = (await sql`SELECT * FROM blockchain_transactions WHERE transaction_hash=${WAGER_HASH}`)[0];
    assert.equal(wagerChain.status, 'confirmed');
    assert.equal(wagerChain.metadata.onchainSessionId, SESSION_ID.toString());
    assert.ok((await sql`SELECT count(*)::int AS n FROM audit_logs WHERE action='blockchain.confirmed'`)[0].n >= 1);

    // Real outcome path; Plinko always has a positive configured multiplier.
    const resolved = await call(casinoSessionHandler, 'POST', { action: 'resolve', sessionId: backendSessionId, ballCount: 1, risk: 'low' }, token);
    assert.equal(resolved.statusCode, 200);
    assert.equal(resolved.payload.session.result.engine, 'veyra-backend');
    assert.ok(Number(resolved.payload.session.payout) > 0);
    const resolvedAgain = await call(casinoSessionHandler, 'POST', { action: 'resolve', sessionId: backendSessionId, ballCount: 1, risk: 'low' }, token);
    assert.equal(resolvedAgain.statusCode, 200);
    assert.equal((await sql`SELECT count(*)::int AS n FROM casino_claims WHERE casino_session_id=${backendSessionId}`)[0].n, 1);

    // Missing metadata must fail before authorization, then the verified value is restored.
    await sql`UPDATE blockchain_transactions SET metadata='{}'::jsonb WHERE transaction_hash=${WAGER_HASH}`;
    const missingSession = await call(claimsHandler, 'POST', { action: 'prepare', sessionId: backendSessionId }, token);
    assert.equal(missingSession.statusCode, 422);
    assert.equal(missingSession.payload.error, 'ONCHAIN_SESSION_ID_MISSING');
    await sql`UPDATE blockchain_transactions SET metadata=${sql.json(wagerChain.metadata)} WHERE transaction_hash=${WAGER_HASH}`;

    // Real claim preparation with an ephemeral signer.
    let prepared = await call(claimsHandler, 'POST', { action: 'prepare', sessionId: backendSessionId }, token);
    assert.equal(prepared.statusCode, 200);
    let claim = prepared.payload.claim;
    const authorization = claim.authorization;
    assert.equal(getAddress(authorization.player), getAddress(player.address));
    assert.equal(authorization.sessionId, SESSION_ID.toString());
    assert.equal(authorization.wagerAmount, parseEther(WAGER).toString());
    assert.ok(BigInt(authorization.nonce) > BigInt(Number.MAX_SAFE_INTEGER));
    assert.ok(BigInt(authorization.deadline) > BigInt(Math.floor(Date.now() / 1000)));
    const recovered = await recoverTypedDataAddress({
      domain: { name: 'VeyraCasino', version: '1', chainId: 4441, verifyingContract: casino },
      types: claimTypes, primaryType: 'ClaimAuthorization',
      message: {
        player: authorization.player, sessionId: BigInt(authorization.sessionId), wagerAmount: BigInt(authorization.wagerAmount),
        payoutAmount: BigInt(authorization.payoutAmount), nonce: BigInt(authorization.nonce), deadline: BigInt(authorization.deadline),
      }, signature: authorization.signature,
    });
    assert.equal(getAddress(recovered), getAddress(signer.address));
    assert.equal(JSON.stringify((await sql`SELECT authorization_payload FROM casino_claims WHERE id=${claim.id}`)[0]).includes(signerKey), false);

    // Unconfirmed/ineligible session cannot resolve or prepare a claim.
    const pendingHash = `0x${'44'.repeat(32)}`;
    const pendingCreated = await call(casinoSessionHandler, 'POST', { game: 'plinko', wager: WAGER, wagerTxHash: pendingHash, clientSeed: 'e2e-client-seed' }, token);
    const pendingId = pendingCreated.payload.session.id;
    assert.equal((await call(casinoSessionHandler, 'POST', { action: 'resolve', sessionId: pendingId }, token)).statusCode, 409);
    assert.equal((await call(claimsHandler, 'POST', { action: 'prepare', sessionId: pendingId }, token)).statusCode, 422);

    const payoutValue = BigInt(authorization.payoutAmount);
    const addPayoutFixture = (hash, { eventPlayer = player.address, amount = payoutValue, sessionId = SESSION_ID, nonce = BigInt(authorization.nonce), status = 'success' } = {}) => {
      const calldata = encodeFunctionData({ abi, functionName: 'claimWinnings', args: [{
        player: authorization.player, sessionId: BigInt(authorization.sessionId), wagerAmount: BigInt(authorization.wagerAmount),
        payoutAmount: BigInt(authorization.payoutAmount), nonce: BigInt(authorization.nonce), deadline: BigInt(authorization.deadline),
      }, authorization.signature] });
      fixtures.add(hash, { to: casino, from: player.address, input: calldata, value: 0n }, {
        status, blockNumber: 191n,
        logs: status === 'success' ? [eventLog('WinningsClaimed', { player: eventPlayer, sessionId, nonce }, [{ type: 'uint256' }], [amount])] : [],
      });
    };
    const unchanged = async () => {
      const c = (await sql`SELECT status FROM casino_claims WHERE id=${claim.id}`)[0];
      const s = (await sql`SELECT status FROM casino_sessions WHERE id=${backendSessionId}`)[0];
      assert.equal(c.status, 'authorized'); assert.equal(s.status, 'resolved');
    };

    // Negative event binding cases cannot settle database state.
    const negative = [
      [`0x${'31'.repeat(32)}`, { eventPlayer: PLAYER_OTHER }, 'TRANSACTION_USER_MISMATCH'],
      [`0x${'32'.repeat(32)}`, { amount: payoutValue + 1n }, 'TRANSACTION_AMOUNT_MISMATCH'],
      [`0x${'33'.repeat(32)}`, { sessionId: SESSION_ID + 1n }, 'TRANSACTION_SESSION_MISMATCH'],
      [`0x${'34'.repeat(32)}`, { nonce: BigInt(authorization.nonce) + 1n }, 'TRANSACTION_NONCE_MISMATCH'],
    ];
    for (const [hash, fixture, error] of negative) {
      addPayoutFixture(hash, fixture);
      const response = await call(transactionHandler, 'POST', { type: 'casino_payout', transactionHash: hash, relatedId: claim.id }, token);
      assert.equal(response.statusCode, 422); assert.equal(response.payload.error, error); await unchanged();
    }

    // Simulate the contract rejecting an expired authorization; no settlement occurs.
    const expiredHash = `0x${'35'.repeat(32)}`;
    await sql`UPDATE casino_claims SET authorization_payload=authorization_payload || ${sql.json({ deadline: '1' })}, expires_at=to_timestamp(1) WHERE id=${claim.id}`;
    addPayoutFixture(expiredHash, { status: 'reverted' });
    const expired = await call(transactionHandler, 'POST', { type: 'casino_payout', transactionHash: expiredHash, relatedId: claim.id }, token);
    assert.equal(expired.statusCode, 202);
    assert.equal((await sql`SELECT status FROM casino_claims WHERE id=${claim.id}`)[0].status, 'failed');
    assert.equal((await sql`SELECT status FROM casino_sessions WHERE id=${backendSessionId}`)[0].status, 'resolved');

    // Re-prepare after the failed/expired authorization, then settle with exact event values.
    prepared = await call(claimsHandler, 'POST', { action: 'prepare', sessionId: backendSessionId }, token);
    assert.equal(prepared.statusCode, 200); claim = prepared.payload.claim;
    const current = claim.authorization;
    assert.notEqual(current.nonce, authorization.nonce);
    const currentPayout = BigInt(current.payoutAmount);
    const currentCalldata = encodeFunctionData({ abi, functionName: 'claimWinnings', args: [{
      player: current.player, sessionId: BigInt(current.sessionId), wagerAmount: BigInt(current.wagerAmount), payoutAmount: currentPayout,
      nonce: BigInt(current.nonce), deadline: BigInt(current.deadline),
    }, current.signature] });
    fixtures.add(GOOD_PAYOUT_HASH, { to: casino, from: player.address, input: currentCalldata, value: 0n }, {
      status: 'success', blockNumber: 192n,
      logs: [eventLog('WinningsClaimed', { player: current.player, sessionId: BigInt(current.sessionId), nonce: BigInt(current.nonce) }, [{ type: 'uint256' }], [currentPayout])],
    });
    const paid = await call(transactionHandler, 'POST', { type: 'casino_payout', transactionHash: GOOD_PAYOUT_HASH, relatedId: claim.id }, token);
    assert.equal(paid.statusCode, 200);
    const finalClaim = (await sql`SELECT * FROM casino_claims WHERE id=${claim.id}`)[0];
    const finalSession = (await sql`SELECT * FROM casino_sessions WHERE id=${backendSessionId}`)[0];
    assert.equal(finalClaim.status, 'claimed');
    assert.equal(finalClaim.transaction_hash, GOOD_PAYOUT_HASH);
    assert.equal(finalSession.status, 'paid');
    assert.equal(finalSession.payout_tx_hash, GOOD_PAYOUT_HASH);
    assert.ok((await sql`SELECT count(*)::int AS n FROM audit_logs WHERE action='blockchain.confirmed'`)[0].n >= 2);

    // Duplicate hash/claim submission cannot settle anything else or alter final state.
    const duplicate = await call(transactionHandler, 'POST', { type: 'casino_payout', transactionHash: GOOD_PAYOUT_HASH, relatedId: claim.id }, token);
    assert.equal(duplicate.statusCode, 422);
    assert.equal((await sql`SELECT status FROM casino_claims WHERE id=${claim.id}`)[0].status, 'claimed');
    assert.equal((await sql`SELECT status FROM casino_sessions WHERE id=${backendSessionId}`)[0].status, 'paid');
  } finally {
    resetBlockchainClientForTests();
    delete process.env.API_SESSION_SECRET;
    delete process.env.VEYRA_CASINO_SIGNER_PRIVATE_KEY;
    delete process.env.VEYRA_CASINO_SIGNER_ADDRESS;
    await closeDatabaseForTests();
  }
});
