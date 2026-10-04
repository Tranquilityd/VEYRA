import crypto from 'node:crypto';
import { makeMemoryPattern, makeTileShiftPuzzle, tileshiftSlack } from '../src/games/arcadeLogic.js';

export const ARCADE_REWARD_RATE = '0.00001';
export const REWARD_GAMES = new Set(['memrush', 'tileshift', 'neonescape', 'nback']);
export const NON_REWARD_GAMES = new Set(['basketball']);
export const MAX_REWARDED_WAVES = 100;
export const SESSION_TTL_MS = 60 * 60 * 1000;
export const ROUND_TTL_MS = 10 * 60 * 1000;
const randomUnit = () => crypto.randomInt(0, 0x100000000) / 0x100000000;
const safeIndexes = (value, max, maxLength = 128) => Array.isArray(value) && value.length <= maxLength && value.every(v => Number.isInteger(v) && v >= 0 && v < max);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function neonEscapeParams(wave) {
  const w = clamp(Math.floor(wave), 1, MAX_REWARDED_WAVES);
  return {
    ticks: clamp(55 + w * 3, 58, 110), tickMs: 100,
    speed: 42, safeRadius: clamp(245 - w * 9, 105, 236),
    drift: clamp(5 + w * 0.7, 5.7, 18), laserWidth: clamp(18 + w, 19, 48),
    laserEvery: clamp(18 - Math.floor(w / 2), 7, 18),
  };
}
function makeNeonEscape(wave, rng) {
  const p = neonEscapeParams(wave), phaseX = rng() * Math.PI * 2, phaseY = rng() * Math.PI * 2;
  const path = [];
  let x = 500, y = 500;
  for (let tick = 0; tick < p.ticks; tick++) {
    const targetX = 500 + Math.sin(phaseX + tick * (0.055 + wave * 0.0015)) * clamp(105 + wave * 5, 110, 260);
    const targetY = 500 + Math.sin(phaseY + tick * (0.043 + wave * 0.0012)) * clamp(85 + wave * 4, 90, 225);
    const dx = clamp(targetX - x, -p.drift, p.drift), dy = clamp(targetY - y, -p.drift, p.drift);
    x = Math.round((x + dx) * 100) / 100; y = Math.round((y + dy) * 100) / 100;
    path.push([x, y]);
  }
  const hazards = [];
  for (let tick = p.laserEvery; tick < p.ticks; tick += p.laserEvery) {
    hazards.push({ tick, axis: hazards.length % 2 ? 'x' : 'y', position: Math.round(path[tick][hazards.length % 2 ? 0 : 1]), width: p.laserWidth, gap: Math.round(p.safeRadius * 0.82) });
  }
  return { kind:'neonescape', wave, arena:1000, tickMs:p.tickMs, ticks:p.ticks, speed:p.speed, safeRadius:p.safeRadius, path, hazards };
}

export function nBackParams(wave) {
  const w = clamp(Math.floor(wave), 1, MAX_REWARDED_WAVES);
  return {
    n: w < 3 ? 1 : w < 7 ? 2 : w < 12 ? 3 : 4,
    grid: w < 5 ? 3 : w < 11 ? 4 : 5,
    length: clamp(8 + w, 9, 28),
    intervalMs: clamp(1500 - w * 55, 650, 1445),
    responseMs: clamp(1150 - w * 35, 550, 1115),
  };
}
function makeNBack(wave, rng) {
  const p = nBackParams(wave), cells = p.grid * p.grid, sequence = [];
  for (let i = 0; i < p.length; i++) {
    const forceMatch = i >= p.n && rng() < 0.32;
    let value = forceMatch ? sequence[i - p.n] : Math.floor(rng() * cells);
    if (!forceMatch && i >= p.n && value === sequence[i - p.n]) value = (value + 1) % cells;
    sequence.push(value);
  }
  return { kind:'nback', wave, sequenceId:crypto.randomUUID(), n:p.n, grid:p.grid, sequence, intervalMs:p.intervalMs, responseMs:p.responseMs };
}

