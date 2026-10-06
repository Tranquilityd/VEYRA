// Veyra — Phase 4A: manual-validation diagnostics (TEST MODE ONLY).
//
// WHAT THIS IS
//   A read-only status surface for a human tester validating the Phase 3 private
//   transfer flow in a real browser with a real EIP-1193 wallet. It renders:
//   wallet + chain state, identity state, resolution state, live transfer state,
//   announcement/recovery state, stealth-derivation state and the DRY RUN preview.
//
// WHAT THIS MUST NEVER DO
//   * It never signs, never broadcasts and never writes to the backend. The only
//     mutation it can perform is calling `session.previewSend()` (read-only) and the
//     test-mode toggle itself.
//   * It never receives or renders private key material. `session.diagnostics()` is
//     defined to return public protocol values plus BOOLEANS about key presence; this
//     module renders exactly those fields and nothing else.
//   * It uses `textContent` only — no `innerHTML`, no `insertAdjacentHTML`, no
//     `outerHTML`, no `document.write`, no `eval`.
//   * It adds no route, no endpoint and no query parameter: the dry run reuses the
//     existing `/resolve` read and the wallet's read methods.
import { testModeEnabled } from '../systems/PrivateTransferSession.js';

const mk = (tag, parent, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  parent?.appendChild(el);
  return el;
};

const short = (value, keep = 10) => (typeof value === 'string' && value.length > keep ? `${value.slice(0, keep)}…` : (value ?? '—'));

const YES = 'yes';
const NO = 'no';
const flag = (value) => (value ? YES : NO);

/** Row renderer: label + value, both as text nodes. */
const row = (parent, label, value) => {
  const line = mk('div', parent, 'private-diag-row');
  mk('span', line, 'private-diag-label', label);
  mk('span', line, 'private-diag-value', value == null || value === '' ? '—' : String(value));
  return line;
};

export class PrivateTransferDiagnostics {
  constructor(game, { panel } = {}) {
    this.game = game;
    this.session = game.privateTransfer;
    this.panel = panel ?? null;
    this._bound = false;
    this._build();
  }

  get enabled() {
    return testModeEnabled({ storage: globalThis.localStorage, flag: globalThis.VEYRA_PRIVATE_TEST_MODE });
  }

  /* ---------------------------------------------------------------- structure */
  _build() {
    const root = mk('section', document.body, 'private-diag');
    root.id = 'private-diag';
    root.hidden = true;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Phase 4A private transfer diagnostics (test mode)');

    const head = mk('div', root, 'private-diag-head');
    mk('b', head, 'private-diag-title', 'TEST MODE — DIAGNOSTICS');
    this.hideButton = mk('button', head, 'private-diag-hide', 'HIDE');
    this.hideButton.type = 'button';

    mk('p', root, 'private-diag-banner',
      'Read-only diagnostics for manual validation. Protocol behaviour is unchanged: network checks, wallet signatures, cryptographic checks and announcement validation all still run, and nothing here can sign or broadcast.');

    // ---- wallet / network
    this.walletBox = mk('div', root, 'private-diag-box');
    mk('h4', this.walletBox, 'private-diag-subtitle', 'Wallet & network');
    this.networkState = mk('p', this.walletBox, 'private-diag-state');
    this.walletRows = mk('div', this.walletBox, 'private-diag-rows');
    this.refreshWalletButton = mk('button', this.walletBox, 'private-diag-btn', 'REFRESH WALLET STATUS');
    this.refreshWalletButton.type = 'button';

    // ---- identity / resolution
    this.identityBox = mk('div', root, 'private-diag-box');
    mk('h4', this.identityBox, 'private-diag-subtitle', 'Identity & resolution');
    this.identityRows = mk('div', this.identityBox, 'private-diag-rows');

    // ---- transfer / announcement / stealth / recovery
    this.stateBox = mk('div', root, 'private-diag-box');
    mk('h4', this.stateBox, 'private-diag-subtitle', 'Transfer, announcement, stealth & recovery');
    this.stateRows = mk('div', this.stateBox, 'private-diag-rows');

    // ---- dry run
    this.dryBox = mk('div', root, 'private-diag-box');
    mk('h4', this.dryBox, 'private-diag-subtitle', 'Dry run');
    mk('p', this.dryBox, 'private-diag-note',
      'Uses the recipient and amount from the private-transfer panel. Resolves, derives a fresh stealth address and reads the wallet — it cannot sign or broadcast.');
    this.dryButton = mk('button', this.dryBox, 'private-diag-btn private-diag-btn-primary', 'RUN DRY RUN');
    this.dryButton.type = 'button';
    this.dryOutput = mk('div', this.dryBox, 'private-diag-output');
    this.dryOutput.hidden = true;

    // ---- key-material assertions (what the tester can verify visually)
    this.assertBox = mk('div', root, 'private-diag-box');
    mk('h4', this.assertBox, 'private-diag-subtitle', 'Key-material guarantees');
    this.assertRows = mk('div', this.assertBox, 'private-diag-rows');

    this.root = root;
  }

