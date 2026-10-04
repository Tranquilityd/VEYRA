// Veyra — world model: ground rendering, colliders, zones, ambient life
import { PAL } from '../visuals/Palette.js';
import { WORLD, GROUND_RECTS, ROADS, ROUNDABOUT, POND, COURT, PARK_PATHS, BUILDINGS, PROPS, PROP_SOLID, ZONES, FRONT_Y, PLAZA, POOL, STREAMS, BEDS, HEDGES, FENCES } from './cityMap.js';
import { mulberry32, rectsIntersect, TAU, makeCanvas } from '../core/util.js';

const FLOWER_THEMES = [
  ['#e86a8a', '#f2d14e', '#f5f2ea'],
  ['#b07fe8', '#f5f2ea', '#e86a8a'],
  ['#e8473b', '#f2d14e', '#ff8fb0'],
  ['#ff8fb0', '#ff5d73', '#f5f2ea'],
];

export class World {
  constructor(game) {
    this.game = game;
    this.w = WORLD.w;
    this.h = WORLD.h;
    this.colliders = this._buildColliders();
    // Close-fitting navigation envelopes around compound vertical monuments.
    // They are used only to choose walk-around corners; physical collision stays
    // defined by the detailed circle/ellipse/rect shapes above.
    this.navigationObstacles = [
      { x: 1218, y: 2438, w: 164, h: 230, id: 'litecoin-monument' },
      { x: 1204, y: 733,  w: 192, h: 244, id: 'bitcoin-monument' },
    ];
    this.lampGlows = PROPS.filter((p) => p.t === 'lamp').map((p) => ({ x: p.x, y: p.y - 84 }));
    this.trees = PROPS.filter((p) => p.t === 'tree' || p.t === 'palm');
    this._buildDetails();
    this.leaves = [];
    this._leafTimer = 0;
    this._cloud = makeCanvas(700, 460);
    const c = this._cloud.getContext('2d');
    const g = c.createRadialGradient(350, 230, 40, 350, 230, 330);
    g.addColorStop(0, 'rgba(24,34,28,0.13)');
    g.addColorStop(1, 'rgba(24,34,28,0)');
    c.fillStyle = g; c.fillRect(0, 0, 700, 460);
  }

  _buildColliders() {
    const col = [];
    for (const b of BUILDINGS) {
      const fy = b.frontY != null ? b.frontY : FRONT_Y;
      const pad = b.rot ? 30 : 0;
      col.push({ shape: 'rect', x: b.cx - b.w / 2 - pad, y: fy - 560, w: b.w + pad * 2, h: 560 });
    }
    col.push({ shape: 'ellipse', x: POND.x, y: POND.y, rx: POND.rx + 6, ry: POND.ry + 6 });
    col.push({ shape: 'circle', x: ROUNDABOUT.x, y: ROUNDABOUT.y, r: ROUNDABOUT.island + 8 });
    // Roundabout Bitcoin monument: compound visible silhouette for logo, support and dais.
    col.push({ shape: 'ellipse', x: ROUNDABOUT.x, y: ROUNDABOUT.y - 10, rx: 96, ry: 34, landmark: 'bitcoin-base' });
    col.push({ shape: 'rect', x: ROUNDABOUT.x - 45, y: ROUNDABOUT.y - 101, w: 90, h: 67, landmark: 'bitcoin-pedestal' });
    col.push({ shape: 'circle', x: ROUNDABOUT.x, y: ROUNDABOUT.y - 132, r: 55, landmark: 'bitcoin-logo' });
    // Entertainment Plaza Litecoin monument: close-fitting compound silhouette.
    // Shared world collision makes both Lester and NPC navigation respect it.
    col.push({ shape: 'ellipse', x: 1300, y: 2610, rx: 82, ry: 29, landmark: 'litecoin-base' });
    col.push({ shape: 'rect', x: 1261, y: 2542, w: 78, h: 54, landmark: 'litecoin-pedestal' });
    col.push({ shape: 'circle', x: 1300, y: 2508, r: 45, landmark: 'litecoin-logo' });
    // Phase 2: waterfall hill, pool, streams (with bridge gaps), fences, hedges
    col.push({ shape: 'rect', x: 700, y: 3060, w: 1200, h: 200 });
    col.push({ shape: 'ellipse', x: POOL.x, y: POOL.y, rx: POOL.rx + 4, ry: POOL.ry + 4 });
    col.push({ shape: 'rect', x: 390, y: 3300, w: 110, h: 40 });
    col.push({ shape: 'rect', x: 620, y: 3300, w: 380, h: 40 });
    col.push({ shape: 'rect', x: 1610, y: 3300, w: 160, h: 40 });
    col.push({ shape: 'rect', x: 1890, y: 3300, w: 190, h: 40 });
    for (const f of FENCES) {
      if (f.dir === 'h') col.push({ shape: 'rect', x: f.x, y: f.y - 5, w: f.len, h: 10 });
      else col.push({ shape: 'rect', x: f.x - 5, y: f.y, w: 10, h: f.len });
    }
    for (const h of HEDGES) col.push({ shape: 'rect', x: h.x - 2, y: h.y - 2, w: h.w + 4, h: h.h + 4 });
    for (const p of PROPS) {
      const s = PROP_SOLID[p.t];
      if (!s) continue;
      if (s.c) col.push({ shape: 'circle', x: p.x, y: p.y, r: s.c });
      else col.push({ shape: 'rect', x: p.x + s.r[0], y: p.y + s.r[1], w: s.r[2], h: s.r[3] });
    }
    return col;
  }

