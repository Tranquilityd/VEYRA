// Veyra — camera: smooth follow, lookahead, world clamping, zoom-for-viewport
import { clamp, lerp, damp } from '../core/util.js';

export class Camera {
  constructor(world) {
    this.world = world;
    this.x = world.w / 2;
    this.y = world.h / 2;
    this.zoom = 1;
    this.lookX = 0;
    this.lookY = 0;
  }
  setZoomForView(vw, vh) {
    this.zoom = clamp(Math.min(vw / 1280, vh / 760), 0.72, 1.18);
  }
  snapTo(x, y) { this.x = x; this.y = y; }
  follow(tx, ty, dt, view) {
    const k = damp(5.5, dt);
    this.x = lerp(this.x, tx + this.lookX, k);
    this.y = lerp(this.y, ty + this.lookY, k);
    this.clampToWorld(view);
  }
  clampToWorld(view) {
    const vw = view.w / this.zoom, vh = view.h / this.zoom;
    this.x = vw >= this.world.w ? this.world.w / 2 : clamp(this.x, vw / 2, this.world.w - vw / 2);
    this.y = vh >= this.world.h ? this.world.h / 2 : clamp(this.y, vh / 2, this.world.h - vh / 2);
  }
  viewRect(view, pad = 80) {
    const vw = view.w / this.zoom, vh = view.h / this.zoom;
    return { x: this.x - vw / 2 - pad, y: this.y - vh / 2 - pad, w: vw + pad * 2, h: vh + pad * 2 };
  }
  worldToScreen(x, y, view) {
    return { x: (x - this.x) * this.zoom + view.w / 2, y: (y - this.y) * this.zoom + view.h / 2 };
  }
  apply(ctx, view) {
    ctx.translate(view.w / 2, view.h / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }
}
