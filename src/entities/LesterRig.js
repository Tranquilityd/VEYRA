// Veyra — Phase 3 (rebuild): Lester the human/coin hybrid — ASTRONAUT EDITION.
// HEAD  = the player's provided artwork (assets/lester_head.jpg), cropped to the
//         coin at load time and used untouched, inside a glass bubble helmet.
// BODY  = human body drawn as clean vector parts wearing a white EVA space suit
//         (chest control panel, orange accent stripes, gloves, life-support
//         pack), driven by the LesterAnimator pose (walk/run/turn/idle/actions).
// No sprite sheets: everything is part-based 2D animation.
import { LESTER } from '../core/movementConfig.js';

// space-suit palette
const SUIT = '#eceef2', SUIT_D = '#c3c8d2', SUIT_L = '#ffffff';
const ACCENT = '#ff8c42', PANEL = '#2b3442', GLOVE = '#dfe2e8';
const BOOT = '#d5d9e0', SOLE = '#39404b', PACK = '#e2e5ea', PACK_D = '#b7bcc7';
const GLASS = 'rgba(170,220,255,0.14)', GLASS_RIM = 'rgba(255,255,255,0.55)';

let head = null;           // cropped coin-head canvas (transparent)
let headAspect = 1;
let ready = false;

export function lesterReady() { return ready; }

// Crop the blue coin out of the provided photo-backed jpg.
function cropHead(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y += 2) {
    for (let x = 0; x < c.width; x += 2) {
      const i = (y * c.width + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (b - r > 26 && b - g > 12 && b > 70) {          // coin blue
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) { ready = false; return; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const hc = document.createElement('canvas');
  hc.width = w; hc.height = h;
  const hx = hc.getContext('2d');
  hx.save();
  hx.beginPath();
  hx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  hx.clip();
  hx.drawImage(c, x0, y0, w, h, 0, 0, w, h);
  hx.restore();
  head = hc;
  headAspect = w / h;
}

export function loadLester() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { cropHead(img); ready = !!head; resolve(ready); };
    img.onerror = () => { ready = false; resolve(false); };
    img.src = 'assets/lester_head.jpg';
  });
}

// ---------- drawing helpers (world px, origin at feet) ----------
function leg(ctx, x, y, rot, len, w, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -2, w, len + 2, w / 2);
  ctx.fill();
  ctx.fillStyle = ACCENT;                                 // knee stripe
  ctx.beginPath();
  ctx.roundRect(-w / 2, len * 0.42, w, 2.4, 1.2);
  ctx.fill();
  // boot: counter-rotated so the sole stays flat on the ground
  ctx.save();
  ctx.translate(0, len);
  ctx.rotate(-rot);
  ctx.fillStyle = BOOT;
  ctx.beginPath();
  ctx.roundRect(-4.6, -4.2, 12.4, 5.4, 2.4);
  ctx.fill();
  ctx.fillStyle = SOLE;
  ctx.beginPath();
  ctx.roundRect(-4.6, -1.4, 12.4, 2.4, 1.2);
  ctx.fill();
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.roundRect(3.6, -4.2, 3.4, 2.8, 1.4);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

