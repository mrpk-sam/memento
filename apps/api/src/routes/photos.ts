import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIMITS, MONTH_CAPACITY, Month, PageHeader, STICKER_PACKS, canEditBook, chapterList, chapterRoom, chapterSpan, chapterStart, compactMonth, moveManyToChapter, movePhoto, placeBack, placeOnSpread, setMonth, withinCapacity, type ModelPhoto } from '@memento/shared';
import type { Db } from '../db/client.js';
import * as s from '../db/schema.js';
import { loadPages, type PageDto } from '../lib/content.js';
import { HttpError, badRequest, forbidden, notFound, parse } from '../lib/http.js';
import { withLock } from '../lib/locks.js';
import { processImage, subjectFromName } from '../lib/images.js';
import { photoKey, photoVideoKey } from '../lib/s3.js';
import { requireUser, type SessionUser } from '../lib/session.js';
import { MAX_OPEN_UPLOADS, isAllowedType, maxBytesFor, noteIssued, openUploads, readUpload, uploadError, uploadKey } from '../lib/uploads.js';
import { processMedia, type Media } from '../lib/videos.js';
import { growChapter, loadBookContent, requireEdit } from './content.js';

const MAX_FILES = 20;
const UploadRef = z.object({ id: z.string().uuid(), name: z.string().max(255).default('') });

export interface LayoutEntry { id: string; pageId: string | null; position: number; month: number | null }

