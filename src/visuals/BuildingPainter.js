// Veyra — procedural modern building facades (baked once per building)
import { makeCanvas, mulberry32, roundRectPath } from '../core/util.js';

const STYLES = {
  cafe:   { wall: '#e6d6b8', wallDark: '#c9b48d', trim: '#8a6f4d', glass: '#9fd0da', sign: 'board'  },
  glass:  { wall: '#33404c', wallDark: '#232d36', trim: '#55636f', glass: '#a8d8e8', sign: 'modern' },
  neon:   { wall: '#262040', wallDark: '#191530', trim: '#3b3462', glass: '#1b2340', sign: 'neon'   },
  cinema: { wall: '#71303e', wallDark: '#521f2b', trim: '#93505e', glass: '#ffd9a0', sign: 'marquee' },
  casino: { wall: '#5a1f2b', wallDark: '#3f151f', trim: '#d9a441', glass: '#ffd9a0', sign: 'casino' },
};

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amt));
  const b = Math.min(255, Math.max(0, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

function windowPane(ctx, x, y, w, h, lit, rnd, glassCol) {
  ctx.fillStyle = '#1d2126';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  if (lit) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#ffe2a1'); g.addColorStop(1, '#f2a94e');
    ctx.fillStyle = g;
  } else {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, shade(glassCol.startsWith('#') ? glassCol : '#9fd0da', 26));
    g.addColorStop(0.5, glassCol);
    g.addColorStop(1, shade(glassCol.startsWith('#') ? glassCol : '#9fd0da', -34));
    ctx.fillStyle = g;
  }
  ctx.fillRect(x, y, w, h);
  // diagonal reflection
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.20)';
  ctx.beginPath();
  ctx.moveTo(x - h * 0.3, y + h); ctx.lineTo(x + w * 0.35, y); ctx.lineTo(x + w * 0.6, y); ctx.lineTo(x - h * 0.3 + w * 0.25, y + h);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // mullion
  ctx.fillStyle = 'rgba(20,24,28,0.7)';
  ctx.fillRect(x + w / 2 - 1, y, 2, h);
  if (lit) { ctx.fillStyle = 'rgba(255,190,100,0.16)'; ctx.fillRect(x - 5, y - 5, w + 10, h + 10); }
}

