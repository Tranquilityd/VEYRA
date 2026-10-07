// Veyra — Phase 3: wallet bridge + client session for private transfers.
//
// The stealth client needs an EIP-1193-shaped provider, while the game owns a wallet
// adapter that exposes named methods around one. This bridge is the ONLY place the
// two meet: it forwards requests verbatim to the underlying provider (so Veyra never
// re-implements `personal_sign`/`eth_sendTransaction` semantics) and maps a missing
// provider onto the same errors the client already understands.
//
// It keeps no key material: every secret stays inside the client modules, in memory,
// for the duration of one operation.
import { PrivateTransferClient, createApiClient } from '../stealth/privateTransfer.js';
import { ANNOUNCER_ADDRESS, CHAIN_ID, CHAIN_ID_HEX } from '../stealth/protocol.js';
import { WALLET_KINDS, detectWalletKind } from '../stealth/wallet.js';

const IDENTITY_CACHE_KEY = 'veyra:stealth:identity';
/**
 * Phase 4A manual-validation mode. Explicit opt-in ONLY (URL `?veyra-private-test=1`,
 * `localStorage['veyra:stealth:test-mode'] === '1'`, or `window.VEYRA_PRIVATE_TEST_MODE
 * === true`); it is OFF by default and adds diagnostics + a dry run. It never disables a
 * network check, a signature, a cryptographic check or an announcement validation —
 * `testModeEnabled()` is read by the UI, not by the protocol modules.
 */
export const TEST_MODE_KEY = 'veyra:stealth:test-mode';

/** True when the tester explicitly asked for the diagnostics surface. */
export function testModeEnabled({
  search = globalThis.location?.search,
  storage = globalThis.localStorage,
  flag = globalThis.VEYRA_PRIVATE_TEST_MODE,
} = {}) {
  if (flag === true) return true;
  try { if (new URLSearchParams(String(search || '')).get('veyra-private-test') === '1') return true; } catch { /* no location */ }
  try { if (storage?.getItem(TEST_MODE_KEY) === '1') return true; } catch { /* storage optional */ }
  return false;
}

const readCachedIdentity = () => {
  try { return JSON.parse(globalThis.localStorage?.getItem(IDENTITY_CACHE_KEY) || 'null'); } catch { return null; }
};

export class PrivateTransferSession {
  constructor(game) {
    this.game = game;
    this.provider = this._buildProvider();
    this.client = new PrivateTransferClient({
      api: createApiClient(),
      provider: this.provider,
      events: game?.events,
    });
    this.identity = readCachedIdentity();
    this.lastError = null;
    /** Latest live-transfer state seen (diagnostics only; never used to gate protocol steps). */
    this.lastTransferState = 'idle';
    /** Latest dry-run preview (public values only). */
    this.lastPreview = null;
    /** Latest wallet/chain inspection (see `walletStatus()`). */
    this.lastWalletStatus = null;
    this.testMode = testModeEnabled();
    /** Wallet address the cached identity/keys belong to (lowercased). */
    this.boundAccount = null;
    // Wallet state is authoritative: a disconnect or an account change must drop the
    // cached public identity AND any in-memory session keys, so a different account on
    // the same browser can never inherit them (Phase 3.5 finding M-03).
    game?.events?.on?.('litvm:wallet', (snapshot) => this._onWalletState(snapshot));
    game?.events?.on?.('private-transfer:state', (state) => { if (typeof state === 'string') this.lastTransferState = state; });
  }

  _onWalletState(snapshot) {
    const address = typeof snapshot?.address === 'string' ? snapshot.address.toLowerCase() : null;
    const gone = !address || snapshot?.state === 'disconnected' || snapshot?.state === 'failed';
    if (gone) {
      // Always clear (idempotent): keys may have been added by a recovery/import since the
      // last bound account, so the previous check on `boundAccount` was not sufficient.
      this.clear({ reason: 'disconnected' });
      return;
    }
    if (this.boundAccount && this.boundAccount !== address) {
      this.clear({ reason: 'account_changed' });
      this.boundAccount = address; // adopt the new account; its keys must come from enroll/recover/import
      return;
    }
    this.boundAccount = address;
  }