export async function photoRoutes(app: FastifyInstance) {
  const { db, env, storage } = app.deps;
  const direct = !!env.S3_PUBLIC_ENDPOINT;

  const sign = (userId: string, id: string, exp: number) => createHmac('sha256', env.SESSION_SECRET).update(`${userId}:${id}:${exp}`).digest('base64url');

  /**
   * Step 1 of an upload: the browser asks for somewhere to PUT each file.
   * With S3_PUBLIC_ENDPOINT set, that's a presigned MinIO URL. Otherwise it's a
   * short-lived signed URL on this API, which streams the file into MinIO, so
   * MinIO never has to be reachable from outside the LAN.
   * Only people who can edit some book (or the admin, for the inbox) get upload URLs.
   */
  app.post('/api/uploads', async (req) => {
    const user = requireUser(req);
    if (!(await canEditAnyBook(user))) throw forbidden('Unlock a book with its PIN first');
    const { files } = parse(
      z.object({ files: z.array(z.object({ name: z.string().max(255), type: z.string().max(100), size: z.number().int().min(1) })).min(1).max(MAX_FILES) }),
      req.body,
    );
    for (const f of files) {
      if (!isAllowedType(f.type)) throw badRequest(`${f.name} isn't a photo or video we can use. Try JPEG, PNG, HEIC, WebP or any video.`);
      const max = maxBytesFor(f.type);
      if (f.size > max) throw badRequest(`${f.name} is over ${max / 1024 / 1024} MB`);
    }
    if ((await openUploads(storage, user.id)) + files.length > MAX_OPEN_UPLOADS) {
      throw badRequest('Too many uploads are still waiting. Let them finish, then try again.');
    }
    const out = [];
    for (const f of files) {
      const id = randomUUID();
      const contentType = f.type || 'application/octet-stream';
      if (direct) {
        noteIssued(user.id, id, Date.now() + 10 * 60_000);
        out.push({ id, url: await storage.presignPut(uploadKey(user.id, id), contentType, f.size), headers: { 'content-type': contentType } });
      } else {
        const exp = Date.now() + 15 * 60_000;
        noteIssued(user.id, id, exp);
        out.push({ id, url: `/api/uploads/${id}?exp=${exp}&sig=${sign(user.id, id, exp)}`, headers: { 'content-type': contentType } });
      }
    }
    return { uploads: out };
  });

  /** Admin, or a book that's open or unlocked for this user. */
  async function canEditAnyBook(user: SessionUser) {
    if (user.access === 'admin') return true;
    const books = await db.select({ id: s.books.id, locked: s.books.locked }).from(s.books).where(isNull(s.books.deletedAt));
    const unlocks = await db.select({ bookId: s.bookUnlocks.bookId }).from(s.bookUnlocks).where(and(eq(s.bookUnlocks.userId, user.id), gt(s.bookUnlocks.expiresAt, new Date())));
    const unlocked = new Set(unlocks.map((u) => u.bookId));
    return books.some((b) => canEditBook(user, b, unlocked.has(b.id)));
  }

  // Raw body upload target for the API-signed URLs. Scoped so JSON routes are unaffected.
  await app.register(async (scope) => {
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: LIMITS.maxVideoBytes }, (_req, body, done) => done(null, body));
    scope.put<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>('/api/uploads/:id', async (req) => {
      const user = requireUser(req);
      const { id } = req.params;
      const exp = Number(req.query.exp);
      if (!z.string().uuid().safeParse(id).success || !exp || exp < Date.now()) throw forbidden('This upload link has expired');
      const want = Buffer.from(sign(user.id, id, exp));
      const got = Buffer.from(String(req.query.sig ?? ''));
      if (want.length !== got.length || !timingSafeEqual(want, got)) throw forbidden('Bad upload signature');
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || !body.length) throw badRequest('Empty upload');
      await storage.put(uploadKey(user.id, id), body, req.headers['content-type'] ?? 'application/octet-stream');
      return { ok: true };
    });
  });

  /** Reads and processes uploads: photos or videos, or photos only. Bad files are reported, not fatal. */
  async function readUploads(userId: string, refs: z.infer<typeof UploadRef>[], kind: 'media' | 'photo' = 'media') {
    const ok: { ref: (typeof refs)[number]; img: Media }[] = [];
    const skipped: { name: string; error: string }[] = [];
    for (const ref of refs) {
      try {
        const buf = await readUpload(storage, userId, ref.id, kind === 'photo');
        ok.push({ ref, img: kind === 'photo' ? { ...(await processImage(buf)), video: null, durationMs: null } : await processMedia(buf) });
      } catch (e) {
        skipped.push({ name: ref.name, error: uploadError(e) });
      }
    }
    return { ok, skipped };
  }

  async function storeVariants(bookId: string, photoId: string, img: Media) {
    await Promise.all([
      storage.put(photoKey(bookId, photoId, 'orig'), img.orig),
      storage.put(photoKey(bookId, photoId, '1600'), img.display),
      storage.put(photoKey(bookId, photoId, '400'), img.thumb),
      img.video && storage.put(photoVideoKey(bookId, photoId), img.video, 'video/mp4'),
    ]);
  }

  const cleanup = (userId: string, refs: { id: string }[]) => Promise.allSettled(refs.map((r) => storage.delete(uploadKey(userId, r.id))));

  /** Step 2: process uploads (photos or videos) and place them on the spread they were dropped on. */
  app.post<{ Params: { id: string } }>('/api/books/:id/photos', async (req) => {
    const user = requireUser(req);
    const book = await requireEdit(db, user, req.params.id);
    const v = parse(
      z.object({ uploads: z.array(UploadRef).min(1).max(MAX_FILES), L: z.number().int().min(0), single: z.boolean(), side: z.enum(['L', 'R']).optional() }),
      req.body,
    );
    // Check for room before doing any image work.
    const probe = placeOnSpread(await loadPages(db, book.id), v.L, v, v.uploads.map((u) => ({ id: u.id, month: null })));
    if (probe.kind === 'no-slots') throw badRequest('This spread has no photo slots. Turn to a year or month first.');
    if (probe.kind === 'year-full') throw badRequest('This year is full. Remove a photo, or add more to a month chapter.');

    // Image work runs outside the lock; placing reads the pages afresh inside it, so two uploads
    // at once can't both take the same free slot.
    const { ok, skipped } = await readUploads(user.id, v.uploads);
    const fresh = ok.map((x) => ({ ...x, photoId: randomUUID() }));
    return withLock(book.id, async () => {
      let pages = await loadPages(db, book.id);
      // A month chapter grows extra pages to take the upload, up to its limit of 50.
      const start = chapterStart(pages, v.L);
      const inMonth = start != null && pages[start]!.layout === 'monthL';
      if (inMonth && fresh.length) {
        const adding = Math.min(fresh.length, chapterRoom(pages, start));
        if (adding > 0) pages = (await growChapter(db, book.id, pages, start, adding)) ?? pages;
      }
      const r = placeOnSpread(pages, v.L, v, fresh.map((f) => ({ id: f.photoId, month: null })));
      if (r.kind === 'no-slots' || r.kind === 'year-full') {
        await cleanup(user.id, v.uploads);
        throw badRequest(r.kind === 'year-full' ? 'This year is full. Remove a photo, or add more to a month chapter.' : 'This spread is full.');
      }
      const placedIds = new Set(r.kind === 'year' ? r.added.map((a) => a.id) : r.placed);
      const placed = fresh.filter((f) => placedIds.has(f.photoId));

      await Promise.all(placed.map((f) => storeVariants(book.id, f.photoId, f.img)));
      await db.transaction(async (tx) => {
        if (placed.length) {
          await tx.insert(s.photos).values(
            placed.map((f) => ({
              id: f.photoId,
              bookId: book.id,
              pageId: null,
              objectKey: photoKey(book.id, f.photoId, 'orig'),
              displayKey: photoKey(book.id, f.photoId, '1600'),
              thumbKey: photoKey(book.id, f.photoId, '400'),
              width: f.img.width,
              height: f.img.height,
              videoKey: f.img.video ? photoVideoKey(book.id, f.photoId) : null,
              durationMs: f.img.durationMs,
              subject: subjectFromName(f.ref.name),
              takenAt: f.img.takenAt,
              uploadedBy: user.id,
            })),
          );
        }
        await persistLayout(tx as unknown as Db, book.id, r.pages);
        await tx.update(s.books).set({ updatedAt: new Date() }).where(eq(s.books.id, book.id));
      });
      await cleanup(user.id, v.uploads);
      return {
        kind: r.kind,
        added: r.kind === 'year' ? r.added : placed.map((f) => ({ id: f.photoId, month: null })),
        left: r.left,
        // A month that's full says so, rather than "this spread is full".
        monthFull: inMonth && r.left > 0,
        skipped,
        ...(await loadBookContent(db, user, book.id)),
      };
    });
  });

  /** Replaces the title page's cover (hero) photo with an upload, an existing photo, or nothing. */
  app.put<{ Params: { id: string } }>('/api/books/:id/hero', async (req) => {
    const user = requireUser(req);
    const book = await requireEdit(db, user, req.params.id);
    const v = parse(z.union([z.object({ upload: UploadRef }), z.object({ photoId: z.string().uuid().nullable() })]), req.body);
    const [title] = await db.select().from(s.pages).where(and(eq(s.pages.bookId, book.id), eq(s.pages.type, 'title')));
    if (!title) throw badRequest('This book has no title page');
    let heroId: string | null;
    if ('upload' in v) {
      // The cover is always a still photo.
      const { ok, skipped } = await readUploads(user.id, [v.upload], 'photo');
      if (!ok[0]) throw badRequest(skipped[0]?.error ?? 'Upload failed');
      heroId = randomUUID();
      await storeVariants(book.id, heroId, ok[0].img);
      await db.insert(s.photos).values({
        id: heroId,
        bookId: book.id,
        pageId: null,
        objectKey: photoKey(book.id, heroId, 'orig'),
        displayKey: photoKey(book.id, heroId, '1600'),
        thumbKey: photoKey(book.id, heroId, '400'),
        width: ok[0].img.width,
        height: ok[0].img.height,
        subject: subjectFromName(v.upload.name),
        takenAt: ok[0].img.takenAt,
        uploadedBy: user.id,
      });
      await cleanup(user.id, [v.upload]);
    } else {
      heroId = v.photoId;
      if (heroId) {
        const [p] = await db.select().from(s.photos).where(and(eq(s.photos.id, heroId), eq(s.photos.bookId, book.id)));
        if (!p) throw notFound('That photo is not in this book');
      }
    }
    await db.update(s.pages).set({ heroPhotoId: heroId }).where(eq(s.pages.id, title.id));
    await db.update(s.books).set({ updatedAt: new Date() }).where(eq(s.books.id, book.id));
    return { previous: title.heroPhotoId, ...(await loadBookContent(db, user, book.id)) };
  });

  async function photoForEdit(req: Parameters<typeof requireUser>[0], id: string, opts: { withDeleted?: boolean } = {}) {
    const user = requireUser(req);
    const [p] = await db.select().from(s.photos).where(opts.withDeleted ? eq(s.photos.id, id) : and(eq(s.photos.id, id), isNull(s.photos.deletedAt)));
    if (!p) throw notFound('That photo no longer exists');
    const book = await requireEdit(db, user, p.bookId);
    return { user, p, book };
  }

  app.patch<{ Params: { id: string } }>('/api/photos/:id', async (req) => {
    const { p } = await photoForEdit(req, req.params.id);
    const v = parse(z.object({ caption: z.string().max(300), subject: z.string().max(200) }).partial(), req.body);
    await db.update(s.photos).set(v).where(eq(s.photos.id, p.id));
    await touch(db, p.bookId);
    return { ok: true };
  });

  /** Ties a year-spread photo to a month (or none). It joins that month's other photos. */
  app.post<{ Params: { id: string } }>('/api/photos/:id/month', async (req) => {
    const { user, p } = await photoForEdit(req, req.params.id);
    const { month } = parse(z.object({ month: Month.nullable() }), req.body);
    return withLock(p.bookId, async () => {
      const pages = await loadPages(db, p.bookId);
      const r = setMonth(pages, p.id, month);
      if (!r) throw badRequest("Only photos in a year's summary have a month");
      const before = snapshot(pages, r.pages);
      await db.transaction(async (tx) => {
        await persistLayout(tx as unknown as Db, p.bookId, r.pages);
        await tx.update(s.books).set({ updatedAt: new Date() }).where(eq(s.books.id, p.bookId));
      });
      return { before, ...(await loadBookContent(db, user, p.bookId)) };
    });
  });

  /** Rearranges: puts a photo at `position` on page `pageId` of the same spread. */
  app.post<{ Params: { id: string } }>('/api/photos/:id/move', async (req) => {
    const { user, p } = await photoForEdit(req, req.params.id);
    const v = parse(z.object({ pageId: z.string().uuid(), position: z.number().int().min(0).max(50) }), req.body);
    return withLock(p.bookId, async () => {
      const pages = await loadPages(db, p.bookId);
      const toIdx = pages.findIndex((pg) => pg.id === v.pageId);
      const fromIdx = pages.findIndex((pg) => pg.photos.some((x) => x.id === p.id));
      if (toIdx < 0 || fromIdx < 0 || Math.abs(toIdx - fromIdx) > 1) throw badRequest('Photos can only move within the spread they are on');
      const r = movePhoto(pages, p.id, toIdx, v.position);
      if (r.kind === 'invalid') throw badRequest("That page doesn't hold photos");
      if (r.kind !== 'moved') return { kind: r.kind, ...(await loadBookContent(db, user, p.bookId)) };
      const before = snapshot(pages, r.pages);
      await db.transaction(async (tx) => {
        await persistLayout(tx as unknown as Db, p.bookId, r.pages);
        await tx.update(s.books).set({ updatedAt: new Date() }).where(eq(s.books.id, p.bookId));
      });
      return { kind: r.kind, before, ...(await loadBookContent(db, user, p.bookId)) };
    });
  });

  /**
   * Moves photos into a chapter of their book: a year or a month, named by its left page.
   * A month grows extra pages to take them, up to 50. All or nothing.
   */
  app.post<{ Params: { id: string } }>('/api/books/:id/chapter-moves', async (req) => {
    const user = requireUser(req);
    const book = await requireEdit(db, user, req.params.id);
    const v = parse(z.object({ photoIds: z.array(z.string().uuid()).min(1).max(MONTH_CAPACITY), pageId: z.string().uuid() }), req.body);
    return withLock(book.id, async () => {
      const ids = [...new Set(v.photoIds)];
      let pages = await loadPages(db, book.id);
      const start = pages.findIndex((pg) => pg.id === v.pageId);
      if (pages[start]?.layout !== 'summaryL' && pages[start]?.layout !== 'monthL') throw badRequest("That isn't a chapter in this book");
      const pageOf = new Map(pages.flatMap((pg, i) => pg.photos.map((p) => [p.id, i] as const)));
      if (ids.some((id) => !pageOf.has(id))) throw badRequest('Some of those photos are not in this book');
      const span = chapterSpan(pages, start);
      const adding = ids.filter((id) => !span.includes(pageOf.get(id)!)).length;
      const name = chapterList(pages).find((c) => c.idx === start)?.name ?? 'That chapter';
      const full = () => {
        const room = chapterRoom(pages, start);
        return badRequest(room ? `${name} has room for ${room} more photo${room === 1 ? '' : 's'}.` : `${name} is full.`);
      };
      const grown = await growChapter(db, book.id, pages, start, adding);
      if (!grown) throw full();
      pages = grown;
      const r = moveManyToChapter(pages, ids, start);
      if (r.kind === 'invalid') throw badRequest("That isn't a chapter in this book");
      if (r.kind === 'full') throw full();
      if (r.kind === 'same') return { kind: r.kind, moved: 0, ...(await loadBookContent(db, user, book.id)) };
      const before = snapshot(pages, r.pages);
      await db.transaction(async (tx) => {
        await persistLayout(tx as unknown as Db, book.id, r.pages);
        await tx.update(s.books).set({ updatedAt: new Date() }).where(eq(s.books.id, book.id));
      });
      return { kind: r.kind, moved: r.moved, before, ...(await loadBookContent(db, user, book.id)) };
    });
  });

  app.delete<{ Params: { id: string } }>('/api/photos/:id', async (req) => {
    const { p } = await photoForEdit(req, req.params.id);
    return withLock(p.bookId, async () => {
      await db.update(s.photos).set({ deletedAt: new Date() }).where(eq(s.photos.id, p.id));
      // A month closes up behind a removed photo, so no empty pages are left inside it.
      const pages = await loadPages(db, p.bookId);
      const idx = pages.findIndex((pg) => pg.id === p.pageId);
      const start = idx >= 0 ? chapterStart(pages, idx) : null;
      if (start != null) await persistLayout(db, p.bookId, compactMonth(pages, start));
      await touch(db, p.bookId);
      return { ok: true };
    });
  });

  /** Undo of a delete: back to its old place if there's room, else elsewhere in its chapter, else refused. */
  app.post<{ Params: { id: string } }>('/api/photos/:id/restore', async (req) => {
    const { p } = await photoForEdit(req, req.params.id, { withDeleted: true });
    return withLock(p.bookId, async () => {
      if (!p.deletedAt) return { ok: true };
      let pages = await loadPages(db, p.bookId);
      let idx = pages.findIndex((pg) => pg.id === p.pageId);
      let next: PageDto[] | null = null;
      if (idx >= 0) {
        const start = chapterStart(pages, idx);
        if (start != null && pages[start]!.layout === 'monthL') pages = (await growChapter(db, p.bookId, pages, start, 1)) ?? pages;
        idx = pages.findIndex((pg) => pg.id === p.pageId);
        next = placeBack(pages, { id: p.id, month: p.month }, idx, p.position);
        if (!next) throw new HttpError(409, "There's no room to bring that photo back. Remove one from its chapter first.");
      }
      await db.transaction(async (tx) => {
        await tx.update(s.photos).set({ deletedAt: null }).where(eq(s.photos.id, p.id));
        if (next) await persistLayout(tx as unknown as Db, p.bookId, next);
        await tx.update(s.books).set({ updatedAt: new Date() }).where(eq(s.books.id, p.bookId));
      });
      return { ok: true };
    });
  });

  /** Undo for layout changes: puts photos back where a snapshot says, reviving any that were removed. */
  app.put<{ Params: { id: string } }>('/api/books/:id/layout', async (req) => {
    const user = requireUser(req);
    const book = await requireEdit(db, user, req.params.id);
    const { photos } = parse(
      z.object({ photos: z.array(z.object({ id: z.string().uuid(), pageId: z.string().uuid().nullable(), position: z.number().int().min(0), month: Month.nullable() })).max(200) }),
      req.body,
    );
    const ids = photos.map((x) => x.id);
    const owned = ids.length ? await db.select({ id: s.photos.id }).from(s.photos).where(and(inArray(s.photos.id, ids), eq(s.photos.bookId, book.id))) : [];
    if (owned.length !== ids.length) throw badRequest('Some photos are not in this book');
    return withLock(book.id, async () => {
      // Apply the snapshot to the book as it is now, then check no page ends up overfull:
      // someone may have filled the space since.
      const pages = await loadPages(db, book.id);
      const byId = new Map(pages.map((pg) => [pg.id, pg]));
      if (photos.some((x) => x.pageId && !byId.has(x.pageId))) throw badRequest('Some pages are not in this book');
      const undoing = new Set(ids);
      const next = pages.map((pg) => ({ ...pg, photos: pg.photos.filter((ph) => !undoing.has(ph.id)) }));
      const at = new Map(next.map((pg) => [pg.id, pg]));
      for (const x of [...photos].sort((a, b) => a.position - b.position)) {
        if (!x.pageId) continue;
        const pg = at.get(x.pageId)!;
        pg.photos.splice(Math.min(x.position, pg.photos.length), 0, { id: x.id, month: x.month } as (typeof pg.photos)[number]);
      }
      if (!withinCapacity(next)) throw new HttpError(409, "Too much has changed since then, so that can't be undone.");
      await db.transaction(async (tx) => {
        if (ids.length) await tx.update(s.photos).set({ deletedAt: null }).where(inArray(s.photos.id, ids));
        for (const x of photos) if (!x.pageId) await tx.update(s.photos).set({ pageId: null, position: x.position, month: x.month }).where(eq(s.photos.id, x.id));
        await persistLayout(tx as unknown as Db, book.id, next);
        await tx.update(s.books).set({ updatedAt: new Date() }).where(eq(s.books.id, book.id));
      });
      return loadBookContent(db, user, book.id);
    });
  });

  app.patch<{ Params: { id: string } }>('/api/pages/:id', async (req) => {
    const user = requireUser(req);
    const [pg] = await db.select().from(s.pages).where(eq(s.pages.id, req.params.id));
    if (!pg) throw notFound('That page no longer exists');
    await requireEdit(db, user, pg.bookId);
    const v = parse(
      z
        .object({
          themeId: z.string().max(80),
          stickerPack: z.string().refine((k) => k in STICKER_PACKS, 'Unknown sticker pack'),
          header: PageHeader.partial(),
          journal: z.string().max(2000),
          text: z.record(z.string(), z.string().max(200)),
        })
        .partial(),
      req.body,
    );
    if (v.themeId) {
      const [t] = await db.select({ id: s.themes.id }).from(s.themes).where(and(eq(s.themes.id, v.themeId), isNull(s.themes.deletedAt)));
      if (!t) throw badRequest('Unknown theme');
    }
    const patch: Partial<typeof s.pages.$inferInsert> = {};
    if (v.themeId) patch.themeId = v.themeId;
    if (v.stickerPack) patch.stickerPack = v.stickerPack;
    if (v.journal !== undefined) patch.journal = v.journal;
    // Header and title text merge into what's there, so one field can change at a time.
    if (v.header) patch.header = { ...(pg.header ?? {}), ...v.header };
    if (v.text) patch.text = { ...(pg.text ?? {}), ...v.text };
    await db.update(s.pages).set(patch).where(eq(s.pages.id, pg.id));
    await touch(db, pg.bookId);
    return { ok: true };
  });
}