export function paintBuilding(def) {
  const S = STYLES[def.style] || STYLES.glass;
  const rnd = mulberry32(def.id.length * 7919 + def.cx);
  const pad = 48, padTop = 34, padBot = 34;
  const wR = def.w, fH = def.facadeH, rD = def.roofD;
  const W = wR + pad * 2, H = padTop + rD + fH + padBot;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const ay = padTop + rD + fH;          // ground line in sprite
  const ax = W / 2;

  // ---- baked ground shadow (long, golden-hour, to the right) ----
  let g = ctx.createLinearGradient(0, ay - 4, 0, ay + 30);
  g.addColorStop(0, 'rgba(28,20,44,0.32)'); g.addColorStop(1, 'rgba(28,20,44,0)');
  ctx.fillStyle = g;
  ctx.fillRect(pad - 8, ay - 4, wR + 46, 34);
  ctx.fillStyle = 'rgba(28,20,44,0.20)';
  ctx.fillRect(pad + wR - 6, ay - fH * 0.25, 26, fH * 0.25 + 6);

  // ---- roof ----
  g = ctx.createLinearGradient(0, padTop, 0, padTop + rD);
  g.addColorStop(0, '#8b8f96'); g.addColorStop(1, '#6e7278');
  ctx.fillStyle = g;
  ctx.fillRect(pad, padTop, wR, rD);
  // roof units & vents
  ctx.fillStyle = '#63676e';
  ctx.fillRect(pad + wR * 0.18, padTop + rD * 0.25, 46, 26);
  ctx.fillStyle = '#7d8188';
  ctx.fillRect(pad + wR * 0.18, padTop + rD * 0.25, 46, 8);
  ctx.fillStyle = '#5d6167';
  ctx.beginPath(); ctx.arc(pad + wR * 0.68, padTop + rD * 0.45, 11, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(pad + wR * 0.82, padTop + rD * 0.6, 8, 0, 7); ctx.fill();
  // parapet cap
  ctx.fillStyle = '#9aa0a8';
  ctx.fillRect(pad - 5, padTop + rD - 7, wR + 10, 9);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(pad - 5, padTop + rD + 2, wR + 10, 3);

  // ---- facade ----
  const y0 = padTop + rD;
  g = ctx.createLinearGradient(pad, 0, pad + wR, 0);
  g.addColorStop(0, shade(S.wall, 14)); g.addColorStop(0.55, S.wall); g.addColorStop(1, S.wallDark);
  ctx.fillStyle = g;
  ctx.fillRect(pad, y0, wR, fH);

  // cornice
  ctx.fillStyle = S.trim;
  ctx.fillRect(pad - 4, y0, wR + 8, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(pad - 4, y0, wR + 8, 2);

  // upper windows
  const storeH = 92;                                   // ground storefront height
  const upperH = fH - storeH - 26;
  const cols = Math.max(3, Math.floor(wR / 62));
  const rows = Math.max(1, Math.floor(upperH / 68));
  const gx = (wR - cols * 40) / (cols + 1);
  for (let r = 0; r < rows; r++) {
    for (let cc = 0; cc < cols; cc++) {
      const wx = pad + gx + cc * (40 + gx);
      const wy = y0 + 24 + r * 68;
      const lit = def.style === 'neon' ? rnd() < 0.22 : rnd() < 0.3;
      windowPane(ctx, wx, wy, 40, 46, lit, rnd, S.glass);
    }
  }

  // ---- ground floor storefront ----
  const sy = y0 + fH - storeH;
  ctx.fillStyle = 'rgba(15,18,22,0.9)';
  ctx.fillRect(pad + 6, sy, wR - 12, storeH);
  const sg = ctx.createLinearGradient(0, sy, 0, sy + storeH);
  if (def.style === 'neon') { sg.addColorStop(0, '#2a3358'); sg.addColorStop(1, '#141a30'); }
  else { sg.addColorStop(0, 'rgba(255,214,140,0.55)'); sg.addColorStop(1, 'rgba(255,180,90,0.18)'); }
  ctx.fillStyle = sg;
  ctx.fillRect(pad + 10, sy + 6, wR - 20, storeH - 12);
  ctx.fillStyle = 'rgba(20,24,28,0.85)';
  for (let x = pad + 56; x < pad + wR - 20; x += 52) ctx.fillRect(x, sy + 4, 5, storeH - 8);
  // entrance door recess
  const dw = 66, dx = ax - dw / 2;
  ctx.fillStyle = '#141821';
  ctx.fillRect(dx, sy + 10, dw, storeH - 10);
  const dg = ctx.createLinearGradient(0, sy + 10, 0, sy + storeH);
  dg.addColorStop(0, def.style === 'neon' ? 'rgba(120,240,255,0.5)' : 'rgba(255,220,150,0.75)');
  dg.addColorStop(1, 'rgba(255,190,110,0.15)');
  ctx.fillStyle = dg;
  ctx.fillRect(dx + 4, sy + 14, dw - 8, storeH - 14);
  ctx.fillStyle = 'rgba(20,24,28,0.9)';
  ctx.fillRect(ax - 2, sy + 14, 4, storeH - 14);
  // step
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(dx - 8, ay - 4, dw + 16, 4);

  // cafe awning
  if (def.style === 'cafe') {
    const awY = sy - 26;
    for (let i = 0, x = pad + 10; x < pad + wR - 10; i++, x += 34) {
      ctx.fillStyle = i % 2 ? '#f2efe6' : '#2ea3a8';
      ctx.fillRect(x, awY, 34, 22);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(pad + 10, awY + 22, wR - 20, 5);
  }
  // cinema marquee bulbs
  if (def.style === 'marquee' || def.style === 'cinema') {
    const awY = sy - 22;
    ctx.fillStyle = '#3a1620';
    ctx.fillRect(pad + 20, awY, wR - 40, 20);
    ctx.fillStyle = '#ffd98a';
    for (let x = pad + 30; x < pad + wR - 26; x += 22) { ctx.beginPath(); ctx.arc(x, awY + 10, 3, 0, 7); ctx.fill(); }
  }

  // ---- signage ----
  const signY = y0 + 12;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (S.sign === 'neon') {
    const bw = Math.min(wR - 60, 430), bh = 74;
    const bx = ax - bw / 2, by = signY + 6;
    roundRectPath(ctx, bx, by, bw, bh, 14);
    ctx.fillStyle = 'rgba(10,8,24,0.92)'; ctx.fill();
    ctx.save();
    ctx.shadowColor = '#35e0ff'; ctx.shadowBlur = 22;
    ctx.strokeStyle = '#35e0ff'; ctx.lineWidth = 3.5;
    roundRectPath(ctx, bx, by, bw, bh, 14); ctx.stroke();
    ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 16;
    ctx.strokeStyle = '#ff4fd8'; ctx.lineWidth = 2;
    roundRectPath(ctx, bx + 7, by + 7, bw - 14, bh - 14, 10); ctx.stroke();
    ctx.font = '900 40px system-ui, sans-serif';
    ctx.shadowColor = '#8ff5ff'; ctx.shadowBlur = 18;
    ctx.fillStyle = '#eafcff';
    ctx.fillText(def.name, ax, by + bh / 2 + 2);
    ctx.restore();
    // blade sign with gamepad glyph
    const blx = pad + wR - 26, bly = y0 + 30;
    roundRectPath(ctx, blx, bly, 34, 120, 10);
    ctx.fillStyle = 'rgba(12,10,28,0.95)'; ctx.fill();
    ctx.save();
    ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 14;
    ctx.strokeStyle = '#ff4fd8'; ctx.lineWidth = 2.5;
    roundRectPath(ctx, blx, bly, 34, 120, 10); ctx.stroke();
    ctx.fillStyle = '#8ff5ff';
    roundRectPath(ctx, blx + 7, bly + 16, 20, 13, 6); ctx.fill();
    ctx.fillStyle = '#ff4fd8';
    ctx.beginPath(); ctx.arc(blx + 12, bly + 44, 3, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(blx + 22, bly + 44, 3, 0, 7); ctx.fill();
    ctx.restore();
    // vertical neon strips
    ctx.fillStyle = 'rgba(53,224,255,0.5)';
    ctx.fillRect(pad + 8, y0 + 16, 3, fH - 40);
    ctx.fillStyle = 'rgba(255,79,216,0.45)';
    ctx.fillRect(pad + wR - 11, y0 + 16, 3, fH - 40);
  } else if (S.sign === 'modern') {
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(def.name, ax + 2, signY + 30);
    ctx.fillStyle = '#f2f6fa';
    ctx.fillText(def.name, ax, signY + 28);
  } else if (S.sign === 'marquee') {
    const bw = Math.min(wR - 40, 340), bh = 60;
    ctx.fillStyle = '#2a1017';
    ctx.fillRect(ax - bw / 2, signY + 4, bw, bh);
    ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 3;
    ctx.strokeRect(ax - bw / 2, signY + 4, bw, bh);
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.fillStyle = '#ffd98a';
    ctx.fillText(def.name, ax, signY + 4 + bh / 2 + 2);
  } else if (S.sign === 'casino') {
    const bw = Math.min(wR - 40, 420), bh = 78;
    const bx = ax - bw / 2, by = signY + 4;
    roundRectPath(ctx, bx, by, bw, bh, 10);
    ctx.fillStyle = '#2a0d14'; ctx.fill();
    ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 4;
    roundRectPath(ctx, bx, by, bw, bh, 10); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,230,160,0.5)'; ctx.lineWidth = 1.6;
    roundRectPath(ctx, bx + 6, by + 6, bw - 12, bh - 12, 7); ctx.stroke();
    // marquee bulbs
    ctx.fillStyle = '#ffe9b0';
    for (let x = bx + 14; x < bx + bw - 10; x += 18) {
      ctx.beginPath(); ctx.arc(x, by + 3, 2.4, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(x, by + bh - 3, 2.4, 0, 7); ctx.fill();
    }
    // crown glyph + name
    ctx.save();
    ctx.shadowColor = 'rgba(255,214,120,0.9)'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffd98a';
    const cx0 = ax - bw / 2 + 46, cy0 = by + bh / 2;
    ctx.beginPath();
    ctx.moveTo(cx0 - 16, cy0 + 10); ctx.lineTo(cx0 - 16, cy0 - 8); ctx.lineTo(cx0 - 8, cy0);
    ctx.lineTo(cx0, cy0 - 12); ctx.lineTo(cx0 + 8, cy0); ctx.lineTo(cx0 + 16, cy0 - 8);
    ctx.lineTo(cx0 + 16, cy0 + 10); ctx.closePath(); ctx.fill();
    ctx.font = '900 40px system-ui, sans-serif';
    ctx.fillText(def.name, ax + 18, by + bh / 2 + 2);
    ctx.restore();
    // gold pilasters on facade
    ctx.fillStyle = 'rgba(217,164,65,0.75)';
    for (let i = 0; i < 5; i++) {
      const px = pad + 30 + i * ((wR - 60) / 4);
      ctx.fillRect(px, y0 + 14, 8, fH - storeH - 20);
    }
  } else { // board
    const bw = Math.min(wR - 60, 300), bh = 52;
    roundRectPath(ctx, ax - bw / 2, signY + 6, bw, bh, 8);
    ctx.fillStyle = '#4a3220';
    ctx.fill();
    ctx.strokeStyle = '#8a6f4d'; ctx.lineWidth = 2.5;
    roundRectPath(ctx, ax - bw / 2, signY + 6, bw, bh, 8); ctx.stroke();
    ctx.font = '800 28px system-ui, sans-serif';
    ctx.fillStyle = '#f5ead0';
    ctx.fillText(def.name, ax, signY + 6 + bh / 2 + 2);
  }

  // ---- depth passes: side AO, left rim light, base AO ----
  g = ctx.createLinearGradient(pad + wR, 0, pad + wR - 30, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.30)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(pad + wR - 30, y0, 30, fH);
  g = ctx.createLinearGradient(pad, 0, pad + 10, 0);
  g.addColorStop(0, 'rgba(255,196,120,0.22)'); g.addColorStop(1, 'rgba(255,196,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(pad, y0, 10, fH);
  g = ctx.createLinearGradient(0, ay, 0, ay - 22);
  g.addColorStop(0, 'rgba(0,0,0,0.34)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(pad, ay - 22, wR, 22);

  return { canvas: c, ax, ay };
}
