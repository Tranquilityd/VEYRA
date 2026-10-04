// Veyra — individual games foundation (arcade/casino minigame registry)
// Phase 1 registers placeholder definitions only. Real minigames plug in later via
// registry.register({ id, name, zone, launch(game, ctx) {...} })
export class GameRegistry {
  constructor(events) {
    this.events = events;
    this.defs = new Map();
  }
  register(def) {
    if (!def || !def.id) return false;
    this.defs.set(def.id, { launch: null, ...def });
    return true;
  }
  list() { return [...this.defs.values()]; }
  get(id) { return this.defs.get(id) || null; }
  launch(id) {
    const def = this.get(id);
    if (!def) return { ok: false, message: 'Unknown game.' };
    if (typeof def.launch !== 'function') {
      this.events.emit('games:unavailable', { id });
      return { ok: false, message: `"${def.name}" opens in a later phase.` };
    }
    return def.launch() || { ok: true };
  }
}
