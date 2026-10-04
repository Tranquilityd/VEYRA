// Veyra — Phase 4+: moving city traffic.
// Cars drive fixed lanes (avenue, north-south road, ring road), curve around
// the roundabout island, brake for pedestrians in their path, and wrap around
// at lane ends. Top-down vector cars matching the parked-car palette.
import { Entity } from '../world/Entity.js';
import { lerp, clamp } from '../core/util.js';

const COLORS = ['#c8473b', '#3f7fbf', '#e0e3e6', '#2c3e50', '#e2a13c', '#4da36b'];

export class Car extends Entity {
  constructor(cfg = {}) {
    super(0, 0);
    this.type = 'car';
    this.lane = cfg.lane;                 // { axis, base, dir, min, max, rb }
    this.pos = cfg.pos != null ? cfg.pos : this.lane.min + Math.random() * 200;
    this.cruise = cfg.speed || 120 + Math.random() * 45;
    this.speed = this.cruise;
    this.color = cfg.color || COLORS[(Math.random() * COLORS.length) | 0];
    this.bx = -30; this.by = -16; this.bw = 60; this.bh = 32;
    this.getPlayer = null;
    this.getCrowd = null;
    this._place();
  }

  setContext(getPlayer, getCrowd) { this.getPlayer = getPlayer; this.getCrowd = getCrowd; }

  // lane coordinate → world position with a smooth, monument-sized roundabout arc
  _lanePoint(pos) {
    const L=this.lane;let x=L.axis==='x'?pos:L.base,y=L.axis==='x'?L.base:pos;
    if(L.rb){
      const delta=pos-(L.axis==='x'?L.rb.cx:L.rb.cy);
      const radius=L.axis==='x'?(L.rb.side<0?(L.rb.upperR||L.rb.r):(L.rb.lowerR||L.rb.r)):(L.rb.sideR||L.rb.r);
      if(Math.abs(delta)<radius){
        const blend=clamp((radius-Math.abs(delta))/72,0,1);
        const arc=Math.sqrt(Math.max(0,radius*radius-delta*delta));
        if(L.axis==='x')y=lerp(L.base,L.rb.cy+L.rb.side*arc,blend);
        else x=lerp(L.base,L.rb.cx+L.rb.side*arc,blend);
      }
    }
    return{x,y};
  }
  _place() {
    const p=this._lanePoint(this.pos),q=this._lanePoint(this.pos+this.lane.dir*2);
    this.x=p.x;this.y=p.y;this.angle=Math.atan2(q.y-p.y,q.x-p.x);this.depthY=this.y;
  }

  _braking() {
    const L = this.lane;
    const check = (ox, oy) => {
      if (L.axis === 'x') {
        if (Math.abs(oy - this.y) > 16) return false;
        const ahead = (ox - this.x) * L.dir;
        return ahead > -6 && ahead < 80;
      }
      if (Math.abs(ox - this.x) > 16) return false;
      const ahead = (oy - this.y) * L.dir;
      return ahead > -6 && ahead < 80;
    };
    const pl = this.getPlayer && this.getPlayer();
    if (pl && check(pl.x, pl.y)) return true;
    const crowd = this.getCrowd && this.getCrowd();
    if (crowd) for (const n of crowd) if (check(n.x, n.y)) return true;
    return false;
  }

  update(dt, time, vr) {
    if (vr && !(this.x > vr.x - 340 && this.x < vr.x + vr.w + 340 && this.y > vr.y - 340 && this.y < vr.y + vr.h + 340)) {
      this.speed = this.cruise;
      return;                                   // frozen far off-screen (perf)
    }
    const target = this._braking() ? 0 : this.cruise;
    this.speed += clamp(target - this.speed, -260 * dt, 140 * dt);
    this.pos += this.lane.dir * this.speed * dt;
    if (this.pos > this.lane.max) this.pos = this.lane.min + Math.random() * 120;
    if (this.pos < this.lane.min) this.pos = this.lane.max - Math.random() * 120;
    this._place();
  }

  render(ctx, time) {
    const ang = this.angle ?? (this.lane.axis === 'x' ? (this.lane.dir > 0 ? 0 : Math.PI) : (this.lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2));
    ctx.save();
    ctx.translate(this.x, this.y);
    // shadow
    ctx.fillStyle = 'rgba(28,20,44,0.25)';
    ctx.beginPath(); ctx.ellipse(0, 3, 24, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(ang);
    // body (top-down)
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.roundRect(-23, -10.5, 46, 21, 7); ctx.fill();
    // hood / trunk shading
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath(); ctx.roundRect(8, -8.5, 13, 17, 4); ctx.fill();
    // cabin glass
    ctx.fillStyle = '#1d2732';
    ctx.beginPath(); ctx.roundRect(-12, -8.5, 20, 17, 4.5); ctx.fill();
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.roundRect(-6, -7.5, 8, 15, 3); ctx.fill();   // roof
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.roundRect(4, -7.5, 3, 15, 1.5); ctx.fill();  // windshield glint
    // mirrors
    ctx.fillStyle = this.color;
    ctx.fillRect(2, -12.4, 3, 2.4); ctx.fillRect(2, 10, 3, 2.4);
    // lights
    ctx.fillStyle = '#ffe9b0';
    ctx.fillRect(21, -8, 2.4, 4); ctx.fillRect(21, 4, 2.4, 4);
    ctx.fillStyle = '#ff5d5d';
    ctx.fillRect(-23.4, -8, 2.2, 4); ctx.fillRect(-23.4, 4, 2.2, 4);
    ctx.restore();
  }
}
