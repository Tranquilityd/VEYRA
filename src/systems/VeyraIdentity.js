// Veyra — Phase 1: client identity system.
//
// Owns the player's .veyra identity state and talks to /api/identity/*. It is
// deliberately non-authoritative: the server and the database decide whether a
// username is valid, available or claimed. This class never throws into the game
// loop — a failed identity load degrades to "unavailable" and gameplay continues.
//
// Local validation reuses the SAME canonical module as the server
// (src/identity/username.js) so the player sees an instant answer, and the
// availability endpoint is only consulted for names that already pass locally.
import { USERNAME_REASONS, formatDisplayName, validateUsername } from '../identity/username.js';

const TOKEN_KEY = 'veyra:api-session';
const PROMPT_KEY = 'veyra:identity-prompted';

// Server codes -> player-facing copy. Raw server text is never surfaced.
const MESSAGES = Object.freeze({
  USERNAME_TAKEN: 'That username is already taken.',
  USERNAME_ALREADY_CLAIMED: 'This wallet already has a permanent Veyra username.',
  USERNAME_RESERVED: 'This username is reserved by Veyra.',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Please wait a moment and try again.',
  UNAUTHORIZED: 'Connect and authenticate your wallet to claim a username.',
  NOT_FOUND: 'That Veyra identity could not be found.',
});

const messageFor = (code, fallback) => MESSAGES[code] || fallback || 'Something went wrong. Please try again.';

const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };

export class VeyraIdentity {
  constructor(events) {
    this.events = events;
    this.identity = null;
    this.loaded = false;
    this.error = null;
    this.loading = null;
    this.checkSequence = 0;
    events.on('litvm:wallet', (state) => this._onWalletState(state));
  }

  snapshot() {
    return {
      username: this.identity?.username || null,
      displayName: this.identity?.displayName || null,
      walletAddress: this.identity?.walletAddress || null,
      hasUsername: Boolean(this.identity?.hasUsername),
      loaded: this.loaded,
      error: this.error,
    };
  }

  _emit() {
    const snapshot = this.snapshot();
    this.events.emit('identity:changed', snapshot);
    return snapshot;
  }

  _onWalletState(state) {
    if (state?.state === 'connected') { this.load().catch(() => {}); return; }
    if (state?.state === 'disconnected' || state?.state === 'failed') {
      this.identity = null;
      this.loaded = false;
      this.error = null;
      this._emit();
    }
  }

  async _api(path, options = {}) {
    const token = readToken();
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
    });
    let payload = {};
    try { payload = await response.json(); } catch { /* non-JSON failure */ }
    if (!response.ok) {
      const error = new Error(messageFor(payload.error, payload.error));
      error.code = payload.error || 'INTERNAL_ERROR';
      throw error;
    }
    return payload;
  }

  /** Load the authenticated player's identity. Never throws. */
  async load({ force = false } = {}) {
    if (!readToken()) { this.identity = null; this.loaded = false; this.error = null; return this._emit(); }
    if (this.loading) return this.loading;
    if (this.loaded && !force) return this.snapshot();
    this.loading = (async () => {
      try {
        const data = await this._api('/api/identity/me');
        this.identity = data.identity;
        this.error = null;
      } catch (error) {
        this.identity = null;
        this.error = error.code || 'INTERNAL_ERROR';
      } finally {
        this.loaded = true;
        this.loading = null;
      }
      return this._emit();
    })();
    return this.loading;
  }

  /**
   * Discards any in-flight availability probe. Called whenever the field
   * changes — including when the new value is locally invalid and therefore
   * issues no request — so a late reply can never overwrite a newer verdict.
   */
  invalidateChecks() { this.checkSequence += 1; }

  /**
   * Live availability probe. Locally invalid names are answered without a
   * network call, so typing never spends the availability rate limit.
   * Returns { status, reason, message, displayName }, or null when superseded.
   */
  async checkUsername(raw, { local = false } = {}) {
    const validated = validateUsername(raw);
    if (!validated.ok) {
      if (!String(raw ?? '').trim()) return { status: 'empty', reason: validated.reason, message: '', displayName: null };
      return { status: validated.reserved ? 'reserved' : 'invalid', reason: validated.reason, message: validated.message, displayName: null };
    }
    if (local) return { status: 'checking', reason: null, message: '', displayName: validated.displayName };
    const sequence = ++this.checkSequence;
    try {
      const data = await this._api(`/api/identity/availability?username=${encodeURIComponent(validated.username)}`);
      if (sequence !== this.checkSequence) return null; // a newer keystroke superseded this check
      const result = data.availability || {};
      if (result.available) return { status: 'available', reason: null, message: `${validated.displayName} is available`, displayName: validated.displayName };
      if (result.reserved) return { status: 'reserved', reason: USERNAME_REASONS.RESERVED, message: result.message || 'This username is reserved by Veyra.', displayName: null };
      if (result.valid === false) return { status: 'invalid', reason: result.reason, message: result.message, displayName: null };
      return { status: 'taken', reason: 'USERNAME_TAKEN', message: result.message || 'That username is already taken.', displayName: validated.displayName };
    } catch (error) {
      if (sequence !== this.checkSequence) return null;
      return { status: 'error', reason: error.code || 'INTERNAL_ERROR', message: messageFor(error.code, error.message), displayName: validated.displayName };
    }
  }

  /** Permanently claim a username. Throws a friendly Error on failure. */
  async claim(raw) {
    const validated = validateUsername(raw);
    if (!validated.ok) throw new Error(validated.message);
    const data = await this._api('/api/identity/claim', { method: 'POST', body: JSON.stringify({ username: validated.username }) });
    this.identity = data.identity;
    this.loaded = true;
    this.error = null;
    return this._emit();
  }

  /** Resolve any `.veyra` identity to its public projection. Throws on failure. */
  async lookup(raw) {
    const validated = validateUsername(raw);
    if (!validated.ok) throw new Error(validated.message);
    const data = await this._api(`/api/identity/lookup?username=${encodeURIComponent(validated.username)}`);
    return data.identity;
  }

  /// Display helper: prefer the permanent identity, fall back to a wallet label.
  displayNameOr(fallback = null) {
    return this.identity?.displayName || fallback;
  }

  shouldPrompt() {
    if (this.identity?.hasUsername) return false;
    try { return sessionStorage.getItem(PROMPT_KEY) !== '1'; } catch { return true; }
  }

  markPrompted() {
    try { sessionStorage.setItem(PROMPT_KEY, '1'); } catch { /* session-only hint */ }
  }
}
