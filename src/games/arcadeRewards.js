// Phase 10 — arcade reward client. The backend/database is authoritative.
// This module holds only an in-memory rendering cache; localStorage is never a balance source.
export const WAVE_TOKEN_RATE = 0.00001;
export const REWARD_NOTE = 'Server-validated zkLTC testnet arcade balance. Reported runs do not change the balance until backend validation succeeds.';
export const tokensForWaves = (waves) => Math.round(Math.max(0, waves) * WAVE_TOKEN_RATE * 1e5) / 1e5;
export const fmtTokens = (t) => Number(t || 0).toFixed(5);
export const GAME_SHORT = { memrush: 'Memory Rush', tileshift: 'Tile Shift', neonescape: 'Neon Escape', nback: 'N-Back' };
export const sessionLine = (s) => s.w > 0 ? (GAME_SHORT[s.g] || s.g) + ' · ' + s.w + (s.w === 1 ? ' wave' : ' waves') + ' · ' + (s.status || 'pending validation') : (GAME_SHORT[s.g] || s.g) + ' · ' + (s.status || 'server credited');

const TOKEN_KEY = 'veyra:api-session'; // authentication cache only; never contains balances
let cache = { tokens: 0, waves: 0, sessions: [], loaded: false };
let runPending = 0;                    // visual run estimate only; excluded from authoritative balance
const active = new Map(); // server session state only; never an authority for reward credit
const emitZk = () => window.dispatchEvent(new Event('veyra:zkltc'));
const token = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token() || ''}` });

export function setBackendSessionToken(value) {
  try { value ? sessionStorage.setItem(TOKEN_KEY, value) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ephemeral auth only */ }
  refreshLedger();
}
export const setRunPending = (v) => { runPending = Math.round(Math.max(0, v || 0) * 1e5) / 1e5; emitZk(); };
export const zkDisplay = () => cache.tokens; // never add client-computed pending value to a balance
export const loadLedger = () => ({ ...cache, sessions: cache.sessions.slice() });
export const saveLedger = () => false;       // retained compatibility: client writes are deliberately disabled
export const firstEarned = () => cache.tokens > 0;
export const markFirstEarned = () => false;

export async function refreshLedger() {
  if (!token()) { cache = { tokens: 0, waves: 0, sessions: [], loaded: true }; emitZk(); return cache; }
  try {
    const r = await fetch('/api/balance', { headers: headers(), cache: 'no-store' });
    if (!r.ok) throw new Error('balance unavailable');
    const d = await r.json();
    cache = {
      tokens: Number(d.balance.balance),
      waves: d.rewardHistory.reduce((n, x) => n + Number(x.reason === 'arcade_session'), 0),
      sessions: d.rewardHistory.map((x) => ({ g: x.reason === 'referral' ? 'Referral Reward' : 'Arcade Reward', w: 0, tk: Number(x.amount), t: Date.parse(x.created_at), status: 'server credited +' + fmtTokens(Number(x.amount)) + ' zkLTC' })),
      loaded: true,
    };
    emitZk(); return cache;
  } catch { return cache; }
}

const clientId = () => `${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(2)).join('_')}`;
export async function beginSession(gameId) {
  if (!token()) { active.delete(gameId); return null; }
  const pending = (async () => {
    const r = await fetch('/api/arcade/session', { method: 'POST', headers: headers(), body: JSON.stringify({ action: 'start', game: gameId, clientSessionId: clientId() }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    return { id: d.session.id, rewardEnabled: d.rewardEnabled === true, completed: Number(d.session.waves || 0) };
  })();
  active.set(gameId, pending);
  try { const state = await pending; if (active.get(gameId) === pending) active.set(gameId, state); return state; }
  catch { if (active.get(gameId) === pending) active.delete(gameId); return null; }
}

const activeState = async gameId => {
  const value = active.get(gameId);
  return value && typeof value.then === 'function' ? await value : value;
};
export async function requestArcadeRound(gameId) {
  const state = await activeState(gameId);
  if (!state?.rewardEnabled || !token()) return null;
  const r = await fetch('/api/arcade/session', { method: 'POST', headers: headers(), body: JSON.stringify({ action: 'round', sessionId: state.id }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error);
  return d.round;
}
export async function submitArcadeRound(gameId, roundToken, events) {
  const state = await activeState(gameId);
  if (!state?.rewardEnabled || !token()) return false;
  const r = await fetch('/api/arcade/session', { method: 'POST', headers: headers(), body: JSON.stringify({ action: 'completeRound', sessionId: state.id, roundToken, events }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error);
  state.completed = Number(d.completedWave);
  return true;
}

// Finalization sends no score, waves, or reward. The backend derives all three
// from consumed server-issued rounds and credits at most once inside one DB transaction.
export function recordSession(gameId) {
  const value = active.get(gameId); active.delete(gameId); runPending = 0; emitZk();
  Promise.resolve(value).then(async state => {
    if (!state?.id || !token()) return;
    const r = await fetch('/api/arcade/session', { method: 'POST', headers: headers(), body: JSON.stringify({ action: 'finish', sessionId: state.id }) });
    if (!r.ok) throw new Error('arcade finalization failed');
    await refreshLedger();
  }).catch(() => {});
  const completed = value && typeof value.then !== 'function' ? Number(value.completed || 0) : 0;
  const enabled = value && typeof value.then !== 'function' ? value.rewardEnabled : false;
  return { tokens: enabled ? tokensForWaves(completed) : 0, totalTokens: cache.tokens, totalWaves: cache.waves,
    status: value ? (enabled ? 'pending server finalization' : 'non-reward game') : 'sign in required' };
}

refreshLedger();
