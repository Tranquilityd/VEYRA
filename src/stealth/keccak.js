// Veyra — Phase 3: keccak-256 (Ethereum variant) for the private-transfer stack.
//
// WHY THIS FILE EXISTS
// The Veyra browser bundle is served as plain ES modules with no bundler and no
// CDN imports (see `scripts/build-static.js`, which copies `src/` verbatim and
// `index.html`, which loads `src/main.js` directly). The stealth-address
// derivation therefore cannot import `viem` client-side. This module provides
// keccak-256 with the Ethereum padding rule (0x01 … 0x80, rate 1088 bits) so the
// derivation in `src/stealth/derive.js` runs with zero third-party dependencies
// in the browser while remaining byte-identical to `viem`'s `keccak256` and
// `@noble/hashes` — both are asserted in `test/private-transfer-crypto.test.js`.
//
// SECURITY: this is a public hash function. It never receives private keys; the
// caller hashes ECDH shared points and public encodings only.

/** Round constants for Keccak-f[1600] (24 rounds), as 64-bit lanes. */
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

/** Rotation offsets, indexed [x][y]. */
const RHO = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

const MASK = (1n << 64n) - 1n;
const RATE = 136; // bytes: 1088-bit rate for keccak-256

const rotl = (lane, shift) => {
  const s = BigInt(shift % 64);
  if (s === 0n) return lane & MASK;
  return ((lane << s) | (lane >> (64n - s))) & MASK;
};

/** Keccak-f[1600] permutation over 25 lanes held in a flat x + 5y array. */
function permute(a) {
  for (let round = 0; round < 24; round += 1) {
    // theta
    const c = new Array(5);
    for (let x = 0; x < 5; x += 1) {
      c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
    }
    const d = new Array(5);
    for (let x = 0; x < 5; x += 1) d[x] = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) a[x + 5 * y] = (a[x + 5 * y] ^ d[x]) & MASK;
    }
    // rho + pi
    const b = new Array(25);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[x + 5 * y], RHO[x][y]);
      }
    }
    // chi
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        a[x + 5 * y] = (b[x + 5 * y] ^ ((~b[((x + 1) % 5) + 5 * y] & MASK) & b[((x + 2) % 5) + 5 * y])) & MASK;
      }
    }
    // iota
    a[0] = (a[0] ^ RC[round]) & MASK;
  }
}

const bytesToLanes = (state, block, offset) => {
  for (let i = 0; i < RATE / 8; i += 1) {
    let lane = 0n;
    for (let j = 7; j >= 0; j -= 1) lane = (lane << 8n) | BigInt(block[offset + i * 8 + j]);
    state[i] = (state[i] ^ lane) & MASK;
  }
};

const lanesToBytes = (state, out, offset, length) => {
  for (let i = 0; i < length; i += 1) {
    out[offset + i] = Number((state[i >> 3] >> BigInt(8 * (i & 7))) & 0xffn);
  }
};

/**
 * keccak256 of a byte array. Mirrors `viem.keccak256` exactly (Ethereum padding).
 * @param {Uint8Array} input
 * @returns {Uint8Array} 32-byte digest
 */
export function keccak256Bytes(input) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const state = new Array(25).fill(0n);

  let offset = 0;
  while (offset + RATE <= data.length) {
    bytesToLanes(state, data, offset);
    permute(state);
    offset += RATE;
  }

  // Final block: pad with 0x01 (Ethereum/Keccak, not SHA-3's 0x06) … 0x80.
  const tail = new Uint8Array(RATE);
  tail.set(data.subarray(offset));
  tail[data.length - offset] ^= 0x01;
  tail[RATE - 1] ^= 0x80;
  bytesToLanes(state, tail, 0);
  permute(state);

  const digest = new Uint8Array(32);
  lanesToBytes(state, digest, 0, 32);
  return digest;
}

const HEX = '0123456789abcdef';

/** Lowercase 0x-prefixed hex. */
export function bytesToHex(bytes) {
  let out = '0x';
  for (const byte of bytes) out += HEX[byte >> 4] + HEX[byte & 0x0f];
  return out;
}

/** Accepts 0x-prefixed or bare hex; throws on malformed input. */
export function hexToBytes(value) {
  const text = typeof value === 'string' && value.startsWith('0x') ? value.slice(2) : String(value ?? '');
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) throw new Error('INVALID_HEX');
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** keccak256 over a UTF-8 string. */
export function keccak256Utf8(text) {
  return keccak256Bytes(new TextEncoder().encode(String(text)));
}

/** keccak256 returning 0x-prefixed hex. */
export function keccak256Hex(input) {
  const bytes = typeof input === 'string' ? keccak256Utf8(input) : keccak256Bytes(input);
  return bytesToHex(bytes);
}
