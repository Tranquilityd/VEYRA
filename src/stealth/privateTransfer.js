// Veyra — Phase 3: client-side private-transfer orchestration.
//
// This is the only place that sequences a `.veyra → .veyra` private payment. It owns
// the state machine, performs ALL cryptography locally, and never sends private key
// material to the Veyra backend.
//
// WHAT LEAVES THE CLIENT
//   outbound: username, public meta-address, public keys, fingerprint, SISK public
//             key, the ENROLLMENT signature (not key-deriving — see recovery.js),
//             payment/announcement transaction hashes and the PUBLIC announcement
//             fields that are already on-chain.
//   never:    spending/viewing private keys, stealth private keys, the recovery
//             signature, the wallet seed, the unencrypted backup.
//
// FAILURE POLICY (brief §14/§15)
//   - If the payment settles but the announcement fails, the payment is NEVER
//     re-sent. The non-secret recovery record is persisted and
//     `retryAnnouncement()` republishes only the announcement.
//   - No code path degrades into a direct wallet-to-wallet transfer.
import {
  ANNOUNCER_ADDRESS, CHAIN_ID, PROTOCOL_VERSION, SCHEME_ID, ATOMIC_UNITS_PER_ZKLTC,
  validateResolvedRecord, publicKeyOf,
} from './protocol.js';
import { randomScalar, multiplyG } from './secp256k1.js';
import { deriveStealthAddress, scanAnnouncements, verifyStealthKeypair } from './derive.js';
import { encodeAnnounceCalldata, validateAnnouncementInput } from './announcement.js';
import {
  enrollmentMessage, identityFromRoots, deriveIdentityRootsFromSignature, recoveryMessage,
  verifyRecoveredFingerprint,
} from './recovery.js';
import { encryptBackup, persistEncryptedBackup } from './backup.js';
import {
  DEFAULT_GAS_RESERVE_ATOMIC, WALLET_KINDS, assertSupportedWallet, assertDerivableSignature,
  buildNativeTransferRequest, checkFunding, formatAtomic, parseAmountToAtomic, sendNativeTransfer, waitForReceipt,
} from './wallet.js';
import { TransferStateMachine, FAILURE_CODES, announcementRecoveryRecord } from './transferState.js';
import { addressForPrivateKey, broadcastRawTransaction, signNativeTransfer } from './signer.js';

const RECOVERY_RECORD_KEY = 'veyra:stealth:announcement-recovery';
const PENDING_INTENT_KEY = 'veyra:stealth:pending-payment';
/**
 * Below this amount a later stealth spend may cost more in fees than the payment is
 * worth. Informational only — the transfer is still allowed (Phase 3.5 finding I-03).
 */
export const DUST_WARNING_ATOMIC = 100_000_000_000_000n; // 0.0001 zkLTC
const META_PIN_KEY = 'veyra:stealth:meta-pins';

/** Application confirmation policy (brief §14, Phase 2D.11). Configurable, not magic. */
export const DEFAULT_PAYMENT_CONFIRMATIONS = 2;
export const DEFAULT_ANNOUNCEMENT_CONFIRMATIONS = 1;

export class PrivateTransferError extends Error {
  constructor(code, message, { state, recoveryRecord } = {}) {
    super(message || code);
    this.name = 'PrivateTransferError';
    this.code = code;
    this.state = state;
    this.recoveryRecord = recoveryRecord;
  }
}

const readSessionToken = () => {
  try { return globalThis.sessionStorage?.getItem('veyra:api-session') ?? null; } catch { return null; }
};

