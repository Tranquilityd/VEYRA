// Veyra — Phase 5 venue entity: a major building with its own detailed painter,
// animated lighting layer and sliding entrance doors (doorOpen 0..1).
// The static architecture is baked once; the live layer draws every frame while
// the venue is on screen (EntityManager culls it like everything else).
import { Entity } from '../world/Entity.js';
import { VENUES } from '../world/venues.js';
import { bakeCasino, liveCasino } from '../visuals/CasinoPainter.js';
import { bakeArcade, liveArcade } from '../visuals/ArcadePainter.js';

export class Venue extends Entity {
  constructor(def) {
    super(def.cx, def.frontY);
    this.type = 'venue';
    this.def = def;
    this.config = VENUES[def.venue];
    this.venueId = this.config.id;
    this.isCasino = def.venue === 'casino';
    this.bake = this.isCasino ? bakeCasino : bakeArcade;
    this.live = this.isCasino ? liveCasino : liveArcade;
    this.sprite = this.bake(def);
    this.bx = -this.sprite.ax;
    this.by = -this.sprite.ay;
    this.bw = this.sprite.canvas.width;
    this.bh = this.sprite.canvas.height;
    this.doorOpen = 0;
    this.targetOpen = 0;
  }
  update(dt) {
    const k = Math.min(1, dt * 3.4);
    this.doorOpen += (this.targetOpen - this.doorOpen) * k;
    if (Math.abs(this.targetOpen - this.doorOpen) < 0.003) this.doorOpen = this.targetOpen;
  }
  render(ctx, time) {
    ctx.drawImage(this.sprite.canvas, this.x - this.sprite.ax, this.y - this.sprite.ay);
    this.live(ctx, this, time);
  }
}
