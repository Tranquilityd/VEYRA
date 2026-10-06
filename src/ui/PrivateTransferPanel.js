// Veyra — Phase 3: private transfer panel (`.veyra → .veyra`).
//
// COPY RULES (brief §17) — non-negotiable, they are enforced by the test suite:
//   * the strongest claim made anywhere is "Recipient-address privacy" — never a
//     claim that a payment cannot be traced;
//   * the promise is "Recipient-address privacy" and the sentence
//     "Bob's normal wallet address is not exposed by this payment.";
//   * the recipient is shown as `bob.veyra` and the destination as "Fresh private address";
//   * Bob's normal wallet address is never displayed, even when we know it locally.
//
// All cryptography and signing happens in `src/stealth/*`; this module only collects
// input, shows state and renders results.
import { TRANSFER_STATES, FAILURE_CODES } from '../stealth/transferState.js';
import { RECOVERY_LOSS_WARNING, decryptBackup, encryptBackup, loadEncryptedBackup, persistEncryptedBackup } from '../stealth/backup.js';
import { UNSUPPORTED_WALLET_MESSAGE } from '../stealth/wallet.js';
import { metaFingerprint } from '../stealth/protocol.js';
import { PrivateTransferDiagnostics } from './PrivateTransferDiagnostics.js';

const mk = (tag, parent, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  parent?.appendChild(el);
  return el;
};

/** Human copy per state. Never overstates the guarantee, never implies a plain transfer. */
const STATE_COPY = Object.freeze({
  idle: 'Ready.',
  resolving_recipient: 'Looking up that Veyra username…',
  recipient_verified: 'Recipient’s private address material verified.',
  deriving_stealth: 'Deriving a fresh private address for this payment…',
  awaiting_wallet: 'Waiting for your wallet…',
  payment_submitted: 'Payment submitted. Waiting for confirmation…',
  payment_confirming: 'Payment confirming on LiteForge…',
  payment_confirmed: 'Payment confirmed. Publishing the private payment notice…',
  announcement_submitting: 'Publishing the private payment notice…',
  announcement_confirmed: 'Private payment notice published.',
  completed: 'Private payment complete.',
  failed: 'The private payment could not be completed.',
  cancelled: 'Cancelled.',
});

const ERROR_COPY = Object.freeze({
  [FAILURE_CODES.WRONG_NETWORK]: 'Switch your wallet to LiteForge and try again.',
  [FAILURE_CODES.WALLET_DISCONNECTED]: 'Connect your wallet and authenticate first.',
  [FAILURE_CODES.INSUFFICIENT_BALANCE]: 'Not enough zkLTC for this amount plus network fees.',
  [FAILURE_CODES.INSUFFICIENT_GAS]: 'Keep a small zkLTC reserve for network fees and try a smaller amount.',
  [FAILURE_CODES.SIGNATURE_REJECTED]: 'The wallet signature was rejected.',
  [FAILURE_CODES.TRANSACTION_REJECTED]: 'The transaction was rejected in your wallet.',
  [FAILURE_CODES.TRANSACTION_FAILED]: 'The payment transaction failed on LiteForge. No private address was credited.',
  [FAILURE_CODES.RPC_FAILURE]: 'The LiteForge RPC did not respond. Nothing was re-sent.',
  [FAILURE_CODES.TIMEOUT]: 'Timed out waiting for confirmation. Your payment may still confirm — check the transaction before retrying.',
  [FAILURE_CODES.ANNOUNCEMENT_FAILED]: 'Your payment is confirmed, but the private payment notice did not publish. The payment is never re-sent: reopen this panel and publish the notice only.',
  [FAILURE_CODES.INVALID_RECIPIENT_META]: 'That recipient’s private address material could not be verified. Nothing was sent.',
  [FAILURE_CODES.RECIPIENT_NOT_FOUND]: 'No Veyra identity found for that username.',
  [FAILURE_CODES.RECIPIENT_NOT_ENROLLED]: 'That Veyra user has not set up private transfers yet.',
  [FAILURE_CODES.UNSUPPORTED_ACCOUNT_TYPE]: UNSUPPORTED_WALLET_MESSAGE,
  [FAILURE_CODES.UNSUPPORTED_WALLET]: UNSUPPORTED_WALLET_MESSAGE,
  [FAILURE_CODES.AMOUNT_INVALID]: 'Enter a valid amount.',
  [FAILURE_CODES.DUPLICATE_ANNOUNCEMENT]: 'This payment notice was already published.',
  'DESTINATION_IS_KNOWN_WALLET': 'That destination is your own known public wallet, which would publicly link the funds to it.',
  'FINGERPRINT_CHANGED': 'This recipient\u2019s private-address material changed since you last paid them. Verify the new fingerprint with them directly before sending.',
  'TRANSFER_IN_PROGRESS': 'A private transfer is already in progress. Wait for it to finish.',
  'BACKUP_AUTHENTICATION_FAILED': 'That passphrase did not decrypt the backup, or the backup was altered.',
  'BACKUP_TOO_WEAK': 'Choose a backup passphrase of at least 8 characters.',
  'BACKUP_MISSING': 'No encrypted backup was found. Paste an exported backup into the box, or restore one stored on this device.',
  'BACKUP_FINGERPRINT_MISMATCH': 'That backup does not match the identity it claims to hold.',
  'KEYS_NOT_IN_MEMORY': 'Your private transfer identity is not unlocked in this session. Recover it from your wallet signature, or import your encrypted backup.',
  'RECOVERY_UNAVAILABLE': 'Recovery from a wallet signature is unavailable. Import your encrypted backup instead.',
  'PRIVATE_TRANSFER_USERNAME_REQUIRED': 'Claim a permanent .veyra username first.',
});

