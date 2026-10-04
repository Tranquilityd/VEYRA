// Veyra — Lester, the player character. Drawn live (animated), no sprite sheets.
// Proportions: ~46 world-px tall, golden-hour rim light, soft shadow.
const SKIN = '#8a5a3b', SKIN_D = '#6f462c';
const HOOD = '#2ea3a8', HOOD_D = '#1f7d81';
const JEANS = '#35405e', JEANS_D = '#272f47';
const SHOE = '#f2efe6', HAIR = '#20180f';

export function drawLester(ctx, p, time) {
  const moving = p.moving;
  const ph = p.animPhase;
  const swing = moving ? Math.sin(ph) : 0;
  const bob = moving ? Math.abs(Math.cos(ph)) * 1.6 : Math.sin(time * 2) * 0.7;
  const seated = !!p.seated;

  ctx.save();
  ctx.translate(p.x, p.y);

  // shadow (long golden-hour, offset right)
  ctx.fillStyle = 'rgba(28,20,44,0.30)';
  ctx.beginPath();
  ctx.ellipse(5, 2, seated ? 13 : 11, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  const face = p.facing;
  const side = face === 'left' || face === 'right';
  if (face === 'left') ctx.scale(-1, 1);

  ctx.translate(0, -bob);

  // ----- legs -----
  ctx.fillStyle = JEANS;
  if (seated) {
    ctx.fillRect(-6, -16, 5, 10);
    ctx.fillRect(1, -16, 5, 10);
    ctx.fillStyle = JEANS_D;
    ctx.fillRect(-6, -7, 5, 7);
    ctx.fillRect(1, -7, 5, 7);
    ctx.fillStyle = SHOE;
    ctx.fillRect(-7, -2, 7, 3.4);
    ctx.fillRect(0, -2, 7, 3.4);
  } else if (side) {
    const a = swing * 5;
    ctx.save(); ctx.translate(0, -14); ctx.rotate(a * 0.06); ctx.fillRect(-2.6, 0, 5.2, 14); ctx.restore();
    ctx.save(); ctx.translate(0, -14); ctx.rotate(-a * 0.06); ctx.fillStyle = JEANS_D; ctx.fillRect(-2.6, 0, 5.2, 14); ctx.restore();
    ctx.fillStyle = SHOE;
    ctx.fillRect(-3.4 + a * 0.7, -2.6, 7.4, 3.4);
    ctx.fillStyle = '#d9d5cb';
    ctx.fillRect(-3.4 - a * 0.7, -2.6, 7.4, 3.4);
  } else {
    const a = swing * 4.4;
    ctx.fillRect(-6.4, -14 + Math.max(0, a) * 0.4, 5.2, 14 - Math.max(0, a) * 0.4);
    ctx.fillStyle = JEANS_D;
    ctx.fillRect(1.2, -14 + Math.max(0, -a) * 0.4, 5.2, 14 - Math.max(0, -a) * 0.4);
    ctx.fillStyle = SHOE;
    ctx.fillRect(-7.2, -2.8 - Math.max(0, a) * 0.5, 7, 3.4);
    ctx.fillStyle = '#d9d5cb';
    ctx.fillRect(0.4, -2.8 - Math.max(0, -a) * 0.5, 7, 3.4);
  }

  // ----- torso (hoodie) -----
  const ty = seated ? -30 : -32;
  ctx.fillStyle = HOOD;
  ctx.beginPath();
  ctx.moveTo(-8, ty + 4);
  ctx.quadraticCurveTo(-8, ty, -4, ty);
  ctx.lineTo(4, ty);
  ctx.quadraticCurveTo(8, ty, 8, ty + 4);
  ctx.lineTo(7.4, -13);
  ctx.lineTo(-7.4, -13);
  ctx.closePath();
  ctx.fill();
  // hoodie shade + pocket + rim light
  ctx.fillStyle = HOOD_D;
  ctx.fillRect(3.4, ty + 2, 4, -ty - 15);
  ctx.fillStyle = 'rgba(255,214,140,0.35)';
  ctx.fillRect(-8, ty + 1, 2.2, -ty - 14);
  ctx.fillStyle = HOOD_D;
  ctx.fillRect(-5, -20, 10, 5);
  // drawstrings
  ctx.fillStyle = '#f2efe6';
  ctx.fillRect(-2.6, ty + 3, 1.4, 5);
  ctx.fillRect(1.4, ty + 3, 1.4, 5);

  // ----- arms -----
  const armSwing = moving ? Math.sin(ph + Math.PI) * 4 : 0;
  ctx.fillStyle = HOOD;
  if (side) {
    ctx.save(); ctx.translate(0, ty + 4); ctx.rotate(armSwing * 0.07); ctx.fillRect(-2.2, 0, 4.6, 13); ctx.fillStyle = SKIN; ctx.fillRect(-2.2, 12, 4.6, 4); ctx.restore();
  } else if (face === 'up') {
    ctx.fillRect(-10.4, ty + 3, 4.2, 13);
    ctx.fillRect(6.2, ty + 3, 4.2, 13);
    ctx.fillStyle = SKIN;
    ctx.fillRect(-10.4, ty + 15, 4.2, 4);
    ctx.fillRect(6.2, ty + 15, 4.2, 4);
  } else {
    ctx.save(); ctx.translate(-8.6, ty + 3); ctx.rotate(-armSwing * 0.06); ctx.fillRect(-1.8, 0, 4.2, 13); ctx.fillStyle = SKIN; ctx.fillRect(-1.8, 12, 4.2, 4); ctx.restore();
    ctx.save(); ctx.translate(8.6, ty + 3); ctx.rotate(armSwing * 0.06); ctx.fillStyle = HOOD_D; ctx.fillRect(-2.4, 0, 4.2, 13); ctx.fillStyle = SKIN_D; ctx.fillRect(-2.4, 12, 4.2, 4); ctx.restore();
  }

  // ----- head -----
  const hy = ty - 7;
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(0, hy, 6.6, 0, Math.PI * 2); ctx.fill();
  // hair
  ctx.fillStyle = HAIR;
  if (face === 'up') {
    ctx.beginPath(); ctx.arc(0, hy, 6.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,214,140,0.25)';
    ctx.beginPath(); ctx.arc(-2.4, hy - 2.4, 3.2, 0, Math.PI * 2); ctx.fill();
  } else if (side) {
    ctx.beginPath(); ctx.arc(0, hy - 0.6, 6.9, Math.PI * 0.62, Math.PI * 2.05); ctx.fill();
    ctx.fillRect(-6.6, hy - 2, 5, 5);
    ctx.fillStyle = SKIN;
    ctx.fillRect(2.4, hy - 1, 4.2, 4.6);
    ctx.fillStyle = '#20180f';
    ctx.fillRect(3.8, hy - 0.6, 1.6, 1.8);      // eye
  } else {
    ctx.beginPath(); ctx.arc(0, hy - 1, 6.9, Math.PI * 0.94, Math.PI * 2.06); ctx.fill();
    ctx.fillRect(-6.8, hy - 2.4, 2.6, 4.4);
    ctx.fillRect(4.2, hy - 2.4, 2.6, 4.4);
    // face
    ctx.fillStyle = '#20180f';
    ctx.fillRect(-3.2, hy - 0.8, 1.8, 2.2);
    ctx.fillRect(1.4, hy - 0.8, 1.8, 2.2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-1.2, hy + 3, 2.4, 1.1);
  }
  // headphone accent (Lester's signature): band over the hair + ear cups
  ctx.strokeStyle = '#ff8c42';
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.arc(0, hy - 0.6, 7.2, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  ctx.fillStyle = '#e0742f';
  if (side) {
    ctx.beginPath(); ctx.arc(-0.5, hy + 0.4, 2.8, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillRect(-7.6, hy - 1.8, 2.6, 4.6);
    ctx.fillRect(5, hy - 1.8, 2.6, 4.6);
  }

  ctx.restore();
}
