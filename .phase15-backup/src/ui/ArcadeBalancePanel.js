// Veyra — Phase 8 follow-on: the Arcade Game Balance viewer.
// The zkLTC ledger (pending, off-chain) is player-visible history: totals,
// per-session lines and the honest "settlement lands later" note. Opens from
// the HUD zkLTC chip (tap/click/Enter). Never claims an on-chain transfer.
import { loadLedger, fmtTokens, sessionLine, REWARD_NOTE } from '../games/arcadeRewards.js';

const css = (el, obj) => Object.assign(el.style, obj);
function mk(tag, styles, parent, text) {
  const el = document.createElement(tag);
  if (styles) css(el, styles);
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

export class ArcadeBalancePanel {
  constructor(game) {
    this.game = game;
    this.open = false;
    this._build();
  }

  _build() {
    const root = mk('div', {
      position: 'fixed', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center',
      zIndex: '65', pointerEvents: 'auto',
    });
    mk('div', { position: 'absolute', inset: '0', background: 'rgba(6,4,12,0.5)' }, root);
    const panel = mk('div', {
      position: 'relative', width: 'min(94vw, 420px)', maxHeight: 'min(84vh, 560px)', display: 'flex',
      flexDirection: 'column', gap: '10px', padding: '14px', borderRadius: '18px', boxSizing: 'border-box',
      background: 'linear-gradient(180deg, rgba(20,26,16,0.97), rgba(10,14,9,0.97))',
      border: '2px solid #86e05a', boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
    }, root);
    const head = mk('div', { display: 'flex', alignItems: 'center', gap: '10px' }, panel);
    this.backBtn = mk('button', {
      minHeight: '48px', padding: '0 16px', borderRadius: '12px', border: '1.6px solid rgba(134,224,90,0.7)',
      background: 'linear-gradient(180deg,#1d3317,#12200e)', color: '#d6ffc2', font: '800 15px system-ui,sans-serif', cursor: 'pointer',
    }, head, '← BACK');
    this.backBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.close(); });
    mk('div', { flex: '1', textAlign: 'center', color: '#d6ffc2', font: '900 17px system-ui,sans-serif', letterSpacing: '2px' }, head, 'ARCADE BALANCE');
    this.totals = mk('div', {
      padding: '10px 12px', borderRadius: '12px', background: 'rgba(10,6,12,0.6)', border: '1.4px solid rgba(134,224,90,0.4)',
      color: '#b8f0a0', font: '800 14px system-ui,sans-serif', textAlign: 'center',
    }, panel);
    this.list = mk('div', {
      flex: '1 1 auto', minHeight: '60px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px',
      padding: '2px',
    }, panel);
    this.note = mk('div', { color: '#9fb894', font: '700 11.5px system-ui,sans-serif', textAlign: 'center', lineHeight: '1.45' }, panel, REWARD_NOTE);
    document.body.appendChild(root);
    this.root = root;
  }

  _render() {
    const l = loadLedger();
    this.totals.textContent = fmtTokens(l.tokens) + ' zkLTC server-validated · ' + l.waves + ' validated rewards';
    this.list.innerHTML = '';
    if (!l.sessions.length) {
      mk('div', { color: '#9fb894', font: '700 13px system-ui,sans-serif', textAlign: 'center', padding: '18px 6px' }, this.list,
        'No validated rewards yet — sign in with your wallet, then play a cabinet. Completed runs are checked by the backend before credit.');
      return;
    }
    for (const s of l.sessions.slice(-12).reverse()) {
      const when = new Date(s.t);
      const hh = String(when.getHours()).padStart(2, '0'), mm = String(when.getMinutes()).padStart(2, '0');
      mk('div', {
        display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '8px 10px', borderRadius: '10px',
        background: 'rgba(134,224,90,0.08)', border: '1px solid rgba(134,224,90,0.22)',
        color: '#eaf6e2', font: '700 12px system-ui,sans-serif',
      }, this.list, sessionLine(s), mk('span', { color: '#8aa382', flex: 'none' }, null, hh + ':' + mm));
    }
    if (l.sessions.length > 12) {
      mk('div', { color: '#8aa382', font: '700 11px system-ui,sans-serif', textAlign: 'center' }, this.list, '… ' + (l.sessions.length - 12) + ' older server records');
    }
  }

  toggle() { this.open ? this.close() : this.show(); }
  show() {
    if (this.open) return;
    this.open = true;
    this._render();
    this.root.style.display = 'flex';
    this.game.audio.play('click');
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.root.style.display = 'none';
    this.game.audio.play('back');
  }
}
