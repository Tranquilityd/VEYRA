// Veyra — Phase 3: wallet capability detection and native-transfer request building.
//
// WALLET CLASSES (Phase 2D.10). Veyra supports standard EOA wallets and refuses —
// with a clear message and no silent downgrade — everything that cannot produce a
// plain 65-byte secp256k1 signature:
//   - smart-contract / ERC-1271 / ERC-4337 accounts (no plain ECDSA signature, and
//     an EOA-style stealth address cannot be controlled by them)
//   - multisig accounts (not a single signature)
//   - wallets returning 64-byte compact (ERC-2098) signatures
// Detection uses code presence at the account address, which is the same signal the
// rest of the Veyra wallet stack already relies on.
//
// SAFETY: this module never signs anything by itself and never touches key material.
// It validates what came back from the wallet and never logs signatures.
import { CHAIN_ID, CHAIN_ID_HEX, ATOMIC_UNITS_PER_ZKLTC, NATIVE_DECIMALS } from './protocol.js';

export const WALLET_KINDS = Object.freeze({
  EOA: 'eoa',
  CONTRACT: 'contract',
  UNKNOWN: 'unknown',
});

export const UNSUPPORTED_WALLET_MESSAGE =
  'Private transfer identity setup is not supported by this wallet type yet.';

/** Decimal zkLTC string → atomic units. Integer arithmetic only (never floats). */
export function parseAmountToAtomic(text, { decimals = NATIVE_DECIMALS } = {}) {
  const value = String(text ?? '').trim();
  if (!/^\d*(\.\d*)?$/.test(value) || value === '' || value === '.') throw new Error('AMOUNT_INVALID');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('AMOUNT_TOO_MANY_DECIMALS');
  const atomic = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (atomic <= 0n) throw new Error('AMOUNT_INVALID');
  return atomic;
}

/** Atomic units → canonical decimal string (display only; never used for math). */
export function formatAtomic(atomic, { decimals = NATIVE_DECIMALS } = {}) {
  const value = BigInt(atomic);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * Funding check with an explicit gas reserve (§8, Phase 2D G01–G03).
 * The reserve is never hard-coded into a gas price: the wallet estimates that.
 */
export function checkFunding({ balanceAtomic, amountAtomic, gasReserveAtomic }) {
  const balance = BigInt(balanceAtomic ?? 0);
  const amount = BigInt(amountAtomic ?? 0);
  const reserve = BigInt(gasReserveAtomic ?? 0);
  if (amount <= 0n) return { ok: false, error: 'AMOUNT_INVALID' };
  if (balance < amount) return { ok: false, error: 'INSUFFICIENT_BALANCE' };
  if (balance - amount < reserve) return { ok: false, error: 'INSUFFICIENT_GAS' };
  return { ok: true, remainingAtomic: balance - amount };
}

/** Default reserve used by the UI when the wallet does not supply one. */
export const DEFAULT_GAS_RESERVE_ATOMIC = ATOMIC_UNITS_PER_ZKLTC / 1000n; // 0.001 zkLTC (Phase 2D)

/** Verify the wallet is on LiteForge before anything is built or signed. */
export async function assertChain(provider, expectedChainId = CHAIN_ID) {
  let hex;
  try {
    hex = await provider.request({ method: 'eth_chainId' });
  } catch {
    // Provider refused or unavailable: treat exactly like a wrong network so callers can
    // never proceed on an unknown chain (Phase 3.5 finding L-02).
    throw new Error('WRONG_NETWORK');
  }
  // A missing, non-string or unparsable chain id is a wrong network, never a raw
  // TypeError leaking out of BigInt().
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(hex)) throw new Error('WRONG_NETWORK');
  if (BigInt(hex) !== BigInt(expectedChainId)) throw new Error('WRONG_NETWORK');
  return true;
}

/** Which address the provider will sign for. */
export async function currentAddress(provider) {
  const accounts = await provider.request({ method: 'eth_accounts' });
  const address = Array.isArray(accounts) ? accounts[0] : null;
  if (!address) throw new Error('WALLET_DISCONNECTED');
  return address;
}

