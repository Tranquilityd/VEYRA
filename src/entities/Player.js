// Veyra — Lester: the player character (Phase 3).
// Movement: velocity + accel/decel from movementConfig, screen-space directions
// (LEFT = screen left, etc.), collision via world.collide, smooth camera target.
// Visuals: the provided Lester artwork, animated by LesterAnimator + LesterRig.
import { Entity } from '../world/Entity.js';
import { MOVE, LESTER } from '../core/movementConfig.js';
import { LesterAnimator } from './LesterAnimator.js';
import { renderLester, lesterReady } from './LesterRig.js';
import { clamp } from '../core/util.js';

export class Player extends Entity {
  constructor(x, y) {
    super(x, y);
    this.type = 'player';
    this.radius = LESTER.radius;
    this.walkSpeed = MOVE.walkSpeed;
    this.runSpeed = MOVE.runSpeed;
    this.vx = 0; this.vy = 0;
    this.facing = 'down';
    this.moving = false;
    this.seated = null;          // bench entity when sitting
    this.animator = new LesterAnimator();
    this.bx = -22; this.by = -73; this.bw = 44; this.bh = 77;
  }

  sit(bench) {
    this.seated = bench;
    this.x = bench.x;
    this.y = bench.y + 2;
    this.depthY = this.y;
    this.facing = 'down';
    this.moving = false;
    this.vx = 0; this.vy = 0;
  }
  stand() {
    if (!this.seated) return;
    this.y = this.seated.y + 20;
    this.seated = null;
    this.depthY = this.y;
  }

  update(dt, time, input, world) {
    const ax = input.axis;
    const mag = Math.hypot(ax.x, ax.y);
    const intent = mag > MOVE.moveDeadzone && !this.seated;

    // target velocity from screen-space axis (joystick magnitude scales speed)
    // run = Shift / RUN button, or a near-full joystick push (touch only)
    const sprint = input.sprint || (input.stickActive && mag >= MOVE.joystickRunThreshold);
    const base = sprint ? this.runSpeed : this.walkSpeed;
    const tvx = intent ? (ax.x / Math.max(1, mag)) * base * clamp(mag, 0, 1) : 0;
    const tvy = intent ? (ax.y / Math.max(1, mag)) * base * clamp(mag, 0, 1) : 0;

    // natural acceleration / deceleration ramp per axis
    const ramp = (v, tv) => {
      const rate = (Math.abs(tv) > Math.abs(v) ? MOVE.accel : MOVE.decel) * dt;
      const d = tv - v;
      return v + clamp(d, -rate, rate);
    };
    this.vx = ramp(this.vx, tvx);
    this.vy = ramp(this.vy, tvy);
    if (this.seated) { this.vx = 0; this.vy = 0; }

    // integrate with collision; kill the blocked axis so Lester never pushes through
    if (this.vx || this.vy) {
      const nx = this.x + this.vx * dt;
      const ny = this.y + this.vy * dt;
      const r1 = world.collide(nx, this.y, this.radius);
      if (Math.abs(r1.x - nx) > 0.001) this.vx = 0;
      this.x = r1.x;
      const r2 = world.collide(this.x, ny, this.radius);
      if (Math.abs(r2.y - ny) > 0.001) this.vy = 0;
      this.y = r2.y;
      this.depthY = this.y;
    }

    this.moving = Math.hypot(this.vx, this.vy) > MOVE.stopSpeed && !this.seated;
    if (this.moving) {
      if (Math.abs(this.vx) > Math.abs(this.vy)) this.facing = this.vx > 0 ? 'right' : 'left';
      else this.facing = this.vy > 0 ? 'down' : 'up';
    }

    this.animator.update(dt, this.vx, this.vy, sprint, mag, this.seated);
  }

  render(ctx, time) {
    const ready = lesterReady();
    if (!ready) return;
    const visibility=this.entryVisibility==null?1:clamp(this.entryVisibility,0,1),offset=this.entryYOffset||0;
    if(visibility<=0)return;
    ctx.save();ctx.globalAlpha*=visibility;
    if(this.entryGlow){ctx.shadowColor='rgba(255,232,0,.72)';ctx.shadowBlur=12*this.entryGlow;}
    renderLester(ctx, this.x, this.y+offset, this.animator.pose());
    ctx.restore();
  }
}
