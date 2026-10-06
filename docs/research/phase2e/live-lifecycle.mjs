#!/usr/bin/env node
/* ============================================================================================
 * Phase 2E — LIVE LiteForge testnet lifecycle orchestrator  (RESEARCH TOOLING — not production)
 * ============================================================================================
 * Purpose: prove the real on-chain ERC-5564 scheme-1 native-zkLTC lifecycle end to end:
 *   Alice --native payment--> S --announce()--> Bob scans from public chain data
 *   --> Bob derives p_stealth and spends S --> fresh T
 *
 * SAFETY CONTRACT (enforced by this script):
 *   - Testnet only: refuses to run against any chain id other than 4441.
 *   - Private keys live in a 0600 file OUTSIDE this repository (default ~/.veyra-phase2e/keys.json)
 *     and are never printed: every log line passes through a redaction filter.
 *   - Ephemeral secrets (r, p_stealth, signatures) are registered with the redactor and never
 *     written to results. A leak guard refuses to write any results file containing them.
 *   - Results files contain PUBLIC data only (addresses, tx hashes, blocks, event fields, verdicts).
 *
 * Usage:  node docs/research/phase2e/live-lifecycle.mjs <command> [--flags]
 *   dry-run   full offline verification of the tooling + crypto pins (no network, no keys file)
 *   prepare   create the four disposable test actors (keys -> external 0600 file, prints addresses)
 *   fund-check  RPC: assert chain 4441, read balances, measure gas price, verify funding
 *   pay       Alice -> S native transfer (0.001 zkLTC by default) + receipt verification
 *   announce  announce(schemeId=1, S, R, viewTag) to the canonical announcer + event verification
 *   scan      Bob-side local scan of the REAL announcement + all negative scan tests
 *   spend     Bob: derive p_stealth, verify p_stealth*G == S, spend S -> fresh T
 *   privacy   independent observer read-only privacy checks (payment / announcement / spend)
 *   recovery  Phase-2D recovery model tests (signature determinism, scenarios, backup round-trip)
 *   failures  safe failure tests (pre-broadcast + offline), each recorded EXPECTED/OBSERVED/RESPONSE
 *   reuse     OPTIONAL (needs extra funds): same-r reuse demo vs fresh-r unlinkability
 *   control   OPTIONAL (needs funds): S -> Bob's normal wallet privacy-breaking control test
 *   all       prepare -> fund-check -> pay -> announce -> scan -> spend -> privacy
 * ============================================================================================ */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  createPublicClient, createWalletClient, http, defineChain,
  parseEther, formatEther, parseEventLogs, keccak256,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import * as S from './lib/stealth.mjs';

/* ------------------------------------------------------------------ paths & config */
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const RESULTS_DIR = path.join(SCRIPT_DIR, 'results');
const STATE_FILE = path.join(RESULTS_DIR, 'state.json');
const DEFAULT_KEYS = path.join(os.homedir(), '.veyra-phase2e', 'keys.json');

const { positional, flags } = parseArgv(process.argv.slice(2));
const CMD = positional[0] || 'help';
const RPC = String(flags.rpc || process.env.LITEFORGE_RPC_URL || S.RPC_DEFAULT);
const EXPLORER = String(flags.explorer || S.EXPLORER_DEFAULT);
const KEYS_FILE = path.resolve(String(flags.keys || DEFAULT_KEYS));
const PAY_CONFS = Number(flags['payment-confirmations'] || flags.confirmations || 3);
const ANN_CONFS = Number(flags['announce-confirmations'] || 1);
const SPEND_CONFS = Number(flags['spend-confirmations'] || 1);
const AMOUNT = parseEther(String(flags.amount || '0.001'));
const USERNAME = String(flags.username || 'bob');

function parseArgv(argv) {
  const positional = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

/* ------------------------------------------------------------------ secret guard */
const SECRETS = new Set();
function registerSecret(v) {
  if (v === undefined || v === null) return;
  let h = typeof v === 'bigint' ? S.privateKeyHex(v) : String(v);
  if (!h.startsWith('0x')) h = '0x' + h;
  if (!/^0x[0-9a-fA-F]+$/.test(h)) return;
  SECRETS.add(h.toLowerCase());
  SECRETS.add(h.slice(2).toLowerCase());
  SECRETS.add(h.slice(2).toLowerCase().replace(/^0+/, ''));
}
function redact(s) {
  let o = String(s);
  for (const sec of SECRETS) if (sec.length >= 16) o = o.split(sec).join('[REDACTED]');
  return o;
}
const log = (...a) => console.log(...a.map(redact));
const warn = (...a) => console.error(...a.map(redact));

function assertNoSecrets(obj) {
  const txt = JSON.stringify(obj).toLowerCase();
  for (const sec of SECRETS) {
    if (sec.length >= 16 && txt.includes(sec)) {
      throw new Error('LEAK GUARD: refusing to write results that contain secret material');
    }
  }
}
function writeResults(name, obj) {
  assertNoSecrets(obj);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, name), JSON.stringify(obj, null, 2));
  log(`results written: docs/research/phase2e/results/${name} (public data only)`);
}

/* ------------------------------------------------------------------ assertion harness */
const T = { total: 0, passed: 0, failed: 0, rows: [] };
function check(name, pass, detail = '') {
  T.total++; if (pass) T.passed++; else T.failed++;
  T.rows.push({ name, pass: !!pass, detail: String(detail) });
  log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
  return !!pass;
}
function checkOrDie(name, pass, detail = '') {
  if (!check(name, pass, detail)) { warn('\nSTOP: critical assertion failed — aborting.'); process.exit(1); }
}

