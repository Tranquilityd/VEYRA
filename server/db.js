import postgres from 'postgres';
import { env } from './env.js';

let client;
export function db() {
  if (!client) client = postgres(env.databaseUrl(), {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl: 'require',
  });
  return client;
}

export async function withTransaction(fn) {
  return db().begin(async (tx) => fn(tx));
}

export async function closeDatabaseForTests() {
  if (process.env.NODE_ENV !== 'test') throw new Error('TEST_DATABASE_LIFECYCLE_FORBIDDEN');
  if (client) await client.end({ timeout: 5 });
  client = undefined;
}
