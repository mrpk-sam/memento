import { and, asc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import * as s from '../db/schema.js';
import type { Storage } from './s3.js';

const DAY = 86_400_000;
/** Soft-deleted things stay restorable (Undo) for this long, then go for good. */
export const PURGE_AFTER_DAYS = 30;

/**
 * Housekeeping, run hourly:
 * - expired sessions, magic links, unlocks and old PIN attempts
 * - uploads that were never processed (older than a day)
 * - photos, videos, inbox items, books, households and people soft-deleted over 30 days ago, with their files
 * - extra month spreads left empty
 */
export async function runMaintenance(db: Db, storage: Storage, now = new Date()) {
  const dayAgo = new Date(now.getTime() - DAY);
  const purgeBefore = new Date(now.getTime() - PURGE_AFTER_DAYS * DAY);
  const report: Record<string, number> = {};
  const count = async (k: string, p: Promise<unknown[]>) => (report[k] = (await p).length);

  await count('sessions', db.delete(s.sessions).where(lt(s.sessions.expiresAt, now)).returning({ id: s.sessions.id }));
  await count('magicLinks', db.delete(s.magicLinks).where(lt(s.magicLinks.expiresAt, dayAgo)).returning({ id: s.magicLinks.id }));
  await count('unlocks', db.delete(s.bookUnlocks).where(lt(s.bookUnlocks.expiresAt, now)).returning({ id: s.bookUnlocks.bookId }));
  await count('pinAttempts', db.delete(s.pinAttempts).where(lt(s.pinAttempts.at, dayAgo)).returning({ id: s.pinAttempts.id }));

  const stale = (await storage.list('uploads/')).filter((o) => o.lastModified < dayAgo);
  for (const o of stale) await storage.delete(o.key);
  report.staleUploads = stale.length;

  // Photos: files first, then rows. A purged hero photo is detached from its title page.
  const photos = await db.select().from(s.photos).where(and(isNotNull(s.photos.deletedAt), lt(s.photos.deletedAt, purgeBefore)));
  for (const p of photos) await removeKeys(storage, [p.objectKey, p.displayKey, p.thumbKey, p.videoKey]);
  if (photos.length) {
    const ids = photos.map((p) => p.id);
    await db.update(s.pages).set({ heroPhotoId: null }).where(inArray(s.pages.heroPhotoId, ids));
    await db.delete(s.photos).where(inArray(s.photos.id, ids));
  }
  report.photos = photos.length;

  const items = await db.select().from(s.inboxItems).where(and(isNotNull(s.inboxItems.deletedAt), lt(s.inboxItems.deletedAt, purgeBefore)));
  for (const it of items) await removeKeys(storage, [it.objectKey, it.displayKey, it.thumbKey, it.videoKey]);
  if (items.length) await db.delete(s.inboxItems).where(inArray(s.inboxItems.id, items.map((i) => i.id)));
  report.inboxItems = items.length;

  // Books cascade to their pages and photos in the DB; their files go by prefix.
  const books = await db.select({ id: s.books.id }).from(s.books).where(and(isNotNull(s.books.deletedAt), lt(s.books.deletedAt, purgeBefore)));
  for (const b of books) for (const o of await storage.list(`books/${b.id}/`)) await storage.delete(o.key);
  if (books.length) await db.delete(s.books).where(inArray(s.books.id, books.map((b) => b.id)));
  report.books = books.length;

  const households = await db
    .delete(s.households)
    .where(and(isNotNull(s.households.deletedAt), lt(s.households.deletedAt, purgeBefore)))
    .returning({ id: s.households.id });
  report.households = households.length;

  const users = await db.delete(s.users).where(and(isNotNull(s.users.deletedAt), lt(s.users.deletedAt, purgeBefore))).returning({ id: s.users.id });
  report.users = users.length;

  report.emptySpreads = await dropEmptyMonthSpreads(db);

  // Decided access requests.
  await db.delete(s.accessRequests).where(and(isNotNull(s.accessRequests.decidedAt), lt(s.accessRequests.decidedAt, purgeBefore)));

  // Deleted caption styles and custom themes no page uses.
  await db.delete(s.captionStyles).where(and(isNotNull(s.captionStyles.deletedAt), lt(s.captionStyles.deletedAt, purgeBefore), eq(s.captionStyles.builtin, false)));
  await db
    .delete(s.themes)
    .where(
      and(
        isNotNull(s.themes.deletedAt),
        lt(s.themes.deletedAt, purgeBefore),
        eq(s.themes.builtin, false),
        sql`not exists (select 1 from ${s.pages} where ${s.pages.themeId} = ${s.themes.id})`,
      ),
    );
  return report;
}

async function removeKeys(storage: Storage, keys: (string | null)[]) {
  for (const k of keys) if (k) await storage.delete(k).catch(() => {});
}

/**
 * Removes extra month spreads (monthMore pairs) with no photo on either page, not even a deleted
 * one that Undo could bring back, then closes up the book's page positions. It runs here, not
 * when photos leave, so Undo always finds the pages it needs.
 */
export async function dropEmptyMonthSpreads(db: Db) {
  const empty = await db
    .select({ id: s.pages.id, bookId: s.pages.bookId })
    .from(s.pages)
    .where(and(eq(s.pages.layout, 'monthMore'), sql`not exists (select 1 from ${s.photos} where ${s.photos.pageId} = ${s.pages.id})`));
  const emptyIds = new Set(empty.map((p) => p.id));
  let dropped = 0;
  for (const bookId of new Set(empty.map((p) => p.bookId))) {
    const rows = await db.select({ id: s.pages.id, layout: s.pages.layout }).from(s.pages).where(eq(s.pages.bookId, bookId)).orderBy(asc(s.pages.position));
    // Extra spreads follow a month's right page in pairs; only a pair with both pages empty goes.
    const drop: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]!.layout !== 'monthMore' || rows[i - 1]?.layout === 'monthMore') continue;
      for (let j = i; rows[j]?.layout === 'monthMore' && rows[j + 1]?.layout === 'monthMore'; j += 2) {
        if (emptyIds.has(rows[j]!.id) && emptyIds.has(rows[j + 1]!.id)) drop.push(rows[j]!.id, rows[j + 1]!.id);
      }
    }
    if (!drop.length) continue;
    await db.transaction(async (tx) => {
      await tx.delete(s.pages).where(inArray(s.pages.id, drop));
      const keep = rows.filter((r) => !drop.includes(r.id));
      for (const [position, r] of keep.entries()) await tx.update(s.pages).set({ position }).where(eq(s.pages.id, r.id));
    });
    dropped += drop.length / 2;
  }
  return dropped;
}
