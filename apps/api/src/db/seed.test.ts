import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq, isNotNull } from 'drizzle-orm';
import { createTestDb } from '../test/db.js';
import type { Db } from './client.js';
import { seed } from './seed.js';
import * as s from './schema.js';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await seed(db, { adminEmail: 'Admin@Example.com', year: 2026 });
});
afterAll(() => close());

describe('seed', () => {
  it('creates five households, each with one locked main book and no PIN', async () => {
    const hh = await db.select().from(s.households);
    const books = await db.select().from(s.books);
    expect(hh).toHaveLength(5);
    expect(books).toHaveLength(5);
    expect(books.every((b) => b.kind === 'main' && b.locked && b.pinHash === null)).toBe(true);
  });

  it('gives only the admin an email', async () => {
    const withEmail = await db.select().from(s.users).where(isNotNull(s.users.email));
    expect(withEmail).toHaveLength(1);
    expect(withEmail[0]).toMatchObject({ name: 'Marco', access: 'admin', email: 'admin@example.com' });
    expect(await db.select().from(s.users)).toHaveLength(11);
  });

  it('starts every book with front matter, one empty year and back matter', async () => {
    const [book] = await db.select().from(s.books).limit(1);
    const pages = await db.select().from(s.pages).where(eq(s.pages.bookId, book!.id)).orderBy(asc(s.pages.position));
    expect(pages.map((p) => p.layout ?? p.type)).toEqual(['endpaper', 'title', 'index', 'chapters', 'summaryL', 'summaryR', 'closing', 'backpaper']);
    expect(pages[4]!.year).toBe(2026);
    expect(await db.select().from(s.photos)).toHaveLength(0);
  });

  it('seeds themes, caption styles and settings', async () => {
    expect(await db.select().from(s.themes)).toHaveLength(8);
    const styles = await db.select().from(s.captionStyles);
    expect(styles.map((x) => x.key).sort()).toEqual(['playful', 'poetic', 'short', 'warm']);
    const [st] = await db.select().from(s.settings);
    expect(st!.aiBasePrompt).toContain('{family}');
    expect(st!.aiVoiceStyleId).toBe(styles.find((x) => x.key === 'warm')!.id);
    expect(st!.aiEndpoint).toBe('');
  });

  it('is idempotent and keeps GUI edits', async () => {
    await db.update(s.captionStyles).set({ prompt: 'edited' }).where(eq(s.captionStyles.key, 'warm'));
    await seed(db, { adminEmail: 'admin@example.com', year: 2026 });
    expect(await db.select().from(s.households)).toHaveLength(5);
    const [warm] = await db.select().from(s.captionStyles).where(eq(s.captionStyles.key, 'warm'));
    expect(warm!.prompt).toBe('edited');
  });
});
