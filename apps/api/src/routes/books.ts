import { and, asc, count, eq, gt, inArray, isNull, max, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BOOK_SIZE, HexColor, LIMITS, Pin, Texture, bookName, bookOwnerName, canEditBook, orderBooks } from '@memento/shared';
import type { Db } from '../db/client.js';
import * as s from '../db/schema.js';
import { defaultBookPages } from '../lib/book-template.js';
import { titleTexts } from '../lib/books.js';
import { HttpError, badRequest, forbidden, notFound, parse } from '../lib/http.js';
import { hashPin, verifyPin } from '../lib/pin.js';
import { requireAdmin, requireUser, type SessionUser } from '../lib/session.js';

const Width = z.number().int().min(BOOK_SIZE.width.min).max(BOOK_SIZE.width.max);
const Height = z.number().int().min(280).max(BOOK_SIZE.height.max);

/** Cover fields anyone who can edit the book may change (the edit panel's "Book & spine"). */
const CoverPatch = z.object({ spineText: z.string().trim().max(40), texture: Texture, color: HexColor, width: Width, height: Height }).partial();
/** Fields only the admin may change (Books tab). */
const AdminPatch = z.object({ ownerName: z.string().trim().min(1).max(60), householdId: z.string().uuid(), locked: z.boolean() }).partial();

const CreateBook = z.object({
  parentHouseholdId: z.string().uuid().nullable().default(null),
  ownerName: z.string().trim().max(60).default(''),
  householdName: z.string().trim().max(80).default(''),
  surname: z.string().trim().max(60).default(''),
  spineText: z.string().trim().max(40).default(''),
  texture: Texture,
  color: HexColor,
  locked: z.boolean(),
  pin: z.string().optional(),
});


