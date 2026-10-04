// Veyra — Phase 5 transition director: choreographs building entry/exit.
// Entry: lock input → doors slide open → Lester walks in (kinematic) while the
// camera pushes toward the entrance → fade to black behind a venue name card →
// swap to the interior state → fade in. Exit mirrors it back to the plaza.
// Everything runs off a small step timeline so it is deterministic + testable.
import { clamp, lerp, damp } from '../core/util.js';
import { VENUES } from '../world/venues.js';

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class TransitionSystem {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.controls = false;      // while true, PlayState hands player+camera to us
    this.lock = false;          // while true, InputManager is muted
    this.fade = 0;              // 0..1 black overlay
    this.card = null;           // { title, sub, accent } shown at full black
    this.phase = '';
    this.venueId = '';
    this.steps = [];
    this.i = 0;
    this.t = 0;
    this._switched = false;
    this._path = null;
    this._seg = null;
    this._prev = null;
    this.baseZoom = 1;
  }

  // ---- step runner ----
  _run(steps) {
    this.steps = steps;
    this.i = -1;
    this.t = 0;
    this.active = true;
    this._switched = false;
    this._next();
  }
  _next() {
    this.i++;
    if (this.i >= this.steps.length) { this._finish(); return; }
    const s = this.steps[this.i];
    this.t = 0;
    this.phase = s.name;
    if (s.enter) s.enter(this);
  }
  _finish() {
    this.active = false;
    this.controls = false;
    this.lock = false;
    this.fade = 0;
    this.card = null;
    this.phase = 'done';
  }
  update(dt) {
    if (!this.active) return;
    const s = this.steps[this.i];
    this.t += dt;
    const k = clamp(this.t / Math.max(0.0001, s.dur), 0, 1);
    if (s.update) s.update(k, dt, this);
    if (this.t >= s.dur) {
      if (s.exit) s.exit(this);
      this._next();
    }
  }

  // ---- entry ----
  enterVenue(id) {
    if (this.active) return false;
    const ps = this.game.states.get('play');
    if (!ps || !ps.model || !ps.model.venues) return false;
    const venue = ps.model.venues.find((v) => v.venueId === id);
    if (!venue) return false;
    const cfg = venue.config;
    const p = ps.model.player;
    if (p.seated) p.stand();

    this.venueId = id;
    this.lock = true;
    this.controls = true;
    this.card = { title: cfg.name, sub: cfg.subtitle, accent: cfg.accent };
    this.baseZoom = ps.camera.zoom || 1;
    venue.targetOpen = 1;

    this._path = [{ x: p.x, y: p.y }, cfg.approach, cfg.threshold, cfg.final];
    this._seg = [];
    let total = 0;
    for (let i = 1; i < this._path.length; i++) {
      const d = Math.hypot(this._path[i].x - this._path[i - 1].x, this._path[i].y - this._path[i - 1].y);
      this._seg.push(d); total += d;
    }
    this._total = Math.max(1, total);
    this._prev = { x: p.x, y: p.y };

    this.game.audio.play('confirm');
    this._run([
      { name: 'approach', dur: 0.95, update: (k, dt) => {
        this._driveWalk(ps, dt, easeInOut(k) * 0.74);
        this._driveCam(ps, dt, cfg.door.x, cfg.frontY - 26, this.baseZoom * 1.14, 3.0);
      } },
      { name: 'threshold', dur: 0.6, update: (k, dt) => {
        this._driveWalk(ps, dt, 0.74 + easeInOut(k) * 0.26);
        this._driveCam(ps, dt, cfg.door.x, cfg.frontY - 70, this.baseZoom * 1.45, 2.4);
        this.fade = 0.3 * easeInOut(k);
      } },
      { name: 'fadeOut', dur: 0.42, update: (k) => { this.fade = 0.3 + 0.7 * easeInOut(k); } },
      { name: 'switch', dur: 0.05, enter: () => {
        if (this._switched) return;
        this._switched = true;
        this.controls = false;
        venue.targetOpen = 0;
        venue.doorOpen = 0;                     // reset behind the black screen
        this.game.states.set('interior', { venue: id });
      } },
      { name: 'card', dur: 0.75 },
      { name: 'fadeIn', dur: 0.6, update: (k) => { this.fade = 1 - easeInOut(k); }, exit: () => { this.lock = false; } },
    ]);
    return true;
  }

  // ---- exit ----
  exitVenue() {
    if (this.active) return false;
    const st = this.game.states.get('interior');
    const id = st ? st.venueId : this.venueId;
    const cfg = VENUES[id];
    if (!cfg) return false;
    this.venueId = id;
    this.lock = true;
    this.controls = false;
    this.card = null;
    this.game.audio.play('back');
    this._run([
      { name: 'fadeOut', dur: 0.4, update: (k) => { this.fade = easeInOut(k); } },
      { name: 'switch', dur: 0.05, enter: () => {
        if (this._switched) return;
        this._switched = true;
        this.game.states.set('play');
        const ps = this.game.states.get('play');
        if (ps && ps.model) {
          const p = ps.model.player;
          if (p.seated) p.stand();
          p.x = cfg.exitSpawn.x; p.y = cfg.exitSpawn.y;
          p.vx = 0; p.vy = 0; p.moving = false; p.facing = 'down'; p.depthY = p.y;
          const venue = (ps.model.venues || []).find((v) => v.venueId === id);
          if (venue) { venue.targetOpen = 0; venue.doorOpen = 0.9; }   // doors close in view
          ps.camera.snapTo(p.x, p.y - 26);
        }
      } },
      { name: 'fadeIn', dur: 0.6, update: (k) => { this.fade = 1 - easeInOut(k); }, exit: () => { this.lock = false; } },
    ]);
    return true;
  }

  // ---- kinematic walk-in along the entry path ----
  _posAt(s) {
    let d = clamp(s, 0, 1) * this._total;
    for (let i = 0; i < this._seg.length; i++) {
      if (d <= this._seg[i]) {
        const t = this._seg[i] > 0 ? d / this._seg[i] : 1;
        return { x: lerp(this._path[i].x, this._path[i + 1].x, t), y: lerp(this._path[i].y, this._path[i + 1].y, t) };
      }
      d -= this._seg[i];
    }
    return this._path[this._path.length - 1];
  }
  _driveWalk(ps, dt, s) {
    const p = ps.model.player;
    const pos = this._posAt(s);
    const vx = dt > 1e-4 ? (pos.x - this._prev.x) / dt : 0;
    const vy = dt > 1e-4 ? (pos.y - this._prev.y) / dt : 0;
    p.x = pos.x; p.y = pos.y; p.depthY = pos.y;
    p.vx = vx; p.vy = vy;
    p.facing = 'up';
    p.moving = Math.hypot(vx, vy) > 12;
    const mag = Math.min(1, Math.hypot(vx, vy) / 172);
    p.animator.update(dt, vx, vy, false, mag, null);
    this._prev = pos;
  }
  _driveCam(ps, dt, tx, ty, tz, rate) {
    const cam = ps.camera;
    const k = damp(rate, dt);
    cam.x = lerp(cam.x, tx, k);
    cam.y = lerp(cam.y, ty, k);
    cam.zoom = lerp(cam.zoom, tz, k);
  }

  // ---- full-screen overlay: fade + venue name card ----
  renderOverlay(ctx, view, time) {
    if (!this.active && this.fade <= 0) return;
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(4,3,10,${clamp(this.fade, 0, 1).toFixed(3)})`;
      ctx.fillRect(0, 0, view.w, view.h);
    }
    if (this.card && this.fade > 0.9) {
      const a = Math.min(1, (this.fade - 0.9) / 0.08);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cx = view.w / 2, cy = view.h / 2;
      ctx.fillStyle = this.card.accent;
      ctx.fillRect(cx - 74, cy - 44, 148, 2);
      ctx.fillRect(cx - 74, cy + 42, 148, 2);
      ctx.font = '700 28px Orbitron, system-ui, sans-serif';
      ctx.fillStyle = '#f4f7ff';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '5px';
      ctx.fillText(this.card.title, cx, cy - 12);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.font = '500 12.5px Exo 2, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(234,242,255,0.72)';
      ctx.fillText(this.card.sub, cx, cy + 16);
      for (let i = 0; i < 3; i++) {                                  // loading dots
        const da = 0.25 + 0.75 * Math.max(0, Math.sin((time || 0) * 5 - i * 0.9));
        ctx.fillStyle = `rgba(234,242,255,${da.toFixed(2)})`;
        ctx.beginPath(); ctx.arc(cx - 14 + i * 14, cy + 34, 2.4, 0, 7); ctx.fill();
      }
      ctx.restore();
    }
  }
}
