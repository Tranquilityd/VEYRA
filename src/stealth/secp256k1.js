// Veyra — Phase 3: minimal, dependency-free secp256k1 arithmetic.
//
// WHY THIS FILE EXISTS
// The browser bundle has no bundler (see `scripts/build-static.js`), so the
// client-side stealth derivation cannot import `@noble/curves`. This module
// implements exactly the curve operations the ERC-5564 scheme-1 path needs:
// point decompression, addition, scalar multiplication, serialization and
// validity checks. Node tests cross-verify every operation against
// `@noble/curves` in `test/private-transfer-crypto.test.js`; the implementation
// is not trusted on its own.
//
// SCOPE / SECURITY
//   - No key generation policy lives here: callers supply scalars.
//   - No private material is stored, cached or logged by this module.
//   - Scalar multiplication is variable-time; this is a client-side wallet
//     library, not a smart-card hardening target. The one place where timing
//     could matter (signing) is delegated to the user's wallet, never done here.

/** Field prime p = 2^256 − 2^32 − 977. */
export const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
/** Group order n. */
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const A = 0n;
const B = 7n;
/** Generator coordinates. */
export const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
export const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

const mod = (value, m = P) => ((value % m) + m) % m;

/** Modular inverse via Fermat's little theorem (p is prime). */
export function modInverse(value, m = P) {
  let base = mod(value, m);
  if (base === 0n) throw new Error('INVERSE_OF_ZERO');
  let exponent = m - 2n;
  let result = 1n;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % m;
    base = (base * base) % m;
    exponent >>= 1n;
  }
  return result;
}

/** Point at infinity is represented as `null` throughout this module. */
export const isInfinity = (point) => point === null;
export const pointEquals = (a, b) => {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
};

export const isOnCurve = (point) => {
  if (point === null) return true;
  if (typeof point.x !== 'bigint' || typeof point.y !== 'bigint') return false;
  if (point.x < 0n || point.x >= P || point.y < 0n || point.y >= P) return false;
  return mod(point.y * point.y - (point.x * point.x * point.x + A * point.x + B)) === 0n;
};

/** Negation: (x, y) -> (x, p − y). */
export const negate = (point) => (point === null ? null : { x: point.x, y: mod(-point.y) });

/** Affine addition (used for the single P_spend + h·G step and small helpers). */
export function pointAdd(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  if (a.x === b.x && mod(a.y + b.y) === 0n) return null;
  let lambda;
  if (a.x === b.x && a.y === b.y) {
    if (a.y === 0n) return null;
    lambda = mod((3n * a.x * a.x + A) * modInverse(2n * a.y));
  } else {
    lambda = mod((b.y - a.y) * modInverse(b.x - a.x));
  }
  const x3 = mod(lambda * lambda - a.x - b.x);
  const y3 = mod(lambda * (a.x - x3) - a.y);
  return { x: x3, y: y3 };
}

/* ------------------------------------------------------------------ Jacobian */
// Scalar multiplication uses Jacobian coordinates so a 256-bit multiplication
// costs one modular inversion instead of ~256.
const jacobianDouble = ([x, y, z]) => {
  if (z === 0n || y === 0n) return [0n, 0n, 0n];
  const xx = (x * x) % P;
  const yy = (y * y) % P;
  const yyyy = (yy * yy) % P;
  const zz = (z * z) % P;
  const s = mod(2n * (mod((x + yy) * (x + yy)) - xx - yyyy));
  const m = mod(3n * xx);
  const t = mod(m * m - 2n * s);
  const x3 = t;
  const y3 = mod(m * (s - t) - 8n * yyyy);
  const z3 = mod(mod((y + z) * (y + z)) - yy - zz);
  return [x3, y3, z3];
};

const jacobianAddAffine = ([x1, y1, z1], point) => {
  if (z1 === 0n) return [point.x, point.y, 1n];
  const z1z1 = (z1 * z1) % P;
  const u2 = (point.x * z1z1) % P;
  const s2 = (point.y * z1 * z1z1) % P;
  if (u2 === x1 % P && s2 === y1 % P) return jacobianDouble([x1, y1, z1]);
  const h = mod(u2 - x1);
  const i = (4n * h * h) % P;
  const j = (h * i) % P;
  const r = mod(2n * (s2 - y1));
  const v = (x1 * i) % P;
  const x3 = mod(r * r - j - 2n * v);
  const y3 = mod(r * (v - x3) - 2n * y1 * j);
  const z3 = mod(mod((z1 + h) * (z1 + h)) - z1z1 - h * h);
  return [x3, y3, z3];
};

