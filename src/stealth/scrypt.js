// Veyra — Phase 3: scrypt (RFC 7914), self-contained for the browser bundle.
//
// WHY THIS FILE EXISTS
// `crypto.subtle` (WebCrypto) has no memory-hard KDF, and the browser bundle has
// no bundler, so `@noble/hashes/scrypt` is not importable client-side. Phase 2D.8
// requires the encrypted identity backup to be keyed with a memory-hard KDF
// (Argon2id or scrypt) — this is that scrypt, implemented with SHA-256, HMAC,
// PBKDF2, Salsa20/8 and ROMix.
//
// VERIFICATION: `test/private-transfer-backup.test.js` checks this
// implementation against Node's native `node:crypto` scrypt (an independent
// implementation) for several parameter sets and password/salt shapes. The
// implementation is not trusted on its own.
//
// SECURITY: only passphrases and salts pass through here. Plaintext private keys
// never touch this module; callers hand the derived key straight to AES-GCM.

/* ------------------------------------------------------------------ SHA-256 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr32 = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
// Salsa20's R(a,b) is a LEFT rotation. Distinct from the SHA-256 helper above.
const rotl32 = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

export function sha256Bytes(input) {
  const msg = input instanceof Uint8Array ? input : new Uint8Array(input);
  const bitLength = msg.length * 8;
  // message ‖ 0x80 ‖ zero padding ‖ 64-bit length, rounded up to a 64-byte block
  const padded = new Uint8Array((((msg.length + 9 + 63) >> 6) << 6));
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((value, index) => outView.setUint32(index * 4, value));
  return out;
}

/* ------------------------------------------------------------------ HMAC + PBKDF2 */
export function hmacSha256(key, message) {
  const blockKey = new Uint8Array(64);
  const normalized = key.length > 64 ? sha256Bytes(key) : key;
  blockKey.set(normalized);
  const inner = new Uint8Array(64 + message.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i += 1) {
    inner[i] = blockKey[i] ^ 0x36;
    outer[i] = blockKey[i] ^ 0x5c;
  }
  inner.set(message, 64);
  outer.set(sha256Bytes(inner), 64);
  return sha256Bytes(outer);
}

export function pbkdf2Sha256(password, salt, iterations, keyLength) {
  const blocks = Math.ceil(keyLength / 32);
  const output = new Uint8Array(blocks * 32);
  const block = new Uint8Array(salt.length + 4);
  block.set(salt);
  const blockView = new DataView(block.buffer);
  for (let i = 1; i <= blocks; i += 1) {
    blockView.setUint32(salt.length, i);
    let u = hmacSha256(password, block);
    const accumulator = Uint8Array.from(u);
    for (let iteration = 1; iteration < iterations; iteration += 1) {
      u = hmacSha256(password, u);
      for (let j = 0; j < 32; j += 1) accumulator[j] ^= u[j];
    }
    output.set(accumulator, (i - 1) * 32);
  }
  return output.subarray(0, keyLength);
}

/* ------------------------------------------------------------------ Salsa20/8 */
export function salsa208Core(block, out) {
  const x = new Uint32Array(16);
  for (let i = 0; i < 16; i += 1) x[i] = block[i];
  const original = Uint32Array.from(x);
  for (let round = 0; round < 8; round += 1) {
    if (round % 2 === 0) {
      x[4] ^= rotl32((x[0] + x[12]) >>> 0, 7); x[8] ^= rotl32((x[4] + x[0]) >>> 0, 9);
      x[12] ^= rotl32((x[8] + x[4]) >>> 0, 13); x[0] ^= rotl32((x[12] + x[8]) >>> 0, 18);
      x[9] ^= rotl32((x[5] + x[1]) >>> 0, 7); x[13] ^= rotl32((x[9] + x[5]) >>> 0, 9);
      x[1] ^= rotl32((x[13] + x[9]) >>> 0, 13); x[5] ^= rotl32((x[1] + x[13]) >>> 0, 18);
      x[14] ^= rotl32((x[10] + x[6]) >>> 0, 7); x[2] ^= rotl32((x[14] + x[10]) >>> 0, 9);
      x[6] ^= rotl32((x[2] + x[14]) >>> 0, 13); x[10] ^= rotl32((x[6] + x[2]) >>> 0, 18);
      x[3] ^= rotl32((x[15] + x[11]) >>> 0, 7); x[7] ^= rotl32((x[3] + x[15]) >>> 0, 9);
      x[11] ^= rotl32((x[7] + x[3]) >>> 0, 13); x[15] ^= rotl32((x[11] + x[7]) >>> 0, 18);
    } else {
      x[1] ^= rotl32((x[0] + x[3]) >>> 0, 7); x[2] ^= rotl32((x[1] + x[0]) >>> 0, 9);
      x[3] ^= rotl32((x[2] + x[1]) >>> 0, 13); x[0] ^= rotl32((x[3] + x[2]) >>> 0, 18);
      x[6] ^= rotl32((x[5] + x[4]) >>> 0, 7); x[7] ^= rotl32((x[6] + x[5]) >>> 0, 9);
      x[4] ^= rotl32((x[7] + x[6]) >>> 0, 13); x[5] ^= rotl32((x[4] + x[7]) >>> 0, 18);
      x[11] ^= rotl32((x[10] + x[9]) >>> 0, 7); x[8] ^= rotl32((x[11] + x[10]) >>> 0, 9);
      x[9] ^= rotl32((x[8] + x[11]) >>> 0, 13); x[10] ^= rotl32((x[9] + x[8]) >>> 0, 18);
      x[12] ^= rotl32((x[15] + x[14]) >>> 0, 7); x[13] ^= rotl32((x[12] + x[15]) >>> 0, 9);
      x[14] ^= rotl32((x[13] + x[12]) >>> 0, 13); x[15] ^= rotl32((x[14] + x[13]) >>> 0, 18);
    }
  }
  for (let i = 0; i < 16; i += 1) out[i] = (x[i] + original[i]) >>> 0;
}

