import { eq, sql } from 'drizzle-orm';
import { BUILTIN_THEMES } from '@memento/shared';
import { env } from '../env.js';
import { defaultBookPages } from '../lib/book-template.js';
import { createDb, type Db } from './client.js';
import * as s from './schema.js';
import { SEED_BASE_PROMPT, SEED_CAPTION_STYLES, SEED_FAMILY_NAME, SEED_HOUSEHOLDS, SEED_MEMBERS } from './seed-data.js';

/**
 * Idempotent. Themes and caption styles are inserted if missing and never overwritten,
 * so GUI edits survive a re-run. Households, members and books are seeded only into an empty DB.
 */
export async function seed(db: Db, opts: { adminEmail: string; year?: number }) {
  const year = opts.year ?? new Date().getFullYear();
  const log: string[] = [];

  await db
    .insert(s.themes)
    .values(BUILTIN_THEMES.map((t, i) => ({ ...t, flags: t.flags ?? null, builtin: true, sortOrder: i })))
    .onConflictDoNothing();

  await db
    .insert(s.captionStyles)
    .values(SEED_CAPTION_STYLES.map((st, i) => ({ ...st, builtin: true, sortOrder: i })))
    .onConflictDoNothing();

  const [warm] = await db.select().from(s.captionStyles).where(eq(s.captionStyles.key, 'warm'));
  const inserted = await db
    .insert(s.settings)
    .values({ id: 1, familyName: SEED_FAMILY_NAME, aiBasePrompt: SEED_BASE_PROMPT, aiVoiceStyleId: warm?.id ?? null })
    .onConflictDoNothing()
    .returning({ id: s.settings.id });
  if (inserted.length) log.push('settings');

  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(s.households)) as [{ n: number }];
  if (n > 0) {
    log.push('households already present, skipped family seed');
    return log;
  }

  await db.transaction(async (tx) => {
    const hhIds = new Map<string, string>();
    for (const [i, h] of SEED_HOUSEHOLDS.entries()) {
      const [row] = await tx.insert(s.households).values({ name: h.name, surname: h.surname, sortOrder: i }).returning();
      hhIds.set(h.key, row!.id);
      const [book] = await tx
        .insert(s.books)
        .values({ householdId: row!.id, kind: 'main', ...h.book, locked: true, pinHash: null, sortOrder: i })
        .returning();
      await tx.insert(s.pages).values(defaultBookPages(year).map((p) => ({ ...p, bookId: book!.id })));
    }
    await tx.insert(s.users).values(
      SEED_MEMBERS.map((m) => ({
        name: m.name,
        roleLabel: m.roleLabel,
        access: m.access,
        householdId: m.household ? hhIds.get(m.household)! : null,
        email: 'isAdmin' in m ? opts.adminEmail.toLowerCase() : null,
      })),
    );
  });
  log.push(`${SEED_HOUSEHOLDS.length} households with main books`, `${SEED_MEMBERS.length} members`);
  return log;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const e = env();
  const { db, close } = createDb(e.DATABASE_URL, { max: 1 });
  seed(db, { adminEmail: e.ADMIN_EMAIL })
    .then((log) => console.log('Seeded:', log.join(', ')))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(close);
}