const jacobianToAffine = ([x, y, z]) => {
  if (z === 0n) return null;
  const zinv = modInverse(z);
  const zinv2 = (zinv * zinv) % P;
  return { x: mod(x * zinv2), y: mod(y * zinv2 * zinv) };
};

/**
 * k·point. `point` defaults to G. k is reduced mod n first; k ≡ 0 yields null.
 */
export function scalarMultiply(k, point = { x: GX, y: GY }) {
  const scalar = mod(k, N);
  if (scalar === 0n) return null;
  if (point === null) return null;
  // FAIL CLOSED: an off-curve "point" must never be multiplied. Every point that
  // reaches the stealth derivation is decoded by `decompressPoint` (which validates),
  // but this guard keeps a future caller from turning garbage into a plausible-looking
  // key (Phase 3.5 finding L-01). The generator skips the check (it is on the curve).
  if (point !== GENERATOR && !isOnCurve(point)) throw new Error('POINT_NOT_ON_CURVE');
  let acc = [0n, 1n, 0n];
  const bits = scalar.toString(2);
  for (const bit of bits) {
    acc = jacobianDouble(acc);
    if (bit === '1') acc = jacobianAddAffine(acc, point);
  }
  return jacobianToAffine(acc);
}

const GENERATOR = Object.freeze({ x: GX, y: GY });

/** Generator multiplication shorthand. */
export const multiplyG = (k) => scalarMultiply(k, GENERATOR);

