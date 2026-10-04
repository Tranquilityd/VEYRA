// Veyra — Phase 6: casino game overlay. Opens on top of the LIVE casino scene
// (the interior keeps rendering behind a translucent backdrop so Lester stays
// "inside" the casino), with mobile-comfortable controls and a clear BACK.
import { CASINO_GAMES, plinkoDrop, plinkoPayout, PLINKO_BINS, PLINKO_ROWS, slotSpin, slotPayout, slotMult, diceRoll, dicePayout, coinFlip, coinPayout } from '../games/casinoLogic.js';
import { ARCADE_GAMES } from '../games/arcadeLogic.js';
import { loadLedger, fmtTokens, zkDisplay, setRunPending } from '../games/arcadeRewards.js';
import { memrushGame, tileshiftGame, neonEscapeGame, nbackGame } from './arcadeGames.js';
import { CasinoWagerGateway, validateWager, MIN_WAGER, MAX_WAGER } from '../games/casinoWagering.js';
import { verifyFairRound, FAIRNESS_VERSION, FAIRNESS_ALGORITHM } from '../games/provablyFair.js';

const css = (el, obj) => Object.assign(el.style, obj);
const safeUiText = (value) => {
  const text=String(value||'').replace(/<[^>]*>/g,' ').replace(/\\[rnt]/g,' ').replace(/\s+/g,' ').trim();
  if(/(?:status[: ]*429|rate limit|too many requests|access denied)/i.test(text))return 'LiteForge RPC is temporarily rate-limited. Please wait a moment and try again.';
  if(/user rejected|user denied|rejected by user/i.test(text))return 'Transaction cancelled in wallet.';
  if(/insufficient funds|insufficient balance/i.test(text))return 'Insufficient zkLTC balance.';
  return text.length>180?`${text.slice(0,177)}…`:text;
};

