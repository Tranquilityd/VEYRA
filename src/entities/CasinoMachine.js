// Veyra — Phase 6: a physical casino machine. Baked maroon-and-gold cabinet in
// the existing interior's visual language, per-game screen motif, live screen
// glow + marquee bulbs, and an occupation slot for the recurring player.
// kind: 'plinko' | 'slot' | 'dice' | 'coin'  → opens exactly that game.
import { Entity } from '../world/Entity.js';
import { makeCanvas, roundRectPath } from '../core/util.js';
import { CASINO_GAMES } from '../games/casinoLogic.js';

const memo = new Map();

function bake(kind) {
  const hit = memo.get(kind);
  if (hit) return hit;
  const W = 76, H = 96;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const GOLD = '#d9a441', GOLD_L = '#f0cd82';
  // shadow
  ctx.fillStyle = 'rgba(8,4,10,0.4)';
  ctx.beginPath(); ctx.ellipse(W / 2, H - 8, 30, 9, 0, 0, 7); ctx.fill();
  // cabinet body
  let g = ctx.createLinearGradient(0, 6, 0, H - 8);
  g.addColorStop(0, '#6b2130'); g.addColorStop(0.5, '#57192a'); g.addColorStop(1, '#3f121e');
  ctx.fillStyle = g;
  roundRectPath(ctx, 8, 6, W - 16, H - 16, 7); ctx.fill();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 2.4;
  roundRectPath(ctx, 9, 7, W - 18, H - 18, 6); ctx.stroke();
  // top marquee
  ctx.fillStyle = '#2a0d14';
  roundRectPath(ctx, 12, 2, W - 24, 14, 4); ctx.fill();
  ctx.strokeStyle = GOLD_L; ctx.lineWidth = 1.4;
  roundRectPath(ctx, 12, 2, W - 24, 14, 4); ctx.stroke();
  ctx.fillStyle = '#ffe9b8';
  ctx.font = '900 7px Rajdhani, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(CASINO_GAMES[kind].title.length > 12 ? CASINO_GAMES[kind].short.toUpperCase() : CASINO_GAMES[kind].title, W / 2, 9.5);
  // screen bezel
  ctx.fillStyle = '#160a10';
  roundRectPath(ctx, 14, 20, W - 28, 40, 4); ctx.fill();
  // motif
  ctx.save();
  ctx.beginPath(); ctx.rect(16, 22, W - 32, 36); ctx.clip();
  if (kind === 'plinko') {
    ctx.fillStyle = 'rgba(255,214,140,0.85)';
    for (let r = 0; r < 4; r++) for (let i = 0; i <= r + 2; i++) {
      ctx.beginPath(); ctx.arc(W / 2 + (i - (r + 2) / 2) * 8, 27 + r * 7, 1.5, 0, 7); ctx.fill();
    }
    ctx.fillStyle = GOLD;
    for (let i = 0; i < 7; i++) ctx.fillRect(17 + i * 6, 52, 4, 5);
  } else if (kind === 'slot') {
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#f5f2ea'; ctx.fillRect(19 + i * 15, 26, 12, 20);
      ctx.fillStyle = '#c8473b'; ctx.font = '900 11px Rajdhani, system-ui, sans-serif';
      ctx.fillText(['7', '★', ''][i], 25 + i * 15, 36);
    }
    ctx.fillStyle = GOLD; ctx.fillRect(18, 49, W - 36, 3);
  } else if (kind === 'dice') {
    for (const [dx, dy] of [[26, 34], [46, 40]]) {
      ctx.fillStyle = '#f5f2ea'; roundRectPath(ctx, dx - 8, dy - 8, 16, 16, 3); ctx.fill();
      ctx.fillStyle = '#2a0d14';
      for (const [px, py] of [[-4, -4], [4, 4], [0, 0]]) { ctx.beginPath(); ctx.arc(dx + px, dy + py, 1.7, 0, 7); ctx.fill(); }
    }
  } else {
    ctx.fillStyle = GOLD_L;
    ctx.beginPath(); ctx.arc(W / 2, 38, 12, 0, 7); ctx.fill();
    ctx.strokeStyle = '#8a6420'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, 38, 12, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2, 26); ctx.lineTo(W / 2, 50); ctx.stroke();
    ctx.fillStyle = '#6b4a10'; ctx.font = '900 8px Rajdhani, system-ui, sans-serif';
    ctx.fillText('H', W / 2 - 6, 38); ctx.fillText('T', W / 2 + 6, 38);
  }
  ctx.restore();
  // glass sheen over the screen (polished glass reads as glass)
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath(); ctx.moveTo(16, 22); ctx.lineTo(34, 22); ctx.lineTo(16, 46); ctx.closePath(); ctx.fill();
  // side vents (metal grille)
  ctx.fillStyle = 'rgba(20,6,10,0.8)';
  for (let i = 0; i < 4; i++) { ctx.fillRect(9.5, 26 + i * 6, 3, 2.4); ctx.fillRect(W - 12.5, 26 + i * 6, 3, 2.4); }
  // status LED strip + bill acceptor
  ctx.fillStyle = 'rgba(53,224,255,0.7)'; ctx.fillRect(16, 18, W - 32, 1.4);
  ctx.fillStyle = '#1a0a0e'; ctx.fillRect(W - 22, 65, 6, 8);
  ctx.fillStyle = GOLD; ctx.fillRect(W - 21, 68, 4, 1.4);
  // control panel + button
  ctx.fillStyle = '#2a0d14';
  roundRectPath(ctx, 14, 63, W - 28, 12, 3); ctx.fill();
  ctx.fillStyle = '#35e0ff';
  ctx.beginPath(); ctx.arc(W / 2 - 10, 69, 3, 0, 7); ctx.fill();
  ctx.fillStyle = '#ff4fd8';
  ctx.beginPath(); ctx.arc(W / 2, 69, 3, 0, 7); ctx.fill();
  ctx.fillStyle = GOLD_L;
  ctx.beginPath(); ctx.arc(W / 2 + 10, 69, 3.6, 0, 7); ctx.fill();
  // base
  ctx.fillStyle = '#2f0c14';
  ctx.fillRect(12, 76, W - 24, 12);
  ctx.fillStyle = GOLD; ctx.fillRect(12, 76, W - 24, 2);
  memo.set(kind, c);
  return c;
}