export async function bookRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  async function loadBook(id: string, opts: { withDeleted?: boolean } = {}) {
    const [b] = await db
      .select()
      .from(s.books)
      .where(opts.withDeleted ? eq(s.books.id, id) : and(eq(s.books.id, id), isNull(s.books.deletedAt)));
    if (!b) throw notFound('That book no longer exists');
    return b;
  }

  app.get('/api/library', async (req) => {
    const user = requireUser(req);
    return loadLibrary(db, user);
  });

  app.post('/api/books', async (req) => {
    requireAdmin(req);
    const v = parse(CreateBook, req.body);
    if (v.locked && !Pin.safeParse(v.pin ?? '').success) throw badRequest('Set a 4-digit PIN, or turn the lock off');
    const pinHash = v.locked ? await hashPin(v.pin!) : null;
    const year = new Date().getFullYear();

    const book = await db.transaction(async (tx) => {
      let householdId = v.parentHouseholdId;
      let kind: 'main' | 'small' = 'small';
      if (householdId) {
        if (!v.ownerName) throw badRequest("Add whose book it is, e.g. your kid's name");
        const [h] = await tx.select().from(s.households).where(and(eq(s.households.id, householdId), isNull(s.households.deletedAt)));
        if (!h) throw badRequest('That household no longer exists');
      } else {
        if (!v.householdName) throw badRequest('Name the household first');
        const [{ m }] = (await tx.select({ m: max(s.households.sortOrder) }).from(s.households)) as [{ m: number | null }];
        const [h] = await tx.insert(s.households).values({ name: v.householdName, surname: v.surname, sortOrder: (m ?? -1) + 1 }).returning();
        householdId = h!.id;
        kind = 'main';
      }
      const pool = kind === 'main' ? eq(s.books.kind, 'main') : and(eq(s.books.kind, 'small'), eq(s.books.householdId, householdId));
      const [{ m }] = (await tx.select({ m: max(s.books.sortOrder) }).from(s.books).where(pool)) as [{ m: number | null }];
      const size = kind === 'main' ? BOOK_SIZE.newMain : BOOK_SIZE.newSmall;
      const [b] = await tx
        .insert(s.books)
        .values({
          householdId,
          kind,
          ownerName: kind === 'small' ? v.ownerName : null,
          spineText: v.spineText,
          texture: v.texture,
          color: v.color,
          width: size.w,
          height: size.h,
          locked: v.locked,
          pinHash,
          sortOrder: (m ?? -1) + 1,
        })
        .returning();
      await tx.insert(s.pages).values(defaultBookPages(year).map((p) => ({ ...p, bookId: b!.id })));
      return b!;
    });
    return { id: book.id, householdId: book.householdId, kind: book.kind };
  });

  app.patch<{ Params: { id: string } }>('/api/books/:id', async (req) => {
    const user = requireUser(req);
    const book = await loadBook(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cover = parse(CoverPatch, pick(body, ['spineText', 'texture', 'color', 'width', 'height']));
    const admin = parse(AdminPatch, pick(body, ['ownerName', 'householdId', 'locked']));

    if (Object.keys(admin).length && user.access !== 'admin') throw forbidden('Only the admin can do that');
    if (Object.keys(cover).length && !canEditBook(user, book, await hasUnlock(db, user.id, book.id))) {
      throw forbidden('Unlock this book with its PIN first');
    }
    const patch: Partial<typeof s.books.$inferInsert> = { ...cover, ...admin, updatedAt: new Date() };
    if (admin.ownerName && book.kind !== 'small') delete patch.ownerName;
    if (admin.householdId && admin.householdId !== book.householdId) {
      if (book.kind !== 'small') throw badRequest('Only smaller books can move between households');
      const [{ m }] = (await db
        .select({ m: max(s.books.sortOrder) })
        .from(s.books)
        .where(and(eq(s.books.kind, 'small'), eq(s.books.householdId, admin.householdId)))) as [{ m: number | null }];
      patch.sortOrder = (m ?? -1) + 1;
    }
    await db.update(s.books).set(patch).where(eq(s.books.id, book.id));
    // Changing the lock resets everyone's unlocks, as the prototype does.
    if (admin.locked !== undefined && admin.locked !== book.locked) await db.delete(s.bookUnlocks).where(eq(s.bookUnlocks.bookId, book.id));
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>('/api/books/:id/pin', async (req) => {
    requireAdmin(req);
    const book = await loadBook(req.params.id);
    const { pin } = parse(z.object({ pin: Pin }), req.body);
    await db.update(s.books).set({ pinHash: await hashPin(pin) }).where(eq(s.books.id, book.id));
    // A new PIN signs everyone out of editing this book.
    await db.delete(s.bookUnlocks).where(eq(s.bookUnlocks.bookId, book.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(
    '/api/books/:id/unlock',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes', keyGenerator: (req) => `${req.ip}:${(req.params as { id: string }).id}` } } },
    async (req) => {
      const user = requireUser(req);
      const book = await loadBook(req.params.id);
      if (!book.locked) return { ok: true, expiresAt: null };
      if (!book.pinHash) throw new HttpError(409, "This book doesn't have a PIN yet. Ask the admin to set one.");
      const { pin } = parse(z.object({ pin: z.string().max(8) }), req.body);

      // Record the try as failed before checking it, then count. Parallel requests each see
      // the others' rows, so a burst can't get more than the allowed number of guesses.
      const [attempt] = await db.insert(s.pinAttempts).values({ userId: user.id, bookId: book.id, ok: false }).returning({ id: s.pinAttempts.id });
      const since = new Date(Date.now() - LIMITS.pinWindowMinutes * 60_000);
      const recent = await db
        .select({ id: s.pinAttempts.id, at: s.pinAttempts.at })
        .from(s.pinAttempts)
        .where(and(eq(s.pinAttempts.userId, user.id), eq(s.pinAttempts.bookId, book.id), eq(s.pinAttempts.ok, false), gt(s.pinAttempts.at, since)))
        .orderBy(asc(s.pinAttempts.at), asc(s.pinAttempts.id));
      const position = recent.findIndex((r) => r.id === attempt!.id) + 1;
      if (position > LIMITS.pinAttempts) {
        await db.delete(s.pinAttempts).where(eq(s.pinAttempts.id, attempt!.id));
        const wait = Math.max(1, Math.ceil((recent[0]!.at.getTime() + LIMITS.pinWindowMinutes * 60_000 - Date.now()) / 60_000));
        throw new HttpError(429, `Too many tries. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`, { retryMinutes: wait });
      }

      const ok = await verifyPin(book.pinHash, pin);
      if (!ok) {
        throw new HttpError(401, "That's not it. Try again.", { remaining: LIMITS.pinAttempts - position });
      }
      await db.update(s.pinAttempts).set({ ok: true }).where(eq(s.pinAttempts.id, attempt!.id));
      const expiresAt = new Date(Date.now() + LIMITS.unlockHours * 3_600_000);
      await db
        .insert(s.bookUnlocks)
        .values({ userId: user.id, bookId: book.id, expiresAt })
        .onConflictDoUpdate({ target: [s.bookUnlocks.userId, s.bookUnlocks.bookId], set: { expiresAt } });
      return { ok: true, expiresAt: expiresAt.toISOString() };
    },
  );

  /** Moves a book one place left (-1) or right (+1) within its pool. */
  app.post<{ Params: { id: string } }>('/api/books/:id/move', async (req) => {
    requireAdmin(req);
    const book = await loadBook(req.params.id);
    const { dir } = parse(z.object({ dir: z.union([z.literal(-1), z.literal(1)]) }), req.body);
    const pool = await db
      .select()
      .from(s.books)
      .where(and(isNull(s.books.deletedAt), book.kind === 'main' ? eq(s.books.kind, 'main') : and(eq(s.books.kind, 'small'), eq(s.books.householdId, book.householdId))))
      .orderBy(asc(s.books.sortOrder));
    const i = pool.findIndex((b) => b.id === book.id);
    const j = i + dir;
    if (j < 0 || j >= pool.length) return { ok: true };
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    await db.transaction(async (tx) => {
      for (const [n, b] of pool.entries()) {
        await tx.update(s.books).set({ sortOrder: n }).where(eq(s.books.id, b.id));
        if (b.kind === 'main') await tx.update(s.households).set({ sortOrder: n }).where(eq(s.households.id, b.householdId));
      }
    });
    return { ok: true };
  });

  /** Copies this book's size to every book of the same kind. Returns the old sizes for Undo. */
  app.post<{ Params: { id: string } }>('/api/books/:id/match-size', async (req) => {
    requireAdmin(req);
    const book = await loadBook(req.params.id);
    const same = await db
      .select({ id: s.books.id, width: s.books.width, height: s.books.height })
      .from(s.books)
      .where(and(eq(s.books.kind, book.kind), isNull(s.books.deletedAt)));
    await db.update(s.books).set({ width: book.width, height: book.height }).where(and(eq(s.books.kind, book.kind), isNull(s.books.deletedAt)));
    return { previous: same };
  });

  app.put('/api/books/sizes', async (req) => {
    requireAdmin(req);
    const { sizes } = parse(z.object({ sizes: z.array(z.object({ id: z.string().uuid(), width: Width, height: Height })).max(500) }), req.body);
    await db.transaction(async (tx) => {
      for (const x of sizes) await tx.update(s.books).set({ width: x.width, height: x.height }).where(eq(s.books.id, x.id));
    });
    return { ok: true };
  });

  /**
   * Deleting a smaller book removes just it. Deleting a main book removes its household,
   * the household's smaller books, and moves its members to extended family.
   * Returns what Undo needs to put it all back.
   */
  app.delete<{ Params: { id: string } }>('/api/books/:id', async (req) => {
    requireAdmin(req);
    const book = await loadBook(req.params.id);
    const now = new Date();
    if (book.kind === 'small') {
      await db.update(s.books).set({ deletedAt: now }).where(eq(s.books.id, book.id));
      return { bookIds: [book.id], householdId: null, memberIds: [] };
    }
    return db.transaction(async (tx) => {
      const gone = await tx
        .update(s.books)
        .set({ deletedAt: now })
        .where(and(eq(s.books.householdId, book.householdId), isNull(s.books.deletedAt)))
        .returning({ id: s.books.id });
      await tx.update(s.households).set({ deletedAt: now }).where(eq(s.households.id, book.householdId));
      const moved = await tx
        .update(s.users)
        .set({ householdId: null, access: sql`case when ${s.users.access} = 'household_admin' then 'member'::access else ${s.users.access} end` })
        .where(eq(s.users.householdId, book.householdId))
        .returning({ id: s.users.id });
      return { bookIds: gone.map((g) => g.id), householdId: book.householdId, memberIds: moved.map((m) => m.id) };
    });
  });

  app.post('/api/books/restore', async (req) => {
    requireAdmin(req);
    const v = parse(
      z.object({ bookIds: z.array(z.string().uuid()).min(1), householdId: z.string().uuid().nullable(), memberIds: z.array(z.string().uuid()) }),
      req.body,
    );
    await db.transaction(async (tx) => {
      if (v.householdId) {
        await tx.update(s.households).set({ deletedAt: null }).where(eq(s.households.id, v.householdId));
        if (v.memberIds.length) await tx.update(s.users).set({ householdId: v.householdId }).where(inArray(s.users.id, v.memberIds));
      }
      await tx.update(s.books).set({ deletedAt: null }).where(inArray(s.books.id, v.bookIds));
    });
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>('/api/households/:id', async (req) => {
    requireAdmin(req);
    const v = parse(z.object({ name: z.string().trim().min(1).max(80), surname: z.string().trim().max(60) }).partial(), req.body);
    const res = await db.update(s.households).set(v).where(and(eq(s.households.id, req.params.id), isNull(s.households.deletedAt))).returning({ id: s.households.id });
    if (!res.length) throw notFound('That household no longer exists');
    return { ok: true };
  });
}

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

export async function hasUnlock(db: Db, userId: string, bookId: string) {
  const [u] = await db
    .select({ e: s.bookUnlocks.expiresAt })
    .from(s.bookUnlocks)
    .where(and(eq(s.bookUnlocks.userId, userId), eq(s.bookUnlocks.bookId, bookId), gt(s.bookUnlocks.expiresAt, new Date())));
  return !!u;
}

/** Everything the shelf needs in one request. */
export async function loadLibrary(db: Db, user: SessionUser) {
  const [settings] = await db.select().from(s.settings);
  const households = await db.select().from(s.households).where(isNull(s.households.deletedAt)).orderBy(asc(s.households.sortOrder));
  const rows = await db.select().from(s.books).where(isNull(s.books.deletedAt));
  const books = orderBooks(rows);
  const ids = books.map((b) => b.id);
  const titles = await titleTexts(db, ids);
  const pageCounts = ids.length
    ? await db.select({ bookId: s.pages.bookId, n: count() }).from(s.pages).where(inArray(s.pages.bookId, ids)).groupBy(s.pages.bookId)
    : [];
  const yearRows = ids.length
    ? await db
        .select({ bookId: s.pages.bookId, year: s.pages.year })
        .from(s.pages)
        .where(and(inArray(s.pages.bookId, ids), eq(s.pages.layout, 'summaryL')))
        .orderBy(asc(s.pages.position))
    : [];
  const unlocks = await db
    .select({ bookId: s.bookUnlocks.bookId })
    .from(s.bookUnlocks)
    .where(and(eq(s.bookUnlocks.userId, user.id), gt(s.bookUnlocks.expiresAt, new Date())));
  const unlocked = new Set(unlocks.map((u) => u.bookId));

  return {
    settings: {
      familyName: settings?.familyName ?? 'Rivera',
      landing: settings?.landing ?? {},
      lockNewBooks: settings?.lockNewBooks ?? true,
      /** Whether new uploads should get a caption automatically (and captions are set up). */
      aiAuto: !!settings && settings.aiAuto && !!settings.aiEndpoint && !!settings.aiModel,
    },
    households: households.map((h) => ({ id: h.id, name: h.name, surname: h.surname })),
    books: books.map((b) => {
      const hh = households.find((h) => h.id === b.householdId);
      const owner = bookOwnerName(b, hh);
      const text = titles.get(b.id) ?? {};
      return {
        id: b.id,
        householdId: b.householdId,
        kind: b.kind,
        ownerName: b.ownerName,
        owner,
        title: bookName(owner, text),
        titleText: text,
        spineText: b.spineText,
        texture: b.texture,
        color: b.color,
        width: b.width,
        height: b.height,
        locked: b.locked,
        hasPin: !!b.pinHash,
        canEdit: canEditBook(user, b, unlocked.has(b.id)),
        sortOrder: b.sortOrder,
        updatedAt: b.updatedAt.toISOString(),
        pageCount: Math.max(0, (pageCounts.find((p) => p.bookId === b.id)?.n ?? 2) - 2),
        years: yearRows.filter((y) => y.bookId === b.id && y.year != null).map((y) => y.year!),
      };
    }),
  };
}

