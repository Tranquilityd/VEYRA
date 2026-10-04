
import crypto from 'node:crypto';
import { getAddress, parseUnits } from 'viem';
import { requireAuth } from './auth.js';
import { loadBlockchainConfig } from './blockchain-config.js';
import { signCasinoClaim } from './casino-signer.js';
import { db } from './db.js';
import { audit } from './audit.js';
import { body, fail, json, method } from './http.js';
import { env } from './env.js';

const UUID = /^[0-9a-f-]{36}$/i;
const CLAIM_TTL_SECONDS = 10 * 60;

const view = (c) => ({
  id: c.id,
  casinoSessionId: c.casino_session_id,
  playerWallet: c.player_wallet,
  wager: c.wager,
  payout: c.payout,
  status: c.status,
  transactionHash: c.transaction_hash,
  expiresAt: c.expires_at,
  createdAt: c.created_at,
  authorizedAt: c.authorized_at,
  submittedAt: c.submitted_at,
  confirmedAt: c.confirmed_at,
  claimedAt: c.claimed_at,
  authorization: c.status === 'authorized' ? c.authorization_payload : null,
});

const nonce = () => `0x${crypto.randomBytes(32).toString('hex')}`;
export function onchainSessionIdFromWagerTransaction(wagerTx) {
  const value = wagerTx?.metadata?.onchainSessionId;
  if (value === null || value === undefined || String(value) === '') {
    throw new Error('ONCHAIN_SESSION_ID_MISSING');
  }
  try { return BigInt(String(value)).toString(); }
  catch { throw new Error('ONCHAIN_SESSION_ID_MISSING'); }
}

export default async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;

  try {
    const auth = requireAuth(req);
    const sql = db();

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT *
        FROM casino_claims
        WHERE user_id=${auth.sub}
        ORDER BY created_at DESC
        LIMIT 100
      `;

      return json(res, 200, {
        ok: true,
        claims: rows.map(view),
      });
    }

    const input = await body(req, 8192);
    if (!loadBlockchainConfig()) throw new Error('BLOCKCHAIN_UNCONFIGURED');

    if (
      String(input.action || 'prepare') !== 'prepare' ||
      !UUID.test(String(input.sessionId || ''))
    ) {
      throw new Error('INVALID_INPUT');
    }

    const claim = await sql.begin(async tx => {
      const sessions = await tx`
        SELECT
          c.*,
          u.wallet_address
        FROM casino_sessions c
        JOIN users u ON u.id=c.user_id
        WHERE c.id=${input.sessionId}
          AND c.user_id=${auth.sub}
        FOR UPDATE OF c
      `;

      const session = sessions[0];

      if (!session) throw new Error('NOT_FOUND');

      if (
        session.status !== 'resolved' ||
        !(Number(session.payout) > 0)
      ) {
        throw new Error('CLAIM_NOT_ELIGIBLE');
      }

      const wallet = getAddress(session.wallet_address);

      /*
       * The wager must already have been independently verified on-chain.
       * The blockchain transaction metadata contains the numeric
       * VeyraCasino session ID extracted from WagerPlaced.
       */
      const wagerRows = await tx`
        SELECT
          transaction_hash,
          amount,
          status,
          metadata
        FROM blockchain_transactions
        WHERE user_id=${auth.sub}
          AND type='casino_wager'
          AND related_entity_id=${session.id}
        ORDER BY checked_at DESC NULLS LAST
        LIMIT 1
      `;

      const wagerTx = wagerRows[0];

      if (!wagerTx || wagerTx.status !== 'confirmed') {
        throw new Error('WAGER_NOT_CONFIRMED');
      }

      const onchainSessionId = onchainSessionIdFromWagerTransaction(wagerTx);

      if (String(wagerTx.amount) !== String(session.wager)) {
        throw new Error('TRANSACTION_AMOUNT_MISMATCH');
      }

      const existingRows = await tx`
        SELECT *
        FROM casino_claims
        WHERE casino_session_id=${session.id}
        FOR UPDATE
      `;

      const existing = existingRows[0];

      if (existing) {
        if (
          getAddress(existing.player_wallet).toLowerCase() !==
          wallet.toLowerCase()
        ) {
          throw new Error('TRANSACTION_USER_MISMATCH');
        }

        if (existing.status === 'claimed') {
          throw new Error('CLAIM_ALREADY_CLAIMED');
        }

        if (
          existing.status === 'authorized' &&
          existing.expires_at &&
          new Date(existing.expires_at).getTime() > Date.now()
        ) {
          return existing;
        }
      }

      const wagerAmount = parseUnits(String(session.wager), 18);
      const payoutAmount = parseUnits(String(session.payout), 18);
      const claimNonce = nonce();
      const deadline = Math.floor(Date.now() / 1000) + CLAIM_TTL_SECONDS;

      const signed = await signCasinoClaim({
        player: wallet,
        sessionId: String(onchainSessionId),
        wagerAmount,
        payoutAmount,
        nonce: claimNonce,
        deadline,
      });

      if (
        signed.signer.toLowerCase() !==
        getAddress(env.casinoSignerAddress()).toLowerCase()
      ) {
        throw new Error('CASINO_SIGNER_ADDRESS_MISMATCH');
      }

      const authorizationPayload = {
        player: signed.authorization.player,
        sessionId: signed.authorization.sessionId,
        wagerAmount: signed.authorization.wagerAmount,
        payoutAmount: signed.authorization.payoutAmount,
        nonce: signed.authorization.nonce,
        deadline: signed.authorization.deadline,
        signature: signed.signature,
      };

      const authorizationReference = crypto
        .createHash('sha256')
        .update(signed.signature)
        .digest('hex');

      let rows;

      if (existing) {
        rows = await tx`
          UPDATE casino_claims
          SET
            player_wallet=${wallet},
            wager=${session.wager},
            payout=${session.payout},
            claim_nonce=${claimNonce},
            authorization_payload=${tx.json(authorizationPayload)},
            authorization_reference=${authorizationReference},
            status='authorized',
            expires_at=to_timestamp(${deadline}),
            authorized_at=NOW(),
            failure_reason=NULL,
            updated_at=NOW()
          WHERE id=${existing.id}
          RETURNING *
        `;
      } else {
        rows = await tx`
          INSERT INTO casino_claims(
            casino_session_id,
            user_id,
            player_wallet,
            wager,
            payout,
            claim_nonce,
            authorization_payload,
            authorization_reference,
            status,
            expires_at,
            authorized_at
          )
          VALUES(
            ${session.id},
            ${auth.sub},
            ${wallet},
            ${session.wager},
            ${session.payout},
            ${claimNonce},
            ${tx.json(authorizationPayload)},
            ${authorizationReference},
            'authorized',
            to_timestamp(${deadline}),
            NOW()
          )
          RETURNING *
        `;
      }

      await audit(tx, {
        userId: auth.sub,
        action: 'casino.claim_authorized',
        entityType: 'casino_claim',
        entityId: rows[0].id,
        metadata: {
          sessionId: session.id,
          onchainSessionId: String(onchainSessionId),
          wallet,
          wager: String(session.wager),
          payout: String(session.payout),
          authorizationReference,
        },
      });

      return rows[0];
    });

    return json(res, 200, {
      ok: true,
      claim: view(claim),
    });
  } catch (e) {
    fail(res, e);
  }
}


