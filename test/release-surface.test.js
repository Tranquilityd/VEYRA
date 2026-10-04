import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const casino=readFileSync(new URL('../src/games/casinoWagering.js',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const game=readFileSync(new URL('../src/core/Game.js',import.meta.url),'utf8');

test('development casino mock cannot be enabled on a public hostname',()=>{
  assert.match(casino,/developmentHost=\['localhost','127\.0\.0\.1'\]\.includes\(location\.hostname\)/);
  assert.match(casino,/this\.mock=developmentHost&&new URLSearchParams/);
});

test('browser self-test and debug renderer are localhost-only',()=>{
  assert.match(main,/developmentHost && new URLSearchParams\(location\.search\)\.has\('test'\)/);
  assert.match(game,/\['localhost', '127\.0\.0\.1'\]\.includes\(location\.hostname\) && new URLSearchParams/);
});
