import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../env.js';

/** Finds the drizzle/ folder in dev (src/db) and in the bundle (dist). */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../../drizzle', '../drizzle', './drizzle']) {
    const p = path.resolve(here, rel);
    if (existsSync(path.join(p, 'meta'))) return p;
  }
  throw new Error('Could not find the drizzle migrations folder');
}

export async function runMigrations(url: string) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: migrationsFolder() });
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations(env().DATABASE_URL)
    .then(() => console.log('Migrations applied'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
