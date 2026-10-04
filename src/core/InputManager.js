// Veyra — unified input: keyboard (desktop) + virtual stick & buttons (touch)
import { clamp } from './util.js';

const KEY_AXIS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export class InputManager {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    this.vAxis = { x: 0, y: 0 };          // virtual stick (-1..1)
    this.vSprint = false;
    this._interactQueued = false;
    this.stick = { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 };
    this._tap = null;
    this.STICK_RADIUS = 56;
    this.stickFade = 0;              // visual fade (drawn by PlayState)
    this.locked = false;             // cinematics (Phase 5 transitions) mute input

    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => this._onKeyUp(e));
    window.addEventListener('blur', () => this.reset());
  }

  attachCanvas(canvas) {
    canvas.addEventListener('pointerdown', (e) => this._onDown(e), { passive: false });
    canvas.addEventListener('pointermove', (e) => this._onMove(e), { passive: false });
    const end = (e) => this._onUp(e);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // pure helper (unit-testable)
  static computeAxis(keySet, vAxis) {
    let x = 0, y = 0;
    for (const k of keySet) {
      const a = KEY_AXIS[k];
      if (a) { x += a[0]; y += a[1]; }
    }
    x += vAxis ? vAxis.x : 0;
    y += vAxis ? vAxis.y : 0;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }

  get axis() { return this.locked ? { x: 0, y: 0 } : InputManager.computeAxis(this.keys, this.vAxis); }
  get stickActive() { return this.stick.active; }
  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.vSprint; }

  pressInteract() { if (!this.locked) this._interactQueued = true; }
  consumeInteract() {
    if (this.locked) { this._interactQueued = false; return false; }
    const q = this._interactQueued; this._interactQueued = false; return q;
  }
  setVirtualAxis(x, y) { this.vAxis.x = x; this.vAxis.y = y; }
  setSprint(v) { this.vSprint = !!v; }
  reset() { this.keys.clear(); this.vAxis.x = 0; this.vAxis.y = 0; this.vSprint = false; this.stick.active = false; }

  _onKeyDown(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'KeyE' || e.code === 'Enter') this.pressInteract();
    if (e.code === 'KeyM') this.game.audio.toggleMuted();
    if (e.code === 'Escape' || e.code === 'KeyP') this.game.togglePause();
  }
  _onKeyUp(e) { this.keys.delete(e.code); }

  // Fixed, thumb-reachable home for the virtual joystick: bottom-left corner,
  // inside the safe area, clear of the RUN / A buttons on the right.
  stickBase() {
    const m = 26;
    return { x: m + this.STICK_RADIUS, y: window.innerHeight - m - this.STICK_RADIUS };
  }

  _onDown(e) {
    if (e.pointerType === 'mouse') return;             // mouse never drives movement
    e.preventDefault();
    const leftZone = e.clientX < window.innerWidth * 0.45 && e.clientY > window.innerHeight * 0.30;
    if (leftZone && !this.stick.active) {
      const b = this.stickBase();
      this.stick = { active: true, id: e.pointerId, ox: b.x, oy: b.y, dx: 0, dy: 0 };
      this._updateStick(e.clientX, e.clientY);
    } else if (!leftZone) {
      this._tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    }
  }
  _updateStick(cx, cy) {
    let dx = cx - this.stick.ox;
    let dy = cy - this.stick.oy;
    const m = Math.hypot(dx, dy);
    if (m > this.STICK_RADIUS) { dx = dx / m * this.STICK_RADIUS; dy = dy / m * this.STICK_RADIUS; }
    this.stick.dx = dx; this.stick.dy = dy;
    this.setVirtualAxis(dx / this.STICK_RADIUS, dy / this.STICK_RADIUS);
  }
  _onMove(e) {
    if (this.stick.active && e.pointerId === this.stick.id) this._updateStick(e.clientX, e.clientY);
  }
  _onUp(e) {
    if (this.stick.active && e.pointerId === this.stick.id) {
      this.stick.active = false; this.stick.dx = 0; this.stick.dy = 0;
      this.setVirtualAxis(0, 0);
    }
    if (this._tap && this._tap.id === e.pointerId) {
      const dt = performance.now() - this._tap.t;
      const moved = Math.hypot(e.clientX - this._tap.x, e.clientY - this._tap.y);
      if (dt < 300 && moved < 14) this.pressInteract();   // right-side tap = interact
      this._tap = null;
    }
  }
}
