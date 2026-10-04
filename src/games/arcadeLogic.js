// Veyra — Phase 7 arcade game rules (pure, unit-tested).
// Each physical cabinet maps 1:1 to exactly one of these games.
export const ARCADE_GAMES = {
  memrush:  { id: 'memrush',  name: 'Memory Rush',  short: 'Memory Rush',  title: 'MEMORY RUSH',  accent: '#7aa2ff' },
  tileshift:{ id: 'tileshift',name: 'Tile Shift',   short: 'Tile Shift',   title: 'TILE SHIFT',   accent: '#ffb347' },
  neonescape:{ id: 'neonescape', name: 'Neon Escape', short: 'Neon Escape', title: 'NEON ESCAPE', accent: '#32f5ff' },
  nback:    { id: 'nback', name: 'N-Back', short: 'N-Back', title: 'N-BACK', accent: '#d68cff' },
};

// ---- payout tiers (shared shape: bronze / silver / gold) ----
export const memrushPayout = (wave) => (wave >= 6 ? 12 : wave >= 4 ? 5 : wave >= 2 ? 2 : 0);
export const tileshiftPayout = (wave) => (wave >= 6 ? 12 : wave >= 4 ? 5 : wave >= 2 ? 2 : 0);

// ---- wave maths (pure so tests can pin difficulty curves) ----
// Phase 8 difficulty philosophy: easy to learn -> comfortable -> challenging ->
// difficult -> very challenging, on a SMOOTH curve. No exponential spikes, no
// scaling every lever at once (levers are staggered/rotated), breathing room
// every 4th wave, and hard caps so late waves stay mechanically fair —
// especially on touch screens.
const DIFF_TABLE = [0.20, 0.25, 0.29, 0.34, 0.39, 0.44, 0.49, 0.55, 0.60, 0.66, 0.70, 0.74];
export const diffIndex = (wave) => {
  const w = Math.max(1, Math.floor(wave));
  if (w <= DIFF_TABLE.length) return DIFF_TABLE[w - 1];
  return Math.min(1.0, 0.74 + (w - DIFF_TABLE.length) * 0.03);      // controlled, never runaway
};
export const breath = (wave) => (Math.max(1, Math.floor(wave)) % 4 === 0 ? 0.88 : 1);  // wave 8/12/16… ease off
export const diff = (wave) => diffIndex(wave) * breath(wave);
const cap = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// MEMORY RUSH — memory load via grid size, tile count and preview time.
// Levers rotate: waves 2-4 add tiles, wave 5 grows the grid (tiles held),
// 7-10 tighten preview + irregular shapes, 11+ grows grid then tiles slowly.
// Preview never drops below 1.8 s — memorising must stay possible, never a guess.
const MR_TABLE = [                       // wave: [grid, tiles, memorize s, style]
  [3, 2, 3.2, 'simple'], [3, 3, 3.0, 'simple'], [3, 4, 2.8, 'simple'], [3, 5, 2.6, 'simple'],
  [4, 5, 3.0, 'mixed'], [4, 6, 2.8, 'mixed'], [4, 7, 2.5, 'mixed'], [4, 7, 2.3, 'irregular'],
  [4, 8, 2.2, 'irregular'], [4, 9, 2.0, 'irregular'], [5, 9, 2.4, 'irregular'], [5, 10, 2.2, 'irregular'],
];
export const memrushParams = (w) => {
  const wi = Math.max(1, Math.floor(w));
  const t = MR_TABLE[Math.min(wi, MR_TABLE.length) - 1];
  let [n, k, mem, style] = t;
  if (wi > MR_TABLE.length) {                                  // 13+: controlled climb
    const ex = wi - MR_TABLE.length;
    k = Math.min(n * n - 3, 10 + Math.floor(ex / 2));          // tiles creep up, grid held
    mem = Math.max(1.8, 2.2 - ex * 0.05);                      // preview eases, hard floor
    if (wi >= 17) n = 5;                                       // (already 5) kept explicit
  }
  const cells = n * n;
  const r2 = (v) => Math.round(v * 100) / 100;
  return { n, k: Math.min(k, cells - 3), mem: r2(cap(mem, 1.8, 4)), style };
};
// TILE SHIFT — planning depth via scramble swaps; preview time eases slowly and
// never carries the difficulty ("challenge comes from solving, not timers").
const TS_TABLE = [                       // wave: [grid, scramble swaps, preview s, style]
  [3, 1, 4.0, 'bands'], [3, 2, 4.0, 'bands'], [3, 2, 3.6, 'bands'], [3, 3, 3.4, 'bands'],
  [3, 3, 3.0, 'diag'], [3, 4, 2.8, 'diag'], [4, 4, 3.2, 'diag'], [4, 5, 3.0, 'diag'],
  [4, 5, 2.7, 'latin'], [4, 6, 2.5, 'latin'], [4, 7, 2.4, 'latin'], [4, 7, 2.2, 'latin'],
];
export const tileshiftParams = (w) => {
  const wi = Math.max(1, Math.floor(w));
  const t = TS_TABLE[Math.min(wi, TS_TABLE.length) - 1];
  let [n, swaps, preview, style] = t;
  if (wi > TS_TABLE.length) {
    const ex = wi - TS_TABLE.length;
    swaps = Math.min(9, 7 + Math.floor(ex / 2));               // solution depth creeps
    preview = Math.max(1.6, 2.2 - ex * 0.05);                  // floor: never a blink test
  }
  return { n, swaps, preview: Math.round(cap(preview, 1.6, 4.5) * 100) / 100, style };
};
export const tileshiftSlack = (w) => (Math.floor(w) <= 3 ? 3 : Math.floor(w) <= 10 ? 2 : 1); // extra moves over the minimum