function mk(tag, styles, parent, text) {
  const el = document.createElement(tag);
  if (styles) css(el, styles);
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

const BTN = {
  minHeight: '48px', padding: '0 18px', borderRadius: '12px', border: '1.6px solid rgba(217,164,65,0.75)',
  background: 'linear-gradient(180deg,#5c1b2d,#43121f)', color: '#ffe9b8', font: '800 15px Rajdhani,system-ui,sans-serif',
  cursor: 'pointer', touchAction: 'manipulation',
};
const BTN_ON = { background: 'linear-gradient(180deg,#d9a441,#a87c2a)', color: '#2a0d14', border: '1.6px solid #f0cd82' };
const BTN_OFF = { background: 'linear-gradient(180deg,#5c1b2d,#43121f)', color: '#ffe9b8', border: '1.6px solid rgba(217,164,65,0.75)' };

export class GameOverlay {
  constructor(game) {
    this.game = game;
    this.openId = null;
    this._raf = 0;
    this._last = 0;
    this.bet = MIN_WAGER;
    this.wagerGateway = new CasinoWagerGateway();
    this.activeWager = null;
    this.wagerPending = false;
    this.pendingClaim = null;
    this._build();
    game.events.on('litvm:wallet', (s) => { this._wallet(); this._walletState(s); this._syncCasinoWallet(s); });
    window.addEventListener('veyra:zkltc', () => this._tokens());
  }

  _build() {
    const root = mk('div', {
      position: 'fixed', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center',
      zIndex: '60', pointerEvents: 'auto',
    });
    mk('div', { position: 'absolute', inset: '0', background: 'rgba(6,4,12,0.45)' }, root);   // casino stays visible behind
    const panel = mk('div', {
      position: 'relative', width: 'min(94vw, 520px)', maxHeight: '92vh', display: 'flex', flexDirection: 'column',
      gap: '10px', padding: '12px 12px 14px', borderRadius: '18px', boxSizing: 'border-box',
      background: 'linear-gradient(180deg, rgba(44,16,30,0.97), rgba(26,9,18,0.97))',
      border: '2px solid #d9a441', boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
    }, root);
    const head = mk('div', { display: 'flex', alignItems: 'center', gap: '10px' }, panel);
    this.backBtn = mk('button', { ...BTN, minHeight: '48px', padding: '0 16px', flex: 'none' }, head, '← BACK');
    this.backBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.close(); });
    this.title = mk('div', { flex: '1', textAlign: 'center', color: '#ffe9b8', fontFamily:'Orbitron,Rajdhani,system-ui,sans-serif',fontWeight:'700',fontSize:'19px', letterSpacing: '3px',textShadow:'0 1px 10px rgba(217,164,65,.28)' }, head);this.title.className='casino-game-title';
    this.walletEl = mk('div', { flex: 'none', padding: '8px 12px', borderRadius: '10px', background: 'rgba(10,6,12,0.7)', border: '1.4px solid rgba(217,164,65,0.6)', color: '#ffd98a', font: '800 14px Rajdhani,system-ui,sans-serif' }, head);
    this.tokenEl = mk('div', { flex: 'none', padding: '8px 10px', borderRadius: '10px', background: 'rgba(10,6,12,0.7)', border: '1.4px solid rgba(134,224,90,0.55)', color: '#b8f0a0', font: '800 12px Rajdhani,system-ui,sans-serif', display: 'none' }, head);
    this.wagerPanel = mk('div', { display: 'none', gridTemplateColumns: '1fr', gap: '7px', alignItems: 'center', padding: '8px', borderRadius: '11px', background: 'rgba(10,6,12,.72)', border: '1px solid rgba(217,164,65,.45)' }, panel);this.wagerPanel.className='casino-wager-panel';
    this.fairBtn=mk('button',{...BTN,gridColumn:'1/-1',minHeight:'28px',height:'28px',padding:'0 10px',fontSize:'9px',letterSpacing:'1px'},this.wagerPanel,'PROVABLY FAIR');
    this.fairBtn.addEventListener('pointerdown',e=>{e.preventDefault();this._openFairness();});
    this.wagerInput = mk('input', { minWidth: '0', height: '42px', boxSizing: 'border-box', borderRadius: '9px', border: '1.5px solid #d9a441', background: '#100912', color: '#fff0c9', padding: '0 11px', font: '800 16px Rajdhani,system-ui,sans-serif' }, this.wagerPanel);
    this.wagerInput.type = 'text'; this.wagerInput.inputMode = 'decimal'; this.wagerInput.autocomplete = 'off'; this.wagerInput.value = MIN_WAGER;this.wagerInput.placeholder=`${MIN_WAGER} – ${MAX_WAGER} zkLTC`; this.wagerInput.setAttribute('aria-label', 'Wager amount in zkLTC');
    this.txStateEl = mk('div', { gridColumn: '1/-1', color: '#ffd477', font: '900 10px Rajdhani,system-ui,sans-serif', textAlign: 'center', letterSpacing: '.5px' }, this.wagerPanel, 'TRANSACTION: WALLET REQUIRED FROM GAME MAIN');
    this.resultEl=mk('div',{display:'none',gridColumn:'1/-1',padding:'8px',borderRadius:'9px',border:'1px solid rgba(217,164,65,.5)',background:'rgba(10,6,12,.82)',textAlign:'center'},this.wagerPanel);
    this.outcomeEl=mk('div',{display:'none',gridColumn:'1/-1',padding:'8px',borderRadius:'9px',border:'1px solid rgba(112,170,255,.5)',background:'rgba(8,12,24,.82)',textAlign:'center',overflowWrap:'anywhere'},this.wagerPanel);this.outcomeEl.className='casino-outcome-panel';
    this.retryClaimBtn = mk('button', { ...BTN, display: 'none', gridColumn:'1/-1', minHeight: '42px' }, this.wagerPanel, 'RETRY PAYOUT CLAIM');
    this.retryTrackBtn = mk('button', { ...BTN, display: 'none', gridColumn: '1/-1', minHeight: '42px' }, this.wagerPanel, 'RETRY TX TRACKING');
    this.retryClaimBtn.addEventListener('pointerdown', async (e) => { e.preventDefault(); if (this.pendingClaim) await this._retryCasinoClaim(); });
    this.retryTrackBtn.addEventListener('pointerdown', async (e) => { e.preventDefault(); await this._retryCasinoTracking(); });
    this.canvas = mk('canvas', { width: '100%', borderRadius: '12px', background: '#150a11', border: '1.4px solid rgba(217,164,65,0.4)', display: 'block' }, panel);
    this.controls = mk('div', { display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }, panel);
    this.controls.className = 'ov-controls';
    // Outcome is a sibling of the wager/winnings panel so it owns a dedicated,
    // always-visible layout area rather than living inside its scroll region.
    panel.appendChild(this.outcomeEl);
    document.body.appendChild(root);
    this.root = root;
    this.panel = panel;
    this.head = head;
    if (!document.getElementById('veyra-ov-style')) {
      const stl = document.createElement('style');
      stl.id = 'veyra-ov-style';
      stl.textContent = '@keyframes ovIn{from{opacity:0;transform:scale(.94) translateY(10px)}to{opacity:1;transform:none}}'
        + '@keyframes ovBack{from{opacity:0}to{opacity:1}}'
        + '.ov-short-casino .ov-controls{align-items:center!important;align-self:center!important}.ov-short-casino .ov-controls button{padding-left:10px!important;padding-right:10px!important;height:40px!important;min-height:40px!important;max-height:40px!important;font-size:12px!important}'
        + '.ov-short-casino .ov-controls .plinko-segment{height:28px!important;min-height:28px!important;padding:0 4px!important;font-size:9px!important;border-radius:7px!important}'
        + '.ov-short-casino .ov-controls .plinko-drop{height:34px!important;min-height:34px!important;padding:0 20px!important;font-size:11px!important}'
        + '.ov-short-casino canvas{min-width:0;min-height:0}'
        + '.ov-open input::placeholder{color:rgba(255,233,184,.36);opacity:1}'
        + '.casino-tx{position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 8px;border-radius:9px;background:rgba(8,5,12,.68);border:1px solid rgba(217,164,65,.28);color:#d9d6dc;min-height:32px;box-sizing:border-box}.casino-tx-head{display:flex;align-items:center;gap:7px}.casino-tx-title{font:900 10px system-ui;letter-spacing:1.2px}.casino-tx-detail,.casino-tx-network{font:700 9px system-ui;color:#aaa4ad}.casino-tx-amount{font:900 15px system-ui;color:#ffe29a;text-shadow:0 0 10px rgba(217,164,65,.3)}.casino-tx-badge{font:900 8px system-ui;letter-spacing:1px;color:#d9a441}.casino-tx-wager,.casino-tx-claim{border-color:rgba(217,164,65,.65);box-shadow:inset 0 0 14px rgba(217,164,65,.08);animation:casinoPanelPulse 1.7s ease-in-out infinite}.casino-tx-confirmed{color:#b9f6a5;border-color:rgba(134,224,90,.55)}'
        + '.casino-spinner{width:12px;height:12px;border:2px solid rgba(255,212,119,.2);border-top-color:#ffd477;border-radius:50%;animation:casinoSpin .7s linear infinite}.casino-chip{width:12px;height:12px;border-radius:50%;border:2px dashed #d9a441;box-shadow:inset 0 0 0 2px #5c1b2d;animation:casinoSpin 1.25s linear infinite}.casino-tx-wager:after,.casino-tx-claim:after{content:"";position:absolute;inset:0;transform:translateX(-120%);background:linear-gradient(100deg,transparent,rgba(255,225,150,.1),transparent);animation:casinoSweep 1.6s ease-in-out infinite}'
        + '.round-info{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 10px;text-align:left}.round-info b{grid-column:1/-1;color:#d9a441;font:800 9px system-ui;letter-spacing:1.2px}.round-info span{font:700 9px system-ui;color:#c9c4cc;white-space:nowrap}.round-info strong{color:#ffe9b8}'
        + '.casino-result-amount{animation:casinoResultIn .35s ease-out}@keyframes casinoResultIn{from{opacity:0;transform:scale(.88)}to{opacity:1;transform:scale(1)}}'
        + '@keyframes casinoSpin{to{transform:rotate(360deg)}}@keyframes casinoSweep{55%,100%{transform:translateX(120%)}}@keyframes casinoPanelPulse{50%{box-shadow:inset 0 0 18px rgba(217,164,65,.14),0 0 7px rgba(217,164,65,.12)}}'
        + '@media(prefers-reduced-motion:reduce){.casino-spinner,.casino-chip,.casino-tx-wager,.casino-tx-claim,.casino-tx-wager:after,.casino-tx-claim:after,.casino-result-amount{animation:none!important}}';
      document.head.appendChild(stl);
    }
  }

  _feedback(type, detail={}) {
    if (CASINO_GAMES[this.openId]) this.game.events.emit(type, { gameId:this.openId, ...detail });
  }

  _roundVisual(info=this.roundInfo) {
    this.roundInfo=info||{};if(!this.txStateEl||this.wagerPending)return;
    const d=this.roundInfo;this.txStateEl.className='casino-tx casino-tx-idle round-info';this.txStateEl.innerHTML='';
    mk('b',{},this.txStateEl,'ROUND INFORMATION');
    const item=(label,value)=>{const e=mk('span',{},this.txStateEl);e.append(`${label}: `);mk('strong',{},e,value);};
    item('Wager',d.wager||`${this.wagerInput?.value||MIN_WAGER} zkLTC`);
    if(d.balls)item('Balls',d.balls);if(d.risk)item('Risk',d.risk);if(d.potential)item('Potential',d.potential);
  }

  _txVisual(kind,title,detail='',amount='') {
    if(!this.txStateEl)return;
    this.txStateEl.className=`casino-tx casino-tx-${kind}`;this.txStateEl.innerHTML='';
    const active=kind==='wager'||kind==='claim',head=mk('div',{},this.txStateEl);head.className='casino-tx-head';
    if(active){const chip=mk('i',{},head);chip.className='casino-chip';const spin=mk('i',{},head);spin.className='casino-spinner';}
    const heading=mk('strong',{},head,title);heading.className='casino-tx-title';
    if(amount){const value=mk('div',{},this.txStateEl,`${kind==='claim'?'+':''}${amount} zkLTC`);value.className='casino-tx-amount';}
    if(detail){const line=mk('div',{},this.txStateEl,detail);line.className='casino-tx-detail';}
    if(active){const badge=mk('div',{},this.txStateEl,kind==='claim'?'CLAIM IN PROGRESS':'WAGER LOCKED');badge.className='casino-tx-badge';const network=mk('div',{},this.txStateEl,kind==='claim'?'Confirming your winnings on LitVM':'Confirming wager on LitVM');network.className='casino-tx-network';}
  }

  _openFairness(){
    if(!this.fairModal){this.fairModal=mk('div',{position:'fixed',inset:'0',zIndex:'90',display:'none',alignItems:'center',justifyContent:'center',background:'rgba(4,2,7,.72)'},document.body);const card=mk('div',{width:'min(92vw,480px)',maxHeight:'86vh',overflow:'auto',padding:'14px',borderRadius:'14px',background:'#1b0b15',border:'1.5px solid #d9a441',boxShadow:'0 20px 60px #000'},this.fairModal);this.fairContent=mk('div',{},card);const close=mk('button',{...BTN,width:'100%',marginTop:'10px',minHeight:'38px'},card,'CLOSE');close.addEventListener('pointerdown',e=>{e.preventDefault();this.fairModal.style.display='none';});this.fairModal.addEventListener('pointerdown',e=>{if(e.target===this.fairModal)this.fairModal.style.display='none';});}
    const record=this.wagerGateway.lastFairness||this.activeWager?.fairness||null,c=this.fairContent;c.innerHTML='';mk('h2',{margin:'0 0 10px',color:'#ffe9b8',fontFamily:'Cinzel,"Palatino Linotype",Georgia,serif',letterSpacing:'2px',textAlign:'center'},c,'PROVABLY FAIR');mk('div',{color:'#d9a441',font:'800 10px system-ui',textAlign:'center',marginBottom:'10px'},c,`${FAIRNESS_VERSION} · ${FAIRNESS_ALGORITHM}`);
    const seedRow=mk('div',{padding:'8px',borderRadius:'8px',background:'rgba(0,0,0,.25)',marginBottom:'8px'},c);mk('label',{display:'block',color:'#aaa',font:'700 9px system-ui'},seedRow,'CLIENT SEED');const input=mk('input',{width:'100%',boxSizing:'border-box',marginTop:'4px',padding:'8px',borderRadius:'6px',border:'1px solid #805f2a',background:'#100912',color:'#fff'},seedRow);input.value=record?.clientSeed||this.wagerGateway.clientSeed;input.disabled=!!this.activeWager||this.wagerPending;const save=mk('button',{...BTN,width:'100%',minHeight:'32px',marginTop:'5px',fontSize:'10px'},seedRow,'SAVE FOR FUTURE ROUNDS');save.disabled=input.disabled;save.addEventListener('pointerdown',e=>{e.preventDefault();try{this.wagerGateway.setClientSeed(input.value);save.textContent='SAVED ✓';}catch(err){save.textContent=safeUiText(err.message);}});
    if(!record){mk('div',{color:'#bbb',font:'700 11px system-ui',textAlign:'center',padding:'12px'},c,'Place a wager to create a server-seed commitment.');this.fairModal.style.display='flex';return;}
    const fields=[['GAME',(record.game||this.openId||'—').toUpperCase()],['CONFIG',record.input?JSON.stringify(record.input):'—'],['NONCE',record.nonce],['CLIENT SEED',record.clientSeed],['SERVER SEED HASH',record.serverSeedHash],['VERSION',record.version],['ALGORITHM',record.algorithm],['SERVER SEED',record.serverSeed||'Hidden until result finalization'],['RECORDED RESULT',record.outcome?JSON.stringify(record.outcome):'Awaiting finalized result'],['PAYOUT',record.payout==null?'Awaiting finalized result':`${record.payout} zkLTC`]];for(const [label,value] of fields){const row=mk('div',{margin:'6px 0',padding:'7px',borderRadius:'7px',background:'rgba(0,0,0,.2)'},c);mk('b',{display:'block',color:'#d9a441',font:'800 9px system-ui',letterSpacing:'1px'},row,label);mk('code',{display:'block',marginTop:'3px',color:'#eee',fontSize:'10px',overflowWrap:'anywhere'},row,String(value));const copy=mk('button',{...BTN,minHeight:'25px',padding:'0 8px',marginTop:'4px',fontSize:'8px'},row,'COPY');copy.addEventListener('pointerdown',async e=>{e.preventDefault();await navigator.clipboard.writeText(String(value));copy.textContent='COPIED ✓';});}
    if(record.serverSeed&&record.outcome){const verify=mk('button',{...BTN_ON,width:'100%',minHeight:'42px',borderRadius:'10px',font:'900 12px system-ui',marginTop:'8px'},c,'VERIFY RESULT');verify.addEventListener('pointerdown',async e=>{e.preventDefault();verify.disabled=true;try{const checked=await verifyFairRound(record);verify.textContent=checked.ok?'VERIFIED ✓':'VERIFICATION FAILED';verify.style.background=checked.ok?'#426d32':'#7c2630';}catch(err){verify.textContent='VERIFICATION FAILED';}verify.disabled=false;});}
    this.fairModal.style.display='flex';
  }

  _wallet() { const s=this.game.walletSession.snapshot(); this.walletEl.textContent = 'MAIN ' + (s.mainBalance==null?'—':Number(s.mainBalance).toFixed(8).replace(/0+$/,'').replace(/\.$/,'')+' zkLTC'); }
  _tokens() { this.tokenEl.textContent = 'ARCADE ' + fmtTokens(zkDisplay()) + ' zkLTC'; }
  _walletState(s) { if(!this.txStateEl||this.wagerPending)return;if(s.address)this._roundVisual();else this._txVisual('idle','WALLET REQUIRED','Connect from Game Main'); }
  _msg() {}

  _betControls() { return []; } // Phase 9 uses the manual zkLTC field above.

  async _syncCasinoWallet(s = this.game.walletSession.snapshot()) {
    if (!this.openId || !CASINO_GAMES[this.openId]) return;
    if (!this.wagerGateway.mock && !s.address) {
      this.wagerGateway.disconnect();
      this._msg('Wallet required. Return to Game Main and connect your wallet.');
      return;
    }
    try {
      const session = await this.wagerGateway.connect();
      const bal = await this.wagerGateway.balance();
      const short = session.account ? `${session.account.slice(0,6)}…${session.account.slice(-4)}` : 'Connected';
      this._msg(this.wagerGateway.mock ? 'Development mock active — no blockchain transaction can occur.' : 'Wallet session ready. Enter a wager and sign when prompted.');
    } catch (e) { this._msg(e.message); }
  }

  async _confirmCasinoWager(gameId) {
    clearTimeout(this._casinoResetTimer);
    if (this.activeWager) {
      if (this.activeWager.gameId === gameId && !this.pendingClaim) { this.bet = this.activeWager.amount; this._msg(`Resuming confirmed wager ${this.bet} zkLTC — no second debit.`); return true; }
      this._msg('Finish the current wager or payout claim first.'); return false;
    }
    try { await this.wagerGateway.connect(); }
    catch (e) { const message=safeUiText(e.message);this._txVisual('error','WAGER BLOCKED',message);this._msg(message); this.game.audio.play('deny'); return false; }
    const raw = String(this.wagerInput.value||'').trim();
    let bal;
    try{bal=await this.wagerGateway.balance();}
    catch(e){const message=safeUiText(e.message||'Unable to read wallet balance.');this._txVisual('error','BALANCE CHECK FAILED',message);this._msg(message);this.game.audio.play('deny');return false;}
    const v = validateWager(raw, bal, this.wagerGateway.mock ? 8 : 8);
    if (!v.ok) { this._txVisual('error','INVALID WAGER',v.message);this._msg(v.message); this.game.audio.play('deny'); return false; }
    this.wagerInput.value=v.amount;
    this.bet = v.amount;this._clearResult();
    this._msg(`Wager ${v.amount} zkLTC · awaiting wallet signature and confirmation…`);
    this.wagerPending = true;this._feedback('casino_wager_started',{amount:v.amount});this._txVisual('wager','PLACING WAGER','Securing your wager...',v.amount);
    try {
      const out = await this.wagerGateway.wager(gameId, v.amount);
      this.activeWager = out.receipt;
      const tracked = !out.tracking || out.tracking.ok;
      if (!tracked) this.retryTrackBtn.style.display = 'block';
      this._msg(tracked ? `${this.wagerGateway.mock ? 'DEV MOCK confirmed' : 'Wager confirmed'} · ${v.amount} zkLTC · Veyra backend may now generate the game result` : `Wager submitted · backend confirmation check pending · RETRY TX TRACKING (do not resubmit wager)`);
      this.wagerPending = false;
      if(tracked){this._feedback('casino_wager_confirmed',{amount:v.amount});this._txVisual('confirmed','WAGER CONFIRMED',`${v.amount} zkLTC secured`);}else this._txVisual('idle','WAGER SUBMITTED','Confirmation verification pending');
      return tracked;
    } catch (e) { this.wagerPending = false;this._txVisual('error','WAGER FAILED','Retry available'); this._msg(`WAGER FAILED — ${e.message} · retry available`); this.game.audio.play('deny'); return false; }
  }

  async _resolveCasinoOutcome(gameId, makeMockOutcome, context = {}) {
    if (!this.activeWager) throw new Error('No confirmed wager exists for this result.');
    const resolved = await this.wagerGateway.resolveOutcome(this.activeWager, gameId, makeMockOutcome, context);
    this.activeWager.outcomeProof = resolved.proof;
    this._roundVisual();
    return resolved.outcome;
  }

  _clearResult(){this.currentResult=null;for(const e of [this.resultEl,this.outcomeEl])if(e){e.innerHTML='';e.style.display='none';}if(this.fairBtn)this.fairBtn.style.display='';if(this.wagerInput)this.wagerInput.style.display='';}

  _renderPayoutState(title,detail='',active=false,claimed=false){
    const r=this.currentResult,e=this.resultEl;if(!r||!e)return;e.innerHTML='';e.style.display='block';
    const head=mk('div',{display:'flex',alignItems:'center',justifyContent:'center',gap:'7px',color:claimed?'#b8f0a0':r.won?'#ffe29a':'#ffb0b0',font:'900 11px system-ui',letterSpacing:'1.2px'},e);
    if(active){const chip=mk('i',{},head);chip.className='casino-chip';const spin=mk('i',{},head);spin.className='casino-spinner';}
    mk('strong',{},head,title);
    const value=mk('div',{marginTop:'4px',color:r.won?'#ffe29a':'#ddd',font:'900 21px system-ui',textShadow:r.won?'0 0 12px rgba(217,164,65,.42)':'none'},e,`${r.amount} zkLTC`);value.className='casino-result-amount';
    if(detail)mk('div',{marginTop:'3px',color:'#aaa',font:'700 9px system-ui'},e,detail);
  }

  _showCasinoResult(summary,payout,presentation={}){
    const amount=String(payout),won=Number(amount)>0;this.currentResult={amount,won};
    // Give the payout and outcome dedicated room in compact landscape while the
    // completed round is being presented. Controls return when the next round starts.
    if(this.fairBtn)this.fairBtn.style.display='none';if(this.wagerInput)this.wagerInput.style.display='none';
    this._renderPayoutState(won?'YOU WON':'NO WINNINGS',won?'Automatic claim begins in 3 seconds…':'Round completes in 3 seconds…');
    const e=this.outcomeEl;if(!e)return;e.innerHTML='';e.style.display='block';
    mk('div',{color:'#8fc2ff',font:'900 9px system-ui',letterSpacing:'1.3px'},e,'GAME OUTCOME');
    if(Array.isArray(presentation.results)&&presentation.results.length)mk('div',{marginTop:'5px',color:'#ffe9b8',font:'900 13px system-ui',wordSpacing:'5px'},e,presentation.results.join('   '));
    else mk('div',{marginTop:'5px',color:'#ffe9b8',font:'800 11px system-ui'},e,summary);
    if(presentation.wager)mk('div',{marginTop:'4px',color:'#bbb',font:'700 9px system-ui'},e,`Total wager: ${presentation.wager} zkLTC`);
  }

  async _revealThenSettle(summary,payout,presentation={}){
    this._showCasinoResult(summary,payout,presentation);
    await new Promise(resolve=>setTimeout(resolve,2000));
    return this._settleCasinoResult(summary,payout);
  }

  _scheduleNonPlinkoReset(){
    if(this.openId==='plinko')return;
    clearTimeout(this._casinoResetTimer);
    this._casinoResetTimer=setTimeout(()=>{if(this.wagerPending||this.activeWager||this.pendingClaim)return;this._clearResult();this._roundVisual();},1200);
  }

  async _settleCasinoResult(summary, payout) {
    const wager = this.activeWager;
    if (!this.wagerGateway.mock && (!wager || wager.authoritativePayout == null || Math.abs(Number(payout) - Number(wager.authoritativePayout)) > 1e-8)) {
      this._msg(`${summary} · SETTLEMENT BLOCKED — displayed payout does not match the backend-recorded result.`); return false;
    }
    this.activeWager = null;
    const amount = String(this.wagerGateway.mock ? payout : wager.authoritativePayout);
    this._feedback('result_revealed',{summary,payout:amount});
    if (!(Number(amount) > 0)) { this._feedback('loss',{payout:'0'});this._txVisual('idle','ROUND COMPLETE','0 zkLTC payout · no claim required');this._msg(`${summary} · LOSS · payout 0 zkLTC · backend session recorded`);this._scheduleNonPlinkoReset(); return true; }
    const ratio=Number(amount)/Math.max(Number(wager.amount||this.bet),Number.EPSILON),winEvent=ratio>=5?'win_large':ratio>=2?'win_medium':'win_small';this._feedback(winEvent,{payout:amount,ratio});
    this._msg(`${summary} · WIN · payout ${amount} zkLTC · claiming…`);
    this.wagerPending = true;this._feedback('claim_started',{payout:amount});this._renderPayoutState('CLAIMING WINNINGS','Sending your winnings…',true);
    try {
      const out = await this.wagerGateway.claim(wager, amount);
      this.wagerPending = false;
      const tracked = !out.tracking || out.tracking.ok;
      if (!tracked) this.retryTrackBtn.style.display = 'block';
      this._msg(`${summary} · WIN · payout ${amount} zkLTC · ${this.wagerGateway.mock ? 'DEV MOCK claim' : tracked ? 'payout confirmed' : 'confirmation verification pending · retry tracking'}`);
      if(tracked){this._feedback('claim_confirmed',{payout:amount});this._renderPayoutState('✓ WINNINGS CLAIMED','Confirmed on LitVM',false,true);this._scheduleNonPlinkoReset();}else{this._renderPayoutState('CLAIM SUBMITTED','Confirmation verification pending');}
      return true;
    } catch (e) {
      this.wagerPending = false; this.activeWager = wager; this.pendingClaim = { wager, payout: amount, summary };
      this.retryClaimBtn.style.display = 'block';
      this._renderPayoutState('CLAIM FAILED',`${safeUiText(e.message)} · Retry is available`);this._msg(`${summary} · WIN · payout ${amount} zkLTC · CLAIM FAILED: ${e.message}`); return false;
    }
  }

  async _retryCasinoClaim() {
    const p = this.pendingClaim; if (!p) return;
    this.retryClaimBtn.disabled = true; this.retryClaimBtn.style.display='none'; this.wagerPending = true;this._feedback('claim_started',{payout:p.payout});this._renderPayoutState('CLAIMING WINNINGS','Sending your winnings…',true); this._msg(`${p.summary} · sending your winnings…`);
    try {
      const out = await this.wagerGateway.claim(p.wager, p.payout),tracked=!out.tracking||out.tracking.ok;
      this.wagerPending = false;
      if(!tracked){this.retryClaimBtn.style.display='none';this.retryTrackBtn.style.display='block';this._renderPayoutState('CLAIM SUBMITTED','Confirmation verification pending');this._msg(`${p.summary} · payout submitted · retry tracking, not payout`);return;}
      this.activeWager = null; this.pendingClaim = null; this.retryClaimBtn.style.display = 'none';
      this._renderPayoutState('✓ WINNINGS CLAIMED',out.tracking?.alreadyClaimed?'Already confirmed on LitVM':'Confirmed on LitVM',false,true);this._msg(`${p.summary} · WIN · payout ${p.payout} zkLTC · claim confirmed`);if(this._game?.claimComplete)this._game.claimComplete();else this._scheduleNonPlinkoReset();
    } catch (e) { this.wagerPending = false;this.retryClaimBtn.textContent='RETRY PAYOUT CLAIM';this.retryClaimBtn.style.display='block';this._renderPayoutState('CLAIM FAILED',`${safeUiText(e.message)} · Retry is available`); this._msg(`CLAIM FAILED — ${e.message} · retry available`); }
    this.retryClaimBtn.disabled = false;
  }

  async _retryCasinoTracking() {
    this.retryTrackBtn.disabled = true; this._msg('Rechecking the existing transaction — no new transfer will be submitted…');
    const kind=this.wagerGateway.pendingTracking?.kind;
    try { await this.wagerGateway.retryTracking(); this.retryTrackBtn.style.display = 'none';
      if(kind==='payout'&&this.pendingClaim){const p=this.pendingClaim;this.activeWager=null;this.pendingClaim=null;this._renderPayoutState('✓ WINNINGS CLAIMED','Confirmed on LitVM',false,true);this._msg(`${p.summary} · WIN · payout ${p.payout} zkLTC · claim confirmed`);if(this._game?.claimComplete)this._game.claimComplete();else this._scheduleNonPlinkoReset();}
      else this._msg('Transaction tracking verified from LitVM confirmation.');
    }
    catch (e) { this._msg(`TRACKING FAILED — ${e.message} · retry available`); }
    this.retryTrackBtn.disabled = false;
  }

  _applyLayout(isCasino = !!CASINO_GAMES[this.openId]) {
    const shortLandscape = isCasino && window.innerWidth > window.innerHeight && window.innerHeight <= 500;
    const all = [this.head, this.canvas, this.controls, this.wagerPanel,this.outcomeEl];
    for (const el of all) { el.style.gridColumn = ''; el.style.gridRow = ''; }
    if (shortLandscape) {
      Object.assign(this.panel.style, {
        width: '96vw', maxWidth: '780px', height: '96vh', maxHeight: '360px',
        display: 'grid', flexDirection: '', gridTemplateColumns: 'minmax(0,1fr) minmax(230px,280px)',
        gridTemplateRows: '48px minmax(0,1fr) 86px', gap: '6px', padding: '6px',
      });
      this.head.style.gridColumn = '1 / 3'; this.head.style.gridRow = '1';
      this.canvas.style.gridColumn = '1'; this.canvas.style.gridRow = '2';
      this.controls.style.gridColumn = '1'; this.controls.style.gridRow = '3';
      this.wagerPanel.style.gridColumn = '2'; this.wagerPanel.style.gridRow = '2';
      this.outcomeEl.style.gridColumn='2';this.outcomeEl.style.gridRow='3';this.outcomeEl.style.height='100%';this.outcomeEl.style.boxSizing='border-box';
      this.wagerPanel.style.alignContent = 'center';
      this.wagerPanel.style.overflow = 'auto';
    } else {
      Object.assign(this.panel.style, {
        width: '94vw', maxWidth: '520px', height: '', maxHeight: '92vh', display: 'flex',
        flexDirection: 'column', gridTemplateColumns: '', gridTemplateRows: '',
        gap: isCasino ? '4px' : '10px', padding: isCasino ? '6px' : '12px 12px 14px',
      });
      this.wagerPanel.style.alignContent = '';
      this.wagerPanel.style.overflow = '';
      this.outcomeEl.style.height='';this.outcomeEl.style.boxSizing='';
    }
    this._shortCasinoLandscape = shortLandscape;
    this.panel.classList.toggle('ov-short-casino', shortLandscape);
  }

  _sizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const casino = !!CASINO_GAMES[this.openId];
    const h = Math.round(this._shortCasinoLandscape
      ? Math.min(225, Math.max(this.openId === 'plinko' ? 165 : 180, window.innerHeight - (this.openId === 'plinko' ? 155 : 135)))
      : casino
        ? Math.min(Math.max(Math.min(window.innerHeight * 0.34, window.innerHeight - 280), 90), 300)
        : Math.min(Math.max(Math.min(window.innerHeight * 0.42, window.innerHeight - 260), 150), 340));
    this.canvas.style.height = h + 'px';
    const w = this.canvas.clientWidth || 480;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, ctx };
  }

  open(id) {
    if (this.openId) return false;
    const def = CASINO_GAMES[id] || ARCADE_GAMES[id];
    if (!def) return false;
    this.openId = id;
    setRunPending(0);                       // fresh session: no stale run pending
    this.root.style.display = 'flex';
    document.body.classList.add('ov-open');
    this.title.textContent = def.title;
    this.controls.innerHTML = '';
    this._msg('');
    this._wallet();
    const isArc = !!ARCADE_GAMES[id];
    const isCasino = !!CASINO_GAMES[id];
    this.wagerPanel.style.display = isCasino ? 'grid' : 'none';
    this._applyLayout(isCasino);
    this.wagerPanel.style.gap = isCasino ? '4px' : '7px';
    this.wagerPanel.style.padding = isCasino ? '5px' : '8px';
    const walletSnapshot = this.game.walletSession.snapshot();
    this._walletState(walletSnapshot);
    if (isCasino) this._syncCasinoWallet(walletSnapshot);
    this.walletEl.style.display = 'block';
    this.activeWager = null;
    this.tokenEl.style.display = isArc ? 'block' : 'none';
    if (isArc) this._tokens();
    this.game.input.locked = true;                       // Lester holds his spot
    this._clean = [];
    this.root.style.animation = 'ovBack .18s ease-out';
    this.panel.style.animation = 'ovIn .24s cubic-bezier(.2,.9,.3,1.15)';
    const { w, h, ctx } = this._sizeCanvas();
    const api = this._api();
    this._game = id === 'plinko' ? plinkoGame(api, w, h)
      : id === 'slot' ? slotGame(api, w, h)
      : id === 'dice' ? diceGame(api, w, h)
      : id === 'coin' ? coinGame(api, w, h)
      : id === 'memrush' ? memrushGame(api, w, h)
      : id === 'tileshift' ? tileshiftGame(api, w, h)
      : id === 'neonescape' ? neonEscapeGame(api, w, h)
      : nbackGame(api, w, h);
    this._onResize = () => { this._applyLayout(); const s = this._sizeCanvas(); this._game.resize && this._game.resize(s.w, s.h); };
    window.addEventListener('resize', this._onResize);
    this.game.audio.play('click');
    this._last = performance.now();
    const tick = (t) => {
      if (!this.openId) return;
      const dt = Math.min(0.05, (t - this._last) / 1000);
      this._last = t;
      this._game.frame(t / 1000, dt);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
    this.game.events.emit('overlay:open', { id });
    return true;
  }

  close() {
    if (!this.openId) return;
    if (CASINO_GAMES[this.openId] && (this.wagerPending || this.activeWager)) { this._msg('Finish the confirmed wager or retry its payout claim before exiting.'); return; }
    cancelAnimationFrame(this._raf);
    for (const fn of this._clean || []) { try { fn(); } catch (e) { /* listener already gone */ } }
    this._clean = [];
    if (this._game && this._game.destroy) this._game.destroy();
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this.openId = null;
    this._game = null;
    this.root.style.display = 'none';
    document.body.classList.remove('ov-open');
    setRunPending(0);                       // leaving mid-run drops the unbanked pending
    this.game.input.locked = false;                      // control restored, position kept
    this.game.audio.play('back');
    this.game.events.emit('overlay:close', {});
  }

  _api() {
    const game = this.game;
    return {
      canvas: this.canvas,
      controls: this.controls,
      msg: (t) => this._msg(t),
      bet: () => this.bet,
      betControls: () => this._betControls(),
      btn: (text, on) => {
        const b = mk('button', { ...BTN }, this.controls, text);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); });
        return b;
      },
      holdBtn: (text, down, up) => {
        const b = mk('button', { ...BTN }, this.controls, text);
        const d = (e) => { e.preventDefault(); down(); };
        const u = (e) => { e.preventDefault(); if (up) up(); };
        b.addEventListener('pointerdown', d);
        b.addEventListener('pointerup', u);
        b.addEventListener('pointerleave', u);
        b.addEventListener('pointercancel', u);
        return b;
      },
      onEnd: (fn) => { this._clean.push(fn); },
      clearControls: () => { this.controls.innerHTML = ''; },
      exit: () => this.close(),
      showTokens: (txt) => this._tokens(txt),
      tokens: () => loadLedger().tokens,
      confirmWager: (gameId) => this._confirmCasinoWager(gameId),
      resolveOutcome: (gameId, maker, context) => this._resolveCasinoOutcome(gameId, maker, context),
      settleResult: (summary, payout, presentation) => this._revealThenSettle(summary, payout, presentation),
      clearResult: () => this._clearResult(),
      wagerInput: this.wagerInput,
      wagerPanel: this.wagerPanel,
      setControlsLocked: (locked) => { this.wagerInput.disabled=!!locked; },
      spend: () => { throw new Error('Legacy local-wallet casino spend is disabled'); },
      pay: () => { throw new Error('Legacy local-wallet casino payout is disabled'); },
      feedback: (type,detail) => this._feedback(type,detail),
      roundInfo: (info) => this._roundVisual(info),
      audio: game.audio,
    };
  }
}

