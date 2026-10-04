// Veyra — Phase 4: small garden animal painters (flat vector, tiny, cheap).
export function drawPigeon(ctx, s) {
  const flap = s.flying ? Math.sin(s.phase * 3) * 0.9 : 0;
  const peck = s.state === 'peck' ? Math.max(0, Math.sin(s.phase * 2)) * 3 : 0;
  ctx.save();
  ctx.scale(s.face || 1, 1);
  ctx.fillStyle = 'rgba(28,20,44,0.2)';
  ctx.beginPath(); ctx.ellipse(0, 0.6, 5, 1.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(0, -s.flying * 0);
  // body
  ctx.fillStyle = '#9aa3ad';
  ctx.beginPath(); ctx.ellipse(0, -4, 5.4, 3.6, 0, 0, Math.PI * 2); ctx.fill();
  // wing
  ctx.fillStyle = '#7d8691';
  ctx.save(); ctx.translate(-1, -5); ctx.rotate(flap - 0.2);
  ctx.beginPath(); ctx.ellipse(-2.4, 0, 4.4, 2, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // head + beak
  ctx.fillStyle = '#8b949e';
  ctx.beginPath(); ctx.arc(4.4, -7 + peck, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8a13c';
  ctx.beginPath(); ctx.moveTo(6.6, -7 + peck); ctx.lineTo(8.4, -6.4 + peck); ctx.lineTo(6.6, -5.8 + peck); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#20242a';
  ctx.beginPath(); ctx.arc(5, -7.6 + peck, 0.55, 0, Math.PI * 2); ctx.fill();
  // tail
  ctx.fillStyle = '#7d8691';
  ctx.beginPath(); ctx.moveTo(-4.6, -4.6); ctx.lineTo(-8.4, -3.2); ctx.lineTo(-4.4, -2.6); ctx.closePath(); ctx.fill();
  ctx.restore();
}

export function drawButterfly(ctx, s) {
  const w = Math.sin(s.phase * 2.4) * 0.75 + 0.25;      // wing openness
  ctx.save();
  ctx.rotate(Math.sin(s.phase * 0.7) * 0.15);
  ctx.fillStyle = s.color;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(1, 0.35 + 0.65 * w);
    ctx.beginPath(); ctx.ellipse(side * 3.1, -1, 3.2, 4.2, side * 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(1, 0.35 + 0.65 * w);
    ctx.beginPath(); ctx.arc(side * 3, -2, 1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#3a2a1c';
  ctx.beginPath(); ctx.ellipse(0, 0, 0.9, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawDuck(ctx, s) {
  const dip = s.state === 'dip' ? Math.max(0, Math.sin(s.phase * 1.6)) : 0;
  ctx.save();
  ctx.scale(s.face || 1, 1);
  // ripple
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.ellipse(0, 0.6, 7 + Math.sin(s.phase) * 1.2, 2.2, 0, 0, Math.PI * 2); ctx.stroke();
  // body
  ctx.fillStyle = s.color;
  ctx.beginPath(); ctx.ellipse(0, -2.6, 6.4, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath(); ctx.ellipse(-1.4, -2, 4.4, 2.2, 0.2, 0, Math.PI * 2); ctx.fill();
  // head (dips into water)
  const hy = -7 + dip * 6, hx = 4.6 - dip * 1.5;
  ctx.fillStyle = s.head;
  ctx.beginPath(); ctx.arc(hx, hy, 2.7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8a13c';
  ctx.beginPath(); ctx.moveTo(hx + 2.2, hy); ctx.lineTo(hx + 4.6, hy + 0.7); ctx.lineTo(hx + 2.2, hy + 1.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#20242a';
  ctx.beginPath(); ctx.arc(hx + 0.7, hy - 0.7, 0.55, 0, Math.PI * 2); ctx.fill();
  // tail
  ctx.fillStyle = s.head;
  ctx.beginPath(); ctx.moveTo(-5.6, -3.4); ctx.lineTo(-8.6, -5.2); ctx.lineTo(-5, -1.8); ctx.closePath(); ctx.fill();
  ctx.restore();
}

export function drawSquirrel(ctx, s) {
  const sit = s.state !== 'dash';
  ctx.save();
  ctx.scale(s.face || 1, 1);
  ctx.fillStyle = 'rgba(28,20,44,0.2)';
  ctx.beginPath(); ctx.ellipse(0, 0.6, 5, 1.7, 0, 0, Math.PI * 2); ctx.fill();
  // tail
  ctx.fillStyle = '#a05c2c';
  ctx.save();
  ctx.translate(-4.4, sit ? -4 : -3);
  ctx.rotate(sit ? -0.5 : -0.9);
  ctx.beginPath(); ctx.ellipse(0, -3, 2.6, 5.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c07840';
  ctx.beginPath(); ctx.ellipse(0.5, -3.6, 1.4, 3.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // body
  ctx.fillStyle = '#b06830';
  ctx.beginPath(); ctx.ellipse(0, sit ? -3.4 : -3, sit ? 3.4 : 4.6, sit ? 3.4 : 2.6, sit ? 0 : 0.2, 0, Math.PI * 2); ctx.fill();
  // head
  const hx = sit ? 2.6 : 4.4, hy = sit ? -6.6 : -4.4;
  ctx.fillStyle = '#b06830';
  ctx.beginPath(); ctx.arc(hx, hy, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a4f22';
  ctx.beginPath(); ctx.arc(hx - 0.6, hy - 2.2, 1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(hx + 1.2, hy - 2, 1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#20242a';
  ctx.beginPath(); ctx.arc(hx + 1, hy - 0.4, 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8d8c0';
  ctx.beginPath(); ctx.ellipse(hx + 0.4, hy + 1.2, 1.2, 0.9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
