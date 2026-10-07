// Veyra — Phase 1 self-test suite (open the game with ?test=1)
import { EventBus } from './core/EventBus.js';
import { StateMachine } from './core/StateMachine.js';
import { Storage } from './core/Storage.js';
import { InputManager } from './core/InputManager.js';
import { GameRegistry } from './systems/GameRegistry.js';
import { InteractionSystem } from './systems/InteractionSystem.js';
import { Camera } from './world/Camera.js';
import { World } from './world/World.js';
import { EntityManager } from './world/EntityManager.js';
import { buildCity } from './entities/buildCity.js';
import { BUILDINGS, FENCES } from './world/cityMap.js';
import { Player } from './entities/Player.js';
import { shouldLock } from './ui/OrientationGuard.js';
import { mulberry32 } from './core/util.js';
import { Lighting } from './visuals/Lighting.js';
import { MOVE, LESTER } from './core/movementConfig.js';
import { NPC_HEIGHT } from './visuals/NPCPainter.js';
import { LesterAnimator } from './entities/LesterAnimator.js';
import { PlayState } from './states/PlayState.js';
import { TransitionSystem } from './systems/TransitionSystem.js';
import { VENUES } from './world/venues.js';
import { INTERIORS, getInterior } from './world/interiors.js';
import { InteriorWorld } from './world/InteriorWorld.js';
import { bakeCasino, liveCasino } from './visuals/CasinoPainter.js';
import { bakeArcade, liveArcade } from './visuals/ArcadePainter.js';
import { buildCasinoFloor } from './systems/CasinoFloor.js';
import { CasinoRegular } from './entities/CasinoRegular.js';
import { makeKnowledgeDeck, LITVM_KNOWLEDGE } from './systems/litvmKnowledge.js';
import { GameOverlay } from './ui/GameOverlay.js';
import { plinkoDrop, PLINKO_BINS, slotMult, slotPayout, diceMult, dicePayout, coinMult, coinPayout } from './games/casinoLogic.js';
import { validateWager } from './games/casinoWagering.js';
import { buildArcadeFloor } from './systems/ArcadeFloor.js';
import { ARCADE_GAMES, diffIndex, breath, memrushParams, tileshiftParams, tileshiftSlack, memrushPayout, tileshiftPayout, makeMemoryPattern, makeTileShiftPuzzle, saveBest, loadBest } from './games/arcadeLogic.js';
import { WAVE_TOKEN_RATE, tokensForWaves, fmtTokens, recordSession, loadLedger, setRunPending, zkDisplay } from './games/arcadeRewards.js';
import { lesterReady } from './entities/LesterRig.js';