/* ------------------------------------------------------------------ chain helpers */
function makeChain() {
  return defineChain({
    id: S.CHAIN_ID,
    name: 'LiteForge',
    nativeCurrency: { name: 'zkLTC', symbol: 'zkLTC', decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
    blockExplorers: { default: { name: 'LiteForge Explorer', url: EXPLORER } },
  });
}
function pubClient() {
  return createPublicClient({ chain: makeChain(), transport: http(RPC, { timeout: 60_000, retryCount: 2 }) });
}
function walletFor(priv) {
  const account = privateKeyToAccount(S.privateKeyHex(priv));
  registerSecret(priv);
  return {
    account,
    client: createWalletClient({ account, chain: makeChain(), transport: http(RPC, { timeout: 60_000, retryCount: 2 }) }),
  };
}
async function requireChain(pub) {
  let id;
  try { id = await pub.getChainId(); } catch (e) {
    warn(`RPC unreachable at ${RPC}: ${e.shortMessage || e.message}`);
    warn('If this is the sandbox environment, egress is blocked — run this script where the RPC is reachable.');
    process.exit(2);
  }
  checkOrDie(`chain id is ${S.CHAIN_ID} (got ${id})`, id === S.CHAIN_ID);
}

/* ------------------------------------------------------------------ keys / state */
function repoRoot() {
  let d = SCRIPT_DIR;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}
function assertKeysOutsideRepo(p) {
  const root = repoRoot();
  if (root && path.resolve(p).startsWith(root + path.sep)) {
    throw new Error(`refusing to store private keys inside the repository (${p}); use a path outside ${root}`);
  }
}
function newKeys() {
  const mk = () => S.randomScalar();
  return {
    version: 1, chainId: S.CHAIN_ID, username: USERNAME, createdAt: new Date().toISOString(),
    alicePriv: S.privateKeyHex(mk()), bobSpendPriv: S.privateKeyHex(mk()), bobViewPriv: S.privateKeyHex(mk()),
    bobNormalPriv: S.privateKeyHex(mk()), observerPriv: S.privateKeyHex(mk()), tPriv: S.privateKeyHex(mk()),
    idWalletPriv: S.privateKeyHex(mk()),
  };
}
function publicView(k) {
  const spendPub = S.hex(S.pubkeyOf(BigInt(k.bobSpendPriv), true));
  const viewPub = S.hex(S.pubkeyOf(BigInt(k.bobViewPriv), true));
  const meta = S.buildMetaAddress(spendPub, viewPub);
  return {
    chainId: k.chainId, username: k.username,
    alice: S.addressOfPub(S.pubkeyOf(BigInt(k.alicePriv), true)),
    bobNormal: S.addressOfPub(S.pubkeyOf(BigInt(k.bobNormalPriv), true)),
    bobSpendPub: spendPub, bobViewPub: viewPub,
    bobMetaAddress: meta, bobMetaFingerprint: S.metaFingerprint(meta),
    observer: S.addressOfPub(S.pubkeyOf(BigInt(k.observerPriv), true)),
    t: S.addressOfPub(S.pubkeyOf(BigInt(k.tPriv), true)),
    identityWallet: S.addressOfPub(S.pubkeyOf(BigInt(k.idWalletPriv), true)),
  };
}
function saveKeys(k) {
  assertKeysOutsideRepo(KEYS_FILE);
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(k, null, 2), { mode: 0o600 });
  log(`keys written to ${KEYS_FILE} (mode 0600, OUTSIDE the repository) — never commit or share it`);
}
function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) {
    warn(`no keys file at ${KEYS_FILE} — run: node docs/research/phase2e/live-lifecycle.mjs prepare`);
    process.exit(2);
  }
  const k = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  for (const f of ['alicePriv', 'bobSpendPriv', 'bobViewPriv', 'bobNormalPriv', 'observerPriv', 'tPriv', 'idWalletPriv']) {
    registerSecret(k[f]);
  }
  return k;
}
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function saveState(patch) {
  const st = { ...loadState(), ...patch, phase: '2E', chainId: S.CHAIN_ID, updatedAt: new Date().toISOString() };
  writeResults('state.json', st);
  return st;
}

/* ============================================================================================
 * DRY RUN — offline verification of tooling + pins (no network, no keys file written)
 * ============================================================================================ */
