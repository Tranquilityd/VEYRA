// Veyra — procedural prop sprites (baked once). Each returns {canvas, ax, ay}.
import { makeCanvas, mulberry32, TAU } from '../core/util.js';
import { PAL } from './Palette.js';

function shadow(ctx, x, y, rx, ry, a = 0.26) {
  ctx.fillStyle = `rgba(28,20,44,${a})`;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
}

function canopy(ctx, cx, cy, r, seed) {
  const rnd = mulberry32(seed);
  const blobs = 6;
  // dark base layer
  ctx.fillStyle = PAL.leafDark;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * TAU + rnd();
    const rr = r * (0.42 + rnd() * 0.2);
    const bx = cx + Math.cos(a) * r * 0.55, by = cy + Math.sin(a) * r * 0.5;
    ctx.beginPath(); ctx.arc(bx, by, rr, 0, TAU); ctx.fill();
  }
  // mid layer
  ctx.fillStyle = PAL.leafMid;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * TAU + 0.6 + rnd() * 0.5;
    const rr = r * (0.3 + rnd() * 0.16);
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.38 - r * 0.08, rr, 0, TAU); ctx.fill();
  }
  // shaded underside (depth)
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
  ctx.fillStyle = 'rgba(18,42,14,0.35)';
  ctx.beginPath(); ctx.arc(cx + r * 0.22, cy + r * 0.3, r * 0.95, 0, TAU); ctx.fill();
  ctx.restore();
  // sunlit top-left highlights
  ctx.fillStyle = PAL.leafLight;
  for (let i = 0; i < 5; i++) {
    const rr = r * (0.14 + rnd() * 0.12);
    ctx.beginPath();
    ctx.arc(cx - r * 0.3 + rnd() * r * 0.55, cy - r * 0.36 + rnd() * r * 0.36, rr, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,240,180,0.4)';
  ctx.beginPath(); ctx.arc(cx - r * 0.34, cy - r * 0.4, r * 0.12, 0, TAU); ctx.fill();
  // rim light on the sun side
  ctx.strokeStyle = 'rgba(226,255,170,0.4)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r - 1.5, Math.PI * 0.95, Math.PI * 1.72); ctx.stroke();
  // contour
  ctx.strokeStyle = 'rgba(28,58,22,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
}

