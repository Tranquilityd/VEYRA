// Veyra — DOM UI manager: screens, HUD bindings, touch buttons, modals
import { isMobileLike } from '../core/device.js';
import { fmtTokens, zkDisplay } from '../games/arcadeRewards.js';

const SND_ON = '<svg viewBox="0 0 24 24" class="ic"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M18.8 6a8 8 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
const SND_OFF = '<svg viewBox="0 0 24 24" class="ic"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const FS_ENTER = '<svg viewBox="0 0 24 24" class="ic"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FS_EXIT = '<svg viewBox="0 0 24 24" class="ic"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export class UIManager {
  constructor(game) {
    this.game = game;
    this.el = {};
  }

  init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      menu: $('screen-menu'), hud: $('screen-hud'), pause: $('screen-pause'),
      modal: $('modal-controls'),
      play: $('btn-play'), controls: $('btn-controls'), controls2: $('btn-controls-2'),
      closeControls: $('btn-close-controls'),
      sndMenu: $('btn-sound-menu'), sndHud: $('btn-sound-hud'), sndPause: $('btn-sound-pause'),
      fsMenu: $('btn-fullscreen-menu'), fsHud: $('btn-fullscreen'),
      pauseBtn: $('btn-pause'), resume: $('btn-resume'), quit: $('btn-quit'),
      zone: $('zone-name'), wallet: $('wallet-amount'), walletAddress: $('wallet-address-short'), walletChip: $('chip-wallet'), walletDisconnect: $('btn-wallet-disconnect'), zkChip: $('chip-zk'), zk: $('zk-amount'),
      run: $('btn-run'), interact: $('btn-interact'),
    };
    if (isMobileLike) document.body.classList.add('touch');

    const g = this.game;
    this.el.play.addEventListener('click', () => {
      g.audio.unlock(); g.audio.play('confirm'); g.audio.startAmbient();
      g.startPlay();
    });
    const openControls = () => { g.audio.play('click'); this.el.modal.classList.remove('hidden'); };
    this.el.controls.addEventListener('click', openControls);
    this.el.controls2.addEventListener('click', openControls);
    this.el.closeControls.addEventListener('click', () => { g.audio.play('back'); this.el.modal.classList.add('hidden'); });

    const toggleSound = () => { g.audio.unlock(); g.audio.toggleMuted(); g.audio.play('click'); };
    this.el.sndMenu.addEventListener('click', toggleSound);
    this.el.sndHud.addEventListener('click', toggleSound);
    this.el.sndPause.addEventListener('click', toggleSound);

    this.el.pauseBtn.addEventListener('click', () => { g.audio.play('click'); g.togglePause(); });
    this.el.resume.addEventListener('click', () => g.togglePause());
    this.el.quit.addEventListener('click', () => { g.audio.play('back'); g.toMenu(); });

    // touch hold-to-run
    const run = this.el.run;
    const runOn = (e) => { e.preventDefault(); g.input.setSprint(true); run.classList.add('held'); };
    const runOff = () => { g.input.setSprint(false); run.classList.remove('held'); };
    run.addEventListener('pointerdown', runOn);
    run.addEventListener('pointerup', runOff);
    run.addEventListener('pointercancel', runOff);
    run.addEventListener('pointerleave', runOff);
    // touch interact
    this.el.interact.addEventListener('pointerdown', (e) => { e.preventDefault(); g.input.pressInteract(); });

    // fullscreen toggle (menu + HUD)
    const fsSupported = (!!document.fullscreenEnabled || !!document.webkitFullscreenEnabled) && this.el.fsMenu && this.el.fsHud;
    if (!fsSupported) {
      if (this.el.fsMenu) this.el.fsMenu.style.display = 'none';
      if (this.el.fsHud) this.el.fsHud.style.display = 'none';
    } else {
      const toggleFs = () => {
        this.game.audio.play('click');
        const el = document.fullscreenElement || document.webkitFullscreenElement;
        if (el) {
          if (document.exitFullscreen) document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } else {
          const root = document.documentElement;
          const req = root.requestFullscreen || root.webkitRequestFullscreen;
          if (req) { try { const p = req.call(root); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
        }
      };
      this.el.fsMenu.addEventListener('click', toggleFs);
      this.el.fsHud.addEventListener('click', toggleFs);
      const fsChange = () => this._fsIcons(!!(document.fullscreenElement || document.webkitFullscreenElement));
      document.addEventListener('fullscreenchange', fsChange);
      document.addEventListener('webkitfullscreenchange', fsChange);
      this._fsIcons(false);
    }

    // LitVM wallet and server-validated arcade balance are intentionally separate.
    g.events.on('litvm:wallet', (snapshot) => this.setWallet(snapshot));
    this.el.walletChip.addEventListener('click', async () => {
      if (g.walletSession.account) return g.walletPanel.toggle();
      if (g.walletSession.state === 'connecting' || g.walletSession.state === 'awaiting signature') return;
      this.el.walletChip.disabled = true;
      try { await g.walletSession.connect({ userInitiated: true }); }
      catch { /* the wallet state displays the safe connection error */ }
      finally { this.el.walletChip.disabled = false; }
    });
    this.el.walletDisconnect.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.stopImmediatePropagation();
    });
    this.el.walletDisconnect.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      g.input.setSprint(false);
      g.walletSession.disconnect({ manual: true });
    });
    this.el.zkChip.addEventListener('click', () => g.walletPanel.toggle());
    g.events.on('audio:muted', ({ muted }) => this._soundIcons(muted));
    this.setWallet(g.walletSession.snapshot());
    this._soundIcons(g.audio.muted);
    this.setZk();
    window.addEventListener('veyra:zkltc', () => this.setZk());
  }

  _soundIcons(muted) {
    const html = muted ? SND_OFF : SND_ON;
    this.el.sndMenu.innerHTML = html;
    this.el.sndHud.innerHTML = html;
    this.el.sndPause.textContent = muted ? 'Sound: Off' : 'Sound: On';
  }
  _fsIcons(active) {
    const html = active ? FS_EXIT : FS_ENTER;
    this.el.fsMenu.innerHTML = html;
    this.el.fsHud.innerHTML = html;
  }
  setWallet(s) {
    const busy = s.state === 'connecting' || s.state === 'awaiting signature';
    this.el.walletAddress.textContent = s.address ? 'MAIN · ' + s.addressShort : busy ? 'MAIN WALLET' : s.state === 'failed' ? 'WALLET ERROR · TAP TO RETRY' : 'MAIN WALLET';
    this.el.wallet.textContent = s.address
      ? (s.mainBalance == null ? 'Connected' : Number(s.mainBalance).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') + ' zkLTC')
      : busy ? (s.state === 'awaiting signature' ? 'SIGN MESSAGE' : 'CONNECTING…') : 'CONNECT WALLET';
    this.el.walletChip.title = s.address ? `Connected ${s.address}` : (s.detail || 'Connect Main Wallet');
    this.el.walletDisconnect.classList.toggle('connected', !!s.address);
    if (this.el.zk) this.el.zk.textContent = fmtTokens(s.arcadeBalance == null ? zkDisplay() : s.arcadeBalance) + ' zkLTC';
  }
  setZk() { if (this.el.zk) this.el.zk.textContent = fmtTokens(zkDisplay()) + ' zkLTC'; }
  setZone(name) { this.el.zone.textContent = name; }
  setInteract(on) { this.el.interact.classList.toggle('lit', on); }

  _show(el, on) { el.classList.toggle('active', on); }
  showMenu() { this._show(this.el.menu, true); this._show(this.el.hud, false); this._show(this.el.pause, false); this.game.minimap.hide(); }
  showPlay() { this._show(this.el.menu, false); this._show(this.el.hud, true); this._show(this.el.pause, false); this.game.minimap.show(); }
  showPause(on) { this._show(this.el.pause, on); }
  hideAll() { this._show(this.el.menu, false); this._show(this.el.hud, false); this._show(this.el.pause, false); this.game.minimap.hide(); }
}
