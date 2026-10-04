// Veyra — Phase 5 interior registry.
// Final casino/arcade interiors arrive in a later phase; this registry is the
// loading architecture for them. Each entry defines the room shell, spawn and
// exit door, plus a polished placeholder lobby drawn until the real floor ships.
// To ship a real interior later: replace drawRoom/grade (and room geometry) here.
import { makeCanvas, roundRectPath } from '../core/util.js';
import { loadBest } from '../games/arcadeLogic.js';

const ROOM = { x: 480, y: 340, w: 640, h: 560 };
const BOARD = { x: 690, y: 382, w: 220, h: 84 };
const ARCADE_ACCENTS = { memrush: '#7aa2ff', tileshift: '#ffb347', neonescape: '#32f5ff', nback: '#d68cff' };
let bestCache = { t: -10, v: [0, 0, 0, 0] };

function shell(ctx, opt) {
  const r = ROOM;
  // floor
  let g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  g.addColorStop(0, opt.floorTop); g.addColorStop(1, opt.floorBot);
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  // wall bands (fake 2.5D: 30px deep around the floor)
  ctx.fillStyle = opt.wall;
  ctx.fillRect(r.x, r.y, r.w, 30);                       // north
  ctx.fillRect(r.x, r.y + r.h - 30, r.w, 30);            // south
  ctx.fillRect(r.x, r.y, 26, r.h);                       // west
  ctx.fillRect(r.x + r.w - 26, r.y, 26, r.h);            // east
  // baseboards
  ctx.fillStyle = opt.trim;
  ctx.fillRect(r.x + 26, r.y + 28, r.w - 52, 3);
  ctx.fillRect(r.x + 24, r.y + 30, 3, r.h - 60);
  ctx.fillRect(r.x + r.w - 27, r.y + 30, 3, r.h - 60);
  ctx.fillRect(r.x + 26, r.y + r.h - 31, r.w - 52, 3);
  return g;
}

function doorAlcove(ctx, opt, time) {
  // south-wall entrance/exit door + glowing floor pad (shared shell)
  const dx = 744, dw = 112, dy = ROOM.y + ROOM.h - 30;
  ctx.fillStyle = '#0c0a12';
  ctx.fillRect(dx, dy - 6, dw, 36);
  const g = ctx.createLinearGradient(0, dy - 6, 0, dy + 26);
  g.addColorStop(0, opt.doorGlow); g.addColorStop(1, 'rgba(10,8,14,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(dx + 4, dy - 2, dw - 8, 28);
  ctx.strokeStyle = opt.trim; ctx.lineWidth = 3;
  ctx.strokeRect(dx + 1.5, dy - 7.5, dw - 3, 33);
  ctx.fillStyle = opt.trim;
  ctx.fillRect(dx + dw / 2 - 1.5, dy - 2, 3, 26);          // door split
  // EXIT sign
  const pulse = 0.65 + 0.35 * Math.sin(time * 2.6);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = opt.exitGlow.replace('%A%', (0.35 * pulse).toFixed(3));
  ctx.fillRect(dx + 20, dy - 26, dw - 40, 18);
  ctx.restore();
  roundRectPath(ctx, dx + 30, dy - 23, dw - 60, 13, 3);
  ctx.fillStyle = '#10131a'; ctx.fill();
  ctx.strokeStyle = opt.trim; ctx.lineWidth = 1.4;
  roundRectPath(ctx, dx + 30, dy - 23, dw - 60, 13, 3); ctx.stroke();
  ctx.fillStyle = opt.exitText;
  ctx.font = '900 9px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('EXIT', dx + dw / 2, dy - 16);
  // floor pad
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pg = ctx.createRadialGradient(800, 866, 4, 800, 866, 78);
  pg.addColorStop(0, opt.padGlow.replace('%A%', (0.2 + 0.07 * Math.sin(time * 2)).toFixed(3)));
  pg.addColorStop(1, opt.padGlow.replace('%A%', '0'));
  ctx.fillStyle = pg;
  ctx.fillRect(700, 800, 200, 110);
  ctx.restore();
}

function boardStanchions(ctx, opt) {
  // velvet rope posts in front of the notice board
  for (const px of [BOARD.x - 14, BOARD.x + BOARD.w + 14]) {
    ctx.fillStyle = opt.postColor;
    ctx.fillRect(px - 2.5, 468, 5, 20);
    ctx.beginPath(); ctx.arc(px, 465, 4, 0, 7); ctx.fill();
    ctx.fillRect(px - 6, 488, 12, 4);
  }
  ctx.strokeStyle = opt.ropeColor; ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.moveTo(BOARD.x - 14, 471);
  ctx.quadraticCurveTo(800, 486, BOARD.x + BOARD.w + 14, 471);
  ctx.stroke();
}

const gradeCache = new Map();
function gradeWith(key, tint, vig) {
  return (ctx, view) => {
    const ck = `${key}:${view.w}x${view.h}`;
    let c = gradeCache.get(ck);
    if (!c) {
      c = makeCanvas(view.w, view.h);
      const g2 = c.getContext('2d');
      g2.fillStyle = tint;
      g2.fillRect(0, 0, view.w, view.h);
      const g = g2.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.3, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.72);
      g.addColorStop(0, 'rgba(4,3,10,0)');
      g.addColorStop(1, vig);
      g2.fillStyle = g;
      g2.fillRect(0, 0, view.w, view.h);
    }
    ctx.drawImage(c, 0, 0, view.w, view.h);
  };
}