const copyFor = (code, fallback) => ERROR_COPY[code] || fallback || 'Something went wrong. Nothing was sent.';

export class PrivateTransferPanel {
  constructor(game) {
    this.game = game;
    this.session = game.privateTransfer;
    this.open = false;
    this.busy = false;
    this.state = 'idle';
    this.received = [];
    this._build();
    this._bind();
    // Phase 4A: manual-validation diagnostics, present ONLY when the tester explicitly
    // enabled test mode. It is read-only and never participates in a transfer.
    this.diagnostics = new PrivateTransferDiagnostics(game, { panel: this });
    this.diagnostics.sync();
    this.refresh().catch(() => {});
  }

  /* ---------------------------------------------------------------- structure */
  _build() {
    const root = mk('div', document.body, 'private-overlay');
    root.hidden = true;
    const card = mk('section', root, 'private-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'private-title');

    const header = mk('div', card, 'private-header');
    mk('p', header, 'private-eyebrow', 'VEYRA PRIVATE TRANSFER');
    this.title = mk('h2', header, 'private-title', 'Private zkLTC Transfers');
    this.title.id = 'private-title';
    this.closeButton = mk('button', header, 'private-close', '✕');
    this.closeButton.type = 'button';
    this.closeButton.setAttribute('aria-label', 'Close');

    mk('p', card, 'private-lead',
      'Recipient-address privacy for .veyra → .veyra payments. Bob’s normal wallet address is not exposed by this payment.');

    // ---- status strip
    this.statusEl = mk('p', card, 'private-status');
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');

    // Wallet/network state, always visible: CONNECTED / WRONG NETWORK / DISCONNECTED.
    // Purely informative — the real send still re-checks the chain and fails closed.
    this.networkEl = mk('p', card, 'private-network');
    this.networkEl.setAttribute('role', 'status');
    this.networkEl.dataset.state = 'off';

    // ---- identity / enrollment
    this.setup = mk('section', card, 'private-section');
    mk('h3', this.setup, 'private-section-title', 'Your private transfer identity');
    this.identityEl = mk('p', this.setup, 'private-note');
    const setupActions = mk('div', this.setup, 'private-actions');
    this.createButton = mk('button', setupActions, 'private-btn private-btn-primary', 'CREATE PRIVATE IDENTITY');
    this.createButton.type = 'button';
    this.recoverButton = mk('button', setupActions, 'private-btn', 'RECOVER FROM WALLET SIGNATURE');
    this.recoverButton.type = 'button';
    this.backupButton = mk('button', setupActions, 'private-btn', 'EXPORT ENCRYPTED BACKUP');
    this.backupButton.type = 'button';
    this.importButton = mk('button', setupActions, 'private-btn', 'IMPORT ENCRYPTED BACKUP');
    this.importButton.type = 'button';
    mk('p', this.setup, 'private-warning', RECOVERY_LOSS_WARNING);

    const passField = mk('label', this.setup, 'private-field');
    mk('span', passField, 'private-label', 'Backup passphrase (never sent anywhere)');
    this.passphrase = mk('input', passField, 'private-input');
    this.passphrase.type = 'password';
    this.passphrase.autocomplete = 'new-password';
    this.passphrase.setAttribute('aria-describedby', 'private-warning');

    this.backupOutput = mk('textarea', this.setup, 'private-output');
    this.backupOutput.readOnly = true;
    this.backupOutput.rows = 3;
    this.backupOutput.hidden = true;
    this.backupOutput.setAttribute('aria-label', 'Encrypted backup');

    // ---- send
    this.sendSection = mk('section', card, 'private-section');
    mk('h3', this.sendSection, 'private-section-title', 'Send privately');
    const sendFields = mk('div', this.sendSection, 'private-fields');
    const toField = mk('label', sendFields, 'private-field');
    mk('span', toField, 'private-label', 'Recipient');
    this.recipient = mk('input', toField, 'private-input');
    this.recipient.type = 'text';
    this.recipient.placeholder = 'bob.veyra';
    this.recipient.autocomplete = 'off';
    this.recipient.autocapitalize = 'off';
    this.recipient.spellcheck = false;
    const amountField = mk('label', sendFields, 'private-field');
    mk('span', amountField, 'private-label', 'Amount (zkLTC)');
    this.amount = mk('input', amountField, 'private-input');
    this.amount.type = 'text';
    this.amount.inputMode = 'decimal';
    this.amount.placeholder = '0.001';
    this.amount.autocomplete = 'off';

    this.recipientNote = mk('p', this.sendSection, 'private-note');
    this.destinationNote = mk('p', this.sendSection, 'private-note', 'Destination: Fresh private address');
    const sendActions = mk('div', this.sendSection, 'private-actions');
    this.sendButton = mk('button', sendActions, 'private-btn private-btn-primary', 'SEND PRIVATELY');
    this.sendButton.type = 'button';
    this.retryButton = mk('button', sendActions, 'private-btn', 'PUBLISH PAYMENT NOTICE ONLY');
    this.retryButton.type = 'button';
    this.retryButton.hidden = true;
    this.dismissButton = mk('button', sendActions, 'private-btn', 'DISMISS STALE-PAYMENT WARNING');
    this.dismissButton.type = 'button';
    this.dismissButton.hidden = true;

    const ackLabel = mk('label', this.sendSection, 'private-ack');
    this.fingerprintAck = mk('input', ackLabel, 'private-ack-input');
    this.fingerprintAck.type = 'checkbox';
    mk('span', ackLabel, 'private-ack-text',
      'I verified this recipient\u2019s new private-address fingerprint with them directly (required only if it changed).');
    this.staleWarning = mk('p', this.sendSection, 'private-warning');
    this.staleWarning.hidden = true;
    mk('p', this.sendSection, 'private-subnote',
      'Only the amount and a fresh one-time address are sent on-chain. The payment never falls back to a normal wallet-to-wallet transfer.');

    // ---- receive
    this.receiveSection = mk('section', card, 'private-section');
    mk('h3', this.receiveSection, 'private-section-title', 'Check for private payments');
    mk('p', this.receiveSection, 'private-note',
      'Scanning happens on this device with your viewing key. Veyra never receives your viewing key and never returns a per-user list of payments.');
    const receiveActions = mk('div', this.receiveSection, 'private-actions');
    this.scanButton = mk('button', receiveActions, 'private-btn', 'SCAN FOR PAYMENTS');
    this.scanButton.type = 'button';
    this.receiveList = mk('ul', this.receiveSection, 'private-list');

    // ---- technical explanation
    const details = mk('details', card, 'private-details');
    mk('summary', details, 'private-summary', 'How private transfers work');
    const explain = mk('div', details, 'private-explainer');
    for (const line of [
      'Each payment goes to a brand-new address derived from the recipient’s public stealth keys and a one-time key. Nothing on-chain links that address to the recipient’s wallet.',
      'The recipient finds the payment by scanning public announcements with their viewing key. Only they can derive the key that controls the funds.',
      'This is recipient-address privacy and unlinkability. It does not hide the amount or the timing of the payment, which stay public on-chain.',
      'Moving funds out of a private address to a wallet that is publicly yours links them together again.',
    ]) mk('p', explain, 'private-note', line);
    mk('p', explain, 'private-subnote', `Chain: ${this.session.chainLabel}. Announcer contract: ${this.session.announcerAddress}.`);

    // ---- Phase 4A manual-validation mode (developer tooling, OFF by default)
    this.testRow = mk('p', explain, 'private-subnote private-test-row');
    mk('span', this.testRow, 'private-test-label', 'Developer / manual validation:');
    this.testModeButton = mk('button', this.testRow, 'private-test-toggle', 'ENABLE TEST MODE');
    this.testModeButton.type = 'button';

    this.root = root;
  }

  /* ---------------------------------------------------------------- behaviour */
  _bind() {
    this.closeButton.addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (event) => { if (event.target === this.root) this.close(); });
    document.addEventListener('keydown', (event) => {
      if (!this.open) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') this.close();
    }, true);

    const chip = document.getElementById('chip-private');
    if (chip) chip.addEventListener('click', () => { this._sound('click'); this.toggle(); });

    this.createButton.addEventListener('click', () => { if (this.busy) return; this._createIdentity(); });
    this.recoverButton.addEventListener('click', () => { if (this.busy) return; this._recoverIdentity(); });
    this.backupButton.addEventListener('click', () => { if (this.busy) return; this._exportBackup(); });
    this.importButton.addEventListener('click', () => { if (this.busy) return; this._importBackup(); });
    this.sendButton.addEventListener('click', () => { if (this.busy) return; this._send(); });
    this.retryButton.addEventListener('click', () => { if (this.busy) return; this._retryAnnouncement(); });
    this.dismissButton.addEventListener('click', () => {
      this.session.client.dismissPendingIntent();
      this.staleWarning.hidden = true;
      this.dismissButton.hidden = true;
    });
    this.scanButton.addEventListener('click', () => { if (this.busy) return; this._scan(); });
    this.recipient.addEventListener('blur', () => this._previewRecipient());
    this.testModeButton.addEventListener('click', () => {
      const enabled = this.session.setTestMode(!this.session.testMode);
      this.diagnostics.sync();
      this._renderTestMode();
      if (!enabled) globalThis.document?.body?.classList.remove('private-test-mode');
    });
  }

