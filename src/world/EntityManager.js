// Veyra — entity container: update + depth-sorted, culled rendering
export class EntityManager {
  constructor() { this.entities = []; }
  add(e) { this.entities.push(e); return e; }
  remove(e) {
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
  }
  clear() { this.entities.length = 0; }
  queryType(type) { return this.entities.filter((e) => e.type === type); }
  update(dt, time, vr) {
    for (const e of this.entities) {
      if (e.removed || e.type === 'player') continue;   // player updated by PlayState
      e.update(dt, time, vr);
    }
    if (this.entities.some((e) => e.removed)) this.entities = this.entities.filter((e) => !e.removed);
  }
  render(ctx, vr, time) {
    const vis = this.entities.filter((e) => e.visible(vr));
    vis.sort((a, b) => a.depth - b.depth);
    for (const e of vis) e.render(ctx, time);
    return vis.length;
  }
}
