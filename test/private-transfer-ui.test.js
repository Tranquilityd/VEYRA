// Phase 3 — private transfer UI surface, copy rules and wiring (brief §12/§17/§19).
// These are static/structural assertions: the panel renders in a browser, but the
// guarantees that matter here (no address leak, no anonymity claim, no route that
// auto-opens the panel) are all provable from the shipped source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATE_COPY, ERROR_COPY } from '../src/ui/PrivateTransferPanel.js';
import { TRANSFER_STATES, FAILURE_CODES } from '../src/stealth/transferState.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const panel = read('src/ui/PrivateTransferPanel.js');
const session = read('src/systems/PrivateTransferSession.js');
const css = read('styles/private-transfer.css');
const html = read('index.html');
const game = read('src/core/Game.js');

const SURFACE = { panel, session, css, html, game };

/* ------------------------------------------------------------------ copy rules */
test('no shipped surface claims anonymity or untraceability', () => {
  for (const [name, source] of Object.entries(SURFACE)) {
    assert.equal(/anonymous/i.test(source), false, `${name} must not use the word`);
    assert.equal(/anonymity/i.test(source), false, `${name} must not use the word`);
    assert.equal(/untraceab/i.test(source), false, `${name} must not claim untraceability`);
    assert.equal(/100% private/i.test(source), false, `${name} must not overstate the guarantee`);
  }
  assert.equal(/anonymous/i.test(JSON.stringify(STATE_COPY) + JSON.stringify(ERROR_COPY)), false);
});

test('the promise is stated exactly as specified', () => {
  assert.match(panel, /Recipient-address privacy/);
  assert.match(panel, /Bob’s normal wallet address is not exposed by this payment\./);
  assert.equal(STATE_COPY.completed, 'Private payment complete.');
  assert.equal(STATE_COPY.failed, 'The private payment could not be completed.');
});

test('the recipient is shown by username and the destination as a fresh address', () => {
  assert.match(panel, /placeholder = 'bob\.veyra'/);
  assert.match(panel, /Destination: Fresh private address/);
  assert.match(panel, /fresh private address/i);
});

test('every state of the machine has player-facing copy', () => {
  for (const state of TRANSFER_STATES) {
    assert.equal(typeof STATE_COPY[state], 'string', `${state} needs copy`);
  }
  for (const code of [
    FAILURE_CODES.ANNOUNCEMENT_FAILED, FAILURE_CODES.TRANSACTION_REJECTED, FAILURE_CODES.WRONG_NETWORK,
    FAILURE_CODES.INSUFFICIENT_BALANCE, FAILURE_CODES.INSUFFICIENT_GAS, FAILURE_CODES.RECIPIENT_NOT_ENROLLED,
    FAILURE_CODES.RECIPIENT_NOT_FOUND, FAILURE_CODES.INVALID_RECIPIENT_META, FAILURE_CODES.TIMEOUT,
  ]) {
    assert.equal(typeof ERROR_COPY[code], 'string', `${code} needs copy`);
  }
});

test('the announcement-failure copy never suggests resending the payment', () => {
  const copy = ERROR_COPY[FAILURE_CODES.ANNOUNCEMENT_FAILED];
  assert.match(copy, /never re-sent/);
  assert.equal(/send again|resend the (payment|zkLTC)|try sending/i.test(copy), false);
  assert.match(panel, /PUBLISH PAYMENT NOTICE ONLY/);
  assert.match(panel, /publishing the notice again never moves funds/);
});