  _sound(name) { try { this.game.audio.play(name); } catch { /* audio is optional */ } }

  toggle() { this.open ? this.close() : this.show(); }

  show() {
    this.open = true;
    this.root.hidden = false;
    document.body.classList.add('private-open');
    this.refresh().catch(() => {});
  }

  close() {
    this.open = false;
    this.root.hidden = true;
    document.body.classList.remove('private-open');
  }

  _setState(state, detail = '') {
    this.state = state;
    this.statusEl.dataset.state = state;
    this.statusEl.textContent = `${STATE_COPY[state] || state}${detail ? ` ${detail}` : ''}`;
    this.sendButton.disabled = this.busy || ['payment_submitted', 'payment_confirming', 'announcement_submitting'].includes(state);
  }

  _error(error) {
    const code = error?.code || error?.message || 'UNKNOWN';
    this.statusEl.dataset.state = 'failed';
    this.statusEl.textContent = copyFor(code, error?.message);
    // The announcement-failure path offers only the notice republish, never a resend.
    this.retryButton.hidden = code !== FAILURE_CODES.ANNOUNCEMENT_FAILED;
  }

  _setBusy(busy) {
    this.busy = busy;
    for (const button of [this.createButton, this.recoverButton, this.backupButton, this.importButton, this.sendButton, this.scanButton, this.retryButton]) {
      if (button) button.disabled = busy;
    }
    if (!busy) this.sendButton.disabled = false;
  }

