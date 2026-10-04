// Veyra — boot state: bake procedural sprites, load Lester's artwork, then menu
import { SpriteCache } from '../visuals/SpriteCache.js';
import { loadLester, lesterReady } from '../entities/LesterRig.js';

export class BootState {
  constructor(game) { this.game = game; this.name = 'boot'; this.t = 0; }
  enter() {
    this.t = 0;
    if (!BootState.baked) {
      SpriteCache.bakeAll();
      BootState.baked = true;
    }
    if (!BootState.lesterLoad) BootState.lesterLoad = loadLester();
  }
  update(dt, time) {
    this.t += dt;
    const lesterOk = lesterReady() || this.t > 2.5;   // never block boot on network
    if (this.t > 0.75 && lesterOk) {
      const splash = document.getElementById('boot-splash');
      if (splash) splash.classList.add('done');
      this.game.states.set('menu');
    }
  }
  render(ctx, view) {
    ctx.setTransform(this.game.dpr, 0, 0, this.game.dpr, 0, 0);
    ctx.fillStyle = '#0d1420';
    ctx.fillRect(0, 0, view.w, view.h);
  }
}
