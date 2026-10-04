// Veyra — minimal pub/sub event bus (foundation for cross-system messaging)
export class EventBus {
  constructor() { this.handlers = new Map(); }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) { const s = this.handlers.get(event); if (s) s.delete(fn); }
  emit(event, payload) {
    const s = this.handlers.get(event);
    if (!s) return;
    for (const fn of [...s]) fn(payload);
  }
  clear() { this.handlers.clear(); }
}