// ================= PLINKO BALL =================
function plinkoGame(api, W, H) {
  const ctx=api.canvas.getContext('2d'),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,debugHost=['localhost','127.0.0.1'].includes(location.hostname),debug=debugHost&&new URLSearchParams(location.search).get('plinkoDebug')==='1';
  const S=(s,l)=>({s,l});
  // Every backend multiplier is represented. Duplicate values provide the
  // familiar symmetric Plinko row: smallest in the center, largest at edges.
  const RISK_SLOTS={
    low:[S(2000,'2×'),S(1500,'1.5×'),S(1000,'1×'),S(500,'0.5×'),S(0,'0×'),S(500,'0.5×'),S(1000,'1×'),S(1500,'1.5×'),S(2000,'2×')],
    medium:[S(5000,'5×'),S(3000,'3×'),S(2000,'2×'),S(1500,'1.5×'),S(1000,'1×'),S(500,'0.5×'),S(0,'0×'),S(500,'0.5×'),S(1000,'1×'),S(1500,'1.5×'),S(2000,'2×'),S(3000,'3×'),S(5000,'5×')],
    high:[S(10000,'10×'),S(5000,'5×'),S(3000,'3×'),S(2000,'2×'),S(1500,'1.5×'),S(1000,'1×'),S(500,'0.5×'),S(0,'0×'),S(500,'0.5×'),S(1000,'1×'),S(1500,'1.5×'),S(2000,'2×'),S(3000,'3×'),S(5000,'5×'),S(10000,'10×')],
  };
  const SCALE=10n**18n,Q=10n**10n;
  const DEFAULT_BALLS=1,DEFAULT_RISK='medium';
  let ballCount=DEFAULT_BALLS,risk=DEFAULT_RISK,state='idle',result=null,settled=false,activeBall=-1,flashes=[],trails=[],sims=[],landedCount=0,roundId=0,resetDone=true,resetTimer=0,firstMotionLogged=false;
  const palette=['#ffe49b','#73ddff','#ff82bc','#9cff9b','#c4a0ff'];
  const parseWei=(raw)=>{const t=String(raw||'');if(!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(t))return null;const [w,f='']=t.split('.');return BigInt(w)*SCALE+BigInt(f.padEnd(18,'0'));};
  const fmtWei=(raw)=>{const n=BigInt(raw),t=n.toString().padStart(19,'0'),f=t.slice(-18).replace(/0+$/,'');return f?`${t.slice(0,-18)}.${f}`:t.slice(0,-18);};
  const roundClaim=(n)=>((n+Q/2n)/Q)*Q;
  const potential=mk('div',{gridColumn:'1/-1',width:'100%',boxSizing:'border-box',padding:'5px 8px',minHeight:'28px',borderRadius:'8px',border:'1px solid rgba(217,164,65,.45)',background:'rgba(10,6,12,.72)',color:'#ffd98a',font:'800 10px system-ui',textAlign:'center'},api.wagerPanel);
  potential.style.display='none';api.onEnd(()=>potential.remove());
  const settingsWrap=mk('div',{display:'flex',gap:'7px',width:'100%',minWidth:'0',justifyContent:'center',alignItems:'center'},api.controls);
  const countWrap=mk('div',{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'2px',flex:'1 1 55%',minWidth:'0',padding:'2px',borderRadius:'9px',background:'rgba(10,6,12,.65)'},settingsWrap);
  const riskWrap=mk('div',{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'2px',flex:'1 1 45%',minWidth:'0',padding:'2px',borderRadius:'9px',background:'rgba(10,6,12,.65)'},settingsWrap);
  const countBtns=[],riskBtns=[];
  const styleSelections=()=>{countBtns.forEach(({b,n})=>css(b,n===ballCount?BTN_ON:BTN_OFF));riskBtns.forEach(({b,r})=>css(b,r===risk?BTN_ON:BTN_OFF));};
  const updatePotential=()=>{
    const total=parseWei(api.wagerInput.value),max=BigInt(RISK_SLOTS[risk].at(-1).s),count=BigInt(ballCount);
    if(total===null){potential.textContent='POTENTIAL PAYOUT · Enter a valid wager';api.roundInfo({wager:'Enter a valid wager',balls:String(ballCount),risk:risk.toUpperCase(),potential:'—'});return;}
    const base=total/count,rem=total%count;
    let payout=0n;for(let i=0;i<ballCount;i++){const share=i===ballCount-1?base+rem:base;payout+=roundClaim((share*max)/1000n);}
    potential.textContent=`POTENTIAL PAYOUT · Up to ${fmtWei(payout)} zkLTC · ${ballCount} ${ballCount===1?'ball':'balls'} · ${risk.toUpperCase()}`;
    api.roundInfo({wager:`${api.wagerInput.value} zkLTC`,balls:String(ballCount),risk:risk.toUpperCase(),potential:`up to ${fmtWei(payout)} zkLTC`});
  };
  for(let n=1;n<=5;n++){const b=mk('button',{...BTN,minHeight:'28px',height:'28px',padding:'0 5px',borderRadius:'7px',fontSize:'10px',whiteSpace:'nowrap'},countWrap,String(n));b.className='plinko-segment';b.setAttribute('aria-label',`${n} ${n===1?'ball':'balls'}`);b.addEventListener('pointerdown',e=>{e.preventDefault();if(state!=='idle'&&state!=='done')return;ballCount=n;styleSelections();updatePotential();});countBtns.push({b,n});}
  for(const r of ['low','medium','high']){const b=mk('button',{...BTN,minHeight:'28px',height:'28px',padding:'0 5px',borderRadius:'7px',fontSize:'9px'},riskWrap,r.toUpperCase());b.className='plinko-segment';b.addEventListener('pointerdown',e=>{e.preventDefault();if(state!=='idle'&&state!=='done')return;risk=r;styleSelections();updatePotential();});riskBtns.push({b,r});}
  const dropBtn=mk('button',{...BTN,minHeight:'34px',height:'34px',padding:'0 22px',fontSize:'12px'},api.controls,'DROP');dropBtn.className='plinko-drop';
  const lock=(v)=>{api.setControlsLocked(v);dropBtn.disabled=v;countBtns.forEach(x=>x.b.disabled=v);riskBtns.forEach(x=>x.b.disabled=v);};
  const resetRound=(id)=>{if(id!==roundId||resetDone||state!=='terminal')return;resetDone=true;clearTimeout(resetTimer);resetTimer=0;ballCount=DEFAULT_BALLS;risk=DEFAULT_RISK;state='idle';result=null;settled=false;activeBall=-1;landedCount=0;sims.length=0;trails.length=0;flashes.length=0;styleSelections();updatePotential();api.clearResult();lock(false);api.feedback('round_reset');api.msg('READY TO PLAY');};
  const scheduleReset=(id)=>{if(id!==roundId||resetDone||!['settling','terminal'].includes(state))return;state='terminal';clearTimeout(resetTimer);resetTimer=setTimeout(()=>resetRound(id),1200);};
  const wagerChange=()=>updatePotential();api.wagerInput.addEventListener('input',wagerChange);api.onEnd(()=>{api.wagerInput.removeEventListener('input',wagerChange);clearTimeout(resetTimer);});
  styleSelections();updatePotential();
  dropBtn.addEventListener('pointerdown',async e=>{
    e.preventDefault();if(state!=='idle')return;
    roundId++;resetDone=false;clearTimeout(resetTimer);resetTimer=0;
    state='authorizing';result=null;settled=false;sims.length=0;trails.length=0;flashes.length=0;api.clearResult();lock(true);api.msg('CONFIRM IN WALLET');
    if(!await api.confirmWager('plinko')){state='idle';resetDone=true;lock(false);return;}
    console.debug('[Plinko] wager confirmed');api.msg('WAGER CONFIRMED · RESOLVING RESULT');
    try{result=await api.resolveOutcome('plinko',()=>plinkoDrop(),{ballCount,risk});}
    catch(e2){state='idle';resetDone=true;lock(false);api.msg(`OUTCOME FAILED — ${e2.message}`);return;}
    console.debug('[Plinko] result received',{ballCount:result?.ballCount,risk:result?.risk});
    if(!result?.balls||result.ballCount!==ballCount||result.risk!==risk){state='idle';resetDone=true;lock(false);api.msg('OUTCOME FAILED — backend returned an invalid Plinko result.');return;}
    const g=geo();console.debug('[Plinko] board geometry calculated',g);landedCount=0;activeBall=0;flashes=[];trails=[];firstMotionLogged=false;
    const targets=result.balls.map(b=>{const targetBin=visualBin(b);return{targetBin,target:slotX(targetBin,g)};});console.debug('[Plinko] target pockets calculated',targets);
    // Balls and a deterministic assigned-pocket fallback exist before the strict
    // planner runs, so path validation can never block rendering or animation.
    sims=targets.map(({targetBin,target},i)=>{const trajectory=fallbackTrajectory(target,g,i),spawn=trajectory.nodes[0];return{x:spawn.x,y:spawn.y,vx:0,vy:Math.max(12,g.rowH*.7),targetBin,target,trajectory,pathTime:0,lastPathProgress:0,lastNodeIndex:-1,stuckFrames:0,rotation:0,inPocket:false,landing:false,landed:false,settle:0,age:0,bottomTime:0};});
    console.debug('[Plinko] balls created',sims.length);console.debug('[Plinko] physics initialized',{active:true,gravity:true,initialVy:sims.map(s=>s.vy)});
    state='animate';api.feedback('casino_game_started',{balls:ballCount,risk});console.debug('[Plinko] animation loop started');api.audio.play('tick');
    // Strict planning is bounded and may improve the already-running fallback.
    sims.forEach((sim,i)=>{console.debug('[Plinko] trajectory generation started',{ball:i+1,target:sim.target});const planned=buildTrajectory(sim.target,g,i,performance.now()+8);if(planned){sim.trajectory=planned;console.debug('[Plinko] trajectory generation succeeded',{ball:i+1,nodes:planned.nodes.length});}else console.warn('[Plinko] trajectory generation failed; using assigned-pocket fallback',{ball:i+1});});
  });
  const SLOT_H=20,BALL_R=3.6,PEG_R=2.2;
  const slotTop=()=>H-SLOT_H-6,settleY=()=>slotTop()+SLOT_H/2;
  const geo=()=>{const top=18,lastPegY=slotTop()-12,rowH=(lastPegY-top)/(PLINKO_ROWS-1),half=Math.min(16,(W/2-24)/4.5);return{top,bot:lastPegY+8,rowH,half,cx:W/2,lastPegY};};
  const boardBounds=(g=geo())=>{const edge=((PLINKO_ROWS+2)/2)*g.half+2.2;return{left:g.cx-edge,right:g.cx+edge,width:edge*2};};
  const slotPitch=(g=geo())=>boardBounds(g).width/RISK_SLOTS[risk].length;
  const visibleSlotWidth=(g=geo())=>Math.max(6,slotPitch(g)-1.5);
  const landingZoneHalf=(g=geo())=>visibleSlotWidth(g)*.45/2;
  const slotX=(bin,g=geo())=>boardBounds(g).left+slotPitch(g)*(bin+.5);
  const visualBin=(ball)=>{const scaled=Number(ball.multiplierScaled),matches=[];RISK_SLOTS[risk].forEach((slot,index)=>{if(slot.s===scaled)matches.push(index);});if(!matches.length)return Math.floor(RISK_SLOTS[risk].length/2);if(matches.length===1)return matches[0];const finalStep=Number(ball.steps?.at?.(-1)||0);return finalStep<=0?matches[0]:matches[matches.length-1];};
  const corridorAt=(sim,g,y=sim.y)=>{const startY=g.top+(g.lastPegY-g.top)*.7,entryY=slotTop()-5,t=Math.max(0,Math.min(1,(y-startY)/(entryY-startY))),ease=t*t*(3-2*t),startX=sim.approachX??sim.x,center=startX+(sim.target-startX)*ease,startHalf=Math.max(slotPitch(g)*.8,BALL_R*2),endHalf=Math.max(BALL_R+.6,slotPitch(g)/2-BALL_R),half=startHalf+(endHalf-startHalf)*ease;return{startY,entryY,t,center,half,left:center-half,right:center+half};};
  const boardMap=(g)=>{const pegs=[];for(let r=0;r<PLINKO_ROWS;r++)for(let i=0;i<=r+3;i++)pegs.push({x:g.cx+(i-(r+3)/2)*g.half,y:g.top+r*g.rowH,r});return{g,pegs,bounds:boardBounds(g),entryY:slotTop()-5};};
  const pointSegmentDistance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;if(!l2)return Math.hypot(p.x-a.x,p.y-a.y);const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2)),x=a.x+t*dx,y=a.y+t*dy;return Math.hypot(p.x-x,p.y-y);};
  const segmentClear=(a,b,map)=>a.x>=map.bounds.left&&a.x<=map.bounds.right&&b.x>=map.bounds.left&&b.x<=map.bounds.right&&map.pegs.every(p=>pointSegmentDistance(p,a,b)>=BALL_R+PEG_R+.35);
  const fallbackTrajectory=(target,g,variant=0)=>{const map=boardMap(g),spawn={x:g.cx+(variant-2)*1.4,y:g.top-13},nodes=[spawn];for(let r=0;r<PLINKO_ROWS;r++){const y=Math.min(g.top+r*g.rowH+g.rowH*.52,map.entryY-1),t=(r+1)/PLINKO_ROWS,desired=spawn.x+(target-spawn.x)*t,count=r+4,left=g.cx-(count-1)*g.half/2,firstGap=left+g.half/2,gap=Math.max(0,Math.min(count-2,Math.round((desired-firstGap)/g.half)));nodes.push({x:firstGap+gap*g.half,y,row:r});}const entry={x:target,y:map.entryY};nodes.push(entry);return{nodes,entry,duration:reduced?1.1:2.75+variant*.11,map,fallback:true};};
  const buildTrajectory=(target,g,variant=0,deadline=performance.now()+8)=>{const map=boardMap(g),spawn={x:g.cx+(variant-2)*1.4,y:g.top-13},levels=[];for(let r=0;r<PLINKO_ROWS;r++){const count=r+4,pegXs=Array.from({length:count},(_,i)=>g.cx+(i-(count-1)/2)*g.half),y=g.top+r*g.rowH+g.rowH*.52;levels.push(pegXs.slice(0,-1).map((x,i)=>({x:(x+pegXs[i+1])/2,y,row:r})));}let paths=[{node:spawn,nodes:[spawn]}];for(const level of levels){if(performance.now()>deadline)return null;const next=[];for(const candidate of level)for(const path of paths){if(performance.now()>deadline)return null;const prev=path.node;if(Math.abs(candidate.x-prev.x)>g.half*1.65||!segmentClear(prev,candidate,map))continue;next.push({node:candidate,nodes:[...path.nodes,candidate]});}if(!next.length)return null;next.sort((a,b)=>Math.abs(a.node.x-target)-Math.abs(b.node.x-target));paths=next.slice(0,48);}const entry={x:target,y:map.entryY};const valid=paths.filter(path=>segmentClear(path.node,entry,map)).sort((a,b)=>Math.abs(a.node.x-target)-Math.abs(b.node.x-target));if(!valid.length)return null;const pick=valid[Math.min(valid.length-1,variant%Math.min(3,valid.length))];return{nodes:[...pick.nodes,entry],entry,duration:reduced?1.1:2.75+variant*.11,map,fallback:false};};
  function board(time){
    const g=geo(),slots=RISK_SLOTS[risk];ctx.clearRect(0,0,W,H);const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#210d19');bg.addColorStop(1,'#10070d');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    for(let r=0;r<PLINKO_ROWS;r++)for(let i=0;i<=r+3;i++){const x=g.cx+(i-(r+3)/2)*g.half;ctx.shadowBlur=8;ctx.shadowColor='#d9a441';ctx.fillStyle=`rgba(255,220,145,${.58+.18*Math.sin(time*2+r+i)})`;ctx.beginPath();ctx.arc(x,g.top+r*g.rowH,2.2,0,7);ctx.fill();ctx.shadowBlur=0;}
    slots.forEach((slot,i)=>{const x=slotX(i,g),w=visibleSlotWidth(g),zoneW=w*.45,y=slotTop(),hit=sims.some(sim=>sim.targetBin===i&&(sim.landing||sim.landed)),approach=sims.some(sim=>sim.targetBin===i&&!sim.landed&&sim.y>g.top+(g.bot-g.top)*.62);ctx.save();if(approach){ctx.shadowBlur=6;ctx.shadowColor='rgba(255,215,120,.5)';}ctx.fillStyle=slot.s===0?'rgba(110,24,36,.95)':hit?'rgba(220,164,65,.9)':'rgba(83,28,43,.94)';ctx.beginPath();ctx.roundRect(x-w/2,y,w,SLOT_H,3);ctx.fill();ctx.strokeStyle=hit?'#fff0b2':'rgba(217,164,65,.5)';ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle='rgba(255,238,180,.2)';ctx.fillRect(x-zoneW/2,y+1,zoneW,2);ctx.strokeStyle='rgba(255,225,150,.2)';ctx.beginPath();ctx.moveTo(x-slotPitch(g)/2+BALL_R,y-5);ctx.lineTo(x-zoneW/2,y+SLOT_H/2);ctx.moveTo(x+slotPitch(g)/2-BALL_R,y-5);ctx.lineTo(x+zoneW/2,y+SLOT_H/2);ctx.stroke();ctx.fillStyle=hit?'#2a0d14':'#ffd98a';ctx.font=`800 ${Math.max(6,Math.min(8,w*.34))}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(slot.l,x,y+SLOT_H/2+.5);ctx.restore();});
    // Physical pocket separators correspond to the rendered slot pitch. They
    // begin below the final peg row, so there is no invisible outer-ring body.
    ctx.strokeStyle='rgba(240,190,95,.38)';ctx.lineWidth=1;for(let i=0;i<=slots.length;i++){const x=boardBounds(g).left+slotPitch(g)*i;ctx.beginPath();ctx.moveTo(x,slotTop()-5);ctx.lineTo(x,slotTop()+SLOT_H);ctx.stroke();}
    if(debug){ctx.save();ctx.lineWidth=.7;ctx.strokeStyle='rgba(80,235,255,.55)';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(boardBounds(g).left,slotTop()-5);ctx.lineTo(boardBounds(g).right,slotTop()-5);ctx.stroke();for(let r=0;r<PLINKO_ROWS;r++)for(let i=0;i<=r+3;i++){const x=g.cx+(i-(r+3)/2)*g.half,y=g.top+r*g.rowH;ctx.beginPath();ctx.arc(x,y,PEG_R,0,7);ctx.stroke();}sims.forEach(sim=>{const c0=corridorAt(sim,g,corridorAt(sim,g).startY),c1=corridorAt(sim,g,corridorAt(sim,g).entryY);ctx.beginPath();ctx.moveTo(c0.left,c0.startY);ctx.lineTo(c1.left,c1.entryY);ctx.moveTo(c0.right,c0.startY);ctx.lineTo(c1.right,c1.entryY);ctx.stroke();ctx.fillStyle='rgba(80,235,255,.8)';ctx.fillRect(sim.target-1,slotTop()-9,2,7);if(sim.trajectory){ctx.strokeStyle='rgba(105,255,135,.75)';ctx.beginPath();sim.trajectory.nodes.forEach((n,j)=>{j?ctx.lineTo(n.x,n.y):ctx.moveTo(n.x,n.y);});ctx.stroke();ctx.fillStyle='rgba(105,255,135,.8)';sim.trajectory.nodes.forEach(n=>{ctx.beginPath();ctx.arc(n.x,n.y,1.5,0,7);ctx.fill();});ctx.strokeStyle='rgba(80,235,255,.55)';}ctx.beginPath();ctx.arc(sim.x,sim.y,BALL_R,0,7);ctx.stroke();});ctx.setLineDash([]);ctx.restore();}
    return g;
  }
  const ball=(x,y,color,index)=>{ctx.save();ctx.shadowBlur=7;ctx.shadowColor=color;const gr=ctx.createRadialGradient(x-1.4,y-1.4,.7,x,y,4.6);gr.addColorStop(0,'#fff');gr.addColorStop(1,color);ctx.fillStyle=gr;ctx.beginPath();ctx.arc(x,y,3.6,0,7);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#2a0d14';ctx.font='900 5px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(index+1),x,y);ctx.restore();};
  function frame(time,dt){
    const g=board(time),duration=reduced?.18:1.15,gap=reduced?.04:.18;
    if(state==='animate'&&result){
      const step=Math.min(dt,.05),gravity=reduced?82:52;
      sims.forEach((sim,i)=>{
        const data=result.balls[i],color=palette[i];sim.age+=step;
        if(sim.landed){ball(sim.x,settleY(),color,i);return;}
        if(sim.landing){sim.settle+=step;const spring=1-Math.exp(-step*9);sim.y+=(settleY()-sim.y)*spring;sim.vx*=Math.exp(-step*8);sim.vy*=Math.exp(-step*9);const bob=Math.exp(-sim.settle*5)*Math.sin(sim.settle*18)*2;ball(sim.x,sim.y-bob,color,i);if(sim.settle>.58&&Math.abs(sim.vx)<.4){sim.landing=false;sim.landed=true;sim.y=settleY();landedCount++;activeBall=landedCount;flashes.push({x:sim.x,y:slotTop(),t:.34,c:color});api.msg(`Ball ${i+1} landed · ${data.multiplier} · +${fmtWei(data.payoutWei)} zkLTC`);}return;}
        if(!sim.inPocket){
          const trajectory=sim.trajectory,nodes=trajectory.nodes,previousX=sim.x,previousY=sim.y;
          sim.pathTime=Math.min(trajectory.duration,sim.pathTime+step);
          const progress=sim.pathTime/trajectory.duration,scaled=progress*(nodes.length-1),segment=Math.min(nodes.length-2,Math.floor(scaled)),f=Math.max(0,Math.min(1,scaled-segment)),a=nodes[segment],b=nodes[segment+1];
          const fall=Math.pow(f,1.35),smooth=fall*fall*(3-2*fall),direction=Math.sign(b.x-a.x)||((segment+i)%2?1:-1),deflection=Math.sin(Math.PI*f)*Math.min(1.1,Math.abs(b.x-a.x)*.08)*direction;
          sim.x=a.x+(b.x-a.x)*smooth+deflection;sim.y=a.y+(b.y-a.y)*fall;
          sim.vx=(sim.x-previousX)/Math.max(step,.001);sim.vy=(sim.y-previousY)/Math.max(step,.001);sim.rotation+=sim.vx*step/BALL_R;
          if(!firstMotionLogged&&i===0&&step>0){firstMotionLogged=true;console.debug('[Plinko] first ball position',{x:sim.x,y:sim.y});console.debug('[Plinko] first ball velocity',{vx:sim.vx,vy:sim.vy,downward:sim.vy>0});}
          const nodeIndex=Math.floor(scaled);if(nodeIndex!==sim.lastNodeIndex){sim.lastNodeIndex=nodeIndex;if(nodeIndex>0&&nodeIndex<nodes.length-1){flashes.push({x:nodes[nodeIndex].x,y:nodes[nodeIndex].y,t:.12,c:color});api.feedback('plinko_peg_hit',{ball:i+1,node:nodeIndex});if(!reduced)api.audio.play('tick');}}
          if(progress<=sim.lastPathProgress+.000001)sim.stuckFrames++;else sim.stuckFrames=0;sim.lastPathProgress=progress;
          trails.push({x:sim.x,y:sim.y,c:color,t:reduced?.04:.14});ball(sim.x,sim.y,color,i);
          if(progress>=1){sim.inPocket=true;sim.vx*=.15;sim.vy=Math.max(5,sim.vy*.35);sim.bottomTime=0;api.feedback('plinko_pocket_hit',{ball:i+1,targetBin:sim.targetBin,multiplier:data.multiplier,payoutWei:data.payoutWei});}
          return;
        }
        // The selected route has crossed the entry line at the assigned pocket
        // center. From here there is no target steering or horizontal correction.
        const mouthY=slotTop()-5,depth=Math.max(0,Math.min(1,(sim.y-mouthY)/(settleY()-mouthY))),mouthHalf=slotPitch(g)/2-BALL_R,floorHalf=landingZoneHalf(g),pocketHalf=mouthHalf+(floorHalf-mouthHalf)*depth,pocketL=sim.target-pocketHalf,pocketR=sim.target+pocketHalf;
        sim.vy+=gravity*step;sim.y+=sim.vy*step;sim.x+=sim.vx*step;sim.vx*=Math.exp(-step*4.4);
        if(sim.x<pocketL){sim.x=pocketL;sim.vx=Math.abs(sim.vx)*.12;}if(sim.x>pocketR){sim.x=pocketR;sim.vx=-Math.abs(sim.vx)*.12;}
        if(sim.y>=settleY()){sim.y=settleY();sim.bottomTime+=step;sim.vy=-Math.abs(sim.vy)*.07;const centerInside=Math.abs(sim.x-sim.target)<=landingZoneHalf(g),slowEnough=Math.abs(sim.vx)<=7&&Math.abs(sim.vy)<=11;if(centerInside&&slowEnough&&sim.bottomTime>=.18){sim.landing=true;sim.settle=0;flashes.push({x:sim.x,y:slotTop(),t:.28,c:color});}}
        if(!sim.landing){trails.push({x:sim.x,y:sim.y,c:color,t:reduced?.04:.14});ball(sim.x,sim.y,color,i);}
      });
      if(landedCount===sims.length&&!settled){settled=true;state='settling';const payout=fmtWei(result.totalPayoutWei);api.msg(BigInt(result.totalPayoutWei)>0n?'RESULT REVEALED · AUTOMATIC CLAIM IN 2 SECONDS':'RESULT REVEALED · ROUND COMPLETES IN 2 SECONDS');api.settleResult(`${result.ballCount} balls · ${result.risk.toUpperCase()} risk`,payout,{results:result.balls.map(ball=>ball.multiplier),wager:fmtWei(result.totalWagerWei)}).then(ok=>{if(ok){api.msg(BigInt(result.totalPayoutWei)>0n?'WINNINGS CLAIMED':'ROUND COMPLETE · NO WINNINGS');scheduleReset(roundId);}});}
    }else if(result){sims.forEach((sim,i)=>ball(sim.x,settleY(),palette[i],i));}
    for(let i=trails.length-1;i>=0;i--){const q=trails[i];q.t-=dt;if(q.t<=0){trails.splice(i,1);continue;}ctx.globalAlpha=q.t/.22*.35;ctx.fillStyle=q.c;ctx.beginPath();ctx.arc(q.x,q.y,3,0,7);ctx.fill();ctx.globalAlpha=1;}
    for(let i=flashes.length-1;i>=0;i--){const q=flashes[i];q.t-=dt;if(q.t<=0){flashes.splice(i,1);continue;}ctx.globalAlpha=q.t/.16;ctx.fillStyle=q.c;ctx.beginPath();ctx.arc(q.x,q.y,6,0,7);ctx.fill();ctx.globalAlpha=1;}
  }
  return{frame,resize:(w,h)=>{const offsets=sims.map(sim=>sim.x-sim.target);W=w;H=h;const g=geo();sims.forEach((sim,i)=>{sim.target=slotX(sim.targetBin,g);if(sim.landed){sim.x=sim.target+Math.max(-landingZoneHalf(g),Math.min(landingZoneHalf(g),offsets[i]));sim.y=settleY();}});},claimComplete:()=>{api.msg('WINNINGS CLAIMED');scheduleReset(roundId);},destroy:()=>{clearTimeout(resetTimer);lock(false);}};
}
// ================= SLOT =================
function slotGame(api, W, H) {
  const ctx = api.canvas.getContext('2d');
  const SYM = ['7', '★', '♦', '', '♥'];
  let reels = [0, 1, 2].map((i) => ({ off: i * 0.7, speed: 0, stopAt: 0, final: i, spinning: false, v: 0, settle: 0 }));
  let wonLine = false;
  let state = 'idle', t0 = 0, lineFlash = 0;
  api.betControls();
  api.btn('SPIN', async () => {
    if (state !== 'idle') return;
    state = 'authorizing';
    if (!await api.confirmWager('slot')) { state = 'idle'; return; }
    let finals;
    try { finals = await api.resolveOutcome('slot', () => slotSpin()); }
    catch (e) { state = 'idle'; api.msg(`OUTCOME FAILED — ${e.message}`); return; }
    const stops = [1.15, 1.55, 1.95];
    reels.forEach((r, i) => { r.spinning = true; r.speed = 13 + i * 2.4; r.stopAt = stops[i]; r.final = SYM.indexOf(finals[i]); r.v = 0; r.settle = 0; });
    wonLine = false;
    state = 'spin'; t0 = performance.now() / 1000;api.feedback('casino_game_started',{game:'slot'});
    api.audio.play('tick');
  });
  function frame(time, dt) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1c0d15'; ctx.fillRect(0, 0, W, H);
    const ww = Math.min(96, (W - 60) / 3), wh = 108, y0 = (H - wh) / 2 - 8;
    const k = Math.max(0, time - t0);
    let allStopped = true;
    reels.forEach((r, i) => {
      if (r.spinning) {
        if (state === 'spin' && k >= r.stopAt) { r.spinning = false; r.off = 0; r.settle = 1; api.audio.play('chip'); }
        else { r.v = Math.min(r.speed, (r.v || 0) + 95 * dt); r.off += r.v * dt; allStopped = false; }
      }
      if (r.settle > 0) r.settle = Math.max(0, r.settle - dt * 3.4);   // reel stop bounce
      const x = W / 2 + (i - 1) * (ww + 10) - ww / 2;
      ctx.fillStyle = '#f5f2ea';
      ctx.beginPath(); ctx.roundRect(x, y0, ww, wh, 8); ctx.fill();
      ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.roundRect(x, y0, ww, wh, 8); ctx.stroke();
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y0, ww, wh); ctx.clip();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let s = -1; s <= 1; s++) {
        const idx = r.spinning ? Math.floor(r.off + s + 1000) % 5 : (r.final + s + 5) % 5;
        const yy = y0 + wh / 2 + s * wh - (r.spinning ? (r.off % 1) * wh : 0) + (r.settle ? Math.sin(r.settle * 9) * 5 * r.settle : 0);
        ctx.globalAlpha = s === 0 ? 1 : 0.25;
        ctx.font = '900 40px Rajdhani,system-ui,sans-serif';
        ctx.fillStyle = SYM[idx] === '7' ? '#c8473b' : '#2a2030';
        ctx.fillText(SYM[idx], x + ww / 2, yy);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    });
    if (state === 'spin' && allStopped) {
      state = 'done'; lineFlash = 1;
      const finals = reels.map((r) => SYM[r.final]);
      const win = slotPayout(finals, api.bet());
      api.settleResult(`${finals.join(' ')} · ${slotMult(finals)}× · wager ${api.bet()} zkLTC`, win);
      if (win > 0) { api.audio.play('win'); wonLine = true; }
      else { api.audio.play('lose'); }
    }
    if (state === 'done') {
      lineFlash = Math.max(0, lineFlash - dt);
      if (lineFlash > 0) {
        ctx.strokeStyle = `rgba(255,214,140,${lineFlash.toFixed(2)})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(W / 2 - ww * 1.7, y0 + wh / 2); ctx.lineTo(W / 2 + ww * 1.7, y0 + wh / 2); ctx.stroke();
        if (wonLine) {
          for (let i = 0; i < 3; i++) {
            const x = W / 2 + (i - 1) * (ww + 10) - ww / 2;
            ctx.strokeStyle = `rgba(255,214,140,${(lineFlash * 0.9).toFixed(2)})`;
            ctx.lineWidth = 2.6;
            ctx.beginPath(); ctx.roundRect(x + 5, y0 + wh / 2 - 26, ww - 10, 52, 8); ctx.stroke();
          }
        }
      } else state = 'idle';
    }
    ctx.fillStyle = 'rgba(255,217,138,0.75)';
    ctx.font = '700 11px Rajdhani,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('3×7 = 25×   3×★ = 12×   3× same = 8×   pair = 2×', W / 2, H - 20);
  }
  return { frame, resize: () => {} };
}

