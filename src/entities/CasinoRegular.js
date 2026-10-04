// Veyra — Phase 6: the recurring casino player. A resident with a routine:
// pick a free machine → walk over → play (25–60 s, never more than a minute) →
// stop, step away, breathe → pick another machine later. While seated the
// machine is occupied: Lester cannot start it and gets a playful bubble.
import { NPC } from './NPC.js';

export class CasinoRegular extends NPC {
  constructor(config = {}) {
    super(config);
    this.machines = config.machines || [];
    this.machine = null;          // machine currently occupied
    this.pending = null;          // machine being walked to
    this.sessionLeft = 0;
    this.sessions = 0;
  }

  get playing() { return !!this.machine; }

  update(dt, time, vr) {
    if (this.machine) {
      if (!this.active) return;
      if (vr && !this.near(vr, 320)) return;           // perf: freeze off-screen
      if (this.say && (this.say.ttl -= dt) <= 0) this.say = null;
      if (this.wave > 0) this.wave = Math.max(0, this.wave - dt);
      // seated at the machine: small play fidget, face the cabinet
      this.phase += dt * 2.6;
      this.face = this.machine.x >= this.x ? 1 : -1;
      this.sessionLeft -= dt;
      if (this.sessionLeft <= 0) this._leaveMachine();
      return;
    }
    super.update(dt, time, vr);
  }

  _decide() {
    if (this.pending) {                                 // arrived at the cabinet
      const m = this.pending;
      this.pending = null;
      this._occupy(m);
      return;
    }
    if (Math.random() < 0.62) {                         // look for a free seat
      const free = this.machines.filter((m) => !m.occupiedBy);
      if (free.length) {
        this.pending = free[(Math.random() * free.length) | 0];
        this.dest = { x: this.pending.front.x, y: this.pending.front.y };
        this.state = 'walk';
        this.t = 16;
        return;
      }
    }
    super._decide();                                    // otherwise: stroll/look/chat
  }

  _occupy(m) {
    if (m.occupiedBy) return;                           // seat got taken meanwhile
    m.occupiedBy = this;
    this.machine = m;
    this.sessions++;
    this.sessionLeft = 25 + Math.random() * 35;         // 25–60 s — max one minute
    this.x = m.front.x; this.y = m.front.y; this.depthY = this.y;
    this.face = m.x >= this.x ? 1 : -1;
    this.state = 'idle';
    this.t = 999;                                       // routine owns the timer
    this.dest = null;
  }

  _leaveMachine() {
    const m = this.machine;
    if (m && m.occupiedBy === this) m.occupiedBy = null;   // seat frees up
    this.machine = null;
    this.sessionLeft = 0;
    // step aside so the freed seat reads clearly, then breathe before next pick
    this.state = 'walk';
    this.dest = { x: this.x + (this.x < 800 ? 30 : -30), y: this.y + 40 };
    this.t = 7;
    this._afterStroll = 8 + Math.random() * 14;
  }
}
