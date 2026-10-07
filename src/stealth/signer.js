// Veyra — Phase 3: local ECDSA signing + native-transaction serialization.
//
// WHY THIS EXISTS
// A stealth address is an EOA controlled by a key Veyra derives locally
// (`p_stealth = p_spend + h`). No browser wallet holds that key, so the spend path
// (Phase 2D.6/§33, brief §11) must sign locally and broadcast a raw transaction:
//   S (stealth) ──native zkLTC──▶ fresh destination T
// The user's wallet is used only as an RPC/broadcast channel (`eth_sendRawTransaction`).
//
// SCOPE
//   - RFC 6979 deterministic ECDSA over secp256k1, low-s normalised, with the
//     recovery id needed by Ethereum.
//   - RLP + EIP-155 legacy and EIP-1559 (type 2) native-transfer serialization.
// Cross-verified against `viem` in `test/private-transfer-signer.test.js`
// (signature and full raw-transaction bytes) — never trusted on its own.
//
// SECURITY: this is the only module that holds a raw private scalar for signing.
// It keeps it in a local variable, never logs it, and returns only public artifacts
// (signature parts / signed payload).
import { keccak256Bytes, hexToBytes, bytesToHex } from './keccak.js';
import { N, P, multiplyG, modInverse, scalarToHex } from './secp256k1.js';
import { hmacSha256 } from './scrypt.js';

/* ------------------------------------------------------------------ RFC 6979 */
const int2octets = (value) => hexToBytes(scalarToHex(value));
const bits2int = (bytes) => {
  const value = BigInt(bytesToHex(bytes));
  const excess = bytes.length * 8 - 256;
  return excess > 0 ? value >> BigInt(excess) : value;
};
const bits2octets = (bytes) => {
  const z = bits2int(bytes) % N;
  return int2octets(z);
};

/**
 * RFC 6979 nonce generator (§3.2 steps b–h).
 *
 * The generator keeps the HMAC state so that a rejected candidate (r = 0 or s = 0,
 * astronomically unlikely but specified) advances exactly as the RFC requires:
 * `K = HMAC_K(V ‖ 0x00)`, `V = HMAC_K(V)`, then generate again. Incrementing k
 * instead — as an earlier revision did — is not RFC 6979 (Phase 3.5 finding I-01).
 */
function createNonceGenerator(privateKey, hashBytes) {
  let v = new Uint8Array(32).fill(0x01);
  let k = new Uint8Array(32).fill(0x00);
  const x = int2octets(privateKey);
  const h = bits2octets(hashBytes);
  k = hmacSha256(k, concatBytes(v, Uint8Array.of(0x00), x, h));
  v = hmacSha256(k, v);
  k = hmacSha256(k, concatBytes(v, Uint8Array.of(0x01), x, h));
  v = hmacSha256(k, v);

  const generate = () => {
    let t = new Uint8Array(0);
    while (t.length < 32) {
      v = hmacSha256(k, v);
      t = concatBytes(t, v);
    }
    const candidate = bits2int(t.subarray(0, 32));
    return candidate > 0n && candidate < N ? candidate : null;
  };
  const advance = () => { // RFC 6979 §3.2 h1–h3: K = HMAC_K(V ‖ 0x00); V = HMAC_K(V)
    k = hmacSha256(k, concatBytes(v, Uint8Array.of(0x00)));
    v = hmacSha256(k, v);
  };

  return () => {
    for (let attempt = 0; attempt < 1024; attempt += 1) {
      const candidate = generate();
      if (candidate !== null) return candidate;
      advance();
    }
    throw new Error('NONCE_GENERATION_FAILED');
  };
}

/**
 * Deterministic ECDSA over a 32-byte digest.
 * @param {bigint} privateKey
 * @param {Uint8Array|string} digest 32-byte signing hash
 * @returns {{r:bigint,s:bigint,recovery:number}}
 */
export function signDigest(privateKey, digest) {
  const key = BigInt(privateKey);
  if (key <= 0n || key >= N) throw new Error('INVALID_PRIVATE_KEY');
  const hashBytes = typeof digest === 'string' ? hexToBytes(digest) : digest;
  if (hashBytes.length !== 32) throw new Error('INVALID_DIGEST');

  const z = bits2int(hashBytes) % N;
  const nextNonce = createNonceGenerator(key, hashBytes);

  for (let attempt = 0; attempt < 1024; attempt += 1) {
    const k = nextNonce();
    const point = multiplyG(k);
    if (point === null) throw new Error('SIGNING_POINT_AT_INFINITY');
    const r = point.x % N;
    if (r !== 0n) {
      let s = (modInverse(k, N) * (z + r * key)) % N;
      if (s !== 0n) {
        let recovery = (point.y % 2n === 1n ? 1 : 0) | (point.x >= N ? 2 : 0);
        if (s > N / 2n) {
          s = N - s; // low-s (EIP-2)
          recovery ^= 1;
        }
        return { r, s, recovery };
      }
    }
    // r or s was zero: loop back into the RFC 6979 generator (new candidate).
  }
  throw new Error('SIGNING_FAILED');
}