/* ------------------------------------------------------------------ leak audit */
test('the UI never renders a wallet address', () => {
  // No interpolation of an address-shaped value into the panel at all.
  assert.equal(/walletAddress|recipientAddress|normalWalletAddress/.test(panel), false);
  assert.equal(/short\(/.test(panel), false, 'no address-shortening helper is imported into the panel');
  assert.equal(/0x\$\{|slice\(0, 6\)/.test(panel), false);
  // The session bridge exposes the account but the panel never reads it.
  assert.match(session, /get account\(\)/);
  assert.equal(/session\.account|this\.session\.account/.test(panel), false);
});

test('the panel and session never touch key material directly', () => {
  // The panel is pure presentation: it never names a private key at all.
  for (const identifier of ['spendingPrivateKey', 'viewingPrivateKey', 'siskPrivateKey', 'stealthPrivateKey']) {
    assert.equal(panel.includes(identifier), false, `the panel must not handle ${identifier}`);
  }
  // The session may pass public/derived material through to the client, but must never
  // assign key material to its own state.
  assert.equal(/this\.[a-zA-Z_]*\s*=\s*[^;]*PrivateKey/.test(session), false, 'the session must not store key material');
  assert.equal(/localStorage\?*\.setItem\([^)]*priv/i.test(panel + session), false);
  assert.equal(/console\.log/.test(panel), false, 'no logging of anything in the panel');
  assert.equal(/console\.log/.test(session), false);
});

test('nothing sensitive is placed in a URL or in a query string', () => {
  for (const [name, source] of Object.entries(SURFACE)) {
    assert.equal(/\?[^'"`]*fingerprint=/i.test(source), false, `${name} must not put a fingerprint in a URL`);
    assert.equal(/\?[^'"`]*(key|signature)=/i.test(source), false, `${name} must not put key material in a URL`);
  }
  // The only query the panel/session build is the unpaginated public resolve.
  assert.match(session, /\/api\/private-transfer\/me/);
});

/* ------------------------------------------------------------------ wiring */
test('the HUD chip exists, is labelled and does not auto-open the panel', () => {
  assert.match(html, /id="chip-private"/);
  assert.match(html, /PRIVATE TRANSFER/);
  assert.match(html, /RECIPIENT-ADDRESS PRIVACY/);
  assert.match(html, /styles\/private-transfer\.css/);
  assert.match(panel, /document\.getElementById\('chip-private'\)/);
  assert.match(panel, /addEventListener\('click'/);
  assert.equal(/autoOpen|auto-open|setTimeout\(/.test(panel), false, 'the panel never opens itself on a timer');
});

test('the panel is constructed by the game and never blocks gameplay', () => {
  assert.match(game, /new PrivateTransferSession\(this\)/);
  assert.match(game, /new PrivateTransferPanel\(this\)/);
  assert.match(game, /privateTransferPanel\?\.refresh\?\.\(\)\.catch/);
  // The panel must not be constructed before the wallet/identity systems it reads.
  const walletIndex = game.indexOf('this.walletSession = new LitvmWalletSession');
  const sessionIndex = game.indexOf('this.privateTransfer = new PrivateTransferSession');
  const panelIndex = game.indexOf('this.privateTransferPanel = new PrivateTransferPanel');
  assert.ok(walletIndex !== -1 && sessionIndex > walletIndex && panelIndex > sessionIndex);
});

test('landscape and small screens are supported by the panel stylesheet', () => {
  assert.match(css, /orientation:landscape/);
  assert.match(css, /max-height:520px/);
  assert.match(css, /\.private-card\{[^}]*max-height:min\(92vh/);
  assert.match(css, /-webkit-overflow-scrolling:touch/, 'the card scrolls on mobile');
});

test('the panel exposes setup, recovery, backup, send, retry and scan controls', () => {
  for (const label of [
    'CREATE PRIVATE IDENTITY', 'RECOVER FROM WALLET SIGNATURE', 'EXPORT ENCRYPTED BACKUP',
    'IMPORT ENCRYPTED BACKUP', 'SEND PRIVATELY', 'PUBLISH PAYMENT NOTICE ONLY', 'SCAN FOR PAYMENTS',
  ]) {
    assert.match(panel, new RegExp(label), `${label} is missing`);
  }
  assert.match(panel, /RECOVERY_LOSS_WARNING/);
  assert.match(panel, /How private transfers work/);
  assert.match(panel, /not anonymously|does not hide the amount or the timing/);
});

test('create and recover are separate, deliberate actions', () => {
  assert.match(panel, /_createIdentity\(\)/);
  assert.match(panel, /_recoverIdentity\(\)/);
  assert.match(panel, /Automatic recovery is refused|RECOVERY_FINGERPRINT_MISMATCH|different private identity/);
});
