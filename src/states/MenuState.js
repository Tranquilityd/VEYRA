// Veyra — menu state: cinematic attract-mode camera drifting over the live city
import { EntityManager } from '../world/EntityManager.js';
import { Camera } from '../world/Camera.js';
import { buildCity } from '../entities/buildCity.js';
import { renderScene } from './worldRender.js';
import { damp, lerp } from '../core/util.js';

export class MenuState {
  constructor(game) { this.game = game; this.name = 'menu'; this.model = null; this.camera = null; }
  enter() {
    if (!this.model) {
      const em = new EntityManager();
      this.model = buildCity(this.game, em, { withPlayer: false });
      this.em = em;
      this.model.em = em;
      this.camera = new Camera(this.model.world);
      this.camera.snapTo(1300, 1240);
    }
    this.game.ui.showMenu();
  }
  update(dt, time) {
    const view = this.game.view;
    this.camera.setZoomForView(view.w, view.h);
    this.camera.zoom *= 1.04;
    // attract tour: Phase 1 plaza, then the Phase 2 garden district
    const cycle = Math.floor(time / 26) % 2;
    let tx, ty;
    if (cycle === 0) { tx = 1300 + Math.cos(time * 0.05) * 300; ty = 760 + Math.sin(time * 0.05) * 90; }
    else { tx = 1300 + Math.cos(time * 0.06) * 240; ty = 2660 + Math.sin(time * 0.06) * 170; }
    const k = damp(1.4, dt);
    this.camera.x = lerp(this.camera.x, tx, k);
    this.camera.y = lerp(this.camera.y, ty, k);
    this.camera.clampToWorld(view);
    this.model.world.updateAmbient(dt, this.camera.viewRect(view));
  }
  render(ctx, view, time) {
    renderScene(this.game, ctx, view, time, this.model, this.camera);
  }
}
