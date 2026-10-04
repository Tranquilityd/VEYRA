// Veyra — Phase 5: the VEYRA ARCADE exterior (dedicated venue painter).
// Deliberately unlike the casino: graphite metal + cyan/magenta neon, an angular
// tower with an antenna, pixel-LED "ARCADE" lettering, a slanted polycarbonate
// canopy, a cabinet-lit storefront, vending machines and geometric planters.
// bakeArcade() renders static architecture once; liveArcade() animates neon.
import { makeCanvas, mulberry32, roundRectPath } from '../core/util.js';

const memo = new Map();

// 5x7 pixel glyphs for the LED marquee
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
};

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amt));
  const b = Math.min(255, Math.max(0, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

// shared geometry — bake and live must agree
function layout(def) {
  const wR = def.w, fH = def.facadeH;
  const padX = 110, padTop = 285, padBot = 96;
  const W = wR + padX * 2, H = padTop + fH + padBot;
  const ax = W / 2, ay = padTop + fH;            // ay = 615 ground line
  const L = padX, R = padX + wR;                 // 110..630
  const y0 = padTop;                             // 285 facade top
  const sign = { x: 196, y: 292, w: 348, h: 82 };
  const cell = 9, gap = 12;
  const letters = [];
  const word = 'ARCADE';
  const lw = word.length * (5 * cell) + (word.length - 1) * gap;   // 330
  for (let i = 0; i < word.length; i++) {
    letters.push({ ch: word[i], x: ax - lw / 2 + i * (5 * cell + gap), y: 300, w: 5 * cell, h: 7 * cell });
  }
  const opening = { x: 196, y: 482, w: 108, h: ay - 482 };        // door opening
  const recess = { x: 190, y: 424, w: 120, h: ay - 424 };
  const canopy = { x1: 168, y1: 438, x2: 332, y2: 448, t: 12 };   // slanted slab
  const store = { x: 330, y: 440, w: 270, h: 160 };               // storefront glass
  const tower = { x: 130, top: 190, w: 140, slopeL: 214 };
  const vending = [{ x: 336 }, { x: 380 }];
  const gamepad = { cx: 200, cy: 240 };
  const blade = { x: 598, y: 380, w: 34, h: 172 };
  return { W, H, ax, ay, L, R, y0, sign, letters, cell, opening, recess, canopy, store, tower, vending, gamepad, blade, wR, fH };
}

function pixelText(ctx, chars, x, y, cell, color) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of chars) {
    const g = GLYPHS[ch];
    if (g) for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (g[r][c] === '1') ctx.fillRect(cx + c * cell, y + r * cell, cell - 1, cell - 1);
    }
    cx += 6 * cell;
  }
}