export function createArcadeChallenge(game, wave, now = Date.now(), rng = randomUnit) {
  if (!REWARD_GAMES.has(game) || !Number.isInteger(wave) || wave < 1 || wave > MAX_REWARDED_WAVES) throw new Error('ARCADE_REWARD_UNAVAILABLE');
  let value, minMs;
  if (game === 'memrush') {
    const p = makeMemoryPattern(wave, rng);
    value = { kind:game, wave, n:p.n, cells:p.cells, previewSeconds:p.mem };
    minMs = Math.ceil((p.mem + p.cells.length * 0.15) * 1000);
  } else if (game === 'tileshift') {
    const p = makeTileShiftPuzzle(wave, rng), moveBudget = p.minSwaps + tileshiftSlack(wave);
    value = { kind:game, wave, n:p.n, target:p.target, board:p.board, moveBudget, previewSeconds:p.preview };
    minMs = Math.ceil((p.preview + p.minSwaps * 0.15) * 1000);
  } else if (game === 'neonescape') {
    value = makeNeonEscape(wave, rng); minMs = value.ticks * value.tickMs;
  } else {
    value = makeNBack(wave, rng); minMs = value.sequence.length * value.intervalMs;
  }
  return { public:value, verifier:structuredClone(value), notBefore:new Date(now + minMs), expiresAt:new Date(now + ROUND_TTL_MS) };
}

function verifyNeonEscape(v, events) {
  const actions = events?.actions;
  if (!Array.isArray(actions) || actions.length !== v.ticks || actions.length > 120) return false;
  let x = 500, y = 500;
  for (let tick = 0; tick < v.ticks; tick++) {
    const action = actions[tick];
    if (!Array.isArray(action) || action.length !== 2 || !action.every(n => Number.isInteger(n) && n >= -1 && n <= 1)) return false;
    let [dx, dy] = action; if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
    x = clamp(x + dx * v.speed, 0, v.arena); y = clamp(y + dy * v.speed, 0, v.arena);
    const [sx, sy] = v.path[tick];
    if (Math.hypot(x - sx, y - sy) > v.safeRadius) return false;
    for (const h of v.hazards) if (h.tick === tick) {
      const lineDistance = h.axis === 'x' ? Math.abs(x - h.position) : Math.abs(y - h.position);
      const gapDistance = h.axis === 'x' ? Math.abs(y - sy) : Math.abs(x - sx);
      if (lineDistance <= h.width && gapDistance > h.gap) return false;
    }
  }
  return true;
}
function verifyNBack(v, events) {
  if (!events || events.sequenceId !== v.sequenceId || !Array.isArray(events.responses)) return false;
  const expectedCount = v.sequence.length - v.n;
  if (events.responses.length !== expectedCount || expectedCount > 32) return false;
  return events.responses.every((r, offset) => r && Number(r.index) === offset + v.n && typeof r.match === 'boolean' && r.match === (v.sequence[r.index] === v.sequence[r.index - v.n]));
}
export function verifyArcadeRound(verifier, events) {
  if (!verifier) return false;
  const cells = verifier.n * verifier.n;
  if (verifier.kind === 'memrush') {
    if (!safeIndexes(events, cells, cells) || events.length !== verifier.cells.length || new Set(events).size !== events.length) return false;
    const expected = new Set(verifier.cells); return events.every(v => expected.has(v));
  }
  if (verifier.kind === 'tileshift') {
    if (!Array.isArray(events) || events.length < 1 || events.length > verifier.moveBudget) return false;
    const board = verifier.board.slice();
    for (const move of events) {
      if (!Array.isArray(move) || move.length !== 2) return false;
      const [a,b] = move;
      if (!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=cells||b>=cells||a===b) return false;
      [board[a],board[b]]=[board[b],board[a]];
    }
    return board.length===verifier.target.length&&board.every((v,i)=>v===verifier.target[i]);
  }
  if (verifier.kind === 'neonescape') return verifyNeonEscape(verifier, events);
  if (verifier.kind === 'nback') return verifyNBack(verifier, events);
  return false;
}

const secret=()=>{const value=process.env.API_SESSION_SECRET;if(!value||value.length<32)throw new Error('SERVER_MISCONFIGURED');return value;};
const signature=(roundId,sessionId,userId,game)=>crypto.createHmac('sha256',secret()).update(`${roundId}.${sessionId}.${userId}.${game}`).digest('base64url');
export const issueArcadeRoundToken=({roundId,sessionId,userId,game})=>`${roundId}.${signature(roundId,sessionId,userId,game)}`;
export function verifyArcadeRoundToken(token,{sessionId,userId,game}){
 if(typeof token!=='string'||token.length>160)return null;const split=token.lastIndexOf('.');if(split<1)return null;
 const roundId=token.slice(0,split),supplied=token.slice(split+1);if(!/^[0-9a-f-]{36}$/i.test(roundId))return null;
 const expected=signature(roundId,sessionId,userId,game);if(supplied.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return null;return roundId;
}
