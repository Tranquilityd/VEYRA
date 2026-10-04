// Veyra — finite state machine (game states foundation)
// States are objects: { name, enter(params), exit(), update(dt, time), render(ctx, view, time) }
export class StateMachine {
  constructor(game) {
    this.game = game;
    this.states = new Map();
    this.current = null;
    this.currentName = '';
    this.history = [];
  }
  register(name, factory) { this.states.set(name, factory); }
  get(name) {
    if (!this.states.has(name)) return null;
    let s = this.states.get(name);
    if (typeof s === 'function') { s = s(this.game); this.states.set(name, s); }
    return s;
  }
  set(name, params = {}) {
    const next = this.get(name);
    if (!next) { console.warn('[StateMachine] unknown state', name); return; }
    if (this.current && this.current.exit) this.current.exit(name);
    this.history.push(name);
    this.current = next;
    this.currentName = name;
    if (next.enter) next.enter(params);
    this.game.events.emit('state:changed', { state: name });
  }
  update(dt, time) { if (this.current && this.current.update) this.current.update(dt, time); }
  render(ctx, view, time) { if (this.current && this.current.render) this.current.render(ctx, view, time); }
}