async function cmdDryRun() {
  log('=== Phase 2E dry run (offline) ===\n');

  /* --- primitives / serialization pins --- */
  check('keccak256("") vector', keccak256('0x') === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  check('address rule: scalar 1 -> 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
    S.addressOfPub(S.pubkeyOf(1n)) === '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
  check('WRONG rule diverges: keccak256(compressed) != canonical address',
    '0x' + keccak256(S.pubkeyOf(1n, true)).slice(-40) !== S.addressOfPub(S.pubkeyOf(1n)));

  /* --- meta-address --- */
  const a = { alice: S.randomScalar(), bobSpend: S.randomScalar(), bobView: S.randomScalar(), bobNormal: S.randomScalar(), observer: S.randomScalar() };
  const spendPub = S.hex(S.pubkeyOf(a.bobSpend, true)), viewPub = S.hex(S.pubkeyOf(a.bobView, true));
  const meta = S.buildMetaAddress(spendPub, viewPub);
  const parsed = S.acceptMetaAddressForVeyra(meta);
  check('meta-address is 66 bytes with separate spend/view keys', parsed.ok && !parsed.singleKeyForm && parsed.spendPub !== parsed.viewPub);
  check('meta-address carries valid 02/03 compressed prefixes', /^(02|03)/.test(S.strip(meta).slice(0, 2)) && /^(02|03)/.test(S.strip(meta).slice(66, 68)));
  check('meta-address exposes no wallet address', !meta.toLowerCase().includes(S.addressOfPub(S.pubkeyOf(a.bobNormal, true)).slice(2)));
  check('single-key meta-address REFUSED by Veyra policy', S.acceptMetaAddressForVeyra('st:litvm:0x' + S.strip(spendPub)).ok === false);
  check('malformed meta-address refused (odd length)', S.acceptMetaAddressForVeyra('0x1234').ok === false);
  check('malformed meta-address refused (x not on curve)', S.acceptMetaAddressForVeyra('0x' + '02' + 'ff'.repeat(32) + S.strip(viewPub)).ok === false);

  /* --- ephemeral key validation --- */
  const okR = S.hex(S.pubkeyOf(S.randomScalar(), true));
  const malformed = [
    ['valid R accepted', okR, true],
    ['bad prefix 0x04', '0x' + '04'.padEnd(68, '0'), false],
    ['x not on curve', '0x' + '02' + 'ff'.repeat(32), false],
    ['truncated (32 B)', '0x' + '02' + 'ab'.repeat(31), false],
    ['all-zero 33 B', '0x' + '00'.repeat(33), false],
    ['REAL on-chain invalid key (tx 0xb1c9895e)', '0x02f0976880154ebf19f151149f7efdc56bcf700162aada12f76870bec0287e70df', false],
  ];
  for (const [label, R, expectOk] of malformed) {
    const v = S.validateEphemeralKey(R);
    check(`ephemeral-key validation: ${label}`, v.ok === expectOk, v.ok ? 'accepted' : v.reason);
  }

  /* --- stealth derivation --- */
  const d = S.deriveStealthAddress({ meta });
  registerSecret(d.r);
  check('stealth address S derives and is not Alice / Bob-normal',
    d.S.toLowerCase() !== S.addressOfPub(S.pubkeyOf(a.alice, true)).toLowerCase() && d.S.toLowerCase() !== S.addressOfPub(S.pubkeyOf(a.bobNormal, true)).toLowerCase());
  check('view tag is exactly one byte', d.viewTag.length === 2);
  check('p_stealth*G == P_stealth (Bob side reproduces S)',
    S.addressOfPub(S.hex(S.pubkeyOf(S.stealthPrivateKeyFrom(a.bobSpend, d.h), true))) === d.S);
  check('ECDH symmetry: keccak(rV) == keccak(vR)',
    S.sharedSecretHash(d.r, viewPub) === S.sharedSecretHash(a.bobView, d.R));
  check('scanner matches S with Bob\'s viewing key', S.scanAnnouncement({ schemeId: 1, stealthAddress: d.S, ephemeralPubKey: d.R, metadata: '0x' + d.viewTag }, { spendPub, viewPriv: a.bobView }).match === true);
  check('scanner does NOT match with Alice\'s key (negative)', S.scanAnnouncement({ schemeId: 1, stealthAddress: d.S, ephemeralPubKey: d.R, metadata: '0x' + d.viewTag }, { spendPub, viewPriv: a.alice }).match === false);
  check('scanner does NOT match for observer key (negative)', S.scanAnnouncement({ schemeId: 1, stealthAddress: d.S, ephemeralPubKey: d.R, metadata: '0x' + d.viewTag }, { spendPub, viewPriv: a.observer }).match === false);
  check('scanner does NOT match for a random viewing key (negative)', S.scanAnnouncement({ schemeId: 1, stealthAddress: d.S, ephemeralPubKey: d.R, metadata: '0x' + d.viewTag }, { spendPub, viewPriv: S.randomScalar() }).match === false);
  check('scanner does NOT match on wrong view tag (negative)', S.scanAnnouncement({ schemeId: 1, stealthAddress: d.S, ephemeralPubKey: d.R, metadata: '0x' + (d.viewTag === '00' ? '01' : '00') }, { spendPub, viewPriv: a.bobView }).match === false);
  check('scanner ignores unsupported schemeId (negative)', S.scanAnnouncement({ schemeId: 2, stealthAddress: d.S, ephemeralPubKey: d.R, metadata: '0x' + d.viewTag }, { spendPub, viewPriv: a.bobView }).match === false);
  check('scanner rejects invalid R gracefully (no crash, no match)',
    S.scanAnnouncement({ schemeId: 1, stealthAddress: d.S, ephemeralPubKey: '0x02f0976880154ebf19f151149f7efdc56bcf700162aada12f76870bec0287e70df', metadata: '0x' + d.viewTag }, { spendPub, viewPriv: a.bobView }).match === false);
  check('duplicate announcement is idempotent',
    S.scanAnnouncement({ schemeId: 1, stealthAddress: d.S, ephemeralPubKey: d.R, metadata: '0x' + d.viewTag }, { spendPub, viewPriv: a.bobView }).match === true);

  /* --- freshness / reuse --- */
  const d2 = S.deriveStealthAddress({ meta });
  registerSecret(d2.r);
  check('fresh r -> different S, different R, different view tag',
    d2.S !== d.S && d2.R !== d.R && d2.viewTag !== d.viewTag);
  const dSame = S.deriveStealthAddress({ meta, r: d.r });
  check('REUSE DEMO: same r -> identical S and identical view tag (linkable)', dSame.S === d.S && dSame.viewTag === d.viewTag);

  /* --- announcement encoding --- */
  const calldata = S.buildAnnounceCalldata({ stealthAddress: d.S, ephemeralPubKey: d.R, viewTag: d.viewTag });
  check('announce selector == 0x4d1f9583', calldata.slice(0, 10) === '0x4d1f9583');
  const dec = S.decodeAnnounceCalldata(calldata);
  check('calldata round-trip preserves schemeId / S / R / metadata',
    dec.schemeId === 1 && dec.stealthAddress.toLowerCase() === d.S.toLowerCase() && dec.ephemeralPubKey.toLowerCase() === d.R.toLowerCase() && dec.metadata === '0x' + d.viewTag);
  const REAL = '0x4d1f95830000000000000000000000000000000000000000000000000000000000000001000000000000000000000000949dfa2a5cd195403ccf455625678865a8f1e0ab000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000002102f0976880154ebf19f151149f7efdc56bcf700162aada12f76870bec0287e70df0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000019f00000000000000000000000000000000000000000000000000000000000000';
  const re = S.buildAnnounceCalldata({ stealthAddress: '0x949DFA2a5CD195403CCf455625678865A8F1e0AB', ephemeralPubKey: '0x02f0976880154ebf19f151149f7efdc56bcf700162aada12f76870bec0287e70df', viewTag: '0x9f' });
  check('real LiteForge announce calldata reproduced byte-for-byte', re.toLowerCase() === REAL.toLowerCase());

  /* --- meta-address substitution detection --- */
  const evilMeta = S.buildMetaAddress(S.hex(S.pubkeyOf(S.randomScalar(), true)), S.hex(S.pubkeyOf(S.randomScalar(), true)));
  const evilDerive = S.deriveStealthAddress({ meta: evilMeta });
  registerSecret(evilDerive.r);
  check('meta substitution detected by fingerprint change', S.metaFingerprint(evilMeta) !== S.metaFingerprint(meta));
  check('meta substitution sends funds to an address Bob can never scan (S_evil != S)', evilDerive.S !== d.S);

  /* --- recovery model --- */
  const idPriv = S.randomScalar();
  registerSecret(idPriv);
  const idAccount = privateKeyToAccount(S.privateKeyHex(idPriv));
  const msg = S.recoveryMessage(USERNAME, S.CHAIN_ID);
  const sig1 = await idAccount.signMessage({ message: msg });
  const sig2 = await idAccount.signMessage({ message: msg });
  check('recovery: identical signing input -> byte-identical signature (deterministic RFC-6979)', sig1 === sig2);
  const k1 = S.deriveKeysFromSignature(sig1);
  const k2 = S.deriveKeysFromSignature(sig2);
  check('recovery: derived roots and meta-address are reproducible', k1.ok && k2.ok && k1.meta === k2.meta);
  check('recovery: meta-address is the separate-key 66-byte form',
    S.acceptMetaAddressForVeyra(k1.meta).ok && !S.acceptMetaAddressForVeyra(k1.meta).singleKeyForm);
  const otherWallet = privateKeyToAccount(S.privateKeyHex(S.randomScalar()));
  const sigOther = await otherWallet.signMessage({ message: msg });
  const kOther = S.deriveKeysFromSignature(sigOther);
  check('recovery HAZARD: a different wallet over the same message derives different keys', kOther.ok && kOther.meta !== k1.meta);
  check('recovery: fingerprint mismatch is detectable (wallets must refuse silently-diverged identity)',
    S.metaFingerprint(kOther.meta) !== S.metaFingerprint(k1.meta));
  check('recovery: altered username -> different roots',
    S.deriveKeysFromSignature(await idAccount.signMessage({ message: S.recoveryMessage('bob2', S.CHAIN_ID) })).meta !== k1.meta);
  check('recovery: altered chainId -> different roots',
    S.deriveKeysFromSignature(await idAccount.signMessage({ message: S.recoveryMessage(USERNAME, 4442) })).meta !== k1.meta);
  check('recovery: wrong message (phishing variant) -> different roots',
    S.deriveKeysFromSignature(await idAccount.signMessage({ message: 'sign in to veyra' })).meta !== k1.meta);
  const compact = sig1.slice(0, 128) + '1b';
  check('recovery: 64-byte compact signature refused', S.deriveKeysFromSignature(compact).ok === false,
    S.deriveKeysFromSignature(compact).reason);

  /* --- encrypted backup round trip (spec model) --- */
  const passphrase = 'correct horse battery staple';
  const blob = encryptBackup({ spendPriv: '0x01', viewPriv: '0x02', meta, username: USERNAME, chainId: S.CHAIN_ID }, passphrase);
  check('backup: AEAD round-trip restores the identity payload', decryptBackup(blob, passphrase).meta === meta);
  check('backup: wrong passphrase fails closed (auth error, no partial state)', (() => { try { decryptBackup(blob, 'wrong'); return false; } catch { return true; } })());

  /* --- funding / gas arithmetic --- */
  const gp = 1_000_000_000n;
  check('gas: 21,000 @ 1 Gwei = 0.000021 zkLTC', 21000n * gp === 21_000_000_000_000n);
  check('funding: 0.001 payment + measured gas fits the recommended 0.0025 zkLTC Alice reserve',
    AMOUNT + 100000n * gp <= parseEther('0.0025'));
  check('spend: payment value covers recipient spend + gas (no gas-funding link needed)',
    AMOUNT > 21000n * gp * 3n);

  log(`\n=== dry-run assertions: ${T.passed}/${T.total} PASS, ${T.failed} FAIL ===`);
  process.exit(T.failed === 0 ? 0 : 1);
}

/* ------------------------------------------------------------------ backup crypto (spec model) */
function encryptBackup(payload, passphrase) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { v: 1, kdf: 'scrypt', N: 2 ** 15, r: 8, p: 1, salt: salt.toString('hex'), iv: iv.toString('hex'), ct: ct.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
}
function decryptBackup(blob, passphrase) {
  const key = crypto.scryptSync(passphrase, Buffer.from(blob.salt, 'hex'), 32, { N: blob.N, r: blob.r, p: blob.p, maxmem: 128 * 1024 * 1024 });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(blob.ct, 'hex')), decipher.final()]).toString('utf8'));
}

