import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import * as s from '../db/schema.js';

/** Title-page text (script line, title, …) for each book, keyed by book id. */
export async function titleTexts(db: Db, bookIds: string[]) {
  const out = new Map<string, Record<string, string>>();
  if (!bookIds.length) return out;
  const rows = await db
    .select({ bookId: s.pages.bookId, text: s.pages.text })
    .from(s.pages)
    .where(and(inArray(s.pages.bookId, bookIds), eq(s.pages.type, 'title')));
  for (const r of rows) out.set(r.bookId, r.text ?? {});
  return out;
}