// ================= DICE =================
function diceGame(api, W, H) {
  const ctx = api.canvas.getContext('2d');
  let choice = 'under', state = 'idle', t0 = 0, faces = [3, 4], resultFaces = [3, 4], shuffleAt = 0, resultFlash = 0, resultWin = false;
  const pips = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
  const setChoice = (c, btns) => { choice = c; btns.forEach((b) => css(b.el, b.c === c ? BTN_ON : BTN_OFF)); api.audio.play('chip'); };
  const btns = [];
  for (const c of ['under', 'seven', 'over']) {
    const label = c === 'under' ? 'UNDER 7' : c === 'seven' ? 'EXACTLY 7' : 'OVER 7';
    const b = api.btn(label, () => setChoice(c, btns));
    btns.push({ el: b, c });
  }
  css(btns[0].el, BTN_ON);
  api.btn('ROLL', async () => {
    if (state !== 'idle') return;
    state = 'authorizing';
    if (!await api.confirmWager('dice')) { state = 'idle'; return; }
    try { resultFaces = await api.resolveOutcome('dice', () => diceRoll(), { choice }); }
    catch (e) { state = 'idle'; api.msg(`OUTCOME FAILED — ${e.message}`); return; }
    state = 'roll'; t0 = performance.now() / 1000; shuffleAt = 0;
    api.audio.play('tick');
  });
  function die(x, y, v, s, rot = 0, yo = 0) {
    ctx.save();
    ctx.translate(x, y + yo); ctx.rotate(rot); ctx.translate(-x, -y);
    ctx.fillStyle = '#f5f2ea';
    ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, s * 0.2); ctx.fill();
    ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, s * 0.2); ctx.stroke();
    ctx.fillStyle = '#2a0d14';
    for (const [px, py] of pips[v]) { ctx.beginPath(); ctx.arc(x + px * s * 0.24, y + py * s * 0.24, s * 0.09, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  function frame(time, dt) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1c0d15'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#3f121e';
    ctx.beginPath(); ctx.ellipse(W / 2, H / 2 - 6, W * 0.36, H * 0.3, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(217,164,65,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(W / 2, H / 2 - 6, W * 0.36, H * 0.3, 0, 0, 7); ctx.stroke();
    if (state === 'roll') {
      const k = Math.max(0, time - t0);
      if (k - shuffleAt > 0.09 && k < 1.0) { shuffleAt = k; faces = diceRoll(); api.audio.play('tick'); }
      if (k >= 1.05) {
        state = 'idle'; faces = resultFaces;
        const total = faces[0] + faces[1];
        const win = dicePayout(choice, total, api.bet());
        api.settleResult(`${faces[0]} + ${faces[1]} = ${total} · wager ${api.bet()} zkLTC`, win);
        resultFlash = 1; resultWin = win > 0; api.audio.play('chip');
        if (win > 0) { api.audio.play('win'); }
        else { api.audio.play('lose'); }
      }
    }
    const s = Math.min(84, H * 0.34);
    const rolling = state === 'roll';
    const kk = rolling ? Math.max(0, time - t0) : 0;
    const hop = rolling ? -Math.abs(Math.sin(kk * Math.PI * 3.1)) * 26 * Math.max(0, 1 - kk) : 0;
    die(W / 2 - s * 0.62, H / 2 - 10, faces[0], s, rolling ? kk * 8 : 0, hop);
    die(W / 2 + s * 0.62, H / 2 - 2, faces[1], s, rolling ? -kk * 6.4 : 0, hop * 0.8);
    if (resultFlash > 0) {
      resultFlash = Math.max(0, resultFlash - dt);
      ctx.strokeStyle = resultWin ? `rgba(134,224,90,${resultFlash.toFixed(2)})` : `rgba(255,79,79,${(resultFlash * 0.8).toFixed(2)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(W / 2, H / 2 - 6, W * 0.36 + 6, H * 0.3 + 6, 0, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,217,138,0.8)';
    ctx.font = '800 13px Rajdhani,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(state === 'roll' ? 'Rolling…' : `Bet: ${choice === 'seven' ? 'exactly 7 (5×)' : choice + ' 7 (2×)'}`, W / 2, H - 22);
  }
  return { frame, resize: () => {} };
}

// ================= HEADS AND TAILS =================
function coinGame(api, W, H) {
  const ctx = api.canvas.getContext('2d');
  let choice = 'heads', state = 'idle', t0 = 0, shown = 'heads', side = 'heads', landT = 0, resultFlash = 0, resultWin = false;
  const btns = [];
  const setChoice = (c) => { choice = c; btns.forEach((b) => css(b.el, b.c === c ? BTN_ON : BTN_OFF)); api.audio.play('chip'); };
  for (const c of ['heads', 'tails']) {
    const b = api.btn(c.toUpperCase(), () => setChoice(c));
    btns.push({ el: b, c });
  }
  css(btns[0].el, BTN_ON);
  api.btn('FLIP', async () => {
    if (state !== 'idle') return;
    state = 'authorizing';
    if (!await api.confirmWager('coin')) { state = 'idle'; return; }
    try { side = await api.resolveOutcome('coin', () => coinFlip(), { choice }); }
    catch (e) { state = 'idle'; api.msg(`OUTCOME FAILED — ${e.message}`); return; }
    state = 'flip'; t0 = performance.now() / 1000;
    api.audio.play('tick');
  });
  function frame(time) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1c0d15'; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cyBase = H / 2 - 8, R = Math.min(64, H * 0.26);
    let scaleY = 1, hop = 0;
    if (state === 'flip') {
      const k = Math.max(0, (time - t0) / 1.5);
      hop = -Math.sin(Math.min(1, k) * Math.PI) * 74;                 // toss arc
      if (k >= 1) {
        state = 'land'; landT = 0; shown = side; resultFlash = 1;
        const win = coinPayout(choice, side, api.bet());
        api.settleResult(`${side.toUpperCase()} · picked ${choice.toUpperCase()} · wager ${api.bet()} zkLTC`, win);
        resultWin = win > 0;
        if (win > 0) { api.audio.play('win'); }
        else { api.audio.play('lose'); }
      } else {
        scaleY = Math.abs(Math.cos(k * Math.PI * 5));
        shown = Math.cos(k * Math.PI * 5) >= 0 ? 'heads' : 'tails';
      }
    } else if (state === 'land') {
      landT += 1 / 60;
      hop = -Math.abs(Math.sin(landT * 9)) * 10 * Math.max(0, 1 - landT * 2.2);   // landing bounce
      if (landT > 0.5) { state = 'idle'; hop = 0; }
    }
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.12, 0.35 + hop / 300).toFixed(3)})`;
    ctx.beginPath(); ctx.ellipse(cx, cyBase + R * 0.95, R * (0.8 + hop / 260), R * 0.22 * (0.8 + hop / 260), 0, 0, 7); ctx.fill();
    ctx.save();
    ctx.translate(cx, cyBase + hop);
    ctx.scale(1, Math.max(0.06, scaleY));
    const g = ctx.createRadialGradient(-R * 0.3, -R * 0.3, 4, 0, 0, R);
    g.addColorStop(0, '#ffe9b8'); g.addColorStop(1, '#b98a2e');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
    ctx.strokeStyle = '#8a6420'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, R - 4, 0, 7); ctx.stroke();
    ctx.fillStyle = '#6b4a10';
    ctx.font = `900 ${Math.round(R * 0.62)}px Rajdhani,system-ui,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(shown === 'heads' ? 'H' : 'T', 0, 2);
    ctx.restore();
    if (resultFlash > 0) {
      resultFlash = Math.max(0, resultFlash - 1 / 60);
      ctx.strokeStyle = resultWin ? `rgba(134,224,90,${resultFlash.toFixed(2)})` : `rgba(255,79,79,${(resultFlash * 0.8).toFixed(2)})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cyBase + hop, R + 8, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,217,138,0.8)';
    ctx.font = '800 13px Rajdhani,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(state === 'flip' ? 'Flipping…' : 'Correct call pays 2×', W / 2, H - 22);
  }
  return { frame, resize: () => {} };
}