  /** Drop cached public identity material and any in-memory session keys. */
  clear({ reason = 'manual' } = {}) {
    this.client?.forgetIdentity?.();
    this.cacheIdentity(null);
    this.boundAccount = null;
    this.game?.events?.emit?.('private-transfer:cleared', { reason });
    return { cleared: true, reason };
  }

  /** True when a wallet is connected and authenticated. */
  get connected() {
    return Boolean(this._adapter()?.provider && this.game?.walletSession?.account);
  }

  get account() {
    return this.game?.walletSession?.account ?? null;
  }

  _adapter() {
    try { return globalThis.__VEYRA_LITVM_WALLET_ADAPTER__ || null; } catch { return null; }
  }

  _buildProvider() {
    const session = this;
    return {
      async request({ method, params }) {
        const adapter = session._adapter();
        // A connected session is required before anything is signed: `provider` only
        // exists after the wallet adapter has connected and switched to LiteForge.
        if (!adapter?.provider) throw new Error('WALLET_DISCONNECTED');
        if (method === 'personal_sign' && Array.isArray(params) && params[1] === undefined) {
          // Some injected wallets require the account first; always address it explicitly.
          params = [params[0], session.account];
        }
        return adapter.provider.request({ method, params });
      },
    };
  }

  /** Public identity material cached on this device (never a private key). */
  get enrolled() {
    return Boolean(this.identity?.metaAddress);
  }

  cacheIdentity(identity) {
    this.identity = identity
      ? {
        username: identity.username ?? null,
        metaAddress: identity.metaAddress ?? null,
        fingerprint: identity.fingerprint ?? null,
        schemeId: identity.schemeId ?? 1,
        protocolVersion: identity.protocolVersion ?? 1,
      }
      : null;
    try {
      if (this.identity) globalThis.localStorage?.setItem(IDENTITY_CACHE_KEY, JSON.stringify(this.identity));
      else globalThis.localStorage?.removeItem(IDENTITY_CACHE_KEY);
    } catch { /* cache is optional */ }
    this.game?.events?.emit?.('private-transfer:identity', this.identity);
    return this.identity;
  }

  /** Load the server-side (public) identity for the authenticated user. */
  async load() {
    try {
      const payload = await this.client.api('/api/private-transfer/me');
      this.boundAccount = this.account ? String(this.account).toLowerCase() : this.boundAccount;
      return this.cacheIdentity(payload.identity);
    } catch (error) {
      if (error.code === 'PRIVATE_TRANSFER_NOT_ENROLLED' || error.code === 'UNAUTHORIZED') return this.cacheIdentity(null);
      throw error;
    }
  }

  get chainLabel() {
    return `LiteForge (chain ${CHAIN_ID} / ${CHAIN_ID_HEX})`;
  }

  get announcerAddress() {
    return ANNOUNCER_ADDRESS;
  }

  /** Persist the manual-validation mode so a reload keeps the diagnostics visible. */
  setTestMode(enabled) {
    this.testMode = enabled === true;
    try {
      if (this.testMode) globalThis.localStorage?.setItem(TEST_MODE_KEY, '1');
      else globalThis.localStorage?.removeItem(TEST_MODE_KEY);
    } catch { /* storage optional */ }
    this.game?.events?.emit?.('private-transfer:test-mode', { enabled: this.testMode });
    return this.testMode;
  }