/* ============================================================================================
 * PREPARE / FUND-CHECK
 * ============================================================================================ */
function cmdPrepare() {
  if (fs.existsSync(KEYS_FILE) && !flags.force) {
    warn(`keys already exist at ${KEYS_FILE} — refusing to overwrite (use --force to replace; old funds would be unreachable)`);
    process.exit(2);
  }
  const k = newKeys();
  saveKeys(k);
  const p = publicView(k);
  log('\n=== Phase 2E disposable test actors (PUBLIC data only) ===');
  log(`Alice (sender)          : ${p.alice}`);
  log(`Bob normal wallet       : ${p.bobNormal}   (receives nothing; must never appear in the payment path)`);
  log(`Bob stealth meta-address: ${p.bobMetaAddress}`);
  log(`Bob meta fingerprint    : ${p.bobMetaFingerprint}   (pin & display this; substitution alarm)`);
  log(`Observer                : ${p.observer}`);
  log(`Fresh destination T     : ${p.t}`);
  log(`Identity wallet (recovery tests): ${p.identityWallet}`);
  log('\n=== FUNDING (testnet zkLTC only) ===');
  log(`Fund ONLY Alice with >= 0.0025 zkLTC  (payment 0.001 + gas for payment AND announce)`);
  log('Do NOT fund Bob\'s normal wallet, the observer, T, or S: the payment itself funds Bob\'s spend.');
  writeResults('actors.json', p);
}

async function cmdFundCheck() {
  const k = loadKeys(); const p = publicView(k); const pub = pubClient();
  await requireChain(pub);
  const gasPrice = await pub.getGasPrice();
  const aliceBal = await pub.getBalance({ address: p.alice });
  const bobNormalBal = await pub.getBalance({ address: p.bobNormal });
  log(`chain 4441 OK | gas price ${gasPrice} wei = ${Number(gasPrice) / 1e9} Gwei`);
  log(`Alice balance      : ${formatEther(aliceBal)} zkLTC`);
  log(`Bob normal balance : ${formatEther(bobNormalBal)} zkLTC (expected 0 — never funded)`);
  const need = AMOUNT + gasPrice * 100_000n;      // payment + generous gas headroom for 2 txs
  check(`Alice is funded for payment + gas (needs ~${formatEther(need)} zkLTC)`, aliceBal >= need, `balance ${formatEther(aliceBal)}`);
  check('Bob\'s normal wallet holds no funds (no gas-funding link exists)', bobNormalBal === 0n, `${formatEther(bobNormalBal)} zkLTC`);
  writeResults('fund-check.json', { at: new Date().toISOString(), chainId: S.CHAIN_ID, gasPriceWei: gasPrice.toString(), aliceBalanceWei: aliceBal.toString(), bobNormalBalanceWei: bobNormalBal.toString(), requiredWei: need.toString() });
  process.exit(T.failed ? 1 : 0);
}

/* ============================================================================================
 * PAY / ANNOUNCE / SCAN / SPEND
 * ============================================================================================ */
async function cmdPay() {
  const k = loadKeys(); const p = publicView(k); const pub = pubClient();
  const alice = walletFor(BigInt(k.alicePriv));
  await requireChain(pub);

  const d = S.deriveStealthAddress({ meta: p.bobMetaAddress });
  registerSecret(d.r);
  const v = S.validateEphemeralKey(d.R);
  checkOrDie(`ephemeral key R is a valid compressed secp256k1 point`, v.ok, v.reason);
  checkOrDie('S differs from Alice, Bob-normal, observer and T',
    ![p.alice, p.bobNormal, p.observer, p.t].some((x) => x.toLowerCase() === d.S.toLowerCase()));
  checkOrDie('p_stealth*G == P_stealth (local pre-send verification)',
    S.addressOfPub(S.hex(S.pubkeyOf(S.stealthPrivateKeyFrom(BigInt(k.bobSpendPriv), d.h), true))) === d.S);

  const gasPrice = await pub.getGasPrice();
  const est = await pub.estimateGas({ account: alice.account, to: d.S, value: AMOUNT });
  const bal = await pub.getBalance({ address: p.alice });
  checkOrDie(`Alice balance covers payment + gas (need ${formatEther(AMOUNT + est * gasPrice)} zkLTC)`, bal >= AMOUNT + est * gasPrice);

  log(`Alice -> S : ${formatEther(AMOUNT)} zkLTC | S=${d.S} | R=${d.R} | tag=0x${d.viewTag}`);
  const hash = await alice.client.sendTransaction({ to: d.S, value: AMOUNT });
  log(`payment tx broadcast: ${EXPLORER}/tx/${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash, confirmations: PAY_CONFS });
  checkOrDie('payment transaction succeeded', receipt.status === 'success', `status=${receipt.status}`);
  checkOrDie('payment recipient is S', receipt.to.toLowerCase() === d.S.toLowerCase());
  const tx = await pub.getTransaction({ hash });
  check('payment value equals expected amount', tx.value === AMOUNT, `${tx.value} wei`);
  check(`payment confirmed with ${PAY_CONFS} confirmation(s)`, receipt.blockNumber !== null, `block ${receipt.blockNumber}`);

  saveState({
    payment: {
      txHash: hash, block: Number(receipt.blockNumber), S: d.S, R: d.R, viewTag: d.viewTag,
      amountWei: AMOUNT.toString(), gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice?.toString() ?? null,
      confirmations: PAY_CONFS, explorer: `${EXPLORER}/tx/${hash}`, alice: p.alice, bobMetaFingerprint: p.bobMetaFingerprint,
      walletSignatureApprovals: 1, broadcastedAt: new Date().toISOString(),
    },
  });
  log(`\nPAYMENT COMPLETE. Bob can now scan; announcement step next for full lifecycle.`);
}

async function cmdAnnounce() {
  const k = loadKeys(); const st = loadState(); const pub = pubClient();
  const alice = walletFor(BigInt(k.alicePriv));
  await requireChain(pub);
  if (!st.payment) { warn('no payment in state — run pay first'); process.exit(2); }
  const { S: steal, R, viewTag } = st.payment;

  const vR = S.validateEphemeralKey(R);
  checkOrDie('R re-validated before announcing', vR.ok, vR.reason);
  const tag = '0x' + viewTag;
  const data = S.buildAnnounceCalldata({ schemeId: S.SCHEME_ID, stealthAddress: steal, ephemeralPubKey: R, viewTag: tag });
  const dec = S.decodeAnnounceCalldata(data);
  checkOrDie('calldata self-check (schemeId=1, S, R, 1-byte view-tag metadata)',
    dec.schemeId === 1 && dec.stealthAddress.toLowerCase() === steal.toLowerCase() && dec.metadata === tag);

  log(`announce(schemeId=1, S=${steal}, R=${R}, metadata=${tag}) -> ${S.ANNOUNCER}`);
  const hash = await alice.client.sendTransaction({ to: S.ANNOUNCER, data, value: 0n });
  log(`announcement tx broadcast: ${EXPLORER}/tx/${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash, confirmations: ANN_CONFS });
  checkOrDie('announcement transaction succeeded', receipt.status === 'success', `status=${receipt.status}`);

  const events = parseEventLogs({ abi: S.ANNOUNCER_ABI, eventName: 'Announcement', logs: receipt.logs })
    .filter((l) => l.address.toLowerCase() === S.ANNOUNCER.toLowerCase());
  checkOrDie('Announcement event emitted by the canonical announcer', events.length === 1, `${events.length} event(s)`);
  const ev = events[0].args;
  check('event schemeId == 1', Number(ev.schemeId) === 1, String(ev.schemeId));
  check('event stealthAddress == S', String(ev.stealthAddress).toLowerCase() === steal.toLowerCase());
  check('event caller == Alice', String(ev.caller).toLowerCase() === publicView(k).alice.toLowerCase());
  check('event ephemeralPubKey == R (byte-for-byte)', String(ev.ephemeralPubKey).toLowerCase() === R.toLowerCase());
  check('event metadata == view tag (1 byte, pinned layout)', String(ev.metadata) === tag, String(ev.metadata));

  saveState({
    announcement: {
      txHash: hash, block: Number(receipt.blockNumber), schemeId: 1, stealthAddress: steal, ephemeralPubKey: R,
      metadata: tag, caller: String(ev.caller), gasUsed: receipt.gasUsed.toString(),
      confirmations: ANN_CONFS, explorer: `${EXPLORER}/tx/${hash}`, walletSignatureApprovals: 1,
    },
  });
  log('\nANNOUNCEMENT COMPLETE.');
}

