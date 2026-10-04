// Veyra — waterfall landmark: baked rock face + stateless animated cascades,
// foam, ripples and drifting mist (no per-frame allocation).
import { Entity } from '../world/Entity.js';
import { SpriteCache } from '../visuals/SpriteCache.js';
import { makeCanvas, mulberry32, TAU } from '../core/util.js';
import { POOL } from '../world/cityMap.js';

const W = 1200, H = 210;
const FALLS = [
  { x: 600, w: 150, top: 8 },
  { x: 370, w: 62,  top: 40 },
  { x: 830, w: 62,  top: 40 },
];

function paintWaterfall() {
  const c = makeCanvas(W, H + 40);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(9001);
  // rock face
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#8a857c'); g.addColorStop(0.5, '#74706a'); g.addColorStop(1, '#57544d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 18, W, H - 18);
  // rock blocks
  for (let i = 0; i < 46; i++) {
    const x = rnd() * W, y = 24 + rnd() * (H - 40), w = 40 + rnd() * 90, h = 16 + rnd() * 26;
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,248,225,0.10)' : 'rgba(20,18,14,0.16)';
    ctx.beginPath();
    ctx.moveTo(x, y + h); ctx.lineTo(x + w * 0.15, y); ctx.lineTo(x + w, y + h * 0.2); ctx.lineTo(x + w * 0.85, y + h);
    ctx.closePath(); ctx.fill();
  }
  // horizontal strata + sun rim on top
  ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.lineWidth = 2;
  for (let y = 40; y < H; y += 26) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + 6); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,200,120,0.20)';
  ctx.fillRect(0, 18, W, 10);
  // wet dark streaks under the falls
  for (const f of FALLS) {
    const wg = ctx.createLinearGradient(0, f.top, 0, H);
    wg.addColorStop(0, 'rgba(24,32,36,0.55)'); wg.addColorStop(1, 'rgba(24,32,36,0.15)');
    ctx.fillStyle = wg;
    ctx.fillRect(f.x - f.w / 2 - 8, f.top, f.w + 16, H - f.top);
  }
  // moss patches
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = `rgba(96,148,66,${0.25 + rnd() * 0.25})`;
    ctx.beginPath();
    ctx.ellipse(rnd() * W, 30 + rnd() * (H - 50), 12 + rnd() * 22, 6 + rnd() * 8, 0, 0, TAU);
    ctx.fill();
  }
  // crest rim + foliage fringe
  ctx.fillStyle = '#54514a';
  ctx.fillRect(0, 12, W, 10);
  ctx.fillStyle = PAL_LEAF_DARK;
  for (let x = 0; x < W; x += 26) {
    ctx.beginPath(); ctx.arc(x + rnd() * 14, 12 + rnd() * 6, 10 + rnd() * 8, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = PAL_LEAF_MID;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.arc(x + rnd() * 20, 8 + rnd() * 6, 6 + rnd() * 5, 0, TAU); ctx.fill();
  }
  // side ferns
  for (const sx of [30, W - 30]) {
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i - 2.5) * 0.4;
      ctx.strokeStyle = i % 2 ? '#4a8a3c' : '#3e7a33';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(sx, H - 6);
      ctx.quadraticCurveTo(sx + Math.cos(a) * 26, H - 40 + Math.sin(a) * 16, sx + Math.cos(a) * 44, H - 26 + Math.sin(a) * 26);
      ctx.stroke();
    }
  }
  return { canvas: c, ax: W / 2, ay: H };
}
const PAL_LEAF_DARK = '#3e7a33';
const PAL_LEAF_MID = '#58a141';

export class Waterfall extends Entity {
  constructor(x, y) {
    super(x, y);
    this.type = 'waterfall';
    this.sprite = SpriteCache.getOrMake('waterfall-hill', paintWaterfall);
    this.bx = -W / 2 - 10; this.by = -H - 30; this.bw = W + 20; this.bh = H + 40;
  }
  render(ctx, time) {
    const x0 = this.x - W / 2;
    const y0 = this.y - H;                       // crest line in world
    ctx.drawImage(this.sprite.canvas, x0, this.y - this.sprite.ay);
    const poolY = this.y - 4;   // cascades meet the water at the hill base
    ctx.save();
    // cascade sheets
    for (const f of FALLS) {
      const fx = x0 + f.x, top = y0 + f.top;
      // soft outer spray
      ctx.fillStyle = 'rgba(215,242,250,0.16)';
      ctx.fillRect(fx - f.w / 2 - 5, top, f.w + 10, poolY - top);
      const grad = ctx.createLinearGradient(0, top, 0, poolY);
      grad.addColorStop(0, 'rgba(235,250,255,0.80)');
      grad.addColorStop(0.55, 'rgba(205,238,248,0.52)');
      grad.addColorStop(1, 'rgba(205,238,248,0.22)');
      ctx.fillStyle = grad;
      ctx.fillRect(fx - f.w / 2, top, f.w, poolY - top);
      // bright core + side shadows (reads as falling sheet, not a column)
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(fx - f.w * 0.14, top, f.w * 0.28, poolY - top);
      ctx.fillStyle = 'rgba(90,130,140,0.30)';
      ctx.fillRect(fx - f.w / 2, top, f.w * 0.14, poolY - top);
      ctx.fillRect(fx + f.w / 2 - f.w * 0.14, top, f.w * 0.14, poolY - top);
      // crest lip line where water tips over the rock
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(fx - f.w / 2, top - 2, f.w, 3.5);
      ctx.fillStyle = 'rgba(110,150,160,0.5)';
      ctx.fillRect(fx - f.w / 2, top - 5, f.w, 2.5);
      // moving streaks (stateless)
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      const span = poolY - top;
      for (let i = 0; i < 10; i++) {
        const sy = top + ((time * 300 + i * 53 + f.x) % span);
        const sx = fx - f.w / 2 + ((i * 37 + f.x) % f.w);
        ctx.fillRect(sx, sy, 2.4, 12 + (i % 3) * 6);
      }
      // foam at base
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.ellipse(fx, poolY, f.w * 0.62, 7 + Math.sin(time * 6 + f.x) * 1.5, 0, 0, TAU);
      ctx.fill();
      // splash ripples
      for (let i = 0; i < 2; i++) {
        const r = ((time * 40 + i * 30 + f.x) % 60);
        ctx.strokeStyle = `rgba(255,255,255,${(0.35 * (1 - r / 60)).toFixed(3)})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(fx, poolY + 4, r + f.w * 0.4, (r + f.w * 0.4) * 0.28, 0, 0, TAU);
        ctx.stroke();
      }
    }
    // drifting mist (additive)
    const mist = SpriteCache.glow('mist', 240, [[0, 'rgba(235,248,255,0.20)'], [1, 'rgba(235,248,255,0)']]);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const mx = this.x - 260 + i * 260 + Math.sin(time * 0.5 + i * 2.1) * 40;
      const my = poolY - 26 + Math.sin(time * 0.8 + i) * 8;
      ctx.globalAlpha = 0.5 + Math.sin(time * 1.3 + i * 1.4) * 0.2;
      ctx.drawImage(mist, mx - 120, my - 120);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
