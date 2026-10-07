// Veyra — Phase 3: explicit private-transfer state machine (brief §14).
//
// The state machine is deliberately a pure module: it holds no keys, performs no
// I/O and can be exhaustively tested. The orchestration layer
// (`src/stealth/privateTransfer.js`) drives it.
//
// TWO RULES ARE ENFORCED HERE, NOT BY CONVENTION:
//   1. `completed` is unreachable unless the payment has the required
//      confirmations AND the announcement has been confirmed/submitted-accepted.
//   2. There is no transition of any kind from a failure into a direct
//      wallet-to-wallet transfer. The only failure exit is `failed` (with the
//      payment preserved for announcement retry) or `cancelled`.
export const TRANSFER_STATES = Object.freeze([
  'idle',
  'resolving_recipient',
  'recipient_verified',
  'deriving_stealth',
  'awaiting_wallet',
  'payment_submitted',
  'payment_confirming',
  'payment_confirmed',
  'announcement_submitting',
  'announcement_confirmed',
  'completed',
  'failed',
  'cancelled',
]);

/** Allowed transitions. Anything not listed here is rejected. */
const TRANSITIONS = Object.freeze({
  idle: ['resolving_recipient', 'cancelled', 'failed'],
  resolving_recipient: ['recipient_verified', 'failed', 'cancelled'],
  recipient_verified: ['deriving_stealth', 'failed', 'cancelled'],
  deriving_stealth: ['awaiting_wallet', 'failed', 'cancelled'],
  awaiting_wallet: ['payment_submitted', 'failed', 'cancelled'],
  payment_submitted: ['payment_confirming', 'failed'],
  payment_confirming: ['payment_confirmed', 'failed'],
  // A confirmed payment may only move on to the announcement — it can never go
  // back to a wallet step, and it can never become `completed` directly.
  payment_confirmed: ['announcement_submitting', 'failed'],
  announcement_submitting: ['announcement_confirmed', 'failed'],
  announcement_confirmed: ['completed', 'failed'],
  completed: [],
  // `failed` is terminal for this attempt. The orchestration layer starts a NEW
  // attempt (keeping the recorded payment/announcement hash) rather than mutating
  // a failed attempt, which is what makes "never resend the payment" enforceable.
  failed: [],
  cancelled: [],
});

/** States in which an announcement must still be published for a settled payment. */
export const ANNOUNCEMENT_PENDING_STATES = Object.freeze(['payment_confirmed', 'announcement_submitting']);
/** States in which a payment exists on-chain and must never be re-sent. */
export const PAYMENT_SETTLED_STATES = Object.freeze([
  'payment_submitted', 'payment_confirming', 'payment_confirmed',
  'announcement_submitting', 'announcement_confirmed', 'completed',
]);

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

export class TransferStateError extends Error {
  constructor(from, to) {
    super(`ILLEGAL_TRANSFER_TRANSITION:${from}->${to}`);
    this.name = 'TransferStateError';
    this.from = from;
    this.to = to;
  }
}

/**
 * Minimal transition guard. `context` carries only NON-SECRET facts used to
 * enforce the completion rule.
 */
export class TransferStateMachine {
  /**
   * @param {{onTransition?:Function, resumeAt?:string}} [options] `resumeAt` restores an
   * attempt that is being continued from persisted, NON-SECRET state (used by the
   * announcement retry so a settled payment is never re-sent). It cannot be used to
   * jump into `completed`.
   */
  constructor({ onTransition, resumeAt = 'idle' } = {}) {
    if (!TRANSFER_STATES.includes(resumeAt) || resumeAt === 'completed') throw new TransferStateError('idle', resumeAt);
    this.state = resumeAt;
    this.history = [{ state: resumeAt, at: Date.now(), resumed: resumeAt !== 'idle' }];
    this.onTransition = onTransition;
  }