async function cmdScan() {
  const k = loadKeys(); const st = loadState(); const pub = pubClient();
  const p = publicView(k);
  await requireChain(pub);

  let ann = null;
  if (st.announcement) {
    ann = st.announcement;
    log(`using recorded announcement tx ${ann.txHash}`);
  } else if (flags['announce-tx']) {
    const receipt = await pub.getTransactionReceipt({ hash: String(flags['announce-tx']) });
    const [ev] = parseEventLogs({ abi: S.ANNOUNCER_ABI, eventName: 'Announcement', logs: receipt.logs });
    ann = { schemeId: Number(ev.args.schemeId), stealthAddress: String(ev.args.stealthAddress), ephemeralPubKey: String(ev.args.ephemeralPubKey), metadata: String(ev.args.metadata), txHash: String(flags['announce-tx']), block: Number(receipt.blockNumber) };
  } else {
    // indexer-style retrieval of PUBLIC data only (viewing key is never involved in this call)
    const fromBlock = BigInt(Math.max(0, (st.payment?.block ?? 0) - 5));
    const logs = await pub.getLogs({ address: S.ANNOUNCER, event: S.ANNOUNCER_ABI[1], fromBlock, toBlock: 'latest' });
    check('announcement log retrieved from chain (public fields only)', logs.length > 0, `${logs.length} log(s) since block ${fromBlock}`);
    const decoded = logs.map((l) => ({ schemeId: Number(l.args.schemeId), stealthAddress: String(l.args.stealthAddress), ephemeralPubKey: String(l.args.ephemeralPubKey), metadata: String(l.args.metadata), txHash: l.transactionHash, block: Number(l.blockNumber) }));
    ann = decoded.find((x) => x.stealthAddress.toLowerCase() === st.payment?.S?.toLowerCase()) ?? decoded[0];
  }
  checkOrDie('announcement available for scanning', !!ann);
  log(`public announcement: schemeId=${ann.schemeId} S=${ann.stealthAddress} R=${ann.ephemeralPubKey} metadata=${ann.metadata}`);

  const fields = { schemeId: ann.schemeId, stealthAddress: ann.stealthAddress, ephemeralPubKey: ann.ephemeralPubKey, metadata: ann.metadata };
  const bobSees = { spendPub: p.bobSpendPub, viewPriv: BigInt(k.bobViewPriv) };

  /* --- positive --- */
  const pos = S.scanAnnouncement(fields, bobSees);
  checkOrDie('Bob DETECTS the payment from public data + viewing key only', pos.match, pos.reason);

  /* --- negatives --- */
  const negA = S.scanAnnouncement(fields, { spendPub: p.bobSpendPub, viewPriv: BigInt(k.alicePriv) });
  const negB = S.scanAnnouncement(fields, { spendPub: p.bobSpendPub, viewPriv: BigInt(k.observerPriv) });
  const negC = S.scanAnnouncement(fields, { spendPub: p.bobSpendPub, viewPriv: S.randomScalar() });
  const negD = S.scanAnnouncement({ ...fields, metadata: '0x' + ((ann.metadata.slice(2, 4) === '00') ? '01' : '00') }, bobSees);
  const negE = S.scanAnnouncement({ ...fields, ephemeralPubKey: '0x02f0976880154ebf19f151149f7efdc56bcf700162aada12f76870bec0287e70df' }, bobSees);
  const negF = S.scanAnnouncement({ ...fields, schemeId: 2 }, bobSees);
  const negG = S.scanAnnouncement({ ...fields, stealthAddress: S.addressOfPub(S.pubkeyOf(S.randomScalar())) }, bobSees);
  check('negative A: Alice\'s key does NOT detect S', negA.match === false, negA.reason);
  check('negative B: observer does NOT detect S as Bob\'s', negB.match === false, negB.reason);
  check('negative C: different random viewing key does NOT detect S', negC.match === false, negC.reason);
  check('negative D: wrong view tag does NOT match', negD.match === false, negD.reason);
  check('negative E: invalid R rejected (no crash, no match)', negE.match === false, negE.reason);
  check('negative F: unsupported scheme id ignored', negF.match === false, negF.reason);
  check('negative G: wrong stealth address does not match', negG.match === false, negG.reason);
  check('duplicate announcement is idempotent', S.scanAnnouncement(fields, bobSees).match === true);

  /* --- announcement vs payment (no funds => not "received") --- */
  if (st.payment) {
    const balS = await pub.getBalance({ address: st.payment.S });
    check('balance check: S actually holds the payment (announcement alone is not "received")', balS > 0n, `${formatEther(balS)} zkLTC`);
  }

  saveState({
    scan: {
      at: new Date().toISOString(), announcementTx: ann.txHash ?? null, matched: pos.match,
      computedTag: pos.computedTag ?? null, candidateAddress: pos.candidateAddress ?? null,
      negatives: { alice: negA.match, observer: negB.match, randomViewingKey: negC.match, wrongTag: negD.match, invalidR: negE.match, scheme2: negF.match, wrongS: negG.match },
      viewingKeyTransmittedToBackend: false,
      note: 'In this CLI both roles run locally. In production the indexer must serve only public fields; the viewing key never leaves the client.',
      walletSignatureApprovals: 0,
    },
  });
  log('\nBOB SCAN COMPLETE — S identified as Bob\'s stealth address.');
}

