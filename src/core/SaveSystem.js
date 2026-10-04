// Veyra — save system foundation (Phase 1: registry + wallet persistence only)
// Future phases register providers: SaveSystem.register('progress', {serialize, restore})
import { Storage } from './Storage.js';

export class SaveSystem {
  constructor(game) {
    this.game = game;
    this.providers = new Map();
    this.KEY = 'veyra:save:v1';
  }
  register(id, provider) { this.providers.set(id, provider); }
  save() {
    const data = {};
    for (const [id, p] of this.providers) {
      try { data[id] = p.serialize(); } catch (e) { console.warn('[Save] provider failed', id, e); }
    }
    Storage.set(this.KEY, data);
    this.game.events.emit('save:written', data);
    return data;
  }
  load() {
    const data = Storage.get(this.KEY, {}) || {};
    for (const [id, p] of this.providers) {
      if (data[id] != null) { try { p.restore(data[id]); } catch (e) { console.warn('[Save] restore failed', id, e); } }
    }
    return data;
  }
}
