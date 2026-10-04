// Veyra — door entity (foundation).
// Visuals are baked into the parent building facade. Phase 2 will set enabled=true,
// register doors with the InteractionSystem and wire interior transitions.
import { Entity } from '../world/Entity.js';

export class Door extends Entity {
  constructor(def) {
    super(def.x, def.y);
    this.type = 'door';
    this.def = def;
    this.buildingId = def.buildingId;
    this.label = 'Enter';
    this.enabled = false;        // interiors arrive in a later phase
    this.bx = -30; this.by = -40; this.bw = 60; this.bh = 44;
  }
  render(ctx, time) { /* baked into building sprite */ }
}
