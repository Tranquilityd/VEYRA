// Veyra — Phase 4: residents of Veyra. Diverse appearances (NPCPainter),
// simple independent behaviours (walk / stand / sit / look / wait / talk),
// per-NPC timing personality so nobody moves in lockstep, conversation
// pairing via ConversationSystem, and an interaction hook that is ready for
// the future LitVM dialogue system (each NPC carries a unique dialogueId).
import { Entity } from '../world/Entity.js';
import { drawPerson } from '../visuals/NPCPainter.js';
import { drawTextBubble } from '../visuals/speechBubble.js';

const WALK_SPEED = 42;

export class NPC extends Entity {
  constructor(config = {}) {
    super(config.x || 0, config.y || 0);
    this.type = 'npc';
    this.config = config;
    this.name = config.name || 'Resident';
    this.dialogueId = config.dialogueId || ('npc-' + this.name);
    this.appearance = config.appearance;
    this.radius = 12;
    this.active = true;
    this.bx = -20; this.by = -56; this.bw = 40; this.bh = 60;

    // personality (seeded per NPC): timing & taste variation
    const p = config.personality || {};
    this.speedF = p.speedF || 1;
    this.sociable = p.sociable == null ? 0.5 : p.sociable;
    this.restless = p.restless == null ? 0.5 : p.restless;

    this.state = 'idle';
    this.t = 0.5 + Math.random() * 2;
    this.dest = null;
    this.face = Math.random() < 0.5 ? -1 : 1;
    this.phase = Math.random() * 6;
    this.breathSeed = Math.random() * 6;
    this.seated = null;
    this.conv = null;
    this.wave = 0;
    this.say = null;                 // { text, ttl, accent } — timed text bubble
    this._stuck = 0;
    this._px = this.x; this._py = this.y;
    this.world = null;
    this.benches = [];
    this.conversations = null;
    this.getPlayer = null;
  }

  setContext(world, benches, conversations, getPlayer) {
    this.world = world;
    this.benches = benches;
    this.conversations = conversations;
    this.getPlayer = getPlayer;
  }

  interact(player) {
    this.wave = 1.5;
    this.face = player.x >= this.x ? 1 : -1;
    if (this.state === 'walk') { this.state = 'idle'; this.t = 2.2; }
    return this.dialogueId;          // future: LitVM dialogue lookup
  }

  near(vr, pad) {
    return this.x > vr.x - pad && this.x < vr.x + vr.w + pad &&
           this.y > vr.y - pad && this.y < vr.y + vr.h + pad;
  }

  update(dt, time, vr) {
    if (!this.active) return;
    // performance: frozen (not simulated) while far off-screen
    if (vr && !this.near(vr, 320)) return;
    if (this.wave > 0) this.wave = Math.max(0, this.wave - dt);
    if (this.say) { this.say.age = (this.say.age || 0) + dt; if ((this.say.ttl -= dt) <= 0) this.say = null; }

    if (this.conv) {                              // talking: face partner, gesture
      const other = this.conv.other(this);
      if (other) this.face = other.x >= this.x ? 1 : -1;
      this.phase += dt * 3;
      if (!this.conv.live) { this.conv = null; this.state = 'idle'; this.t = 0.6 + Math.random() * 1.6; }
      return;
    }

    this.t -= dt;
    switch (this.state) {
      case 'walk': {
        if (!this.dest) { this.state = 'idle'; break; }
        if (!this._routeFinal && this.world?.planNavigationRoute) {
          const route = this.world.planNavigationRoute(this.x, this.y, this.dest, this.radius);
          if (route?.length) { this._routeFinal = this.dest; this._route = route.slice(1); this.dest = route[0]; this.t += 12; }
        }
        let dx = this.dest.x - this.x, dy = this.dest.y - this.y;
        let d = Math.hypot(dx, dy);
        if (d < 9 && this._route?.length) { this.dest = this._route.shift(); this._avoidSide = 0; break; }
        if (d < 9 && this._routeFinal) { this.dest = this._routeFinal; this._routeFinal = null; this._route = null; this._avoidSide = 0; break; }
        if (d < 9 || this.t <= 0) { this.state = 'idle'; this.t = 0.8 + Math.random() * 3.2 * (1.2 - this.restless); this.dest = null; this._routeFinal = null; this._route = null; this._avoidSide = 0; this._stuck = 0; break; }
        const sp = WALK_SPEED * this.speedF, step = sp * dt;
        const ux = dx / d, uy = dy / d, ox = this.x, oy = this.y;
        const nx = ox + ux * step, ny = oy + uy * step;
        if (this.world) {
          const sx = this.world.collide(nx, oy, this.radius); this.x = sx.x; this.y = sx.y;
          const sy = this.world.collide(this.x, ny, this.radius); this.x = sy.x; this.y = sy.y;
          const directMove = Math.hypot(this.x - ox, this.y - oy);
          if (directMove < step * 0.55) {
            // Follow the obstacle tangent immediately while preserving the real
            // destination. This prevents compound monument colliders from
            // repeatedly redirecting residents toward their shared centre.
            if (!this._avoidSide) this._avoidSide = ((this.name.length + (ox + oy | 0)) & 1) ? 1 : -1;
            const ax = -uy * this._avoidSide, ay = ux * this._avoidSide;
            const tx = this.world.collide(ox + ax * step, oy, this.radius);
            const ty = this.world.collide(tx.x, oy + ay * step, this.radius);
            this.x = ty.x; this.y = ty.y;
            this._stuck += dt;
            if (this._stuck > 1.1) { this._avoidSide *= -1; this._stuck = 0; }
          } else {
            this._stuck = 0;
            if (directMove > step * 0.9) this._avoidSide = 0;
          }
        } else { this.x = nx; this.y = ny; }
        this.depthY = this.y;
        if (Math.abs(dx) > Math.abs(dy)) this.face = dx > 0 ? 1 : -1;
        this.phase += dt * 8.4 * this.speedF;
        this._px = this.x; this._py = this.y;
        break;
      }
      case 'sit': {
        if (!this.seated) { this.state = 'idle'; break; }
        this.phase = 0;
        if (this.t <= 0) {                        // stand up
          this.seated.occupant = null;
          this.y = this.seated.y + 18; this.seated = null;
          this.depthY = this.y;
          this.state = 'idle'; this.t = 0.5 + Math.random();
        }
        break;
      }
      case 'look': {
        if (this.t <= 0) { this.state = 'idle'; this.t = 0.4 + Math.random() * 1.4; }
        else if (Math.random() < dt * 0.8) this.face *= -1;
        break;
      }
      default: {                                  // idle / wait
        if (this.t <= 0) this._decide();
        break;
      }
    }

    // chance to start a conversation while idle near someone
    if ((this.state === 'idle' || this.state === 'look') && this.conversations) {
      this.conversations.tryStart(this);
    }
  }

