// Veyra — Phase 1: permanent .veyra identity onboarding and display.
//
// Visual treatment lives in styles/identity.css so it inherits the established
// Veyra palette and typography tokens. This module owns structure, live
// validation, claiming and graceful loading/error states only.
//
// The panel is deliberately non-blocking: if the identity service is
// unavailable the player keeps playing and the HUD chip reports the problem.
import { USERNAME_MAX_LENGTH, USERNAME_RULES_TEXT, USERNAME_SUFFIX_DISPLAY, validateUsername } from '../identity/username.js';

const mk = (tag, parent, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  parent?.appendChild(el);
  return el;
};
const short = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '');
const DEBOUNCE_MS = 350;
const STATUS_ICON = { available: '✓', checking: '…', taken: '✕', invalid: '✕', reserved: '✕', error: '!', empty: '' };

export class IdentityPanel {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.submitting = false;
    this.timer = null;
    this.wasLocked = false;
    this.status = { status: 'empty', message: '', displayName: null };
    this._build();
    this._bind();
    game.events.on('identity:changed', () => this.render());
    this.render();
  }

  // ---------------------------------------------------------------- structure
  _build() {
    const root = mk('div', document.body, 'identity-overlay');
    root.hidden = true;
    const card = mk('section', root, 'identity-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'identity-title');

    mk('p', card, 'identity-eyebrow', 'VEYRA IDENTITY LAYER');
    this.title = mk('h2', card, 'identity-title', 'Create Your Veyra Identity');
    this.title.id = 'identity-title';
    this.lead = mk('p', card, 'identity-lead',
      'Your Veyra username is permanent. It belongs to this wallet and cannot be renamed, traded or transferred.');

    // ---- setup view
    this.setup = mk('div', card, 'identity-view');
    const field = mk('label', this.setup, 'identity-field');
    this.input = mk('input', field, 'identity-input');
    this.input.type = 'text';
    this.input.maxLength = USERNAME_MAX_LENGTH + USERNAME_SUFFIX_DISPLAY.length;
    this.input.autocomplete = 'off';
    this.input.autocapitalize = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('aria-describedby', 'identity-status identity-rules');
    this.input.placeholder = 'lester';
    mk('span', field, 'identity-suffix', USERNAME_SUFFIX_DISPLAY);

    this.statusEl = mk('p', this.setup, 'identity-status');
    this.statusEl.id = 'identity-status';
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    this.rulesEl = mk('p', this.setup, 'identity-rules', USERNAME_RULES_TEXT);
    this.rulesEl.id = 'identity-rules';

    const actions = mk('div', this.setup, 'identity-actions');
    this.claimButton = mk('button', actions, 'identity-btn identity-btn-primary', 'CLAIM USERNAME');
    this.claimButton.type = 'button';
    this.laterButton = mk('button', actions, 'identity-btn', 'MAYBE LATER');
    this.laterButton.type = 'button';

    // ---- claimed view
    this.done = mk('div', card, 'identity-view identity-view-done');
    this.done.hidden = true;
    mk('p', this.done, 'identity-done-label', 'Your Veyra identity is ready.');
    this.doneName = mk('p', this.done, 'identity-done-name', '');
    this.doneWallet = mk('p', this.done, 'identity-done-wallet', '');
    mk('p', this.done, 'identity-done-note', 'This username is permanent and is permanently bound to this wallet.');
    this.doneButton = mk('button', this.done, 'identity-btn identity-btn-primary', 'ENTER VEYRA');
    this.doneButton.type = 'button';

    this.root = root;
  }

  // ---------------------------------------------------------------- behaviour
  _bind() {
    this.input.addEventListener('input', () => this._onInput());
    this.input.addEventListener('blur', () => { clearTimeout(this.timer); this._onInput({ immediate: true }); });
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._claim(); } });
    this.claimButton.addEventListener('click', () => this._claim());
    this.laterButton.addEventListener('click', () => this.close());
    this.doneButton.addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => { if (e.target === this.root) this.close(); });

    // Escape is captured before InputManager can read it as Resume, matching the
    // Guide/Credits convention in UIManager.
    document.addEventListener('keydown', (e) => {
      if (!this.open) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') this.close();
    }, true);

    const chip = document.getElementById('chip-identity');
    if (chip) chip.addEventListener('click', () => { this.game.audio.play('click'); this.toggle(); });
  }

  _sound(name) { try { this.game.audio.play(name); } catch { /* audio is optional */ } }

  _setStatus(next) {
    this.status = { displayName: null, ...next };
    const icon = STATUS_ICON[this.status.status] || '';
    this.statusEl.dataset.state = this.status.status;
    this.statusEl.textContent = this.status.message ? `${icon} ${this.status.message}`.trim() : '';
    const claimable = this.status.status === 'available';
    this.claimButton.disabled = !claimable || this.submitting;
    if (!this.submitting) {
      this.claimButton.textContent = claimable && this.status.displayName
        ? `CLAIM ${this.status.displayName.toUpperCase()}`
        : 'CLAIM USERNAME';
    }
  }

  _reset() {
    this.input.value = '';
    this.status = { status: 'empty', message: '', displayName: null };
    this._setStatus(this.status);
  }

  _onInput({ immediate = false } = {}) {
    clearTimeout(this.timer);
    // Any pending probe belongs to the previous value, even when the new value
    // is locally invalid and issues no request of its own.
    this.game.identity.invalidateChecks();
    const raw = this.input.value;
    const validated = validateUsername(raw);
    if (!String(raw).trim()) { this._setStatus({ status: 'empty', message: '' }); return; }
    // Local validation renders instantly; only structurally valid names spend a
    // network call (and therefore the availability rate limit).
    if (!validated.ok) {
      this._setStatus({ status: validated.reserved ? 'reserved' : 'invalid', message: validated.message });
      return;
    }
    this._setStatus({ status: 'checking', message: `Checking ${validated.displayName}…`, displayName: validated.displayName });
    if (immediate) { this._check(raw); return; }
    this.timer = setTimeout(() => this._check(raw), DEBOUNCE_MS);
  }

  async _check(raw) {
    const result = await this.game.identity.checkUsername(raw);
    if (!result) return;   // superseded by a newer keystroke
    this._setStatus(result);
  }

  async _claim() {
    if (this.submitting) return;
    const validated = validateUsername(this.input.value);
    if (!validated.ok) {
      this._setStatus({ status: validated.reserved ? 'reserved' : 'invalid', message: validated.message });
      return;
    }
    this.submitting = true;
    this.claimButton.disabled = true;
    this.claimButton.textContent = 'CLAIMING…';
    try {
      await this.game.identity.claim(validated.username);
      this._sound('confirm');
      this._showClaimed();
    } catch (error) {
      this._sound('back');
      if (error.code === 'USERNAME_TAKEN') this._setStatus({ status: 'taken', message: error.message });
      else if (error.code === 'USERNAME_ALREADY_CLAIMED') { this._showClaimed(); }
      else this._setStatus({ status: 'error', message: error.message });
    } finally {
      this.submitting = false;
      if (this.status.status === 'available') this._setStatus(this.status);
      else this.claimButton.disabled = true;
      if (this.claimButton.textContent === 'CLAIMING…') this.claimButton.textContent = 'CLAIM USERNAME';
    }
  }

  _showSetup() {
    const snapshot = this.game.identity.snapshot();
    this.title.textContent = 'Create Your Veyra Identity';
    this.lead.textContent = 'Your Veyra username is permanent. It belongs to this wallet and cannot be renamed, traded or transferred.';
    this.setup.hidden = false;
    this.done.hidden = true;
    this._reset();
    if (snapshot.error) {
      this._setStatus({ status: 'error', message: 'The identity service is unavailable right now. You can keep playing and try again later.' });
    }
  }

  _showClaimed() {
    const snapshot = this.game.identity.snapshot();
    this.title.textContent = 'Your Veyra Identity';
    this.lead.textContent = 'This identity is permanent and bound to your connected wallet.';
    this.doneName.textContent = snapshot.displayName || '';
    this.doneWallet.textContent = snapshot.walletAddress ? `Owner wallet · ${short(snapshot.walletAddress)}` : '';
    this.setup.hidden = true;
    this.done.hidden = false;
  }

  // ------------------------------------------------------------------- public
  render() {
    const snapshot = this.game.identity.snapshot();
    const chip = document.getElementById('chip-identity');
    const label = document.getElementById('identity-chip-name');
    if (label) {
      if (snapshot.hasUsername) label.textContent = snapshot.displayName;
      else if (snapshot.error) label.textContent = 'IDENTITY OFFLINE';
      else if (!snapshot.loaded) label.textContent = 'CONNECT WALLET';
      else label.textContent = 'CLAIM .VEYRA';
    }
    if (chip) {
      chip.dataset.state = snapshot.hasUsername ? 'claimed' : snapshot.error ? 'error' : 'claimable';
      chip.title = snapshot.hasUsername
        ? `Your permanent Veyra identity: ${snapshot.displayName}`
        : snapshot.error ? 'Veyra identity service unavailable — tap to retry' : 'Claim your permanent .veyra username';
    }
    if (this.open) {
      if (this.done.hidden && snapshot.hasUsername) this._showClaimed();
      if (!this.done.hidden && !snapshot.hasUsername) this._showSetup();
    }
    return snapshot;
  }

  maybeAutoPrompt() {
    const snapshot = this.game.identity.snapshot();
    if (!snapshot.loaded || snapshot.hasUsername || !this.game.identity.shouldPrompt()) return false;
    if (this.open || this.game.overlay.openId || this.game.transition.active) return false;
    const state = this.game.states.currentName;
    if (state !== 'play' && state !== 'menu') return false;
    this.game.identity.markPrompted();
    // A short beat so the prompt never competes with the world-entry transition.
    setTimeout(() => {
      if (this.open || this.game.overlay.openId || this.game.transition.active) return;
      this.openPanel();
    }, 900);
    return true;
  }

  openPanel() {
    const snapshot = this.game.identity.snapshot();
    if (snapshot.hasUsername) this._showClaimed();
    else this._showSetup();
    this.open = true;
    this.wasLocked = this.game.input.locked;
    this.game.input.locked = true;
    this.root.hidden = false;
    if (!snapshot.hasUsername) setTimeout(() => this.input.focus(), 40);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    clearTimeout(this.timer);
    this.root.hidden = true;
    if (!this.wasLocked && !this.game.overlay.openId) this.game.input.locked = false;
  }

  toggle() { this.open ? this.close() : this.openPanel(); }
}