/** Address for a private scalar (keccak256(uncompressed x‖y)[12:]). */
export function addressForPrivateKey(privateKey) {
  const point = multiplyG(BigInt(privateKey));
  if (point === null) throw new Error('INVALID_PRIVATE_KEY');
  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  const x = point.x.toString(16).padStart(64, '0');
  const y = point.y.toString(16).padStart(64, '0');
  for (let i = 0; i < 32; i += 1) {
    uncompressed[i + 1] = parseInt(x.slice(i * 2, i * 2 + 2), 16);
    uncompressed[i + 33] = parseInt(y.slice(i * 2, i * 2 + 2), 16);
  }
  return '0x' + bytesToHex(keccak256Bytes(uncompressed.subarray(1))).slice(26);
}

/* ------------------------------------------------------------------ RLP */
const toBytes = (value) => {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') {
    const bare = value.replace(/^0x/i, '');
    return hexToBytes('0x' + (bare.length % 2 === 0 ? bare : '0' + bare));
  }
  if (typeof value === 'bigint') {
    if (value === 0n) return new Uint8Array(0);
    return hexToBytes('0x' + value.toString(16).padStart(2 * Math.ceil(value.toString(16).length / 2), '0'));
  }
  if (typeof value === 'number') return toBytes(BigInt(value));
  throw new Error('RLP_UNSUPPORTED_VALUE');
};

export function rlpEncode(value) {
  if (Array.isArray(value)) {
    const encoded = value.map(rlpEncode);
    const payload = concatBytes(...encoded);
    return concatBytes(encodeLength(payload.length, 0xc0), payload);
  }
  const bytes = toBytes(value);
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  return concatBytes(encodeLength(bytes.length, 0x80), bytes);
}

const encodeLength = (length, offset) => {
  if (length < 56) return Uint8Array.of(offset + length);
  const hex = length.toString(16);
  const bytes = hexToBytes('0x' + (hex.length % 2 === 0 ? hex : '0' + hex));
  return concatBytes(Uint8Array.of(offset + 55 + bytes.length), bytes);
};

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

/* ------------------------------------------------------------------ transactions */
/**
 * Sign a native zkLTC transfer, returning the raw typed-transaction hex.
 *
 * Gas parameters are ALWAYS supplied by the caller (read from the network), never
 * hard-coded — see brief §8.
 *
 * @param {{privateKey:bigint, to:string, value:(bigint|string|number), nonce:(bigint|number),
 *          gasLimit:(bigint|number), maxFeePerGas?:bigint, maxPriorityFeePerGas?:bigint,
 *          gasPrice?:bigint, chainId:number, type?:1|2, data?:string}} tx
 * @returns {{raw:string, hash:string, type:number}}
 */
export function signNativeTransfer(tx) {
  const chainId = BigInt(tx.chainId);
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(tx.to ?? ''))) throw new Error('INVALID_RECIPIENT');
  const value = BigInt(tx.value ?? 0);
  if (value <= 0n) throw new Error('AMOUNT_INVALID');
  const data = toBytes(tx.data ?? '0x');

  // Accept `'legacy'` / 0 / a gasPrice-only request for EIP-155 legacy; everything
  // else must be a complete EIP-1559 request. Gas values themselves are always
  // supplied by the caller from the network.
  const wantsLegacy = tx.type === 'legacy' || Number(tx.type) === 0 || Number(tx.type) === 1
    || (tx.maxFeePerGas === undefined && tx.gasPrice !== undefined);
  if (!wantsLegacy && (tx.maxFeePerGas === undefined || tx.maxPriorityFeePerGas === undefined)) {
    throw new Error('GAS_PARAMETERS_REQUIRED');
  }

  if (wantsLegacy) {
    const gasPrice = BigInt(tx.gasPrice);
    const unsigned = [
      BigInt(tx.nonce), gasPrice, BigInt(tx.gasLimit), tx.to, value, data, chainId, 0n, 0n,
    ];
    const digest = keccak256Bytes(rlpEncode(unsigned));
    const { r, s, recovery } = signDigest(BigInt(tx.privateKey), digest);
    const v = chainId * 2n + 35n + BigInt(recovery);
    const signed = [BigInt(tx.nonce), gasPrice, BigInt(tx.gasLimit), tx.to, value, data, v, r, s];
    const raw = bytesToHex(rlpEncode(signed));
    return { raw, hash: bytesToHex(keccak256Bytes(hexToBytes(raw))), type: 0 };
  }

  const unsigned = [
    chainId, BigInt(tx.nonce), BigInt(tx.maxPriorityFeePerGas), BigInt(tx.maxFeePerGas),
    BigInt(tx.gasLimit), tx.to, value, data, [],
  ];
  const digest = keccak256Bytes(concatBytes(Uint8Array.of(0x02), rlpEncode(unsigned)));
  const { r, s, recovery } = signDigest(BigInt(tx.privateKey), digest);
  const signed = [
    chainId, BigInt(tx.nonce), BigInt(tx.maxPriorityFeePerGas), BigInt(tx.maxFeePerGas),
    BigInt(tx.gasLimit), tx.to, value, data, [], BigInt(recovery), r, s,
  ];
  const raw = bytesToHex(concatBytes(Uint8Array.of(0x02), rlpEncode(signed)));
  return { raw, hash: bytesToHex(keccak256Bytes(hexToBytes(raw))), type: 2 };
}

/** Broadcast a locally signed transaction through any EIP-1193 provider. */
export async function broadcastRawTransaction(provider, raw) {
  const hash = await provider.request({ method: 'eth_sendRawTransaction', params: [raw] });
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('TRANSACTION_REJECTED');
  return hash;
}

export { P, concatBytes };
