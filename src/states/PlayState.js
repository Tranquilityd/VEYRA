// Veyra — play state: exploration, camera follow, interactions, HUD
import { EntityManager } from '../world/EntityManager.js';
import { Camera } from '../world/Camera.js';
import { buildCity } from '../entities/buildCity.js';
import { InteractionSystem } from '../systems/InteractionSystem.js';
import { renderScene, drawInteractPrompt, drawStick } from './worldRender.js';
import { BasketballGame } from '../systems/BasketballGame.js';
import { WorldEntrySequence } from '../systems/WorldEntrySequence.js';

export class PlayState {
  constructor(game) {
    this.game = game;
    this.name = 'play';
    this.paused = false;
    this.model = null;
    this.camera = null;
    this.em = null;
    this.interactions = new InteractionSystem(game.events);
    this.zone = '';
    this.visibleCount = 0;
    this.basketball = new BasketballGame(game);
    this.worldEntry = null;
  }

  enter(params = {}) {
    if (!this.model || params.fresh) {
      if (this.em) this.em.clear();
      this.interactions.clear();
      this.em = new EntityManager();
      this.model = buildCity(this.game, this.em, { withPlayer: true });
      this.model.em = this.em;
      this.camera = new Camera(this.model.world);
      this.camera.snapTo(this.model.player.x, this.model.player.y - 60);
      this._registerBenches();
      this._registerNpcs();
      this._registerVenues();
      this._registerBasketball();
      this.zone = '';
    }
    this.paused = false;
    if(this.worldEntry)this.worldEntry.cleanup();
    this.worldEntry=params.fresh?new WorldEntrySequence(this.game,this,params.worldEntryStartedAt||performance.now()):null;
    this.game.ui.showPlay();
    this.game.ui.setZone(this.zone);
  }

  exit() {
    if(this.worldEntry){this.worldEntry.cleanup();this.worldEntry=null;}
    if (this.basketball.active) this.basketball.stop(false);
    this.game.ui.showPause(false);
    this.game.ui.hideAll();
  }

  _registerBenches() {
    for (const b of this.em.queryType('bench')) {
      this.interactions.register({
        id: 'sit-' + b.x + '-' + b.y,
        x: b.x, y: b.y + 8, radius: 54, bench: b,
        getLabel: (p) => (p.seated === b ? 'Stand up' : 'Sit down'),
        onInteract: (p, g) => {
          if (p.seated === b) { p.stand(); g.audio.play('stand'); }
          else { p.stand(); p.sit(b); g.audio.play('sit'); }
        },
      });
    }
  }

  _registerNpcs() {
    for (const npc of this.model.npcs || []) {
      const item = {
        id: 'talk-' + npc.dialogueId,
        radius: 46,
        npc,
        get x() { return npc.x; },
        get y() { return npc.y; },
        getLabel: () => (npc.say?.fact ? 'Source' : (npc.wave > 0 ? '…' : 'Talk')),
        onInteract: (p, g) => {
          if (npc.say?.fact?.sourceUrl) {
            window.open(npc.say.fact.sourceUrl, '_blank', 'noopener,noreferrer');
            return npc.dialogueId;
          }
          const id = npc.interact(p);
          const fact = npc.config.knowledgeDeck?.nextFact();
          if (fact) npc.say = { text: fact.fact, fact, ttl: 9, age: 0 };
          g.audio.play('click');
          return id;
        },
      };
      this.interactions.register(item);
    }
  }

  _registerBasketball() {
    this.interactions.register({
      id: 'play-basketball', x: 1950, y: 1400, radius: 215,
      getLabel: () => 'Play Basketball',
      onInteract: (p) => { this.basketball.start(p); return 'basketball'; },
    });
  }

  // Phase 5: building entrances — intentional ENTER interaction only
  _registerVenues() {
    for (const v of this.model.venues || []) {
      const cfg = v.config;
      this.interactions.register({
        id: 'enter-' + v.venueId,
        x: cfg.entrance.x, y: cfg.entrance.y, radius: cfg.entrance.radius,
        venue: v,
        getLabel: () => cfg.entrance.label,
        onInteract: (p, g) => { g.enterVenue(v.venueId); return null; },
      });
    }
  }

