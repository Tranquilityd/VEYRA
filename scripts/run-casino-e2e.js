import { spawn } from 'node:child_process';

const raw = process.env.E2E_DATABASE_URL;
if (!raw) throw new Error('E2E_DATABASE_URL is required for the isolated casino E2E test');
let url;
try { url = new URL(raw); } catch { throw new Error('E2E_DATABASE_URL must be a valid PostgreSQL URL'); }
if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('E2E_DATABASE_URL must use PostgreSQL');
const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
if (!/(?:^|[_-])(test|e2e)(?:$|[_-])/i.test(databaseName)) throw new Error('E2E database name must be explicitly marked test or e2e');
const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
if (!local && process.env.E2E_ALLOW_REMOTE_DATABASE !== '1') throw new Error('Remote E2E database requires E2E_ALLOW_REMOTE_DATABASE=1');
if (/prod(?:uction)?/i.test(`${url.hostname}/${databaseName}`)) throw new Error('Refusing a database URL that appears to be production');

const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: raw };
const files = ['test/e2e/casino-flow.test.js', 'test/e2e/arcade-flow.test.js'];
const run = index => {
  const child = spawn(process.execPath, ['--test', files[index]], { cwd: process.cwd(), stdio: 'inherit', env });
  child.on('exit', code => {
    if (code) { process.exitCode = code; return; }
    if (index + 1 < files.length) run(index + 1);
  });
};
run(0);