  /** Panel-side view of the public identity. Never displays any wallet address. */
  /** HUD chip reflects readiness only — never a wallet address, never a balance. */
  /** Renders the always-visible wallet/network state line (Phase 4A §3). */
  _renderNetwork(status) {
    if (!this.networkEl) return;
    const state = status?.state ?? 'DISCONNECTED';
    this.networkEl.dataset.state = state === 'CONNECTED' ? 'ok' : (state === 'WRONG_NETWORK' ? 'warn' : 'off');
    if (state === 'CONNECTED') {
      this.networkEl.textContent = `Wallet CONNECTED · LiteForge ${status.expected.chainId} (${status.expected.chainIdHex}) · ${status.walletKind ?? 'wallet type unknown'}`;
    } else if (state === 'WRONG_NETWORK') {
      this.networkEl.textContent = `Wallet WRONG NETWORK — detected ${status.detectedChainIdHex ?? 'unreadable'}, expected ${status.expected.chainIdHex}. Transfers are blocked until your wallet is on LiteForge (chain ${status.expected.chainId}).`;
    } else {
      this.networkEl.textContent = 'Wallet DISCONNECTED — connect and authenticate to use private transfers.';
    }
  }

  _renderTestMode() {
    if (!this.testModeButton) return;
    this.testModeButton.textContent = this.session.testMode ? 'DISABLE TEST MODE' : 'ENABLE TEST MODE';
    this.testModeButton.dataset.state = this.session.testMode ? 'on' : 'off';
  }

