// Veyra — Phase 5: the VEYRA CASINO exterior (dedicated venue painter).
// bakeCasino() renders the static architecture once into a sprite; liveCasino()
// draws the animated layer (marquee bulb chase, sign glow, soffit downlights,
// sconces, uplight wash, sliding entrance doors + light spill) every frame.
// Local sprite space: ax = W/2, ay = ground/front line.
import { makeCanvas, mulberry32, roundRectPath } from '../core/util.js';

const memo = new Map();

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amt));
  const b = Math.min(255, Math.max(0, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

// shared geometry — bake and live must agree
function layout(def) {
  const wR = def.w, fH = def.facadeH, rD = def.roofD;
  const padX = 110, padTop = 180, padBot = 96;
  const W = wR + padX * 2, H = padTop + rD + fH + padBot;
  const ax = W / 2, ay = padTop + rD + fH;
  const L = padX, R = padX + wR;
  const roofTop = padTop;            // 180
  const y0 = padTop + rD;            // 285 facade top
  const sign = { x: 190, y: 46, w: 360, h: 110 };
  const opening = { x: 312, y: 514, w: 116, h: ay - 514 };
  const canopy = { x: 230, y: 466, w: 280, h: 28 };
  // marquee bulbs around the sign perimeter
  const bulbs = [];
  for (let x = sign.x + 12; x <= sign.x + sign.w - 12; x += 20) {
    bulbs.push({ x, y: sign.y + 5 }); bulbs.push({ x, y: sign.y + sign.h - 5 });
  }
  for (let y = sign.y + 20; y <= sign.y + sign.h - 20; y += 22) {
    bulbs.push({ x: sign.x + 5, y }); bulbs.push({ x: sign.x + sign.w - 5, y });
  }
  // wing window grid (rows x cols), deterministic lit set + glow phases
  const wins = [];
  const rnd = mulberry32(9081);
  const cols = 4, rows = 3;
  for (const side of [0, 1]) {
    const x0 = side ? 498 : 122;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      wins.push({ x: x0 + c * 31, y: 318 + r * 74, w: 24, h: 44, lit: rnd() < 0.34, ph: rnd() * 6.28 });
    }
  }
  const soffit = [256, 312, 370, 428, 484].map((x) => ({ x, y: canopy.y + canopy.h }));
  const uplights = [150, 236, 504, 590];
  return { W, H, ax, ay, L, R, roofTop, y0, sign, opening, canopy, bulbs, wins, soffit, uplights, wR, fH, rD };
}

function pane(ctx, x, y, w, h, lit, glass) {
  ctx.fillStyle = '#1a1418';
  ctx.fillRect(x - 2.5, y - 2.5, w + 5, h + 5);
  if (lit) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#ffe2a1'); g.addColorStop(1, '#efa24a');
    ctx.fillStyle = g;
  } else {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, shade(glass, 30)); g.addColorStop(0.55, glass); g.addColorStop(1, shade(glass, -38));
    ctx.fillStyle = g;
  }
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.moveTo(x - h * 0.3, y + h); ctx.lineTo(x + w * 0.4, y); ctx.lineTo(x + w * 0.62, y);
  ctx.lineTo(x - h * 0.3 + w * 0.22, y + h); ctx.closePath(); ctx.fill();
  ctx.restore();
  if (lit) { ctx.fillStyle = 'rgba(255,190,100,0.15)'; ctx.fillRect(x - 5, y - 5, w + 10, h + 10); }
}

