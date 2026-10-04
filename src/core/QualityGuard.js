// Veyra — adaptive quality guard: keeps mobile frame-rate up by stepping the
// render DPR cap down when the rolling FPS sags, and back up when there is
// headroom (with hysteresis so it never flaps). Pure logic + tiny wrapper.

// levels are DPR caps; index 0 = best quality
export const QUALITY_LEVELS = [2, 1.5, 1];

// pure transition rule (unit-pinned): returns the next state
export function qualityStep(st, fps) {
  const s = { level: st.level, bad: st.bad, good: st.good };
  if (fps < 45) { s.bad++; s.good = 0; } else if (fps > 55) { s.good++; s.bad = 0; } else { s.bad = 0; s.good = 0; }
  if (s.bad >= 90 && s.level < QUALITY_LEVELS.length - 1) { s.level++; s.bad = 0; s.good = 0; }   // ~1.5 s sag
  if (s.good >= 360 && s.level > 0) { s.level--; s.good = 0; s.bad = 0; }                          // ~6 s headroom
  return s;
}

export class QualityGuard {
  constructor(onLevel) {
    this.onLevel = onLevel;
    this.st = { level: 0, bad: 0, good: 0 };
    this.ema = 60;
  }
  get cap() { return QUALITY_LEVELS[this.st.level]; }
  tick(dt) {
    const fps = 1 / Math.max(dt, 1e-4);
    this.ema += (Math.min(120, fps) - this.ema) * 0.08;
    const next = qualityStep(this.st, this.ema);
    const changed = next.level !== this.st.level;
    this.st = next;
    if (changed && this.onLevel) this.onLevel(this.cap);
  }
}
