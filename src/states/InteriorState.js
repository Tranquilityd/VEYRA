// Veyra — Phase 5 interior state: loads a venue lobby from the interiors
// registry (placeholder lobbies now, final floors later) and lets Lester walk
// around and leave through the exit door via the same interaction system.
import { Camera } from '../world/Camera.js';
import { EntityManager } from '../world/EntityManager.js';
import { InteriorWorld } from '../world/InteriorWorld.js';
import { InteractionSystem } from '../systems/InteractionSystem.js';
import { Player } from '../entities/Player.js';
import { getInterior } from '../world/interiors.js';
import { buildCasinoFloor } from '../systems/CasinoFloor.js';
import { buildArcadeFloor } from '../systems/ArcadeFloor.js';
import { renderScene, drawInteractPrompt, drawStick } from './worldRender.js';
import { damp } from '../core/util.js';

export class InteriorState {
  constructor(game) {
    this.game = game;
    this.name = 'interior';
    this.venueId = '';
    this.def = null;
    this.model = null;
    this.camera = null;
    this.interactions = new InteractionSystem(game.events);
  }

  enter(params = {}) {
    const id = params.venue || 'casino';
    const def = getInterior(id);
    if (!def) { this.game.states.set('play'); return; }
    this.venueId = id;
    this.def = def;
    this.world = new InteriorWorld(def);
    this.em = new EntityManager();
    this.player = new Player(def.spawn.x, def.spawn.y);
    this.player.facing = 'up';
    this.em.add(this.player);
    this.model = { world: this.world, em: this.em, player: this.player };
    this.camera = new Camera(this.world);
    this.camera.snapTo(this.player.x, this.player.y - 26);
    this.interactions.clear();
    // Phase 6: the casino floor is a living room (machines, guests, regular)
    this.floor = id === 'casino' ? buildCasinoFloor(this.game, this)
      : id === 'arcade' ? buildArcadeFloor(this.game, this) : null;
    // Venue entry is free. zkLTC balances are never fabricated or comped locally.
    if (id === 'casino') this.game.audio.startCasino();
    if (id === 'arcade') this.game.audio.startArcade();
    this.camPush = 1; this._pushCur = 1;
    this._ovOpen = () => { this.camPush = 1.07; };        // subtle push into the machine
    this._ovClose = () => { this.camPush = 1; };
    this._unOv = [this.game.events.on('overlay:open', this._ovOpen), this.game.events.on('overlay:close', this._ovClose)];
    this.interactions.register({
      id: 'exit-' + id,
      x: def.exit.x, y: def.exit.y, radius: def.exit.radius,
      getLabel: () => def.exit.label,
      onInteract: (p, g) => { g.exitVenue(); },
    });
    this.game.ui.showPlay();
    this.game.ui.setZone(def.zoneName);
  }

  exit() {
    if (this._unOv) { this._unOv.forEach((fn) => fn()); this._unOv = null; }
    this.game.audio.stopCasino();
    this.game.audio.stopArcade();
    if (this.game.overlay.openId) this.game.overlay.close();
    this.floor = null;
    this.game.ui.showPause(false);
    this.game.ui.hideAll();
  }

  _footsteps(p, dt) {
    if (!p.moving || p.seated) { this._stepD = 0; return; }
    this._stepD = (this._stepD || 0) + Math.hypot(p.vx, p.vy) * dt;
    const cad = this.game.input.sprint ? 74 : 46;
    if (this._stepD > cad) { this._stepD = 0; this.game.audio.play('step'); }
  }

  update(dt, time) {
    const view = this.game.view;
    const input = this.game.input;
    this.player.update(dt, time, input, this.world);
    this._footsteps(this.player, dt);
    this.camera.setZoomForView(view.w, view.h);
    this.camera.lookX = input.axis.x * 26;
    this.camera.lookY = input.axis.y * 18;
    this.camera.follow(this.player.x, this.player.y - 26, dt, view);
    if (this.camPush && this.camPush !== 1 || (this._pushCur || 1) !== 1) {
      this._pushCur = (this._pushCur || 1) + ((this.camPush || 1) - (this._pushCur || 1)) * damp(6, dt);
      if (Math.abs(this._pushCur - 1) < 0.002) this._pushCur = this.camPush || 1;
      this.camera.zoom *= this._pushCur;
    }
    const vr = this.camera.viewRect(view);
    this.em.update(dt, time, vr);
    if (this.floor) this.floor.update(dt, time, vr, this.player);
    this.interactions.update(this.player, input, this.game);
    this.game.ui.setInteract(!!this.interactions.current);
  }

  render(ctx, view, time) {
    renderScene(this.game, ctx, view, time, this.model, this.camera, { noLighting: true });
    this.def.grade(ctx, view, time);
    const item = this.interactions.current;
    if (item) drawInteractPrompt(ctx, view, this.camera, item, this.player);
    drawStick(ctx, this.game.input);
  }
}
