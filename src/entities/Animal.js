// Veyra — Phase 4: garden animals with tiny, cheap behaviours.
// pigeon  — peck / stroll / short flights, flees when Lester gets close
// butterfly — flutters between flower beds, perches, startles away
// duck    — paddles loops in the waterfall pool, dips, turns
// squirrel — sits / nibbles, dashes between trees, bolts when approached
import { Entity } from '../world/Entity.js';
import { drawPigeon, drawButterfly, drawDuck, drawSquirrel } from '../visuals/AnimalPainter.js';

const TAU = Math.PI * 2;

export class Animal extends Entity {
  constructor(config = {}) {
    super(config.x || 0, config.y || 0);
    this.type = 'animal';
    this.species = config.species || 'pigeon';
    this.active = true;
    this.color = config.color || '#f2f0e6';
    this.head = config.head || '#2e6db5';
    this.home = config.home || { x: this.x, y: this.y };
    this.range = config.range || 160;
    this.pool = config.pool || null;                 // ducks: { cx, cy, rx, ry }
    this.state = 'idle';
    this.t = Math.random() * 2;
    this.phase = Math.random() * TAU;
    this.face = Math.random() < 0.5 ? -1 : 1;
    this.flying = false;
    this.dest = null;
    this.ang = Math.random() * TAU;                  // duck paddle angle
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.bx = -12; this.by = -14; this.bw = 24; this.bh = 20;
    this.world = null;
    this.getPlayer = null;
  }

  setContext(world, getPlayer) { this.world = world; this.getPlayer = getPlayer; }

  near(vr, pad) {
    return this.x > vr.x - pad && this.x < vr.x + vr.w + pad &&
           this.y > vr.y - pad && this.y < vr.y + vr.h + pad;
  }

  update(dt, time, vr) {
    if (!this.active) return;
    if (vr && !this.near(vr, 240)) return;           // freeze far animals (perf)
    this.t -= dt;
    const pl = this.getPlayer && this.getPlayer();
    const pd = pl ? Math.hypot(pl.x - this.x, pl.y - this.y) : 1e9;

    switch (this.species) {
      case 'pigeon': this._pigeon(dt, pd); break;
      case 'butterfly': this._butterfly(dt, pd); break;
      case 'duck': this._duck(dt); break;
      case 'squirrel': this._squirrel(dt, pd); break;
    }
    this.depthY = this.y;
  }

  _wanderPoint(minD, maxD) {
    const a = Math.random() * TAU;
    const d = minD + Math.random() * (maxD - minD);
    let x = this.home.x + Math.cos(a) * d;
    let y = this.home.y + Math.sin(a) * d * 0.6;
    if (this.world) {
      const r = this.world.collide(x, y, 6);
      x = r.x; y = r.y;
    }
    return { x, y };
  }

  _pigeon(dt, pd) {
    if (this.flying) {
      this.phase += dt * 22;
      if (!this.dest) { this.flying = false; this.state = 'peck'; this.t = 1 + Math.random() * 2; return; }
      const dx = this.dest.x - this.x, dy = this.dest.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 10 || this.t <= 0) { this.flying = false; this.dest = null; this.state = 'peck'; this.t = 1 + Math.random() * 2.4; }
      else {
        this.x += (dx / d) * 150 * dt; this.y += (dy / d) * 150 * dt;
        this.face = dx > 0 ? 1 : -1;
      }
      return;
    }
    if (pd < 70) {                                   // startle: fly away from player
      this.flying = true; this.t = 1.4;
      const a = Math.atan2(this.y - (this.getPlayer().y), this.x - (this.getPlayer().x));
      this.dest = this._wanderPoint(90, 170);
      this.dest.x = this.x + Math.cos(a) * 130;
      this.dest.y = this.y + Math.sin(a) * 80;
      return;
    }
    if (this.state === 'peck') { this.phase += dt * 5; if (this.t <= 0) { this.state = 'walk'; this.t = 1 + Math.random() * 2; this.dest = this._wanderPoint(20, 70); } }
    else {
      this.phase += dt * 9;
      if (!this.dest) this.dest = this._wanderPoint(20, 70);
      const dx = this.dest.x - this.x, dy = this.dest.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 5 || this.t <= 0) { this.state = 'peck'; this.t = 0.8 + Math.random() * 2.2; }
      else { this.x += (dx / d) * 26 * dt; this.y += (dy / d) * 26 * dt; this.face = dx > 0 ? 1 : -1; }
    }
  }

  _butterfly(dt, pd) {
    this.phase += dt * (this.state === 'perch' ? 2.2 : 9);
    if (this.state === 'perch') {
      if (pd < 34) { this.state = 'flutter'; this.t = 1.6; this.dest = this._wanderPoint(50, 110); }
      else if (this.t <= 0) { this.state = 'flutter'; this.t = 3 + Math.random() * 3; this.dest = this._wanderPoint(60, 140); }
      return;
    }
    if (!this.dest || this.t <= 0) { this.state = 'perch'; this.t = 1.5 + Math.random() * 3; return; }
    const dx = this.dest.x - this.x, dy = this.dest.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 8) { this.state = 'perch'; this.t = 1.5 + Math.random() * 3; return; }
    const sp = 34;
    this.x += (dx / d) * sp * dt + Math.sin(this.phase * 0.9) * dt * 26;
    this.y += (dy / d) * sp * dt + Math.cos(this.phase * 0.7) * dt * 18;
    this.face = dx > 0 ? 1 : -1;
  }

  _duck(dt) {
    const P = this.pool;
    if (!P) return;
    if (this.state === 'dip') { this.phase += dt * 4; if (this.t <= 0) { this.state = 'swim'; this.t = 3 + Math.random() * 5; } }
    else {
      this.phase += dt * 3;
      if (this.t <= 0) {
        if (Math.random() < 0.4) { this.state = 'dip'; this.t = 1.2 + Math.random(); }
        else { this.dir *= -1; this.t = 4 + Math.random() * 6; }
      }
      this.ang += dt * 0.22 * this.dir;
    }
    this.x = P.cx + Math.cos(this.ang) * P.rx;
    this.y = P.cy + Math.sin(this.ang) * P.ry;
    this.face = this.dir > 0 ? 1 : -1;
  }

  _squirrel(dt, pd) {
    if (this.state === 'dash') {
      this.phase += dt * 20;
      const dx = this.dest.x - this.x, dy = this.dest.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 7 || this.t <= 0) { this.state = 'sit'; this.t = 1.5 + Math.random() * 3; }
      else { this.x += (dx / d) * 120 * dt; this.y += (dy / d) * 120 * dt; this.face = dx > 0 ? 1 : -1; }
      return;
    }
    this.phase += dt * 2.4;
    if (pd < 55) { this.state = 'dash'; this.t = 1.2; this.dest = this._wanderPoint(100, 190); return; }
    if (this.t <= 0) { this.state = 'dash'; this.t = 1.4; this.dest = this._wanderPoint(40, 130); }
  }

  render(ctx, time) {
    if (!this.active) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    const s = { phase: this.phase, state: this.state, face: this.face, flying: this.flying, color: this.color, head: this.head };
    if (this.species === 'butterfly') ctx.translate(0, -10 + Math.sin(this.phase * 0.8) * 3);
    switch (this.species) {
      case 'pigeon': drawPigeon(ctx, s); break;
      case 'butterfly': drawButterfly(ctx, s); break;
      case 'duck': drawDuck(ctx, s); break;
      case 'squirrel': drawSquirrel(ctx, s); break;
    }
    ctx.restore();
  }
}