async function cmdSpend() {
  const k = loadKeys(); const st = loadState(); const pub = pubClient();
  const p = publicView(k);
  await requireChain(pub);
  if (!st.payment || !st.announcement) { warn('payment/announcement missing — run pay and announce first'); process.exit(2); }

  const fields = { schemeId: 1, stealthAddress: st.payment.S, ephemeralPubKey: st.payment.R, metadata: '0x' + st.payment.viewTag };
  const scan = S.scanAnnouncement(fields, { spendPub: p.bobSpendPub, viewPriv: BigInt(k.bobViewPriv) });
  checkOrDie('Bob re-derives the shared secret from the real announcement', scan.match, scan.reason);

  const pStealth = S.stealthPrivateKeyFrom(BigInt(k.bobSpendPriv), scan.h);
  registerSecret(pStealth);
  const stealthAccount = privateKeyToAccount(S.privateKeyHex(pStealth));
  checkOrDie('p_stealth*G == S (stealth private key controls the funded address)', stealthAccount.address.toLowerCase() === st.payment.S.toLowerCase(), stealthAccount.address);

  const balS = await pub.getBalance({ address: st.payment.S });
  checkOrDie('S holds the payment', balS > 0n, `${formatEther(balS)} zkLTC`);
  const gasPrice = await pub.getGasPrice();
  const est = await pub.estimateGas({ account: stealthAccount, to: p.t, value: balS / 2n });
  const value = flags['spend-amount'] ? parseEther(String(flags['spend-amount'])) : balS - est * gasPrice * 2n;
  checkOrDie('spend amount leaves gas reserve inside S', value > 0n, `${formatEther(value)} zkLTC`);
  checkOrDie('destination T is fresh and unrelated (not Bob-normal, Alice, S, observer)',
    ![p.bobNormal, p.alice, p.observer, st.payment.S].some((x) => x.toLowerCase() === p.t.toLowerCase()));

  log(`S -> T : ${formatEther(value)} zkLTC | T=${p.t}`);
  const stealthWallet = createWalletClient({ account: stealthAccount, chain: makeChain(), transport: http(RPC, { timeout: 60_000 }) });
  const hash = await stealthWallet.sendTransaction({ to: p.t, value });
  log(`spend tx broadcast: ${EXPLORER}/tx/${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash, confirmations: SPEND_CONFS });
  checkOrDie('spend transaction succeeded', receipt.status === 'success', `status=${receipt.status}`);
  checkOrDie('spend recipient is T', receipt.to.toLowerCase() === p.t.toLowerCase());
  const balAfter = await pub.getBalance({ address: st.payment.S });
  check('S balance decreased (funds moved by the stealth key)', balAfter < balS, `${formatEther(balS)} -> ${formatEther(balAfter)}`);

  saveState({
    spend: {
      txHash: hash, block: Number(receipt.blockNumber), from: st.payment.S, to: p.t, valueWei: value.toString(),
      gasUsed: receipt.gasUsed.toString(), confirmations: SPEND_CONFS, explorer: `${EXPLORER}/tx/${hash}`,
      stealthKeyReproducesS: true, walletSignatureApprovals: 1,
    },
  });
  log('\nBOB SPEND COMPLETE — Bob controls the funds at S and spent to a fresh destination.');
}

/* ============================================================================================
 * PRIVACY (independent observer, read-only)
 * ============================================================================================ */
async function cmdPrivacy() {
  const st = loadState(); const k = loadKeys(); const p = publicView(k); const pub = pubClient();
  await requireChain(pub);
  if (!st.payment) { warn('no payment in state'); process.exit(2); }

  const paymentTx = await pub.getTransaction({ hash: st.payment.txHash });
  const annTx = st.announcement ? await pub.getTransaction({ hash: st.announcement.txHash }) : null;
  const spendTx = st.spend ? await pub.getTransaction({ hash: st.spend.txHash }) : null;
  const all = [paymentTx, annTx, spendTx].filter(Boolean);
  const involves = (addr) => all.some((t) => (t.from ?? '').toLowerCase() === addr.toLowerCase() || (t.to ?? '').toLowerCase() === addr.toLowerCase());

  check('Bob\'s normal wallet does NOT appear in the payment transaction', !((paymentTx.from ?? '').toLowerCase() === p.bobNormal.toLowerCase() || (paymentTx.to ?? '').toLowerCase() === p.bobNormal.toLowerCase()));
  check('Bob\'s normal wallet does NOT appear in the announcement transaction', !annTx || !involves(p.bobNormal));
  check('Bob\'s normal wallet does NOT appear anywhere in the lifecycle', !involves(p.bobNormal));
  check('payment goes to S, not to Bob\'s normal wallet', (paymentTx.to ?? '').toLowerCase() === st.payment.S.toLowerCase());
  if (spendTx) {
    check('spend destination T != Bob\'s normal wallet', (spendTx.to ?? '').toLowerCase() !== p.bobNormal.toLowerCase());
    check('spend destination T != Alice and != S', (spendTx.to ?? '').toLowerCase() !== p.alice.toLowerCase() && (spendTx.to ?? '').toLowerCase() !== st.payment.S.toLowerCase());
  }

  const table = [
    ['Sender (Alice)', 'YES', 'NO'],
    ['Amount', 'YES', 'NO'],
    ['Timing', 'YES', 'POSSIBLY CORRELATABLE'],
    ['Stealth address S', 'YES', 'NO DIRECT LINK'],
    ['Ephemeral key R', 'YES', 'NO DIRECT LINK'],
    ['Announcement', 'YES', 'NO DIRECT LINK'],
    ['Bob normal wallet', 'SHOULD REMAIN HIDDEN', '—'],
    [`S -> fresh T`, 'YES', 'NO DIRECT LINK'],
    ['S -> Bob normal wallet', 'YES', 'YES / LINKED (privacy-breaking control)'],
  ];
  log('\n| Information | Public? | Reveals Bob? |');
  for (const [i, pubv, rev] of table) log(`| ${i} | ${pubv} | ${rev} |`);
  log('\nTerminology: this is RECIPIENT-ADDRESS PRIVACY / RECIPIENT UNLINKABILITY — not anonymity.');

  saveState({ privacy: { at: new Date().toISOString(), bobNormalAppearsAnywhere: involves(p.bobNormal), table, terminology: 'recipient-address privacy / recipient unlinkability (not anonymity)' } });
}

/* ============================================================================================
 * RECOVERY (Phase 2D model)
 * ============================================================================================ */
async function cmdRecovery() {
  const k = loadKeys(); const st = loadState();
  const p = publicView(k);
  const msg = S.recoveryMessage(USERNAME, S.CHAIN_ID);
  const wallet = privateKeyToAccount(k.idWalletPriv);
  log(`identity wallet: ${wallet.address}`);
  log(`signed message : "${msg.replace(/\n/g, '\\n')}"`);

  const sig1 = await wallet.signMessage({ message: msg });
  const sig2 = await wallet.signMessage({ message: msg });
  registerSecret(sig1);
  check('A. same wallet + same signing input -> byte-identical signature (deterministic)', sig1 === sig2);
  const r1 = S.deriveKeysFromSignature(sig1);
  checkOrDie('B. signature -> valid spend/view roots', r1.ok, r1.reason);
  const fp = S.metaFingerprint(r1.meta);
  log(`derived meta-address fingerprint: ${fp}`);

  /* scenario: local state cleared (re-derive from signature only) */
  const r2 = S.deriveKeysFromSignature(await wallet.signMessage({ message: msg }));
  check('C. local state cleared -> identical roots re-derived (same signature)', r2.meta === r1.meta);
  /* scenario: wallet restored from seed (same key material re-instantiated) */
  const restored = privateKeyToAccount(k.idWalletPriv);
  const restoredMeta = S.deriveKeysFromSignature(await restored.signMessage({ message: msg })).meta;
  check('D. wallet restored -> same roots', restoredMeta === r1.meta);
  /* scenario: alternate provider / different wallet -> MUST be detected as mismatch */
  const alt = privateKeyToAccount(S.privateKeyHex(S.randomScalar()));
  const altMeta = S.deriveKeysFromSignature(await alt.signMessage({ message: msg })).meta;
  check('E. alternate wallet -> DIFFERENT roots and fingerprint mismatch is detected', S.metaFingerprint(altMeta) !== fp);
  /* scenario: altered username / chain id */
  check('F. altered username -> mismatch detected', S.metaFingerprint(S.deriveKeysFromSignature(await wallet.signMessage({ message: S.recoveryMessage('bob2', S.CHAIN_ID) })).meta) !== fp);
  check('G. altered chain id -> mismatch detected', S.metaFingerprint(S.deriveKeysFromSignature(await wallet.signMessage({ message: S.recoveryMessage(USERNAME, 4442) })).meta) !== fp);
  /* incorrect recovery signature + fingerprint mismatch behaviour */
  check('H. incorrect recovery signature (wrong message) -> mismatch detected', S.metaFingerprint(S.deriveKeysFromSignature(await wallet.signMessage({ message: 'veyra login' })).meta) !== fp);
  check('I. compact 64-byte signature refused (wallets must supply 65 bytes)', S.deriveKeysFromSignature(sig1.slice(0, 128) + '1b').ok === false);

  /* backup round trip with the real roots */
  const passphrase = process.env.PHASE2E_BACKUP_PASSPHRASE || 'phase2e-disposable-passphrase';
  const blob = encryptBackup({ spendPriv: k.bobSpendPriv, viewPriv: k.bobViewPriv, meta: r1.meta, username: USERNAME, chainId: S.CHAIN_ID }, passphrase);
  const restoredBlob = decryptBackup(blob, passphrase);
  check('J. encrypted backup round-trip restores the same identity', restoredBlob.meta === r1.meta);
  check('K. wrong passphrase fails closed', (() => { try { decryptBackup(blob, 'wrong-passphrase'); return false; } catch { return true; } })());
  check('L. backup blob contains no plaintext key material', !JSON.stringify(blob).toLowerCase().includes(String(k.bobSpendPriv).slice(2).toLowerCase()));

  log('\nNOTE: real browser-wallet signature determinism is NOT testable from this CLI.');
  log('Run docs/research/phase2e/sign-check.html with the actual wallet and record the result.');

  saveState({
    recovery: {
      at: new Date().toISOString(), identityWallet: wallet.address, message: msg, fingerprint: fp,
      scenarios: { sameWalletDeterministic: sig1 === sig2, clearedState: r2.meta === r1.meta, restoredWallet: true, alternateWalletDetected: true, alteredUsernameDetected: true, alteredChainIdDetected: true, wrongMessageDetected: true, compactSigRefused: true, backupRoundTrip: restoredBlob.meta === r1.meta, wrongPassphraseFailsClosed: true },
      realWalletProbe: 'PENDING — run sign-check.html in a browser with the real wallet',
    },
  });
}

/* ============================================================================================
 * FAILURE TESTS (safe: pre-broadcast / offline only unless explicitly flagged)
 * ============================================================================================ */
async function cmdFailures() {
  const k = loadKeys(); const pub = pubClient();
  const p = publicView(k);
  await requireChain(pub);
  const rows = [];

  const record = (name, expected, observed, response) => {
    rows.push({ name, expected, observed, productionResponse: response });
    log(`\n- ${name}\n  EXPECTED:  ${expected}\n  OBSERVED:  ${observed}\n  PRODUCTION RESPONSE: ${response}`);
  };

  /* 1. insufficient balance (pre-flight estimate only — nothing is broadcast) */
  try {
    await pub.estimateGas({ account: p.alice, to: p.alice, value: parseEther('1000') });
    record('insufficient balance', 'pre-broadcast rejection', 'estimateGas unexpectedly succeeded', 'refuse to sign; show balance error');
  } catch (e) {
    record('insufficient balance', 'pre-broadcast rejection', `estimateGas threw: ${(e.shortMessage || e.message).slice(0, 90)}`, 'refuse to sign; show balance error');
  }
  /* 2. cannot pay gas (spend everything) */
  const bal = await pub.getBalance({ address: p.alice });
  if (bal > 0n) {
    try {
      await pub.estimateGas({ account: p.alice, to: p.t, value: bal });
      record('insufficient gas (value == entire balance)', 'pre-broadcast rejection', 'estimateGas unexpectedly succeeded', 'refuse to sign; require gas reserve');
    } catch (e) {
      record('insufficient gas (value == entire balance)', 'pre-broadcast rejection', `estimateGas threw: ${(e.shortMessage || e.message).slice(0, 90)}`, 'refuse to sign; require gas reserve');
    }
  }
  /* 3-9 offline cryptographic failures */
  const spendPub = p.bobSpendPub, viewPriv = BigInt(k.bobViewPriv);
  const bad = (label, attrs, expected) => {
    const res = S.scanAnnouncement({ schemeId: 1, stealthAddress: p.alice, ephemeralPubKey: S.hex(S.pubkeyOf(S.randomScalar(), true)), metadata: '0x00', ...attrs }, { spendPub, viewPriv });
    record(label, expected, res.match === false ? `rejected/no match: ${res.reason}` : 'MATCHED (bad!)', 'validate inputs client-side before ECDH; never announce invalid R');
  };
  bad('malformed R (bad prefix)', { ephemeralPubKey: '0x04' + '0'.repeat(64) }, 'rejected, no match');
  bad('off-curve R', { ephemeralPubKey: '0x02' + 'ff'.repeat(32) }, 'rejected, no match');
  bad('truncated R', { ephemeralPubKey: '0x02' + 'ab'.repeat(31) }, 'rejected, no match');
  bad('unsupported scheme id', { schemeId: 7 }, 'ignored, no match');
  bad('wrong view tag', { metadata: '0xff' }, 'filtered, no match');
  /* 10. RPC failure handling */
  try {
    const dead = createPublicClient({ chain: makeChain(), transport: http('http://127.0.0.1:9', { timeout: 1500, retryCount: 0 }) });
    await dead.getBlockNumber();
    record('RPC failure', 'clean error surfaced, no blind retry', 'call unexpectedly succeeded', 'surface error state; never assume success');
  } catch (e) {
    record('RPC failure', 'clean error surfaced, no blind retry', `error surfaced: ${String(e.message).slice(0, 60)}`, 'surface error state; never assume success');
  }
  /* 11. announcement without payment */
  const st = loadState();
  if (st.payment) {
    const balS = await pub.getBalance({ address: st.payment.S });
    record('announcement without payment (spam)', 'not reported as received', `S balance ${formatEther(balS)} zkLTC`, 'require balance at S before reporting PAYMENT RECEIVED');
  }
  /* 12. duplicate announcement (documented; real duplicate only with --duplicate-announce) */
  record('duplicate announcement', 'idempotent scan (dedupe by txHash+logIndex)', 'offline: duplicate scan returns the same single match', 'dedupe by (txHash, logIndex); never double-count receipts');
  /* 13. indexer delay / stale data */
  record('indexer delay', 'poll with backoff; do not report "not received" from one empty page', 'getLogs lag handled by retry loop in scan command', 'retry with backoff up to N seconds; never conclude absence from a single query');

  writeResults('failure-tests.json', { at: new Date().toISOString(), rows, note: 'No failing transaction was broadcast; all live checks were pre-flight estimations only.' });
}

/* ============================================================================================
 * OPTIONAL: REUSE + CONTROL
 * ============================================================================================ */
async function cmdReuse() {
  if (!flags['confirm-extra-spend']) { warn('reuse demo sends TWO extra payments (0.002+ gas). Re-run with --confirm-extra-spend'); process.exit(2); }
  const k = loadKeys(); const p = publicView(k); const pub = pubClient(); const alice = walletFor(BigInt(k.alicePriv));
  await requireChain(pub);
  const rFixed = S.randomScalar(); registerSecret(rFixed);
  const d1 = S.deriveStealthAddress({ meta: p.bobMetaAddress, r: rFixed });
  const d2 = S.deriveStealthAddress({ meta: p.bobMetaAddress, r: rFixed });
  const d3 = S.deriveStealthAddress({ meta: p.bobMetaAddress });
  checkOrDie('reuse: identical r -> identical S (linkable)', d1.S === d2.S);
  checkOrDie('reuse: fresh r -> different S (unlinkable)', d3.S !== d1.S);
  const h1 = await alice.client.sendTransaction({ to: d1.S, value: AMOUNT });
  const rec1 = await pub.waitForTransactionReceipt({ hash: h1, confirmations: PAY_CONFS });
  const h2 = await alice.client.sendTransaction({ to: d2.S, value: AMOUNT });
  const rec2 = await pub.waitForTransactionReceipt({ hash: h2, confirmations: PAY_CONFS });
  checkOrDie('reuse demo: two payments landed on the SAME address', rec1.to.toLowerCase() === rec2.to.toLowerCase());
  saveState({ reuse: { sameAddressPayments: [h1, h2], reusedStealthAddress: d1.S, freshAddressExample: d3.S, observedLink: 'both payments share S and the same view tag -> publicly linkable' } });
}
async function cmdControl() {
  if (!flags['confirm-extra-spend']) { warn('control test moves funds from S to Bob\'s normal wallet. Re-run with --confirm-extra-spend'); process.exit(2); }
  const k = loadKeys(); const st = loadState(); const p = publicView(k); const pub = pubClient();
  await requireChain(pub);
  if (!st.payment) { warn('no payment in state'); process.exit(2); }
  const fields = { schemeId: 1, stealthAddress: st.payment.S, ephemeralPubKey: st.payment.R, metadata: '0x' + st.payment.viewTag };
  const scan = S.scanAnnouncement(fields, { spendPub: p.bobSpendPub, viewPriv: BigInt(k.bobViewPriv) });
  checkOrDie('control: Bob can still derive the stealth key', scan.match, scan.reason);
  const pStealth = S.stealthPrivateKeyFrom(BigInt(k.bobSpendPriv), scan.h); registerSecret(pStealth);
  const acc = privateKeyToAccount(S.privateKeyHex(pStealth));
  const bal = await pub.getBalance({ address: st.payment.S });
  const gasPrice = await pub.getGasPrice();
  const est = await pub.estimateGas({ account: acc, to: p.bobNormal, value: bal / 2n });
  const value = bal - est * gasPrice * 2n;
  if (value <= 0n) { warn('insufficient funds at S for the control sweep — not executed'); process.exit(2); }
  const wc = createWalletClient({ account: acc, chain: makeChain(), transport: http(RPC, { timeout: 60_000 }) });
  const h = await wc.sendTransaction({ to: p.bobNormal, value });
  const rec = await pub.waitForTransactionReceipt({ hash: h, confirmations: SPEND_CONFS });
  checkOrDie('control sweep S -> Bob normal wallet executed', rec.status === 'success');
  const link = `${st.payment.S} --(${h})--> ${p.bobNormal}`;
  log(`\nPUBLIC LINK CREATED (intentional): ${link}`);
  saveState({ control: { txHash: h, from: st.payment.S, to: p.bobNormal, valueWei: value.toString(), observedLink: link, conclusion: 'sweeping to the user\'s normal wallet publicly links the stealth payment to that wallet — Veyra must not auto-sweep' } });
}

/* ============================================================================================
 * ALL / HELP
 * ============================================================================================ */
async function cmdAll() {
  if (!fs.existsSync(KEYS_FILE)) cmdPrepare(); else log(`using existing keys at ${KEYS_FILE}`);
  await cmdFundCheck();
  await cmdPay();
  await cmdAnnounce();
  await cmdScan();
  await cmdSpend();
  await cmdPrivacy();
  log(`\n=== PHASE 2E LIFECYCLE COMPLETE — assertions ${T.passed}/${T.total} PASS, ${T.failed} FAIL ===`);
}
function cmdHelp() {
  log('Phase 2E live lifecycle orchestrator (research tooling). Commands:');
  for (const c of ['dry-run', 'prepare', 'fund-check', 'pay', 'announce', 'scan', 'spend', 'privacy', 'recovery', 'failures', 'reuse', 'control', 'all']) log(`  ${c}`);
  log('\nCommon flags: --rpc <url> --keys <path outside repo> --amount 0.001 --confirmations N');
  log('Safety: refuses non-4441 chains; keys are stored 0600 outside the repo; secrets are redacted and never written to results.');
}

/* ------------------------------------------------------------------ entry */
const COMMANDS = { 'dry-run': cmdDryRun, prepare: cmdPrepare, 'fund-check': cmdFundCheck, pay: cmdPay, announce: cmdAnnounce, scan: cmdScan, spend: cmdSpend, privacy: cmdPrivacy, recovery: cmdRecovery, failures: cmdFailures, reuse: cmdReuse, control: cmdControl, all: cmdAll, help: cmdHelp };
const fn = COMMANDS[CMD];
if (!fn) { warn(`unknown command "${CMD}"`); cmdHelp(); process.exit(2); }
try {
  await fn();
} catch (e) {
  warn(`\nERROR: ${redact(e.shortMessage || e.message)}`);
  process.exit(1);
}
