// Veyra — Phase 7 arcade cabinet: baked body (zero per-frame cost) plus a small
// live layer that runs an attract-mode preview of exactly the game it holds, so
// every cabinet visually communicates its game from across the room.
import { ARCADE_GAMES } from '../games/arcadeLogic.js';
import { Entity } from '../world/Entity.js';

function bake(kind) {
  const acc = ARCADE_GAMES[kind].accent;
  const c = document.createElement('canvas');
  c.width = 96; c.height = 104;
  const x = c.getContext('2d');
  x.translate(48, 62);                                   // cabinet origin
  // floor shadow + base plinth
  x.fillStyle = 'rgba(4,6,12,0.42)';
  x.beginPath(); x.ellipse(2, 34, 30, 10, 0, 0, 7); x.fill();
  x.fillStyle = '#0a0c12'; x.fillRect(-24, 26, 48, 8);
  x.fillStyle = '#12151f'; x.fillRect(-22, 20, 44, 8);
  // body: graphite with brushed-metal side panels
  const bg = x.createLinearGradient(-22, 0, 22, 0);
  bg.addColorStop(0, '#10131c'); bg.addColorStop(0.18, '#232838');
  bg.addColorStop(0.5, '#181c28'); bg.addColorStop(0.82, '#232838'); bg.addColorStop(1, '#10131c');
  x.fillStyle = bg;
  x.beginPath(); x.roundRect(-22, -34, 44, 56, 4); x.fill();
  x.strokeStyle = 'rgba(120,140,180,0.35)'; x.lineWidth = 1;
  x.beginPath(); x.roundRect(-22, -34, 44, 56, 4); x.stroke();
  // neon side stripes (material: lit acrylic)
  x.fillStyle = acc; x.globalAlpha = 0.85;
  x.fillRect(-22, -30, 2.6, 48); x.fillRect(19.4, -30, 2.6, 48);
  x.globalAlpha = 1;
  // marquee box with the game title
  x.fillStyle = '#05070c';
  x.beginPath(); x.roundRect(-20, -46, 40, 14, 3); x.fill();
  x.strokeStyle = acc; x.lineWidth = 1.6;
  x.beginPath(); x.roundRect(-20, -46, 40, 14, 3); x.stroke();
  x.fillStyle = '#f4f8ff'; x.font = '900 6.4px Rajdhani, system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(ARCADE_GAMES[kind].title, 0, -38.6);
  // screen bezel (live screen drawn over this)
  x.fillStyle = '#04060a';
  x.beginPath(); x.roundRect(-17, -29, 34, 26, 3); x.fill();
  x.strokeStyle = 'rgba(140,160,200,0.4)'; x.lineWidth = 1;
  x.beginPath(); x.roundRect(-17, -29, 34, 26, 3); x.stroke();
  // control panel: sloped deck, joystick + six buttons
  x.fillStyle = '#1b2030';
  x.beginPath(); x.moveTo(-20, -1); x.lineTo(20, -1); x.lineTo(17, 7); x.lineTo(-17, 7); x.closePath(); x.fill();
  x.strokeStyle = 'rgba(140,160,200,0.3)'; x.stroke();
  x.fillStyle = '#05070c'; x.beginPath(); x.arc(-9, 3, 3.4, 0, 7); x.fill();   // stick base
  x.strokeStyle = '#3a4150'; x.lineWidth = 2; x.beginPath(); x.moveTo(-9, 3); x.lineTo(-9, -1.5); x.stroke();
  x.fillStyle = '#d81f3d'; x.beginPath(); x.arc(-9, -2.6, 2.4, 0, 7); x.fill(); // stick ball
  for (let i = 0; i < 6; i++) {                                                  // buttons
    x.fillStyle = i % 2 ? acc : '#e8ecf6';
    x.beginPath(); x.arc(1 + (i % 3) * 5.4, 1.6 + ((i / 3) | 0) * 4, 1.7, 0, 7); x.fill();
  }
  // coin door + speaker grille + status LED
  x.fillStyle = '#0d1017'; x.fillRect(-8, 10, 16, 9);
  x.strokeStyle = 'rgba(140,160,200,0.3)'; x.strokeRect(-8, 10, 16, 9);
  x.fillStyle = acc; x.fillRect(-2.4, 13, 4.8, 1.6);
  x.fillStyle = 'rgba(140,160,200,0.5)';
  for (let i = 0; i < 5; i++) x.fillRect(-14 + i * 2, 12, 1, 5);
  // cable conduit to the wall
  x.strokeStyle = 'rgba(10,12,18,0.9)'; x.lineWidth = 2.4;
  x.beginPath(); x.moveTo(-20, 18); x.quadraticCurveTo(-30, 22, -34, 30); x.stroke();
  return c;
}