  /* ---------------------------------------------------------------- behaviour */
  _bind() {
    if (this._bound) return;
    this._bound = true;
    this.hideButton.addEventListener('click', () => { this.hide(); });
    this.refreshWalletButton.addEventListener('click', () => { this.refreshWallet().catch(() => {}); });
    // The handler RETURNS the promise so a caller (and the re-entrancy guard) always sees
    // the finished dry run, and so a failed preview can never become an unhandled rejection.
    this.dryButton.addEventListener('click', () => {
      if (this._dryRunning) return undefined;
      return this._dryRun().catch(() => {});
    });
    // Live state updates while the tester watches.
    this.game?.events?.on?.('private-transfer:state', () => this.render().catch(() => {}));
    this.game?.events?.on?.('private-transfer:identity', () => this.render().catch(() => {}));
    this.game?.events?.on?.('litvm:wallet', () => { this.refreshWallet().catch(() => {}); });
    this.game?.events?.on?.('private-transfer:cleared', () => this.render().catch(() => {}));
  }

  /** Mount (or unmount) according to test mode. Safe to call repeatedly. */
  sync() {
    if (!this.enabled) {
      this.root.hidden = true;
      return false;
    }
    this._bind();
    if (globalThis.document?.body) globalThis.document.body.classList.add('private-test-mode');
    this.root.hidden = false;
    this.refreshWallet().catch(() => {});
    this.render().catch(() => {});
    return true;
  }

  hide() {
    this.root.hidden = true;
  }

  /* ---------------------------------------------------------------- rendering */
  async refreshWallet() {
    if (!this.enabled) return null;
    const status = await this.session.walletStatus();
    this._renderWallet(status);
    await this.render();
    return status;
  }

  _renderWallet(status) {
    const state = status?.state ?? 'DISCONNECTED';
    this.networkState.textContent = state === 'CONNECTED'
      ? 'CONNECTED'
      : (state === 'WRONG_NETWORK' ? 'WRONG NETWORK — transfers blocked' : 'DISCONNECTED');
    this.networkState.dataset.state = state === 'CONNECTED' ? 'ok' : (state === 'WRONG_NETWORK' ? 'warn' : 'off');
    this.walletRows.replaceChildren();
    row(this.walletRows, 'Wallet address', status?.address ?? null);
    row(this.walletRows, 'Detected chain id', status?.detectedChainId ?? (status?.detectedChainIdHex ?? null));
    row(this.walletRows, 'Expected chain id', `${status?.expected?.chainId ?? '—'} (${status?.expected?.chainIdHex ?? '—'}) · ${status?.expected?.name ?? ''}`);
    row(this.walletRows, 'Wallet type', status?.walletKind ?? null);
    row(this.walletRows, 'Can send', status ? (status.canSend ? 'yes (EOA on LiteForge)' : 'no') : null);
    row(this.walletRows, 'Reason', status?.reason ?? '');
  }