export function bakeArcade(def) {
  const hit = memo.get(def.id);
  if (hit) return hit;
  const G = layout(def);
  const { W, H, ax, ay, L, R, y0, sign, opening, recess, canopy, store, tower } = G;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(777);
  const METAL = '#262a33', METAL_D = '#1b1e26', METAL_L = '#343a46', CY = '#35e0ff', MG = '#ff4fd8';

  // ---- ground shadow ----
  let g = ctx.createLinearGradient(0, ay - 6, 0, ay + 40);
  g.addColorStop(0, 'rgba(20,24,40,0.34)'); g.addColorStop(1, 'rgba(20,24,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(L - 14, ay - 6, G.wR + 84, 44);

  // ---- main parapet + merlons (right wing) ----
  ctx.fillStyle = METAL_L; ctx.fillRect(L - 6, y0 - 15, G.wR + 12, 15);
  ctx.fillStyle = '#4a5160'; ctx.fillRect(L - 6, y0 - 18, G.wR + 12, 4);
  for (let i = 0; i < 5; i++) {
    const mx = 496 + i * 32;
    ctx.fillStyle = METAL_L; ctx.fillRect(mx, y0 - 32, 18, 15);
    ctx.fillStyle = '#4a5160'; ctx.fillRect(mx, y0 - 34, 18, 3);
  }

  // ---- angular tower (left) ----
  ctx.beginPath();
  ctx.moveTo(tower.x, tower.slopeL); ctx.lineTo(tower.x + tower.w, tower.top);
  ctx.lineTo(tower.x + tower.w, y0); ctx.lineTo(tower.x, y0); ctx.closePath();
  g = ctx.createLinearGradient(tower.x, 0, tower.x + tower.w, 0);
  g.addColorStop(0, shade(METAL, 14)); g.addColorStop(1, METAL_D);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = CY; ctx.lineWidth = 3;                     // neon cap along the slope (base; glows live)
  ctx.beginPath(); ctx.moveTo(tower.x - 4, tower.slopeL + 2); ctx.lineTo(tower.x + tower.w + 4, tower.top - 1); ctx.stroke();
  // antenna + beacon mast
  ctx.strokeStyle = '#8b93a3'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(152, tower.slopeL - 16); ctx.lineTo(152, 146); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(142, 162); ctx.lineTo(162, 162); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(145, 174); ctx.lineTo(159, 174); ctx.stroke();
  ctx.fillStyle = '#5a2230'; ctx.beginPath(); ctx.arc(152, 142, 4.5, 0, 7); ctx.fill();
  // gamepad neon plate on the tower
  ctx.fillStyle = '#14161d';
  roundRectPath(ctx, tower.x + 18, 214, 104, 62, 10); ctx.fill();

  // ---- facade body: graphite panels ----
  g = ctx.createLinearGradient(L, 0, R, 0);
  g.addColorStop(0, shade(METAL, 10)); g.addColorStop(0.5, METAL); g.addColorStop(1, METAL_D);
  ctx.fillStyle = g;
  ctx.fillRect(L, y0, G.wR, G.fH);
  // panel seams
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  for (let x = L + 40; x < R; x += 64) ctx.fillRect(x, y0, 2, ay - y0 - 66);
  ctx.fillRect(L, y0 + 147, G.wR, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let x = L + 42; x < R; x += 64) ctx.fillRect(x, y0, 2, ay - y0 - 66);
  // diagonal accent stripes (cyan + magenta) across the mid band
  ctx.save();
  ctx.beginPath(); ctx.rect(L, y0 + 100, G.wR, 42); ctx.clip();
  ctx.fillStyle = 'rgba(53,224,255,0.75)';
  ctx.beginPath(); ctx.moveTo(L - 10, y0 + 142); ctx.lineTo(R + 10, y0 + 100); ctx.lineTo(R + 10, y0 + 114); ctx.lineTo(L - 10, y0 + 156); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,79,216,0.7)';
  ctx.beginPath(); ctx.moveTo(L - 10, y0 + 158); ctx.lineTo(R + 10, y0 + 116); ctx.lineTo(R + 10, y0 + 123); ctx.lineTo(L - 10, y0 + 165); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(240,250,255,0.5)';
  ctx.beginPath(); ctx.moveTo(L - 10, y0 + 167); ctx.lineTo(R + 10, y0 + 125); ctx.lineTo(R + 10, y0 + 127.5); ctx.lineTo(L - 10, y0 + 169.5); ctx.closePath(); ctx.fill();
  ctx.restore();
  // perforated screen (left of entry)
  ctx.fillStyle = '#191c24';
  roundRectPath(ctx, 112, y0 + 155, 76, 120, 4); ctx.fill();
  ctx.fillStyle = 'rgba(120,220,255,0.35)';
  for (let yy = y0 + 163; yy < y0 + 270; yy += 10) for (let xx = 118; xx < 184; xx += 10) {
    ctx.beginPath(); ctx.arc(xx, yy, 1.7, 0, 7); ctx.fill();
  }
  g = ctx.createLinearGradient(0, y0 + 245, 0, y0 + 275);
  g.addColorStop(0, 'rgba(53,224,255,0)'); g.addColorStop(1, 'rgba(53,224,255,0.22)');
  ctx.fillStyle = g; ctx.fillRect(112, y0 + 245, 76, 30);
  // corrugated strip (right edge)
  ctx.fillStyle = '#20242e'; ctx.fillRect(604, y0 + 155, 24, 120);
  for (let xx = 606; xx < 628; xx += 5) { ctx.fillStyle = xx % 10 < 5 ? '#2c313d' : '#1a1e26'; ctx.fillRect(xx, y0 + 155, 3, 120); }

  // ---- sign band + pixel letters ----
  roundRectPath(ctx, sign.x - 6, sign.y - 6, sign.w + 12, sign.h + 12, 12);
  ctx.fillStyle = '#101319'; ctx.fill();
  roundRectPath(ctx, sign.x, sign.y, sign.w, sign.h, 8);
  g = ctx.createLinearGradient(0, sign.y, 0, sign.y + sign.h);
  g.addColorStop(0, '#181c26'); g.addColorStop(1, '#0e1117');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(53,224,255,0.55)'; ctx.lineWidth = 2.4;
  roundRectPath(ctx, sign.x + 4, sign.y + 4, sign.w - 8, sign.h - 8, 6); ctx.stroke();
  for (let i = 0; i < G.letters.length; i++) {                  // white LED cores (color glows live)
    const lt = G.letters[i];
    ctx.save();
    ctx.shadowColor = 'rgba(230,250,255,0.9)'; ctx.shadowBlur = 10;
    pixelText(ctx, lt.ch, lt.x, lt.y, G.cell, '#f2fbff');
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(140,240,255,0.75)';                     // little joystick icon in the band corner
  ctx.fillRect(sign.x + 14, sign.y + 56, 4, 14);
  ctx.beginPath(); ctx.arc(sign.x + 16, sign.y + 52, 5.5, 0, 7); ctx.fill();

  // ---- 'VEYRA' corner blade ----
  const bl = G.blade;
  roundRectPath(ctx, bl.x, bl.y, bl.w, bl.h, 8);
  ctx.fillStyle = '#120c1c'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,79,216,0.7)'; ctx.lineWidth = 2.4;
  roundRectPath(ctx, bl.x + 3, bl.y + 3, bl.w - 6, bl.h - 6, 6); ctx.stroke();
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.shadowColor = 'rgba(255,120,230,0.9)'; ctx.shadowBlur = 8;
    pixelText(ctx, 'VEYRA'[i], bl.x + 5, bl.y + 12 + i * 31, 5, '#ffd9f4');
    ctx.restore();
  }

  // ---- storefront glass with cabinet glow inside ----
  ctx.fillStyle = '#12141c'; ctx.fillRect(store.x - 5, store.y - 5, store.w + 10, store.h + 10);
  g = ctx.createLinearGradient(0, store.y, 0, store.y + store.h);
  g.addColorStop(0, '#232a4d'); g.addColorStop(0.55, '#161a30'); g.addColorStop(1, '#0e1120');
  ctx.fillStyle = g; ctx.fillRect(store.x, store.y, store.w, store.h);
  // back row of cabinets
  const cab = ['#35e0ff', '#ff4fd8', '#ffd166', '#8ff5ff', '#ff8fb0', '#7ab6ff'];
  for (let i = 0; i < 6; i++) {
    const x = store.x + 14 + i * 42;
    ctx.fillStyle = '#0c0e16'; ctx.fillRect(x, store.y + 34, 28, 52);
    ctx.fillStyle = cab[i]; ctx.globalAlpha = 0.55; ctx.fillRect(x + 5, store.y + 42, 18, 14); ctx.globalAlpha = 1;
    ctx.fillStyle = '#1c2030'; ctx.fillRect(x + 3, store.y + 62, 22, 20);
  }
  // front row (bigger, darker silhouettes)
  for (let i = 0; i < 5; i++) {
    const x = store.x + 8 + i * 52;
    ctx.fillStyle = '#0a0c13'; ctx.fillRect(x, store.y + 88, 36, 64);
    ctx.fillStyle = cab[(i + 2) % 6]; ctx.globalAlpha = 0.4; ctx.fillRect(x + 7, store.y + 97, 22, 16); ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(140,220,255,0.12)'; ctx.fillRect(x + 4, store.y + 118, 28, 30);
  }
  // floor sheen + reflections
  g = ctx.createLinearGradient(0, store.y + store.h - 26, 0, store.y + store.h);
  g.addColorStop(0, 'rgba(120,200,255,0)'); g.addColorStop(1, 'rgba(120,200,255,0.16)');
  ctx.fillStyle = g; ctx.fillRect(store.x, store.y + store.h - 26, store.w, 26);
  // coloured transom segments
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,79,216,0.4)' : 'rgba(53,224,255,0.42)';
    ctx.fillRect(store.x + 4 + i * 29, store.y + 4, 25, 14);
  }
  // mullions + sheen
  ctx.fillStyle = '#2c313d';
  for (let x = store.x; x <= store.x + store.w; x += 67) ctx.fillRect(x - 3, store.y, 6, store.h);
  ctx.fillRect(store.x, store.y + 22, store.w, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.save(); ctx.beginPath(); ctx.rect(store.x, store.y, store.w, store.h); ctx.clip();
  ctx.beginPath(); ctx.moveTo(store.x - 20, store.y + store.h); ctx.lineTo(store.x + 90, store.y); ctx.lineTo(store.x + 130, store.y);
  ctx.lineTo(store.x + 20, store.y + store.h); ctx.closePath(); ctx.fill(); ctx.restore();

  // ---- entrance recess ----
  ctx.fillStyle = '#0d1017'; ctx.fillRect(recess.x, recess.y, recess.w, recess.h);
  g = ctx.createLinearGradient(0, recess.y, 0, ay);
  g.addColorStop(0, 'rgba(90,200,255,0.3)'); g.addColorStop(1, 'rgba(40,24,80,0.4)');
  ctx.fillStyle = g; ctx.fillRect(recess.x + 4, recess.y + 4, recess.w - 8, recess.h - 8);
  // LED pixel ticker above the doors (the readable-at-the-door sign)
  ctx.save();
  ctx.shadowColor = CY; ctx.shadowBlur = 7;
  pixelText(ctx, 'ARCADE', 194, recess.y + 8, 3.2, '#eafcff');
  ctx.restore();
  // transom above doors
  ctx.fillStyle = 'rgba(140,230,255,0.5)'; ctx.fillRect(opening.x, recess.y + 34, opening.w, 16);
  ctx.fillStyle = '#2c313d';
  for (let x = opening.x; x <= opening.x + opening.w; x += 27) ctx.fillRect(x - 1.5, recess.y + 34, 3, 16);
  // door frame (LED tube base)
  ctx.strokeStyle = 'rgba(53,224,255,0.65)'; ctx.lineWidth = 3;
  ctx.strokeRect(opening.x - 3.5, opening.y - 3.5, opening.w + 7, ay - opening.y + 4);
  ctx.fillStyle = '#20242e';
  ctx.fillRect(opening.x - 8, opening.y - 8, opening.w + 16, 5);

  // ---- slanted canopy ----
  ctx.beginPath();
  ctx.moveTo(canopy.x1, canopy.y1); ctx.lineTo(canopy.x2, canopy.y2);
  ctx.lineTo(canopy.x2, canopy.y2 + canopy.t); ctx.lineTo(canopy.x1, canopy.y1 + canopy.t + 4);
  ctx.closePath();
  g = ctx.createLinearGradient(0, canopy.y1, 0, canopy.y1 + canopy.t + 4);
  g.addColorStop(0, 'rgba(225,240,250,0.5)'); g.addColorStop(1, 'rgba(140,170,200,0.35)');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = '#3a4150'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#141821';                                   // soffit
  ctx.beginPath();
  ctx.moveTo(canopy.x1 + 4, canopy.y1 + canopy.t + 4); ctx.lineTo(canopy.x2 - 4, canopy.y2 + canopy.t);
  ctx.lineTo(canopy.x2 - 4, canopy.y2 + canopy.t + 4); ctx.lineTo(canopy.x1 + 4, canopy.y1 + canopy.t + 8);
  ctx.closePath(); ctx.fill();

  // ---- TOKENS neon arrow (points at the doors) ----
  ctx.save();
  ctx.strokeStyle = 'rgba(255,209,102,0.85)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(352, 480); ctx.lineTo(330, 492); ctx.lineTo(352, 504); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(344, 468); ctx.lineTo(322, 480); ctx.lineTo(344, 492); ctx.globalAlpha = 0.5; ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.fillStyle = 'rgba(255,209,102,0.9)';
  ctx.font = '800 10px Rajdhani, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('TOKENS', 326, 516);

  // ---- base plinth ----
  g = ctx.createLinearGradient(0, ay - 14, 0, ay);
  g.addColorStop(0, '#3a4150'); g.addColorStop(1, '#232833');
  ctx.fillStyle = g; ctx.fillRect(L - 4, ay - 14, G.wR + 8, 14);
  ctx.fillStyle = CY; ctx.globalAlpha = 0.5; ctx.fillRect(L - 4, ay - 16, G.wR + 8, 2); ctx.globalAlpha = 1;

  // ---- vending machines ----
  for (let i = 0; i < 2; i++) {
    const vx = G.vending[i].x;
    ctx.fillStyle = i ? '#31183a' : '#16283c';
    roundRectPath(ctx, vx, 556, 40, 59, 3); ctx.fill();
    ctx.fillStyle = '#0c0f16'; ctx.fillRect(vx + 4, 561, 32, 34);
    for (let r = 0; r < 3; r++) for (let cc = 0; cc < 4; cc++) {  // product rows
      ctx.fillStyle = cab[(r * 4 + cc + i * 2) % 6];
      ctx.globalAlpha = 0.75; ctx.fillRect(vx + 6 + cc * 7.5, 563 + r * 11, 5.5, 8); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = i ? 'rgba(255,79,216,0.8)' : 'rgba(53,224,255,0.8)';
    ctx.fillRect(vx + 4, 599, 32, 7);                            // lightbox
    ctx.fillStyle = '#0a0d13'; ctx.fillRect(vx + 28, 599, 8, 12); // slot
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(vx, 613, 40, 3);
    ctx.fillStyle = '#10131a'; ctx.fillRect(vx + 2, 552, 36, 5);  // top cap
  }

  // ---- poster kiosk ----
  ctx.fillStyle = '#12141c'; roundRectPath(ctx, 126, 552, 48, 63, 3); ctx.fill();
  ctx.fillStyle = '#0a1a2c'; ctx.fillRect(130, 560, 40, 48);     // poster art: pixel ship + sun
  ctx.fillStyle = MG; ctx.beginPath(); ctx.arc(160, 570, 7, 0, 7); ctx.fill();
  ctx.fillStyle = CY;
  ctx.fillRect(136, 588, 18, 4); ctx.fillRect(142, 582, 6, 16); ctx.fillRect(138, 592, 4, 6); ctx.fillRect(150, 592, 4, 6);
  ctx.fillStyle = '#ffd166'; for (let i = 0; i < 6; i++) ctx.fillRect(132 + rnd() * 34, 562 + rnd() * 20, 1.6, 1.6);
  ctx.fillStyle = 'rgba(140,230,255,0.85)'; ctx.fillRect(128, 554, 44, 4); // top lightbox
  ctx.fillStyle = '#20242e'; ctx.fillRect(146, 608, 8, 7);

  // ---- bin ----
  ctx.fillStyle = '#1a1e26'; roundRectPath(ctx, 436, 592, 16, 23, 3); ctx.fill();
  ctx.fillStyle = CY; ctx.globalAlpha = 0.6; ctx.fillRect(436, 598, 16, 2); ctx.globalAlpha = 1;

  // ---- entry walkway + neon inlays ----
  g = ctx.createLinearGradient(0, ay, 0, ay + 40);
  g.addColorStop(0, '#4b5160'); g.addColorStop(1, '#3a404e');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(recess.x - 6, ay); ctx.lineTo(recess.x + recess.w + 6, ay);
  ctx.lineTo(recess.x + recess.w + 16, ay + 40); ctx.lineTo(recess.x - 16, ay + 40);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(53,224,255,0.5)';                        // inlay lines
  ctx.fillRect(206, ay + 2, 3, 36); ctx.fillRect(291, ay + 2, 3, 36);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';                       // decal chevrons
  for (const yy of [ay + 14, ay + 28]) {
    const cxw = recess.x + recess.w / 2;
    ctx.beginPath(); ctx.moveTo(cxw - 14, yy + 7); ctx.lineTo(cxw, yy); ctx.lineTo(cxw + 14, yy + 7);
    ctx.lineTo(cxw, yy + 4); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#2a2f3a'; ctx.fillRect(recess.x - 6, ay - 4, recess.w + 12, 4); // threshold base (glows live)

  // ---- geometric planters ----
  ctx.beginPath();                                             // angled slab planter (left)
  ctx.moveTo(118, 656); ctx.lineTo(126, 624); ctx.lineTo(176, 624); ctx.lineTo(170, 656); ctx.closePath();
  g = ctx.createLinearGradient(0, 624, 0, 656);
  g.addColorStop(0, '#565d6c'); g.addColorStop(1, '#3c4250');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = MG; ctx.lineWidth = 2; ctx.globalAlpha = 0.65;
  ctx.beginPath(); ctx.moveTo(126, 626); ctx.lineTo(176, 626); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.strokeStyle = '#4f8a4a'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {                                 // grasses
    const gx = 132 + i * 5, lean = (rnd() - 0.5) * 12;
    ctx.beginPath(); ctx.moveTo(gx, 626); ctx.quadraticCurveTo(gx + lean * 0.5, 612, gx + lean, 600 + rnd() * 8); ctx.stroke();
  }
  ctx.lineCap = 'butt';
  // hex planters with topiary (right)
  for (const [hx, hr] of [[486, 12], [514, 10], [540, 12]]) {
    ctx.fillStyle = '#414857';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const px = hx + Math.cos(a) * 20, py = 640 + Math.sin(a) * 12;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(53,224,255,0.5)'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = '#5d4a36'; ctx.fillRect(hx - 2, 628 - hr, 4, hr + 6);
    ctx.fillStyle = '#2f6b36'; ctx.beginPath(); ctx.arc(hx, 622 - hr, hr, 0, 7); ctx.fill();
    ctx.fillStyle = '#3d8544'; ctx.beginPath(); ctx.arc(hx - hr * 0.3, 619 - hr, hr * 0.6, 0, 7); ctx.fill();
  }
  // gravel strip with glowing pebbles
  ctx.fillStyle = '#2b2f3a'; ctx.fillRect(556, 624, 68, 26);
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(53,224,255,0.5)' : 'rgba(255,79,216,0.45)';
    ctx.beginPath(); ctx.arc(560 + rnd() * 60, 628 + rnd() * 18, 1.8, 0, 7); ctx.fill();
  }

  // ---- AO + baked glow pools ----
  g = ctx.createLinearGradient(0, ay - 10, 0, ay + 8);
  g.addColorStop(0, 'rgba(10,14,26,0)'); g.addColorStop(1, 'rgba(10,14,26,0.32)');
  ctx.fillStyle = g; ctx.fillRect(L - 4, ay - 10, G.wR + 8, 14);
  g = ctx.createRadialGradient(250, ay + 18, 6, 250, ay + 18, 90);
  g.addColorStop(0, 'rgba(120,220,255,0.16)'); g.addColorStop(1, 'rgba(120,220,255,0)');
  ctx.fillStyle = g; ctx.fillRect(150, ay - 6, 200, 70);

  const sprite = { canvas: c, ax: G.ax, ay: G.ay };
  memo.set(def.id, sprite);
  return sprite;
}

// ---- animated neon layer ----
export function liveArcade(ctx, v, time) {
  const G = layout(v.def);
  const d = v.doorOpen;
  const flick = 0.86 + 0.14 * Math.sin(time * 9.1) * Math.sin(time * 2.3);
  ctx.save();
  ctx.translate(v.x - G.ax, v.y - G.ay);
  ctx.globalCompositeOperation = 'lighter';

  // pixel-letter colour cycle
  for (let i = 0; i < G.letters.length; i++) {
    const lt = G.letters[i];
    const hue = (time * 55 + i * 48) % 360;
    ctx.fillStyle = `hsla(${hue.toFixed(0)},100%,62%,0.30)`;
    ctx.fillRect(lt.x - 3, lt.y - 3, lt.w + 6, lt.h + 6);
    ctx.fillStyle = `hsla(${hue.toFixed(0)},100%,70%,0.16)`;
    ctx.fillRect(lt.x - 9, lt.y - 9, lt.w + 18, lt.h + 18);
  }
  // sign band border pulse
  ctx.strokeStyle = `rgba(53,224,255,${(0.35 + 0.2 * Math.sin(time * 2.4)).toFixed(3)})`;
  ctx.lineWidth = 2.4;
  roundRectPath(ctx, G.sign.x + 4, G.sign.y + 4, G.sign.w - 8, G.sign.h - 8, 6); ctx.stroke();

  // parapet + tower-slope neon tubes
  ctx.strokeStyle = `rgba(53,224,255,${(0.5 * flick).toFixed(3)})`;
  ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(G.L - 6, G.y0 - 16); ctx.lineTo(G.R + 6, G.y0 - 16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(G.tower.x - 4, G.tower.slopeL + 2); ctx.lineTo(G.tower.x + G.tower.w + 4, G.tower.top - 1); ctx.stroke();
  ctx.strokeStyle = `rgba(53,224,255,${(0.16 * flick).toFixed(3)})`;
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(G.L - 6, G.y0 - 16); ctx.lineTo(G.R + 6, G.y0 - 16); ctx.stroke();

  // antenna beacon
  const beacon = (time % 1.2) < 0.28 ? 0.75 : 0.12;
  let g = ctx.createRadialGradient(152, 142, 1, 152, 142, 16);
  g.addColorStop(0, `rgba(255,90,90,${beacon})`); g.addColorStop(1, 'rgba(255,90,90,0)');
  ctx.fillStyle = g; ctx.fillRect(136, 126, 32, 32);

  // gamepad neon — cyan→magenta crossfade
  const s = (Math.sin(time * 0.7) + 1) / 2;
  const hue = 187 + (315 - 187) * s;
  const gp = G.gamepad;
  ctx.strokeStyle = `hsla(${hue.toFixed(0)},100%,66%,0.85)`;
  ctx.lineWidth = 2.6;
  roundRectPath(ctx, gp.cx - 28, gp.cy - 15, 56, 30, 12); ctx.stroke();
  ctx.beginPath();                                            // dpad
  ctx.moveTo(gp.cx - 16, gp.cy - 6); ctx.lineTo(gp.cx - 4, gp.cy - 6);
  ctx.moveTo(gp.cx - 10, gp.cy - 12); ctx.lineTo(gp.cx - 10, gp.cy);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(gp.cx + 9, gp.cy - 4, 2.6, 0, 7); ctx.stroke();   // buttons
  ctx.beginPath(); ctx.arc(gp.cx + 17, gp.cy + 3, 2.6, 0, 7); ctx.stroke();
  ctx.strokeStyle = `hsla(${hue.toFixed(0)},100%,60%,0.22)`;
  ctx.lineWidth = 8;
  roundRectPath(ctx, gp.cx - 28, gp.cy - 15, 56, 30, 12); ctx.stroke();

  // VEYRA blade pulse
  ctx.strokeStyle = `rgba(255,79,216,${(0.35 + 0.3 * Math.sin(time * 2 + 1)).toFixed(3)})`;
  ctx.lineWidth = 2.4;
  roundRectPath(ctx, G.blade.x + 3, G.blade.y + 3, G.blade.w - 6, G.blade.h - 6, 6); ctx.stroke();

  // canopy LED chase
  const run = (time * 0.35) % 1;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = G.canopy.x1 + 6 + t * (G.canopy.x2 - G.canopy.x1 - 12);
    const y = G.canopy.y1 + G.canopy.t + 5 + t * (G.canopy.y2 - G.canopy.y1);
    const near = Math.abs(t - run);
    const a = 0.18 + 0.65 * Math.max(0, 1 - near * 6);
    ctx.fillStyle = `rgba(140,240,255,${a.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill();
  }

  // TOKENS arrow blink
  if ((time % 1.6) < 1.05) {
    ctx.strokeStyle = 'rgba(255,209,102,0.55)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(352, 480); ctx.lineTo(330, 492); ctx.lineTo(352, 504); ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // vending machine flicker
  for (let i = 0; i < 2; i++) {
    const vx = G.vending[i].x;
    const a = 0.1 + 0.08 * Math.sin(time * (7 + i * 3) + i * 2.2);
    ctx.fillStyle = i ? `rgba(255,79,216,${a.toFixed(3)})` : `rgba(53,224,255,${a.toFixed(3)})`;
    ctx.fillRect(vx + 4, 561, 32, 34);
  }

  // storefront breathing glow
  ctx.fillStyle = `rgba(110,200,255,${(0.035 + 0.025 * Math.sin(time * 1.4)).toFixed(3)})`;
  ctx.fillRect(G.store.x, G.store.y, G.store.w, G.store.h);

  // threshold strip + inlays brighten toward night-open
  const ta = 0.3 + 0.18 * Math.sin(time * 2.2) + 0.4 * d;
  ctx.fillStyle = `rgba(53,224,255,${ta.toFixed(3)})`;
  ctx.fillRect(G.recess.x - 6, G.ay - 4, G.recess.w + 12, 4);
  ctx.fillStyle = `rgba(255,79,216,${(ta * 0.7).toFixed(3)})`;
  ctx.fillRect(206, G.ay + 2, 3, 36); ctx.fillRect(291, G.ay + 2, 3, 36);

  // ---- sliding doors + neon spill ----
  const o = G.opening;
  const halfW = o.w / 2;
  g = ctx.createLinearGradient(0, o.y, 0, G.ay);
  g.addColorStop(0, `rgba(120,220,255,${(0.14 + 0.4 * d).toFixed(3)})`);
  g.addColorStop(1, `rgba(255,79,216,${(0.08 + 0.3 * d).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(o.x, o.y, o.w, G.ay - o.y);
  ctx.globalCompositeOperation = 'source-over';
  for (const sd of [-1, 1]) {
    const lx = sd < 0 ? o.x - 46 * d : o.x + halfW + 46 * d;
    ctx.save();
    ctx.beginPath(); ctx.rect(o.x - 8, o.y, o.w + 16, G.ay - o.y); ctx.clip();
    g = ctx.createLinearGradient(0, o.y, 0, G.ay);
    g.addColorStop(0, 'rgba(190,235,255,0.4)'); g.addColorStop(0.7, 'rgba(140,180,230,0.28)'); g.addColorStop(1, 'rgba(110,140,200,0.34)');
    ctx.fillStyle = g;
    ctx.fillRect(lx, o.y, halfW, G.ay - o.y);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath(); ctx.moveTo(lx + 4, G.ay); ctx.lineTo(lx + halfW * 0.5, o.y + 4); ctx.lineTo(lx + halfW * 0.66, o.y + 4);
    ctx.lineTo(lx + halfW * 0.18, G.ay); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#35e0ff'; ctx.lineWidth = 2.2;
    ctx.strokeRect(lx + 1, o.y + 1, halfW - 2, G.ay - o.y - 2);
    ctx.fillStyle = '#bff4ff';
    ctx.fillRect(sd < 0 ? lx + halfW - 7 : lx + 3, o.y + 36, 3.4, 36);
    ctx.restore();
  }
  // frame tubes over the leaf edges
  ctx.strokeStyle = `rgba(53,224,255,${(0.7 + 0.25 * Math.sin(time * 3)).toFixed(3)})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(o.x - 3.5, G.ay); ctx.lineTo(o.x - 3.5, o.y - 3.5); ctx.lineTo(o.x + o.w + 3.5, o.y - 3.5); ctx.lineTo(o.x + o.w + 3.5, G.ay);
  ctx.stroke();
  if (d > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    g = ctx.createLinearGradient(0, G.ay - 10, 0, G.ay + 46);
    g.addColorStop(0, `rgba(120,220,255,${(0.38 * d).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,79,216,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(o.x + 4, G.ay - 6); ctx.lineTo(o.x + o.w - 4, G.ay - 6);
    ctx.lineTo(o.x + o.w + 34, G.ay + 46); ctx.lineTo(o.x - 34, G.ay + 46);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