  /**
   * READ-ONLY wallet/network inspection for the manual tester (Phase 4A §3).
   * Reports CONNECTED / WRONG_NETWORK / DISCONNECTED and never switches networks —
   * switching stays an explicit wallet action, exactly as Phase 3 specified.
   * A chain id that cannot be read is reported as WRONG_NETWORK (fail closed), the
   * same rule `assertChain()` enforces for real payments.
   */
  async walletStatus() {
    const expected = { chainId: CHAIN_ID, chainIdHex: CHAIN_ID_HEX, name: 'LitVM LiteForge' };
    const address = this.account ? String(this.account).toLowerCase() : null;
    const adapter = this._adapter();
    if (!adapter?.provider || !address) {
      this.lastWalletStatus = { state: 'DISCONNECTED', address: null, detectedChainId: null, detectedChainIdHex: null, walletKind: null, canSend: false, reason: 'WALLET_DISCONNECTED', expected };
      return this.lastWalletStatus;
    }
    let hex = null;
    try { hex = await this.provider.request({ method: 'eth_chainId' }); } catch { hex = null; }
    const readable = typeof hex === 'string' && /^0x[0-9a-fA-F]+$/.test(hex);
    const detected = readable ? Number(BigInt(hex)) : null;
    if (!readable || detected !== CHAIN_ID) {
      this.lastWalletStatus = {
        state: 'WRONG_NETWORK', address, detectedChainId: detected, detectedChainIdHex: readable ? '0x' + BigInt(hex).toString(16) : null,
        walletKind: null, canSend: false, reason: readable ? 'CHAIN_MISMATCH' : 'CHAIN_UNREADABLE', expected,
      };
      return this.lastWalletStatus;
    }
    let walletKind = null;
    try { walletKind = await detectWalletKind(this.provider, address); } catch { walletKind = null; }
    const supported = walletKind === WALLET_KINDS.EOA;
    this.lastWalletStatus = {
      state: 'CONNECTED', address, detectedChainId: detected, detectedChainIdHex: '0x' + BigInt(CHAIN_ID).toString(16),
      walletKind, canSend: supported, reason: supported ? '' : 'UNSUPPORTED_WALLET', expected,
    };
    return this.lastWalletStatus;
  }

  /**
   * Run the read-only dry run through the SAME client that performs real sends, and keep
   * the latest preview for the diagnostics panel. The preview cannot broadcast (see
   * `PrivateTransferClient.previewSend`).
   */
  async previewSend(params) {
    const preview = await this.client.previewSend(params);
    this.lastPreview = preview;
    this.game?.events?.emit?.('private-transfer:preview', preview);
    return preview;
  }

  /** True when this session holds in-memory key material (never the material itself). */
  get keysInMemory() {
    return Boolean(this.client.identityKeys?.());
  }

  /**
   * NON-SECRET diagnostics snapshot for the manual tester. Contains public protocol
   * values and BOOLEANS about key presence — never a private/viewing/spending key,
   * never a seed, never a recovery signature and never the imported backup.
   */
  diagnostics() {
    const pending = this.client.pendingIntent?.() ?? null;
    const recovery = this.client.recoveryRecord?.() ?? null;
    const preview = this.lastPreview;
    return {
      testMode: this.testMode === true,
      expectedChain: { chainId: CHAIN_ID, chainIdHex: CHAIN_ID_HEX, name: 'LitVM LiteForge' },
      wallet: this.lastWalletStatus,
      identity: {
        state: this.enrolled ? 'ENROLLED' : 'NOT_ENROLLED',
        username: this.identity?.username ?? null,
        fingerprint: this.identity?.fingerprint ?? null,
        metaAddressPresent: Boolean(this.identity?.metaAddress),
        keysInMemory: this.keysInMemory,
        boundAccountPresent: Boolean(this.boundAccount),
      },
      transfer: {
        state: this.lastTransferState,
        inFlight: this.client._inFlight === true,
        pendingIntentPresent: Boolean(pending),
        pendingStealthAddress: pending?.stealthAddress ?? null,
        pendingPaymentTxHash: pending?.paymentTxHash ?? null,
      },
      announcement: {
        recoveryRecordPresent: Boolean(recovery),
        paymentTxHash: recovery?.paymentTxHash ?? null,
        paymentId: recovery?.paymentId ?? null,
        metadata: recovery?.metadata ?? null,
        createdAt: recovery?.createdAt ?? null,
      },
      stealth: {
        lastPreviewAt: preview ? new Date().toISOString() : null,
        lastStealthAddress: preview?.stealth?.stealthAddress ?? null,
        lastEphemeralPublicKey: preview?.stealth?.ephemeralPublicKey ?? null,
        lastViewTag: preview?.stealth?.viewTag ?? null,
        lastStatus: preview?.status ?? null,
      },
      recovery: {
        walletSignatureRecoveryAvailable: this.keysInMemory || this.enrolled,
        backupImportSupported: true,
      },
    };
  }
}
