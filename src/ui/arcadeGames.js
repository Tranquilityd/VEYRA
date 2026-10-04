// Veyra — Phase 7 arcade games. Every mechanic is *shown*: rising lava with a
// living surface, meteors with warnings/trails/impacts, zombies that walk at
// you and fall when hit, tracers and muzzle flashes in the shooter. Shared HUD,
// wave banners, reward bursts and a game-over card keep the presentation clear.
import { beginSession, requestArcadeRound, submitArcadeRound, recordSession, fmtTokens, tokensForWaves, setRunPending } from '../games/arcadeRewards.js';
import {
  ARCADE_GAMES, memrushParams, tileshiftParams, tileshiftSlack,
  makeMemoryPattern, makeTileShiftPuzzle,
  loadBest, saveBest,
} from '../games/arcadeLogic.js';

const ctxOf = (api) => api.canvas.getContext('2d');

// ---------- shared presentation ----------
function chip(ctx, x, y, label, value, accent) {
  ctx.font = '800 10px Rajdhani,system-ui,sans-serif';
  const w = 10 + ctx.measureText(label + ' ' + value).width + 8;
  ctx.fillStyle = 'rgba(6,8,14,0.72)';
  ctx.beginPath(); ctx.roundRect(x, y, w, 18, 9); ctx.fill();
  ctx.strokeStyle = accent + '66'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, w, 18, 9); ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = accent; ctx.fillText(label, x + 7, y + 9.5);
  ctx.fillStyle = '#eaf6ff'; ctx.fillText(value, x + 7 + ctx.measureText(label + ' ').width, y + 9.5);
  return w;
}
export function drawHUD(ctx, W, o) {
  let x = 8;
  if (o.wave != null) x += chip(ctx, x, 8, 'WAVE', String(o.wave), o.accent) + 6;
  if (o.score != null) x += chip(ctx, x, 8, o.scoreLabel || 'SCORE', String(o.score), '#ffd98a') + 6;
  if (o.best != null) x += chip(ctx, x, 8, 'BEST', String(o.best), '#8fd8ff') + 6;
  if (o.hearts != null) {
    for (let i = 0; i < o.heartsMax; i++) {
      ctx.fillStyle = i < o.hearts ? '#ff3b56' : 'rgba(255,59,86,0.22)';
      ctx.beginPath();
      const hx = W - 14 - i * 16, hy = 17;
      ctx.arc(hx - 3, hy - 2, 3.4, 0, 7); ctx.arc(hx + 3, hy - 2, 3.4, 0, 7);
      ctx.moveTo(hx - 6.2, hy); ctx.lineTo(hx, hy + 7); ctx.lineTo(hx + 6.2, hy);
      ctx.fill();
    }
  }
  if (o.ammo != null) {
    for (let i = 0; i < o.ammoMax; i++) {
      ctx.fillStyle = i < o.ammo ? '#ffd98a' : 'rgba(255,217,138,0.2)';
      ctx.fillRect(W - 12 - (i + 1) * 7, 10, 4.6, 14);
    }
  }
  if (o.status) {
    ctx.font = '800 10px Rajdhani,system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = o.accent; ctx.fillText(o.status, W / 2, 40);
  }
}
function banner(ctx, W, H, text, k, accent) {          // wave banner slide-in/out
  if (k <= 0 || k >= 1) return;
  const a = k < 0.2 ? k / 0.2 : k > 0.75 ? (1 - k) / 0.25 : 1;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(4,6,10,0.55)';
  ctx.fillRect(0, H * 0.42 - 18, W, 36);
  ctx.fillStyle = accent; ctx.fillRect(0, H * 0.42 - 18, W, 2); ctx.fillRect(0, H * 0.42 + 16, W, 2);
  ctx.font = '900 20px Rajdhani,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f4f8ff';
  ctx.fillText(text, W / 2, H * 0.42 + (1 - a) * 6);
  ctx.restore();
}
function gameOverCard(ctx, W, H, t, title, lines, accent) {
  const k = Math.min(1, t / 0.45);
  const e = 1 - Math.pow(1 - k, 3);
  ctx.fillStyle = `rgba(4,5,10,${(0.62 * e).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
  const cw = Math.min(W - 60, 300), chh = 96;
  const cy = (H - chh) / 2 + (1 - e) * 26;
  ctx.save();
  ctx.globalAlpha = e;
  ctx.fillStyle = 'rgba(10,12,20,0.94)';
  ctx.beginPath(); ctx.roundRect((W - cw) / 2, cy, cw, chh, 12); ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect((W - cw) / 2, cy, cw, chh, 12); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 21px Rajdhani,system-ui,sans-serif'; ctx.fillStyle = accent;
  ctx.fillText(title, W / 2, cy + 24);
  ctx.font = '700 12.5px Rajdhani,system-ui,sans-serif'; ctx.fillStyle = '#eaf6ff';
  lines.forEach((ln, i) => ctx.fillText(ln, W / 2, cy + 48 + i * 17));
  ctx.restore();
}
function burst(parts, x, y, n, col, spd) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random() * 0.8);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, t: 0.7 + Math.random() * 0.5, col, r: 1.4 + Math.random() * 2 });
  }
}
function stepParts(ctx, parts, dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t -= dt; if (p.t <= 0) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 160 * dt;
    ctx.globalAlpha = Math.min(1, p.t * 2);
    ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ================= MEMORY RUSH =================
// Watch a lit pattern -> it hides -> tap it back. Memory + concentration, no
// reflex pressure: long previews early, 3 misses per run-end so a slip is a
// slip, not a punishment. Preview time never becomes a guessing game.
export function memrushGame(api, W, H) {
  const ctx = ctxOf(api);
  let state = 'ready', wave = 1, misses = 0, done = 0, phaseT = 0, doneT = 0, overT = 0, overRec = null;
  let pat = null, tapped = [], flashBad = -1, flashT = 0, bannerK = 0, bannerTxt = '', parts = [], runT = 0;
  let best = loadBest('memrush');
  const geo = () => { const size = Math.min(W, H) * 0.66; return { x: (W - size) / 2, y: (H - size) / 2 + 10, size }; };
  const cellAt = (px, py) => {
    const g = geo(), c = g.size / pat.n;
    if (px < g.x || py < g.y || px > g.x + g.size || py > g.y + g.size) return -1;
    return Math.floor((py - g.y) / c) * pat.n + Math.floor((px - g.x) / c);
  };
  const center = (idx) => { const g = geo(), c = g.size / pat.n; return { x: g.x + (idx % pat.n) * c + c / 2, y: g.y + Math.floor(idx / pat.n) * c + c / 2 }; };
  let rewardEnabled = false, roundToken = null;
  async function startWave() {
    state = 'loading'; tapped = []; roundToken = null;
    try {
      const challenge = rewardEnabled ? await requestArcadeRound('memrush') : null;
      if (challenge) {
        if (challenge.kind !== 'memrush' || challenge.wave !== wave) throw new Error('invalid memory challenge');
        pat = { n: challenge.n, cells: challenge.cells.slice(), mem: challenge.previewSeconds };
        roundToken = challenge.token;
      } else pat = makeMemoryPattern(wave);
      phaseT = pat.mem; state = 'show'; bannerTxt = 'WAVE ' + wave; bannerK = 0.001;
    } catch { state = 'over'; overT = 0; rewardEnabled = false; }
  }
  async function reset() {
    state = 'loading'; wave = 1; misses = 0; done = 0; runT = 0; overT = 0; overRec = null; flashBad = -1;
    setRunPending(0);
    const session = await beginSession('memrush'); rewardEnabled = session?.rewardEnabled === true;
    await startWave();
    api.audio.play('click');
  }
  function tap(idx) {
    if (state !== 'input' || idx < 0 || tapped.includes(idx)) return;
    if (pat.cells.includes(idx)) {
      tapped.push(idx); api.audio.play('tick');
      const c = center(idx); burst(parts, c.x, c.y, 6, '#7aa2ff', 70);
      if (tapped.length === pat.cells.length) {
        state = 'verifying';
        Promise.resolve(rewardEnabled ? submitArcadeRound('memrush', roundToken, tapped.slice()) : true).then(ok => {
          if (!ok) throw new Error('round rejected');
          done = wave;
          setRunPending(rewardEnabled ? tokensForWaves(wave) : 0);
          bannerTxt = 'WAVE ' + wave + ' COMPLETE' + (rewardEnabled ? '  +' + fmtTokens(tokensForWaves(1)) + ' zkLTC' : '');
          bannerK = 0.001; state = 'done'; doneT = 1.15; api.audio.play('win');
        }).catch(() => { rewardEnabled = false; state = 'over'; overT = 0; });
      }
    } else {
      misses++; flashBad = idx; flashT = 0.5; api.audio.play('deny');
      if (misses >= 3) { state = 'over'; overT = 0; }
    }
  }
  const buildControls = () => {
    api.btn('RUN', () => { if (state === 'ready') reset(); });          // no mid-wave accident resets
    api.btn('EXIT', () => api.exit());
  };
  buildControls();
  const cvs = api.canvas;
  const pd = (e) => {
    const r = cvs.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / r.width), py = (e.clientY - r.top) * (H / r.height);
    if (state === 'ready') { reset(); return; }
    tap(cellAt(px, py));
  };
  cvs.addEventListener('pointerdown', pd);
  window.__memrushDbg = () => ({ state, wave, misses, done, n: pat ? pat.n : 0, cells: pat ? pat.cells.slice() : [], rect: geo() });
  window.__memrushTap = (idx) => tap(idx | 0);
  window.__memrushSetWave = (w) => { if (state !== 'ready') { wave = w | 0; startWave(); } };
  api.onEnd(() => { recordSession('memrush'); cvs.removeEventListener('pointerdown', pd); window.__memrushDbg = null; window.__memrushTap = null; window.__memrushSetWave = null; });

  function frame(time, dt) {
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a0e1e'); bg.addColorStop(1, '#131a33');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(122,162,255,0.08)'; ctx.lineWidth = 1;      // soft focus rings
    for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(W / 2, H / 2 + 10, Math.min(W, H) * (0.16 * i + 0.22), 0, 7); ctx.stroke(); }
    if (state === 'show') { phaseT -= dt; runT += dt; if (phaseT <= 0) state = 'input'; }
    if (state === 'input') runT += dt;
    if (flashT > 0) flashT -= dt;
    if (state === 'done') { doneT -= dt; if (doneT <= 0) { wave++; startWave(); } }
    if (pat && state !== 'ready') {
      const g = geo(), c = g.size / pat.n, pad = Math.min(6, c * 0.1);
      for (let idx = 0; idx < pat.n * pat.n; idx++) {
        const x = g.x + (idx % pat.n) * c + pad, y = g.y + Math.floor(idx / pat.n) * c + pad, sz = c - pad * 2;
        const lit = state === 'show' && pat.cells.includes(idx);
        const got = state !== 'show' && tapped.includes(idx);
        const bad = flashT > 0 && idx === flashBad;
        ctx.fillStyle = bad ? '#ff3b56' : lit || got ? '#7aa2ff' : 'rgba(20,26,44,0.92)';
        ctx.beginPath(); ctx.roundRect(x, y, sz, sz, 7); ctx.fill();
        ctx.strokeStyle = lit || got ? '#cfe0ff' : 'rgba(122,162,255,0.35)'; ctx.lineWidth = lit || got ? 2 : 1;
        ctx.beginPath(); ctx.roundRect(x, y, sz, sz, 7); ctx.stroke();
        if (lit) {                                                    // breathing glow while memorising
          ctx.fillStyle = `rgba(255,255,255,${(0.25 + 0.2 * Math.sin(time * 6)).toFixed(3)})`;
          ctx.beginPath(); ctx.roundRect(x + sz * 0.28, y + sz * 0.28, sz * 0.44, sz * 0.44, 4); ctx.fill();
        }
        if (got) { ctx.strokeStyle = '#0a0e1e'; ctx.lineWidth = 2.4;   // check mark on recalled tiles
          ctx.beginPath(); ctx.moveTo(x + sz * 0.3, y + sz * 0.52); ctx.lineTo(x + sz * 0.45, y + sz * 0.66); ctx.lineTo(x + sz * 0.72, y + sz * 0.34); ctx.stroke(); }
      }
      if (state === 'show') {                                         // memorise countdown — always visible
        ctx.fillStyle = 'rgba(122,162,255,0.25)'; ctx.fillRect(g.x, g.y + g.size + 10, g.size, 5);
        ctx.fillStyle = '#7aa2ff'; ctx.fillRect(g.x, g.y + g.size + 10, g.size * Math.max(0, phaseT / pat.mem), 5);
      }
    }
    stepParts(ctx, parts, dt);
    if (bannerK > 0) { bannerK = Math.min(1, bannerK + dt / 1.6); banner(ctx, W, H, bannerTxt, bannerK, '#7aa2ff'); }
    drawHUD(ctx, W, { wave, score: done, scoreLabel: 'SOLVED', best, hearts: 3 - misses, heartsMax: 3, accent: '#7aa2ff',
      status: state === 'ready' ? 'Watch the lit pattern, then tap it back' : state === 'show' ? 'MEMORIZE THE PATTERN' : state === 'input' ? 'RECREATE THE PATTERN — ' + (pat.cells.length - tapped.length) + ' left' : state === 'done' ? '' : (wave === 1 && runT < 9 ? 'Tap the tiles that lit up — 3 misses ends the run' : '') });
    if (state === 'over') {
      if (overT === 0) {
        overRec = recordSession('memrush');                    // pending zkLTC, off-chain
        if (saveBest('memrush', wave)) best = wave;
        api.showTokens();
        if (done > 0) { api.audio.play('win'); burst(parts, W / 2, H / 2, 24, '#bcd0ff', 120); }
        else api.audio.play('lose');
        api.clearControls();
        api.btn('PLAY AGAIN', () => { reset(); api.clearControls(); buildControls(); });
        api.btn('EXIT', () => api.exit());
      }
      overT += dt;
      gameOverCard(ctx, W, H, overT, 'PATTERN LOST', [
        'Reached wave ' + wave + ' · ' + done + ' completed · ' + done + ' solved',
        '+' + fmtTokens(overRec ? overRec.tokens : 0) + ' zkLTC this run · balance ' + fmtTokens(overRec ? overRec.totalTokens : 0) + ' pending',
      ], '#7aa2ff');
    }
  }
  return { frame };
}

// ================= TILE SHIFT =================
// Memorise the target arrangement, then restore it from a scrambled board by
// swapping tiles (tap select -> tap destination). Puzzles are scrambled BY
// swaps from the solved target, so they are always solvable; the move budget
// is the concrete solution length + slack, so running out is always earnable.
const TS_COLS = ['#4fc3f7', '#ffd54f', '#ff5252', '#81c784'];
function tsGlyph(ctx, colr, x, y, r) {
  ctx.strokeStyle = 'rgba(10,12,18,0.85)'; ctx.fillStyle = 'rgba(10,12,18,0.85)'; ctx.lineWidth = 2;
  if (colr === 0) { ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, 7); ctx.stroke(); }
  else if (colr === 1) { ctx.fillRect(x - r * 0.42, y - r * 0.42, r * 0.84, r * 0.84); }
  else if (colr === 2) { ctx.beginPath(); ctx.moveTo(x, y - r * 0.55); ctx.lineTo(x + r * 0.52, y + r * 0.42); ctx.lineTo(x - r * 0.52, y + r * 0.42); ctx.closePath(); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, 7); ctx.fill(); }
}
export function tileshiftGame(api, W, H) {
  const ctx = ctxOf(api);
  let state = 'ready', wave = 1, done = 0, phaseT = 0, doneT = 0, overT = 0, overRec = null, moves = 0, sel = -1;
  let pz = null, anim = null, bannerK = 0, bannerTxt = '', parts = [], runT = 0;
  let best = loadBest('tileshift');
  const geo = () => { const size = Math.min(W, H) * 0.66; return { x: (W - size) / 2, y: (H - size) / 2 + 10, size }; };
  const cellAt = (px, py) => {
    const g = geo(), c = g.size / pz.n;
    if (px < g.x || py < g.y || px > g.x + g.size || py > g.y + g.size) return -1;
    return Math.floor((py - g.y) / c) * pz.n + Math.floor((px - g.x) / c);
  };
  const pos = (idx) => { const g = geo(), c = g.size / pz.n; return { x: g.x + (idx % pz.n) * c + c / 2, y: g.y + Math.floor(idx / pz.n) * c + c / 2 }; };
  let rewardEnabled = false, roundToken = null, roundMoves = [];
  async function startWave() {
    state = 'loading'; sel = -1; anim = null; roundToken = null; roundMoves = [];
    try {
      const challenge = rewardEnabled ? await requestArcadeRound('tileshift') : null;
      if (challenge) {
        if (challenge.kind !== 'tileshift' || challenge.wave !== wave) throw new Error('invalid tile challenge');
        pz = { n: challenge.n, target: challenge.target.slice(), board: challenge.board.slice(), preview: challenge.previewSeconds };
        moves = challenge.moveBudget; roundToken = challenge.token;
      } else {
        pz = makeTileShiftPuzzle(wave); moves = pz.minSwaps + tileshiftSlack(wave);
      }
      phaseT = pz.preview; state = 'show'; bannerTxt = 'WAVE ' + wave; bannerK = 0.001;
    } catch { state = 'over'; overT = 0; rewardEnabled = false; }
  }
  async function reset() {
    state = 'loading'; wave = 1; done = 0; runT = 0; overT = 0; overRec = null;
    setRunPending(0);
    const session = await beginSession('tileshift'); rewardEnabled = session?.rewardEnabled === true;
    await startWave();
    api.audio.play('click');
  }
  const solved = () => pz.board.every((v, i2) => v === pz.target[i2]);
  function tap(idx) {
    if (state !== 'input' || idx < 0) return;
    if (sel === -1) { sel = idx; api.audio.play('tick'); return; }
    if (sel === idx) { sel = -1; return; }
    const a = sel; sel = -1;
    const t = pz.board[a]; pz.board[a] = pz.board[idx]; pz.board[idx] = t;
    roundMoves.push([a, idx]);
    anim = { a, b: idx, p: 0 };
    moves--;
    if (solved()) {
      state = 'verifying';
      Promise.resolve(rewardEnabled ? submitArcadeRound('tileshift', roundToken, roundMoves.slice()) : true).then(ok => {
        if (!ok) throw new Error('round rejected');
        done = wave;
        setRunPending(rewardEnabled ? tokensForWaves(wave) : 0);
        bannerTxt = 'WAVE ' + wave + ' COMPLETE' + (rewardEnabled ? '  +' + fmtTokens(tokensForWaves(1)) + ' zkLTC' : '');
        bannerK = 0.001; state = 'done'; doneT = 1.15; api.audio.play('win');
      }).catch(() => { rewardEnabled = false; state = 'over'; overT = 0; });
    } else if (moves <= 0) { state = 'over'; overT = 0; api.audio.play('deny'); }
    else api.audio.play('click');
  }
  const buildControls = () => {
    api.btn('RUN', () => { if (state === 'ready' || state === 'over') reset(); });
    api.btn('EXIT', () => api.exit());
  };
  buildControls();
  const cvs = api.canvas;
  const pd = (e) => {
    const r = cvs.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / r.width), py = (e.clientY - r.top) * (H / r.height);
    if (state === 'ready') { reset(); return; }
    tap(cellAt(px, py));
  };
  cvs.addEventListener('pointerdown', pd);
  window.__tileshiftDbg = () => ({ state, wave, done, moves, n: pz ? pz.n : 0, board: pz ? pz.board.slice() : [], target: pz ? pz.target.slice() : [], rect: geo() });
  window.__tileshiftTap = (idx) => tap(idx | 0);
  window.__tileshiftSetWave = (w) => { if (state !== 'ready') { wave = w | 0; startWave(); } };
  api.onEnd(() => { recordSession('tileshift'); cvs.removeEventListener('pointerdown', pd); window.__tileshiftDbg = null; window.__tileshiftTap = null; window.__tileshiftSetWave = null; });

  function drawBoard(arr, alphaSel) {
    const g = geo(), c = g.size / pz.n, pad = Math.min(6, c * 0.1);
    for (let idx = 0; idx < pz.n * pz.n; idx++) {
      let x = g.x + (idx % pz.n) * c + pad, y = g.y + Math.floor(idx / pz.n) * c + pad;
      if (anim) {                                                     // swap slide
        const k = Math.min(1, anim.p);
        if (idx === anim.a) { const pa = pos(anim.b), pb = pos(anim.a); x = pa.x + (pb.x - pa.x) * k - c / 2 + pad; y = pa.y + (pb.y - pa.y) * k - c / 2 + pad; }
        if (idx === anim.b) { const pa = pos(anim.a), pb = pos(anim.b); x = pa.x + (pb.x - pa.x) * k - c / 2 + pad; y = pa.y + (pb.y - pa.y) * k - c / 2 + pad; }
      }
      const colr = arr[idx];
      ctx.fillStyle = TS_COLS[colr];
      ctx.beginPath(); ctx.roundRect(x, y, c - pad * 2, c - pad * 2, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(8,10,16,0.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x, y, c - pad * 2, c - pad * 2, 7); ctx.stroke();
      tsGlyph(ctx, colr, x + (c - pad * 2) / 2, y + (c - pad * 2) / 2, c - pad * 2);
      if (alphaSel === idx) {                                         // selected tile ring
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(x - 2, y - 2, c - pad * 2 + 4, c - pad * 2 + 4, 9); ctx.stroke();
      }
    }
  }
  function frame(time, dt) {
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#160f08'); bg.addColorStop(1, '#241a0e');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,179,71,0.07)'; ctx.lineWidth = 1.2;    // woven mat lines
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, H * (i / 5)); ctx.lineTo(W, H * (i / 5)); ctx.stroke(); }
    if (state === 'show') { phaseT -= dt; runT += dt; if (phaseT <= 0) state = 'input'; }
    if (state === 'input') runT += dt;
    if (anim) { anim.p += dt / 0.16; if (anim.p >= 1) anim = null; }
    if (state === 'done') { doneT -= dt; if (doneT <= 0) { wave++; startWave(); } }
    if (pz && state !== 'ready') {
      drawBoard(state === 'show' ? pz.target : pz.board, state === 'input' ? sel : -1);
      if (state === 'show') {
        ctx.fillStyle = 'rgba(255,179,71,0.25)'; ctx.fillRect(geo().x, geo().y + geo().size + 10, geo().size, 5);
        ctx.fillStyle = '#ffb347'; ctx.fillRect(geo().x, geo().y + geo().size + 10, geo().size * Math.max(0, phaseT / pz.preview), 5);
      }
    }
    stepParts(ctx, parts, dt);
    if (bannerK > 0) { bannerK = Math.min(1, bannerK + dt / 1.6); banner(ctx, W, H, bannerTxt, bannerK, '#ffb347'); }
    drawHUD(ctx, W, { wave, score: done, scoreLabel: 'SOLVED', best, accent: '#ffb347',
      status: state === 'ready' ? 'Memorise the target, then swap tiles to restore it' : state === 'show' ? 'MEMORIZE THE TARGET' : state === 'input' ? 'RESTORE THE PATTERN — ' + moves + ' moves left' : state === 'done' ? '' : (wave === 1 && runT < 9 ? 'Tap one tile, then another — they swap' : '') });
    if (state === 'over') {
      if (overT === 0) {
        overRec = recordSession('tileshift');                  // pending zkLTC, off-chain
        if (saveBest('tileshift', wave)) best = wave;
        api.showTokens();
        if (done > 0) { api.audio.play('win'); burst(parts, W / 2, H / 2, 24, '#ffe0b0', 120); }
        else api.audio.play('lose');
        api.clearControls();
        api.btn('PLAY AGAIN', () => { reset(); api.clearControls(); buildControls(); });
        api.btn('EXIT', () => api.exit());
      }
      overT += dt;
      gameOverCard(ctx, W, H, overT, 'OUT OF MOVES', [
        'Reached wave ' + wave + ' · ' + done + ' completed · ' + done + ' solved',
        '+' + fmtTokens(overRec ? overRec.tokens : 0) + ' zkLTC this run · balance ' + fmtTokens(overRec ? overRec.totalTokens : 0) + ' pending',
      ], '#ffb347');
    }
  }
  return { frame };
}

// ================= NEON ESCAPE =================
// Deterministic survival: every hazard frame comes from the authenticated
// server challenge and the backend replays this same bounded action stream.
export function neonEscapeGame(api, W, H) {
  const ctx=ctxOf(api), cvs=api.canvas;
  let state='ready', wave=1, done=0, challenge=null, token=null, actions=[], tick=0, accumulator=0;
  let x=500,y=500,countdown=0,overT=0,overRec=null,best=loadBest('neonescape');
  const keys=new Set(); let touch=null, parts=[];
  const keyDown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD'].includes(e.code)){e.preventDefault();keys.add(e.code);}};
  const keyUp=e=>keys.delete(e.code);
  const pointer=e=>{e.preventDefault();const r=cvs.getBoundingClientRect();touch={x:(e.clientX-r.left)/r.width*1000,y:(e.clientY-r.top)/r.height*1000};};
  const pointerUp=e=>{e.preventDefault();touch=null;},pointerMove=e=>{if(touch)pointer(e);};
  window.addEventListener('keydown',keyDown);window.addEventListener('keyup',keyUp);cvs.addEventListener('pointerdown',pointer,{passive:false});cvs.addEventListener('pointermove',pointerMove,{passive:false});cvs.addEventListener('pointerup',pointerUp,{passive:false});cvs.addEventListener('pointercancel',pointerUp,{passive:false});
  const direction=()=>{let dx=(keys.has('ArrowRight')||keys.has('KeyD')?1:0)-(keys.has('ArrowLeft')||keys.has('KeyA')?1:0),dy=(keys.has('ArrowDown')||keys.has('KeyS')?1:0)-(keys.has('ArrowUp')||keys.has('KeyW')?1:0);if(touch){dx=Math.abs(touch.x-x)>24?Math.sign(touch.x-x):0;dy=Math.abs(touch.y-y)>24?Math.sign(touch.y-y):0;}return[dx,dy];};
  async function nextWave(){state='loading';challenge=null;actions=[];tick=0;accumulator=0;x=500;y=500;
    try{challenge=await requestArcadeRound('neonescape');if(!challenge||challenge.kind!=='neonescape'||challenge.wave!==wave)throw new Error();token=challenge.token;countdown=2.5;state='countdown';}
    catch{state='over';overT=0;}}
  async function reset(){state='loading';wave=1;done=0;overRec=null;setRunPending(0);const session=await beginSession('neonescape');if(!session?.rewardEnabled){state='over';overT=0;return;}await nextWave();}
  async function complete(){state='verifying';try{await submitArcadeRound('neonescape',token,{actions});done=wave;setRunPending(tokensForWaves(done));api.audio.play('win');burst(parts,W/2,H/2,30,'#32f5ff',150);wave++;setTimeout(()=>nextWave(),900);}catch{state='over';overT=0;}}
  const step=()=>{const a=direction();actions.push(a);let[dx,dy]=a;if(dx&&dy){dx*=Math.SQRT1_2;dy*=Math.SQRT1_2;}x=Math.max(0,Math.min(1000,x+dx*challenge.speed));y=Math.max(0,Math.min(1000,y+dy*challenge.speed));const[sx,sy]=challenge.path[tick];let alive=Math.hypot(x-sx,y-sy)<=challenge.safeRadius;for(const h of challenge.hazards)if(h.tick===tick){const ld=h.axis==='x'?Math.abs(x-h.position):Math.abs(y-h.position),gd=h.axis==='x'?Math.abs(y-sy):Math.abs(x-sx);if(ld<=h.width&&gd>h.gap)alive=false;}tick++;if(!alive){state='over';overT=0;api.audio.play('deny');}else if(tick===challenge.ticks)complete();};
  api.btn('RUN',()=>{if(state==='ready'||state==='over')reset();});api.btn('EXIT',()=>api.exit());
  api.onEnd(()=>{recordSession('neonescape');window.removeEventListener('keydown',keyDown);window.removeEventListener('keyup',keyUp);cvs.removeEventListener('pointerdown',pointer);cvs.removeEventListener('pointermove',pointerMove);cvs.removeEventListener('pointerup',pointerUp);cvs.removeEventListener('pointercancel',pointerUp);});
  function frame(time,dt){ctx.clearRect(0,0,W,H);const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,'#030817');g.addColorStop(1,'#100622');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='rgba(50,245,255,.12)';ctx.lineWidth=1;for(let i=0;i<12;i++){ctx.beginPath();ctx.moveTo(i*W/11,0);ctx.lineTo(i*W/11,H);ctx.stroke();}for(let i=0;i<8;i++){ctx.beginPath();ctx.moveTo(0,i*H/7);ctx.lineTo(W,i*H/7);ctx.stroke();}
    if(state==='countdown'){countdown-=dt;if(countdown<=0)state='run';}
    if(state==='run'){accumulator+=dt*1000;while(accumulator>=challenge.tickMs&&state==='run'){accumulator-=challenge.tickMs;step();}}
    if(challenge&&['countdown','run','verifying'].includes(state)){const idx=Math.min(tick,challenge.path.length-1),[sx,sy]=challenge.path[idx],sx2=sx/1000*W,sy2=sy/1000*H,r=challenge.safeRadius/1000*Math.min(W,H);
      ctx.fillStyle='rgba(50,245,255,.08)';ctx.strokeStyle='#32f5ff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(sx2,sy2,r,0,7);ctx.fill();ctx.stroke();
      for(const h of challenge.hazards){const age=h.tick-tick;if(age<0||age>10)continue;ctx.strokeStyle=`rgba(255,55,180,${Math.max(.15,1-age/11)})`;ctx.lineWidth=Math.max(2,h.width/1000*Math.min(W,H));ctx.beginPath();if(h.axis==='x'){const px=h.position/1000*W;ctx.moveTo(px,0);ctx.lineTo(px,H);}else{const py=h.position/1000*H;ctx.moveTo(0,py);ctx.lineTo(W,py);}ctx.stroke();}
      const px=x/1000*W,py=y/1000*H;ctx.shadowBlur=18;ctx.shadowColor='#ffffff';ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(px,py,8,0,7);ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='#32f5ff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(px,py,13,0,7);ctx.stroke();
      if(state==='countdown'){ctx.fillStyle='#fff';ctx.font='900 54px Orbitron,system-ui';ctx.textAlign='center';ctx.fillText(String(Math.ceil(countdown)),W/2,H/2);}}
    stepParts(ctx,parts,dt);drawHUD(ctx,W,{wave,score:done,scoreLabel:'CLEARED',best,accent:'#32f5ff',status:state==='ready'?'Follow the moving safe zone — WASD/arrows or touch':state==='loading'?'REQUESTING VERIFIED ARENA':state==='countdown'?'GET READY':state==='run'?`SURVIVE ${Math.ceil((challenge.ticks-tick)*challenge.tickMs/1000)}s`:state==='verifying'?'VERIFYING ACTION REPLAY':''});
    if(state==='over'){if(overT===0){overRec=recordSession('neonescape');if(saveBest('neonescape',done))best=done;api.showTokens();}overT+=dt;gameOverCard(ctx,W,H,overT,'SIGNAL LOST',[`${done} verified wave${done===1?'':'s'} cleared`,'Only server-replayed survival waves earn Arcade Balance'],'#32f5ff');}}
  return{frame};
}

// ================= N-BACK =================
export function nbackGame(api,W,H){
 const ctx=ctxOf(api);let state='ready',wave=1,done=0,c=null,token=null,index=-1,clock=0,responses=[],feedback='',feedbackT=0,overT=0,overRec=null,best=loadBest('nback');
 const answer=match=>{if(state!=='respond'||index<c.n||responses.some(r=>r.index===index))return;const correct=(c.sequence[index]===c.sequence[index-c.n]);responses.push({index,match});feedback=match===correct?'CORRECT':'INCORRECT';feedbackT=.45;api.audio.play(match===correct?'tick':'deny');state='present';};
 const key=e=>{if(e.code==='KeyM'||e.code==='ArrowRight'){e.preventDefault();answer(true);}if(e.code==='KeyN'||e.code==='ArrowLeft'){e.preventDefault();answer(false);}};window.addEventListener('keydown',key);
 async function next(){state='loading';try{c=await requestArcadeRound('nback');if(!c||c.kind!=='nback'||c.wave!==wave)throw new Error();token=c.token;index=-1;clock=.9;responses=[];feedback='';state='present';}catch{state='over';overT=0;}}
 async function reset(){state='loading';wave=1;done=0;setRunPending(0);const s=await beginSession('nback');if(!s?.rewardEnabled){state='over';overT=0;return;}await next();}
 async function complete(){state='verifying';try{await submitArcadeRound('nback',token,{sequenceId:c.sequenceId,responses});done=wave;setRunPending(tokensForWaves(done));api.audio.play('win');wave++;setTimeout(()=>next(),900);}catch{state='over';overT=0;}}
 api.btn('MATCH  [M / →]',()=>answer(true));api.btn('NO MATCH  [N / ←]',()=>answer(false));api.btn('RUN',()=>{if(state==='ready'||state==='over')reset();});api.btn('EXIT',()=>api.exit());api.onEnd(()=>{recordSession('nback');window.removeEventListener('keydown',key);});
 function frame(time,dt){ctx.clearRect(0,0,W,H);ctx.fillStyle='#09061a';ctx.fillRect(0,0,W,H);if(feedbackT>0)feedbackT-=dt;
  if(['present','respond'].includes(state)){clock-=dt;if(clock<=0){if(state==='respond'&&index>=c.n&&!responses.some(r=>r.index===index)){state='over';overT=0;api.audio.play('deny');}else if(index+1>=c.sequence.length)complete();else{index++;clock=c.intervalMs/1000;state=index>=c.n?'respond':'present';}}}
  if(c&&index>=0){const n=c.grid,size=Math.min(W*.52,H*.65),ox=(W-size)/2,oy=(H-size)/2+12,cell=size/n,active=c.sequence[index];for(let i=0;i<n*n;i++){const x=ox+(i%n)*cell+4,y=oy+Math.floor(i/n)*cell+4;ctx.fillStyle=i===active?'#d68cff':'rgba(214,140,255,.07)';ctx.strokeStyle=i===active?'#fff':'rgba(214,140,255,.25)';ctx.lineWidth=i===active?3:1;ctx.beginPath();ctx.roundRect(x,y,cell-8,cell-8,10);ctx.fill();ctx.stroke();}if(feedbackT>0){ctx.fillStyle=feedback==='CORRECT'?'#80ffd0':'#ff668c';ctx.font='900 24px Orbitron,system-ui';ctx.textAlign='center';ctx.fillText(feedback,W/2,H-34);}}
  drawHUD(ctx,W,{wave,score:done,scoreLabel:'CLEARED',best,accent:'#d68cff',status:state==='ready'?'Is this position the same as N steps ago?':state==='loading'?'GENERATING VERIFIED SEQUENCE':state==='respond'?`N=${c.n} · MATCH or NO MATCH · ${index+1}/${c.sequence.length}`:state==='present'&&c?`N=${c.n} · WATCH · ${index+1}/${c.sequence.length}`:state==='verifying'?'VERIFYING RESPONSES':''});
  if(state==='over'){if(overT===0){overRec=recordSession('nback');if(saveBest('nback',done))best=done;api.showTokens();}overT+=dt;gameOverCard(ctx,W,H,overT,'SEQUENCE BROKEN',[`${done} verified round${done===1?'':'s'} cleared`,'Every ordered response is checked by the server'],'#d68cff');}}
 return{frame};
}