  _renderChip({ state, label, note }) {
    const chip = document.getElementById('chip-private');
    if (!chip) return;
    chip.dataset.state = state;
    const labelEl = document.getElementById('private-chip-state');
    const noteEl = document.getElementById('private-chip-note');
    if (labelEl) labelEl.textContent = label;
    if (noteEl) noteEl.textContent = note;
  }

  _renderPendingIntent() {
    const pending = this.session.client.pendingIntent?.() ?? null;
    this.staleWarning.hidden = !pending;
    this.dismissButton.hidden = !pending;
    if (pending) {
      this.staleWarning.textContent = 'A private payment may already have been submitted from this device '
        + `(fresh address ${String(pending.stealthAddress).slice(0, 10)}\u2026, ${pending.amountAtomic} atomic units at ${pending.at}`
        + (pending.paymentTxHash ? `, transaction ${String(pending.paymentTxHash).slice(0, 12)}\u2026` : '')
        + '). Check your wallet and the LiteForge explorer before sending again, then dismiss this warning.';
    }
  }

  async refresh() {
    const session = this.session;
    this._renderPendingIntent();
    this._renderTestMode();
    this._renderNetwork(await session.walletStatus().catch(() => null));
    if (!session.connected) {
      this.identityEl.textContent = 'Connect and authenticate your wallet to use private transfers.';
      this.createButton.disabled = true;
      this.recoverButton.disabled = true;
      this.backupButton.disabled = true;
      this.importButton.disabled = true;
      this._renderChip({ state: 'off', label: 'CONNECT WALLET', note: 'RECIPIENT-ADDRESS PRIVACY' });
      return;
    }
    this.createButton.disabled = this.busy;
    this.recoverButton.disabled = this.busy;
    let identity = session.identity;
    try { identity = await session.load() ?? session.identity; } catch { /* offline: keep the cache */ }
    if (!identity?.metaAddress) {
      this.identityEl.textContent = 'Not set up yet. Create a private transfer identity, or recover an existing one from your wallet signature.';
      this.backupButton.disabled = true;
      this._renderChip({ state: 'action', label: 'SET UP', note: 'RECIPIENT-ADDRESS PRIVACY' });
      return;
    }
    // Public values only: the fingerprint is a short, non-secret identifier.
    this.identityEl.textContent = `Set up for ${identity.username ?? 'this account'} · fingerprint ${identity.fingerprint?.slice(0, 8) ?? '—'}`;
    this.backupButton.disabled = this.busy;
    this._renderChip({ state: 'ready', label: (identity.fingerprint || '').slice(0, 8).toUpperCase() || 'READY', note: 'RECIPIENT-ADDRESS PRIVACY' });
  }