/* ------------------------------------------------------------------ encoding */
/** Compressed 33-byte encoding (prefix 02 for even y, 03 for odd y). */
export function compressPoint(point) {
  if (point === null) throw new Error('CANNOT_COMPRESS_INFINITY');
  const prefix = point.y % 2n === 0n ? 0x02 : 0x03;
  const hex = point.x.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(33);
  bytes[0] = prefix;
  for (let i = 0; i < 32; i += 1) bytes[i + 1] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Uncompressed 65-byte encoding (0x04 ‖ x ‖ y). */
export function uncompressedBytes(point) {
  if (point === null) throw new Error('CANNOT_ENCODE_INFINITY');
  const out = new Uint8Array(65);
  out[0] = 0x04;
  const x = point.x.toString(16).padStart(64, '0');
  const y = point.y.toString(16).padStart(64, '0');
  for (let i = 0; i < 32; i += 1) {
    out[i + 1] = parseInt(x.slice(i * 2, i * 2 + 2), 16);
    out[i + 33] = parseInt(y.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Decode a 33-byte compressed point (also accepts 65-byte uncompressed).
 * Throws on wrong length, bad prefix, off-curve x, or non-residue.
 */
export function decompressPoint(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length === 65) {
    if (data[0] !== 0x04) throw new Error('INVALID_POINT_PREFIX');
    const x = BigInt('0x' + BufferLike.hex(data.subarray(1, 33)));
    const y = BigInt('0x' + BufferLike.hex(data.subarray(33, 65)));
    const point = { x, y };
    if (!isOnCurve(point)) throw new Error('POINT_NOT_ON_CURVE');
    return point;
  }
  if (data.length !== 33) throw new Error('INVALID_POINT_LENGTH');
  const prefix = data[0];
  if (prefix !== 0x02 && prefix !== 0x03) throw new Error('INVALID_POINT_PREFIX');
  const x = BigInt('0x' + BufferLike.hex(data.subarray(1)));
  if (x >= P) throw new Error('POINT_NOT_ON_CURVE');
  const ySquared = mod(x * x * x + A * x + B);
  if (ySquared === 0n) {
    if (prefix !== 0x02) throw new Error('POINT_NOT_ON_CURVE');
    return { x, y: 0n };
  }
  // sqrt via the p ≡ 3 (mod 4) shortcut: y = (y²)^((p+1)/4)
  let y = modPow(ySquared, (P + 1n) / 4n);
  if (mod(y * y) !== ySquared) throw new Error('POINT_NOT_ON_CURVE');
  if ((y % 2n === 0n ? 0x02 : 0x03) !== prefix) y = mod(-y);
  return { x, y };
}

function modPow(base, exponent) {
  let result = 1n;
  let b = mod(base);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

const BufferLike = {
  hex(view) {
    let out = '';
    for (const byte of view) out += byte.toString(16).padStart(2, '0');
    return out;
  },
};

/**
 * Recover the y coordinate for a given x and parity (02 ⇒ even, 03 ⇒ odd).
 * Shared by point decompression and ECDSA public-key recovery.
 */
export function pointFromX(x, odd) {
  if (typeof x !== 'bigint' || x < 0n || x >= P) throw new Error('POINT_NOT_ON_CURVE');
  const ySquared = mod(x * x * x + A * x + B);
  if (ySquared === 0n) return { x, y: 0n };
  let y = modPow(ySquared, (P + 1n) / 4n);
  if (mod(y * y) !== ySquared) throw new Error('POINT_NOT_ON_CURVE');
  if ((y % 2n === 1n) !== Boolean(odd)) y = mod(-y);
  return { x, y };
}

/**
 * ECDSA public-key recovery (SEC 1 §4.1.6). Used by the SERVER to prove that an
 * enrollment signature was produced by the wallet that owns a `.veyra` username —
 * the backend must never accept a meta-address on the client's word alone.
 *
 * @param {{r:bigint, s:bigint, recovery:number, hash:(bigint|string|Uint8Array)}} params
 * @returns {{x:bigint,y:bigint}} the signing public key
 */
export function recoverPublicKey({ r, s, recovery, hash }) {
  const recid = Number(recovery);
  if (![0, 1, 2, 3].includes(recid)) throw new Error('INVALID_RECOVERY_ID');
  const R = BigInt(r);
  const S = BigInt(s);
  if (R <= 0n || R >= N || S <= 0n || S >= N) throw new Error('INVALID_SIGNATURE_VALUES');

  let hashValue;
  if (typeof hash === 'bigint') hashValue = hash;
  else if (typeof hash === 'string') hashValue = BigInt(hash.startsWith('0x') || hash.startsWith('0X') ? hash : `0x${hash}`);
  else hashValue = BigInt(`0x${bytesToHexLoose(hash)}`);
  const e = mod(hashValue, N);

  const x = R + (recid >= 2 ? N : 0n);
  const Rpoint = pointFromX(x, (recid & 1) === 1);
  // nR must be the point at infinity for a valid recovery
  if (scalarMultiply(N, Rpoint) !== null) throw new Error('INVALID_SIGNATURE_POINT');

  const rInv = modInverse(R, N);
  const sR = scalarMultiply(S, Rpoint);
  const eG = multiplyG(e);
  const Q = scalarMultiply(rInv, pointAdd(sR, negate(eG)));
  if (Q === null) throw new Error('INVALID_SIGNATURE_POINT');
  return Q;
}

/** Address derived from a recoverable signature (EIP-191 already applied by caller). */
export function addressFromSignature({ r, s, recovery, hash, keccak }) {
  const point = recoverPublicKey({ r, s, recovery, hash });
  if (typeof keccak !== 'function') throw new Error('KECCAK_REQUIRED');
  return addressFromPoint(point, keccak);
}

const bytesToHexLoose = (bytes) => {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
};

/** Address rule pinned by Phase 2D.3 #5: keccak256(uncompressed x‖y)[12:]. */
export function addressFromPoint(point, keccak256Bytes) {
  const uncompressed = uncompressedBytes(point);
  const hash = keccak256Bytes(uncompressed.subarray(1));
  return '0x' + BufferLike.hex(hash.subarray(12));
}

/** Random non-zero scalar in [1, n−1) from a CSPRNG. */
export function randomScalar(cryptoSource = globalThis.crypto) {
  if (!cryptoSource?.getRandomValues) throw new Error('SECURE_RANDOM_UNAVAILABLE');
  for (;;) {
    const bytes = new Uint8Array(32);
    cryptoSource.getRandomValues(bytes);
    const value = BigInt('0x' + BufferLike.hex(bytes));
    if (value > 0n && value < N) return value;
  }
}

/** Scalar as 32-byte big-endian hex (0x-prefixed). */
export const scalarToHex = (scalar) => '0x' + scalar.toString(16).padStart(64, '0');