/* ------------------------------------------------------------------ ROMix + scrypt */
export const blockMix = (input, r, out) => {
  const x = new Uint32Array(16);
  const y = new Uint32Array(32 * r); // 2r blocks x 16 words
  for (let i = 0; i < 16; i += 1) x[i] = input[(2 * r - 1) * 16 + i];
  for (let i = 0; i < 2 * r; i += 1) {
    for (let j = 0; j < 16; j += 1) x[j] = (x[j] ^ input[i * 16 + j]) >>> 0;
    salsa208Core(x, x);
    y.set(x, i * 16);
  }
  // B' = (Y0, Y2, …, Y2r−2, Y1, Y3, …, Y2r−1): even blocks first, then odd blocks.
  for (let i = 0; i < r; i += 1) {
    out.set(y.subarray(32 * i, 32 * i + 16), i * 16);
    out.set(y.subarray(32 * i + 16, 32 * i + 32), (i + r) * 16);
  }
};

/**
 * scrypt key derivation (RFC 7914).
 * @param {Uint8Array|string} password
 * @param {Uint8Array|string} salt
 * @param {{N?:number,r?:number,p?:number,dkLen?:number,maxmem?:number}} [options]
 * @returns {Uint8Array} derived key
 */
export function scrypt(password, salt, options = {}) {
  const N = options.N ?? 1 << 15;
  const r = options.r ?? 8;
  const p = options.p ?? 1;
  const dkLen = options.dkLen ?? 32;
  if (!Number.isInteger(N) || N < 2 || (N & (N - 1)) !== 0) throw new Error('SCRYPT_INVALID_N');
  if (!Number.isInteger(r) || r < 1 || !Number.isInteger(p) || p < 1) throw new Error('SCRYPT_INVALID_PARAMS');
  if (dkLen < 1 || dkLen > 1024) throw new Error('SCRYPT_INVALID_KEYLEN');

  const passwordBytes = typeof password === 'string' ? new TextEncoder().encode(password) : password;
  const saltBytes = typeof salt === 'string' ? new TextEncoder().encode(salt) : salt;
  const memory = 128 * N * r + 128 * r * p;
  if (options.maxmem && memory > options.maxmem) throw new Error('SCRYPT_MEMORY_LIMIT');

  const b = pbkdf2Sha256(passwordBytes, saltBytes, 1, p * 128 * r);

  for (let i = 0; i < p; i += 1) {
    const x = new Uint32Array(32 * r); // one 128*r-byte lane block in words
    const scratch = new Uint32Array(32 * r);
    // 128*r bytes per lane block == 32*r 32-bit words.
    const words = new Uint32Array(b.buffer, b.byteOffset + i * 128 * r, 32 * r);
    x.set(words);
    const v = new Uint32Array(N * 32 * r);
    for (let j = 0; j < N; j += 1) {
      v.set(x, j * 32 * r);
      blockMix(x, r, scratch);
      x.set(scratch);
    }
    for (let j = 0; j < N; j += 1) {
      // Integerify(X): little-endian integer from the first 8 bytes of the last 64-byte
      // block. N is a power of two ≤ 2^32, so the low word alone determines j mod N.
      const integerify = x[(2 * r - 1) * 16] % N;
      const offset = integerify * 32 * r;
      for (let k = 0; k < 32 * r; k += 1) x[k] = (x[k] ^ v[offset + k]) >>> 0;
      blockMix(x, r, scratch);
      x.set(scratch);
    }
    for (let k = 0; k < 32 * r; k += 1) words[k] = x[k];
  }

  return pbkdf2Sha256(passwordBytes, b, 1, dkLen);
}

/** Fixed production parameters for the identity backup KDF. */
export const BACKUP_SCRYPT_PARAMS = Object.freeze({ N: 1 << 15, r: 8, p: 1, dkLen: 32 });