  async _createIdentity() {
    const username = this.game.identity?.snapshot?.().username;
    if (!username) { this._error({ code: 'PRIVATE_TRANSFER_USERNAME_REQUIRED', message: 'Claim a permanent .veyra username first.' }); return; }
    const passphrase = this.passphrase.value;
    if (passphrase.length < 8) { this._error({ code: 'BACKUP_TOO_WEAK', message: 'Choose a backup passphrase of at least 8 characters.' }); return; }
    this._setBusy(true);
    try {
      const result = await this.session.client.enroll({ username, passphrase });
      this.session.cacheIdentity({ ...result, username });
      this.backupOutput.hidden = false;
      this.backupOutput.value = JSON.stringify(result.backup);
      this._setState('idle', 'Your private transfer identity is ready. Store the exported backup somewhere safe.');
    } catch (error) {
      if (error.code === FAILURE_CODES.UNSUPPORTED_ACCOUNT_TYPE || error.code === FAILURE_CODES.UNSUPPORTED_WALLET) {
        this.statusEl.dataset.state = 'failed';
        this.statusEl.textContent = UNSUPPORTED_WALLET_MESSAGE;
      } else this._error(error);
    } finally { this._setBusy(false); }
  }

  /**
   * Recovery is offered as its own action so "create" can never silently replace an
   * existing identity. A fingerprint mismatch refuses automatic recovery and points
   * at the encrypted backup instead (brief §5).
   */
  async _recoverIdentity() {
    const username = this.game.identity?.snapshot?.().username;
    if (!username) { this._error({ code: 'PRIVATE_TRANSFER_USERNAME_REQUIRED', message: 'Claim a permanent .veyra username first.' }); return; }
    this._setBusy(true);
    try {
      const derived = await this.session.client.recover({
        username,
        expectedFingerprint: this.session.identity?.fingerprint ?? null,
      });
      this.session.cacheIdentity({ ...derived, username });
      this._setState('idle', 'Recovered from your wallet signature.');
    } catch (error) {
      if (error.code === 'RECOVERY_FINGERPRINT_MISMATCH') {
        // Never silently create a second identity: a non-deterministic wallet must be
        // restored from the encrypted backup instead.
        this.statusEl.dataset.state = 'failed';
        this.statusEl.textContent = 'This wallet produced a different private identity than the one recorded. Automatic recovery is refused — import your encrypted backup instead.';
        return;
      }
      this._error(error);
    } finally { this._setBusy(false); }
  }

  async _exportBackup() {
    const passphrase = this.passphrase.value;
    if (passphrase.length < 8) { this._error({ code: 'BACKUP_TOO_WEAK', message: 'Choose a backup passphrase of at least 8 characters.' }); return; }
    try {
      const keys = this.session.client.identityKeys?.();
      if (!keys) throw new Error('KEYS_NOT_IN_MEMORY');
      const envelope = await encryptBackup(keys, passphrase);
      persistEncryptedBackup(envelope, { username: keys.username, indexedDB: globalThis.indexedDB }).catch(() => {});
      this.backupOutput.hidden = false;
      this.backupOutput.value = JSON.stringify(envelope);
      this.statusEl.textContent = 'Encrypted backup exported. Store it somewhere safe — it is never uploaded by Veyra.';
    } catch (error) { this._error(error); }
  }