  _buildDetails() {
    const rnd = mulberry32(1337);
    this.speckles = [];
    this.flowers = [];
    for (const r of GROUND_RECTS) {
      if (r.t !== 'grass') continue;
      const n = Math.floor((r.w * r.h) / 5200);
      for (let i = 0; i < n; i++) {
        this.speckles.push({
          x: r.x + rnd() * r.w, y: r.y + rnd() * r.h,
          s: 1.5 + rnd() * 2.2,
          c: rnd() < 0.5 ? PAL.grassDark : (rnd() < 0.7 ? PAL.grassDry : PAL.grassAlt),
        });
      }
      const f = Math.floor(n / 14);
      for (let i = 0; i < f; i++) {
        this.flowers.push({
          x: r.x + rnd() * r.w, y: r.y + rnd() * r.h,
          c: ['#e86a8a', '#f2d14e', '#f5f2ea', '#b07fe8'][Math.floor(rnd() * 4)],
        });
      }
    }
    this.pads = [];
    for (let i = 0; i < 7; i++) {
      const a = rnd() * TAU, rr = 0.35 + rnd() * 0.55;
      this.pads.push({ x: POND.x + Math.cos(a) * POND.rx * rr, y: POND.y + Math.sin(a) * POND.ry * rr, r: 7 + rnd() * 5, a: rnd() * TAU });
    }
    // pavement wear speckles
    this.pavSpeck = [];
    for (const r of GROUND_RECTS) {
      if (r.t === 'grass') continue;
      const n = Math.floor((r.w * r.h) / 9000);
      for (let i = 0; i < n; i++) {
        this.pavSpeck.push({
          x: r.x + rnd() * r.w, y: r.y + rnd() * r.h, s: 1.4 + rnd() * 2.4,
          c: rnd() < 0.5 ? 'rgba(70,60,45,0.07)' : 'rgba(255,250,235,0.08)',
        });
      }
    }
    // asphalt patches
    this.patches = [];
    for (const r of ROADS) {
      const n = Math.floor((r.w * r.h) / 60000);
      for (let i = 0; i < n; i++) {
        this.patches.push({ x: r.x + rnd() * r.w, y: r.y + 20 + rnd() * (r.h - 40), rx: 18 + rnd() * 40, ry: 10 + rnd() * 18, a: 0.05 + rnd() * 0.05 });
      }
    }
  }

  isNavigationBlocked(x, y, radius = 12) {
    return (this.navigationObstacles || []).some(o => {
      const m = radius + 8;
      return x > o.x - m && x < o.x + o.w + m && y > o.y - m && y < o.y + o.h + m;
    });
  }