function arm(ctx, x, y, rot, len, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-3.1, -2, 6.2, len + 2, 3.1);
  ctx.fill();
  ctx.fillStyle = ACCENT;                                 // upper-arm stripe
  ctx.beginPath();
  ctx.roundRect(-3.1, 5.4, 6.2, 2.4, 1.2);
  ctx.fill();
  ctx.fillStyle = GLOVE;                                  // glove cuff + glove
  ctx.beginPath();
  ctx.roundRect(-3.2, len - 4.4, 6.4, 3.6, 1.7);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, len + 1.6, 3.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function renderLester(ctx, x, y, pose) {
  const ok = ready;
  if (!ok) return;
  const J = pose.joints || {};
  const S2 = 0.35;                                         // animator offsets → world px
  const side = pose.side || 0;
  const flip = pose.flipSign || 1;
  const seated = pose.seated;

  ctx.save();
  ctx.translate(x, y);

  // ground shadow
  ctx.fillStyle = 'rgba(28,20,44,0.28)';
  ctx.beginPath();
  ctx.ellipse(2.5 * flip, 1, 13 * (pose.shadowSpread || 1), 4.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // body space: flip / side squash / turn envelope, bounce, lean
  const bw = (pose.scaleX || flip) / 1.12;
  ctx.scale(bw, pose.squashY || 1);
  ctx.translate(0, -(pose.bounce || 0));
  ctx.rotate(pose.lean || 0);

  const tJ = J.torso || {}, hJ = J.head || {};
  const aF = J.armF || {}, aB = J.armB || {};
  const lL = J.legL || {}, lR = J.legR || {};

  if (seated) {
    // ---- seated on a bench, suit on ----
    ctx.fillStyle = PACK;
    ctx.beginPath(); ctx.roundRect(-11, -46, 8, 18, 3); ctx.fill();
    ctx.fillStyle = PACK_D;
    ctx.beginPath(); ctx.roundRect(-11, -42, 8, 2.2, 1); ctx.fill();
    for (const s of [-1, 1]) {
      ctx.fillStyle = s < 0 ? SUIT_D : SUIT;
      ctx.beginPath(); ctx.roundRect(s * 4 - 3.8, -26, 7.6, 14, 3.6); ctx.fill();
      ctx.beginPath(); ctx.roundRect(s * 5.4 - 3.4, -14, 6.8, 12, 3.2); ctx.fill();
      ctx.fillStyle = BOOT;
      ctx.beginPath(); ctx.roundRect(s * 5.4 - 4.6, -4.4, 11.6, 5, 2.2); ctx.fill();
      ctx.fillStyle = SOLE;
      ctx.beginPath(); ctx.roundRect(s * 5.4 - 4.6, -1.6, 11.6, 2.2, 1.1); ctx.fill();
    }
    ctx.save();
    ctx.translate(tJ.x ? tJ.x * S2 : 0, 0);
    ctx.rotate(tJ.rot || 0.02);
    ctx.fillStyle = SUIT;
    ctx.beginPath(); ctx.roundRect(-10.5, -48, 21, 24, 6); ctx.fill();
    ctx.fillStyle = PANEL;
    ctx.beginPath(); ctx.roundRect(-4.4, -44, 8.8, 6.4, 1.6); ctx.fill();
    ctx.fillStyle = SUIT_D;
    ctx.beginPath(); ctx.roundRect(-10.5, -27, 21, 3.6, 1.6); ctx.fill();
    arm(ctx, -10, -44, (aB.rot || -0.7) * 0.6 + 0.5, 16, SUIT_D);
    arm(ctx, 10, -44, (aF.rot || -0.55) * 0.6 + 0.45, 16, SUIT);
    drawHead(ctx, hJ, 0, -50, side, flip);
    ctx.restore();
    ctx.restore();
    return;
  }

  // ---- standing / moving ----
  const backLeg = (lL.rot || 0) <= (lR.rot || 0) ? lL : lR;
  const frontLeg = backLeg === lL ? lR : lL;
  const backArmJ = (aF.rot || 0) >= (aB.rot || 0) ? aB : aF;
  const frontArmJ = backArmJ === aF ? aB : aF;

  // life-support pack (behind, shifts to his back in side view)
  ctx.save();
  ctx.translate(-flip * 5.4 * side + (tJ.x || 0) * S2 * 0.4, 0);
  ctx.fillStyle = PACK;
  ctx.beginPath(); ctx.roundRect(-13, -51, 11.6, 21, 3.6); ctx.fill();
  ctx.fillStyle = PACK_D;
  ctx.beginPath(); ctx.roundRect(-12.2, -47, 10, 2.4, 1.2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(-12.2, -42, 10, 2.4, 1.2); ctx.fill();
  ctx.fillStyle = ACCENT;
  ctx.beginPath(); ctx.roundRect(-12.4, -53.4, 5, 3.4, 1.6); ctx.fill();   // valve cap
  ctx.restore();

  // far arm
  arm(ctx, -flip * 10.8, -51 + (tJ.y || 0) * S2, backArmJ.rot || 0, 20, SUIT_D);

  // legs (far then near) with planted, flat boots
  const legDraw = (j, colr) => leg(ctx, j === lL ? -5.2 : 5.2, -29 + (j.y || 0) * 0.10, j.rot || 0, 26.5, 8, colr);
  legDraw(backLeg, SUIT_D);

  // torso over the hips
  ctx.save();
  ctx.translate((tJ.x || 0) * S2, (tJ.y || 0) * S2);
  ctx.rotate(tJ.rot || 0);
  ctx.scale(1, tJ.sy || 1);
  ctx.fillStyle = SUIT;
  ctx.beginPath();
  ctx.moveTo(-9.2, -28);
  ctx.quadraticCurveTo(-12.4, -40, -12.0, -48);
  ctx.quadraticCurveTo(-11.6, -54, -5.6, -55);
  ctx.lineTo(5.6, -55);
  ctx.quadraticCurveTo(11.6, -54, 12.0, -48);
  ctx.quadraticCurveTo(12.4, -40, 9.2, -28);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1 - side * 0.75;
  ctx.fillStyle = SUIT_D;                                             // side shade
  ctx.beginPath(); ctx.roundRect(7.4, -50, 3.4, 20, 1.6); ctx.fill();
  ctx.fillStyle = PANEL;                                              // chest control panel
  ctx.beginPath(); ctx.roundRect(-4.6, -48, 9.2, 7.4, 1.8); ctx.fill();
  ctx.fillStyle = ACCENT;
  ctx.beginPath(); ctx.arc(-2.2, -45.6, 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#35e0ff';
  ctx.beginPath(); ctx.arc(0.4, -45.6, 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.arc(3.0, -45.6, 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = SUIT_D;                                             // suit zipper seam
  ctx.beginPath(); ctx.roundRect(-0.7, -39, 1.4, 9, 0.7); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = SUIT_D;                                             // waist belt
  ctx.beginPath(); ctx.roundRect(-9.4, -30.6, 18.8, 3.8, 1.7); ctx.fill();
  ctx.fillStyle = ACCENT;
  ctx.beginPath(); ctx.roundRect(-1.8, -30.4, 3.6, 3.4, 1); ctx.fill();
  ctx.fillStyle = PACK_D;                                             // helmet neck ring
  ctx.beginPath(); ctx.ellipse(0, -54.6, 8.4, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // near leg
  legDraw(frontLeg, SUIT);

  // near arm
  arm(ctx, flip * 10.8, -51 + (tJ.y || 0) * S2, frontArmJ.rot || 0, 20, SUIT);

  // head in its bubble helmet (the provided artwork, untouched)
  drawHead(ctx, hJ, (tJ.x || 0) * S2 * 0.4, -56, side, flip);

  ctx.restore();
}

function drawHead(ctx, hJ, ox, neckY, side, flip) {
  if (!head) return;
  const R = 13;                                       // coin radius in world px
  ctx.save();
  ctx.translate(ox + (hJ.x || 0) * 0.35, neckY - R + 4 + (hJ.y || 0) * 0.35);
  ctx.rotate(hJ.rot || 0);
  const hs = flip * (1 - 0.35 * side);                // coin goes edge-on in side view
  ctx.scale(hs, 1);
  // glass bubble behind + around the coin
  ctx.fillStyle = GLASS;
  ctx.beginPath(); ctx.arc(0, 0, R + 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.drawImage(head, -R * headAspect, -R, R * 2 * headAspect, R * 2);
  ctx.strokeStyle = GLASS_RIM;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(0, 0, R + 3.2, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';           // glass highlight
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, R + 1.4, Math.PI * 1.15, Math.PI * 1.55); ctx.stroke();
  ctx.restore();
}
