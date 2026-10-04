// Veyra — entity base class (position, depth for painter's sort, culling bounds)
import { rectsIntersect } from '../core/util.js';

export class Entity {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.depthY = y;             // painter's algorithm key
    this.removed = false;
    // culling bounds relative to (x, y)
    this.bx = -40; this.by = -120; this.bw = 80; this.bh = 140;
  }
  get depth() { return this.depthY; }
  bounds() { return { x: this.x + this.bx, y: this.y + this.by, w: this.bw, h: this.bh }; }
  visible(vr) { return rectsIntersect(this.bounds(), vr); }
  update(dt, time) {}
  render(ctx, time) {}
}
