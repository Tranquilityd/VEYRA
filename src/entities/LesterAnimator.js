// Veyra — Phase 3: Lester's animation state machine & procedural pose solver.
// States: IDLE, WALK, RUN, TURN, IDLE_ACTION (+ SEAT on benches).
// Produces a pose object consumed by LesterRig (part transforms of the artwork).
import { MOVE, LESTER } from '../core/movementConfig.js';
import { clamp, lerp } from '../core/util.js';

// exponential smoothing toward a target (frame-rate independent)
const dampTo = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));

const LEG_LEN = 352;                 // source px hip→sole
const TAU = Math.PI * 2;
const ACTIONS = ['look', 'laugh', 'dance', 'stretch', 'shift'];

const rand = (a, b) => a + Math.random() * (b - a);

export class LesterAnimator {
  constructor() {
    this.state = 'IDLE';
    this.time = 0;
    this.phase = 0;                  // gait cycle phase (rad, 1 full cycle = 2 steps)
    this.amp = 0;                    // gait amplitude envelope (0 idle → 1 moving)
    this.runBlend = 0;               // 0 walk → 1 run
    this.sideAmt = 0;                // 0 front/back view → 1 side view
    this.fb = -1;                    // -1 facing down/front … +1 facing up/back
    this.flip = 1;                   // discrete mirror sign
    this.turnT = 0;                  // >0 while playing a turn squash
    this.turnDur = 0.16;
    this.idleTime = 0;
    this.nextAction = rand(MOVE.idleActionMinDelay, MOVE.idleActionMaxDelay);
    this.action = null;              // { name, t, dur }
    this.actionBlend = 0;
    this.seated = false;
    this.speed = 0;
  }

  forceAction(name) {
    if (!ACTIONS.includes(name)) return false;
    this._startAction(name);
    return true;
  }

  _startAction(name) {
    const dur = { look: 2.2, laugh: 1.6, dance: 2.6, stretch: 1.9, shift: 1.4 }[name];
    this.action = { name, t: 0, dur };
    this.idleTime = 0;
    this.nextAction = rand(MOVE.idleActionMinDelay, MOVE.idleActionMaxDelay);
  }

  // vx, vy: world velocity; sprint: run intent; mag: input magnitude (0..1)
  update(dt, vx, vy, sprint, mag, seated) {
    this.time += dt;
    this.seated = !!seated;
    this.speed = Math.hypot(vx, vy);
    const moving = this.speed > MOVE.stopSpeed && !this.seated;

    // movement cancels a personality action immediately (blend-out via envelopes)
    if (this.action && moving) this.action = null;

    // ---- state transitions ----
    const runIntent = sprint && moving;   // Player resolves Shift / RUN / full stick push
    let next;
    if (this.seated) next = 'SEAT';
    else if (this.action) next = 'IDLE_ACTION';
    else if (!moving) next = 'IDLE';
    else next = runIntent && this.speed > MOVE.walkSpeed * 0.72 ? 'RUN' : 'WALK';

    // turning: horizontal reversal while moving → brief TURN state
    if (moving && Math.abs(vx) > this.speed * 0.3) {
      const sign = vx > 0 ? 1 : -1;
      if (sign !== this.flip && this.turnT <= 0 && this.amp > 0.2) {
        this.turnT = this.turnDur;
      }
      if (Math.abs(vx) > this.speed * 0.45) this.flip = sign;
    }
    if (this.turnT > 0) { this.turnT -= dt; next = this.seated ? next : 'TURN'; }
    this.state = next;

    // action timer
    if (this.action) {
      this.action.t += dt;
      if (this.action.t >= this.action.dur) this.action = null;
    }
    if (!moving && !this.seated) {
      this.idleTime += dt;
      if (!this.action && this.idleTime > this.nextAction) this._startAction(ACTIONS[(Math.random() * ACTIONS.length) | 0]);
    } else if (moving) {
      this.idleTime = 0;
    }

    // ---- smooth envelopes ----
    this.amp = dampTo(this.amp, moving ? 1 : 0, 10, dt);
    this.runBlend = dampTo(this.runBlend, runIntent ? 1 : 0, 7, dt);
    const dirx = moving ? vx / this.speed : 0;
    const diry = moving ? vy / this.speed : 0;
    this.sideAmt = dampTo(this.sideAmt, this.seated ? 0 : (moving ? clamp(Math.abs(dirx) * 1.25, 0, 1) : this.sideAmt * 0.9), this.seated ? 16 : 9, dt);
    this.fb = dampTo(this.fb, this.seated ? -1 : (moving ? diry : this.fb), this.seated ? 16 : 9, dt);

    // ---- gait cycle: NPC-style step cadence (same feel as residents) ----
    const stepHz = lerp(8.4, 13.5, this.runBlend);      // walk / run, like NPC painter
    this.phase = (this.phase + dt * stepHz * this.amp) % TAU;
  }