export function bakeCasino(def) {
  const hit = memo.get(def.id);
  if (hit) return hit;
  const G = layout(def);
  const { W, H, ax, ay, L, R, roofTop, y0, sign, opening, canopy } = G;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(4242);
  const WALL = '#5a1f2b', WALL_D = '#431620', STONE = '#cbb491', STONE_D = '#a98f6c', GOLD = '#d9a441', GOLD_L = '#f0cd82';

  // ---- ground shadow (golden hour, long to the right) ----
  let g = ctx.createLinearGradient(0, ay - 6, 0, ay + 40);
  g.addColorStop(0, 'rgba(30,18,40,0.34)'); g.addColorStop(1, 'rgba(30,18,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(L - 16, ay - 6, G.wR + 90, 46);
  ctx.fillStyle = 'rgba(30,18,40,0.18)';
  ctx.fillRect(R - 8, ay - G.fH * 0.3, 40, G.fH * 0.3 + 10);

  // ---- roof slab + parapet ----
  g = ctx.createLinearGradient(0, roofTop, 0, y0);
  g.addColorStop(0, '#7d7f86'); g.addColorStop(1, '#5f6167');
  ctx.fillStyle = g;
  ctx.fillRect(L, roofTop, G.wR, G.rD);
  ctx.fillStyle = '#565a60';                                   // roof units
  ctx.fillRect(L + 90, roofTop + 26, 54, 30);
  ctx.fillStyle = '#6b6f76'; ctx.fillRect(L + 90, roofTop + 26, 54, 9);
  ctx.fillStyle = '#4d5157';
  ctx.beginPath(); ctx.arc(R - 120, roofTop + 52, 13, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(R - 84, roofTop + 66, 9, 0, 7); ctx.fill();
  ctx.fillStyle = '#8b8f96';                                   // parapet cap
  ctx.fillRect(L - 8, roofTop - 8, G.wR + 16, 12);
  ctx.fillStyle = GOLD; ctx.fillRect(L - 8, roofTop - 10, G.wR + 16, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(L - 8, roofTop + 4, G.wR + 16, 4);
  // flag poles
  for (const fx of [L + 26, R - 26]) {
    ctx.strokeStyle = '#c8ccd2'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(fx, roofTop - 8); ctx.lineTo(fx, roofTop - 74); ctx.stroke();
    ctx.fillStyle = fx < ax ? '#7d1f2e' : GOLD;
    ctx.beginPath(); ctx.moveTo(fx, roofTop - 74); ctx.lineTo(fx + 30, roofTop - 66); ctx.lineTo(fx, roofTop - 56); ctx.closePath(); ctx.fill();
    ctx.fillStyle = GOLD_L; ctx.beginPath(); ctx.arc(fx, roofTop - 76, 2.6, 0, 7); ctx.fill();
  }

  // ---- roof marquee sign ----
  ctx.fillStyle = '#3a3d44';                                   // struts
  ctx.fillRect(sign.x + 60, sign.y + sign.h, 12, roofTop - sign.y - sign.h - 6);
  ctx.fillRect(sign.x + sign.w - 72, sign.y + sign.h, 12, roofTop - sign.y - sign.h - 6);
  roundRectPath(ctx, sign.x - 6, sign.y - 6, sign.w + 12, sign.h + 12, 12);
  ctx.fillStyle = '#241219'; ctx.fill();
  ctx.save();
  ctx.shadowColor = 'rgba(255,200,110,0.55)'; ctx.shadowBlur = 24;
  roundRectPath(ctx, sign.x, sign.y, sign.w, sign.h, 8);
  g = ctx.createLinearGradient(0, sign.y, 0, sign.y + sign.h);
  g.addColorStop(0, '#4a1420'); g.addColorStop(0.5, '#360e18'); g.addColorStop(1, '#2a0b13');
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 4;
  roundRectPath(ctx, sign.x, sign.y, sign.w, sign.h, 8); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,232,170,0.5)'; ctx.lineWidth = 1.6;
  roundRectPath(ctx, sign.x + 8, sign.y + 8, sign.w - 16, sign.h - 16, 6); ctx.stroke();
  // bulb sockets (bulbs themselves glow live)
  ctx.fillStyle = '#6b5a3a';
  for (const b of G.bulbs) { ctx.beginPath(); ctx.arc(b.x, b.y, 3.4, 0, 7); ctx.fill(); }
  // crown glyph + name
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.save();
  ctx.shadowColor = 'rgba(255,214,120,0.9)'; ctx.shadowBlur = 16;
  ctx.fillStyle = GOLD_L;
  const cx0 = sign.x + 52, cy0 = sign.y + sign.h / 2;
  ctx.beginPath();
  ctx.moveTo(cx0 - 17, cy0 + 11); ctx.lineTo(cx0 - 17, cy0 - 9); ctx.lineTo(cx0 - 8.5, cy0 + 1);
  ctx.lineTo(cx0, cy0 - 13); ctx.lineTo(cx0 + 8.5, cy0 + 1); ctx.lineTo(cx0 + 17, cy0 - 9);
  ctx.lineTo(cx0 + 17, cy0 + 11); ctx.closePath(); ctx.fill();
  ctx.font = '900 52px system-ui, sans-serif';
  ctx.fillStyle = '#ffe9b8';
  ctx.fillText('VEYRA', ax + 24, cy0 - 17);
  ctx.font = '900 30px system-ui, sans-serif';
  ctx.fillStyle = GOLD_L;
  ctx.fillText('C A S I N O', ax + 24, cy0 + 22);
  ctx.restore();
  // finial diamond above the sign
  ctx.save();
  ctx.shadowColor = 'rgba(255,220,140,0.8)'; ctx.shadowBlur = 14;
  ctx.fillStyle = GOLD_L;
  ctx.beginPath(); ctx.moveTo(ax, sign.y - 30); ctx.lineTo(ax + 13, sign.y - 14); ctx.lineTo(ax, sign.y - 2); ctx.lineTo(ax - 13, sign.y - 14); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#8b8f96'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(ax, sign.y - 2); ctx.lineTo(ax, sign.y); ctx.stroke();

  // ---- facade body: garnet stone with champagne bands ----
  g = ctx.createLinearGradient(L, 0, R, 0);
  g.addColorStop(0, shade(WALL, 16)); g.addColorStop(0.5, WALL); g.addColorStop(1, WALL_D);
  ctx.fillStyle = g;
  ctx.fillRect(L, y0, G.wR, G.fH);
  // central projecting bay
  g = ctx.createLinearGradient(250, 0, 490, 0);
  g.addColorStop(0, shade(WALL, 24)); g.addColorStop(0.55, shade(WALL, 10)); g.addColorStop(1, shade(WALL, -6));
  ctx.fillStyle = g;
  ctx.fillRect(250, y0 - 6, 240, G.fH + 6);
  // stone quoins on bay corners
  ctx.fillStyle = STONE;
  for (let y = y0; y < ay - 60; y += 26) { ctx.fillRect(246, y, 10, 18); ctx.fillRect(484, y, 10, 18); }
  // cornice (gold-capped)
  ctx.fillStyle = STONE; ctx.fillRect(L - 6, y0 - 6, G.wR + 12, 14);
  ctx.fillStyle = GOLD; ctx.fillRect(L - 6, y0 - 9, G.wR + 12, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(L - 6, y0 - 5, G.wR + 12, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.24)'; ctx.fillRect(L - 6, y0 + 8, G.wR + 12, 4);
  // champagne horizontal banding
  ctx.fillStyle = 'rgba(203,180,145,0.5)';
  ctx.fillRect(L, 428, G.wR, 7);
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(L, 435, G.wR, 3);
  // gold pilasters (decorative fins)
  for (const px of [L + 2, 240, 250, 486, 496, R - 10]) {
    g = ctx.createLinearGradient(px, 0, px + 8, 0);
    g.addColorStop(0, GOLD_L); g.addColorStop(0.5, GOLD); g.addColorStop(1, '#9c7228');
    ctx.fillStyle = g;
    ctx.fillRect(px, y0 + 10, 8, 418);
    ctx.fillStyle = GOLD_L; ctx.fillRect(px - 2, y0 + 6, 12, 6); ctx.fillRect(px - 2, 424, 12, 8);
  }
  // diamond motifs on the bay lintel
  ctx.fillStyle = GOLD;
  for (const dx of [310, 370, 430]) {
    ctx.beginPath(); ctx.moveTo(dx, y0 + 14); ctx.lineTo(dx + 9, y0 + 24); ctx.lineTo(dx, y0 + 34); ctx.lineTo(dx - 9, y0 + 24); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,235,180,0.65)';
  for (const dx of [310, 370, 430]) {
    ctx.beginPath(); ctx.moveTo(dx, y0 + 17); ctx.lineTo(dx + 5, y0 + 24); ctx.lineTo(dx, y0 + 31); ctx.lineTo(dx - 5, y0 + 24); ctx.closePath(); ctx.fill();
  }

  // ---- wing windows ----
  for (const w of G.wins) pane(ctx, w.x, w.y, w.w, w.h, w.lit, '#b98f9a');
  // frosted ground-floor slots along wings
  for (const sx of [126, 178, 512, 564]) {
    ctx.fillStyle = '#241219'; ctx.fillRect(sx - 3, 561, 52, 48);
    g = ctx.createLinearGradient(0, 564, 0, 606);
    g.addColorStop(0, 'rgba(255,222,160,0.8)'); g.addColorStop(1, 'rgba(255,180,90,0.35)');
    ctx.fillStyle = g; ctx.fillRect(sx, 564, 46, 42);
    ctx.fillStyle = 'rgba(40,20,26,0.75)'; ctx.fillRect(sx + 21, 564, 4, 42);
  }

  // ---- central glass curtain wall (lobby glow behind) ----
  const cw = { x: 262, y: 344, w: 216, h: 128 };
  ctx.fillStyle = '#1c1216'; ctx.fillRect(cw.x - 4, cw.y - 4, cw.w + 8, cw.h + 8);
  g = ctx.createLinearGradient(0, cw.y, 0, cw.y + cw.h);
  g.addColorStop(0, 'rgba(255,214,150,0.5)'); g.addColorStop(0.6, 'rgba(190,120,90,0.42)'); g.addColorStop(1, 'rgba(120,70,60,0.5)');
  ctx.fillStyle = g; ctx.fillRect(cw.x, cw.y, cw.w, cw.h);
  // chandelier hint inside
  ctx.fillStyle = 'rgba(255,236,190,0.75)';
  ctx.beginPath(); ctx.arc(370, cw.y + 30, 7, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(344, cw.y + 42, 4, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(396, cw.y + 42, 4, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,236,190,0.4)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(370, cw.y); ctx.lineTo(370, cw.y + 23); ctx.stroke();
  // gold mullions
  ctx.fillStyle = 'rgba(217,164,65,0.85)';
  for (let x = cw.x; x <= cw.x + cw.w; x += 36) ctx.fillRect(x - 1.5, cw.y, 3, cw.h);
  ctx.fillRect(cw.x, cw.y + cw.h / 2 - 1.5, cw.w, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';                  // sheen
  ctx.save(); ctx.beginPath(); ctx.rect(cw.x, cw.y, cw.w, cw.h); ctx.clip();
  ctx.beginPath(); ctx.moveTo(cw.x - 30, cw.y + cw.h); ctx.lineTo(cw.x + 70, cw.y); ctx.lineTo(cw.x + 110, cw.y);
  ctx.lineTo(cw.x + 10, cw.y + cw.h); ctx.closePath(); ctx.fill(); ctx.restore();

  // ---- podium / base ----
  g = ctx.createLinearGradient(0, 548, 0, ay);
  g.addColorStop(0, STONE); g.addColorStop(1, STONE_D);
  ctx.fillStyle = g;
  ctx.fillRect(L - 4, 548, G.wR + 8, ay - 548);
  ctx.fillStyle = GOLD; ctx.fillRect(L - 4, 546, G.wR + 8, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';                          // stone joints
  for (let x = L + 20; x < R - 10; x += 46) ctx.fillRect(x, 556, 2, ay - 560);
  ctx.fillRect(L - 4, 584, G.wR + 8, 2);

  // gold columns
  for (const px of [canopy.x + 20, canopy.x + canopy.w - 28]) {
    g = ctx.createLinearGradient(px, 0, px + 8, 0);
    g.addColorStop(0, GOLD_L); g.addColorStop(0.5, GOLD); g.addColorStop(1, '#8a6420');
    ctx.fillStyle = g; ctx.fillRect(px, canopy.y + canopy.h + 4, 8, 548 - canopy.y - canopy.h - 2);
    ctx.fillStyle = GOLD_L; ctx.fillRect(px - 3, 544, 14, 6);
  }

  // ---- entrance recess + transom + frame ----
  ctx.fillStyle = '#221016';
  ctx.fillRect(opening.x - 12, 486, opening.w + 24, ay - 486);
  g = ctx.createLinearGradient(0, 490, 0, ay);
  g.addColorStop(0, 'rgba(255,206,140,0.5)'); g.addColorStop(1, 'rgba(120,64,50,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(opening.x, 490, opening.w, ay - 494);
  // transom glass above the doors
  ctx.fillStyle = 'rgba(255,226,170,0.6)'; ctx.fillRect(opening.x, 492, opening.w, 20);
  ctx.fillStyle = GOLD; for (let x = opening.x; x <= opening.x + opening.w; x += 23) ctx.fillRect(x - 1, 492, 2.4, 20);
  ctx.fillRect(opening.x - 2, 512, opening.w + 4, 3);
  // gold frame + jambs
  ctx.fillStyle = GOLD;
  ctx.fillRect(opening.x - 12, 486, opening.w + 24, 5);
  ctx.fillRect(opening.x - 12, 486, 12, ay - 486);
  ctx.fillRect(opening.x + opening.w, 486, 12, ay - 486);
  ctx.fillStyle = 'rgba(255,240,200,0.55)';
  ctx.fillRect(opening.x - 12, 486, 3, ay - 486); ctx.fillRect(opening.x + opening.w + 9, 486, 3, ay - 486);
  // sconce fixtures beside the doors
  for (const sx of [opening.x - 26, opening.x + opening.w + 18]) {
    ctx.fillStyle = '#2c1a10'; ctx.fillRect(sx, 528, 8, 14);
    ctx.fillStyle = GOLD; ctx.fillRect(sx - 2, 524, 12, 5);
    ctx.fillStyle = '#ffe6ac'; ctx.beginPath(); ctx.arc(sx + 4, 522, 4.6, 0, 7); ctx.fill();
  }
  // OPEN 24H plaque
  roundRectPath(ctx, 436, 556, 42, 16, 3);
  ctx.fillStyle = '#2a0d14'; ctx.fill();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1.4; roundRectPath(ctx, 436, 556, 42, 16, 3); ctx.stroke();
  ctx.fillStyle = '#ffd98a'; ctx.font = '700 8px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('OPEN 24H', 457, 564);
  // doormat
  ctx.fillStyle = '#5c1f26'; ctx.fillRect(opening.x + 4, ay - 8, opening.w - 8, 8);
  ctx.fillStyle = GOLD; ctx.fillRect(opening.x + 4, ay - 8, opening.w - 8, 1.6);

  // ---- porte-cochère canopy with entrance-level signage (drawn over the frame) ----
  g = ctx.createLinearGradient(0, canopy.y, 0, canopy.y + 10);
  g.addColorStop(0, '#e8dcc0'); g.addColorStop(1, '#b7a37f');
  ctx.fillStyle = g;
  roundRectPath(ctx, canopy.x, canopy.y, canopy.w, 10, 4); ctx.fill();
  ctx.fillStyle = '#3a0e18';                                   // maroon fascia band
  ctx.fillRect(canopy.x, canopy.y + 9, canopy.w, 19);
  ctx.fillStyle = GOLD;
  ctx.fillRect(canopy.x, canopy.y + 9, canopy.w, 2);
  ctx.fillRect(canopy.x, canopy.y + 26, canopy.w, 2);
  ctx.font = '900 13px system-ui, sans-serif';                 // readable from the steps
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.save();
  ctx.shadowColor = 'rgba(255,214,120,0.85)'; ctx.shadowBlur = 8;
  ctx.fillStyle = '#ffe9b8';
  ctx.fillText('V E Y R A   C A S I N O', ax, canopy.y + 19.5);
  ctx.restore();
  ctx.fillStyle = GOLD_L;                                      // flanking diamonds
  for (const dx of [canopy.x + 26, canopy.x + canopy.w - 26]) {
    ctx.beginPath(); ctx.moveTo(dx, canopy.y + 14); ctx.lineTo(dx + 5, canopy.y + 19); ctx.lineTo(dx, canopy.y + 24); ctx.lineTo(dx - 5, canopy.y + 19); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(canopy.x + 4, canopy.y + canopy.h, canopy.w - 8, 4);
  ctx.fillStyle = '#431620';                                   // soffit
  ctx.fillRect(canopy.x + 6, canopy.y + canopy.h + 3, canopy.w - 12, 3);
  // ---- entrance stairs ----
  for (let i = 0; i < 4; i++) {
    const sw = 100 + i * 7, sy = ay + i * 10;
    g = ctx.createLinearGradient(0, sy, 0, sy + 10);
    g.addColorStop(0, '#ddd0b4'); g.addColorStop(1, '#b3a184');
    ctx.fillStyle = g;
    ctx.fillRect(ax - sw, sy, sw * 2, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(ax - sw, sy, sw * 2, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(ax - sw, sy + 8, sw * 2, 2);
  }
  // cheek walls
  ctx.fillStyle = STONE_D;
  ctx.beginPath(); ctx.moveTo(ax - 100, ay); ctx.lineTo(ax - 128, ay + 40); ctx.lineTo(ax - 128, ay + 48); ctx.lineTo(ax - 96, ay + 6); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(ax + 100, ay); ctx.lineTo(ax + 128, ay + 40); ctx.lineTo(ax + 128, ay + 48); ctx.lineTo(ax + 96, ay + 6); ctx.closePath(); ctx.fill();
  // brass handrails
  for (const s of [-1, 1]) {
    ctx.strokeStyle = '#c9a24e'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(ax + s * 104, ay - 14); ctx.lineTo(ax + s * 126, ay + 30); ctx.stroke();
    ctx.lineWidth = 2;
    for (const t of [0, 0.5, 1]) {
      const hx = ax + s * (104 + t * 22);
      ctx.beginPath(); ctx.moveTo(hx, ay - 14 + t * 44); ctx.lineTo(hx, ay - 2 + t * 40); ctx.stroke();
    }
    ctx.fillStyle = GOLD_L; ctx.beginPath(); ctx.arc(ax + s * 104, ay - 15, 3, 0, 7); ctx.fill();
  }
  // red carpet over stairs to the apron
  g = ctx.createLinearGradient(0, ay, 0, ay + 54);
  g.addColorStop(0, '#8e2436'); g.addColorStop(1, '#6d1b2a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(ax - 42, ay); ctx.lineTo(ax + 42, ay); ctx.lineTo(ax + 50, ay + 54); ctx.lineTo(ax - 50, ay + 54);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(240,205,130,0.8)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(ax - 38, ay + 1); ctx.lineTo(ax - 45, ay + 53); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ax + 38, ay + 1); ctx.lineTo(ax + 45, ay + 53); ctx.stroke();
  for (let i = 0; i < 4; i++) { ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(ax - 43 - i * 2, ay + i * 10 + 8, 86 + i * 4, 2); }

  // ---- stanchions + velvet ropes ----
  for (const s of [-1, 1]) {
    for (const [px, py] of [[ax + s * 62, ay + 40], [ax + s * 70, ay + 58]]) {
      ctx.fillStyle = GOLD; ctx.fillRect(px - 2, py - 16, 4, 16);
      ctx.fillStyle = GOLD_L; ctx.beginPath(); ctx.arc(px, py - 18, 3.4, 0, 7); ctx.fill();
      ctx.fillStyle = '#8a6420'; ctx.fillRect(px - 5, py, 10, 3);
    }
    ctx.strokeStyle = '#7d1f2e'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(ax + s * 62, ay + 26);
    ctx.quadraticCurveTo(ax + s * 66, ay + 40, ax + s * 70, ay + 42);
    ctx.stroke();
  }

  // ---- planters + topiary + palms ----
  for (const s of [-1, 1]) {
    const bx = s < 0 ? 150 : 502;
    g = ctx.createLinearGradient(0, 622, 0, 662);
    g.addColorStop(0, '#d5c6a6'); g.addColorStop(1, '#9d8b6b');
    ctx.fillStyle = g;
    roundRectPath(ctx, bx, 622, 88, 40, 4); ctx.fill();
    ctx.fillStyle = GOLD; ctx.fillRect(bx, 622, 88, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(bx + 2, 656, 84, 4);
    // clipped hedge
    ctx.fillStyle = '#2f5d33';
    roundRectPath(ctx, bx + 6, 604, 76, 22, 10); ctx.fill();
    ctx.fillStyle = '#3d7541';
    roundRectPath(ctx, bx + 10, 601, 68, 12, 6); ctx.fill();
    for (let i = 0; i < 9; i++) {                             // flowers
      ctx.fillStyle = ['#e86a8a', '#f2d14e', '#f5f2ea'][i % 3];
      ctx.beginPath(); ctx.arc(bx + 12 + i * 8, 606 + (i % 3) * 5, 2.2, 0, 7); ctx.fill();
    }
    // palm in planter
    const tx = bx + (s < 0 ? 66 : 22);
    ctx.strokeStyle = '#8a6c46'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(tx, 606); ctx.quadraticCurveTo(tx + s * 5, 578, tx + s * 8, 556); ctx.stroke();
    ctx.strokeStyle = '#77593a'; ctx.lineWidth = 2;
    for (let y = 600; y > 560; y -= 7) { ctx.beginPath(); ctx.moveTo(tx + s * 2 - 3, y); ctx.lineTo(tx + s * 6 + 3, y - 2); ctx.stroke(); }
    ctx.strokeStyle = '#2f6b36'; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i - 2.5) * 0.5;
      ctx.beginPath(); ctx.moveTo(tx + s * 8, 556);
      ctx.quadraticCurveTo(tx + s * 8 + Math.cos(a) * 20, 556 + Math.sin(a) * 20, tx + s * 8 + Math.cos(a) * 32, 556 + Math.sin(a) * 26 + 10);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
  // low hedge rows at facade ends
  ctx.fillStyle = '#2c5530';
  roundRectPath(ctx, L - 8, 606, 46, 16, 7); ctx.fill();
  roundRectPath(ctx, R - 38, 606, 46, 16, 7); ctx.fill();

  // ---- uplight fixtures + baked light pool at entrance ----
  ctx.fillStyle = '#2c2126';
  for (const ux of G.uplights) { ctx.fillRect(ux - 5, ay - 5, 10, 5); ctx.fillStyle = '#4a3a2a'; ctx.fillRect(ux - 3, ay - 7, 6, 3); ctx.fillStyle = '#2c2126'; }
  g = ctx.createRadialGradient(ax, ay + 34, 6, ax, ay + 34, 96);
  g.addColorStop(0, 'rgba(255,214,150,0.20)'); g.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = g;
  ctx.fillRect(ax - 100, ay - 6, 200, 92);
  // base AO
  g = ctx.createLinearGradient(0, ay - 10, 0, ay + 8);
  g.addColorStop(0, 'rgba(20,10,20,0)'); g.addColorStop(1, 'rgba(20,10,20,0.3)');
  ctx.fillStyle = g;
  ctx.fillRect(L - 4, ay - 10, G.wR + 8, 14);

  const sprite = { canvas: c, ax: G.ax, ay: G.ay };
  memo.set(def.id, sprite);
  return sprite;
}

// ---- animated layer: bulbs, glows, doors ----
export function liveCasino(ctx, v, time) {
  const G = layout(v.def);
  const d = v.doorOpen;
  ctx.save();
  ctx.translate(v.x - G.ax, v.y - G.ay);

  // marquee bulb chase
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < G.bulbs.length; i++) {
    const b = G.bulbs[i];
    const a = 0.28 + 0.62 * Math.max(0, Math.sin(time * 2.6 - i * 0.5));
    ctx.fillStyle = `rgba(255,226,150,${(a * 0.9).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(b.x, b.y, 2.6, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,190,110,${(a * 0.3).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(b.x, b.y, 6.5, 0, 7); ctx.fill();
  }
  // sign glow pulse + finial sparkle
  let g = ctx.createRadialGradient(G.ax, G.sign.y + 55, 20, G.ax, G.sign.y + 55, 230);
  g.addColorStop(0, `rgba(255,200,120,${(0.13 + 0.05 * Math.sin(time * 1.7)).toFixed(3)})`);
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(G.ax - 240, G.sign.y - 90, 480, 290);
  const sp = 0.5 + 0.5 * Math.sin(time * 2.2);
  ctx.fillStyle = `rgba(255,240,200,${(0.35 * sp).toFixed(3)})`;
  ctx.beginPath(); ctx.arc(G.ax, G.sign.y - 14, 8 + 5 * sp, 0, 7); ctx.fill();

  // soffit downlights under the canopy
  for (let i = 0; i < G.soffit.length; i++) {
    const s = G.soffit[i];
    const a = 0.2 + 0.07 * Math.sin(time * 2 + i * 1.3);
    g = ctx.createLinearGradient(0, s.y, 0, s.y + 74);
    g.addColorStop(0, `rgba(255,220,160,${(a + 0.25).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x + 4, s.y);
    ctx.lineTo(s.x + 20, s.y + 74); ctx.lineTo(s.x - 20, s.y + 74); ctx.closePath(); ctx.fill();
    ctx.fillStyle = `rgba(255,236,190,${(0.6 + 0.2 * Math.sin(time * 3 + i)).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(s.x, s.y + 1, 2.4, 0, 7); ctx.fill();
  }
  // canopy fascia LED strip — slow golden traveler
  const tx = G.canopy.x + 8 + ((time * 46) % (G.canopy.w - 16));
  g = ctx.createLinearGradient(tx - 26, 0, tx + 26, 0);
  g.addColorStop(0, 'rgba(255,214,140,0)'); g.addColorStop(0.5, 'rgba(255,224,160,0.55)'); g.addColorStop(1, 'rgba(255,214,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(G.canopy.x, G.canopy.y + G.canopy.h + 1, G.canopy.w, 3);

  // sconce glows (soft flicker)
  for (let i = 0; i < 2; i++) {
    const sx = i ? G.opening.x + G.opening.w + 22 : G.opening.x - 22;
    const a = 0.3 + 0.1 * Math.sin(time * 5.1 + i * 2.7) + 0.06 * Math.sin(time * 11.3 + i);
    g = ctx.createRadialGradient(sx, 522, 2, sx, 522, 30);
    g.addColorStop(0, `rgba(255,222,160,${a.toFixed(3)})`); g.addColorStop(1, 'rgba(255,222,160,0)');
    ctx.fillStyle = g; ctx.fillRect(sx - 32, 490, 64, 64);
  }
  // uplight wash on the facade
  for (let i = 0; i < G.uplights.length; i++) {
    const ux = G.uplights[i];
    const a = 0.07 + 0.03 * Math.sin(time * 1.3 + i * 2.1);
    g = ctx.createLinearGradient(0, G.ay - 8, 0, G.y0 + 60);
    g.addColorStop(0, `rgba(255,206,140,${(a + 0.08).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,206,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(ux - 8, G.ay - 6); ctx.lineTo(ux + 8, G.ay - 6);
    ctx.lineTo(ux + 44, G.y0 + 60); ctx.lineTo(ux - 44, G.y0 + 60); ctx.closePath(); ctx.fill();
  }
  // window twinkle — a few lit windows breathe
  for (let i = 0; i < G.wins.length; i += 3) {
    const w = G.wins[i];
    const a = 0.1 + 0.09 * Math.sin(time * 0.8 + w.ph);
    ctx.fillStyle = `rgba(255,206,130,${a.toFixed(3)})`;
    ctx.fillRect(w.x, w.y, w.w, w.h);
  }

  // ---- sliding entrance doors ----
  const o = G.opening;
  const halfW = o.w / 2;
  // lobby glow inside the recess (rises as doors open)
  g = ctx.createLinearGradient(0, o.y - 24, 0, G.ay);
  g.addColorStop(0, `rgba(255,214,150,${(0.16 + 0.4 * d).toFixed(3)})`);
  g.addColorStop(1, `rgba(255,180,100,${(0.06 + 0.3 * d).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(o.x, o.y - 24, o.w, G.ay - o.y + 24);
  ctx.globalCompositeOperation = 'source-over';
  // glass leaves slide into the gold jambs
  for (const s of [-1, 1]) {
    const lx = s < 0 ? o.x - 52 * d : o.x + halfW + 52 * d;
    const leafW = halfW;
    ctx.save();
    ctx.beginPath(); ctx.rect(o.x - 12, o.y, o.w + 24, G.ay - o.y); ctx.clip();
    g = ctx.createLinearGradient(0, o.y, 0, G.ay);
    g.addColorStop(0, 'rgba(206,228,255,0.42)'); g.addColorStop(0.7, 'rgba(160,190,225,0.3)'); g.addColorStop(1, 'rgba(120,150,190,0.36)');
    ctx.fillStyle = g;
    ctx.fillRect(lx, o.y, leafW, G.ay - o.y);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';                 // reflection band
    ctx.beginPath(); ctx.moveTo(lx + 4, G.ay); ctx.lineTo(lx + leafW * 0.45, o.y + 4); ctx.lineTo(lx + leafW * 0.62, o.y + 4);
    ctx.lineTo(lx + leafW * 0.2, G.ay); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 2.4;          // stiles
    ctx.strokeRect(lx + 1, o.y + 1, leafW - 2, G.ay - o.y - 2);
    ctx.fillStyle = '#f0cd82';                                 // push bar
    ctx.fillRect(s < 0 ? lx + leafW - 8 : lx + 4, o.y + 34, 4, 40);
    ctx.restore();
  }
  // jambs re-drawn over the leaf edges so doors vanish into pockets
  ctx.fillStyle = '#d9a441';
  ctx.fillRect(o.x - 12, o.y - 4, 12, G.ay - o.y + 4);
  ctx.fillRect(o.x + o.w, o.y - 4, 12, G.ay - o.y + 4);
  ctx.fillStyle = 'rgba(255,240,200,0.5)';
  ctx.fillRect(o.x - 12, o.y - 4, 3, G.ay - o.y + 4);
  ctx.fillRect(o.x + o.w + 9, o.y - 4, 3, G.ay - o.y + 4);
  // light spill across the carpet as the doors open
  if (d > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    g = ctx.createLinearGradient(0, G.ay - 10, 0, G.ay + 62);
    g.addColorStop(0, `rgba(255,214,150,${(0.4 * d).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,200,130,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(o.x + 6, G.ay - 8); ctx.lineTo(o.x + o.w - 6, G.ay - 8);
    ctx.lineTo(o.x + o.w + 40, G.ay + 62); ctx.lineTo(o.x - 40, G.ay + 62);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