export class CasinoMachine extends Entity {
  constructor(kind, x, y, side = 'west') {
    super(x, y);
    this.type = 'machine';
    this.kind = kind;
    this.gameId = CASINO_GAMES[kind].id;
    this.side = side;                       // wall it stands against
    this.rot = side === 'west' ? -Math.PI / 2 : Math.PI / 2;
    this.front = { x: x + (side === 'west' ? 44 : -44), y };
    this.occupiedBy = null;
    this.flash = 0;                         // result flash 0..1
    this.sprite = bake(kind);
    this.bx = -50; this.by = -60; this.bw = 100; this.bh = 80;
  }
  colliderRect() {
    // cabinet backs onto a side wall: footprint rotates with the sprite
    const sideWall = this.side === 'west' || this.side === 'east';
    const hx = sideWall ? 24 : 37;
    const hy = sideWall ? 38 : 26;
    return { shape: 'rect', x: this.x - hx, y: this.y - hy, w: hx * 2, h: hy * 2 };
  }
  update(dt) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 1.6);
  }
  render(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    // power cables running into the wall behind
    ctx.strokeStyle = 'rgba(12,6,10,0.85)'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(-12, -90); ctx.quadraticCurveTo(-16, -98, -9, -104); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(12, -90); ctx.quadraticCurveTo(15, -97, 9, -104); ctx.stroke();
    ctx.drawImage(this.sprite, -this.sprite.width / 2, -this.sprite.height + 12);
    // live attract motif inside the screen bezel
    ctx.save();
    ctx.beginPath(); ctx.rect(-24, -64, 48, 40); ctx.clip();
    if (this.kind === 'plinko') {
      const by = -62 + ((time * 26) % 36);
      const bx = Math.sin(by * 0.55 + this.y) * 9;
      ctx.fillStyle = 'rgba(255,214,140,0.35)';
      ctx.beginPath(); ctx.arc(bx, by - 5, 1.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffe9b8';
      ctx.beginPath(); ctx.arc(bx, by, 2.4, 0, 7); ctx.fill();
    } else if (this.kind === 'slot') {
      for (let i = 0; i < 3; i++) {
        const y = -62 + ((time * 42 + i * 9) % 16);
        ctx.fillStyle = 'rgba(42,32,48,0.55)';
        ctx.fillRect(-16 + i * 16 - 5, y, 10, 7);
      }
    } else if (this.kind === 'dice') {
      for (const [dx, dy, dr] of [[-8, -46, 1.6], [10, -38, -1.2]]) {
        ctx.save(); ctx.translate(dx, dy); ctx.rotate(time * dr);
        ctx.fillStyle = 'rgba(245,242,234,0.9)'; ctx.fillRect(-4, -4, 8, 8);
        ctx.fillStyle = '#2a0d14'; ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      }
    } else {
      const sq = Math.cos(time * 2.6);
      ctx.save(); ctx.translate(0, -44); ctx.scale(Math.max(0.12, Math.abs(sq)), 1);
      ctx.fillStyle = '#f0cd82';
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill();
      ctx.strokeStyle = '#8a6420'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // live screen glow + marquee bulbs
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.16 + 0.07 * Math.sin(time * 2.2 + this.x);
    const g = ctx.createRadialGradient(0, -40, 4, 0, -40, 34);
    g.addColorStop(0, `rgba(255,206,140,${(pulse + this.flash * 0.5).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,206,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-36, -76, 72, 72);
    for (let i = 0; i < 4; i++) {
      const a = 0.3 + 0.6 * Math.max(0, Math.sin(time * 3 + i * 1.4 + this.y));
      ctx.fillStyle = `rgba(255,226,150,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(-18 + i * 12, -84, 1.8, 0, 7); ctx.fill();
    }
    if (this.occupiedBy) {                          // little "in use" lamp
      ctx.fillStyle = `rgba(255,90,90,${(0.5 + 0.3 * Math.sin(time * 4)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(24, -70, 2.6, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
}
