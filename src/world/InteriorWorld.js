// Veyra — Phase 5 mini-world for venue interiors: implements the same surface
// renderScene/Player/Camera consume (renderGround, collide, lampGlows, …) so an
// interior swaps in without touching the render pipeline.
export class InteriorWorld {
  constructor(def) {
    this.def = def;
    this.w = 1600;
    this.h = 1200;
    const r = def.room, t = 26;
    this.colliders = [
      { shape: 'rect', x: r.x - t, y: r.y - t, w: r.w + t * 2, h: t },        // north wall
      { shape: 'rect', x: r.x - t, y: r.y + r.h, w: r.w + t * 2, h: t },      // south wall
      { shape: 'rect', x: r.x - t, y: r.y, w: t, h: r.h },                    // west wall
      { shape: 'rect', x: r.x + r.w, y: r.y, w: t, h: r.h },                  // east wall
    ];
    if (def.boardCollider) this.colliders.push(def.boardCollider);
    if (def.extraColliders) this.colliders.push(...def.extraColliders);
    this.lampGlows = [];
  }

  // rect-only variant of World.collide (same contract: returns adjusted {x, y})
  collide(x, y, r) {
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.colliders) {
        if (c.shape === 'circle') {
          const ddx = x - c.x, ddy = y - c.y;
          const dd = Math.hypot(ddx, ddy);
          if (dd < c.r + r && dd > 0.0001) { x = c.x + (ddx / dd) * (c.r + r); y = c.y + (ddy / dd) * (c.r + r); }
          continue;
        }
        if (x + r < c.x || x - r > c.x + c.w || y + r < c.y || y - r > c.y + c.h) continue;
        const cx = Math.max(c.x, Math.min(x, c.x + c.w));
        const cy = Math.max(c.y, Math.min(y, c.y + c.h));
        const dx = x - cx, dy = y - cy;
        const d = Math.hypot(dx, dy);
        if (d < r) {
          if (d > 0.0001) { x = cx + (dx / d) * r; y = cy + (dy / d) * r; }
          else {
            const dl = x - c.x, dr = c.x + c.w - x, dt2 = y - c.y, db = c.y + c.h - y;
            const m = Math.min(dl, dr, dt2, db);
            if (m === dl) x = c.x - r;
            else if (m === dr) x = c.x + c.w + r;
            else if (m === dt2) y = c.y - r;
            else y = c.y + c.h + r;
          }
        }
      }
    }
    return { x, y };
  }

  renderGround(ctx, vr, time) {
    ctx.fillStyle = '#05060c';
    ctx.fillRect(vr.x, vr.y, vr.w, vr.h);
    this.def.drawRoom(ctx, time);
  }
  renderCloudShadows() {}
  renderLeaves() {}
  updateAmbient() {}
  zoneAt() { return ''; }
}