  async render() {
    if (!this.enabled) return null;
    const snapshot = this.session.diagnostics();

    this.identityRows.replaceChildren();
    row(this.identityRows, 'Private identity', snapshot.identity.state);
    row(this.identityRows, 'Username', snapshot.identity.username);
    row(this.identityRows, 'Fingerprint', snapshot.identity.fingerprint ? short(snapshot.identity.fingerprint, 12) : null);
    row(this.identityRows, 'Meta-address present', flag(snapshot.identity.metaAddressPresent));
    row(this.identityRows, 'Key material in memory', flag(snapshot.identity.keysInMemory));
    row(this.identityRows, 'Session bound to account', flag(snapshot.identity.boundAccountPresent));

    this.stateRows.replaceChildren();
    row(this.stateRows, 'Transfer state', snapshot.transfer.state);
    row(this.stateRows, 'Transfer in flight', flag(snapshot.transfer.inFlight));
    row(this.stateRows, 'Pending-payment warning', flag(snapshot.transfer.pendingIntentPresent));
    row(this.stateRows, 'Pending stealth address', snapshot.transfer.pendingStealthAddress ? short(snapshot.transfer.pendingStealthAddress, 12) : null);
    row(this.stateRows, 'Pending payment tx', snapshot.transfer.pendingPaymentTxHash ? short(snapshot.transfer.pendingPaymentTxHash, 14) : null);
    row(this.stateRows, 'Announcement recovery record', flag(snapshot.announcement.recoveryRecordPresent));
    row(this.stateRows, 'Recovery payment tx', snapshot.announcement.paymentTxHash ? short(snapshot.announcement.paymentTxHash, 14) : null);
    row(this.stateRows, 'Last derived stealth address', snapshot.stealth.lastStealthAddress ? short(snapshot.stealth.lastStealthAddress, 12) : null);
    row(this.stateRows, 'Last view tag', snapshot.stealth.lastViewTag);
    row(this.stateRows, 'Last dry-run result', snapshot.stealth.lastStatus);
    row(this.stateRows, 'Recovery via wallet signature', flag(snapshot.recovery.walletSignatureRecoveryAvailable));

    this.assertRows.replaceChildren();
    row(this.assertRows, 'Private keys rendered', NO);
    row(this.assertRows, 'Viewing key rendered', NO);
    row(this.assertRows, 'Spending key rendered', NO);
    row(this.assertRows, 'Seed / mnemonic rendered', NO);
    row(this.assertRows, 'Recovery secret rendered', NO);
    row(this.assertRows, 'Rendered via textContent only', YES);
    this.assertRows.dataset.assertions = 'no-key-material';
    return snapshot;
  }

  /* ---------------------------------------------------------------- dry run */
  _dryLine(label, value) {
    return row(this.dryOutput, label, value);
  }

  async _dryRun() {
    this._dryRunning = true;
    this.dryButton.disabled = true;
    this.dryOutput.hidden = false;
    this.dryOutput.replaceChildren();
    mk('p', this.dryOutput, 'private-diag-dryrun-label', 'DRY RUN — NO TRANSACTION BROADCAST');
    try {
      const recipient = this.panel?.recipient?.value?.trim();
      const amount = this.panel?.amount?.value?.trim();
      if (!recipient || !amount) {
        mk('p', this.dryOutput, 'private-diag-note', 'Enter a recipient and an amount in the private-transfer panel first.');
        return;
      }
      const preview = await this.session.previewSend({
        recipient,
        amount,
        acceptFingerprintChange: this.panel?.fingerprintAck?.checked === true,
      });
      this._dryLine('Status', preview.status);
      this._dryLine('Broadcast', 'no');
      this._dryLine('Recipient', `${preview.recipient}.veyra`);
      this._dryLine('Amount', `${preview.amountFormatted} zkLTC (${preview.amountAtomic} atomic)`);
      this._dryLine('Chain', `${preview.chainId} (${preview.chainIdHex})`);
      this._dryLine('From', preview.wallet?.address ?? null);
      this._dryLine('Wallet type', preview.wallet?.kind ?? null);
      this._dryLine('Fresh stealth address', preview.stealth.stealthAddress);
      this._dryLine('Ephemeral public key', preview.stealth.ephemeralPublicKey);
      this._dryLine('View tag', preview.stealth.viewTag);
      this._dryLine('Payment destination', preview.payment?.to ?? null);
      this._dryLine('Payment value', preview.payment?.value ?? null);
      this._dryLine('Announcer', preview.announcerAddress);
      this._dryLine('Fee estimate', preview.estimate ? `${preview.estimate.feeAtomic} atomic (gas ${preview.estimate.gas} @ ${preview.estimate.gasPriceWei} wei)` : 'unavailable');
      this._dryLine('Expected states', preview.expectedTransitions.join(' → '));
      this._dryLine('Blockers', preview.blockers.length ? preview.blockers.join(', ') : 'none');
      if (preview.warnings.length) this._dryLine('Warnings', preview.warnings.join(' '));
      mk('p', this.dryOutput, 'private-diag-note', preview.note);
    } catch (error) {
      mk('p', this.dryOutput, 'private-diag-error', `${error?.code || error?.message || 'UNKNOWN'}`);
    } finally {
      this._dryRunning = false;
      this.dryButton.disabled = false;
      await this.render().catch(() => {});
    }
  }
}

export { testModeEnabled };
