// Veyra — static world prop (tree, lamp, bench, car, ...) with baked sprite
import { Entity } from '../world/Entity.js';
import { SpriteCache } from '../visuals/SpriteCache.js';

export class Prop extends Entity {
  constructor(def) {
    super(def.x, def.y);
    this.type = def.t;
    this.def = def;
    const s = SpriteCache.prop(def.t, def.v || 0, !!def.flip);
    this.sprite = s;
    this.sway = def.t === 'tree' || def.t === 'palm';
    this.seed = (def.x * 0.37 + def.y * 0.11) % 6.28;
    this.bx = -s.ax - 4; this.by = -s.ay - 4; this.bw = s.canvas.width + 8; this.bh = s.canvas.height + 8;
  }
  render(ctx, time) {
    const s = this.sprite;
    if (this.sway) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(Math.sin(time * 0.85 + this.seed) * 0.016);
      ctx.drawImage(s.canvas, -s.ax, -s.ay);
      ctx.restore();
    } else {
      ctx.drawImage(s.canvas, this.x - s.ax, this.y - s.ay);
    }
  }
}