  _decide() {
    const r = Math.random();
    if (r < 0.52 + this.restless * 0.2) {
      const points = this.config.waypoints || [];
      let dest = null;
      if (points.length) {
        const start = (Math.random() * points.length) | 0;
        // Never select a destination inside a monument/prop collider. Previously
        // the near-centre Litecoin waypoint made walkers repeatedly steer into
        // the compound statue collision, which looked like magnetic pulling.
        for (let i = 0; i < points.length; i++) {
          const candidate = points[(start + i) % points.length];
          if (!this.world) { dest = candidate; break; }
          const free = this.world.collide(candidate.x, candidate.y, this.radius + 3);
          const navBlocked = this.world.isNavigationBlocked?.(candidate.x, candidate.y, this.radius + 3);
          if (!navBlocked && Math.hypot(free.x - candidate.x, free.y - candidate.y) < 0.25) { dest = candidate; break; }
        }
      }
      if (dest) { this.dest = dest; this.state = 'walk'; this.t = 14; return; }
    }
    if (r < 0.78) { this.state = 'look'; this.t = 1.2 + Math.random() * 2.2; return; }
    if (r < 0.9 && this.benches.length) {         // sit if a free bench is close
      let best = null, bd = 300;
      for (const b of this.benches) {
        if (b.occupant) continue;
        const d = Math.hypot(b.x - this.x, b.y - this.y);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) {
        best.occupant = this; this.seated = best;
        this.x = best.x; this.y = best.y + 2; this.depthY = this.y;
        this.state = 'sit'; this.t = 6 + Math.random() * 12;
        return;
      }
    }
    this.state = 'idle'; this.t = 1 + Math.random() * 3.4 * (1.3 - this.restless);
  }

  render(ctx, time) {
    if (!this.active || !this.appearance) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.face, 1);
    const talking = !!this.conv;
    drawPerson(ctx, this.appearance, {
      phase: this.phase,
      moving: this.state === 'walk',
      seated: !!this.seated,
      talk: talking || this.wave > 0,
      gesture: this.wave > 0 ? Math.min(1, this.wave) : 0,
      breath: time * 2 + this.breathSeed,
    });
    ctx.restore();
    // timed text bubble (LitVM knowledge, playful remarks…)
    if (this.say) drawTextBubble(ctx, this.x, this.y - 58, this.say.text, time, this.say.accent || '#e9c66b', this.say.age || 0);
    // subtle conversation bubble on the current speaker
    if (this.conv && this.conv.speaker === this) {
      const b = Math.sin(time * 6) * 0.8;
      ctx.save();
      ctx.translate(this.x + 10, this.y - 62 + b);
      ctx.fillStyle = 'rgba(12,18,28,0.82)';
      ctx.beginPath();
      ctx.roundRect(-9, -8, 20, 13, 6);
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(-4, 4); ctx.lineTo(2, 4); ctx.lineTo(-2, 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#eaf2ff';
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(time * 4 + i * 0.7));
        ctx.beginPath(); ctx.arc(-3 + i * 4, -1.5, 1.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }
}
