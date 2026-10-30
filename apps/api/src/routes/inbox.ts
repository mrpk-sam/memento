import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bookOwnerName, chapterList, fileToChapter, orderBooks } from '@memento/shared';
import * as s from '../db/schema.js';
import { loadPages, mediaUrl } from '../lib/content.js';
import { badRequest, notFound, parse } from '../lib/http.js';
import { subjectFromName } from '../lib/images.js';
import { inboxKey, inboxVideoKey, photoKey, photoVideoKey } from '../lib/s3.js';
import { requireAdmin } from '../lib/session.js';
import { readUpload, uploadError, uploadKey } from '../lib/uploads.js';
import { processMedia } from '../lib/videos.js';
import { growChapter } from './content.js';
import { persistLayout } from './photos.js';

type Item = typeof s.inboxItems.$inferSelect;

export async function inboxRoutes(app: FastifyInstance) {
  const { db, storage } = app.deps;

  const dto = (it: Item) => ({
    id: it.id,
    subject: it.subject,
    caption: it.caption,
    thumbUrl: mediaUrl(it.thumbKey),
    displayUrl: mediaUrl(it.displayKey),
    videoUrl: mediaUrl(it.videoKey),
    durationMs: it.durationMs,
    destBookId: it.destBookId,
    destPageId: it.destPageId,
    createdAt: it.createdAt.toISOString(),
  });

  /** Books with their chapters, for each card's book and chapter selects. */
  async function destinations() {
    const hh = await db.select().from(s.households).where(isNull(s.households.deletedAt));
    const books = orderBooks(await db.select().from(s.books).where(isNull(s.books.deletedAt)));
    return Promise.all(
      books.map(async (b) => {
        const pages = await loadPages(db, b.id);
        return {
          id: b.id,
          name: bookOwnerName(b, hh.find((h) => h.id === b.householdId)),
          chapters: chapterList(pages).map((c) => ({ pageId: pages[c.idx]!.id, name: c.name })),
        };
      }),
    );
  }

  app.get('/api/inbox', async (req) => {
    requireAdmin(req);
    const items = await db.select().from(s.inboxItems).where(isNull(s.inboxItems.deletedAt)).orderBy(asc(s.inboxItems.createdAt));
    return { items: items.map(dto), books: await destinations() };
  });

  /** Processes uploads (photos or videos) into the inbox. Each item defaults to the first book's latest chapter. */
  app.post('/api/inbox', async (req) => {
    const user = requireAdmin(req);
    const { uploads } = parse(z.object({ uploads: z.array(z.object({ id: z.string().uuid(), name: z.string().max(255).default('') })).min(1).max(20) }), req.body);
    const dests = await destinations();
    const first = dests[0];
    const created: Item[] = [];
    const skipped: { name: string; error: string }[] = [];
    for (const u of uploads) {
      try {
        const img = await processMedia(await readUpload(storage, user.id, u.id));
        const id = randomUUID();
        await Promise.all([
          storage.put(inboxKey(id, 'orig'), img.orig),
          storage.put(inboxKey(id, '1600'), img.display),
          storage.put(inboxKey(id, '400'), img.thumb),
          img.video && storage.put(inboxVideoKey(id), img.video, 'video/mp4'),
        ]);
        const [row] = await db
          .insert(s.inboxItems)
          .values({
            id,
            uploadedBy: user.id,
            objectKey: inboxKey(id, 'orig'),
            displayKey: inboxKey(id, '1600'),
            thumbKey: inboxKey(id, '400'),
            width: img.width,
            height: img.height,
            videoKey: img.video ? inboxVideoKey(id) : null,
            durationMs: img.durationMs,
            subject: subjectFromName(u.name),
            destBookId: first?.id ?? null,
            destPageId: first?.chapters.at(-1)?.pageId ?? null,
          })
          .returning();
        created.push(row!);
      } catch (e) {
        skipped.push({ name: u.name, error: uploadError(e) });
      } finally {
        await storage.delete(uploadKey(user.id, u.id)).catch(() => {});
      }
    }
    return { items: created.map(dto), skipped };
  });

  app.patch<{ Params: { id: string } }>('/api/inbox/:id', async (req) => {
    requireAdmin(req);
    const v = parse(
      z.object({ caption: z.string().max(300), subject: z.string().max(200), destBookId: z.string().uuid().nullable(), destPageId: z.string().uuid().nullable() }).partial(),
      req.body,
    );
    const res = await db.update(s.inboxItems).set(v).where(and(eq(s.inboxItems.id, req.params.id), isNull(s.inboxItems.deletedAt))).returning();
    if (!res.length) throw notFound('That photo is no longer in the inbox');
    return dto(res[0]!);
  });

  /** Files an inbox photo into a chapter: right page first, then left, then extra pages (a full month grows one). */
  app.post<{ Params: { id: string } }>('/api/inbox/:id/file', async (req) => {
    requireAdmin(req);
    const [it] = await db.select().from(s.inboxItems).where(and(eq(s.inboxItems.id, req.params.id), isNull(s.inboxItems.deletedAt)));
    if (!it) throw notFound('That photo is no longer in the inbox');
    if (!it.destBookId || !it.destPageId) throw badRequest('Pick a book and a chapter first');
    const [book] = await db.select().from(s.books).where(and(eq(s.books.id, it.destBookId), isNull(s.books.deletedAt)));
    if (!book) throw badRequest('That book no longer exists');
    let pages = await loadPages(db, book.id);
    const idx = pages.findIndex((p) => p.id === it.destPageId);
    const ch = chapterList(pages).find((c) => c.idx === idx);
    if (idx < 0 || !ch) throw badRequest('That chapter no longer exists. Pick another one.');
    if (pages[idx]!.layout === 'monthL') pages = (await growChapter(db, book.id, pages, idx, 1)) ?? pages;
    const photoId = randomUUID();
    const r = fileToChapter(pages, idx, { id: photoId, month: null });
    if (!r.placed.length) throw badRequest(`${ch.name} is full in that book. Pick another chapter.`);

    await Promise.all([
      ...(['orig', '1600', '400'] as const).map((v) => storage.copy(inboxKey(it.id, v), photoKey(book.id, photoId, v))),
      it.videoKey && storage.copy(it.videoKey, photoVideoKey(book.id, photoId)),
    ]);
    await db.transaction(async (tx) => {
      await tx.insert(s.photos).values({
        id: photoId,
        bookId: book.id,
        objectKey: photoKey(book.id, photoId, 'orig'),
        displayKey: photoKey(book.id, photoId, '1600'),
        thumbKey: photoKey(book.id, photoId, '400'),
        width: it.width,
        height: it.height,
        videoKey: it.videoKey ? photoVideoKey(book.id, photoId) : null,
        durationMs: it.durationMs,
        subject: it.subject,
        caption: it.caption,
        uploadedBy: it.uploadedBy,
      });
      await persistLayout(tx as never, book.id, r.pages);
      await tx.update(s.inboxItems).set({ deletedAt: new Date() }).where(eq(s.inboxItems.id, it.id));
      await tx.update(s.books).set({ updatedAt: new Date() }).where(eq(s.books.id, book.id));
    });
    const hh = await db.select().from(s.households).where(eq(s.households.id, book.householdId));
    return { bookId: book.id, pageIdx: idx, chapter: ch.name, owner: bookOwnerName(book, hh[0]) };
  });

  app.delete<{ Params: { id: string } }>('/api/inbox/:id', async (req) => {
    requireAdmin(req);
    await db.update(s.inboxItems).set({ deletedAt: new Date() }).where(eq(s.inboxItems.id, req.params.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/inbox/:id/restore', async (req) => {
    requireAdmin(req);
    await db.update(s.inboxItems).set({ deletedAt: null }).where(eq(s.inboxItems.id, req.params.id));
    const [it] = await db.select().from(s.inboxItems).where(eq(s.inboxItems.id, req.params.id));
    if (!it) throw notFound();
    return dto(it);
  });

  /** Count for the Desk tab badge. */
  app.get('/api/inbox/count', async (req) => {
    requireAdmin(req);
    const rows = await db.select({ id: s.inboxItems.id }).from(s.inboxItems).where(isNull(s.inboxItems.deletedAt)).orderBy(desc(s.inboxItems.createdAt));
    return { count: rows.length };
  });
}
