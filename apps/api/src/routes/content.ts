import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bookName, bookOwnerName, canEditBook, chapterSpan, familyOf, hasMonthChapter, monthChapterPages, monthInsertAt, monthMorePages, nextYear, spreadsToAdd, yearBlockPages, yearInsertAt } from '@memento/shared';
import type { Db } from '../db/client.js';
import * as s from '../db/schema.js';
import { loadPages, type PageDto } from '../lib/content.js';
import { HttpError, badRequest, forbidden, notFound, parse } from '../lib/http.js';
import { requireUser, type SessionUser } from '../lib/session.js';
import { hasUnlock } from './books.js';

export async function contentRoutes(app: FastifyInstance) {
  const { db, storage } = app.deps;

  app.get<{ Params: { id: string } }>('/api/books/:id', async (req) => {
    const user = requireUser(req);
    return loadBookContent(db, user, req.params.id);
  });

  app.get('/api/themes', async (req) => {
    requireUser(req);
    const rows = await db.select().from(s.themes).where(isNull(s.themes.deletedAt)).orderBy(asc(s.themes.sortOrder), asc(s.themes.createdAt));
    return rows.map((t) => ({ id: t.id, name: t.name, paper: t.paper, ink: t.ink, accent: t.accent, accent2: t.accent2, motif: t.motif, flags: t.flags ?? [], stickerPack: t.stickerPack, builtin: t.builtin }));
  });

  /**
   * Image and video proxy. The bucket stays private; signed-in users get media through here.
   * Keys are unique per photo and never rewritten, so they can be cached forever.
   * A single byte range is passed through: Safari only plays video that it can fetch in ranges.
   */
  app.get<{ Params: { '*': string } }>('/api/media/*', async (req, reply) => {
    const user = requireUser(req);
    const key = req.params['*'];
    if (!/^(books\/[\w-]+\/[\w-]+|inbox\/[\w-]+)\/((orig|1600|400)\.jpg|video\.mp4)$/.test(key)) throw notFound();
    if (key.startsWith('inbox/') && user.access !== 'admin') throw forbidden();
    const range = req.headers.range;
    const oneRange = typeof range === 'string' && /^bytes=(\d+-\d*|-\d+)$/.test(range) ? range : undefined;
    try {
      const obj = await storage.stream(key, oneRange);
      reply.header('content-type', obj.contentType).header('cache-control', 'private, max-age=31536000, immutable').header('accept-ranges', 'bytes');
      if (oneRange && obj.range) reply.code(206).header('content-range', obj.range);
      if (obj.length) reply.header('content-length', obj.length);
      return reply.send(obj.body);
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) throw notFound();
      if (status === 416) throw new HttpError(416, 'Range not satisfiable');
      throw e;
    }
  });

  /** Adds the next year block before the closing page. */
  app.post<{ Params: { id: string } }>('/api/books/:id/years', async (req) => {
    const user = requireUser(req);
    await requireEdit(db, user, req.params.id);
    const pages = await loadPages(db, req.params.id);
    const year = nextYear(pages);
    const at = yearInsertAt(pages);
    await insertPagesAt(db, req.params.id, at, yearBlockPages(year));
    return { year, at };
  });

  /** Adds a month chapter (two pages) inside a year, in month order. */
  app.post<{ Params: { id: string } }>('/api/books/:id/months', async (req) => {
    const user = requireUser(req);
    await requireEdit(db, user, req.params.id);
    const { year, month } = parse(z.object({ year: z.number().int(), month: z.number().int().min(0).max(11) }), req.body);
    const pages = await loadPages(db, req.params.id);
    if (hasMonthChapter(pages, year, month)) throw new HttpError(409, 'That month already has a chapter');
    const at = monthInsertAt(pages, year, month);
    if (at == null) throw badRequest(`Add ${year} to this book first`);
    await insertPagesAt(db, req.params.id, at, monthChapterPages(year, month));
    return { at };
  });
}

/**
 * Adds the extra spreads a month chapter (starting at page `start`) needs before `adding` more
 * photos fit, and returns the book's pages after. Null if that would pass the chapter's limit.
 * Empty extra spreads are removed later by runMaintenance, so Undo can still put photos back.
 */
export async function growChapter(db: Db, bookId: string, pages: PageDto[], start: number, adding: number): Promise<PageDto[] | null> {
  const n = spreadsToAdd(pages, start, adding);
  if (n == null) return null;
  if (!n) return pages;
  const at = start + chapterSpan(pages, start).length;
  await insertPagesAt(db, bookId, at, Array.from({ length: n }, () => monthMorePages(pages[start]!)).flat());
  return loadPages(db, bookId);
}

/** Shifts later pages down and inserts new ones at `at`, in one transaction. */
async function insertPagesAt(db: Db, bookId: string, at: number, pages: Omit<typeof s.pages.$inferInsert, 'bookId' | 'position'>[]) {
  await db.transaction(async (tx) => {
    await tx
      .update(s.pages)
      .set({ position: sql`${s.pages.position} + ${pages.length}` })
      .where(and(eq(s.pages.bookId, bookId), gte(s.pages.position, at)));
    await tx.insert(s.pages).values(pages.map((p, i) => ({ ...p, bookId, position: at + i })));
    await tx.update(s.books).set({ updatedAt: new Date() }).where(eq(s.books.id, bookId));
  });
}

export async function requireEdit(db: Db, user: SessionUser, bookId: string) {
  const [book] = await db.select().from(s.books).where(and(eq(s.books.id, bookId), isNull(s.books.deletedAt)));
  if (!book) throw notFound('That book no longer exists');
  if (!canEditBook(user, book, await hasUnlock(db, user.id, book.id))) throw forbidden('Unlock this book with its PIN first');
  return book;
}

export async function loadBookContent(db: Db, user: SessionUser, bookId: string) {
  const [book] = await db.select().from(s.books).where(and(eq(s.books.id, bookId), isNull(s.books.deletedAt)));
  if (!book) throw notFound('That book no longer exists');
  const [hh] = await db.select().from(s.households).where(eq(s.households.id, book.householdId));
  const [settings] = await db.select({ familyName: s.settings.familyName }).from(s.settings);
  const pages = await loadPages(db, book.id);
  const text = pages.find((p) => p.type === 'title')?.text ?? {};
  const owner = bookOwnerName(book, hh);
  const unlocked = await hasUnlock(db, user.id, book.id);
  return {
    book: {
      id: book.id,
      householdId: book.householdId,
      kind: book.kind,
      owner,
      title: bookName(owner, text),
      family: familyOf(hh, settings?.familyName ?? 'Rivera'),
      spineText: book.spineText,
      texture: book.texture,
      color: book.color,
      width: book.width,
      height: book.height,
      locked: book.locked,
      hasPin: !!book.pinHash,
      canEdit: canEditBook(user, book, unlocked),
      updatedAt: book.updatedAt.toISOString(),
    },
    pages,
  };
}
