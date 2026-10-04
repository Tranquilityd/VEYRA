// Veyra — Phase 6 casino game rules (pure, unit-tested).
// Every physical machine maps 1:1 to one of these games.
export const CASINO_GAMES = {
  plinko: { id: 'plinko', name: 'Plinko Ball', short: 'plinko', title: 'PLINKO BALL' },
  slot:   { id: 'slot', name: 'Slot', short: 'slot', title: 'SLOT' },
  dice:   { id: 'dice', name: 'Dice', short: 'dice', title: 'DICE' },
  coin:   { id: 'coin', name: 'Heads and Tails', short: 'heads & tails', title: 'HEADS AND TAILS' },
};

// ---- Plinko: 9 bins, edge bins pay most (centre is the common landing zone) ----
export const PLINKO_BINS = [10, 5, 2, 1, 0.5, 1, 2, 5, 10];
export const PLINKO_ROWS = 9;

// deterministic-ish path: one lateral decision per row; returns bin index + path pts
export function plinkoDrop(rand = Math.random) {
  let col = 0;                                   // offset from centre in half-steps
  const steps = [];
  for (let r = 0; r < PLINKO_ROWS; r++) {
    const dir = rand() < 0.5 ? -1 : 1;
    col = Math.max(-4, Math.min(4, col + dir));
    steps.push(col);
  }
  const bin = col + 4;
  return { bin, steps, mult: PLINKO_BINS[bin] };
}
export const plinkoPayout = (mult, bet) => Math.round(Number(bet) * mult * 1e8) / 1e8;

// ---- Slots ----
export const SLOT_SYMBOLS = ['7', '★', '♦', '', '♥'];
export function slotSpin(rand = Math.random) {
  return [0, 1, 2].map(() => SLOT_SYMBOLS[(rand() * SLOT_SYMBOLS.length) | 0]);
}
// returns multiplier
export function slotMult(reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) {
    if (a === '') return 0;                       // three blanks pay nothing
    if (a === '7') return 25;
    if (a === '★') return 12;
    return 8;
  }
  const pair = (x, y) => x !== '' && x === y;
  if (pair(a, b) || pair(b, c) || pair(a, c)) return 2;
  return 0;
}
export const slotPayout = (reels, bet) => Math.round(Number(bet) * slotMult(reels) * 1e8) / 1e8;

// ---- Dice: bet under / exactly / over 7 ----
export const DICE_CHOICES = ['under', 'seven', 'over'];
export function diceRoll(rand = Math.random) {
  return [1 + ((rand() * 6) | 0), 1 + ((rand() * 6) | 0)];
}
export function diceMult(choice, total) {
  if (choice === 'seven') return total === 7 ? 5 : 0;
  if (choice === 'under') return total < 7 ? 2 : 0;
  return total > 7 ? 2 : 0;
}
export const dicePayout = (choice, total, bet) => Math.round(Number(bet) * diceMult(choice, total) * 1e8) / 1e8;

// ---- Heads and Tails ----
export const COIN_SIDES = ['heads', 'tails'];
export const coinFlip = (rand = Math.random) => COIN_SIDES[rand() < 0.5 ? 0 : 1];
export function coinMult(choice, side) { return choice === side ? 2 : 0; }
export const coinPayout = (choice, side, bet) => Math.round(Number(bet) * coinMult(choice, side) * 1e8) / 1e8;
