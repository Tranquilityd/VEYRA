// Veyra — golden-hour lighting overlay: warm tint, lamp glows, cached vignette
import { SpriteCache } from './SpriteCache.js';
import { makeCanvas } from '../core/util.js';

export class Lighting {
  constructor() {
    this.screen = null;
    this.sw = 0; this.sh = 0;
  }
  resize(vw, vh) {
    if (this.sw === vw && this.sh === vh) return;
    this.sw = vw; this.sh = vh;
    const c = makeCanvas(vw, vh);
    const ctx = c.getContext('2d');
    // low sun warmth from upper-left
    let g = ctx.createRadialGradient(vw * 0.18, -vh * 0.25, 40, vw * 0.18, -vh * 0.25, Math.max(vw, vh) * 0.95);
    g.addColorStop(0, 'rgba(255,178,92,0.20)');
    g.addColorStop(0.5, 'rgba(255,150,70,0.05)');
    g.addColorStop(1, 'rgba(255,150,70,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
    // vignette for depth
    g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.36, vw / 2, vh / 2, Math.max(vw, vh) * 0.78);
    g.addColorStop(0, 'rgba(10,8,24,0)');
    g.addColorStop(1, 'rgba(10,8,24,0.40)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
    this.screen = c;
  }
  // additive lamp glows, drawn in world space
  renderWorld(ctx, world, vr) {
    const glow = SpriteCache.lampGlow();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of world.lampGlows) {
      if (l.x < vr.x - 80 || l.x > vr.x + vr.w + 80 || l.y < vr.y - 80 || l.y > vr.y + vr.h + 80) continue;
      ctx.drawImage(glow, l.x - 62, l.y - 62, 124, 124);
    }
    ctx.restore();
  }
  // screen-space grade, drawn after world
  renderScreen(ctx, view) {
    ctx.fillStyle = 'rgba(255,148,60,0.05)';
    ctx.fillRect(0, 0, view.w, view.h);
    if (this.screen) ctx.drawImage(this.screen, 0, 0, view.w, view.h);
  }
}