export class ArcadeCabinet extends Entity {
  constructor(kind, x, y, side) {
    super(x, y);
    this.type = 'cabinet';
    this.kind = kind;
    this.gameId = ARCADE_GAMES[kind].id;               // permanent 1:1 mapping
    this.side = side;
    this.rot = side === 'west' ? -Math.PI / 2 : Math.PI / 2;
    this.front = { x: x + (side === 'west' ? 40 : -40), y };
    this.occupiedBy = null;
    this.flash = 0;
    this.sprite = bake(kind);
    this.bx = -48; this.by = -62; this.bw = 96; this.bh = 104;
  }
  colliderRect() {
    const sideWall = this.side === 'west' || this.side === 'east';
    const hx = sideWall ? 22 : 34;
    const hy = sideWall ? 34 : 22;
    return { shape: 'rect', x: this.x - hx, y: this.y - hy, w: hx * 2, h: hy * 2 };
  }
  update(dt) { if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 1.6); }
  render(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    // floor glow pool under the cabinet (machine illumination layer)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const acc = ARCADE_GAMES[this.kind].accent;
    const g = ctx.createRadialGradient(0, 26, 4, 0, 26, 46);
    g.addColorStop(0, acc + '2a'); g.addColorStop(1, acc + '00');
    ctx.fillStyle = g; ctx.fillRect(-46, -18, 92, 88);
    ctx.restore();
    ctx.rotate(this.rot);
    ctx.drawImage(this.sprite, this.bx, this.by);
    // ---- live attract screen: previews exactly this game ----
    ctx.save();
    ctx.beginPath(); ctx.roundRect(-16, -28, 32, 24, 2); ctx.clip();
    ctx.fillStyle = '#060810'; ctx.fillRect(-16, -28, 32, 24);
    this._attract(ctx, time);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';            // glass sheen
    ctx.beginPath(); ctx.moveTo(-16, -28); ctx.lineTo(2, -28); ctx.lineTo(-16, -10); ctx.closePath(); ctx.fill();
    ctx.restore();
    // marquee glow + status LED blink
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = ARCADE_GAMES[this.kind].accent + '30';
    ctx.fillRect(-21, -47, 42, 16);
    ctx.restore();
    ctx.fillStyle = this.occupiedBy ? '#ff3b56' : (Math.sin(time * 3 + this.x) > 0 ? '#86e05a' : '#2c5a24');
    ctx.beginPath(); ctx.arc(15, 12, 1.5, 0, 7); ctx.fill();
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(this.flash * 0.35).toFixed(3)})`;
      ctx.fillRect(-16, -28, 32, 24);
    }
    ctx.restore();
  }
  _attract(ctx, t) {
    const a = ARCADE_GAMES[this.kind].accent;
    if (this.kind === 'tileshift') {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {   // amber mosaic, two tiles trade places
        const idx = r * 3 + c;
        const sw = Math.floor(t * 0.8) % 2 === 0 ? 0 : 8;
        const x = -14 + c * 10 + (idx === 4 ? sw / 2 : 0), y = -26 + r * 8 - (idx === 4 ? 0 : 0);
        ctx.fillStyle = ['#4fc3f7', '#ffd54f', '#ff5252', '#81c784'][(r + c) % 4];
        ctx.globalAlpha = idx === 0 || idx === 8 ? 0.55 + 0.45 * Math.abs(Math.sin(t * 2.5)) : 0.85;
        ctx.fillRect(x, y, 8, 6);
      }
      ctx.globalAlpha = 1;
    } else if (this.kind === 'memrush') {
      ctx.fillStyle = 'rgba(122,162,255,0.12)'; ctx.fillRect(-16, -28, 32, 24);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {   // pattern pulses in sequence
        const lit = (Math.floor(t * 2) % 9) === r * 3 + c || (r === 1 && c === 1);
        ctx.fillStyle = lit ? '#7aa2ff' : 'rgba(122,162,255,0.18)';
        ctx.fillRect(-14 + c * 10, -26 + r * 8, 8, 6);
      }
    } else if (this.kind === 'neonescape') {
      ctx.strokeStyle = '#32f5ff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(Math.sin(t) * 6, -16 + Math.cos(t * .8) * 3, 7, 0, 7); ctx.stroke();
      ctx.strokeStyle = '#ff37b4'; ctx.beginPath(); ctx.moveTo(-16, -20 + (t * 7) % 18); ctx.lineTo(16, -20 + (t * 7) % 18); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(Math.sin(t) * 5, -16, 2, 0, 7); ctx.fill();
    } else {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const idx = r * 3 + c, active = idx === Math.floor(t * 2) % 9;
        ctx.fillStyle = active ? '#d68cff' : 'rgba(214,140,255,.15)';
        ctx.fillRect(-13 + c * 9, -25 + r * 7, 7, 5);
      }
      ctx.fillStyle = '#fff'; ctx.font = 'bold 5px sans-serif'; ctx.fillText('N=2', -5, -4);
    }
    if (this.occupiedBy) {                                // "someone is playing" scanline
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(-16, -28 + ((t * 26) % 24), 32, 1.6);
    }
    void a;
  }
}
