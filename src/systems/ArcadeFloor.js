// Veyra — Phase 7: the arcade floor system. Four cabinets (one per game), five
// residents (4 general guests + 1 recurring player), conversations, occupation
// prompts (PLAY / In use), the playful occupied bubble, LitVM knowledge decks
// and a light "watch the screen" behaviour — all on top of the existing arcade
// interior design, which stays as-is and only gets furnished.
import { NPC } from '../entities/NPC.js';
import { CasinoRegular } from '../entities/CasinoRegular.js';   // proven ≤60 s machine routine
import { ArcadeCabinet } from '../entities/ArcadeCabinet.js';
import { ConversationSystem } from '../systems/ConversationSystem.js';
import { makeAppearance } from '../visuals/NPCPainter.js';
import { makeKnowledgeDeck, BUSY_LINES } from './litvmKnowledge.js';
import { ARCADE_GAMES } from '../games/arcadeLogic.js';
import { dist } from '../core/util.js';

export const ARCADE_WAYPOINTS = [
  { x: 640, y: 560 }, { x: 960, y: 560 }, { x: 660, y: 790 }, { x: 940, y: 790 },
  { x: 800, y: 520 }, { x: 720, y: 700 }, { x: 880, y: 700 }, { x: 800, y: 806 },
  { x: 620, y: 470 }, { x: 980, y: 470 }, { x: 700, y: 620 }, { x: 900, y: 620 },
];

const GUEST_NAMES = ['Tovo', 'Rhea', 'Mim', 'Jax'];
const REGULAR_NAME = 'Pix';

export function buildArcadeFloor(game, st) {
  const em = st.em;
  const world = st.world;
  const conversations = new ConversationSystem(2);

  // ---- cabinets: one per game, always opening exactly that game ----
  const machines = [
    new ArcadeCabinet('tileshift', 545, 500, 'west'),
    new ArcadeCabinet('memrush', 545, 740, 'west'),
    new ArcadeCabinet('neonescape', 1055, 500, 'east'),
    new ArcadeCabinet('nback', 1055, 740, 'east'),
  ];
  for (const m of machines) {
    em.add(m);
    world.colliders.push(m.colliderRect());
  }

  // ---- residents ----
  const guests = GUEST_NAMES.map((name, i) => {
    const spawn = ARCADE_WAYPOINTS[(i * 3 + 1) % ARCADE_WAYPOINTS.length];
    return new NPC({
      x: spawn.x + (i - 1.5) * 26, y: spawn.y + (i % 2) * 22,
      name,
      dialogueId: 'arcade-' + name.toLowerCase(),
      appearance: makeAppearance(6000 + i * 17),
      waypoints: ARCADE_WAYPOINTS,
      personality: { speedF: 0.88 + (i % 3) * 0.13, sociable: 0.42 + (i % 2) * 0.32, restless: 0.34 + (i % 3) * 0.18 },
    });
  });
  const regular = new CasinoRegular({
    x: 800, y: 566,
    name: REGULAR_NAME,
    dialogueId: 'arcade-' + REGULAR_NAME.toLowerCase(),
    appearance: makeAppearance(6107),
    waypoints: ARCADE_WAYPOINTS,
    machines,
    personality: { speedF: 1.08, sociable: 0.46, restless: 0.42 },
  });
  // seating: stools + bench
  const seats = [
    { x: 640, y: 640, occupant: null }, { x: 960, y: 640, occupant: null },
    { x: 662, y: 846, occupant: null },
  ];
  const npcs = [...guests, regular];
  for (const n of npcs) {
    n.config.crowd = npcs;
    n.setContext(world, seats, conversations, () => st.player);
    em.add(n);
  }
  const decks = new Map(guests.map((g, i) => [g, makeKnowledgeDeck(900 + i * 37)]));

  // ---- interactions: cabinets (PLAY / In use) + guest knowledge ----
  const busyAt = new Map();
  for (const m of machines) {
    st.interactions.register({
      id: 'play-' + m.kind,
      get x() { return m.front.x; },
      get y() { return m.front.y; },
      radius: 48,
      machine: m,
      getLabel: () => (m.occupiedBy ? 'In use' : 'Play ' + ARCADE_GAMES[m.kind].short),
      onInteract: (p, g) => {
        if (m.occupiedBy) {                              // occupied: never starts
          m.occupiedBy.say = { text: BUSY_LINES[(Math.random() * BUSY_LINES.length) | 0], ttl: 2.8, accent: '#7de8ff' };
          g.audio.play('deny');
          return null;
        }
        g.audio.play('click');
        g.games.launch(m.gameId);                        // opens exactly this game
        return m.gameId;
      },
    });
  }
  for (const gNpc of guests) {
    st.interactions.register({
      id: 'talk-' + gNpc.dialogueId,
      get x() { return gNpc.x; },
      get y() { return gNpc.y; },
      radius: 46,
      npc: gNpc,
      getLabel: () => (gNpc.wave > 0 ? '…' : 'Interact'),
      onInteract: (p, g) => {
        const id = gNpc.interact(p);
        const fact=decks.get(gNpc).nextFact(); gNpc.say = { text: fact.fact, fact, ttl: 8.5, age: 0 };   // LitVM knowledge
        g.audio.play('click');
        return id;
      },
    });
  }

  const update = (dt, time, vr, player) => {
    conversations.update(dt);
    for (const n of npcs) {                              // quiet nearby footsteps
      if (n.state !== 'walk' || !player) continue;
      if (dist(n.x, n.y, player.x, player.y) > 280) continue;
      n._stepD = (n._stepD || 0) + 60 * dt;
      if (n._stepD > 52) { n._stepD = 0; game.audio.play('stepN'); }
    }
    for (const m of machines) {
      const occ = m.occupiedBy;
      if (occ) {
        // playful bubble when Lester lingers at an occupied cabinet
        if (!occ.say && player && dist(player.x, player.y, m.front.x, m.front.y) < 95) {
          const last = busyAt.get(m) || 0;
          if (time - last > 3.4) {
            busyAt.set(m, time);
            occ.say = { text: BUSY_LINES[(Math.random() * BUSY_LINES.length) | 0], ttl: 2.8, accent: '#7de8ff' };
          }
        }
      } else {
        // guests pause to watch an idle cabinet's attract screen
        for (const g of guests) {
          if (g.state !== 'idle' || g.wave > 0) continue;
          if (dist(g.x, g.y, m.front.x, m.front.y) < 74) {
            g.face = m.x >= g.x ? 1 : -1;
            if (!g._watch || time - g._watch > 6) { g._watch = time; g.t = Math.max(g.t, 1.6 + Math.random() * 1.6); }
          }
        }
      }
    }
  };

  return { machines, guests, regular, npcs, conversations, decks, seats, update };
}
