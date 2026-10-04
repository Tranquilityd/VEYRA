// Veyra — safe localStorage wrapper (private-mode / quota tolerant)
const mem = new Map();
let ok = true;
try {
  const k = '__veyra_probe__';
  window.localStorage.setItem(k, '1');
  window.localStorage.removeItem(k);
} catch (e) { ok = false; }

export const Storage = {
  available: ok,
  get(key, fallback = null) {
    try {
      const raw = ok ? window.localStorage.getItem(key) : mem.get(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    const raw = JSON.stringify(value);
    try {
      if (ok) window.localStorage.setItem(key, raw);
      else mem.set(key, raw);
    } catch (e) { mem.set(key, raw); }
  },
  remove(key) {
    try { if (ok) window.localStorage.removeItem(key); else mem.delete(key); } catch (e) {}
  }
};