  async _importBackup() {
    const passphrase = this.passphrase.value;
    try {
      let envelope = null;
      try { envelope = await loadEncryptedBackup({ username: this.session.identity?.username, indexedDB: globalThis.indexedDB }); } catch { /* none stored */ }
      const text = this.backupOutput.value?.trim();
      if (text) envelope = JSON.parse(text);
      if (!envelope) { this._error({ code: 'BACKUP_MISSING', message: 'Paste an exported backup into the box, or restore one stored on this device.' }); return; }
      const restored = await decryptBackup(envelope, passphrase);
      if (envelope.fingerprint && metaFingerprint(restored.metadata?.metaAddress) !== envelope.fingerprint) {
        throw new Error('BACKUP_FINGERPRINT_MISMATCH');
      }
      // If this browser already knows a fingerprint for this account, the imported
      // identity must match it — otherwise the backup belongs to another identity and
      // adopting it would silently switch accounts (Phase 3.5 finding M-05).
      const expected = this.session.identity?.fingerprint ?? null;
      const restoredFingerprint = restored.metadata?.fingerprint ?? metaFingerprint(restored.metadata?.metaAddress);
      if (expected && expected !== restoredFingerprint) {
        throw new Error('BACKUP_FINGERPRINT_MISMATCH');
      }
      const snapshot = this.session.client.rememberIdentity({ ...restored, metaAddress: restored.metadata?.metaAddress, username: restored.metadata?.username });
      this.session.cacheIdentity({ ...snapshot, username: restored.metadata?.username });
      this._setState('idle', 'Backup imported.');
    } catch (error) { this._error(error); }
  }

  async _previewRecipient() {
    const raw = this.recipient.value.trim();
    if (!raw) { this.recipientNote.textContent = ''; return; }
    try {
      const resolved = await this.session.client.resolve(raw);
      // Bob's normal wallet is never shown: only the username and the public fingerprint.
      this.recipientNote.textContent = resolved.fingerprintChanged
        ? `${resolved.username}.veyra has changed their private-address material since you last paid them. Verify before sending.`
        : `${resolved.username}.veyra · private-address fingerprint ${resolved.fingerprint}`;
      this.recipientNote.dataset.state = resolved.fingerprintChanged ? 'warn' : 'ok';
    } catch (error) {
      this.recipientNote.textContent = copyFor(error.code, error.message);
      this.recipientNote.dataset.state = 'warn';
    }
  }

  async _send() {
    this.retryButton.hidden = true;
    this._setBusy(true);
    try {
      const result = await this.session.client.send({
        recipient: this.recipient.value.trim(),
        amount: this.amount.value.trim(),
        onState: (state) => this._setState(state),
        acceptFingerprintChange: this.fingerprintAck.checked === true,
      });
      this._setState('completed', `${result.amountAtomic} atomic units to a fresh private address.`);
      this.statusEl.textContent = `Private payment complete. ${result.recipient}.veyra received it at a fresh address; their normal wallet address was not used.`
        + (result.dustWarning ? ` ${result.dustWarning}` : '');
    } catch (error) {
      this._error(error);
      if (error.code === FAILURE_CODES.ANNOUNCEMENT_FAILED) {
        this.statusEl.textContent = `${copyFor(error.code)} Your payment is safe — publishing the notice again never moves funds.`;
      }
    } finally { this._setBusy(false); }
  }

  /** Publishes ONLY the announcement for a payment that already settled. */
  async _retryAnnouncement() {
    this._setBusy(true);
    try {
      const result = await this.session.client.retryAnnouncement();
      this._setState('completed', `Payment notice published in ${result.announcementTxHash.slice(0, 10)}…`);
      this.retryButton.hidden = true;
    } catch (error) { this._error(error); } finally { this._setBusy(false); }
  }

  async _scan() {
    this._setBusy(true);
    try {
      // The client uses this session's in-memory identity keys; the panel never sees them.
      if (!this.session.client.identityKeys?.()) throw new Error('KEYS_NOT_IN_MEMORY');
      const result = await this.session.client.scan();
      this.received = result.matches;
      this.receiveList.replaceChildren();
      if (!result.matches.length) mk('li', this.receiveList, 'private-list-empty', 'No private payments found in the scanned window.');
      for (const match of result.matches) {
        const item = mk('li', this.receiveList, 'private-list-item');
        mk('span', item, 'private-list-address', `Fresh private address ${match.stealthAddress.slice(0, 10)}…`);
        mk('small', item, 'private-list-meta', 'Funds are controlled by you alone. Move them to a fresh destination when you spend.');
        mk('small', item, 'private-list-meta', 'Spending to a wallet that is publicly yours links the funds to it.');
      }
      this._setState('idle', `${result.matches.length} private payment(s) found in ${result.scanned} announcement(s).`);
    } catch (error) { this._error(error); } finally { this._setBusy(false); }
  }
}

export { STATE_COPY, ERROR_COPY, TRANSFER_STATES };