const painters = {
  tree(v) {
    const c = makeCanvas(160, 172), ctx = c.getContext('2d');
    shadow(ctx, 94, 162, 46, 12);
    ctx.fillStyle = PAL.trunk;
    ctx.fillRect(72, 118, 12, 44);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(80, 118, 4, 44);
    canopy(ctx, 78, 74, 44 + (v || 0) * 4, 91 + (v || 0) * 17);
    return { canvas: c, ax: 78, ay: 162 };
  },
  palm() {
    const c = makeCanvas(130, 168), ctx = c.getContext('2d');
    shadow(ctx, 72, 158, 34, 10);
    ctx.strokeStyle = '#8a6a45'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(66, 158); ctx.quadraticCurveTo(58, 110, 70, 72); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 3;
    for (let y = 148; y > 84; y -= 14) { ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(70, y - 3); ctx.stroke(); }
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.52;
      ctx.strokeStyle = i % 2 ? PAL.leafMid : PAL.leafDark;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(70, 70);
      ctx.quadraticCurveTo(70 + Math.cos(a) * 34, 70 + Math.sin(a) * 26 - 8, 70 + Math.cos(a) * 52, 70 + Math.sin(a) * 40 + 12);
      ctx.stroke();
    }
    ctx.fillStyle = '#5a4326';
    ctx.beginPath(); ctx.arc(66, 74, 4, 0, TAU); ctx.arc(74, 76, 4, 0, TAU); ctx.fill();
    return { canvas: c, ax: 66, ay: 158 };
  },
  lamp() {
    const c = makeCanvas(64, 116), ctx = c.getContext('2d');
    shadow(ctx, 35, 108, 14, 5);
    ctx.fillStyle = PAL.metal;
    ctx.fillRect(29, 22, 6, 84);
    ctx.fillRect(24, 102, 16, 6);
    ctx.fillStyle = '#3a3e44';
    ctx.fillRect(22, 14, 20, 10);
    ctx.fillStyle = PAL.warmLight;
    ctx.fillRect(24, 22, 16, 4);
    ctx.fillStyle = 'rgba(255,217,160,0.35)';
    ctx.beginPath(); ctx.arc(32, 25, 10, 0, TAU); ctx.fill();
    return { canvas: c, ax: 32, ay: 108 };
  },
  bench() {
    const c = makeCanvas(92, 62), ctx = c.getContext('2d');
    shadow(ctx, 48, 56, 36, 8);
    ctx.fillStyle = '#2c2f33';
    ctx.fillRect(12, 30, 5, 24); ctx.fillRect(75, 30, 5, 24);
    ctx.fillStyle = '#8a5a33';
    ctx.fillRect(8, 30, 76, 6);
    ctx.fillStyle = '#a06c3d';
    ctx.fillRect(8, 28, 76, 3);
    ctx.fillStyle = '#8a5a33';
    ctx.fillRect(10, 12, 72, 5); ctx.fillRect(10, 20, 72, 5);
    ctx.fillStyle = '#2c2f33';
    ctx.fillRect(12, 10, 4, 22); ctx.fillRect(76, 10, 4, 22);
    return { canvas: c, ax: 46, ay: 56 };
  },
  planter(v) {
    const c = makeCanvas(72, 66), ctx = c.getContext('2d');
    shadow(ctx, 38, 60, 28, 7);
    ctx.fillStyle = '#b5aea2';
    ctx.fillRect(10, 36, 52, 24);
    ctx.fillStyle = '#9c958a';
    ctx.fillRect(10, 36, 52, 5);
    ctx.fillStyle = PAL.leafMid;
    ctx.beginPath(); ctx.arc(24, 30, 12, 0, TAU); ctx.arc(38, 24, 14, 0, TAU); ctx.arc(50, 31, 11, 0, TAU); ctx.fill();
    ctx.fillStyle = PAL.leafLight;
    ctx.beginPath(); ctx.arc(34, 20, 8, 0, TAU); ctx.fill();
    const cols = ['#e86a8a', '#f2d14e', '#b07fe8'];
    ctx.fillStyle = cols[(v || 0) % 3];
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(18 + i * 9, 26 + (i % 2) * 6, 2.4, 0, TAU); ctx.fill(); }
    return { canvas: c, ax: 36, ay: 60 };
  },
  bin() {
    const c = makeCanvas(36, 46), ctx = c.getContext('2d');
    shadow(ctx, 19, 42, 12, 4);
    ctx.fillStyle = '#5a6068';
    ctx.fillRect(8, 12, 20, 30);
    ctx.fillStyle = '#474c53';
    ctx.fillRect(8, 12, 6, 30);
    ctx.fillStyle = '#6d747c';
    ctx.fillRect(6, 8, 24, 6);
    ctx.fillStyle = '#2c2f33';
    ctx.fillRect(14, 20, 8, 3);
    return { canvas: c, ax: 18, ay: 42 };
  },
  hydrant() {
    const c = makeCanvas(28, 42), ctx = c.getContext('2d');
    shadow(ctx, 15, 38, 10, 4);
    ctx.fillStyle = '#c34a3a';
    ctx.fillRect(9, 12, 12, 26);
    ctx.beginPath(); ctx.arc(15, 12, 7, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#8f3327';
    ctx.fillRect(6, 20, 18, 4);
    ctx.fillStyle = '#e8e6df';
    ctx.beginPath(); ctx.arc(15, 10, 2.4, 0, TAU); ctx.fill();
    return { canvas: c, ax: 15, ay: 38 };
  },
  bike() {
    const c = makeCanvas(74, 56), ctx = c.getContext('2d');
    shadow(ctx, 38, 50, 30, 6);
    ctx.strokeStyle = '#2c2f33'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(18, 40, 11, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(56, 40, 11, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#d1495b'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(18, 40); ctx.lineTo(30, 22); ctx.lineTo(48, 22); ctx.lineTo(56, 40); ctx.moveTo(30, 22); ctx.lineTo(38, 40); ctx.lineTo(48, 22); ctx.stroke();
    ctx.strokeStyle = '#2c2f33'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(48, 22); ctx.lineTo(45, 14); ctx.moveTo(30, 22); ctx.lineTo(28, 15); ctx.lineTo(34, 15); ctx.stroke();
    ctx.fillStyle = '#5a6068';
    ctx.fillRect(4, 44, 66, 4);
    return { canvas: c, ax: 37, ay: 50 };
  },
  parasol() {
    const c = makeCanvas(96, 104), ctx = c.getContext('2d');
    shadow(ctx, 50, 96, 30, 8);
    ctx.fillStyle = '#5a6068';
    ctx.fillRect(46, 40, 4, 56);
    // canopy
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#f2efe6' : '#2ea3a8';
      ctx.beginPath();
      ctx.moveTo(48, 12);
      ctx.arc(48, 12, 40, Math.PI + (i / 6) * Math.PI, Math.PI + ((i + 1) / 6) * Math.PI);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#2c2f33';
    ctx.beginPath(); ctx.arc(48, 12, 3, 0, TAU); ctx.fill();
    // table + stools
    ctx.fillStyle = '#8a8f96';
    ctx.fillRect(30, 66, 36, 5);
    ctx.fillRect(44, 71, 6, 24);
    ctx.fillStyle = '#6d747c';
    ctx.fillRect(20, 74, 10, 4); ctx.fillRect(66, 74, 10, 4);
    ctx.fillRect(23, 78, 4, 16); ctx.fillRect(69, 78, 4, 16);
    return { canvas: c, ax: 48, ay: 96 };
  },
  busstop() {
    const c = makeCanvas(152, 92), ctx = c.getContext('2d');
    shadow(ctx, 78, 86, 62, 9);
    ctx.fillStyle = '#2c2f33';
    ctx.fillRect(14, 18, 6, 66); ctx.fillRect(132, 18, 6, 66);
    ctx.fillStyle = '#3a3e44';
    ctx.fillRect(8, 10, 136, 9);
    ctx.fillStyle = 'rgba(160,220,235,0.35)';
    ctx.fillRect(20, 22, 112, 44);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.moveTo(40, 66); ctx.lineTo(70, 22); ctx.lineTo(84, 22); ctx.lineTo(54, 66); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8a5a33';
    ctx.fillRect(28, 56, 96, 6);
    ctx.fillStyle = '#f2c14e';
    ctx.beginPath(); ctx.arc(140, 30, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2c2f33';
    ctx.fillRect(138, 30, 4, 10);
    return { canvas: c, ax: 76, ay: 86 };
  },
  car(v) {
    const cols = ['#c8473b', '#3f7fbf', '#e0e3e6'];
    const c = makeCanvas(132, 66), ctx = c.getContext('2d');
    shadow(ctx, 68, 60, 56, 8);
    const col = cols[(v || 0) % 3];
    // body
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(10, 48); ctx.quadraticCurveTo(8, 34, 18, 32); ctx.lineTo(34, 30);
    ctx.quadraticCurveTo(44, 16, 62, 15); ctx.lineTo(88, 15);
    ctx.quadraticCurveTo(104, 16, 112, 30); ctx.lineTo(120, 33);
    ctx.quadraticCurveTo(126, 36, 124, 48); ctx.closePath(); ctx.fill();
    // glass
    ctx.fillStyle = '#1d2732';
    ctx.beginPath();
    ctx.moveTo(40, 29); ctx.quadraticCurveTo(48, 19, 62, 18); ctx.lineTo(86, 18);
    ctx.quadraticCurveTo(98, 19, 105, 29); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.moveTo(52, 28); ctx.lineTo(62, 19); ctx.lineTo(72, 19); ctx.lineTo(62, 28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col;
    ctx.fillRect(70, 18, 3, 11);
    // trim + lights
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(10, 44, 114, 5);
    ctx.fillStyle = '#ffe9b0';
    ctx.fillRect(118, 35, 6, 5);
    ctx.fillStyle = '#ff5d5d';
    ctx.fillRect(8, 35, 5, 5);
    // wheels
    ctx.fillStyle = '#14161a';
    ctx.beginPath(); ctx.arc(36, 50, 11, 0, TAU); ctx.arc(100, 50, 11, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a8f96';
    ctx.beginPath(); ctx.arc(36, 50, 5, 0, TAU); ctx.arc(100, 50, 5, 0, TAU); ctx.fill();
    return { canvas: c, ax: 66, ay: 60 };
  },
  gazebo() {
    const c = makeCanvas(196, 176), ctx = c.getContext('2d');
    shadow(ctx, 100, 166, 74, 14);
    // floor
    ctx.fillStyle = '#c9c0ae';
    ctx.beginPath(); ctx.ellipse(98, 152, 74, 22, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#a49e93'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(98, 152, 74, 22, 0, 0, TAU); ctx.stroke();
    // posts
    ctx.fillStyle = '#f2efe6';
    for (const px of [36, 78, 118, 160]) ctx.fillRect(px, 84, 7, 66);
    // railing
    ctx.fillStyle = '#f2efe6';
    ctx.fillRect(36, 118, 131, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(36, 123, 131, 2);
    // roof
    const g = ctx.createLinearGradient(0, 20, 0, 90);
    g.addColorStop(0, '#8a5a44'); g.addColorStop(1, '#6b4232');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(98, 16); ctx.lineTo(182, 84); ctx.lineTo(14, 84); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,220,160,0.25)';
    ctx.beginPath(); ctx.moveTo(98, 16); ctx.lineTo(56, 84); ctx.lineTo(14, 84); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.beginPath(); ctx.moveTo(98, 16); ctx.lineTo(182, 84); ctx.lineTo(140, 84); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#54332a';
    ctx.fillRect(10, 82, 176, 7);
    ctx.fillStyle = 'rgba(255,220,160,0.3)';
    ctx.fillRect(10, 82, 176, 2);
    ctx.strokeStyle = 'rgba(255,230,180,0.35)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(98, 16); ctx.lineTo(52, 84); ctx.stroke();
    ctx.fillStyle = '#d9a441';
    ctx.beginPath(); ctx.arc(98, 13, 5, 0, TAU); ctx.fill();
    return { canvas: c, ax: 98, ay: 166 };
  },
  dock() {
    const c = makeCanvas(124, 44), ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(28,20,44,0.2)';
    ctx.fillRect(6, 30, 112, 8);
    ctx.fillStyle = '#8a6a45';
    ctx.fillRect(4, 8, 116, 24);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
    for (let x = 16; x < 120; x += 14) { ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, 32); ctx.stroke(); }
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(8, 4, 8, 8); ctx.fillRect(108, 4, 8, 8);
    return { canvas: c, ax: 62, ay: 34 };
  },
  hoop() {
    const c = makeCanvas(64, 126), ctx = c.getContext('2d');
    shadow(ctx, 32, 118, 16, 6);
    ctx.fillStyle = '#3a3e44';
    ctx.fillRect(28, 20, 7, 98);
    ctx.fillStyle = '#f2f2ef';
    ctx.fillRect(12, 8, 40, 30);
    ctx.strokeStyle = '#c8473b'; ctx.lineWidth = 3;
    ctx.strokeRect(24, 20, 16, 13);
    ctx.strokeStyle = '#ff8c42'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(32, 42, 13, 5, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(21, 44); ctx.lineTo(26, 58); ctx.moveTo(43, 44); ctx.lineTo(38, 58);
    ctx.moveTo(26, 44); ctx.lineTo(28, 58); ctx.moveTo(38, 44); ctx.lineTo(36, 58);
    ctx.stroke();
    return { canvas: c, ax: 32, ay: 118 };
  },
  arch() {
    const c = makeCanvas(330, 156), ctx = c.getContext('2d');
    shadow(ctx, 168, 148, 130, 10);
    ctx.fillStyle = PAL.stone;
    ctx.fillRect(24, 40, 26, 106); ctx.fillRect(280, 40, 26, 106);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(44, 40, 6, 106); ctx.fillRect(300, 40, 6, 106);
    ctx.fillStyle = '#b8b0a1';
    ctx.fillRect(18, 34, 38, 10); ctx.fillRect(274, 34, 38, 10);
    // beam
    ctx.fillStyle = '#274d3b';
    ctx.fillRect(24, 12, 282, 30);
    ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 2.5;
    ctx.strokeRect(24, 12, 282, 30);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 21px system-ui, sans-serif';
    ctx.fillStyle = '#ffd98a';
    ctx.fillText('V E Y R A   G A R D E N S', 165, 28);
    // hanging lamps
    ctx.fillStyle = '#2c2f33';
    ctx.fillRect(70, 42, 3, 10); ctx.fillRect(256, 42, 3, 10);
    ctx.fillStyle = PAL.warmLight;
    ctx.beginPath(); ctx.arc(71.5, 56, 5, 0, TAU); ctx.arc(257.5, 56, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,217,160,0.3)';
    ctx.beginPath(); ctx.arc(71.5, 56, 11, 0, TAU); ctx.arc(257.5, 56, 11, 0, TAU); ctx.fill();
    return { canvas: c, ax: 165, ay: 146 };
  },
  fountain() {
    const c = makeCanvas(170, 130), ctx = c.getContext('2d');
    shadow(ctx, 88, 120, 66, 13);
    // basin ring
    ctx.fillStyle = PAL.stone;
    ctx.beginPath(); ctx.ellipse(85, 96, 72, 30, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#b8b0a1';
    ctx.beginPath(); ctx.ellipse(85, 92, 72, 30, 0, 0, TAU); ctx.fill();
    // water inside (static base; animated overlay drawn live)
    const g = ctx.createLinearGradient(0, 70, 0, 110);
    g.addColorStop(0, PAL.waterTop); g.addColorStop(1, PAL.waterDeep);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(85, 90, 60, 23, 0, 0, TAU); ctx.fill();
    // pedestal tiers
    ctx.fillStyle = PAL.stone;
    ctx.fillRect(77, 46, 16, 46);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(85, 46, 8, 46);
    ctx.beginPath(); ctx.ellipse(85, 48, 26, 9, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ddd5c6';
    ctx.beginPath(); ctx.ellipse(85, 45, 26, 9, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = PAL.stone;
    ctx.fillRect(80, 22, 10, 24);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(85, 22, 5, 24);
    ctx.beginPath(); ctx.ellipse(85, 22, 15, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#eee6d7';
    ctx.beginPath(); ctx.ellipse(85, 20, 15, 6, 0, 0, TAU); ctx.fill();
    // falling water sheets
    ctx.strokeStyle = 'rgba(235,250,255,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(62, 50); ctx.lineTo(60, 84);
    ctx.moveTo(108, 50); ctx.lineTo(110, 84);
    ctx.moveTo(72, 24); ctx.lineTo(70, 46);
    ctx.moveTo(98, 24); ctx.lineTo(100, 46);
    ctx.stroke();
    return { canvas: c, ax: 85, ay: 120 };
  },
  fenceH() {
    const c = makeCanvas(120, 32), ctx = c.getContext('2d');
    ctx.fillStyle = '#23262a';
    for (let x = 4; x < 120; x += 8) ctx.fillRect(x, 6, 3, 24);
    ctx.fillRect(0, 4, 120, 4);
    ctx.fillRect(0, 16, 120, 3);
    for (const px of [0, 58, 114]) {
      ctx.fillRect(px, 0, 6, 32);
      ctx.fillStyle = '#d9a441'; ctx.fillRect(px, 0, 6, 2); ctx.fillStyle = '#23262a';
    }
    return { canvas: c, ax: 0, ay: 32 };
  },
  fenceV() {
    const c = makeCanvas(12, 120), ctx = c.getContext('2d');
    ctx.fillStyle = '#23262a';
    ctx.fillRect(3, 0, 6, 120);
    ctx.fillStyle = '#3a3e44';
    ctx.fillRect(3, 0, 2, 120);
    for (let y = 0; y < 120; y += 30) {
      ctx.fillRect(1, y, 10, 5);
      ctx.fillStyle = '#d9a441'; ctx.fillRect(1, y, 10, 1.6); ctx.fillStyle = '#23262a';
    }
    return { canvas: c, ax: 6, ay: 120 };
  },
  rock(v) {
    const c = makeCanvas(76, 56), ctx = c.getContext('2d');
    const s = 0.8 + (v || 0) * 0.22;
    shadow(ctx, 40, 50, 26 * s, 8);
    const g = ctx.createLinearGradient(20, 10, 56, 48);
    g.addColorStop(0, '#9a958c'); g.addColorStop(0.6, '#7c776e'); g.addColorStop(1, '#5f5b53');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(12, 48); ctx.lineTo(16, 26 * (1.1 - s * 0.2)); ctx.lineTo(30, 10);
    ctx.lineTo(52, 14); ctx.lineTo(64, 32); ctx.lineTo(62, 48); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,244,214,0.28)';
    ctx.beginPath(); ctx.moveTo(18, 26); ctx.lineTo(30, 10); ctx.lineTo(40, 13); ctx.lineTo(26, 30); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(30,28,24,0.30)';
    ctx.beginPath(); ctx.moveTo(52, 14); ctx.lineTo(64, 32); ctx.lineTo(62, 48); ctx.lineTo(50, 48); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(90,140,60,0.55)';
    ctx.beginPath(); ctx.ellipse(26, 44, 10, 4, 0, 0, TAU); ctx.fill();
    return { canvas: c, ax: 38, ay: 50 };
  },
  topiary() {
    const c = makeCanvas(52, 74), ctx = c.getContext('2d');
    shadow(ctx, 28, 68, 16, 6);
    ctx.fillStyle = PAL.trunk;
    ctx.fillRect(25, 46, 6, 20);
    ctx.fillStyle = PAL.leafDark;
    ctx.beginPath(); ctx.arc(28, 30, 18, 0, TAU); ctx.fill();
    ctx.fillStyle = PAL.leafMid;
    ctx.beginPath(); ctx.arc(25, 26, 14, 0, TAU); ctx.fill();
    ctx.fillStyle = PAL.leafLight;
    ctx.beginPath(); ctx.arc(21, 21, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(28,58,22,0.45)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(28, 30, 18, 0, TAU); ctx.stroke();
    return { canvas: c, ax: 28, ay: 68 };
  },
  shrub() {
    const c = makeCanvas(56, 40), ctx = c.getContext('2d');
    shadow(ctx, 30, 35, 20, 6);
    ctx.fillStyle = PAL.leafDark;
    ctx.beginPath(); ctx.arc(18, 24, 12, 0, TAU); ctx.arc(32, 20, 14, 0, TAU); ctx.arc(44, 26, 10, 0, TAU); ctx.fill();
    ctx.fillStyle = PAL.leafMid;
    ctx.beginPath(); ctx.arc(22, 19, 9, 0, TAU); ctx.arc(36, 16, 10, 0, TAU); ctx.fill();
    ctx.fillStyle = PAL.leafLight;
    ctx.beginPath(); ctx.arc(19, 14, 4.5, 0, TAU); ctx.arc(33, 11, 5, 0, TAU); ctx.fill();
    return { canvas: c, ax: 28, ay: 36 };
  },
  bollard() {
    const c = makeCanvas(20, 34), ctx = c.getContext('2d');
    shadow(ctx, 11, 30, 7, 3);
    ctx.fillStyle = '#2c2f33';
    ctx.fillRect(7, 8, 6, 22);
    ctx.fillStyle = PAL.warmLight;
    ctx.fillRect(6, 4, 8, 6);
    ctx.fillStyle = 'rgba(255,217,160,0.35)';
    ctx.beginPath(); ctx.arc(10, 7, 7, 0, TAU); ctx.fill();
    return { canvas: c, ax: 10, ay: 30 };
  },
  bridge() {
    const c = makeCanvas(150, 74), ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(28,20,44,0.22)';
    ctx.fillRect(10, 52, 130, 10);
    // deck (arched)
    ctx.fillStyle = '#8a6a45';
    ctx.beginPath();
    ctx.moveTo(6, 52); ctx.quadraticCurveTo(75, 26, 144, 52); ctx.lineTo(144, 60); ctx.quadraticCurveTo(75, 34, 6, 60); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.6;
    for (let x = 16; x < 140; x += 12) { ctx.beginPath(); ctx.moveTo(x, 50 - Math.sin((x / 150) * Math.PI) * 18); ctx.lineTo(x, 58 - Math.sin((x / 150) * Math.PI) * 18); ctx.stroke(); }
    // railings
    ctx.strokeStyle = '#5d4326'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(8, 40); ctx.quadraticCurveTo(75, 12, 142, 40); ctx.stroke();
    ctx.lineWidth = 3;
    for (let x = 12; x <= 138; x += 18) {
      const yy = 50 - Math.sin((x / 150) * Math.PI) * 20;
      ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x, yy - 12 + Math.sin((x / 150) * Math.PI) * 4); ctx.stroke();
    }
    return { canvas: c, ax: 75, ay: 60 };
  },
  pergola() {
    const c = makeCanvas(150, 120), ctx = c.getContext('2d');
    shadow(ctx, 78, 112, 56, 10);
    ctx.fillStyle = '#f2efe6';
    for (const px of [16, 60, 104, 132]) ctx.fillRect(px, 44, 6, 66);
    ctx.fillStyle = '#d9d5cb';
    ctx.fillRect(10, 36, 134, 8);
    ctx.fillStyle = '#c4bfb4';
    for (let x = 14; x < 140; x += 14) ctx.fillRect(x, 26, 6, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(10, 44, 134, 3);
    // climbing greens
    ctx.fillStyle = PAL.leafMid;
    ctx.beginPath(); ctx.arc(20, 40, 8, 0, TAU); ctx.arc(130, 42, 9, 0, TAU); ctx.arc(70, 30, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = PAL.leafLight;
    ctx.beginPath(); ctx.arc(18, 36, 4, 0, TAU); ctx.arc(132, 38, 4, 0, TAU); ctx.fill();
    return { canvas: c, ax: 75, ay: 110 };
  },
  sculpture() {
    const c = makeCanvas(70, 96), ctx = c.getContext('2d');
    shadow(ctx, 37, 90, 22, 7);
    ctx.fillStyle = PAL.stone;
    ctx.fillRect(21, 74, 32, 16);
    ctx.fillStyle = '#b8b0a1';
    ctx.fillRect(21, 74, 32, 4);
    ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(37, 44, 26, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,240,190,0.55)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(37, 44, 26, Math.PI * 0.9, Math.PI * 1.6); ctx.stroke();
    return { canvas: c, ax: 37, ay: 90 };
  },
  tower(v) {
    const hs = [300, 380, 250];
    const h = hs[(v || 0) % 3];
    const w = 120;
    const c = makeCanvas(w + 40, h + 40), ctx = c.getContext('2d');
    const rnd = mulberry32(500 + (v || 0) * 77);
    const x0 = 20, y0 = 20;
    ctx.fillStyle = 'rgba(28,20,44,0.25)';
    ctx.fillRect(x0 + 8, y0 + h - 6, w + 18, 14);
    const cols = ['#46525e', '#5a4a52', '#3e4a44'];
    const base = cols[(v || 0) % 3];
    const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    g.addColorStop(0, base); g.addColorStop(1, 'rgba(20,24,30,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, w, h);
    // window grid
    for (let yy = y0 + 12; yy < y0 + h - 10; yy += 22) {
      for (let xx = x0 + 8; xx < x0 + w - 12; xx += 20) {
        const lit = rnd() < 0.28;
        ctx.fillStyle = lit ? 'rgba(255,214,140,0.85)' : 'rgba(160,210,225,0.35)';
        ctx.fillRect(xx, yy, 12, 13);
      }
    }
    // roof edge + beacon
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x0 - 3, y0 - 4, w + 6, 5);
    ctx.fillStyle = '#ff5d73';
    ctx.beginPath(); ctx.arc(x0 + w / 2, y0 - 8, 3, 0, TAU); ctx.fill();
    return { canvas: c, ax: x0 + w / 2, ay: y0 + h };
  },
};

export function paintProp(type, variant = 0, flip = false) {
  const fn = painters[type] || painters.bin;
  const out = fn(variant);
  if (flip) {
    const c = makeCanvas(out.canvas.width, out.canvas.height);
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(out.canvas, 0, 0);
    return { canvas: c, ax: c.width - out.ax, ay: out.ay };
  }
  return out;
}