  planNavigationRoute(x, y, dest, radius = 12) {
    const segmentHits = (x1,y1,x2,y2,l,t,r,b) => {
      let lo=0,hi=1;const dx=x2-x1,dy=y2-y1;
      for(const [p,q] of [[-dx,x1-l],[dx,r-x1],[-dy,y1-t],[dy,b-y1]]){
        if(Math.abs(p)<1e-9){if(q<0)return false;continue;}const u=q/p;
        if(p<0){if(u>hi)return false;if(u>lo)lo=u;}else{if(u<lo)return false;if(u<hi)hi=u;}
      }return hi>=lo;
    };
    for (const o of this.navigationObstacles || []) {
      const m = radius + 8, gap = 14, l = o.x - m, r = o.x + o.w + m, t = o.y - m, b = o.y + o.h + m;
      const inside=x>l&&x<r&&y>t&&y<b;
      if(inside){const exits=[{x:l-gap,y},{x:r+gap,y},{x,y:t-gap},{x,y:b+gap}];exits.sort((a,b2)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b2.x-x,b2.y-y));return[exits[0]];}
      if(!segmentHits(x,y,dest.x,dest.y,l,t,r,b))continue;
      const L=l-gap,R=r+gap,T=t-gap,B=b+gap;
      // Tiny visibility graph around the four expanded corners. Unlike a
      // hard-coded opposite-side detour, this also handles diagonal approach,
      // same-side destinations and residents already very close to a statue.
      const nodes=[{x,y},{x:dest.x,y:dest.y},{x:L,y:T},{x:R,y:T},{x:R,y:B},{x:L,y:B}],n=nodes.length;
      const dist=Array(n).fill(Infinity),prev=Array(n).fill(-1),done=Array(n).fill(false);dist[0]=0;
      for(let k=0;k<n;k++){let u=-1;for(let i=0;i<n;i++)if(!done[i]&&(u<0||dist[i]<dist[u]))u=i;if(u<0||!Number.isFinite(dist[u]))break;done[u]=true;for(let v=0;v<n;v++){if(v===u||done[v])continue;const a=nodes[u],z=nodes[v];if(segmentHits(a.x,a.y,z.x,z.y,l,t,r,b))continue;const nd=dist[u]+Math.hypot(z.x-a.x,z.y-a.y);if(nd<dist[v]){dist[v]=nd;prev[v]=u;}}}
      if(!Number.isFinite(dist[1]))return null;const path=[];for(let u=1;u>0;u=prev[u])path.push(u);path.reverse();return path.slice(0,-1).map(i=>nodes[i]);
    }
    return null;
  }

  zoneAt(x, y) {
    for (const z of ZONES) {
      if (z.circle) {
        if (Math.hypot(x - z.circle.x, y - z.circle.y) <= z.circle.r) return z.name;
      } else if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z.name;
    }
    return 'Plaza District';
  }

  // circle-vs-world collision, resolved by pushing out
  collide(x, y, r) {
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.colliders) {
        if (c.shape === 'rect') {
          if (x + r < c.x || x - r > c.x + c.w || y + r < c.y || y - r > c.y + c.h) continue;
          const cx = Math.max(c.x, Math.min(x, c.x + c.w));
          const cy = Math.max(c.y, Math.min(y, c.y + c.h));
          let dx = x - cx, dy = y - cy;
          let d = Math.hypot(dx, dy);
          if (d < r) {
            if (d > 0.0001) { x = cx + dx / d * r; y = cy + dy / d * r; }
            else {
              // center inside rect: escape along the shallowest axis
              const dl = x - c.x, dr = c.x + c.w - x, dt2 = y - c.y, db = c.y + c.h - y;
              const m = Math.min(dl, dr, dt2, db);
              if (m === dl) x = c.x - r;
              else if (m === dr) x = c.x + c.w + r;
              else if (m === dt2) y = c.y - r;
              else y = c.y + c.h + r;
            }
          }
        } else if (c.shape === 'circle') {
          const dx = x - c.x, dy = y - c.y;
          const d = Math.hypot(dx, dy);
          if (d < c.r + r) {
            if (d > 0.0001) { x = c.x + dx / d * (c.r + r); y = c.y + dy / d * (c.r + r); }
            else x = c.x + c.r + r; // deterministic escape from exact centre
          }
        } else { // ellipse
          const rr = c.rx + r, ry2 = c.ry + r;
          const dx = x - c.x, dy = y - c.y;
          const e = (dx * dx) / (rr * rr) + (dy * dy) / (ry2 * ry2);
          if (e < 1) {
            const t = Math.atan2(dy / c.ry, dx / c.rx);
            x = c.x + Math.cos(t) * rr;
            y = c.y + Math.sin(t) * ry2;
          }
        }
      }
    }
    x = Math.max(20 + r, Math.min(this.w - 20 - r, x));
    y = Math.max(20 + r, Math.min(this.h - 20 - r, y));
    return { x, y };
  }

  // ---------------- ambient (stateless drift + tiny leaf pool) ----------------
  updateAmbient(dt, vr) {
    this._leafTimer -= dt;
    if (this._leafTimer <= 0 && this.leaves.length < 22) {
      this._leafTimer = 0.35 + Math.random() * 0.5;
      const t = this.trees[Math.floor(Math.random() * this.trees.length)];
      if (t && t.x > vr.x && t.x < vr.x + vr.w && t.y > vr.y && t.y < vr.y + vr.h) {
        this.leaves.push({ x: t.x + (Math.random() - 0.5) * 40, y: t.y - 60 - Math.random() * 30, life: 0, max: 3.5 + Math.random() * 2, ph: Math.random() * TAU, c: Math.random() < 0.7 ? PAL.leafMid : '#e8c44d' });
      }
    }
    for (const l of this.leaves) {
      l.life += dt;
      l.y += dt * 26;
      l.x += Math.sin(l.life * 2.2 + l.ph) * dt * 22;
    }
    this.leaves = this.leaves.filter((l) => l.life < l.max);
  }

  renderCloudShadows(ctx, vr, time) {
    for (let i = 0; i < 3; i++) {
      const x = ((time * 9 + i * 950) % (this.w + 900)) - 450;
      const y = 260 + i * 520 + Math.sin(time * 0.05 + i * 2) * 90;
      if (x + 700 < vr.x || x > vr.x + vr.w || y + 460 < vr.y || y > vr.y + vr.h) continue;
      ctx.drawImage(this._cloud, x, y);
    }
  }

  renderLeaves(ctx, vr, time) {
    for (const l of this.leaves) {
      const a = 1 - l.life / l.max;
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.ph + l.life * 3);
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = l.c;
      ctx.fillRect(-2.5, -1.5, 5, 3);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------- ground ----------------
  renderGround(ctx, vr, time) {
    ctx.fillStyle = PAL.grassBase;
    ctx.fillRect(vr.x, vr.y, vr.w, vr.h);

    for (const r of GROUND_RECTS) {
      if (!rectsIntersect(r, vr)) continue;
      ctx.fillStyle =
        r.t === 'grass' ? PAL.grassAlt :
        r.t === 'plaza' ? PAL.plaza :
        r.t === 'sidewalk' ? PAL.sidewalk :
        r.t === 'gravel' ? PAL.gravel :
        r.t === 'parking' ? '#3a3d43' :
        r.t === 'rockpad' ? '#6a6560' : PAL.pavement;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    // park gravel paths + pond ring
    ctx.fillStyle = PAL.gravel;
    for (const p of PARK_PATHS) if (rectsIntersect(p, vr)) ctx.fillRect(p.x, p.y, p.w, p.h);
    if (rectsIntersect({ x: POND.x - POND.rx - 40, y: POND.y - POND.ry - 40, w: POND.rx * 2 + 80, h: POND.ry * 2 + 80 }, vr)) {
      ctx.strokeStyle = PAL.gravel; ctx.lineWidth = 34;
      ctx.beginPath(); ctx.ellipse(POND.x, POND.y, POND.rx + 26, POND.ry + 26, 0, 0, TAU); ctx.stroke();
      this._renderPond(ctx, time);
    }

    // roads
    ctx.fillStyle = PAL.asphalt;
    for (const r of ROADS) if (rectsIntersect(r, vr)) ctx.fillRect(r.x, r.y, r.w, r.h);
    if (rectsIntersect({ x: ROUNDABOUT.x - ROUNDABOUT.r, y: ROUNDABOUT.y - ROUNDABOUT.r, w: ROUNDABOUT.r * 2, h: ROUNDABOUT.r * 2 }, vr)) {
      ctx.beginPath(); ctx.arc(ROUNDABOUT.x, ROUNDABOUT.y, ROUNDABOUT.r, 0, TAU); ctx.fill();
    }

    this._renderDistrict(ctx, vr, time);
    this._renderMarkings(ctx, vr);
    this._renderCourt(ctx, vr);
    this._renderIsland(ctx, vr);
    this._renderDetails(ctx, vr);

    // golden-hour directional grade across the ground (sun low, from the left)
    const gg = ctx.createLinearGradient(vr.x, 0, vr.x + vr.w, 0);
    gg.addColorStop(0, 'rgba(255,170,80,0.10)');
    gg.addColorStop(0.55, 'rgba(255,170,80,0.02)');
    gg.addColorStop(1, 'rgba(48,48,88,0.10)');
    ctx.fillStyle = gg;
    ctx.fillRect(vr.x, vr.y, vr.w, vr.h);
  }

  _renderPond(ctx, time) {
    const { x, y, rx, ry } = POND;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.closePath();
    const g = ctx.createLinearGradient(0, y - ry, 0, y + ry);
    g.addColorStop(0, PAL.waterTop); g.addColorStop(1, PAL.waterDeep);
    ctx.fillStyle = g; ctx.fill();
    ctx.clip();
    // glints
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 7; i++) {
      const px = x + Math.sin(time * 0.5 + i * 1.7) * rx * 0.7;
      const py = y + Math.cos(time * 0.4 + i * 2.3) * ry * 0.6;
      ctx.fillRect(px, py, 9, 2);
    }
    // lily pads
    for (const p of this.pads) {
      ctx.fillStyle = '#4f9a44';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, p.r, p.a + 0.5, p.a - 0.5); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = PAL.waterRim; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(x, y, rx + 2, ry + 2, 0, 0, TAU); ctx.stroke();
  }

  // ---------------- Phase 2: garden district ground ----------------
  _renderDistrict(ctx, vr, time) {
    // Entertainment Plaza disc
    if (rectsIntersect({ x: PLAZA.x - PLAZA.r, y: PLAZA.y - PLAZA.r, w: PLAZA.r * 2, h: PLAZA.r * 2 }, vr)) {
      ctx.fillStyle = PAL.plaza;
      ctx.beginPath(); ctx.arc(PLAZA.x, PLAZA.y, PLAZA.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(60,52,40,0.12)'; ctx.lineWidth = 2;
      for (let r = 60; r < PLAZA.r; r += 60) { ctx.beginPath(); ctx.arc(PLAZA.x, PLAZA.y, r, 0, TAU); ctx.stroke(); }
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        ctx.beginPath();
        ctx.moveTo(PLAZA.x + Math.cos(a) * 60, PLAZA.y + Math.sin(a) * 60);
        ctx.lineTo(PLAZA.x + Math.cos(a) * PLAZA.r, PLAZA.y + Math.sin(a) * PLAZA.r);
        ctx.stroke();
      }
      ctx.strokeStyle = '#b8b0a1'; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(PLAZA.x, PLAZA.y, PLAZA.r - 5, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#b8b0a1';
      ctx.beginPath(); ctx.arc(PLAZA.x, PLAZA.y, 46, 0, TAU); ctx.fill();
    }
    // flower parterres / rose beds
    for (const b of BEDS) {
      if (!rectsIntersect(b, vr)) continue;
      ctx.fillStyle = '#6b4a33';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = PAL.leafDark; ctx.lineWidth = 5;
      ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
      const cols = FLOWER_THEMES[b.theme % FLOWER_THEMES.length];
      let i = 0;
      for (let y = b.y + 8; y < b.y + b.h - 4; y += 14) {
        for (let x = b.x + 7; x < b.x + b.w - 4; x += 14) {
          ctx.fillStyle = cols[(i++) % cols.length];
          ctx.fillRect(x, y, 4, 4);
        }
      }
    }
    // hedge rows
    for (const h of HEDGES) {
      if (!rectsIntersect(h, vr)) continue;
      ctx.fillStyle = PAL.leafDark;
      ctx.fillRect(h.x, h.y, h.w, h.h);
      ctx.fillStyle = PAL.leafMid;
      ctx.fillRect(h.x, h.y, h.w, Math.max(3, h.h * 0.45));
      ctx.fillStyle = 'rgba(255,240,180,0.18)';
      ctx.fillRect(h.x, h.y, h.w, 2);
    }
    // parking bay lines
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let x = 220; x <= 640; x += 70) ctx.fillRect(x, 3695, 3, 90);
    for (let x = 1970; x <= 2390; x += 70) ctx.fillRect(x, 3695, 3, 90);
    // district road markings
    ctx.fillStyle = PAL.yellow; ctx.globalAlpha = 0.85;
    ctx.fillRect(0, 1876, 2600, 3); ctx.fillRect(0, 1882, 2600, 3);
    ctx.fillRect(216, 1960, 3, 1520); ctx.fillRect(222, 1960, 3, 1520);
    ctx.fillRect(2376, 1960, 3, 1520); ctx.fillRect(2382, 1960, 3, 1520);
    ctx.fillRect(120, 3576, 580, 3); ctx.fillRect(120, 3582, 580, 3);
    ctx.fillRect(1900, 3576, 580, 3); ctx.fillRect(1900, 3582, 580, 3);
    ctx.fillRect(1296, 2880, 3, 180); ctx.fillRect(1302, 2880, 3, 180);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = PAL.marking;
    for (let x = 0; x < 2600; x += 64) { ctx.fillRect(x, 1838, 30, 3); ctx.fillRect(x, 1916, 30, 3); }
    for (let y = 1960; y < 3480; y += 64) { ctx.fillRect(178, y, 3, 30); ctx.fillRect(2442, y, 3, 30); }
    ctx.globalAlpha = 0.68;
    for (let x = 1186; x < 1420; x += 30) { ctx.fillRect(x, 2886, 16, 44); }
    ctx.globalAlpha = 1;
    // streams, pool, wet banks
    this._renderWaterDistrict(ctx, vr, time);
    // terrace steps up from the pool edge (south side)
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(POOL.x, POOL.y + POOL.ry + 6 + i * 7, POOL.rx + 26 + i * 18, 24 + i * 8, 0, 0, Math.PI);
      ctx.stroke();
    }
  }

  _renderWaterDistrict(ctx, vr, time) {
    for (const s of STREAMS) {
      if (!rectsIntersect(s, vr)) continue;
      const g = ctx.createLinearGradient(0, s.y, 0, s.y + s.h);
      g.addColorStop(0, PAL.waterTop); g.addColorStop(1, PAL.waterDeep);
      ctx.fillStyle = g;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeStyle = PAL.waterRim; ctx.lineWidth = 4;
      ctx.strokeRect(s.x, s.y - 2, s.w, s.h + 4);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      for (let i = 0; i < 8; i++) {
        const fx = s.x + ((time * 40 + i * 83) % s.w);
        ctx.fillRect(fx, s.y + 8 + (i % 3) * 10, 10, 2);
      }
      ctx.fillStyle = 'rgba(40,44,40,0.25)';
      ctx.fillRect(s.x, s.y - 8, s.w, 6);
      ctx.fillRect(s.x, s.y + s.h + 2, s.w, 6);
    }
    const pb = { x: POOL.x - POOL.rx - 40, y: POOL.y - POOL.ry - 40, w: POOL.rx * 2 + 80, h: POOL.ry * 2 + 80 };
    if (rectsIntersect(pb, vr)) {
      ctx.fillStyle = 'rgba(38,42,40,0.30)';
      ctx.beginPath(); ctx.ellipse(POOL.x, POOL.y, POOL.rx + 26, POOL.ry + 22, 0, 0, TAU); ctx.fill();
      const g = ctx.createLinearGradient(0, POOL.y - POOL.ry, 0, POOL.y + POOL.ry);
      g.addColorStop(0, PAL.waterTop); g.addColorStop(1, PAL.waterDeep);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(POOL.x, POOL.y, POOL.rx, POOL.ry, 0, 0, TAU); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.ellipse(POOL.x, POOL.y, POOL.rx, POOL.ry, 0, 0, TAU); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      for (let i = 0; i < 8; i++) {
        const px = POOL.x + Math.sin(time * 0.5 + i * 1.9) * POOL.rx * 0.75;
        const py = POOL.y + Math.cos(time * 0.4 + i * 2.5) * POOL.ry * 0.6;
        ctx.fillRect(px, py, 12, 2);
      }
      ctx.restore();
      ctx.strokeStyle = '#8d8779'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.ellipse(POOL.x, POOL.y, POOL.rx + 2, POOL.ry + 2, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#7c776e';
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        ctx.beginPath();
        ctx.arc(POOL.x + Math.cos(a) * (POOL.rx + 7), POOL.y + Math.sin(a) * (POOL.ry + 7), 5 + (i % 3) * 2, 0, TAU);
        ctx.fill();
      }
    }
  }

  _renderMarkings(ctx, vr) {
    const R = ROUNDABOUT;
    // curbs: light cap outside + dark gutter inside
    for (const r of ROADS) {
      if (!rectsIntersect(r, vr)) continue;
      ctx.strokeStyle = PAL.curb; ctx.lineWidth = 4; ctx.globalAlpha = 0.9;
      ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
      ctx.strokeStyle = 'rgba(18,20,24,0.55)'; ctx.lineWidth = 2.5;
      ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
    }
    ctx.strokeStyle = PAL.curb; ctx.lineWidth = 8; ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.arc(R.x, R.y, R.r - 3, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(18,20,24,0.5)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(R.x, R.y, R.r - 9, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(18,20,24,0.22)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(R.x, R.y, R.r + 2, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;

    const hSegs = [[0, 1120], [1480, 2600]];     // horizontal road x-segments (skip roundabout)
    const vSegs = [[0, 740], [1140, 1800]];      // vertical road y-segments
    // double yellow center lines
    ctx.fillStyle = PAL.yellow; ctx.globalAlpha = 0.9;
    for (const [a, b] of hSegs) { ctx.fillRect(a, 936, b - a, 3); ctx.fillRect(a, 942, b - a, 3); }
    for (const [a, b] of vSegs) { ctx.fillRect(1296, a, 3, b - a); ctx.fillRect(1302, a, 3, b - a); }
    // lane dashes
    ctx.fillStyle = PAL.marking; ctx.globalAlpha = 0.75;
    for (const [a, b] of hSegs) for (let x = a; x < b; x += 64) { ctx.fillRect(x, 878, 30, 3); ctx.fillRect(x, 1000, 30, 3); }
    for (const [a, b] of vSegs) for (let y = a; y < b; y += 64) { ctx.fillRect(1238, y, 3, 30); ctx.fillRect(1360, y, 3, 30); }
    // crosswalks (4 approaches)
    ctx.globalAlpha = 0.68;
    for (let x = 1186; x < 1420; x += 30) { ctx.fillRect(x, 757, 16, 51); ctx.fillRect(x, 1072, 16, 51); }
    for (let y = 826; y < 1060; y += 30) { ctx.fillRect(897, y, 51, 16); ctx.fillRect(1652, y, 51, 16); }
    // parking bays + manholes
    ctx.globalAlpha = 0.65;
    for (let x = 240; x <= 640; x += 80) ctx.fillRect(x, 822, 3, 58);
    for (let x = 1900; x <= 2300; x += 80) ctx.fillRect(x, 1000, 3, 58);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#2b2e33';
    ctx.beginPath(); ctx.arc(700, 960, 9, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(1900, 900, 9, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  _renderCourt(ctx, vr) {
    const c = COURT;
    if (!rectsIntersect(c, vr)) return;
    ctx.fillStyle = '#3a7ca5';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3;
    ctx.strokeRect(c.x + 10, c.y + 10, c.w - 20, c.h - 20);
    ctx.beginPath(); ctx.moveTo(c.x + c.w / 2, c.y + 10); ctx.lineTo(c.x + c.w / 2, c.y + c.h - 10); ctx.stroke();
    ctx.beginPath(); ctx.arc(c.x + c.w / 2, c.y + c.h / 2, 42, 0, TAU); ctx.stroke();
    ctx.strokeRect(c.x + 10, c.y + c.h / 2 - 60, 55, 120);
    ctx.strokeRect(c.x + c.w - 65, c.y + c.h / 2 - 60, 55, 120);
  }

  _renderIsland(ctx, vr) {
    const R = ROUNDABOUT;
    if (!rectsIntersect({ x: R.x - R.island - 12, y: R.y - R.island - 12, w: R.island * 2 + 24, h: R.island * 2 + 24 }, vr)) return;
    ctx.fillStyle = PAL.grassAlt;
    ctx.beginPath(); ctx.arc(R.x, R.y, R.island, 0, TAU); ctx.fill();
    ctx.strokeStyle = PAL.leafDark; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(R.x, R.y, R.island - 5, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#4a8a3c';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.3;
      ctx.beginPath(); ctx.arc(R.x + Math.cos(a) * 68, R.y + Math.sin(a) * 68, 6, 0, TAU); ctx.fill();
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      ctx.fillStyle = i % 2 ? '#e86a8a' : '#f2d14e';
      ctx.beginPath(); ctx.arc(R.x + Math.cos(a) * 60, R.y + Math.sin(a) * 60, 3.4, 0, TAU); ctx.fill();
    }
  }

  _renderDetails(ctx, vr) {
    // mown lawn bands on grass
    ctx.fillStyle = 'rgba(255,255,240,0.045)';
    for (const r of GROUND_RECTS) {
      if (r.t !== 'grass' || !rectsIntersect(r, vr)) continue;
      for (let y = r.y; y < r.y + r.h; y += 120) ctx.fillRect(r.x, y, r.w, 60);
    }
    // asphalt patches
    for (const p of this.patches) {
      if (p.x < vr.x - 60 || p.x > vr.x + vr.w + 60 || p.y < vr.y - 40 || p.y > vr.y + vr.h + 40) continue;
      ctx.fillStyle = `rgba(20,22,26,${p.a.toFixed(3)})`;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, TAU); ctx.fill();
    }
    // pavement wear
    for (const s of this.pavSpeck) {
      if (s.x < vr.x || s.x > vr.x + vr.w || s.y < vr.y || s.y > vr.y + vr.h) continue;
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    // pavement joints
    ctx.strokeStyle = PAL.joint; ctx.lineWidth = 1;
    for (const r of GROUND_RECTS) {
      if (r.t === 'grass' || !rectsIntersect(r, vr)) continue;
      const x0 = Math.max(r.x, vr.x), x1 = Math.min(r.x + r.w, vr.x + vr.w);
      const y0 = Math.max(r.y, vr.y), y1 = Math.min(r.y + r.h, vr.y + vr.h);
      ctx.beginPath();
      for (let x = Math.ceil(x0 / 64) * 64; x < x1; x += 64) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      for (let y = Math.ceil(y0 / 64) * 64; y < y1; y += 64) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.stroke();
    }
    // grass speckles + flowers (culled)
    for (const s of this.speckles) {
      if (s.x < vr.x || s.x > vr.x + vr.w || s.y < vr.y || s.y > vr.y + vr.h) continue;
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    for (const f of this.flowers) {
      if (f.x < vr.x || f.x > vr.x + vr.w || f.y < vr.y || f.y > vr.y + vr.h) continue;
      ctx.fillStyle = f.c;
      ctx.fillRect(f.x, f.y, 2.6, 2.6);
    }
  }
}
