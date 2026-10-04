// Veyra — modern metal fence run (garden boundary), tiled baked segments
import { Entity } from '../world/Entity.js';
import { SpriteCache } from '../visuals/SpriteCache.js';

export class Fence extends Entity {
  constructor(def) {
    super(def.x, def.y);
    this.type = 'fence';
    this.def = def;
    this.h = def.dir === 'h';
    const seg = SpriteCache.prop(this.h ? 'fenceH' : 'fenceV', 0);
    this.seg = seg;
    this.len = def.len;
    // culling bounds for the whole run
    if (this.h) { this.bx = -4; this.by = -34; this.bw = def.len + 8; this.bh = 40; }
    else { this.bx = -8; this.by = -8; this.bw = 16; this.bh = def.len + 16; }
    this.depthY = def.y + (this.h ? 0 : def.len * 0.5);
  }
  render(ctx, time) {
    if (this.h) {
      for (let x = 0; x < this.len; x += 120) {
        ctx.drawImage(this.seg.canvas, this.x + x, this.y - this.seg.ay);
      }
    } else {
      for (let y = 0; y < this.len; y += 120) {
        ctx.drawImage(this.seg.canvas, this.x - this.seg.ax, this.y + y);
      }
    }
  }
}