export function runTests(game) {
  const lines = [];
  const t = (name, fn) => {
    try {
      const info = fn();
      lines.push({ ok: true, name, info: info || '' });
    } catch (e) {
      lines.push({ ok: false, name, info: e.message });
    }
  };
  const assert = (cond, msg = 'assertion failed') => { if (!cond) throw new Error(msg); };
  const eq = (a, b, msg) => assert(Math.abs(a - b) < 1e-9, (msg || 'eq') + ` (${a} != ${b})`);

  t('EventBus on/emit/off', () => {
    const bus = new EventBus();
    let n = 0;
    const off = bus.on('x', (p) => { n += p; });
    bus.emit('x', 2); bus.emit('x', 3);
    off(); bus.emit('x', 10);
    eq(n, 5);
  });

  t('StateMachine enter/exit order', () => {
    const order = [];
    const sm = new StateMachine({ events: new EventBus() });
    sm.register('a', () => ({ enter: () => order.push('a-in'), exit: () => order.push('a-out') }));
    sm.register('b', () => ({ enter: () => order.push('b-in') }));
    sm.set('a'); sm.set('b');
    assert(order.join(',') === 'a-in,a-out,b-in', order.join(','));
  });


  t('Camera clamps inside world', () => {
    const cam = new Camera({ w: 2600, h: 1800 });
    cam.setZoomForView(1280, 720);
    cam.x = 999999; cam.y = -999999;
    cam.clampToWorld({ w: 1280, h: 720 });
    const vr = cam.viewRect({ w: 1280, h: 720 }, 0);
    assert(vr.x >= -0.001 && vr.y >= -0.001, 'view origin');
    assert(vr.x + vr.w <= 2600.001 && vr.y + vr.h <= 1800.001, 'view extent');
  });

  t('InteractionSystem nearest + radius + disabled', () => {
    const sys = new InteractionSystem(new EventBus());
    const a = sys.register({ id: 'a', x: 0, y: 0, radius: 50 });
    sys.register({ id: 'b', x: 10, y: 0, radius: 50, enabled: false });
    const c = sys.register({ id: 'c', x: 30, y: 0, radius: 20 });
    assert(sys.query({ x: 40, y: 0 }) === c, 'nearest enabled');
    assert(sys.query({ x: 60, y: 0 }) === null, 'out of radius');
    assert(sys.query({ x: -40, y: 0 }) === a, 'fallback item');
  });

  t('GameRegistry register/list/launch stub', () => {
    const reg = new GameRegistry(new EventBus());
    reg.register({ id: 'g1', name: 'G1' });
    assert(reg.list().length === 1);
    const r = reg.launch('g1');
    assert(r.ok === false && /later phase/.test(r.message), 'stub launch message');
    assert(reg.launch('nope').ok === false);
    assert(game.games.list().length >= 2, 'placeholder games registered');
  });


  t('InputManager.computeAxis pure', () => {
    const a1 = InputManager.computeAxis(new Set(['KeyW', 'KeyD']), { x: 0, y: 0 });
    eq(Math.hypot(a1.x, a1.y), 1, 'normalized diagonal');
    assert(a1.y < 0 && a1.x > 0, 'direction');
    const a2 = InputManager.computeAxis(new Set(), { x: 0.5, y: -0.5 });
    eq(a2.x, 0.5); eq(a2.y, -0.5);
    const a3 = InputManager.computeAxis(new Set(['ArrowLeft']), { x: 2, y: 0 });
    eq(Math.hypot(a3.x, a3.y), 1, 'clamped combined');
    const a4 = InputManager.computeAxis(new Set(['ArrowLeft']), { x: 1, y: 0 });
    eq(a4.x, 0, 'opposing inputs cancel');
  });

  t('OrientationGuard predicate', () => {
    assert(shouldLock(true, true) === true, 'mobile portrait locks');
    assert(shouldLock(true, false) === false, 'mobile landscape free');
    assert(shouldLock(false, true) === false, 'desktop portrait never locks');
    assert(shouldLock(false, false) === false);
  });

  t('Storage roundtrip + corrupt fallback', () => {
    Storage.set('veyra:__t', { a: 1 });
    assert(Storage.get('veyra:__t').a === 1);
    try { window.localStorage.setItem('veyra:__bad', '{not json'); } catch (e) {}
    assert(Storage.get('veyra:__bad', 'fb') === 'fb', 'corrupt JSON falls back');
    Storage.remove('veyra:__t');
  });

  t('mulberry32 deterministic', () => {
    const r1 = mulberry32(42), r2 = mulberry32(42);
    for (let i = 0; i < 8; i++) eq(r1(), r2(), 'seeded sequence');
  });

  t('World collision pushes out of pond & buildings', () => {
    const w = new World({});
    const p1 = w.collide(430, 1480, 13);           // pond center
    const e = ((p1.x - 430) / (190 + 13)) ** 2 + ((p1.y - 1480) / (110 + 13)) ** 2;
    assert(e >= 0.999, 'outside pond ellipse');
    const p2 = w.collide(300, 690, 13);           // cafe footprint
    assert(p2.y >= 700, 'pushed south of building line');
    const p3 = w.collide(1300, 1450, 13);         // open road stays put
    eq(p3.x, 1300); eq(p3.y, 1450);
  });

  t('World zones resolve', () => {
    const w = new World({});
    assert(w.zoneAt(400, 1400) === 'Veyra Gardens');
    assert(w.zoneAt(1300, 940) === 'Roundabout Plaza');
    assert(w.zoneAt(1800, 400) === 'Neon Block');
    assert(w.zoneAt(600, 900) === 'Veyra Avenue');
  });

  t('Player sit/stand + movement clamp', () => {
    const p = new Player(1300, 1450);
    const bench = { x: 500, y: 1260 };
    p.sit(bench);
    assert(p.seated === bench && p.y === 1262);
    p.stand();
    assert(p.seated === null && p.y === 1280);
    const w = new World({});
    const fakeInput = { axis: { x: 0, y: -1 }, sprint: false };
    for (let i = 0; i < 200; i++) p.update(1 / 60, 0, fakeInput, w);
    assert(p.y > 1130, 'stopped by park edge props/road geometry, y=' + p.y.toFixed(0));
  });

  t('EntityManager depth sort + culling', () => {
    const em = new EntityManager();
    const mk = (y) => { const p = new Player(100, y); return p; };
    em.add(mk(50)); em.add(mk(10)); em.add(mk(30));
    const order = [];
    for (const e of em.entities) e.render = () => order.push(e.y);
    em.render(null, { x: 0, y: 0, w: 1000, h: 1000 }, 0);
    assert(order.join(',') === '10,30,50', order.join(','));
    em.render(null, { x: 5000, y: 5000, w: 10, h: 10 }, 0);
    assert(order.length === 3, 'culled render adds nothing');
  });

  t('Lighting vignette cache', () => {
    const l = new Lighting();
    l.resize(320, 180);
    const first = l.screen;
    assert(first && first.width === 320);
    l.resize(320, 180);
    assert(l.screen === first, 'no rebuild on same size');
    l.resize(640, 360);
    assert(l.screen !== first, 'rebuild on resize');
  });

  // ---------------- Phase 2 ----------------
  t('P2 world scale hides full garden', () => {
    const { WORLD } = { WORLD: { w: 2600, h: 3800 } };
    assert(WORLD.h >= 3400, 'world extended');
    const cam = new Camera(WORLD);
    cam.setZoomForView(1440, 810);
    cam.zoom = 1.18; // max zoom
    const vr = cam.viewRect({ w: 1440, h: 810 }, 0);
    assert(vr.h < WORLD.h * 0.5, 'camera never sees half the world');
    assert(vr.w < WORLD.w * 0.75, 'camera never sees full width');
  });

  t('P2 casino & arcade face each other across central road', () => {
    const casino = BUILDINGS.find((b) => b.id === 'casino');
    const arcade = BUILDINGS.find((b) => b.id === 'arcade2');
    assert(casino && arcade, 'both exist');
    assert(casino.cx < 1300 && arcade.cx > 1300, 'opposite sides of central road');
    assert(casino.frontY === arcade.frontY, 'same front line');
    assert(!casino.rot && !arcade.rot, 'buildings stand upright (no tilt)');
    assert(casino.w >= 500 && arcade.w >= 500, 'major buildings');
  });

  t('P2 waterfall landmark + pool + bridges', () => {
    const w = new World({});
    const pool = w.collide(1300, 3320, 13);
    const e = ((pool.x - 1300) / 284) ** 2 + ((pool.y - 3320) / 62) ** 2;
    assert(e >= 0.999, 'pool blocks walking');
    const hillN = w.collide(1300, 3160, 13);
    assert(hillN.y <= 3060, 'hill solid from north, y=' + hillN.y);
    const hillW = w.collide(650, 3160, 13);
    assert(hillW.x <= 700, 'hill solid from west, x=' + hillW.x);
    const terrace = w.collide(1200, 3435, 13);
    assert(terrace.x === 1200 && terrace.y === 3435, 'viewing terrace walkable');
    const onBridge = w.collide(560, 3320, 13);
    assert(onBridge.x === 560 && onBridge.y === 3320, 'bridge gap walkable');
    const inStream = w.collide(700, 3320, 13);
    assert(Math.abs(inStream.y - 3320) > 12, 'stream blocks off-bridge');
  });

  t('P2 fences & hedges block', () => {
    const w = new World({});
    const f = w.collide(390, 2300, 13);
    assert(Math.abs(f.x - 390) > 7, 'fence blocks, x=' + f.x);
    const h = w.collide(1087, 2300, 13);
    assert(Math.abs(h.x - 1087) > 7, 'hedge blocks');
    const gate = w.collide(1300, 2020, 13);   // promenade gate gap
    assert(gate.x === 1300 && gate.y === 2020, 'gate open');
  });

  t('P2 district zones resolve', () => {
    const w = new World({});
    assert(w.zoneAt(1300, 2620) === 'Entertainment Plaza');
    assert(w.zoneAt(1300, 3435) === 'Waterfall Terrace');
    assert(w.zoneAt(1800, 3000) === 'Rose Garden');
    assert(w.zoneAt(700, 3000) === 'Rock Garden');
    assert(w.zoneAt(1300, 2200) === 'Garden Promenade');
    assert(w.zoneAt(220, 2600) === 'Garden Ring Road');
    assert(w.zoneAt(1300, 940) === 'Roundabout Plaza', 'phase 1 zones intact');
  });

  t('P2 city build includes new entities', () => {
    const em = new EntityManager();
    buildCity(game, em, { withPlayer: false });
    assert(em.queryType('waterfall').length === 1, 'waterfall');
    assert(em.queryType('fence').length === FENCES.length, 'fences');
    assert(em.queryType('fountain').length === 2, 'plaza fountain added');
    const towers = em.queryType('tower').length;
    assert(towers >= 8, 'city backdrop towers, got ' + towers);
    const rocks = em.queryType('rock').length;
    assert(rocks >= 8, 'rock compositions, got ' + rocks);
    assert(em.queryType('bridge').length === 2, 'bridges');
  });


  // ---------------- Phase 3: Lester ----------------
  const mkPlayer = () => {
    const em = new EntityManager();
    const model = buildCity(game, em, { withPlayer: true });
    return { p: model.player, world: model.world };
  };
  const fakeInput = (x, y, sprint = false) => ({ axis: { x, y }, sprint });
  const step = (p, world, ax, ay, sprint, n = 1) => {
    for (let i = 0; i < n; i++) p.update(1 / 60, 0, fakeInput(ax, ay, sprint), world);
  };

  t('P3 movement config is centralized', () => {
    const { p } = mkPlayer();
    eq(p.walkSpeed, MOVE.walkSpeed, 'walk speed from config');
    eq(p.runSpeed, MOVE.runSpeed, 'run speed from config');
    assert(MOVE.accel === 900 && MOVE.decel === 1100, 'accel/decel as specified');
    assert(LESTER.height > 60, 'lester world height');
  });

  t('P3 screen directions: LEFT/RIGHT/UP/DOWN', () => {
    const { p, world } = mkPlayer();
    const at = (x, y) => { p.x = x; p.y = y; p.vx = 0; p.vy = 0; };
    at(1300, 1480); step(p, world, 1, 0, false, 20);  assert(p.x > 1300, 'RIGHT moves to screen right, x=' + p.x);
    at(1300, 1480); step(p, world, -1, 0, false, 20); assert(p.x < 1300, 'LEFT moves to screen left, x=' + p.x);
    at(1300, 1480); step(p, world, 0, -1, false, 20); assert(p.y < 1480, 'UP moves to screen top, y=' + p.y);
    at(1300, 1480); step(p, world, 0, 1, false, 20);  assert(p.y > 1480, 'DOWN moves to screen bottom, y=' + p.y);
  });

  t('P3 acceleration & deceleration ramps', () => {
    const { p, world } = mkPlayer();
    step(p, world, 1, 0, false, 1);
    assert(p.vx > 0 && p.vx < MOVE.walkSpeed * 0.5, 'speed ramps up, vx=' + p.vx);
    step(p, world, 1, 0, false, 60);
    const top = p.vx;
    step(p, world, 0, 0, false, 1);
    assert(p.vx < top, 'decelerates on release');
    step(p, world, 0, 0, false, 60);
    assert(Math.abs(p.vx) < 1, 'comes to rest, vx=' + p.vx);
  });

  t('P3 run is faster than walk', () => {
    const { p, world } = mkPlayer();
    step(p, world, 1, 0, false, 90);
    const walk = p.vx;
    step(p, world, 1, 0, true, 90);
    const run = p.vx;
    assert(walk > MOVE.walkSpeed * 0.9 && walk <= MOVE.walkSpeed + 1, 'walk tops at config, ' + walk);
    assert(run > walk * 1.3, 'run clearly faster, ' + run + ' vs ' + walk);
  });

  t('P3 collision still blocks (velocity killed on blocked axis)', () => {
    const { p, world } = mkPlayer();
    p.x = 1300; p.y = 3400; p.vx = 0; p.vy = 0;      // below waterfall hill
    step(p, world, 0, -1, false, 90);                 // push north into the hill
    assert(p.y > 3255, 'hill blocks Lester, y=' + p.y);
    p.x = 800; p.y = 2700; p.vx = 0; p.vy = 0;
    step(p, world, 0, -1, true, 90);                  // push into casino
    assert(p.y > 2600, 'casino blocks Lester, y=' + p.y);
  });

  t('P3 animator states IDLE/WALK/RUN/TURN/IDLE_ACTION', () => {
    const a = new LesterAnimator();
    a.update(1 / 60, 0, 0, false, 0, false);
    assert(a.state === 'IDLE', 'idle at rest');
    a.update(1 / 60, 100, 0, false, 1, false);
    assert(a.state === 'WALK', 'walk when moving, got ' + a.state);
    a.update(1 / 60, 280, 0, true, 1, false);
    for (let i = 0; i < 30; i++) a.update(1 / 60, 280, 0, true, 1, false);
    assert(a.state === 'RUN', 'run at sprint speed, got ' + a.state);
    for (let i = 0; i < 30; i++) a.update(1 / 60, -280, 0, true, 1, false);
    assert(a.flip === -1, 'flip follows screen-left');
    a.update(1 / 60, 0, 0, false, 0, false);
    for (let i = 0; i < 20; i++) a.update(1 / 60, 0, 0, false, 0, false);
    assert(a.state === 'IDLE', 'back to idle');
    assert(a.forceAction('dance') === true, 'forceAction accepted');
    a.update(1 / 60, 0, 0, false, 0, false);
    assert(a.state === 'IDLE_ACTION', 'idle action state');
    a.update(1 / 60, 120, 0, false, 1, false);
    assert(a.state !== 'IDLE_ACTION', 'movement cancels action promptly');
    assert(a.forceAction('nope') === false, 'unknown action rejected');
  });

  t('P3 random idle action triggers after a while', () => {
    const a = new LesterAnimator();
    a.nextAction = 0.1;
    for (let i = 0; i < 30; i++) a.update(1 / 60, 0, 0, false, 0, false);
    assert(a.state === 'IDLE_ACTION', 'personality action appeared, got ' + a.state);
  });

  t('P3 turn is smooth (passes edge-on, no snap)', () => {
    const a = new LesterAnimator();
    for (let i = 0; i < 40; i++) a.update(1 / 60, 172, 0, false, 1, false);
    let minAbs = 9, sawTurn = false;
    for (let i = 0; i < 40; i++) {
      a.update(1 / 60, -172, 0, false, 1, false);
      const s = a.pose().scaleX;
      assert(Number.isFinite(s), 'scaleX finite');
      minAbs = Math.min(minAbs, Math.abs(s));
      if (a.state === 'TURN') sawTurn = true;
    }
    assert(sawTurn, 'TURN state used for reversal');
    assert(minAbs < 0.5, 'width dips edge-on during turn, min=' + minAbs);
  });

  t('P3 pose joints all finite & complete', () => {
    const a = new LesterAnimator();
    for (let i = 0; i < 50; i++) a.update(1 / 60, 172, 40, false, 1, false);
    const P = a.pose();
    for (const k of ['legL', 'legR', 'torso', 'head', 'armF', 'armB']) {
      const j = P.joints[k];
      assert(j && Number.isFinite(j.rot || 0) && Number.isFinite(j.x || 0) && Number.isFinite(j.y || 0), k + ' joint finite');
    }
    assert(P.order.length === 6, 'draw order complete');
    assert(Number.isFinite(P.scaleX) && Number.isFinite(P.bounce), 'body transforms finite');
  });

  t('P3 joystick base sits bottom-left, thumb-reachable', () => {
    const im = new InputManager({ audio: { toggleMuted() {} } });
    const b = im.stickBase();
    assert(b.x < window.innerWidth * 0.4, 'base on left side, x=' + b.x);
    assert(b.y > window.innerHeight * 0.6, 'base near bottom, y=' + b.y);
    im.setVirtualAxis(1, 0);
    const ax = InputManager.computeAxis(new Set(), im.vAxis);
    assert(ax.x === 1 && ax.y === 0, 'stick axis feeds movement');
  });

  t('P3 Lester artwork loaded from provided model', () => {
    assert(lesterReady() === true, 'assets/lester.png decoded');
  });


  // ---------------- Phase 4: NPCs & animals ----------------
  t('P4 residents are diverse, no clones', () => {
    const em2 = new EntityManager();
    const model = buildCity(game, em2, { withPlayer: false });
    const npcs = model.npcs;
    assert(npcs.length >= 10, 'crowd size ' + npcs.length);
    const combos = new Set(npcs.map((n) => JSON.stringify(n.appearance)));
    assert(combos.size === npcs.length, 'every appearance unique');
    assert(new Set(npcs.map((n) => n.appearance.skin)).size >= 5, 'skin tone variety');
    assert(new Set(npcs.map((n) => n.appearance.hairStyle)).size >= 6, 'hair style variety');
    assert(new Set(npcs.map((n) => n.appearance.hairColor || 'bald')).size >= 5, 'hair color variety');
    assert(new Set(npcs.map((n) => n.appearance.shirt)).size >= 6, 'clothing variety');
    assert(new Set(npcs.map((n) => n.name)).size === npcs.length, 'unique names');
    assert(new Set(npcs.map((n) => n.dialogueId)).size === npcs.length, 'unique dialogue ids');
  });

  t('P4 NPC behaviour: wanders, pauses, freezes off-screen', () => {
    const em2 = new EntityManager();
    const model = buildCity(game, em2, { withPlayer: false });
    const n = model.npcs[0];
    const vr = { x: n.x - 400, y: n.y - 400, w: 800, h: 800 };
    const seen = new Set();
    let moved = 0;
    let px = n.x, py = n.y;
    for (let i = 0; i < 1800; i++) {                    // 60 s: a long sit can mask a short window
      n.update(1 / 30, i / 30, vr);
      seen.add(n.state);
      if (Math.hypot(n.x - px, n.y - py) > 0.1) moved++;
      px = n.x; py = n.y;
    }
    assert(seen.has('walk'), 'npc walks, saw ' + [...seen]);
    assert(moved > 30, 'npc actually moves');
    assert(seen.size >= 2, 'varied states');
    const fx = n.x, fy = n.y;
    const far = { x: n.x + 5000, y: n.y + 5000, w: 100, h: 100 };
    for (let i = 0; i < 120; i++) n.update(1 / 30, i / 30, far);
    assert(n.x === fx && n.y === fy, 'off-screen npc not simulated (perf)');
  });

  t('P4 conversations pair nearby NPCs with alternating speaker', () => {
    const em2 = new EntityManager();
    const model = buildCity(game, em2, { withPlayer: false });
    const [a, b] = model.npcs;
    b.x = a.x + 46; b.y = a.y;
    a.state = 'idle'; b.state = 'idle';
    a.sociable = 1; b.sociable = 1;
    a.seated = null; b.seated = null;
    assert(model.conversations.tryStart(a, true) === true, 'conversation starts');
    assert(a.conv && a.conv === b.conv, 'both linked');
    assert(a.conv.speaker === a || a.conv.speaker === b, 'has speaker');
    const first = a.conv.speaker;
    let switched = false;
    for (let i = 0; i < 400; i++) {
      model.conversations.update(1 / 30);
      a.update(1 / 30, i / 30, { x: a.x - 300, y: a.y - 300, w: 600, h: 600 });
      b.update(1 / 30, i / 30, { x: a.x - 300, y: a.y - 300, w: 600, h: 600 });
      if (a.conv && a.conv.speaker !== first) switched = true;
    }
    assert(switched, 'speaker alternates');
    for (let i = 0; i < 1200; i++) model.conversations.update(1 / 30);
    assert(!a.conv && !b.conv, 'conversation ends');
  });

  t('P4 animals: species roster + behaviours + pool ducks', () => {
    const em2 = new EntityManager();
    const model = buildCity(game, em2, { withPlayer: false });
    const count = (sp) => model.animals.filter((a) => a.species === sp).length;
    assert(count('pigeon') >= 5, 'pigeons');
    assert(count('butterfly') >= 4, 'butterflies');
    assert(count('duck') >= 3, 'ducks');
    assert(count('squirrel') >= 2, 'squirrels');
    const duck = model.animals.find((a) => a.species === 'duck');
    const vr = { x: 900, y: 3100, w: 900, h: 500 };
    for (let i = 0; i < 300; i++) duck.update(1 / 30, i / 30, vr);
    const dx = (duck.x - 1300) / 280, dy = (duck.y - 3320) / 58;
    assert(dx * dx + dy * dy <= 1.05, 'duck stays in pool');
    const pig = model.animals.find((a) => a.species === 'pigeon');
    const pvr = { x: pig.x - 300, y: pig.y - 300, w: 600, h: 600 };
    model.player = { x: pig.x + 10, y: pig.y + 10 };
    pig.getPlayer = () => model.player;
    pig.update(1 / 30, 0, pvr);
    assert(pig.flying === true, 'pigeon flees nearby player');
    const bf = model.animals.find((a) => a.species === 'butterfly');
    const bx = bf.x, by = bf.y;
    for (let i = 0; i < 200; i++) bf.update(1 / 30, i / 30, { x: bf.x - 300, y: bf.y - 300, w: 600, h: 600 });
    assert(Math.hypot(bf.x - bx, bf.y - by) > 1, 'butterfly flutters');
  });

  t('P4 NPC interaction hook ready for future dialogue', () => {
    const ps = game.states.get('play');
    ps.enter({ fresh: true });
    const npc = ps.model.npcs[0];
    const pl = ps.model.player;
    pl.x = npc.x + 18; pl.y = npc.y + 6;
    const found = ps.interactions.query(pl);
    assert(found && found.npc === npc, 'interact indicator near npc');
    assert(found.getLabel(pl) === 'Interact', 'indicator copy');
    const id = found.onInteract(pl, game);
    assert(npc.wave > 0, 'npc waves back');
    assert(typeof id === 'string' && id.length > 3, 'dialogueId returned for LitVM later');
    ps.enter({ fresh: true });
  });

  t('P4 crowd counts stay mobile-friendly', () => {
    const em2 = new EntityManager();
    const model = buildCity(game, em2, { withPlayer: false });
    assert(model.npcs.length <= 32, 'npc cap');
    assert(model.npcs.length >= 28, 'crowd grew, got ' + model.npcs.length);
    assert(model.animals.length <= 20, 'animal cap');
    assert(model.cars.length <= 16, 'car cap');
  });


  t('P4+ Lester is exactly 50% bigger than residents', () => {
    const ratio = LESTER.height / NPC_HEIGHT;
    assert(Math.abs(ratio - 1.5) < 0.02, 'Lester:NPC height ratio = ' + ratio);
  });

  t('P4+ residents live in the city too', () => {
    const em2 = new EntityManager();
    const model = buildCity(game, em2, { withPlayer: false });
    const city = model.npcs.filter((n) => n.config.district === 'city');
    assert(city.length >= 4, 'city residents, got ' + city.length);
    for (const n of city) {
      assert(n.y < 1600, 'city resident spawns uptown, y=' + n.y);
      assert(n.config.waypoints.every((w) => w.y < 1600), 'city waypoints only');
    }
    const garden = model.npcs.filter((n) => n.config.district === 'garden');
    assert(garden.length >= 8, 'garden residents kept');
  });

  t('P4+ traffic: lanes, motion, wrap, braking, perf freeze', () => {
    const em2 = new EntityManager();
    const model = buildCity(game, em2, { withPlayer: false });
    assert(model.cars.length >= 10, 'traffic volume ' + model.cars.length);
    const car = model.cars.find((c) => c.lane.axis === 'x' && !c.lane.rb && c.lane.dir === 1);
    const vr = { x: car.x - 400, y: car.y - 400, w: 800, h: 800 };
    const x0 = car.x;
    for (let i = 0; i < 30; i++) car.update(1 / 30, i / 30, vr);
    assert(car.x > x0 + 20, 'eastbound car moves east');
    assert(Math.abs(car.y - car.lane.base) < 0.01, 'stays in lane');
    car.pos = car.lane.max - 2;
    car.update(1 / 30, 0, vr);
    assert(car.pos < car.lane.min + 200, 'wraps at lane end');
    vr.x = car.x - 400; vr.y = car.y - 400;    // keep the wrapped car on-screen (deterministic)
    // brakes for a pedestrian standing ahead in the lane
    model.player = { x: car.x + 50 * car.lane.dir, y: car.lane.base };
    car.getPlayer = () => model.player;
    for (let i = 0; i < 45; i++) car.update(1 / 30, i / 30, vr);
    assert(car.speed < 6, 'car stops for pedestrian, v=' + car.speed);
    model.player = { x: -9999, y: -9999 };
    for (let i = 0; i < 60; i++) car.update(1 / 30, i / 30, vr);
    assert(car.speed > car.cruise * 0.8, 'resumes cruise');
    // roundabout lane curves around the island
    const rbCar = model.cars.find((c) => c.lane.rb);
    rbCar.pos = rbCar.lane.rb.cx;
    rbCar._place();
    const dIsle = Math.hypot(rbCar.x - 1300, rbCar.y - 940);
    assert(dIsle > 90, 'curves around roundabout island, d=' + dIsle);
    // perf: frozen off-screen
    const fx = car.pos;
    for (let i = 0; i < 60; i++) car.update(1 / 30, i / 30, { x: 9000, y: 9000, w: 50, h: 50 });
    assert(car.pos === fx, 'off-screen car not simulated');
  });


  // ---------- Phase 5: casino & arcade exteriors + building entry ----------
  const makeStubCtx = () => {
    const calls = [];
    const grad = { addColorStop() {} };
    const noop = (name) => (...args) => {
      calls.push(name + ':' + args.map((a) => (typeof a === 'number' ? +a.toFixed(1) : String(a))).join(','));
    };
    const ctx = {
      canvas: { width: 10, height: 10 },
      save: noop('save'), restore: noop('restore'), translate: noop('translate'), scale: noop('scale'),
      rotate: noop('rotate'), beginPath: noop('beginPath'), closePath: noop('closePath'), moveTo: noop('moveTo'),
      lineTo: noop('lineTo'), quadraticCurveTo: noop('q'), bezierCurveTo: noop('bz'), arc: noop('arc'),
      arcTo: noop('arcTo'), ellipse: noop('ellipse'), setLineDash: noop('dash'), rect: noop('rect'), roundRect: noop('roundRect'), fill: noop('fill'),
      stroke: noop('stroke'), clip: noop('clip'), fillRect: noop('fillRect'), strokeRect: noop('strokeRect'),
      fillText: noop('fillText'), drawImage: noop('drawImage'), measureText: () => ({ width: 40 }),
      createLinearGradient: () => grad, createRadialGradient: () => grad,
    };
    for (const prop of ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'globalCompositeOperation', 'font', 'textAlign', 'textBaseline', 'shadowColor', 'shadowBlur', 'lineCap', 'letterSpacing']) {
      let v = '';
      Object.defineProperty(ctx, prop, { get: () => v, set: (nv) => { v = nv; calls.push(prop + '=' + String(nv).slice(0, 42)); } });
    }
    return { ctx, calls };
  };

  t('P5 venue config + buildCity placement', () => {
    assert(VENUES.casino && VENUES.arcade, 'both venues configured');
    for (const cfg of [VENUES.casino, VENUES.arcade]) {
      assert(cfg.entrance.y > cfg.frontY, 'entrance zone south of the facade');
      assert(cfg.entrance.radius > 40, 'generous enter radius');
      assert(cfg.door.x === cfg.cx && cfg.final.x === cfg.cx, 'door centered on venue');
      assert(cfg.approach.y > cfg.entrance.y, 'approach point beyond the prompt zone');
      assert(typeof cfg.entrance.label === 'string' && /enter/i.test(cfg.entrance.label), 'label reads ENTER: ' + cfg.entrance.label);
    }
    assert(VENUES.casino.cx !== VENUES.arcade.cx, 'venues are separate buildings');
    const em2 = new EntityManager();
    const model = buildCity(game, em2, { withPlayer: false });
    assert(model.venues && model.venues.length === 2, 'buildCity returns 2 venues');
    for (const v of model.venues) {
      assert(v.type === 'venue', 'venue entity type');
      assert(v.sprite.canvas.width > 500 && v.sprite.canvas.height > 500, 'facade sprite baked ' + v.sprite.canvas.width + 'x' + v.sprite.canvas.height);
      assert(v.x === v.config.cx && v.y === v.config.frontY, 'venue anchored on its lot');
      assert(v.doorOpen === 0 && v.targetOpen === 0, 'doors start shut');
    }
  });

  t('P5 facade colliders vs walkable entrance', () => {
    const em2 = new EntityManager();
    const model = buildCity(game, em2, { withPlayer: false });
    for (const cfg of [VENUES.casino, VENUES.arcade]) {
      // the facade body blocks Lester
      const blocked = model.world.collide(cfg.cx, cfg.frontY - 120, 13);
      assert(Math.abs(blocked.y - (cfg.frontY - 120)) > 50 || Math.abs(blocked.x - cfg.cx) > 50, 'facade is solid');
      // the entrance prompt point + stairs are walkable
      const e = model.world.collide(cfg.entrance.x, cfg.entrance.y, 13);
      assert(Math.abs(e.x - cfg.entrance.x) < 0.5 && Math.abs(e.y - cfg.entrance.y) < 0.5, 'entrance zone reachable');
      const d = model.world.collide(cfg.door.x, cfg.frontY + 14, 13);
      assert(Math.abs(d.x - cfg.door.x) < 0.5 && Math.abs(d.y - (cfg.frontY + 14)) < 0.5, 'door step reachable');
    }
  });

  t('P5 venue painters bake + animated door layer', () => {
    const defC = BUILDINGS.find((b) => b.venue === 'casino');
    const defA = BUILDINGS.find((b) => b.venue === 'arcade');
    assert(bakeCasino(defC) === bakeCasino(defC), 'casino bake memoized');
    assert(bakeArcade(defA) === bakeArcade(defA), 'arcade bake memoized');
    for (const [live, def, id] of [[liveCasino, defC, 'casino'], [liveArcade, defA, 'arcade']]) {
      const v0 = { x: def.cx, y: def.frontY, doorOpen: 0, def };
      const v1 = { x: def.cx, y: def.frontY, doorOpen: 0.95, def };
      const a = makeStubCtx(); live(a.ctx, v0, 3.1);
      const b = makeStubCtx(); live(b.ctx, v1, 3.1);
      assert(a.calls.length > 150, id + ' live layer rich: ' + a.calls.length + ' ops');
      assert(a.calls.join('|') !== b.calls.join('|'), id + ' doors animate with doorOpen');
      const c2 = makeStubCtx(); live(c2.ctx, v0, 9.7);
      assert(a.calls.join('|') !== c2.calls.join('|'), id + ' lights animate over time');
    }
  });

  t('P5 entry is intentional (prompt only, no auto-enter)', () => {
    const fakeGame = {
      events: new EventBus(),
      ui: { showPlay() {}, hideAll() {}, setZone() {}, setInteract() {}, showPause() {} },
    };
    let entered = null;
    fakeGame.enterVenue = (id) => { entered = id; };
    const ps2 = new PlayState(fakeGame);
    ps2.enter({ fresh: true });
    const nearCasino = { x: VENUES.casino.entrance.x, y: VENUES.casino.entrance.y + 12 };
    const item = ps2.interactions.query(nearCasino);
    assert(item && item.id === 'enter-casino', 'casino entrance detected');
    assert(/enter/i.test(item.getLabel(nearCasino)), 'prompt says ' + item.getLabel(nearCasino));
    assert(entered === null, 'proximity alone never enters');
    item.onInteract(nearCasino, fakeGame);
    assert(entered === 'casino', 'explicit activation enters');
    const itemA = ps2.interactions.query({ x: VENUES.arcade.entrance.x, y: VENUES.arcade.entrance.y + 12 });
    assert(itemA && itemA.id === 'enter-arcade', 'arcade entrance detected');
    assert(ps2.interactions.query({ x: VENUES.casino.entrance.x, y: VENUES.casino.entrance.y + 260 }) === null, 'no prompt far away');
  });

  t('P5 transition choreography: walk-in, doors, fade, switch, card', () => {
    const log = [];
    const cfg = VENUES.casino;
    const venue = { venueId: 'casino', config: cfg, doorOpen: 0, targetOpen: 0 };
    const player = { x: cfg.cx, y: 2842, depthY: 2842, vx: 0, vy: 0, facing: 'down', moving: false, seated: null, stand() {}, animator: { update() { log.push('anim'); } } };
    const camera = { x: cfg.cx, y: 2780, zoom: 1, snapTo(x, y) { this.x = x; this.y = y; } };
    const ps = { model: { player, venues: [venue] }, camera };
    const interior = { venueId: '' };
    const fakeGame = {
      states: {
        get: (n) => (n === 'play' ? ps : interior),
        set: (n, p) => { log.push('set:' + n); if (n === 'interior') interior.venueId = p.venue; },
        currentName: 'play',
      },
      audio: { play: (s) => log.push('sfx:' + s) },
      view: { w: 1280, h: 760 },
    };
    const tr = new TransitionSystem(fakeGame);
    assert(tr.enterVenue('casino') === true, 'entry accepted');
    assert(tr.enterVenue('arcade') === false, 'second entry refused mid-transition');
    assert(tr.lock && tr.controls, 'input locked, scene owned');
    assert(venue.targetOpen === 1, 'doors commanded open');
    assert(tr.card && tr.card.title === cfg.name, 'name card armed');
    tr.update(1 / 60);
    let maxFade = 0, maxZoom = 0, switchFade = -1;
    for (let i = 0; i < 400 && tr.active; i++) {
      tr.update(1 / 60);
      maxFade = Math.max(maxFade, tr.fade);
      maxZoom = Math.max(maxZoom, camera.zoom);
      if (log.includes('set:interior') && switchFade < 0) switchFade = tr.fade;
    }
    assert(log.includes('set:interior'), 'interior state loaded');
    assert(switchFade >= 0.99, 'scene swaps only behind full black (fade=' + switchFade.toFixed(2) + ')');
    assert(maxFade >= 0.999, 'fades fully to black');
    assert(maxZoom > 1.3, 'camera pushed toward the entrance, zoom ' + maxZoom.toFixed(2));
    assert(log.includes('anim'), 'Lester walk-in animated');
    assert(Math.abs(player.x - cfg.final.x) < 6 && Math.abs(player.y - cfg.final.y) < 8, 'Lester ends at the doors ' + player.x.toFixed(0) + ',' + player.y.toFixed(0));
    assert(venue.doorOpen === 0 && venue.targetOpen === 0, 'doors reset behind the black');
    assert(!tr.active && !tr.lock && !tr.controls && tr.fade === 0 && tr.card === null, 'transition fully released');
    // exit back to the plaza
    interior.venueId = 'casino';
    assert(tr.exitVenue() === true, 'exit accepted');
    for (let i = 0; i < 200 && tr.active; i++) tr.update(1 / 60);
    assert(log.includes('set:play'), 'returned to play state');
    assert(player.x === cfg.exitSpawn.x && player.y === cfg.exitSpawn.y && player.facing === 'down', 'Lester placed outside the doors');
    assert(venue.doorOpen > 0.8 && venue.targetOpen === 0, 'doors close in view on exit');
    assert(!tr.active && tr.fade === 0, 'exit transition released');
  });

  t('P5 interior registry + mini world', () => {
    for (const id of ['casino', 'arcade']) {
      const def = getInterior(id);
      assert(def && def.room && def.spawn && def.exit, id + ' interior registered');
      const r = def.room;
      assert(def.spawn.x > r.x && def.spawn.x < r.x + r.w && def.spawn.y > r.y + 100, 'spawn inside the room');
      assert(Math.hypot(def.spawn.x - def.exit.x, def.spawn.y - def.exit.y) > def.exit.radius, 'no exit prompt on arrival');
      const iw = new InteriorWorld(def);
      const free = iw.collide(def.spawn.x, def.spawn.y, 13);
      assert(Math.abs(free.x - def.spawn.x) < 0.01 && Math.abs(free.y - def.spawn.y) < 0.01, 'spawn walkable');
      const blocked = iw.collide(800, r.y - 34, 13);   // pushing into the north wall band
      assert(blocked.y <= r.y - 26 - 13 + 0.5, 'north wall solid, got ' + blocked.y.toFixed(1));
      const st = makeStubCtx();
      def.drawRoom(st.ctx, 2.5);
      assert(st.calls.length > 120, id + ' lobby draws rich: ' + st.calls.length);
      def.grade(st.ctx, { w: 320, h: 240 }, 2.5);
      iw.renderGround(st.ctx, { x: 0, y: 0, w: 100, h: 100 }, 1);
    }
    assert(getInterior('nope') === null, 'unknown venue rejected');
    assert(INTERIORS.casino.zoneName !== INTERIORS.arcade.zoneName, 'distinct lobby identities');
  });

  t('P5 input lock mutes axis + interact', () => {
    const im = new InputManager({ audio: { toggleMuted() {} } });
    im.keys.add('KeyD');
    assert(im.axis.x === 1, 'axis live when unlocked');
    im.locked = true;
    assert(im.axis.x === 0 && im.axis.y === 0, 'axis muted while locked');
    im.pressInteract();
    assert(im.consumeInteract() === false, 'interact muted while locked');
    im.locked = false;
    im.pressInteract();
    assert(im.consumeInteract() === true, 'interact restored after unlock');
    assert(im.axis.x === 1, 'axis restored after unlock');
  });


  // ---------- Phase 6: casino floor ----------
  const buildFloorHarness = () => {
    const bus = new EventBus();
    const def = getInterior('casino');
    const st = {
      em: new EntityManager(),
      world: new InteriorWorld(def),
      interactions: new InteractionSystem(bus),
      player: { x: 800, y: 762 },
      def,
    };
    const launched = [];
    const fakeGame = { events: bus, audio: { play() {} }, games: { launch: (id) => launched.push(id) } };
    const floor = buildCasinoFloor(fakeGame, st);
    return { st, floor, fakeGame, launched, bus };
  };

  t('P6 casino floor: 5 residents + 4 machines + furniture', () => {
    const { st, floor } = buildFloorHarness();
    assert(floor.npcs.length === 5, 'five casino NPCs');
    assert(floor.guests.length === 4 && floor.regular, '4 general guests + 1 regular');
    assert(floor.regular instanceof CasinoRegular, 'regular is the recurring player');
    assert(floor.machines.length === 4, 'four machines');
    assert(floor.machines.map((m) => m.kind).sort().join(',') === 'coin,dice,plinko,slot', 'machine roster');
    for (const m of floor.machines) assert(m.gameId === m.kind, m.kind + ' opens exactly itself');
    for (const m of floor.machines) {
      const f = st.world.collide(m.front.x, m.front.y, 12);
      assert(Math.abs(f.x - m.front.x) < 0.01 && Math.abs(f.y - m.front.y) < 0.01, 'machine front walkable');
      const b = st.world.collide(m.x, m.y, 12);
      assert(Math.hypot(b.x - m.x, b.y - m.y) > 1, 'machine body solid');
    }
    assert(st.world.colliders.some((c) => c.shape === 'circle'), 'card-table colliders present');
  });

  t('P6 regular routine: occupy, ≤1 min session, free, rotate', () => {
    const { floor } = buildFloorHarness();
    const reg = floor.regular;
    const vr = { x: -9999, y: -9999, w: 99999, h: 99999 };
    const sessions = [];
    let cur = null;
    for (let i = 0; i < 60 * 420 && sessions.length < 5; i++) {
      reg.update(1 / 30, i / 30, vr);
      if (reg.machine && !cur) {
        cur = { kind: reg.machine.kind, t: 0 };
        assert(reg.sessionLeft <= 60.0001 && reg.sessionLeft >= 25, 'session 25–60 s, got ' + reg.sessionLeft.toFixed(1));
      }
      if (cur) {
        cur.t += 1 / 30;
        if (!reg.machine) { sessions.push(cur); cur = null; }
      }
    }
    assert(sessions.length >= 2, 'multiple sessions ran');
    for (const ss of sessions) assert(ss.t <= 61, 'session ≤ one minute, got ' + ss.t.toFixed(1));
    assert(sessions.some((ss) => ss.kind !== sessions[0].kind), 'rotates between machines');
    assert(floor.machines.every((m) => !m.occupiedBy), 'seats freed after sessions');
  });

  t('P6 occupied machine: In use label, blocked start, playful bubble, frees', () => {
    const { st, floor, fakeGame, launched } = buildFloorHarness();
    const m = floor.machines[0];
    floor.regular._occupy(m);
    assert(m.occupiedBy === floor.regular, 'machine occupied by the regular');
    const item = st.interactions.query({ x: m.front.x, y: m.front.y });
    assert(item && item.id === 'play-plinko', 'machine item found');
    assert(item.getLabel() === 'In use', 'label shows In use, got ' + item.getLabel());
    item.onInteract(st.player, fakeGame);
    assert(launched.length === 0, 'occupied machine never launches');
    assert(floor.regular.say && floor.regular.say.text.length > 4, 'playful bubble set');
    floor.regular._leaveMachine();
    assert(!m.occupiedBy, 'seat frees when the NPC leaves');
    assert(item.getLabel().indexOf('Play') === 0, 'label back to Play');
    for (const mm of floor.machines) {                       // every machine → own game
      const it = st.interactions.query({ x: mm.front.x, y: mm.front.y });
      launched.length = 0;
      it.onInteract(st.player, fakeGame);
      assert(launched.join() === mm.kind, mm.kind + ' launches ' + launched.join());
    }
  });

  t('P6 game rules pay correctly', () => {
    for (let i = 0; i < 300; i++) {
      const d = plinkoDrop(Math.random);
      assert(d.bin >= 0 && d.bin <= 8 && d.mult === PLINKO_BINS[d.bin], 'plinko bin valid');
      assert(d.steps.length === 9, 'nine peg rows');
    }
    assert(slotMult(['7', '7', '7']) === 25 && slotMult(['★', '★', '★']) === 12, 'slot triples');
    assert(slotMult(['♦', '♦', '♦']) === 8 && slotMult(['♥', '♥', '']) === 2 && slotMult(['7', '', '♥']) === 0, 'slot other-triple/pair/miss');
    assert(slotMult(['', '', '']) === 0, 'three blanks pay nothing');
    assert(slotPayout(['7', '7', '7'], 2) === 50, 'slot payout math');
    assert(diceMult('under', 6) === 2 && diceMult('over', 8) === 2 && diceMult('seven', 7) === 5, 'dice wins');
    assert(diceMult('under', 7) === 0 && diceMult('seven', 9) === 0 && dicePayout('seven', 7, 1) === 5, 'dice losses/payout');
    assert(coinMult('heads', 'heads') === 2 && coinMult('tails', 'heads') === 0 && coinPayout('heads', 'tails', 5) === 0, 'coin rules');
  });

  t('P9 casino wagers: strict zkLTC validation without silent rounding', () => {
    assert(validateWager('0.0005', '2', 8).ok, 'minimum accepted');
    assert(validateWager('1', '2', 8).ok, 'maximum accepted');
    assert(validateWager('0.00049999', '2', 8).code === 'MIN', 'below minimum rejected');
    assert(validateWager('1.00000001', '2', 8).code === 'MAX', 'above maximum rejected');
    assert(validateWager('0.5', '0.4', 8).code === 'BALANCE', 'main-wallet insufficiency rejected');
    for (const bad of ['', ' 0.5', '0.5 ', '-1', '+1', '1e-3', '.5', '1,0', 'abc'])
      assert(validateWager(bad, '2', 8).code === 'FORMAT', 'bad format rejected: ' + bad);
    assert(validateWager('0.000500001', '2', 8).code === 'PRECISION', 'excess precision rejected, not rounded');
    assert(validateWager('0.00050000', '2', 8).atomic === 50000n, 'exact atomic conversion');
  });

  t('P6 LitVM deck: concise, non-repeating until exhausted', () => {
    assert(LITVM_KNOWLEDGE.length >= 12, 'deck size ' + LITVM_KNOWLEDGE.length);
    for (const line of LITVM_KNOWLEDGE) assert(line.length > 20 && line.length < 140, 'concise line');
    const deck = makeKnowledgeDeck(11);
    const seen = new Set();
    for (let i = 0; i < deck.size; i++) {
      const line = deck.next();
      assert(!seen.has(line), 'no repeat until exhausted');
      seen.add(line);
    }
    assert(seen.size === deck.size, 'full deck dealt');
  });

  t('P6 overlay opens over the casino, locks input, back restores', () => {
    const bus = new EventBus();
    const fakeGame = {
      events: bus,
      walletSession: { snapshot: () => ({ mainBalance: null }) },
      input: new InputManager({ audio: { toggleMuted() {} } }),
      audio: { play() {} },
    };
    const overlay = new GameOverlay(fakeGame);
    assert(overlay.open('nope') === false, 'unknown game refused');
    assert(overlay.open('slot') === true, 'slot opens');
    assert(overlay.openId === 'slot' && fakeGame.input.locked === true, 'input locked behind overlay');
    const reg2 = new GameRegistry(bus);
    reg2.register({ id: 'slot', launch: () => overlay.open('slot') });
    assert(reg2.launch('slot').ok === true, 'registry launches the live game');
    overlay.close();
    assert(overlay.openId === null && fakeGame.input.locked === false, 'back restores control');
  });


  // ---------- Phase 7: arcade floor ----------
  const buildArcadeHarness = () => {
    const bus = new EventBus();
    const def = getInterior('arcade');
    const st = {
      em: new EntityManager(),
      world: new InteriorWorld(def),
      interactions: new InteractionSystem(bus),
      player: { x: 800, y: 762 },
      def,
    };
    const launched = [];
    const fakeGame = { events: bus, audio: { play() {} }, games: { launch: (id) => launched.push(id) } };
    const floor = buildArcadeFloor(fakeGame, st);
    return { st, floor, fakeGame, launched, bus };
  };

  t('P7 arcade floor: 5 residents + 4 cabinets + furniture', () => {
    const { st, floor } = buildArcadeHarness();
    assert(floor.npcs.length === 5, 'five arcade NPCs');
    assert(floor.guests.length === 4 && floor.regular, '4 general guests + 1 regular');
    assert(floor.machines.length === 4, 'four cabinets');
    assert(floor.machines.map((m) => m.kind).sort().join(',') === 'memrush,nback,neonescape,tileshift', 'cabinet roster');
    for (const m of floor.machines) assert(m.gameId === m.kind, m.kind + ' opens exactly itself');
    for (const m of floor.machines) {
      const f = st.world.collide(m.front.x, m.front.y, 12);
      assert(Math.abs(f.x - m.front.x) < 0.01, 'cabinet front walkable');
      const b = st.world.collide(m.x, m.y, 12);
      assert(Math.hypot(b.x - m.x, b.y - m.y) > 1, 'cabinet body solid');
    }
    assert(st.world.colliders.filter((c) => c.shape === 'circle').length >= 2, 'stool colliders');
    assert(st.world.colliders.some((c) => c.shape === 'rect' && c.w === 64), 'bench collider');
  });

  t('P7 occupied cabinet: In use, blocked, playful bubble, frees', () => {
    const { st, floor, fakeGame, launched } = buildArcadeHarness();
    const m = floor.machines[2];
    floor.regular._occupy(m);
    assert(m.occupiedBy === floor.regular, 'cabinet occupied');
    const item = st.interactions.query({ x: m.front.x, y: m.front.y });
    assert(item && item.id === 'play-neonescape', 'cabinet item found');
    assert(item.getLabel() === 'In use', 'label In use');
    item.onInteract(st.player, fakeGame);
    assert(launched.length === 0, 'occupied cabinet never launches');
    assert(floor.regular.say && floor.regular.say.text.length > 4, 'playful bubble set');
    floor.regular._leaveMachine();
    for (const mm of floor.machines) {
      const it = st.interactions.query({ x: mm.front.x, y: mm.front.y });
      launched.length = 0;
      it.onInteract(st.player, fakeGame);
      assert(launched.join() === mm.kind, mm.kind + ' launches ' + launched.join());
      assert(it.getLabel().indexOf('Play') === 0, 'free label ' + it.getLabel());
    }
  });

  t('P7 arcade rules: payouts, difficulty curves, lanes', () => {
    assert(memrushPayout(1) === 0 && memrushPayout(2) === 2 && memrushPayout(4) === 5 && memrushPayout(6) === 12, 'memrush tiers');
    assert(tileshiftPayout(1) === 0 && tileshiftPayout(2) === 2 && tileshiftPayout(4) === 5 && tileshiftPayout(6) === 12, 'tileshift tiers');
    for (let w = 1; w < 8; w++) {
      if ((w + 1) % 4 === 0) continue;                     // breathing waves intentionally ease off
      assert(memrushParams(w + 1).k >= memrushParams(w).k, 'memory load grows');
      assert(tileshiftParams(w + 1).swaps >= tileshiftParams(w).swaps, 'puzzle depth grows');
    }
    saveBest('__t', 3); saveBest('__t', 9);
    assert(loadBest('__t') === 9, 'best persists');
    saveBest('__t', 4);
    assert(loadBest('__t') === 9, 'best never regresses');
  });

  t('P7 overlay opens arcade games over the live room', () => {
    const bus = new EventBus();
    const fakeGame = {
      events: bus,
      walletSession: { snapshot: () => ({ mainBalance: null }) },
      input: new InputManager({ audio: { toggleMuted() {} } }),
      audio: { play() {} },
    };
    const overlay = new GameOverlay(fakeGame);
    for (const id of ['memrush', 'tileshift', 'neonescape', 'nback']) {
      assert(overlay.open(id) === true, id + ' opens');
      assert(overlay.openId === id && fakeGame.input.locked === true, id + ' locks input');
      overlay.close();
      assert(fakeGame.input.locked === false, id + ' close restores');
    }
    assert(ARCADE_GAMES.neonescape.title === 'NEON ESCAPE' && ARCADE_GAMES.nback.title === 'N-BACK', 'titles');
  });


  // ---------- Phase 8: arcade reward ledger ----------
  t('P8 zkLTC rewards: rate math, pending ledger, explicitly off-chain', () => {
    // smooth design curve: 20% -> 74% by wave 12, then controlled +3%/wave, capped
    assert(diffIndex(1) === 0.2 && diffIndex(2) === 0.25 && diffIndex(10) === 0.66 && diffIndex(12) === 0.74, 'curve table');
    assert(Math.abs(diffIndex(13) - 0.77) < 1e-9 && diffIndex(40) === 1.0, 'controlled extrapolation + cap');
    for (let w = 1; w < 30; w++) {
      assert(diffIndex(w + 1) - diffIndex(w) <= 0.06 + 1e-9, 'no difficulty spike at wave ' + w);
      assert(diffIndex(w + 1) >= diffIndex(w), 'curve never goes backwards');
    }
    assert(breath(7) === 1 && breath(8) === 0.88 && breath(12) === 0.88, 'breathing room every 4th wave');
    // mobile-first fairness: reaction windows and speeds stay humanly readable at EVERY wave
    for (let w = 1; w <= 30; w++) {
      const mr = memrushParams(w), ts = tileshiftParams(w);
      assert(mr.mem >= 1.8 && mr.n <= 5 && mr.k <= mr.n * mr.n - 3, 'memory preview never a guess at wave ' + w);
      assert(ts.preview >= 1.6 && ts.n <= 4 && ts.swaps <= 9, 'puzzle preview/depth capped at wave ' + w);
    }
    // wave 1 is a teaching wave: gentle on every lever
    assert(memrushParams(1).n === 3 && memrushParams(1).k === 2 && memrushParams(1).mem >= 3, 'wave 1 memory is gentle');
    assert(tileshiftParams(1).swaps === 1 && tileshiftParams(1).preview >= 4, 'wave 1 puzzle is gentle');
    // puzzles are ALWAYS solvable: scrambled by swaps from the solved target,
    // and the move budget covers a concrete solution + slack.
    for (let w = 1; w <= 30; w++) for (let seed = 1; seed <= 12; seed++) {
      const rng = (() => { let x = seed * 97 + w * 13; return () => ((x = x * 16807 % 2147483647) / 2147483647); })();
      const pz = makeTileShiftPuzzle(w, rng);
      assert(!pz.board.every((v, i) => v === pz.target[i]), 'puzzle presented scrambled at w' + w);
      assert(pz.minSwaps >= 1 && Math.abs(pz.minSwaps - tileshiftParams(w).swaps) <= 1, 'depth on curve at w' + w);
      assert(pz.minSwaps + tileshiftSlack(w) >= 2, 'budget always leaves room at w' + w);
      const pat = makeMemoryPattern(w, rng);
      assert(new Set(pat.cells).size === pat.k && pat.k <= pat.n * pat.n - 3, 'pattern readable at w' + w);
    }
    assert(WAVE_TOKEN_RATE === 0.00001, 'rate is 0.00001 per wave');
    assert(tokensForWaves(0) === 0 && tokensForWaves(1) === 0.00001, 'one wave');
    assert(tokensForWaves(7) === 0.00007 && tokensForWaves(-3) === 0, 'seven waves / clamp');
    assert(fmtTokens(0.00003) === '0.00003', 'five-decimal format');
    const before = loadLedger();
    const rec = recordSession('__unit', 3);
    assert(rec.tokens === 0, 'no active authenticated session cannot display earned reward');
    const after = loadLedger();
    assert(after.tokens === before.tokens && after.waves === before.waves, 'client report never credits authoritative balance');
    setRunPending(0.00002);
    assert(zkDisplay() === after.tokens, 'live client estimate is excluded from authoritative balance');
    setRunPending(0);
    assert(zkDisplay() === after.tokens, 'display remains server-cache balance');
  });

  t('Live game smoke', () => {
    assert(game.states.currentName.length > 0, 'state machine live');
    assert(game.loop.running === true, 'loop running');
    assert(game.canvas.width > 0, 'canvas sized');
    assert(game.walletSession.snapshot().token === 'zkLTC', 'LitVM zkLTC wallet session live');
  });

  const pass = lines.filter((l) => l.ok).length;
  const results = { pass, fail: lines.length - pass, total: lines.length, lines };
  for (const l of lines) if (!l.ok) console.error('[VEYRA TEST FAIL]', l.name, l.info);
  console.info(`[VEYRA TESTS] ${pass}/${lines.length} passed`);
  return results;
}