// ---- pure generators (testable: solvability + readability pins live in tests.js) ----
// Memory pattern: structured shapes early (chunkable), irregular later.
export function makeMemoryPattern(wave, rng = Math.random) {
  const { n, k, style } = memrushParams(wave);
  const cellsN = n * n;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  let cells = [];
  const add = (r, c) => { const i = r * n + c; if (r >= 0 && c >= 0 && r < n && c < n && !cells.includes(i)) cells.push(i); };
  if (style === 'simple') {                                    // lines / blocks / corners
    const kind = Math.floor(rng() * 3);
    if (kind === 0) { const r = Math.floor(rng() * n), c0 = Math.floor(rng() * n); for (let i = 0; i < k; i++) add(r, (c0 + i) % n); }
    else if (kind === 1) { const r0 = Math.floor(rng() * (n - 1)), c0 = Math.floor(rng() * (n - 1)); for (let r = r0; r < r0 + 2; r++) for (let c = c0; c < n && cells.length < k; c++) add(r, c); }
    else { [[0, 0], [0, n - 1], [n - 1, 0], [n - 1, n - 1]].forEach(([r, c]) => add(r, c)); }
  } else if (style === 'mixed') {                              // half structure, half scatter
    const r = Math.floor(rng() * n);
    for (let c = 0; c < Math.ceil(k / 2); c++) add(r, c);
  }
  while (cells.length < k) add(Math.floor(rng() * n), Math.floor(rng() * n));
  cells = cells.slice(0, k);
  if (cells.length < k) for (let i = 0; i < cellsN && cells.length < k; i++) if (!cells.includes(i)) cells.push(i);
  return { n, k, cells: cells.slice().sort((a, b) => a - b), mem: memrushParams(wave).mem };
}
// Tile Shift puzzle: build the SOLVED target, then apply `swaps` valid swap moves
// => the presented board is guaranteed restorable by swaps (never unsolvable).
export function makeTileShiftPuzzle(wave, rng = Math.random) {
  const { n, swaps, preview, style } = tileshiftParams(wave);
  const cols = Math.min(4, n + 1);
  const target = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    target.push(style === 'bands' ? r % cols : style === 'diag' ? (r + c) % cols : (r * 2 + c) % cols);
  }
  let best = null;
  for (let attempt = 0; attempt < 40; attempt++) {             // controlled scramble, depth-tuned
    const board = target.slice();
    let applied = 0, guard = 0;
    while (applied < swaps && guard++ < 60) {
      const a = Math.floor(rng() * n * n); let b = Math.floor(rng() * (n * n - 1)); if (b >= a) b++;
      if (board[a] === board[b]) continue;                     // a swap must visibly change
      const t = board[a]; board[a] = board[b]; board[b] = t; applied++;
    }
    if (board.every((v, i) => v === target[i])) continue;      // never present a solved board
    const depth = minSwapSolve(target, board);                 // a concrete solution => achievable
    if (depth < 1) continue;
    if (!best || Math.abs(depth - swaps) < Math.abs(best.depth - swaps)) best = { board, applied, depth };
    if (best.depth === swaps) break;
  }
  if (!best) {                                                 // fallback: one guaranteed visible swap
    const board = target.slice(); const t = board[0]; board[0] = board[n * n - 1]; board[n * n - 1] = t;
    best = { board, applied: 1, depth: minSwapSolve(target, board) };
  }
  // Scrambling by swaps from the solved target => always restorable by swaps.
  return { n, target, board: best.board, swaps: best.applied || 1, preview, minSwaps: best.depth };
}
export function minSwapSolve(target, board) {
  // Valid solution cost => guaranteed >= true optimum, so budgets built on it
  // are always achievable. Pass 1: direct swaps that fix two tiles at once.
  // Pass 2: greedy colour placement for the remainder.
  const b = board.slice(); let moves = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === target[i]) continue;
    let j = -1;
    for (let q = i + 1; q < b.length; q++) if (b[q] === target[i] && b[i] === target[q]) { j = q; break; }
    if (j === -1) continue;
    const t = b[i]; b[i] = b[j]; b[j] = t; moves++;
  }
  for (let i = 0; i < b.length; i++) {
    if (b[i] === target[i]) continue;
    const j = b.indexOf(target[i], i + 1);
    if (j === -1) continue;
    const t = b[i]; b[i] = b[j]; b[j] = t; moves++;
  }
  return moves;
}
// ---- local high scores ----
export function loadBest(key) {
  try { return Number(localStorage.getItem('veyra:best:' + key)) || 0; } catch (e) { return 0; }
}
export function saveBest(key, v) {
  try {
    const cur = loadBest(key);
    if (v > cur) { localStorage.setItem('veyra:best:' + key, String(v)); return true; }
  } catch (e) { /* private mode: scores just don't persist */ }
  return false;
}

