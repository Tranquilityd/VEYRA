// Veyra — game orchestrator: owns canvas, loop, systems and the state machine
import { EventBus } from './EventBus.js';
import { GameLoop } from './Loop.js';
import { StateMachine } from './StateMachine.js';
import { InputManager } from './InputManager.js';
import { AudioManager } from './AudioManager.js';
import { SaveSystem } from './SaveSystem.js';
import { UIManager } from '../ui/UIManager.js';
import { initOrientationGuard } from '../ui/OrientationGuard.js';
import { LitvmWalletSession } from '../systems/LitvmWalletSession.js';
import { ReferralSystem } from '../systems/ReferralSystem.js';
import { GameRegistry } from '../systems/GameRegistry.js';
import { TransitionSystem } from '../systems/TransitionSystem.js';
import { Lighting } from '../visuals/Lighting.js';
import { SpriteCache } from '../visuals/SpriteCache.js';
import { BootState } from '../states/BootState.js';
import { MenuState } from '../states/MenuState.js';
import { PlayState } from '../states/PlayState.js';
import { InteriorState } from '../states/InteriorState.js';
import { GameOverlay } from '../ui/GameOverlay.js';
import { WalletPanel } from '../ui/WalletPanel.js';
import { ArcadeBalancePanel } from '../ui/ArcadeBalancePanel.js';
import { CityMinimap } from '../ui/CityMinimap.js';
import { CASINO_GAMES } from '../games/casinoLogic.js';
import { ARCADE_GAMES } from '../games/arcadeLogic.js';
import { authorizeSiteEntryTransition } from '../systems/siteEntryAuthorization.js';

export class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.events = new EventBus();
    this.audio = new AudioManager(this);
    this.input = new InputManager(this);
    this.walletSession = new LitvmWalletSession(this.events);
    this.referral = new ReferralSystem(this.events);
    this.games = new GameRegistry(this.events);
    this.save = new SaveSystem(this);
    this.lighting = new Lighting();
    this.ui = new UIManager(this);
    this.states = new StateMachine(this);
    this.transition = new TransitionSystem(this);
    this.overlay = new GameOverlay(this);
    this.walletPanel = new WalletPanel(this);
    this.arcadeBalancePanel = new ArcadeBalancePanel(this);
    this.minimap = new CityMinimap(this);
    this.dpr = 1;
    this.view = { w: 800, h: 600 };
    this.debug = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('debug');
    this.spriteCount = 0;
    this.loop = new GameLoop(
      (dt, t) => this.update(dt, t),
      (t) => this.render(t),
    );
    this._registerPlaceholderGames();
  }

  // individual-games foundation: arcade placeholder + the four live casino games
  _registerPlaceholderGames() {
    // Phase 7: each arcade cabinet opens exactly its own game
    for (const id of ['memrush', 'tileshift', 'neonescape', 'nback']) {
      this.games.register({
        id, name: ARCADE_GAMES[id].name, zone: 'arcade',
        description: ARCADE_GAMES[id].title + ' — live at the Veyra Arcade.',
        launch: () => { this.overlay.open(id); return { ok: true }; },
      });
    }
    // Phase 6: each casino machine opens exactly its own game
    for (const id of ['plinko', 'slot', 'dice', 'coin']) {
      this.games.register({
        id, name: CASINO_GAMES[id].name, zone: 'casino',
        description: CASINO_GAMES[id].title + ' — live at the Veyra Casino.',
        launch: () => { this.overlay.open(id); return { ok: true }; },
      });
    }
  }

  boot() {
    this.ui.init();
    this.walletSession.restore().catch(() => {});
    this.input.attachCanvas(this.canvas);
    this.states.register('boot', (g) => new BootState(g));
    this.states.register('menu', (g) => new MenuState(g));
    this.states.register('play', (g) => new PlayState(g));
    this.states.register('interior', (g) => new InteriorState(g));   // Phase 5 venue interiors
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.states.currentName === 'play' && !this.transition.active) {
        const st = this.states.get('play');
        if (st && !st.paused) st.togglePause();
      }
    });
    this.resize();
    initOrientationGuard(this);
    this.loop.start();
    this.states.set('boot');
    this.events.on('state:changed', () => { this.spriteCount = SpriteCache.count(); });
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);   // cap: mobile fill-rate
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.view = { w, h };
    this.lighting.resize(w, h);
    this.events.emit('resize', this.view);
  }

  update(dt, time) {
    const play=this.states.currentName==='play'?this.states.get('play'):null;
    this.input.locked = this.transition.lock || !!this.overlay.openId || !!play?.worldEntry?.controlsLocked; // cinematics and overlays own input
    this.transition.update(dt);
    this.states.update(dt, time);
  }
  render(time) {
    this.states.render(this.ctx, this.view, time);
    this.transition.renderOverlay(this.ctx, this.view, time);
  }

  // Phase 5: intentional building entry/exit (never triggered by proximity alone)
  enterVenue(id) {
    if (this.transition.active || this.states.currentName !== 'play') return false;
    return this.transition.enterVenue(id);
  }
  exitVenue() {
    if (this.transition.active || this.states.currentName !== 'interior') return false;
    return this.transition.exitVenue();
  }

  async startPlay(params={}) {
    if(!await authorizeSiteEntryTransition())return false;
    this.states.set('play',{fresh:true,...params,worldEntryStartedAt:performance.now()});return true;
  }
  toMenu() { this.states.set('menu'); }
  togglePause() {
    if (this.overlay.openId) { this.overlay.close(); return; }   // Esc/back closes a game first
    if (this.transition.active) return;                  // never pause mid-transition
    if (this.states.currentName === 'play') this.states.get('play').togglePause();
  }
}
