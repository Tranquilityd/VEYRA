// Veyra — Phase 6: the casino floor system. Builds the four machines, the five
// residents (4 general guests + 1 recurring player), wires conversation,
// machine occupation, interaction prompts (PLAY / In use), the playful
// occupied bubble and the LitVM knowledge deck — on top of the existing
// interior design (which stays as-is, only furnished).
import { NPC } from '../entities/NPC.js';
import { CasinoRegular } from '../entities/CasinoRegular.js';
import { CasinoMachine } from '../entities/CasinoMachine.js';
import { ConversationSystem } from '../systems/ConversationSystem.js';
import { makeAppearance } from '../visuals/NPCPainter.js';
import { makeKnowledgeDeck, BUSY_LINES } from './litvmKnowledge.js';
import { CASINO_GAMES } from '../games/casinoLogic.js';
import { dist } from '../core/util.js';

export const CASINO_WAYPOINTS = [
  { x: 640, y: 560 }, { x: 960, y: 560 }, { x: 660, y: 790 }, { x: 940, y: 790 },
  { x: 800, y: 520 }, { x: 720, y: 700 }, { x: 880, y: 700 }, { x: 800, y: 806 },
  { x: 620, y: 470 }, { x: 980, y: 470 }, { x: 700, y: 620 }, { x: 900, y: 620 },
];

const GUEST_NAMES = ['Ife', 'Mera', 'Kano', 'Lola'];
const REGULAR_NAME = 'Sunny';

export function buildCasinoFloor(game, st) {
  const em = st.em;
  const world = st.world;
  const conversations = new ConversationSystem(2);

  // ---- machines: one per game, always opening exactly that game ----
  const machines = [
    new CasinoMachine('plinko', 545, 500, 'west'),
    new CasinoMachine('slot', 545, 740, 'west'),
    new CasinoMachine('dice', 1055, 500, 'east'),
    new CasinoMachine('coin', 1055, 740, 'east'),
  ];
  for (const m of machines) {
    em.add(m);
    world.colliders.push(m.colliderRect());
  }

  // ---- residents ----
  const guests = GUEST_NAMES.map((name, i) => {
    const spawn = CASINO_WAYPOINTS[(i * 3) % CASINO_WAYPOINTS.length];
    return new NPC({
      x: spawn.x + (i - 1.5) * 26, y: spawn.y + (i % 2) * 22,
      name,
      dialogueId: 'casino-' + name.toLowerCase(),
      appearance: makeAppearance(5000 + i * 13),
      waypoints: CASINO_WAYPOINTS,
      personality: { speedF: 0.85 + (i % 3) * 0.14, sociable: 0.45 + (i % 2) * 0.3, restless: 0.3 + (i % 3) * 0.2 },
    });
  });
  const regular = new CasinoRegular({
    x: 800, y: 566,
    name: REGULAR_NAME,
    dialogueId: 'casino-' + REGULAR_NAME.toLowerCase(),
    appearance: makeAppearance(5107),
    waypoints: CASINO_WAYPOINTS,
    machines,
    personality: { speedF: 1.05, sociable: 0.5, restless: 0.4 },
  });
  // seating: lounge chairs + card-table chairs (NPCs sit, then stand again)
  const seats = [
    { x: 998, y: 432, occupant: null }, { x: 950, y: 420, occupant: null },
    { x: 712, y: 634, occupant: null }, { x: 648, y: 605, occupant: null },
    { x: 952, y: 674, occupant: null }, { x: 888, y: 645, occupant: null },
  ];
  const npcs = [...guests, regular];
  for (const n of npcs) {
    n.config.crowd = npcs;
    n.setContext(world, seats, conversations, () => st.player);
    em.add(n);
  }
  const decks = new Map(guests.map((g, i) => [g, makeKnowledgeDeck(700 + i * 31)]));

  // ---- interactions: machines (PLAY / In use) + guest knowledge ----
  const busyAt = new Map();
  for (const m of machines) {
    st.interactions.register({
      id: 'play-' + m.kind,
      get x() { return m.front.x; },
      get y() { return m.front.y; },
      radius: 48,
      machine: m,
      getLabel: () => (m.occupiedBy ? 'In use' : 'Play ' + CASINO_GAMES[m.kind].short),
      onInteract: (p, g) => {
        if (m.occupiedBy) {                              // occupied: never starts
          m.occupiedBy.say = { text: BUSY_LINES[(Math.random() * BUSY_LINES.length) | 0], ttl: 2.8, accent: '#ff8fb0' };
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
    // playful bubble when Lester lingers at an occupied machine
    for (const m of machines) {
      const occ = m.occupiedBy;
      if (!occ || occ.say) continue;
      const last = busyAt.get(m) || 0;
      if (player && dist(player.x, player.y, m.front.x, m.front.y) < 95 && time - last > 3.4) {
        busyAt.set(m, time);
        occ.say = { text: BUSY_LINES[(Math.random() * BUSY_LINES.length) | 0], ttl: 2.8, accent: '#ff8fb0' };
      }
    }
  };

  return { machines, guests, regular, npcs, conversations, decks, seats, update };
}