  // ---------------------------------------------------------------- pose ----
  pose() {
    const t = this.time, ph = this.phase, amp = this.amp, run = this.runBlend;
    const sideW = this.sideAmt, frontW = 1 - this.sideAmt;
    const P = {
      scaleX: this.flip * 1.12 * (1 - 0.12 * sideW),
      squashY: 1, bounce: 0, lean: 0.085 * run * amp,
      shadowDir: this.flip, shadowSpread: 1 + run * 0.12 * amp,
      joints: {}, order: null, state: this.state, action: this.action && this.action.name,
      side: sideW, flipSign: this.flip, seated: this.seated, time: t,
    };

    // turn squash envelope (width dips edge-on and recovers)
    if (this.turnT > 0) {
      const k = 1 - this.turnT / this.turnDur;
      P.scaleX *= 1 - 0.82 * Math.sin(Math.PI * clamp(k, 0, 1));
    }

    // ---- gait: planted stance half + lifted swing half per leg ----
    const strideSrc = (lerp(LESTER.height * MOVE.strideWalk, LESTER.height * MOVE.strideRun, run)) / (LESTER.height / LESTER.srcH);
    const A = Math.asin(clamp(strideSrc / (2 * LEG_LEN), 0, 0.92));
    const liftMax = lerp(30, 74, run);
    const legs = [];
    for (let i = 0; i < 2; i++) {
      const u = ((ph / TAU) + i * 0.5) % 1;
      let rot, lift;
      if (u < 0.5) { const w = u / 0.5; rot = A * (1 - 2 * w); lift = 0; }        // stance: foot planted, body travels
      else { const w = (u - 0.5) / 0.5; rot = -A * Math.cos(Math.PI * w); lift = liftMax * Math.sin(Math.PI * w); }
      legs.push({ rot, lift, u });
    }
    // flight moment in run: both feet off between stance swaps
    const flight = run * amp * Math.max(0, Math.sin(ph * 2)) * 0.35;

    const frontW2 = frontW * (1 - Math.abs(this.fb) * 0.25);
    const step = lerp(4.6, 6.4, run);                   // NPC-style step offset (world px)
    for (let i = 0; i < 2; i++) {
      const sw = Math.sin(ph + (i ? Math.PI : 0));      // alternating step signal
      const liftN = Math.max(0, Math.sin(ph + (i ? Math.PI : 0) + Math.PI * 0.5));
      P.joints[i === 0 ? 'legL' : 'legR'] = {
        rot: amp * (sw * 0.16 * sideW + (i === 0 ? -1 : 1) * 0.10 * liftN * frontW2),
        x: amp * sw * step * sideW,
        y: -amp * liftN * lerp(2.6, 4.6, run) - flight * 20,
        sy: 1 - amp * 0.08 * frontW2 * liftN,
      };
    }
    // draw the trailing leg first
    const backIdx = legs[0].rot <= legs[1].rot ? 0 : 1;
    P.order = [backIdx === 0 ? 'legL' : 'legR', backIdx === 0 ? 'legR' : 'legL', 'armB', 'torso', 'head', 'armF'];

    // ---- torso / head / arm ----
    const bob = amp * (Math.abs(Math.cos(ph)) * lerp(2.2, 3.6, run) + flight * 6);
    const breath = Math.sin(t * 2.1) * 0.9 + Math.sin(t * 1.3) * 0.4;
    P.bounce = bob * 0.55 + (amp < 0.5 ? breath * (1 - amp) : 0);
    const sway = Math.sin(ph) * 4 * frontW2 * amp;
    P.joints.torso = { rot: amp * Math.sin(ph) * 0.02 * frontW2 + breath * 0.004, x: sway, y: amp * 1.5 };
    P.joints.head = { rot: amp * -Math.sin(ph) * 0.035 + breath * 0.006, y: -amp * Math.abs(Math.cos(ph)) * 1.6 + (this.fb > 0.4 ? 4 : 0), x: -sway * 0.4 };
    const armA = Math.sin(ph + Math.PI) * lerp(0.30, 0.52, run);   // NPC-like arm swing
    const armB = Math.sin(ph) * lerp(0.28, 0.48, run);
    P.joints.armF = {
      rot: amp * (armA * sideW + armA * 0.8 * frontW2) + Math.sin(t * 1.7) * 0.05 * (1 - amp),
      y: amp * 1.0,
    };
    P.joints.armB = {
      rot: amp * (armB * sideW + armB * 0.8 * frontW2) + Math.sin(t * 1.7 + 2.1) * 0.05 * (1 - amp),
      y: amp * 1.0,
    };

    // ---- idle personality actions ----
    if (this.action) this._applyAction(P);
    if (this.seated) this._applySeat(P);
    return P;
  }

