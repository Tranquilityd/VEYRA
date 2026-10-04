// Veyra — requestAnimationFrame game loop with clamped delta time
export class GameLoop {
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this.running = false;
    this._raf = 0;
    this._last = 0;
    this.time = 0;          // seconds since loop start (game clock)
    this.fps = 60;          // smoothed fps (debug)
    this._tick = this._tick.bind(this);
  }
  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }
  stop() { this.running = false; cancelAnimationFrame(this._raf); }
  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.05) dt = 0.05;          // clamp: avoid spiral after tab-switch
    if (dt < 0) dt = 0;
    this.time += dt;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    this.update(dt, this.time);
    this.render(this.time);
  }
}