  /**
   * Attempt a transition.
   * @param {string} next target state
   * @param {{paymentConfirmed?:boolean, announcementConfirmed?:boolean}} [context]
   */
  transition(next, context = {}) {
    if (!TRANSFER_STATES.includes(next)) throw new TransferStateError(this.state, next);
    if (!canTransition(this.state, next)) throw new TransferStateError(this.state, next);

    // Rule 1: completion requires real confirmations on both halves.
    if (next === 'completed') {
      if (!context.paymentConfirmed || !context.announcementConfirmed) {
        throw new TransferStateError(this.state, next);
      }
    }
    // A payment may not be reported confirmed without a confirmation signal.
    if (next === 'payment_confirmed' && context.paymentConfirmed === false) {
      throw new TransferStateError(this.state, next);
    }

    const previous = this.state;
    this.state = next;
    this.history.push({ state: next, from: previous, at: Date.now() });
    this.onTransition?.(next, previous);
    return this.state;
  }

  /** True when a payment for this attempt already exists and must not be re-sent. */
  get paymentSettled() {
    return PAYMENT_SETTLED_STATES.includes(this.state);
  }

  /** True when the announcement still owes publication for a settled payment. */
  get announcementPending() {
    return ANNOUNCEMENT_PENDING_STATES.includes(this.state);
  }

  isTerminal() {
    return this.state === 'completed' || this.state === 'failed' || this.state === 'cancelled';
  }
}

/**
 * Failure classification (brief §15). Every failure keeps its code so the UI can
 * explain the situation, and NONE of them is allowed to degrade into a plain
 * wallet-to-wallet transfer.
 */
export const FAILURE_CODES = Object.freeze({
  WRONG_NETWORK: 'WRONG_NETWORK',
  WALLET_DISCONNECTED: 'WALLET_DISCONNECTED',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INSUFFICIENT_GAS: 'INSUFFICIENT_GAS',
  SIGNATURE_REJECTED: 'SIGNATURE_REJECTED',
  TRANSACTION_REJECTED: 'TRANSACTION_REJECTED',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  RPC_FAILURE: 'RPC_FAILURE',
  TIMEOUT: 'TIMEOUT',
  ANNOUNCEMENT_FAILED: 'ANNOUNCEMENT_FAILED',
  INVALID_RECIPIENT_META: 'INVALID_RECIPIENT_META',
  INVALID_EPHEMERAL_KEY: 'INVALID_EPHEMERAL_KEY',
  UNSUPPORTED_WALLET: 'UNSUPPORTED_WALLET',
  UNSUPPORTED_ACCOUNT_TYPE: 'UNSUPPORTED_ACCOUNT_TYPE',
  CORRUPTED_LOCAL_KEY_STATE: 'CORRUPTED_LOCAL_KEY_STATE',
  RECOVERY_FINGERPRINT_MISMATCH: 'RECOVERY_FINGERPRINT_MISMATCH',
  DUPLICATE_ANNOUNCEMENT: 'DUPLICATE_ANNOUNCEMENT',
  CHAIN_REORGANIZATION: 'CHAIN_REORGANIZATION',
  RECIPIENT_NOT_FOUND: 'RECIPIENT_NOT_FOUND',
  RECIPIENT_NOT_ENROLLED: 'RECIPIENT_NOT_ENROLLED',
  AMOUNT_INVALID: 'AMOUNT_INVALID',
  UNKNOWN: 'UNKNOWN',
});

/** Payload persisted when a payment settled but the announcement did not (rule §14). */
export function announcementRecoveryRecord({ payment, stealth }) {
  return {
    kind: 'veyra.stealth.announcement-recovery',
    version: 1,
    chainId: payment.chainId,
    schemeId: payment.schemeId,
    protocolVersion: payment.protocolVersion,
    stealthAddress: stealth.stealthAddress,
    ephemeralPublicKey: stealth.R,
    metadata: '0x' + stealth.viewTag,
    paymentTxHash: payment.transactionHash,
    paymentId: payment.paymentId ?? null,
    amountAtomic: String(payment.amountAtomic),
    // No recipient identity is recorded locally either: a retry only needs the
    // public announcement fields, so there is nothing here that links Alice to Bob.
    createdAt: new Date().toISOString(),
  };
}
