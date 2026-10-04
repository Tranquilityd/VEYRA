// Veyra — DOM UI manager: screens, HUD bindings, touch buttons, modals
import { isMobileLike } from '../core/device.js';
import { fmtTokens, zkDisplay } from '../games/arcadeRewards.js';
import { SiteEntryGate } from './SiteEntryGate.js';

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
      modal: $('modal-controls'), guide: $('modal-guide'), guideScroll: $('guide-scroll'), credits: $('modal-credits'), creditsScroll: $('credits-scroll'),
      play: $('btn-play'), entryChallenge: $('site-entry-challenge'), entryStatus: $('site-entry-status'), controls: $('btn-controls'), controls2: $('btn-controls-2'), guideButton: $('btn-guide'), creditsButton: $('btn-credits'),
      closeControls: $('btn-close-controls'), closeGuide: $('btn-close-guide'), closeCredits: $('btn-close-credits'), donate: $('btn-donate'), donateFallback: $('donate-fallback'),
      sndMenu: $('btn-sound-menu'), sndHud: $('btn-sound-hud'), sndPause: $('btn-sound-pause'),
      fsMenu: $('btn-fullscreen-menu'), fsHud: $('btn-fullscreen'),
      pauseBtn: $('btn-pause'), resume: $('btn-resume'), quit: $('btn-quit'),
      zone: $('zone-name'), wallet: $('wallet-amount'), walletAddress: $('wallet-address-short'), walletChip: $('chip-wallet'), walletDisconnect: $('btn-wallet-disconnect'), zkChip: $('chip-zk'), zk: $('zk-amount'),
      run: $('btn-run'), interact: $('btn-interact'),
    };
    if (isMobileLike) document.body.classList.add('touch');

    const g = this.game;
    this.siteEntryGate=new SiteEntryGate({button:this.el.play,container:this.el.entryChallenge,status:this.el.entryStatus});
    this.siteEntryGate.init();
    this.el.play.addEventListener('click', async () => {
      if(this.el.menu.classList.contains('entering-city')||!await this.siteEntryGate.authorize())return;
      g.audio.unlock(); g.audio.play('confirm'); g.audio.startAmbient();
      this.el.menu.classList.add('entering-city');
      setTimeout(async()=>{if(!await g.startPlay()){this.el.menu.classList.remove('entering-city');this.siteEntryGate.init();}},350);
    });
    const openControls = () => { g.audio.play('click'); this.el.modal.classList.remove('hidden'); };
    if(this.el.controls)this.el.controls.addEventListener('click', openControls);
    this.el.controls2.addEventListener('click', openControls);
    this.el.closeControls.addEventListener('click', () => { g.audio.play('back'); this.el.modal.classList.add('hidden'); });

    const openGuide = () => {
      // Pause state is deliberately untouched: the guide is a child of the active pause flow.
      if (!g.states.get('play')?.paused || !this.el.guide.classList.contains('hidden')) return;
      g.audio.play('click');
      this.el.guide.classList.remove('hidden');
      document.body.classList.add('guide-open');
      this.el.guideScroll.scrollTop = 0;
      this.el.closeGuide.focus();
    };
    const closeGuide = ({ silent = false, restoreFocus = true } = {}) => {
      if (this.el.guide.classList.contains('hidden')) return;
      if (!silent) g.audio.play('back');
      this.el.guide.classList.add('hidden');
      document.body.classList.remove('guide-open');
      if (restoreFocus) this.el.guideButton.focus();
    };
    this.openGuide = openGuide;
    this.closeGuide = closeGuide;
    this.el.guideButton.addEventListener('click', openGuide);
    this.el.closeGuide.addEventListener('click', () => closeGuide());
    this.el.guide.addEventListener('pointerdown', (e) => { if (e.target === this.el.guide) closeGuide(); });

    const resetDonation = () => {
      clearTimeout(this._donateTimer);
      this.el.donate.textContent = 'DONATE ❤️';
      this.el.donateFallback.classList.add('hidden');
    };
    const openCredits = () => {
      // Credits follows the same authoritative pause state and never changes gameplay state.
      if (!g.states.get('play')?.paused || !this.el.credits.classList.contains('hidden')) return;
      g.audio.play('click'); resetDonation();
      this.el.credits.classList.remove('hidden');
      document.body.classList.add('credits-open');
      this.el.creditsScroll.scrollTop = 0;
      this.el.closeCredits.focus();
    };
    const closeCredits = ({ silent = false, restoreFocus = true } = {}) => {
      if (this.el.credits.classList.contains('hidden')) return;
      if (!silent) g.audio.play('back');
      this.el.credits.classList.add('hidden');
      document.body.classList.remove('credits-open');
      resetDonation();
      if (restoreFocus) this.el.creditsButton.focus();
    };
    this.openCredits = openCredits;
    this.closeCredits = closeCredits;
    this.el.creditsButton.addEventListener('click', openCredits);
    this.el.closeCredits.addEventListener('click', () => closeCredits());
    this.el.credits.addEventListener('pointerdown', (e) => { if (e.target === this.el.credits) closeCredits(); });
    this.el.donate.addEventListener('click', async () => {
      const address = '0xb4193324e92c8354fdbf7607421296bc7b6c7e74';
      try {
        if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
        await navigator.clipboard.writeText(address);
        this.el.donate.textContent = 'COPIED ✓';
        clearTimeout(this._donateTimer);
        this._donateTimer = setTimeout(() => { this.el.donate.textContent = 'DONATE ❤️'; }, 1800);
      } catch {
        this.el.donateFallback.classList.remove('hidden');
        this.el.donateFallback.querySelector('code')?.focus();
      }
    });

    document.addEventListener('keydown', (e) => {
      const guideOpen = !this.el.guide.classList.contains('hidden');
      const creditsOpen = !this.el.credits.classList.contains('hidden');
      if (!guideOpen && !creditsOpen) return;
      // Capture Escape before InputManager can interpret it as Resume.
      const gameplayKey = /^(Escape|[wasdempr]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Enter| )$/i.test(e.key);
      if (gameplayKey) e.preventDefault();
      e.stopPropagation(); e.stopImmediatePropagation();
      if (e.key === 'Escape') guideOpen ? closeGuide() : closeCredits();
    }, true);

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
    this.el.zkChip.addEventListener('click', () => g.arcadeBalancePanel.toggle());
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
    const pauseSoundLabel=this.el.sndPause.querySelector('span');
    if(pauseSoundLabel)pauseSoundLabel.textContent=muted?'Sound: Off':'Sound: On';
    else this.el.sndPause.textContent=muted?'Sound: Off':'Sound: On';
  }
  _fsIcons(active) {
    const html = active ? FS_EXIT : FS_ENTER;
    this.el.fsMenu.innerHTML = html;
    this.el.fsHud.innerHTML = html;
  }
  _pulseBalance(el,key,value){if(value==null)return;const next=String(value),previous=this[key];this[key]=next;if(previous==null||previous===next||!el)return;el.classList.remove('balance-updated');void el.offsetWidth;el.classList.add('balance-updated');clearTimeout(el._balancePulseTimer);el._balancePulseTimer=setTimeout(()=>el.classList.remove('balance-updated'),560);}
  setWallet(s) {
    const busy = s.state === 'connecting' || s.state === 'awaiting signature';
    this.el.walletAddress.textContent = s.address ? 'MAIN · ' + s.addressShort : busy ? 'MAIN WALLET' : s.state === 'failed' ? 'WALLET ERROR · TAP TO RETRY' : 'MAIN WALLET';
    this.el.wallet.textContent = s.address
      ? (s.mainBalance == null ? 'Connected' : Number(s.mainBalance).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') + ' zkLTC')
      : busy ? (s.state === 'awaiting signature' ? 'SIGN MESSAGE' : 'CONNECTING…') : 'CONNECT WALLET';
    this.el.walletChip.title = s.address ? `Connected ${s.address}` : (s.detail || 'Connect Main Wallet');
    this.el.walletDisconnect.classList.toggle('connected', !!s.address);
    this._pulseBalance(this.el.walletChip,'_lastMainBalance',s.mainBalance);
    if (this.el.zk){const arcade=s.arcadeBalance == null ? zkDisplay() : s.arcadeBalance;this.el.zk.textContent = fmtTokens(arcade) + ' zkLTC';this._pulseBalance(this.el.zkChip,'_lastArcadeBalance',arcade);}
  }
  setZk() { if(this.el.zk){const arcade=zkDisplay();this.el.zk.textContent=fmtTokens(arcade)+' zkLTC';this._pulseBalance(this.el.zkChip,'_lastArcadeBalance',arcade);} }
  setZone(name) { this.el.zone.textContent = name; }
  setInteract(on) { this.el.interact.classList.toggle('lit', on); }

  _show(el, on) { el.classList.toggle('active', on); }
  showMenu() { this.closeGuide?.({silent:true,restoreFocus:false});this.closeCredits?.({silent:true,restoreFocus:false});this.el.menu.classList.remove('entering-city');this._show(this.el.menu, true); this._show(this.el.hud, false); this._show(this.el.pause, false); this.game.minimap.hide(); }
  showPlay() { this.closeGuide?.({silent:true,restoreFocus:false});this.closeCredits?.({silent:true,restoreFocus:false});this._show(this.el.menu, false); this._show(this.el.hud, true); this._show(this.el.pause, false); this.game.minimap.show();this.game.minimap.setPausedHidden(false); }
  showPause(on) { if(!on){this.closeGuide?.({silent:true,restoreFocus:false});this.closeCredits?.({silent:true,restoreFocus:false});}this.game.minimap.setPausedHidden(on);this._show(this.el.pause, on); }
  hideAll() { this.closeCredits?.({silent:true,restoreFocus:false});this._show(this.el.menu, false); this._show(this.el.hud, false); this._show(this.el.pause, false); this.game.minimap.hide(); }
}
