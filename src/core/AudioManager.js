// Veyra — audio foundation: WebAudio synth SFX + ambient bed (zero asset downloads)
import { Storage } from './Storage.js';

export class AudioManager {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.master = null;
    this.ambient = null;
    this.muted = !!Storage.get('veyra:muted', false);
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMuted() { this.setMuted(!this.muted); return this.muted; }
  setMuted(m) {
    this.muted = !!m;
    Storage.set('veyra:muted', this.muted);
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    this.game.events.emit('audio:muted', { muted: this.muted });
  }

  // ---- synthesized one-shots ----
  _tone(freq, dur, type = 'sine', gain = 0.2, slideTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'click':   this._tone(760, 0.09, 'triangle', 0.16); break;
      case 'confirm': this._tone(520, 0.1, 'triangle', 0.18); this._tone(780, 0.14, 'triangle', 0.16, null, 0.08); break;
      case 'back':    this._tone(520, 0.12, 'triangle', 0.16, 320); break;
      case 'sit':     this._tone(220, 0.12, 'sine', 0.2, 150); break;
      case 'stand':   this._tone(180, 0.1, 'sine', 0.18, 300); break;
      case 'deny':    this._tone(200, 0.12, 'square', 0.08, 160); break;
      case 'tick':    this._tone(920, 0.035, 'square', 0.045); break;
      case 'chip':    this._tone(1450, 0.05, 'triangle', 0.1); this._tone(1850, 0.04, 'triangle', 0.06, null, 0.03); break;
      case 'win':     this._tone(660, 0.09, 'triangle', 0.16); this._tone(880, 0.1, 'triangle', 0.15, null, 0.09); this._tone(1320, 0.16, 'triangle', 0.14, null, 0.18); break;
      case 'lose':    this._tone(240, 0.16, 'sine', 0.12, 150); break;
      case 'shot':    this._tone(880, 0.05, 'square', 0.07, 240); this._tone(180, 0.06, 'sawtooth', 0.05, 90); break;
      case 'boom':    this._tone(120, 0.28, 'sine', 0.16, 40); this._tone(60, 0.34, 'triangle', 0.12, 30); break;
      case 'hit':     this._tone(320, 0.09, 'sawtooth', 0.09, 140); break;
      case 'warn':    this._tone(1200, 0.07, 'square', 0.05); this._tone(1200, 0.07, 'square', 0.05, null, 0.11); break;
      case 'step':    this._tone(75 + Math.random() * 25, 0.045, 'sine', 0.035, 45); break;
      case 'stepN':   this._tone(70 + Math.random() * 25, 0.04, 'sine', 0.016, 40); break;
      default: break;
    }
  }

  // ---- casino floor ambience: sparse machine chinks over the room tone ----
  startCasino() {
    if (this._casino) return;
    this._casino = setInterval(() => {
      if (this.muted || !this.ctx) return;
      const r = Math.random();
      if (r < 0.4) this._tone(420 + Math.random() * 500, 0.05, 'triangle', 0.035);
      else if (r < 0.55) this._tone(1500 + Math.random() * 500, 0.04, 'square', 0.02);
    }, 2400);
  }
  stopCasino() {
    if (this._casino) { clearInterval(this._casino); this._casino = null; }
  }

  // ---- arcade floor ambience: chiptune-ish blips over the room tone ----
  startArcade() {
    if (this._arcade) return;
    const scale = [523, 659, 784, 880, 1046];
    this._arcade = setInterval(() => {
      if (this.muted || !this.ctx) return;
      const r = Math.random();
      if (r < 0.45) this._tone(scale[(Math.random() * scale.length) | 0], 0.06, 'square', 0.022);
      else if (r < 0.6) this._tone(scale[(Math.random() * scale.length) | 0] / 2, 0.09, 'triangle', 0.03);
    }, 1900);
  }
  stopArcade() {
    if (this._arcade) { clearInterval(this._arcade); this._arcade = null; }
  }

  // ---- looping city ambience (procedural noise, tiny memory) ----
  startAmbient() {
    if (!this.ctx || this.ambient) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {                       // brown-ish noise
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.4;
    const g = this.ctx.createGain(); g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.055, this.ctx.currentTime + 2.5);
    const lfo = this.ctx.createOscillator();
    const lfoG = this.ctx.createGain();
    lfo.frequency.value = 0.07; lfoG.gain.value = 0.02;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(); lfo.start();
    this.ambient = { src, g, lfo };
  }
  stopAmbient() {
    if (!this.ambient) return;
    const { src, lfo } = this.ambient;
    try { src.stop(); lfo.stop(); } catch (e) {}
    this.ambient = null;
  }
}
