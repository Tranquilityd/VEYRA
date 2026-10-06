// Phase 3 test fixture: a valid scheme-1 meta-address pair plus one derived
// announcement, built with the same client crypto the browser uses (no test-only
// crypto shortcuts, so a fixture can never encode a rule the client disagrees with).
import { compressPoint, multiplyG, N } from '../../src/stealth/secp256k1.js';
import { bytesToHex } from '../../src/stealth/keccak.js';
import { buildMetaAddress, metaFingerprint } from '../../src/stealth/protocol.js';
import { deriveStealthAddress } from '../../src/stealth/derive.js';
import { enrollmentMessage, personalMessageHash } from '../../src/stealth/recovery.js';
import { signDigest, addressForPrivateKey } from '../../src/stealth/signer.js';

/** Deterministic scalars keep the fixture stable across runs without a PRNG. */
const scalar = (seed) => (BigInt('0x' + Buffer.from(seed).toString('hex')) % (N - 1n)) + 1n;

export function computeSpendPublicKeyFixture() {
  const spendingPrivateKey = scalar('veyra-fixture-spending-key');
  const viewingPrivateKey = scalar('veyra-fixture-viewing-key');
  const spendingPublicKey = bytesToHex(compressPoint(multiplyG(spendingPrivateKey)));
  const viewingPublicKey = bytesToHex(compressPoint(multiplyG(viewingPrivateKey)));
  const metaAddress = buildMetaAddress(spendingPublicKey, viewingPublicKey);
  const fingerprint = metaFingerprint(metaAddress);

  // A fixed ephemeral scalar keeps the announcement stable; production always uses a
  // fresh random one (asserted in private-transfer-crypto.test.js).
  const ephemeralScalar = scalar('veyra-fixture-ephemeral-key');
  const derived = deriveStealthAddress({ metaAddress, r: ephemeralScalar });

  const siskPublicKey = bytesToHex(compressPoint(multiplyG(scalar('veyra-fixture-sisk-key'))));

  // The enrollment signature is produced exactly the way a wallet produces it: a
  // `personal_sign` over the domain-separated enrollment message. The server verifies
  // it by recovering the signer address, so the fixture must be a real signature.
  const walletPrivateKey = scalar('veyra-fixture-wallet-key');
  const enrollmentInput = {
    protocolVersion: 1,
    schemeId: 1,
    spendingPublicKey,
    viewingPublicKey,
    metaAddress,
    fingerprint,
    siskPublicKey,
    enrollmentSignature: '',
    chainId: 4441,
  };
  const message = enrollmentMessage({
    username: 'alice',
    metaAddress,
    siskPublicKey,
    chainId: 4441,
    protocolVersion: 1,
  });
  const { r, s: sigS, recovery } = signDigest(walletPrivateKey, personalMessageHash(message));
  enrollmentInput.enrollmentSignature = '0x'
    + r.toString(16).padStart(64, '0')
    + sigS.toString(16).padStart(64, '0')
    + recovery.toString(16).padStart(2, '0');

  return {
    walletAddress: addressForPrivateKey(walletPrivateKey).toLowerCase(),
    walletPrivateKey,
    enrollmentMessage: message,
    spendingPrivateKey,
    viewingPrivateKey,
    spendingPublicKey,
    viewingPublicKey,
    metaAddress,
    fingerprint,
    enrollmentInput,
    row: {
      protocol_version: 1,
      scheme_id: 1,
      spending_public_key: spendingPublicKey,
      viewing_public_key: viewingPublicKey,
      meta_address: metaAddress,
      fingerprint,
      sisk_public_key: enrollmentInput.siskPublicKey,
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
    },
    stealthAddress: derived.stealthAddress,
    ephemeralPublicKey: derived.R,
    viewTag: derived.viewTag,
    sharedHash: derived.sharedHash,
  };
}

export default computeSpendPublicKeyFixture;