  togglePause() {
    this.paused = !this.paused;
    this.game.ui.showPause(this.paused);
    if (this.paused) this.game.input.reset();
    else this.game.audio.play('click');
  }

  _footsteps(p, dt) {
    if (!p.moving || p.seated) { this._stepD = 0; return; }
    this._stepD = (this._stepD || 0) + Math.hypot(p.vx, p.vy) * dt;
    const cad = this.game.input.sprint ? 74 : 46;        // one soft step per stride
    if (this._stepD > cad) { this._stepD = 0; this.game.audio.play('step'); }
  }

  update(dt, time) {
    if (this.paused) return;
    const view = this.game.view;
    const { player, world } = this.model;
    const input = this.game.input;
    const tr = this.game.transition;
    if(this.worldEntry?.active)this.worldEntry.update(dt);
    const worldArrival=!!this.worldEntry?.controlsLocked;
    const cinematic=(tr.active && tr.controls)||worldArrival;   // venue or world entry owns player+camera

    if (!cinematic) {
      if (!this.basketball.active) {
        player.update(dt, time, input, world);
        this._footsteps(player, dt);
      } else {
        player.vx = 0; player.vy = 0; player.moving = false;
        this.basketball.update(dt, time);
      }
      if (this.game.debugCam) {                       // scripted framing (e2e hero shots)
        this.camera.x = this.game.debugCam.x;
        this.camera.y = this.game.debugCam.y;
        this.camera.zoom = this.game.debugCam.zoom;
      } else {
        this.camera.setZoomForView(view.w, view.h);
        this.camera.lookX = input.axis.x * 34;
        this.camera.lookY = input.axis.y * 22;
        this.camera.follow(player.x, player.y - 26, dt, view);
      }
    }

    const vr = this.camera.viewRect(view);
    if (this.model.conversations) this.model.conversations.update(dt);
    this.em.update(dt, time, vr);
    world.updateAmbient(dt, vr);
    if (cinematic || this.basketball.active) {
      this.interactions.current = null;
      this.game.ui.setInteract(false);
      if (this.basketball.active) input.consumeInteract();
    } else {
      this.interactions.update(player, input, this.game);
      this.game.ui.setInteract(!!this.interactions.current);
    }

    const z = world.zoneAt(player.x, player.y);
    if (z !== this.zone) { this.zone = z; this.game.ui.setZone(z); }
  }

  render(ctx, view, time) {
    if (this.paused) return;                      // freeze frame under pause overlay
    this.visibleCount = renderScene(this.game, ctx, view, time, this.model, this.camera);
    if(this.worldEntry?.active)this.worldEntry.render(ctx,view);
    this.basketball.render(ctx, view, this.camera, time);
    const tr = this.game.transition;
    if (!(tr.active && tr.controls) && !this.worldEntry?.controlsLocked && !this.basketball.active) this._drawPrompt(ctx, view);
    if (!this.basketball.active) this._drawStick(ctx);
    if (this.game.debug) this._drawDebug(ctx, view);
  }

  _drawPrompt(ctx, view) {
    drawInteractPrompt(ctx, view, this.camera, this.interactions.current, this.model.player);
  }

  _drawStick(ctx) {
    drawStick(ctx, this.game.input);
  }

  _drawDebug(ctx, view) {
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,20,0.7)';
    ctx.fillRect(8, 52, 210, 74);
    ctx.fillStyle = '#8ff5ff';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const p = this.model.player;
    ctx.fillText(`fps ${this.game.loop.fps.toFixed(0)}  dpr ${this.game.dpr}`, 16, 58);
    ctx.fillText(`visible ${this.visibleCount}/${this.em.entities.length}  sprites ${this.game.spriteCount}`, 16, 74);
    ctx.fillText(`player ${p.x.toFixed(0)},${p.y.toFixed(0)}  zoom ${this.camera.zoom.toFixed(2)}`, 16, 90);
    ctx.fillText(`state ${this.game.states.currentName}${this.paused ? ' (paused)' : ''}`, 16, 106);
    ctx.restore();
  }
}
