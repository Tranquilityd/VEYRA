// Veyra — baked sprite cache: procedural art rendered once, drawn as images (mobile-fast)
import { makeCanvas } from '../core/util.js';
import { paintBuilding } from './BuildingPainter.js';
import { paintProp } from './PropPainter.js';
import { bakeCasino } from './CasinoPainter.js';
import { bakeArcade } from './ArcadePainter.js';
import { BUILDINGS } from '../world/cityMap.js';

const cache = new Map();

export const SpriteCache = {
  makeCanvas,
  get(key) { return cache.get(key) || null; },
  getOrMake(key, maker) {
    let v = cache.get(key);
    if (!v) { v = maker(); cache.set(key, v); }
    return v;
  },
  building(def) {
    return this.getOrMake('bld:' + def.id, () => paintBuilding(def));
  },
  prop(type, variant = 0, flip = false) {
    return this.getOrMake(`prop:${type}:${variant}:${flip ? 1 : 0}`, () => paintProp(type, variant, flip));
  },
  glow(key, size, stops) {
    return this.getOrMake('glow:' + key, () => {
      const c = makeCanvas(size, size);
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
      for (const [o, col] of stops) grad.addColorStop(o, col);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      return c;
    });
  },
  // pre-bake everything so first frame is hitch-free
  bakeAll() {
    for (const b of BUILDINGS) {
      if (b.venue === 'casino') bakeCasino(b);
      else if (b.venue === 'arcade') bakeArcade(b);
      else this.building(b);
    }
    const kinds = [
      ['tree', 3], ['palm', 1], ['lamp', 1], ['bench', 1], ['planter', 3], ['bin', 1],
      ['hydrant', 1], ['bike', 1], ['parasol', 1], ['busstop', 1], ['car', 3], ['carF', 3],
      ['gazebo', 1], ['dock', 1], ['hoop', 1], ['arch', 1], ['fountain', 1],
      ['rock', 3], ['topiary', 1], ['shrub', 1], ['bollard', 1], ['bridge', 1],
      ['pergola', 1], ['sculpture', 1], ['tower', 3], ['fenceH', 1], ['fenceV', 1],
    ];
    for (const [k, n] of kinds) for (let i = 0; i < n; i++) {
      if (k === 'carF') this.prop('car', i, true);
      else this.prop(k, i);
    }
    this.lampGlow();
  },
  lampGlow() {
    return this.glow('lamp', 190, [[0, 'rgba(255,204,140,0.42)'], [0.28, 'rgba(255,170,90,0.14)'], [1, 'rgba(255,170,90,0)']]);
  },
  count() { return cache.size; }
};
