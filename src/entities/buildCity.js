// Veyra — city factory: populates an EntityManager from map data
import { World } from '../world/World.js';
import { BUILDINGS, DOORS, PROPS, ROUNDABOUT, FENCES, WATERFALL } from '../world/cityMap.js';
import { Building } from './Building.js';
import { Venue } from './Venue.js';
import { Door } from './Door.js';
import { Prop } from './Prop.js';
import { Fountain } from './Fountain.js';
import { Fence } from './Fence.js';
import { Waterfall } from './Waterfall.js';
import { NPC } from './NPC.js';
import { Animal } from './Animal.js';
import { ConversationSystem } from '../systems/ConversationSystem.js';
import { makeAppearance } from '../visuals/NPCPainter.js';
import { WAYPOINTS, WAYPOINTS_CITY, POOL } from '../world/cityMap.js';
import { Car } from './Car.js';
import { mulberry32 } from '../core/util.js';
import { Player } from './Player.js';
import { makeKnowledgeDeck, NPC_FACTS } from '../systems/litvmKnowledge.js';

export function buildCity(game, em, opts = {}) {
  const world = new World(game);
  const venues = [];
  for (const b of BUILDINGS) {
    if (b.venue) { const v = new Venue(b); venues.push(v); em.add(v); }   // Phase 5 hero venues
    else em.add(new Building(b));
  }
  for (const d of DOORS) em.add(new Door(d));
  for (const p of PROPS) em.add(new Prop(p));
  for (const f of FENCES) em.add(new Fence(f));
  em.add(new Fountain(ROUNDABOUT.x, ROUNDABOUT.y, 'bitcoin-treasure'));
  em.add(new Fountain(1300, 2620, 'litecoin-treasure')); // Entertainment Plaza landmark
  em.add(new Waterfall(WATERFALL.x, WATERFALL.y));
  // ---- Phase 4: residents & garden animals ----
  const conversations = new ConversationSystem();
  const rng = mulberry32(4711);
  const NAMES = ['Amara', 'Tunde', 'Zainab', 'Chidi', 'Ngozi', 'Emeka', 'Aisha', 'Kofi', 'Folake', 'Obi', 'Leyla', 'Marco', 'Grace', 'Idris', 'Maya', 'Kwame', 'Sun', 'Amina', 'Kelechi', 'Segun', 'Nia', 'Tayo', 'Efua', 'Musa', 'Lina', 'Adaeze', 'Raf', 'Simi', 'Dapo', 'Keanu', 'Zola'];
  const npcs = [];
  for (let i = 0; i < NAMES.length; i++) {
    const city = i >= 19;                       // last twelve residents live uptown
    const list = city ? WAYPOINTS_CITY : WAYPOINTS;
    const spawn = list[(i * 3) % list.length];
    const npc = new NPC({
      x: spawn.x + (rng() - 0.5) * 40, y: spawn.y + (rng() - 0.5) * 30,
      name: NAMES[i],
      dialogueId: 'npc-' + NAMES[i].toLowerCase(),
      appearance: makeAppearance(1000 + i * 7),
      waypoints: list,
      district: city ? 'city' : 'garden',
      personality: { speedF: 0.85 + rng() * 0.4, sociable: 0.3 + rng() * 0.7, restless: 0.25 + rng() * 0.7 },
      knowledgeCategory: NPC_FACTS[i % NPC_FACTS.length].personality,
      knowledgeDeck: makeKnowledgeDeck(7000 + i * 31),
    });
    npcs.push(npc);
    em.add(npc);
  }
  for (const n of npcs) n.config.crowd = npcs;

  const animals = [];
  const addAnimal = (cfg) => { const a = new Animal(cfg); animals.push(a); em.add(a); return a; };
  const pigeonHomes = [[1150, 2560], [1100, 3460], [420, 2650], [1900, 2900], [1200, 1000], [1350, 2250]];
  for (const [x, y] of pigeonHomes) addAnimal({ species: 'pigeon', x, y, home: { x, y }, range: 150 });
  const flyHomes = [[1820, 2950], [1180, 2350], [1420, 2350], [1050, 2500], [900, 3470]];
  const flyColors = ['#f2a13c', '#e26a9d', '#8fd18f', '#7ab6ff', '#ffd166'];
  flyHomes.forEach(([x, y], i) => addAnimal({ species: 'butterfly', x, y, home: { x, y }, color: flyColors[i % flyColors.length] }));
  for (let i = 0; i < 4; i++) {
    addAnimal({ species: 'duck', x: POOL.x, y: POOL.y, pool: { cx: POOL.x, cy: POOL.y, rx: 190 - i * 28, ry: 34 - i * 5 }, color: i % 2 ? '#f2f0e6' : '#d8c9a8', head: i % 2 ? '#2e8b57' : '#2e6db5' });
  }
  const sqHomes = [[980, 2680], [1100, 3640], [640, 2900]];
  for (const [x, y] of sqHomes) addAnimal({ species: 'squirrel', x, y, home: { x, y } });

  let player = null;
  if (opts.withPlayer) {
    player = new Player(opts.spawnX != null ? opts.spawnX : 1300, opts.spawnY != null ? opts.spawnY : 1480);
    em.add(player);
  }
  // ---- Phase 4+: moving traffic ----
  // Traffic follows the outside of the tall Bitcoin monument rather than the
  // former fountain's small island radius. Upper clearance is larger because
  // the upright medallion occupies more of the north-side visual footprint.
  const RB = { cx: ROUNDABOUT.x, cy: ROUNDABOUT.y, r: 155, upperR: 245, lowerR: 150, sideR: 225 };
  const LANES = [
    { axis: 'x', base: 1000, dir: 1, min: -160, max: 2760, rb: { ...RB, side: 1 }, n: 2 },
    { axis: 'x', base: 880, dir: -1, min: -160, max: 2760, rb: { ...RB, side: -1 }, n: 2 },
    { axis: 'y', base: 1360, dir: 1, min: -160, max: 1960, rb: { ...RB, side: 1 }, n: 1 },
    { axis: 'y', base: 1240, dir: -1, min: -160, max: 1960, rb: { ...RB, side: -1 }, n: 1 },
    { axis: 'x', base: 1915, dir: 1, min: -160, max: 2760, n: 2 },
    { axis: 'x', base: 1845, dir: -1, min: -160, max: 2760, n: 2 },
    { axis: 'y', base: 270, dir: 1, min: 1950, max: 3500, n: 1 },
    { axis: 'y', base: 170, dir: -1, min: 1950, max: 3500, n: 1 },
    { axis: 'y', base: 2430, dir: 1, min: 1950, max: 3500, n: 1 },
    { axis: 'y', base: 2330, dir: -1, min: 1950, max: 3500, n: 1 },
  ];
  const cars = [];
  for (const lane of LANES) {
    for (let k = 0; k < lane.n; k++) {
      const span = (lane.max - lane.min) / lane.n;
      const car = new Car({ lane, pos: lane.min + span * k + Math.random() * span * 0.6 });
      cars.push(car);
      em.add(car);
    }
  }

  for (const n of npcs) n.setContext(world, em.queryType('bench'), conversations, () => player);
  for (const a of animals) a.setContext(world, () => player);
  for (const c of cars) c.setContext(() => player, () => npcs);
  return { world, player, conversations, npcs, animals, cars, venues };
}
