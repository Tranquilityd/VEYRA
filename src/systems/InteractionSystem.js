// Veyra — interaction foundation.
// Interactable items: { id, x, y, radius, enabled, getLabel(player), onInteract(player, game) }
// Phase 1 ships one live interactable type (benches). Doors register in Phase 2.
import { dist } from '../core/util.js';

export class InteractionSystem {
  constructor(events) {
    this.events = events;
    this.items = [];
    this.current = null;
  }
  register(item) { this.items.push(item); return item; }
  unregister(item) {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    if (this.current === item) this.current = null;
  }
  clear() { this.items.length = 0; this.current = null; }

  // nearest enabled item within its radius
  query(player) {
    let best = null, bestD = Infinity;
    for (const it of this.items) {
      if (it.enabled === false) continue;
      const d = dist(player.x, player.y, it.x, it.y);
      if (d <= (it.radius || 46) && d < bestD) { best = it; bestD = d; }
    }
    return best;
  }

  update(player, input, game) {
    const found = this.query(player);
    if (found !== this.current) {
      this.current = found;
      this.events.emit('interaction:changed', { item: found });
    }
    if (input.consumeInteract()) {
      if (this.current && this.current.onInteract) {
        this.current.onInteract(player, game);
        return true;
      }
      game.audio.play('deny');
    }
    return false;
  }
}