export const INTERIORS = {
  casino: {
    id: 'casino',
    name: 'VEYRA CASINO',
    zoneName: 'Veyra Casino · Lobby',
    room: ROOM,
    boardCollider: { shape: 'rect', x: BOARD.x - 8, y: BOARD.y + 40, w: BOARD.w + 16, h: 56 },
    extraColliders: [
      { shape: 'circle', x: 680, y: 620, r: 30 },        // card tables
      { shape: 'circle', x: 920, y: 660, r: 30 },
      { shape: 'circle', x: 998, y: 432, r: 13 },        // lounge chairs
      { shape: 'circle', x: 950, y: 420, r: 13 },
      { shape: 'circle', x: 974, y: 424, r: 9 },         // lounge table
    ],
    spawn: { x: 800, y: 762 },
    exit: { x: 800, y: 866, radius: 64, label: 'Exit casino' },
    grade: gradeWith('casino', 'rgba(34,12,16,0.11)', 'rgba(6,2,8,0.44)'),
    drawRoom(ctx, time) {
      shell(ctx, { floorTop: '#5c1b2d', floorBot: '#481422', wall: '#3a1a2c', trim: '#d9a441', doorGlow: 'rgba(255,206,140,0.55)', exitGlow: 'rgba(255,200,110,%A%)', exitText: '#ffd98a', padGlow: 'rgba(255,196,110,%A%)' });
      // carpet borders + medallion
      ctx.strokeStyle = 'rgba(240,205,130,0.55)'; ctx.lineWidth = 3;
      ctx.strokeRect(ROOM.x + 44, ROOM.y + 44, ROOM.w - 88, ROOM.h - 88);
      ctx.strokeStyle = 'rgba(240,205,130,0.28)'; ctx.lineWidth = 1.6;
      ctx.strokeRect(ROOM.x + 52, ROOM.y + 52, ROOM.w - 104, ROOM.h - 104);
      ctx.save();
      ctx.translate(800, 640);
      ctx.strokeStyle = 'rgba(240,205,130,0.4)'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, 0, 86, 0, 7); ctx.stroke();
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = 'rgba(240,205,130,0.28)';
      ctx.strokeRect(-58, -58, 116, 116);
      ctx.restore();
      // wall sconces (warm, breathing)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const spots = [[560, ROOM.y + 16], [680, ROOM.y + 16], [920, ROOM.y + 16], [1040, ROOM.y + 16], [ROOM.x + 13, 480], [ROOM.x + 13, 700], [ROOM.x + ROOM.w - 13, 480], [ROOM.x + ROOM.w - 13, 700]];
      spots.forEach(([sx, sy], i) => {
        const a = 0.2 + 0.07 * Math.sin(time * 1.8 + i * 1.7);
        const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, 40);
        g.addColorStop(0, `rgba(255,206,140,${a.toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,206,140,0)');
        ctx.fillStyle = g; ctx.fillRect(sx - 42, sy - 42, 84, 84);
      });
      // ceiling warmth
      const cg = ctx.createRadialGradient(800, 580, 40, 800, 580, 420);
      cg.addColorStop(0, 'rgba(255,190,120,0.09)'); cg.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = cg; ctx.fillRect(ROOM.x, ROOM.y, ROOM.w, ROOM.h);
      ctx.restore();
      // architecture: wainscot panels + pilasters + cove lighting
      ctx.strokeStyle = 'rgba(217,164,65,0.28)'; ctx.lineWidth = 1.4;
      for (let x = ROOM.x + 40; x < ROOM.x + ROOM.w - 40; x += 64) {
        ctx.strokeRect(x, ROOM.y + 2, 44, 16);                     // north wall panels
        ctx.strokeRect(x, ROOM.y + ROOM.h - 18, 44, 16);           // south wall panels
      }
      for (const px of [560, 1040]) {                              // pilasters
        ctx.fillStyle = '#4a1622';
        ctx.fillRect(px - 7, ROOM.y, 14, 26);
        ctx.fillStyle = '#d9a441';
        ctx.fillRect(px - 9, ROOM.y + 22, 18, 4);
        ctx.fillRect(px - 9, ROOM.y, 18, 3);
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,214,150,0.05)';                    // cove wash under ceiling
      ctx.fillRect(ROOM.x + 26, ROOM.y + 2, ROOM.w - 52, 10);
      for (let x = ROOM.x + 52; x < ROOM.x + ROOM.w - 40; x += 52) {   // recessed downlights
        ctx.fillStyle = 'rgba(255,226,170,0.5)';
        ctx.beginPath(); ctx.arc(x, ROOM.y + 7, 1.6, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,226,170,0.10)';
        ctx.beginPath(); ctx.arc(x, ROOM.y + 7, 7, 0, 7); ctx.fill();
      }
      // polished-floor sheen: soft reflections under the machine fronts
      for (const [mx, my, sx] of [[545, 500, 1], [545, 740, 1], [1055, 500, -1], [1055, 740, -1]]) {
        const rg = ctx.createRadialGradient(mx + sx * 52, my, 4, mx + sx * 52, my, 40);
        rg.addColorStop(0, 'rgba(255,206,140,0.10)'); rg.addColorStop(1, 'rgba(255,206,140,0)');
        ctx.fillStyle = rg;
        ctx.save(); ctx.translate(mx + sx * 52, my); ctx.scale(1, 0.5); ctx.translate(-(mx + sx * 52), -my);
        ctx.fillRect(mx + sx * 52 - 40, my - 40, 80, 80);
        ctx.restore();
      }
      ctx.restore();
      // lounge corner: two armchairs + low table (northeast)
      for (const [cx2, cy2, r2] of [[998, 432, 0.6], [950, 420, -0.5]]) {
        ctx.save(); ctx.translate(cx2, cy2); ctx.rotate(r2);
        ctx.fillStyle = 'rgba(8,4,10,0.35)';
        ctx.beginPath(); ctx.ellipse(1, 3, 13, 8, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#5c1b2d';
        ctx.beginPath(); ctx.roundRect(-11, -9, 22, 18, 6); ctx.fill();
        ctx.fillStyle = '#7a2438';
        ctx.beginPath(); ctx.roundRect(-8, -6, 16, 12, 4); ctx.fill();
        ctx.fillStyle = '#5c1b2d';
        ctx.fillRect(-11, -12, 22, 5);                              // backrest
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(8,4,10,0.35)';
      ctx.beginPath(); ctx.ellipse(975, 427, 11, 6, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#3f121e';
      ctx.beginPath(); ctx.arc(974, 424, 9, 0, 7); ctx.fill();
      ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(974, 424, 9, 0, 7); ctx.stroke();
      // machine floor pads (brass inlays where the cabinets stand)
      for (const [mx, my] of [[545, 500], [545, 740], [1055, 500], [1055, 740]]) {
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(mx < 800 ? -Math.PI / 2 : Math.PI / 2);
        ctx.fillStyle = 'rgba(217,164,65,0.16)';
        ctx.beginPath(); ctx.roundRect(-40, -30, 80, 60, 8); ctx.fill();
        ctx.strokeStyle = 'rgba(240,205,130,0.4)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.roundRect(-40, -30, 80, 60, 8); ctx.stroke();
        ctx.restore();
      }
      // card tables with chairs + chip stacks
      for (const [tx, ty] of [[680, 620], [920, 660]]) {
        ctx.fillStyle = 'rgba(8,4,10,0.35)';
        ctx.beginPath(); ctx.ellipse(tx + 3, ty + 5, 30, 26, 0, 0, 7); ctx.fill();
        for (const a of [Math.PI * 0.15, Math.PI * 1.15]) {          // chairs
          const chx = tx + Math.cos(a) * 36, chy = ty + Math.sin(a) * 32;
          ctx.fillStyle = '#4a2a18';
          ctx.beginPath(); ctx.arc(chx, chy, 9, 0, 7); ctx.fill();
          ctx.fillStyle = '#6b3d22';
          ctx.beginPath(); ctx.arc(chx, chy - 2, 7, 0, 7); ctx.fill();
        }
        const tg = ctx.createRadialGradient(tx - 8, ty - 8, 4, tx, ty, 28);
        tg.addColorStop(0, '#5c1b2d'); tg.addColorStop(1, '#43121f');
        ctx.fillStyle = tg;
        ctx.beginPath(); ctx.arc(tx, ty, 26, 0, 7); ctx.fill();
        ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.arc(tx, ty, 26, 0, 7); ctx.stroke();
        ctx.strokeStyle = 'rgba(240,205,130,0.4)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(tx, ty, 18, 0, 7); ctx.stroke();
        for (let i = 0; i < 3; i++) {                                  // chip stacks
          const cx2 = tx - 8 + i * 8, cy2 = ty - 4 + (i % 2) * 6;
          ctx.fillStyle = ['#c8473b', '#35e0ff', '#f5f2ea'][i];
          ctx.fillRect(cx2 - 3, cy2 - 4, 6, 4);
          ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(cx2 - 3, cy2 - 1, 6, 1);
        }
      }
      // chandelier above the medallion (ceiling read) + table light pools
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const chg = ctx.createRadialGradient(800, 560, 6, 800, 560, 120);
      chg.addColorStop(0, `rgba(255,214,150,${(0.16 + 0.04 * Math.sin(time * 1.8)).toFixed(3)})`);
      chg.addColorStop(1, 'rgba(255,214,150,0)');
      ctx.fillStyle = chg; ctx.fillRect(680, 440, 240, 240);
      for (const [lx, ly] of [[680, 620], [920, 660]]) {
        const lg = ctx.createRadialGradient(lx, ly, 4, lx, ly, 70);
        lg.addColorStop(0, 'rgba(255,206,140,0.10)'); lg.addColorStop(1, 'rgba(255,206,140,0)');
        ctx.fillStyle = lg; ctx.fillRect(lx - 70, ly - 70, 140, 140);
      }
      ctx.restore();
      ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(800, 560, 16, 0, 7); ctx.stroke();
      ctx.fillStyle = '#ffe9b8';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + time * 0.15;
        ctx.beginPath(); ctx.arc(800 + Math.cos(a) * 16, 560 + Math.sin(a) * 16, 2.2, 0, 7); ctx.fill();
      }
      // gilt wall frames with card suits
      const suits = ['♠', '♥', '♦', '♣'];
      [[585, 352], [1015, 352], [620, 878], [980, 878]].forEach(([fx, fy], i) => {
        ctx.fillStyle = '#241019'; ctx.fillRect(fx - 16, fy - 12, 32, 24);
        ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 2; ctx.strokeRect(fx - 16, fy - 12, 32, 24);
        ctx.fillStyle = i % 2 ? '#c8473b' : '#eaf2ff';
        ctx.font = '900 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(suits[i], fx, fy + 1);
      });
      // carpet runner from the doors to the medallion
      let rg = ctx.createLinearGradient(0, 470, 0, 856);
      rg.addColorStop(0, '#7d1f2e'); rg.addColorStop(1, '#5c1724');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(764, 856); ctx.lineTo(836, 856); ctx.lineTo(824, 470); ctx.lineTo(776, 470);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(240,205,130,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(770, 852); ctx.lineTo(780, 474); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(830, 852); ctx.lineTo(820, 474); ctx.stroke();
      // corner palms
      for (const [px, py] of [[536, 408], [1064, 408], [536, 836], [1064, 836]]) {
        ctx.fillStyle = '#6b4a2c';
        ctx.beginPath(); ctx.moveTo(px - 12, py + 16); ctx.lineTo(px + 12, py + 16); ctx.lineTo(px + 8, py - 6); ctx.lineTo(px - 8, py - 6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#2f6b36'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i - 2.5) * 0.55;
          ctx.beginPath(); ctx.moveTo(px, py - 6);
          ctx.quadraticCurveTo(px + Math.cos(a) * 16, py - 6 + Math.sin(a) * 16, px + Math.cos(a) * 26, py - 6 + Math.sin(a) * 20 + 8);
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
      // notice board
      ctx.fillStyle = '#3a2a18';
      ctx.fillRect(BOARD.x + 20, BOARD.y + BOARD.h, 8, 46);
      ctx.fillRect(BOARD.x + BOARD.w - 28, BOARD.y + BOARD.h, 8, 46);
      roundRectPath(ctx, BOARD.x, BOARD.y, BOARD.w, BOARD.h, 8);
      ctx.fillStyle = '#241019'; ctx.fill();
      ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 3.4;
      roundRectPath(ctx, BOARD.x + 3, BOARD.y + 3, BOARD.w - 6, BOARD.h - 6, 6); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffe9b8'; ctx.font = '900 24px system-ui, sans-serif';
      ctx.fillText('VEYRA CASINO', 800, BOARD.y + 32);
      ctx.fillStyle = 'rgba(240,205,130,0.85)'; ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillText('Tonight: Plinko · Slots · Dice · Heads & Tails', 800, BOARD.y + 60);
      boardStanchions(ctx, { postColor: '#d9a441', ropeColor: '#7d1f2e' });
      doorAlcove(ctx, { trim: '#d9a441', doorGlow: 'rgba(255,206,140,0.55)', exitGlow: 'rgba(255,200,110,%A%)', exitText: '#ffd98a', padGlow: 'rgba(255,196,110,%A%)' }, time);
    },
  },
  arcade: {
    id: 'arcade',
    name: 'VEYRA ARCADE',
    zoneName: 'Veyra Arcade · Lobby',
    room: ROOM,
    boardCollider: { shape: 'rect', x: BOARD.x - 8, y: BOARD.y + 40, w: BOARD.w + 16, h: 56 },
    extraColliders: [
      { shape: 'circle', x: 640, y: 640, r: 12 },        // stools
      { shape: 'circle', x: 960, y: 640, r: 12 },
      { shape: 'rect', x: 630, y: 836, w: 64, h: 16 },   // bench
    ],
    spawn: { x: 800, y: 762 },
    exit: { x: 800, y: 866, radius: 64, label: 'Exit arcade' },
    grade: gradeWith('arcade', 'rgba(10,16,38,0.13)', 'rgba(3,5,14,0.5)'),
    drawRoom(ctx, time) {
      shell(ctx, { floorTop: '#1a1f2e', floorBot: '#121623', wall: '#232836', trim: '#35e0ff', doorGlow: 'rgba(120,220,255,0.5)', exitGlow: 'rgba(255,79,216,%A%)', exitText: '#ff9fe8', padGlow: 'rgba(110,215,255,%A%)' });
      // floor grid
      ctx.strokeStyle = 'rgba(53,224,255,0.10)'; ctx.lineWidth = 1.4;
      for (let x = ROOM.x + 64; x < ROOM.x + ROOM.w; x += 64) {
        ctx.beginPath(); ctx.moveTo(x, ROOM.y + 30); ctx.lineTo(x, ROOM.y + ROOM.h - 30); ctx.stroke();
      }
      for (let y = ROOM.y + 64; y < ROOM.y + ROOM.h; y += 64) {
        ctx.beginPath(); ctx.moveTo(ROOM.x + 26, y); ctx.lineTo(ROOM.x + ROOM.w - 26, y); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,79,216,0.16)'; ctx.lineWidth = 2;
      ctx.strokeRect(ROOM.x + 44, ROOM.y + 44, ROOM.w - 88, ROOM.h - 88);
      // architecture: wall panel seams + trim + recessed ceiling light strips
      ctx.strokeStyle = 'rgba(120,140,180,0.14)'; ctx.lineWidth = 1.2;
      for (let x = ROOM.x + 72; x < ROOM.x + ROOM.w - 60; x += 96) {
        ctx.beginPath(); ctx.moveTo(x, ROOM.y + 2); ctx.lineTo(x, ROOM.y + 18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, ROOM.y + ROOM.h - 18); ctx.lineTo(x, ROOM.y + ROOM.h - 2); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(53,224,255,0.22)';
      ctx.beginPath(); ctx.moveTo(ROOM.x + 26, ROOM.y + 18); ctx.lineTo(ROOM.x + ROOM.w - 26, ROOM.y + 18); ctx.stroke();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const ly of [402, 642]) {                            // linear ceiling fixtures
        const lg = ctx.createLinearGradient(0, ly - 14, 0, ly + 14);
        lg.addColorStop(0, 'rgba(160,220,255,0)'); lg.addColorStop(0.5, `rgba(190,235,255,${(0.07 + 0.02 * Math.sin(time * 1.3 + ly)).toFixed(3)})`); lg.addColorStop(1, 'rgba(160,220,255,0)');
        ctx.fillStyle = lg; ctx.fillRect(ROOM.x + 90, ly - 14, ROOM.w - 180, 28);
        ctx.fillStyle = 'rgba(220,245,255,0.35)'; ctx.fillRect(ROOM.x + 90, ly - 1, ROOM.w - 180, 2);
      }
      ctx.restore();
      // dance pad decal (floor graphic, flat — no collider)
      ctx.save();
      ctx.translate(800, 600);
      ctx.fillStyle = 'rgba(20,24,36,0.9)';
      ctx.beginPath(); ctx.roundRect(-20, -20, 40, 40, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(53,224,255,0.5)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.roundRect(-20, -20, 40, 40, 4); ctx.stroke();
      for (const [ax, ay, rot] of [[0, -10, 0], [10, 0, Math.PI / 2], [0, 10, Math.PI], [-10, 0, -Math.PI / 2]]) {
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(rot);
        ctx.fillStyle = `rgba(255,79,216,${(0.35 + 0.25 * Math.sin(time * 3 + ax + ay)).toFixed(2)})`;
        ctx.beginPath(); ctx.moveTo(-5, 4); ctx.lineTo(0, -4); ctx.lineTo(5, 4); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      // north-wall pixel strip (scrolling checker)
      const off = Math.floor(time * 18) % 24;
      for (let x = ROOM.x + 30; x < ROOM.x + ROOM.w - 30; x += 24) {
        const i = Math.floor((x + off) / 12);
        ctx.fillStyle = i % 2 ? 'rgba(53,224,255,0.4)' : 'rgba(255,79,216,0.4)';
        ctx.fillRect(x - (off % 24), ROOM.y + 8, 12, 12);
      }
      // game posters (north wall) — each advertises one cabinet
      const posterArt = (px, py, kind) => {
        ctx.fillStyle = '#0d1017'; ctx.fillRect(px - 17, py - 13, 34, 26);
        ctx.strokeStyle = ARCADE_ACCENTS[kind]; ctx.lineWidth = 1.8;
        ctx.strokeRect(px - 17, py - 13, 34, 26);
        ctx.save();
        ctx.beginPath(); ctx.rect(px - 15, py - 11, 30, 22); ctx.clip();
        if (kind === 'tileshift') {
          for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
            ctx.fillStyle = ['#4fc3f7', '#ffd54f', '#ff5252', '#81c784'][(r + c) % 4];
            ctx.fillRect(px - 13 + c * 9, py - 9 + r * 7, 7, 5);
          }
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.strokeRect(px - 13, py - 9, 7, 5);   // selected tile
        } else if (kind === 'memrush') {
          ctx.fillStyle = 'rgba(122,162,255,0.16)'; ctx.fillRect(px - 13, py - 9, 26, 19);
          ctx.fillStyle = '#7aa2ff';
          ctx.fillRect(px - 11, py - 7, 6, 4); ctx.fillRect(px + 1, py - 1, 6, 4); ctx.fillRect(px - 5, py + 3, 6, 4);
          ctx.strokeStyle = 'rgba(207,224,255,0.9)'; ctx.lineWidth = 1; ctx.strokeRect(px - 11, py - 7, 6, 4);
        } else if (kind === 'neonescape') {
          ctx.strokeStyle = '#32f5ff'; ctx.beginPath(); ctx.arc(px, py, 8, 0, 7); ctx.stroke();
          ctx.strokeStyle = '#ff37b4'; ctx.beginPath(); ctx.moveTo(px - 14, py + 4); ctx.lineTo(px + 14, py + 4); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, 2, 0, 7); ctx.fill();
        } else {
          for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
            ctx.fillStyle = r === 1 && c === 2 ? '#d68cff' : 'rgba(214,140,255,.2)';
            ctx.fillRect(px - 12 + c * 9, py - 8 + r * 7, 7, 5);
          }
        }
        ctx.restore();
      };
      posterArt(585, 352, 'tileshift'); posterArt(1015, 352, 'memrush');
      posterArt(500, 620, 'neonescape'); posterArt(1100, 620, 'nback');
      // prize shelf (east wall): plushies behind glass
      ctx.fillStyle = '#161a26'; ctx.fillRect(1086, 596, 26, 52);
      ctx.strokeStyle = '#3a4150'; ctx.lineWidth = 1.4; ctx.strokeRect(1086, 596, 26, 52);
      ctx.fillStyle = 'rgba(160,220,255,0.10)'; ctx.fillRect(1088, 598, 22, 48);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = ['#ff4fd8', '#35e0ff', '#86e05a', '#ffd98a', '#ff6a3d', '#b48cff'][i];
        ctx.beginPath(); ctx.arc(1094 + (i % 2) * 10, 606 + ((i / 2) | 0) * 15, 3.4, 0, 7); ctx.fill();
      }
      // stools + bench (seating that reads as an arcade waiting area)
      for (const [sx2, sy2] of [[640, 640], [960, 640]]) {
        ctx.fillStyle = 'rgba(4,6,12,0.4)';
        ctx.beginPath(); ctx.ellipse(sx2 + 2, sy2 + 4, 12, 5, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#232838'; ctx.fillRect(sx2 - 2, sy2 - 2, 4, 8);
        ctx.fillStyle = '#12151f';
        ctx.beginPath(); ctx.ellipse(sx2, sy2 - 4, 11, 5.5, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(53,224,255,0.7)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(sx2, sy2 - 4, 11, 5.5, 0, 0, 7); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(4,6,12,0.4)';
      ctx.beginPath(); ctx.ellipse(662, 852, 34, 7, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#1b2030'; ctx.fillRect(630, 838, 64, 7);
      ctx.fillStyle = '#232838'; ctx.fillRect(634, 845, 6, 8); ctx.fillRect(684, 845, 6, 8);
      ctx.fillStyle = 'rgba(255,79,216,0.5)'; ctx.fillRect(630, 836, 64, 2);
      // ceiling cool glows
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const [gx, gy] of [[640, 520], [960, 520], [800, 760]]) {
        const g = ctx.createRadialGradient(gx, gy, 10, gx, gy, 240);
        g.addColorStop(0, `rgba(110,200,255,${(0.06 + 0.02 * Math.sin(time * 1.6 + gx)).toFixed(3)})`);
        g.addColorStop(1, 'rgba(110,200,255,0)');
        ctx.fillStyle = g; ctx.fillRect(gx - 240, gy - 240, 480, 480);
      }
      ctx.restore();
      // neon notice board (colour cycling border)
      ctx.fillStyle = '#20242e';
      ctx.fillRect(BOARD.x + 20, BOARD.y + BOARD.h, 8, 46);
      ctx.fillRect(BOARD.x + BOARD.w - 28, BOARD.y + BOARD.h, 8, 46);
      roundRectPath(ctx, BOARD.x, BOARD.y, BOARD.w, BOARD.h, 8);
      ctx.fillStyle = '#0d1017'; ctx.fill();
      const hue = (time * 55) % 360;
      ctx.save();
      ctx.shadowColor = `hsl(${hue.toFixed(0)},100%,62%)`; ctx.shadowBlur = 14;
      ctx.strokeStyle = `hsl(${hue.toFixed(0)},100%,66%)`; ctx.lineWidth = 3;
      roundRectPath(ctx, BOARD.x + 3, BOARD.y + 3, BOARD.w - 6, BOARD.h - 6, 6); ctx.stroke();
      ctx.restore();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f2fbff'; ctx.font = '900 24px system-ui, sans-serif';
      ctx.fillText('VEYRA ARCADE', 800, BOARD.y + 32);
      ctx.fillStyle = 'rgba(140,240,255,0.9)'; ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillText('Now playing: 4 cabinets · beat the best', 800, BOARD.y + 60);
      if (time - bestCache.t > 1) bestCache = { t: time, v: [loadBest('memrush'), loadBest('tileshift'), loadBest('neonescape'), loadBest('nback')] };
      if (bestCache.v.some((x) => x > 0)) {
        ctx.fillStyle = 'rgba(255,217,138,0.9)'; ctx.font = '700 10px system-ui, sans-serif';
        ctx.fillText(`BEST  MR ${bestCache.v[0]} · TS ${bestCache.v[1]} · NE ${bestCache.v[2]} · NB ${bestCache.v[3]}`, 800, BOARD.y + 74);
      }
      boardStanchions(ctx, { postColor: '#3a4150', ropeColor: '#20242e' });
      // floor decals pointing at the exit
      ctx.fillStyle = 'rgba(140,240,255,0.35)';
      for (const yy of [806, 828]) {
        ctx.beginPath(); ctx.moveTo(786, yy + 10); ctx.lineTo(800, yy); ctx.lineTo(814, yy + 10);
        ctx.lineTo(800, yy + 6); ctx.closePath(); ctx.fill();
      }
      doorAlcove(ctx, { trim: '#35e0ff', doorGlow: 'rgba(120,220,255,0.5)', exitGlow: 'rgba(255,79,216,%A%)', exitText: '#ff9fe8', padGlow: 'rgba(110,215,255,%A%)' }, time);
    },
  },
};

export function getInterior(id) { return INTERIORS[id] || null; }