/** Thin fetch wrapper. Injected wholesale in tests. */
export function createApiClient({ baseUrl = '', fetchImpl = globalThis.fetch, token = readSessionToken } = {}) {
  return async function request(path, { method = 'GET', body } = {}) {
    const session = typeof token === 'function' ? token() : token;
    const response = await fetchImpl(baseUrl + path, {
      method,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let payload = {};
    try { payload = await response.json(); } catch { /* non-JSON */ }
    if (!response.ok) throw new PrivateTransferError(payload?.error || 'INTERNAL_ERROR');
    return payload;
  };
}

export class PrivateTransferClient {
  /**
   * @param {{api?:Function, provider?:object, events?:object, crypto?:Crypto}} options
   */
  constructor({ api, provider, events, crypto: cryptoSource } = {}) {
    this.api = api || createApiClient();
    this.provider = provider || null;
    this.events = events || null;
    this.crypto = cryptoSource || globalThis.crypto;
    this.identity = null;
    this.lastFingerprint = null;
    /** Set while a payment or announcement operation is running (duplicate-send guard). */
    this._inFlight = false;
    /**
     * Private identity material for THIS session only: derived in the browser from a
     * wallet signature (or restored from an encrypted backup) and kept in a closure
     * variable. It is never persisted unencrypted, never logged and never transmitted.
     */
    this.memoryIdentity = null;
  }

  /**
   * Adopt the private identity material for this session.
   * @param {{spendingPrivateKey:bigint, viewingPrivateKey:bigint, siskPrivateKey?:bigint,
   *          username?:string, metaAddress?:string, fingerprint?:string}} material
   */
  rememberIdentity(material) {
    if (!material?.spendingPrivateKey || !material?.viewingPrivateKey) throw new PrivateTransferError(FAILURE_CODES.CORRUPTED_LOCAL_KEY_STATE);
    const derived = identityFromRoots({ spendingPrivateKey: material.spendingPrivateKey, viewingPrivateKey: material.viewingPrivateKey });
    if (material.metaAddress && material.metaAddress.toLowerCase() !== derived.metaAddress) {
      throw new PrivateTransferError(FAILURE_CODES.CORRUPTED_LOCAL_KEY_STATE, 'backup does not match its meta-address');
    }
    this.memoryIdentity = {
      spendingPrivateKey: material.spendingPrivateKey,
      viewingPrivateKey: material.viewingPrivateKey,
      siskPrivateKey: material.siskPrivateKey ?? null,
      spendingPublicKey: derived.spendingPublicKey,
      viewingPublicKey: derived.viewingPublicKey,
      metaAddress: derived.metaAddress,
      fingerprint: derived.fingerprint,
      username: material.username ?? null,
      // A backup envelope must declare which protocol/scheme/chain it belongs to.
      protocolVersion: PROTOCOL_VERSION,
      schemeId: SCHEME_ID,
      chainId: CHAIN_ID,
    };
    this.lastFingerprint = derived.fingerprint;
    return this.publicIdentitySnapshot();
  }

  /** Public view of the in-memory identity (safe for state/UI). */
  publicIdentitySnapshot() {
    if (!this.memoryIdentity) return null;
    return {
      username: this.memoryIdentity.username,
      metaAddress: this.memoryIdentity.metaAddress,
      fingerprint: this.memoryIdentity.fingerprint,
      spendingPublicKey: this.memoryIdentity.spendingPublicKey,
      viewingPublicKey: this.memoryIdentity.viewingPublicKey,
    };
  }

  /** The in-memory key material, or null. Callers must never persist or log this. */
  identityKeys() { return this.memoryIdentity; }

  /**
   * Drop the in-memory identity and any pending announcement record. Used when the
   * wallet account changes or disconnects, so a second user of the same browser can
   * never inherit the first user's session keys (Phase 3.5 finding M-03).
   */
  forgetIdentity({ keepRecoveryRecord = false } = {}) {
    this.memoryIdentity = null;
    this.lastFingerprint = null;
    this.identity = null;
    if (!keepRecoveryRecord) this._clearRecoveryRecord();
    this._emit('private-transfer:forgotten', {});
  }

  /**
   * RECOVER path (brief §5). Re-derives the identity from a wallet signature and
   * refuses to proceed when the fingerprint does not match what is on record —
   * a non-deterministic wallet must fall back to the encrypted backup instead of
   * silently creating a second identity.
   */
  async recover({ username, expectedFingerprint = null } = {}) {
    const provider = this.provider;
    if (!provider) throw new PrivateTransferError(FAILURE_CODES.WALLET_DISCONNECTED);
    const wallet = await assertSupportedWallet(provider);
    if (!wallet.supported) throw new PrivateTransferError(wallet.reason || FAILURE_CODES.UNSUPPORTED_WALLET, wallet.message);

    let signature;
    try {
      signature = await provider.request({ method: 'personal_sign', params: ['0x' + toHexUtf8(recoveryMessage(username)), wallet.address] });
    } catch {
      throw new PrivateTransferError(FAILURE_CODES.SIGNATURE_REJECTED);
    }
    const form = assertDerivableSignature(signature);
    if (!form.ok) throw new PrivateTransferError(form.reason, form.message);

    const roots = deriveIdentityRootsFromSignature(signature);
    const derived = identityFromRoots(roots);
    let pinned = expectedFingerprint;
    if (!pinned) {
      // Ask the server for the PUBLIC record so the pin is the server's, not a guess.
      try {
        const payload = await this.api(`/api/private-transfer/resolve?username=${encodeURIComponent(String(username).toLowerCase())}`);
        pinned = payload?.identity?.fingerprint ?? null;
      } catch { pinned = null; }
    }
    if (pinned) {
      const check = verifyRecoveredFingerprint(derived, pinned);
      if (!check.ok) throw new PrivateTransferError(FAILURE_CODES.RECOVERY_FINGERPRINT_MISMATCH, check.error);
    }
    const snapshot = this.rememberIdentity({ ...roots, username, metaAddress: derived.metaAddress });
    this._emit('private-transfer:recovered', snapshot);
    return snapshot;
  }

  _emit(name, payload) { this.events?.emit?.(name, payload); }

  /* ---------------------------------------------------------------- enrollment */

  /**
   * Create the private-transfer identity for the authenticated `.veyra` user.
   * The recovery signature stays in memory; only public material is sent.
   *
   * @param {{username:string, passphrase:string, persistBackup?:boolean, persist?:boolean}} params
   * @returns {Promise<{metaAddress:string, fingerprint:string, backup:object, address:string}>}
   */
  async enroll({ username, passphrase, persistBackup = true } = {}) {
    const provider = this.provider;
    if (!provider) throw new PrivateTransferError(FAILURE_CODES.WALLET_DISCONNECTED);
    const wallet = await assertSupportedWallet(provider);
    if (!wallet.supported) throw new PrivateTransferError(wallet.reason || FAILURE_CODES.UNSUPPORTED_WALLET, wallet.message);

    // 1. Recovery signature — SECRET-EQUIVALENT, never transmitted.
    const message = recoveryMessage(username);
    let signature;
    try {
      signature = await provider.request({ method: 'personal_sign', params: ['0x' + toHexUtf8(message), wallet.address] });
    } catch {
      throw new PrivateTransferError(FAILURE_CODES.SIGNATURE_REJECTED);
    }
    const form = assertDerivableSignature(signature);
    if (!form.ok) throw new PrivateTransferError(form.reason, form.message);

    const roots = deriveIdentityRootsFromSignature(signature);
    const identity = identityFromRoots(roots);

    // 2. Dedicated stealth-identity signing key (SISK). Its public half is published;
    //    its private half lives only in the encrypted backup.
    const siskPrivateKey = randomScalar(this.crypto);
    const siskPublic = compressPublicKey(siskPrivateKey);

    // 3. Enrollment binding signature — different domain, safe to transmit.
    const bindMessage = enrollmentMessage({ username, metaAddress: identity.metaAddress, siskPublicKey: siskPublic });
    let enrollmentSignature;
    try {
      enrollmentSignature = await provider.request({ method: 'personal_sign', params: ['0x' + toHexUtf8(bindMessage), wallet.address] });
    } catch {
      throw new PrivateTransferError(FAILURE_CODES.SIGNATURE_REJECTED);
    }

    const record = {
      protocolVersion: PROTOCOL_VERSION,
      schemeId: SCHEME_ID,
      spendingPublicKey: identity.spendingPublicKey,
      viewingPublicKey: identity.viewingPublicKey,
      metaAddress: identity.metaAddress,
      fingerprint: identity.fingerprint,
      siskPublicKey: siskPublic,
      chainId: CHAIN_ID,
      enrollmentSignature,
    };
    const saved = await this.api('/api/private-transfer/enroll', { method: 'POST', body: record });
    this.identity = saved.identity || record;

    const backup = await encryptBackup({
      spendingPrivateKey: roots.spendingPrivateKey,
      viewingPrivateKey: roots.viewingPrivateKey,
      siskPrivateKey,
      protocolVersion: PROTOCOL_VERSION,
      schemeId: SCHEME_ID,
      chainId: CHAIN_ID,
      username,
      metaAddress: identity.metaAddress,
      fingerprint: identity.fingerprint,
    }, passphrase, { crypto: this.crypto });
    if (persistBackup) await persistEncryptedBackup(backup, { username, indexedDB: globalThis.indexedDB });

    // Keep the material for this session so a payment can be received/spent without
    // re-signing; it stays in memory and is cleared on reload by design.
    this.rememberIdentity({ ...roots, siskPrivateKey, username, metaAddress: identity.metaAddress });
    this._emit('private-transfer:enrolled', { fingerprint: identity.fingerprint, username });
    return { metaAddress: identity.metaAddress, fingerprint: identity.fingerprint, backup, username, address: wallet.address };
  }

  /* ---------------------------------------------------------------- resolution */

  /** Resolve `bob.veyra` to PUBLIC stealth data. Throws on a record that fails validation. */
  async resolve(rawUsername) {
    const username = String(rawUsername || '').replace(/\.veyra$/i, '').trim().toLowerCase();
    if (!username) throw new PrivateTransferError(FAILURE_CODES.RECIPIENT_NOT_FOUND);
    let payload;
    try {
      payload = await this.api(`/api/private-transfer/resolve?username=${encodeURIComponent(username)}`);
    } catch (error) {
      if (error.code === 'NOT_FOUND') throw new PrivateTransferError(FAILURE_CODES.RECIPIENT_NOT_FOUND);
      if (error.code === 'RECIPIENT_NOT_ENROLLED') throw new PrivateTransferError(FAILURE_CODES.RECIPIENT_NOT_ENROLLED);
      throw error;
    }
    const record = payload.identity;
    const validated = validateResolvedRecord(record);
    if (!validated.ok) throw new PrivateTransferError(FAILURE_CODES.INVALID_RECIPIENT_META, validated.error);

    // Fingerprint pinning (§2D.9): warn loudly if a known username changes identity.
    const pinned = this._readPins()[username] || null;
    if (pinned && pinned !== validated.fingerprint) {
      this._emit('private-transfer:fingerprint-changed', { username, pinned, received: validated.fingerprint });
    }
    return { ...record, username, fingerprint: validated.fingerprint, metaAddress: validated.metaAddress, fingerprintChanged: Boolean(pinned && pinned !== validated.fingerprint), pinned };
  }

  /** Pin (or check) a recipient fingerprint on first successful use. */
  pinRecipient(username, fingerprint, { trust = false } = {}) {
    const pins = this._readPins();
    const key = String(username).toLowerCase();
    if (pins[key] && pins[key] !== fingerprint && !trust) {
      return { ok: false, error: 'FINGERPRINT_CHANGED', pinned: pins[key] };
    }
    pins[key] = String(fingerprint).toLowerCase();
    try { globalThis.localStorage?.setItem(META_PIN_KEY, JSON.stringify(pins)); } catch { /* optional */ }
    return { ok: true, fingerprint: pins[key] };
  }

  _readPins() {
    try { return JSON.parse(globalThis.localStorage?.getItem(META_PIN_KEY) || '{}'); } catch { return {}; }
  }

  /* ---------------------------------------------------------------- send flow */

  /**
   * Alice → Bob private payment. Resolves, derives locally, pays the FRESH stealth
   * address with the wallet, then publishes the announcement.
   *
   * @param {{recipient:string, amount:string|bigint, onState?:Function,
   *          confirmations?:number, announcementConfirmations?:number,
   *          receiptTimeoutMs?:number, pollMs?:number}} params
   */
  async send({
    recipient, amount, onState,
    confirmations = DEFAULT_PAYMENT_CONFIRMATIONS,
    announcementConfirmations = DEFAULT_ANNOUNCEMENT_CONFIRMATIONS,
    receiptTimeoutMs = 180_000, pollMs = 4_000,
    acceptFingerprintChange = false,
    gasReserveAtomic = DEFAULT_GAS_RESERVE_ATOMIC,
  } = {}) {
    // Re-entrancy guard: a double click must never produce a second payment, and a
    // second attempt while one is in flight is refused outright (Phase 3.5 finding M-04).
    if (this._inFlight) throw new PrivateTransferError('TRANSFER_IN_PROGRESS', 'a private transfer is already in progress');
    this._inFlight = true;
    const machine = new TransferStateMachine({ onTransition: (state) => { onState?.(state); this._emit('private-transfer:state', state); } });
    const notify = (state, context = {}) => { if (machine.state !== state) machine.transition(state, context); };

    // NOTE: a `catch` block is a SIBLING lexical scope of its `try` block, so anything the
    // cleanup path needs must be declared BEFORE the try (Phase 3.5 lesson). Everything a
    // NESTED catch needs (stealth/amountAtomic/paymentHash) may stay inside the outer try.
    let intentPersisted = false;

    try {
      notify('resolving_recipient');
      const resolved = await this.resolve(recipient);
      // TOFU GATE (Phase 3.5 finding M-05): if this browser has paid this name before and
      // the resolved meta-address fingerprint has changed, DO NOT pay. A substituted
      // meta-address (server compromise, database tamper, name re-registration) would
      // otherwise silently redirect the payment. The caller must acknowledge explicitly.
      if (resolved.fingerprintChanged && !acceptFingerprintChange) {
        throw new PrivateTransferError(
          'FINGERPRINT_CHANGED',
          'the resolved private-address fingerprint differs from the one pinned on this device',
          { state: machine.state },
        );
      }
      notify('recipient_verified');

      notify('deriving_stealth');
      // Fresh ephemeral key + fresh stealth address on EVERY payment (protocol rule D).
      const stealth = deriveStealthAddress({ metaAddress: resolved.metaAddress });

      notify('awaiting_wallet');
      const wallet = await assertSupportedWallet(this.provider);
      if (!wallet.supported) throw new PrivateTransferError(wallet.reason || FAILURE_CODES.UNSUPPORTED_WALLET, wallet.message);

      const amountAtomic = typeof amount === 'bigint' ? amount : parseAmountToAtomic(amount);
      const balanceHex = await this.provider.request({ method: 'eth_getBalance', params: [wallet.address, 'latest'] });
      const funding = checkFunding({
        balanceAtomic: BigInt(balanceHex),
        amountAtomic,
        gasReserveAtomic: BigInt(gasReserveAtomic),
      });
      if (!funding.ok) throw new PrivateTransferError(funding.error);

      const dustWarning = amountAtomic < DUST_WARNING_ATOMIC
        ? 'The amount is very small: network fees for spending it later may exceed the amount itself.'
        : null;

      const request = buildNativeTransferRequest({ from: wallet.address, to: stealth.stealthAddress, amountAtomic });
      // STALE-PAYMENT GUARD (Phase 3.5 finding M-06): record the non-secret intent BEFORE
      // the wallet is asked to sign, so a reload between submission and receipt cannot
      // lead to the user paying twice without any warning.
      this._persistPendingIntent({ stealth, amountAtomic });
      intentPersisted = true;
      let paymentHash;
      try {
        paymentHash = await sendNativeTransfer(this.provider, request);
      } catch (error) {
        const code = /reject|denied|cancel/i.test(String(error?.message || '')) ? FAILURE_CODES.TRANSACTION_REJECTED : FAILURE_CODES.TRANSACTION_FAILED;
        throw new PrivateTransferError(code);
      }
      this._clearPendingIntent(); // we now have a hash to show, so the warning is moot
      intentPersisted = false;
      notify('payment_submitted');
      notify('payment_confirming');
      try {
        await waitForReceipt(this.provider, paymentHash, { confirmations, timeoutMs: receiptTimeoutMs, pollMs });
      } catch (error) {
        // Only a receipt TIMEOUT leaves the outcome unknown. A reverted transaction
        // (status 0x0) provably did not move funds, so no warning is warranted. An
        // announcement timeout is covered by the recovery record instead.
        if (String(error?.message) === 'TIMEOUT') {
          this._persistPendingIntent({ stealth, amountAtomic, paymentTxHash: paymentHash });
        }
        throw error;
      }
      notify('payment_confirmed', { paymentConfirmed: true });

      // Reconciliation row: public protocol values only. The recipient's username,
      // meta-address and (above all) wallet are never sent to the backend, so the
      // server cannot reconstruct who was paid.
      const payment = await this._recordPayment({ stealth, amountAtomic, paymentHash });

      // The announcement phase is explicit in the state machine, so a UI can show
      // exactly where a transfer is (and so "completed" is provably unreachable
      // before the announcement has actually been accepted).
      notify('announcement_submitting');
      try {
        const announcementHash = await this._publishAnnouncement({ stealth, paymentId: payment?.paymentId });
        await this._attachAnnouncement(payment?.paymentId, announcementHash);
        machine.transition('announcement_confirmed', { announcementConfirmed: true });
        machine.transition('completed', { paymentConfirmed: true, announcementConfirmed: true });
        this.pinRecipient(resolved.username, resolved.fingerprint);
        return {
          status: 'completed',
          recipient: resolved.username,
          fingerprint: resolved.fingerprint,
          amountAtomic: String(amountAtomic),
          dustWarning,
          stealthAddress: stealth.stealthAddress,
          paymentTxHash: paymentHash,
          announcementTxHash: announcementHash,
          confirmations,
        };
      } catch (error) {
        // Payment settled; announcement failed. Preserve non-secret state and STOP.
        const recoveryRecord = announcementRecoveryRecord({
          payment: {
            chainId: CHAIN_ID, schemeId: SCHEME_ID, protocolVersion: PROTOCOL_VERSION,
            transactionHash: paymentHash, amountAtomic, paymentId: payment?.paymentId ?? null,
          },
          stealth,
        });
        this._persistRecoveryRecord(recoveryRecord);
        machine.transition('failed');
        throw new PrivateTransferError(FAILURE_CODES.ANNOUNCEMENT_FAILED, error?.message, {
          state: machine.state, recoveryRecord,
        });
      }
    } catch (error) {
      // Failing before a transaction hash exists means nothing was submitted, so drop the
      // warning WE created. A pre-existing warning from an earlier session is left alone
      // (it is only cleared once a hash exists, or by the user dismissing it).
      if (intentPersisted) this._clearPendingIntent();
      if (!machine.isTerminal()) { try { machine.transition('failed'); } catch { /* already terminal */ } }
      if (error instanceof PrivateTransferError) { error.state = error.state || machine.state; throw error; }
      throw new PrivateTransferError(error?.code || FAILURE_CODES.UNKNOWN, error?.message, { state: machine.state });
    } finally {
      this._inFlight = false;
    }
  }

  /**
   * Republish ONLY the announcement for a payment that already settled.
   * This never touches the payment and never re-sends zkLTC (brief §14, critical).
   */
  async retryAnnouncement(record, options = {}) {
    if (this._inFlight) throw new PrivateTransferError('TRANSFER_IN_PROGRESS', 'a private transfer is already in progress');
    this._inFlight = true;
    try {
      return await this._retryAnnouncement(record, options);
    } finally {
      this._inFlight = false;
    }
  }

  async _retryAnnouncement(record, {
    onState, confirmations = DEFAULT_ANNOUNCEMENT_CONFIRMATIONS,
    receiptTimeoutMs = 180_000, pollMs = 4_000,
  } = {}) {
    const recovery = record || this._readRecoveryRecord();
    if (!recovery) throw new PrivateTransferError(FAILURE_CODES.UNKNOWN, 'no announcement recovery record');
    // Resume the recorded attempt at the settled-payment state: the payment already
    // exists on-chain, so this path can only ever publish the announcement.
    const machine = new TransferStateMachine({ onTransition: (state) => onState?.(state), resumeAt: 'payment_confirmed' });
    machine.transition('announcement_submitting');
    try {
      const validated = validateAnnouncementInput({
        schemeId: recovery.schemeId,
        stealthAddress: recovery.stealthAddress,
        ephemeralPublicKey: recovery.ephemeralPublicKey,
        metadata: recovery.metadata,
      });
      if (!validated.ok) throw new PrivateTransferError(FAILURE_CODES.INVALID_EPHEMERAL_KEY, validated.error);
      const hash = await this._submitAnnouncementTx(validated);
      if (confirmations > 0) await waitForReceipt(this.provider, hash, { confirmations, timeoutMs: receiptTimeoutMs, pollMs });
      await this.api('/api/private-transfer/announcements', {
        method: 'POST',
        body: {
          schemeId: recovery.schemeId, stealthAddress: recovery.stealthAddress,
          ephemeralPublicKey: recovery.ephemeralPublicKey, metadata: recovery.metadata,
          transactionHash: hash, chainId: recovery.chainId, paymentTxHash: recovery.paymentTxHash,
        },
      });
      await this._attachAnnouncement(recovery.paymentId, hash);
      machine.transition('announcement_confirmed');
      machine.transition('completed', { paymentConfirmed: true, announcementConfirmed: true });
      this._clearRecoveryRecord();
      return { status: 'completed', announcementTxHash: hash };
    } catch (error) {
      if (!machine.isTerminal()) { try { machine.transition('failed'); } catch { /* terminal */ } }
      if (error instanceof PrivateTransferError) throw error;
      throw new PrivateTransferError(FAILURE_CODES.ANNOUNCEMENT_FAILED, error?.message, { state: machine.state });
    }
  }

  /* ---------------------------------------------------------------- dry run */

  /**
   * DRY RUN — Phase 4A manual-validation preview.
   *
   * Answers "what WOULD happen if I pressed send?" while performing only READS:
   * the recipient is resolved, the wallet/chain is inspected, the balance is read and
   * the stealth address is derived — exactly the same code paths the real send uses —
   * but this method:
   *   * never signs (`personal_sign` is not called),
   *   * never broadcasts (`eth_sendTransaction` is not called),
   *   * never writes to the Veyra backend (no enroll/announcement/payment POST),
   *   * never records a pending payment intent,
   *   * never pins or changes a recipient fingerprint.
   *
   * It is read-only by construction: the only provider methods it can reach are
   * `eth_accounts`, `eth_chainId`, `eth_getCode`, `eth_getBalance` and (best effort)
   * `eth_estimateGas` / `eth_gasPrice`. A caller cannot make it broadcast, and it is
   * safe to run against mainnet-priced testnet balances.
   *
   * Barriers (wrong network, unsupported wallet, insufficient balance, fingerprint
   * change) are REPORTED in `blockers` instead of thrown, so the manual tester can see
   * why the real send would refuse. The real send path is unchanged and still refuses
   * all of them.
   *
   * @returns {Promise<object>} a preview object; `broadcast` is always false
   */
  async previewSend({ recipient, amount, acceptFingerprintChange = false, gasReserveAtomic = DEFAULT_GAS_RESERVE_ATOMIC } = {}) {
    const resolved = await this.resolve(recipient);
    const amountAtomic = typeof amount === 'bigint' ? amount : parseAmountToAtomic(amount);
    if (amountAtomic <= 0n) throw new PrivateTransferError(FAILURE_CODES.AMOUNT_INVALID);

    const blockers = [];
    const warnings = [];
    if (resolved.fingerprintChanged && !acceptFingerprintChange) blockers.push('FINGERPRINT_CHANGED');
    if (amountAtomic < DUST_WARNING_ATOMIC) {
      warnings.push('The amount is very small: network fees for spending it later may exceed the amount itself.');
    }

    // --- wallet / chain state (read-only, fail-closed reporting)
    let wallet = null;
    try {
      const inspected = await assertSupportedWallet(this.provider);
      wallet = { address: inspected.address, kind: inspected.kind, supported: inspected.supported };
      if (!inspected.supported) blockers.push(inspected.reason || FAILURE_CODES.UNSUPPORTED_WALLET);
    } catch (error) {
      const reason = String(error?.code || error?.message || '');
      blockers.push(reason === 'WALLET_DISCONNECTED' ? 'WALLET_DISCONNECTED' : 'WRONG_NETWORK');
    }

    // --- funding (read-only balance; reported, never enforced here)
    let funding = null;
    if (wallet?.address) {
      try {
        const balanceHex = await this.provider.request({ method: 'eth_getBalance', params: [wallet.address, 'latest'] });
        const balanceAtomic = BigInt(balanceHex);
        const reserve = BigInt(gasReserveAtomic);
        const verdict = checkFunding({ balanceAtomic, amountAtomic, gasReserveAtomic: reserve });
        const missing = verdict.ok === true
          ? 0n
          : (verdict.error === 'INSUFFICIENT_BALANCE' ? amountAtomic - balanceAtomic : amountAtomic + reserve - balanceAtomic);
        funding = {
          ok: verdict.ok === true,
          balanceAtomic: String(balanceAtomic),
          gasReserveAtomic: String(reserve),
          shortfallAtomic: String(missing > 0n ? missing : 0n),
        };
        if (verdict.ok !== true) blockers.push(verdict.error);
      } catch { funding = null; }
    }

    // --- local derivation (no I/O): the same call the real send makes
    const stealth = deriveStealthAddress({ metaAddress: resolved.metaAddress });

    // --- transaction shape (identical builder to the real send)
    const payment = wallet?.address
      ? buildNativeTransferRequest({ from: wallet.address, to: stealth.stealthAddress, amountAtomic })
      : null;

    // --- best-effort fee estimate (read-only; absent on chains that refuse it)
    let estimate = null;
    if (wallet?.address) try {
      const [gasHex, priceHex] = await Promise.all([
        this.provider.request({ method: 'eth_estimateGas', params: [{ from: wallet.address, to: stealth.stealthAddress, value: '0x' + amountAtomic.toString(16) }] }),
        this.provider.request({ method: 'eth_gasPrice' }),
      ]);
      const gas = BigInt(gasHex); const price = BigInt(priceHex);
      estimate = { gas: String(gas), gasPriceWei: String(price), feeAtomic: String(gas * price) };
    } catch { estimate = null; }

    return Object.freeze({
      dryRun: true,
      broadcast: false,
      label: 'DRY RUN — NO TRANSACTION BROADCAST',
      status: blockers.length ? 'BLOCKED' : 'READY',
      blockers: Object.freeze([...new Set(blockers)]),
      warnings: Object.freeze(warnings),
      recipient: resolved.username,
      recipientFingerprint: resolved.fingerprint,
      recipientFingerprintChanged: Boolean(resolved.fingerprintChanged),
      amountAtomic: String(amountAtomic),
      amountFormatted: formatAtomic(amountAtomic),
      chainId: CHAIN_ID,
      chainIdHex: '0x' + BigInt(CHAIN_ID).toString(16),
      announcerAddress: ANNOUNCER_ADDRESS,
      wallet: wallet ? Object.freeze({ address: wallet.address, kind: wallet.kind, supported: wallet.supported }) : null,
      stealth: Object.freeze({
        stealthAddress: stealth.stealthAddress,
        stealthPublicKey: stealth.stealthPublicKey,
        ephemeralPublicKey: stealth.R,
        viewTag: stealth.viewTag,
      }),
      payment: payment ? Object.freeze({ ...payment }) : null,
      estimate: estimate ? Object.freeze(estimate) : null,
      // The exact state sequence the real send would walk, for manual verification.
      expectedTransitions: Object.freeze([
        'resolving_recipient', 'recipient_verified', 'deriving_stealth', 'awaiting_wallet',
        'payment_submitted', 'payment_confirming', 'payment_confirmed',
        'announcement_submitting', 'announcement_confirmed', 'completed',
      ]),
      requirements: Object.freeze({
        walletSignatureRequired: true,
        networkMustBe: `LiteForge (chain ${CHAIN_ID} / 0x${BigInt(CHAIN_ID).toString(16)})`,
        announcementRequired: true,
        serverWriteRequired: true,
      }),
      note: 'Nothing was signed, broadcast or written to the Veyra backend. The real send performs the same checks and refuses every blocker listed above.',
    });
  }

  /* ---------------------------------------------------------------- scanning */

  /**
   * Bob scans PUBLIC announcements locally with his viewing key. The server is only
   * ever asked for a page of public records (no per-user filter, no keys).
   *
   * @param {{spendingPublicKey:string, spendingPrivateKey:bigint, viewingPrivateKey:bigint,
   *          cursor?:number, limit?:number}} params
   */
  async scan({ spendingPublicKey, spendingPrivateKey, viewingPrivateKey, cursor = 0, limit = 100 } = {}) {
    const payload = await this.api(`/api/private-transfer/announcements?cursor=${Number(cursor) || 0}&limit=${Math.min(Number(limit) || 100, 200)}`);
    const records = payload.announcements || [];
    // Keys default to this session's in-memory identity so a caller (e.g. the UI) never
    // has to handle them; they still never leave the device.
    const keys = this.memoryIdentity
      ? {
        spendingPublicKey: spendingPublicKey ?? this.memoryIdentity.spendingPublicKey,
        spendingPrivateKey: spendingPrivateKey ?? this.memoryIdentity.spendingPrivateKey,
        viewingPrivateKey: viewingPrivateKey ?? this.memoryIdentity.viewingPrivateKey,
      }
      : { spendingPublicKey, spendingPrivateKey, viewingPrivateKey };
    // Scanning is local: the server only ever returns an unfiltered public page.
    const matches = scanAnnouncements(records, keys);
    return { matches, nextCursor: payload.nextCursor ?? null, scanned: records.length };
  }

  /* ---------------------------------------------------------------- spending */

  /**
   * Spend from a stealth address to a FRESH destination, signing locally.
   * Sweeping straight to Bob's known public wallet is discouraged and warns (§11/§12).
   */
  async spendFromStealth({
    stealthPrivateKey, stealthPublicKey, username, destination, amount,
    gasLimit, maxFeePerGas, maxPriorityFeePerGas, knownWalletAddresses = [], acknowledgeDestinationWarning = false,
  } = {}) {
    if (!verifyStealthKeypair({ stealthPrivateKey, expectedPublicKey: stealthPublicKey })) {
      throw new PrivateTransferError(FAILURE_CODES.CORRUPTED_LOCAL_KEY_STATE, 'derived key does not control this stealth address');
    }
    const isKnown = knownWalletAddresses
      .filter(Boolean)
      .some((address) => String(address).toLowerCase() === String(destination).toLowerCase());
    if (isKnown && !acknowledgeDestinationWarning) {
      throw new PrivateTransferError('DESTINATION_IS_KNOWN_WALLET', 'This destination is your known public wallet. Funds would become publicly linkable to it.', { state: 'awaiting_wallet' });
    }

    const amountAtomic = typeof amount === 'bigint' ? amount : parseAmountToAtomic(amount);
    const stealthAddress = addressForPrivateKey(stealthPrivateKey);

    // Gas values come from the network; nothing is hard-coded.
    const [nonceHex, gasPriceHex, chainIdHex, block] = await Promise.all([
      this.provider.request({ method: 'eth_getTransactionCount', params: [stealthAddress, 'pending'] }),
      this.provider.request({ method: 'eth_gasPrice' }),
      this.provider.request({ method: 'eth_chainId' }),
      this.provider.request({ method: 'eth_getBlockByNumber', params: ['latest', false] }),
    ]);
    if (BigInt(chainIdHex) !== BigInt(CHAIN_ID)) throw new PrivateTransferError(FAILURE_CODES.WRONG_NETWORK);

    const baseFee = BigInt(block?.baseFeePerGas ?? gasPriceHex);
    const priority = maxPriorityFeePerGas ?? BigInt(gasPriceHex);
    const maxFee = maxFeePerGas ?? baseFee * 2n + priority;

    const signed = signNativeTransfer({
      privateKey: stealthPrivateKey,
      to: destination,
      value: amountAtomic,
      nonce: BigInt(nonceHex),
      gasLimit: BigInt(gasLimit ?? 21000n),
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priority,
      chainId: CHAIN_ID,
      type: 'eip1559',
    });
    const hash = await broadcastRawTransaction(this.provider, signed.raw);
    return { stealthAddress, destination, amountAtomic: String(amountAtomic), transactionHash: hash, rawHash: signed.hash };
  }

  /* ---------------------------------------------------------------- internals */

  async _publishAnnouncement({ stealth, paymentId }) {
    const validated = validateAnnouncementInput({
      schemeId: SCHEME_ID,
      stealthAddress: stealth.stealthAddress,
      ephemeralPublicKey: stealth.R,
      metadata: '0x' + stealth.viewTag,
    });
    if (!validated.ok) throw new PrivateTransferError(FAILURE_CODES.INVALID_EPHEMERAL_KEY, validated.error);
    const hash = await this._submitAnnouncementTx(validated);
    await this.api('/api/private-transfer/announcements', {
      method: 'POST',
      body: {
        schemeId: SCHEME_ID,
        stealthAddress: validated.stealthAddress,
        ephemeralPublicKey: validated.ephemeralPublicKey,
        metadata: validated.metadata,
        transactionHash: hash,
        chainId: CHAIN_ID,
        paymentId: paymentId ?? null,
      },
    });
    return hash;
  }

  async _submitAnnouncementTx(validated) {
    const data = encodeAnnounceCalldata(validated);
    // Re-validate our own generated key before broadcasting (brief §9): Veyra must
    // never reproduce the invalid-ephemeral-key transactions seen from third parties.
    const roundTrip = validateAnnouncementInput({
      schemeId: SCHEME_ID,
      stealthAddress: validated.stealthAddress,
      ephemeralPublicKey: validated.ephemeralPublicKey,
      metadata: validated.metadata,
    });
    if (!roundTrip.ok) throw new PrivateTransferError(FAILURE_CODES.INVALID_EPHEMERAL_KEY, roundTrip.error);
    const hash = await this.provider.request({
      method: 'eth_sendTransaction',
      params: [{ to: ANNOUNCER_ADDRESS, data, value: '0x0', chainId: '0x' + BigInt(CHAIN_ID).toString(16) }],
    });
    if (typeof hash !== 'string') throw new PrivateTransferError(FAILURE_CODES.TRANSACTION_REJECTED);
    return hash;
  }

  /**
   * Link an announcement transaction to its reconciliation row. Best-effort: a
   * failure here never changes the outcome of a payment that already settled.
   */
  async _attachAnnouncement(paymentId, announcementTxHash) {
    if (!paymentId || !announcementTxHash) return null;
    try {
      return await this.api('/api/private-transfer/payment-announcement', {
        method: 'POST',
        body: { paymentId, announcementTxHash, status: 'announcement_confirmed' },
      });
    } catch {
      return null;
    }
  }

  async _recordPayment({ stealth, amountAtomic, paymentHash }) {
    try {
      const payload = await this.api('/api/private-transfer/payments', {
        method: 'POST',
        body: {
          stealthAddress: stealth.stealthAddress,
          ephemeralPublicKey: stealth.R,
          viewTag: '0x' + stealth.viewTag,
          amountAtomic: String(amountAtomic),
          paymentTxHash: paymentHash,
          chainId: CHAIN_ID,
          protocolVersion: PROTOCOL_VERSION,
          schemeId: SCHEME_ID,
          status: 'payment_confirmed',
        },
      });
      return payload;
    } catch {
      // Reconciliation metadata is best-effort; a failure here must never abort a
      // settled payment (the announcement is still published below).
      return null;
    }
  }

  /**
   * Non-secret record of a payment that is about to be signed, kept until a transaction
   * hash exists. No username and no wallet address — just the fresh stealth address,
   * the amount and a timestamp (Phase 3.5 finding M-06).
   */
  _persistPendingIntent({ stealth, amountAtomic, paymentTxHash = null }) {
    try {
      globalThis.localStorage?.setItem(PENDING_INTENT_KEY, JSON.stringify({
        stealthAddress: stealth.stealthAddress,
        amountAtomic: String(amountAtomic),
        paymentTxHash,
        at: new Date().toISOString(),
        chainId: CHAIN_ID,
      }));
    } catch { /* optional */ }
  }

  _clearPendingIntent() {
    try { globalThis.localStorage?.removeItem(PENDING_INTENT_KEY); } catch { /* optional */ }
  }

  /** Exposed so the UI can warn about a payment that may already have been submitted. */
  pendingIntent() {
    try {
      const raw = globalThis.localStorage?.getItem(PENDING_INTENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  /**
   * The non-secret announcement-recovery record for a payment whose notice has not been
   * published yet, or null. Every field in it is already public on-chain (fresh stealth
   * address, ephemeral public key, metadata byte, payment transaction hash, amount) —
   * it exists so a tester can SEE the recovery state without touching key material.
   */
  recoveryRecord() {
    return this._readRecoveryRecord();
  }

  /** Player has checked their wallet history: the warning is acknowledged. */
  dismissPendingIntent() {
    this._clearPendingIntent();
    this._emit('private-transfer:pending-dismissed', {});
    return true;
  }

  _persistRecoveryRecord(record) {
    try { globalThis.localStorage?.setItem(RECOVERY_RECORD_KEY, JSON.stringify(record)); } catch { /* optional */ }
    this._emit('private-transfer:announcement-pending', record);
  }

  _readRecoveryRecord() {
    try { const raw = globalThis.localStorage?.getItem(RECOVERY_RECORD_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  _clearRecoveryRecord() {
    try { globalThis.localStorage?.removeItem(RECOVERY_RECORD_KEY); } catch { /* optional */ }
  }
}

/* ------------------------------------------------------------------ helpers */
const toHexUtf8 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
};

function compressPublicKey(privateScalar) {
  const point = multiplyG(privateScalar);
  if (point === null) throw new PrivateTransferError(FAILURE_CODES.UNKNOWN, 'invalid identity scalar');
  return publicKeyOf(point);
}

export { ATOMIC_UNITS_PER_ZKLTC, WALLET_KINDS };