const touch = (db: Db, bookId: string) => db.update(s.books).set({ updatedAt: new Date() }).where(eq(s.books.id, bookId));

/** Writes each photo's page and position as the page arrays say. Months come along for summary pages. */
export async function persistLayout(db: Db, bookId: string, pages: (PageDto | { id: string; photos?: ModelPhoto[] })[]) {
  for (const pg of pages) {
    for (const [position, ph] of (pg.photos ?? []).entries()) {
      await db
        .update(s.photos)
        .set({ pageId: pg.id, position, month: ph.month })
        .where(and(eq(s.photos.id, ph.id), eq(s.photos.bookId, bookId)));
    }
  }
}

/** The previous placement of every photo a change touches, for Undo. */
function snapshot(before: PageDto[], after: { id: string; photos?: ModelPhoto[] }[]): LayoutEntry[] {
  const touched = new Set<string>();
  after.forEach((pg, i) => {
    const b = before[i];
    const same = b && JSON.stringify(b.photos.map((p) => [p.id, p.month])) === JSON.stringify((pg.photos ?? []).map((p) => [p.id, p.month]));
    if (!same) b?.photos.forEach((p) => touched.add(p.id));
  });
  return before.flatMap((pg) => pg.photos.flatMap((p, position) => (touched.has(p.id) ? [{ id: p.id, pageId: pg.id, position, month: p.month }] : [])));
}

