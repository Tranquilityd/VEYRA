// Veyra — shared scene render pipeline (used by menu attract-mode, play and interiors)
import { roundRectPath } from '../core/util.js';
import { isTouch } from '../core/device.js';

export function renderScene(game, ctx, view, time, model, camera, opts = {}) {
  ctx.setTransform(game.dpr, 0, 0, game.dpr, 0, 0);
  ctx.fillStyle = '#0d1420';
  ctx.fillRect(0, 0, view.w, view.h);

  ctx.save();
  camera.apply(ctx, view);
  const vr = camera.viewRect(view);
  model.world.renderGround(ctx, vr, time);
  model.world.renderCloudShadows(ctx, vr, time);
  const visible = model.em.render(ctx, vr, time);
  model.world.renderLeaves(ctx, vr, time);
  if (!opts.noLighting) game.lighting.renderWorld(ctx, model.world, vr);
  ctx.restore();

  if (!opts.noLighting) game.lighting.renderScreen(ctx, view);
  return visible;
}

// interaction bubble (key badge + label) anchored above an item — shared by
// PlayState and InteriorState
export function drawInteractPrompt(ctx, view, camera, item, player) {
  if (!item) return;
  const label = item.getLabel(player);
  const hint = isTouch ? 'A' : 'E';
  const seatedHere = !!(player?.seated && item.bench === player.seated);
  // Keep the Stand up prompt above Lester's helmet instead of covering his face.
  const p = camera.worldToScreen(item.x, item.y - (seatedHere ? 112 : 56), view);
  ctx.save();
  ctx.font = '700 13px Exo 2, system-ui, sans-serif';
  const tw = ctx.measureText(label).width;
  const bw = tw + 62, bh = 32;
  const bx = p.x - bw / 2, by = p.y - bh / 2;
  ctx.fillStyle = 'rgba(10,14,22,0.85)';
  roundRectPath(ctx, bx, by, bw, bh, 16); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.4;
  roundRectPath(ctx, bx, by, bw, bh, 16); ctx.stroke();
  // pointer
  ctx.fillStyle = 'rgba(10,14,22,0.85)';
  ctx.beginPath(); ctx.moveTo(p.x - 6, by + bh - 1); ctx.lineTo(p.x + 6, by + bh - 1); ctx.lineTo(p.x, by + bh + 7); ctx.closePath(); ctx.fill();
  // key badge
  ctx.fillStyle = '#35e0ff';
  ctx.beginPath(); ctx.arc(bx + 17, p.y, 10.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#06121f';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 12px Exo 2, system-ui, sans-serif';
  ctx.fillText(hint, bx + 17, p.y + 1);
  ctx.fillStyle = '#eaf2ff';
  ctx.font = '700 13px Exo 2, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, bx + 33, p.y + 1);
  ctx.restore();
}

// polished virtual joystick, bottom-left (touch devices only)
export function drawStick(ctx, input) {
  if (!isTouch) return;
  const s = input.stick;
  input.stickFade += ((s.active && !input.locked ? 1 : 0) - input.stickFade) * 0.25;
  if (input.stickVis == null) input.stickVis = 1;
  input.stickVis += ((input.locked ? 0 : 1) - input.stickVis) * 0.25;   // hidden while a game overlay is open
  if (input.stickVis < 0.02) { ctx.save(); ctx.restore(); return; }
  const b = input.stickBase();
  const f = input.stickFade;
  const R = input.STICK_RADIUS;
  ctx.save();
  ctx.globalAlpha = (0.55 + 0.45 * f) * input.stickVis;

  // base plate
  const g = ctx.createRadialGradient(b.x, b.y, R * 0.2, b.x, b.y, R);
  g.addColorStop(0, 'rgba(16,24,38,0.42)');
  g.addColorStop(1, 'rgba(10,14,22,0.28)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${0.26 + 0.22 * f})`; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(b.x, b.y, R - 1, 0, Math.PI * 2); ctx.stroke();
  // inner guide ring
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(b.x, b.y, R * 0.55, 0, Math.PI * 2); ctx.stroke();
  // direction ticks
  ctx.strokeStyle = `rgba(140,225,255,${0.25 + 0.35 * f})`; ctx.lineWidth = 2.4;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(b.x + Math.cos(a) * (R - 9), b.y + Math.sin(a) * (R - 9));
    ctx.lineTo(b.x + Math.cos(a) * (R - 3), b.y + Math.sin(a) * (R - 3));
    ctx.stroke();
  }

  // thumb knob
  const kx = b.x + s.dx, ky = b.y + s.dy;
  const kg = ctx.createRadialGradient(kx - 7, ky - 9, 3, kx, ky, 26);
  kg.addColorStop(0, `rgba(255,255,255,${0.75 + 0.2 * f})`);
  kg.addColorStop(0.55, `rgba(160,225,255,${0.42 + 0.25 * f})`);
  kg.addColorStop(1, 'rgba(70,140,190,0.30)');
  ctx.fillStyle = kg;
  ctx.beginPath(); ctx.arc(kx, ky, 25, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.3 * f})`; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(kx, ky, 25, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
