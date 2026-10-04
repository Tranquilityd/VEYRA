// Veyra — building entity: baked facade sprite, depth-sorted with everything else
import { Entity } from '../world/Entity.js';
import { SpriteCache } from '../visuals/SpriteCache.js';

export class Building extends Entity {
  constructor(def) {
    super(def.cx, def.frontY != null ? def.frontY : (def.y != null ? def.y : 700));
    this.type = 'building';
    this.def = def;
    this.rot = def.rot || 0;                 // slight yaw so facing buildings angle toward each other
    const s = SpriteCache.building(def);
    this.sprite = s;
    const pad = this.rot ? 90 : 0;
    this.bx = -s.ax - pad; this.by = -s.ay - pad; this.bw = s.canvas.width + pad * 2; this.bh = s.canvas.height + pad * 2;
  }
  render(ctx, time) {
    if (this.rot) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rot);
      ctx.drawImage(this.sprite.canvas, -this.sprite.ax, -this.sprite.ay);
      ctx.restore();
    } else {
      ctx.drawImage(this.sprite.canvas, this.x - this.sprite.ax, this.y - this.sprite.ay);
    }
  }
}
