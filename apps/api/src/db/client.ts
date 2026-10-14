import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

/** Works with postgres-js in the app and PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(client, { schema }) as unknown as Db;
  return { db, close: () => client.end() };
}

export { schema };