  fbUp() { return clamp(this.fb, 0, 1); }

  _applyAction(P) {
    const a = this.action;
    const k = clamp(a.t / a.dur, 0, 1);
    const env = Math.sin(Math.PI * k);                    // in/out envelope
    const J = P.joints;
    switch (a.name) {
      case 'look': {
        const s = Math.sin(k * Math.PI * 2);              // one side, then the other
        J.head.rot += s * 0.16 * env; J.head.x += s * 16 * env;
        J.torso.rot += s * 0.03 * env;
        break;
      }
      case 'laugh': {
        const b = Math.abs(Math.sin(a.t * 11)) * env;
        P.bounce += b * 5; J.torso.rot += Math.sin(a.t * 11) * 0.035 * env;
        J.head.rot += Math.sin(a.t * 11 + 1) * 0.07 * env; J.head.y += b * 2;
        J.armF.rot += -1.15 * env;                         // hand to belly
        J.torso.x += Math.sin(a.t * 5.5) * 1.5 * env;
        break;
      }
      case 'dance': {
        const w = a.t * TAU * 1.6;
        J.torso.x += Math.sin(w) * 11 * env; J.torso.rot += Math.sin(w) * 0.07 * env;
        P.bounce += Math.abs(Math.sin(w)) * 6 * env;
        J.armF.rot += (-1.9 + Math.sin(w * 2) * 0.35) * env;   // arm up waving
        J.head.rot += Math.sin(w + 1.4) * 0.09 * env; J.head.y += Math.sin(w * 2) * 2 * env;
        J.legL.rot += Math.sin(w) * 0.10 * env; J.legR.rot += -Math.sin(w) * 0.10 * env;
        break;
      }
      case 'stretch': {
        J.armF.rot += -2.5 * env;                          // arm overhead
        J.torso.sy = 1 + 0.035 * env; J.torso.y -= 6 * env;
        J.head.rot += -0.10 * env; J.head.y -= 3 * env;
        P.bounce -= 2.5 * env;
        break;
      }
      case 'shift': {
        const s = Math.sin(Math.PI * k);
        J.torso.rot += 0.055 * s; J.torso.x += 8 * s;
        J.head.rot += -0.03 * s; J.head.x += -4 * s;
        J.legL.rot += 0.06 * s; J.legR.rot += -0.04 * s;
        break;
      }
    }
  }

  _applySeat(P) {
    const J = P.joints, t = this.time;
    const breath = Math.sin(t * 1.9) * 0.8;
    const footSwing = Math.sin(t * 1.35) * 0.045;
    const glance = Math.sin(t * 0.55) * 0.055;
    // Upright, front-facing bench pose: helmet stays above the backrest and
    // remains fully readable while the body settles naturally onto the seat.
    P.bounce = breath * 0.35; P.lean = 0.018;
    J.legL = { rot: -0.34 + footSwing, sy: 0.66, y: 88, x: -7 };
    J.legR = { rot: 0.30 - footSwing, sy: 0.64, y: 90, x: 8 };
    J.torso = { rot: Math.sin(t * 0.7) * 0.008, y: 36 + breath * 0.45 };
    J.head = { rot: glance, y: 20 + breath * 0.25, x: Math.sin(t * 0.55) * 1.5 };
    J.armF = { rot: -0.62 + Math.sin(t * 1.1) * 0.025, y: 29 };
    J.armB = { rot: -0.72 - Math.sin(t * 1.1) * 0.02, y: 31 };
    P.order = ['legR', 'legL', 'armB', 'torso', 'head', 'armF'];
  }
}