/** Contract code at the address ⇒ not an EOA ⇒ unsupported for stealth identity. */
export async function detectWalletKind(provider, address) {
  try {
    const code = await provider.request({ method: 'eth_getCode', params: [address, 'latest'] });
    if (typeof code === 'string' && code !== '0x' && code !== '0x0') return WALLET_KINDS.CONTRACT;
    return WALLET_KINDS.EOA;
  } catch {
    return WALLET_KINDS.UNKNOWN;
  }
}

/**
 * Full gate used by enrollment and by spend-from-stealth.
 * @returns {{supported:boolean, kind:string, address?:string, reason?:string, message?:string}}
 */
export async function assertSupportedWallet(provider) {
  const address = await currentAddress(provider);
  await assertChain(provider);
  const kind = await detectWalletKind(provider, address);
  if (kind === WALLET_KINDS.CONTRACT) {
    return { supported: false, kind, address, reason: 'UNSUPPORTED_ACCOUNT_TYPE', message: UNSUPPORTED_WALLET_MESSAGE };
  }
  if (kind === WALLET_KINDS.UNKNOWN) {
    return { supported: false, kind, address, reason: 'UNSUPPORTED_WALLET', message: UNSUPPORTED_WALLET_MESSAGE };
  }
  return { supported: true, kind, address };
}

/** A signature is usable for key derivation only in the standard 65-byte form. */
export function assertDerivableSignature(signature) {
  const bare = String(signature ?? '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]*$/.test(bare) || bare.length % 2 !== 0) return { ok: false, reason: 'SIGNATURE_REJECTED' };
  const bytes = bare.length / 2;
  if (bytes === 64) return { ok: false, reason: 'COMPACT_SIGNATURE_UNSUPPORTED', message: 'This wallet returned a compact (ERC-2098) signature. Veyra needs the standard 65-byte signature form.' };
  if (bytes !== 65) return { ok: false, reason: 'SIGNATURE_FORM_UNSUPPORTED', message: 'This wallet returned an unsupported signature format.' };
  return { ok: true };
}

/**
 * Build the native zkLTC transfer request. Veyra sets NO gas price or gas limit —
 * the wallet/provider estimates both (§8: do not hard-code gas assumptions).
 */
export function buildNativeTransferRequest({ from, to, amountAtomic, chainId = CHAIN_ID }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(to ?? ''))) throw new Error('INVALID_RECIPIENT');
  const value = BigInt(amountAtomic);
  if (value <= 0n) throw new Error('AMOUNT_INVALID');
  return {
    from,
    to,
    value: '0x' + value.toString(16),
    chainId: '0x' + BigInt(chainId).toString(16),
  };
}

/**
 * Send a native transfer and return its hash. The recipient is ALWAYS the fresh
 * stealth address produced by the derivation step — there is no code path here
 * that can substitute the recipient's normal wallet.
 */
export async function sendNativeTransfer(provider, request) {
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [request] });
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('TRANSACTION_REJECTED');
  return hash;
}

/** Wait for a receipt under an application confirmation policy. */
export async function waitForReceipt(provider, hash, { confirmations = 1, timeoutMs = 180_000, pollMs = 4_000 } = {}) {
  const started = Date.now();
  let receipt = null;
  while (Date.now() - started < timeoutMs) {
    try {
      receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] });
    } catch {
      throw new Error('RPC_FAILURE');
    }
    if (receipt) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  if (!receipt) throw new Error('TIMEOUT');
  if (receipt.status !== '0x1') throw new Error('TRANSACTION_FAILED');
  if (confirmations > 1) {
    const latest = BigInt(await provider.request({ method: 'eth_blockNumber' }));
    const mined = BigInt(receipt.blockNumber);
    if (latest - mined + 1n < BigInt(confirmations)) {
      // Re-enter the wait loop until the requested depth is reached.
      return waitForReceipt(provider, hash, { confirmations, timeoutMs: Math.max(1000, timeoutMs - (Date.now() - started)), pollMs });
    }
  }
  return receipt;
}

/** Chain id constant re-exported for callers that only import this module. */
export { CHAIN_ID, CHAIN_ID_HEX };
