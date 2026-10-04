import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
const logo=readFileSync(new URL('../assets/brand/veyrawld-logo.jpg',import.meta.url));
const sha256=value=>createHash('sha256').update(value).digest('hex');

test('public metadata consistently brands the experience as VEYRAWLD without phase labels',()=>{
  const head=html.slice(html.indexOf('<head>'),html.indexOf('</head>'));
  assert.doesNotMatch(head,/Phase 1|Development Phase|Test Phase/i);
  assert.match(head,/<title>VEYRAWLD<\/title>/);
  for(const field of ['application-name','apple-mobile-web-app-title','twitter:title']) assert.match(head,new RegExp(`<meta name="${field}" content="VEYRAWLD">`));
  for(const field of ['og:title','og:site_name']) assert.match(head,new RegExp(`<meta property="${field}" content="VEYRAWLD">`));
  assert.match(head,/meta name="description" content="Explore VEYRAWLD,/);
  assert.match(head,/property="og:description"/);
  assert.match(head,/name="twitter:description"/);
});

test('official supplied logo is preserved exactly and used for icons, previews and key brand surfaces',()=>{
  assert.equal(logo.length,19215);
  assert.equal(sha256(logo),'5514e2775ebf3a9308acb0a7ad61840666b2ea1940f3b722e3e6feaa9e047d90');
  for(const marker of ['rel="icon"','rel="apple-touch-icon"','property="og:image"','name="twitter:image"','class="official-brand-logo"','class="boot-brand-logo"']) assert.ok(html.includes(marker),marker);
  assert.equal((html.match(/assets\/brand\/veyrawld-logo\.jpg/g)||[]).length,8);
});

test('web app manifest uses VEYRAWLD and the official logo',()=>{
  assert.equal(manifest.name,'VEYRAWLD');
  assert.equal(manifest.short_name,'VEYRAWLD');
  assert.equal(manifest.icons[0].src,'/assets/brand/veyrawld-logo.jpg');
  assert.equal(manifest.icons[0].sizes,'676x774');
});
