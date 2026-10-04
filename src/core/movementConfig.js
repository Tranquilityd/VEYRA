// Veyra — Phase 3: single source of truth for Lester's movement & animation tuning.
// Suggested starting values were walk 120 / run 220 / accel 900 / decel 1100;
// speeds were tuned upward after playtesting against world + camera scale
// (Phase 1/2 felt-right values), accel/decel kept as suggested.
export const MOVE = {
  walkSpeed: 172,        // px/s
  runSpeed: 285,         // px/s
  accel: 900,            // px/s^2 (speed-up ramp)
  decel: 1100,           // px/s^2 (slow-down ramp)
  joystickRunThreshold: 0.92,  // stick push beyond this counts as run intent
  moveDeadzone: 0.10,          // axis magnitude below this = stopped
  stopSpeed: 9,                // |v| below this = not moving
  turnRate: 9.0,               // how fast facing interpolates (damp lambda)
  strideWalk: 0.55,            // stride as fraction of body height (walk)
  strideRun: 0.95,             // stride as fraction of body height (run)
  idleActionMinDelay: 4.5,     // s of idle before personality actions may start
  idleActionMaxDelay: 9.0,
};

export const LESTER = {
  height: 69,            // world px tall = exactly 1.5x NPC_HEIGHT (46)
  radius: 13,            // collision radius (unchanged from Phase 1)
  srcW: 310, srcH: 804,  // source artwork size
};
