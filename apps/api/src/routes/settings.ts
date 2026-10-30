import { randomUUID } from 'node:crypto';
import { and, count, eq, isNull, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HexColor, STICKER_PACKS } from '@memento/shared';
import * as s from '../db/schema.js';
import { HttpError, forbidden, notFound, parse } from '../lib/http.js';
import { requireAdmin } from '../lib/session.js';

const MOTIFS = ['none', 'confetti', 'stars', 'snow', 'bunting', 'washi', 'bunting+stars', 'bunting+confetti'] as const;
const LANDING_KEYS = ['kicker', 'head', 'intro', 'btn1', 'btn2'] as const;

export async function settingsRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  /** How many pages use each theme, for the library cards. */
  app.get('/api/themes/usage', async (req) => {
    requireAdmin(req);
    const rows = await db
      .select({ themeId: s.pages.themeId, n: count() })
      .from(s.pages)
      .innerJoin(s.books, eq(s.books.id, s.pages.bookId))
      .where(isNull(s.books.deletedAt))
      .groupBy(s.pages.themeId);
    return Object.fromEntries(rows.map((r) => [r.themeId, r.n]));
  });

  const ThemeBody = z.object({
    name: z.string().trim().max(60).default(''),
    paper: HexColor,
    accent: HexColor,
    accent2: HexColor,
    motif: z.enum(MOTIFS),
    stickerPack: z.string().refine((k) => k in STICKER_PACKS, 'Unknown sticker pack').default('none'),
  });
  /** Bunting flags for a builder theme: its two colours around a paper-coloured stripe. */
  const flagsOf = (v: z.infer<typeof ThemeBody>) => [v.accent, v.paper.toUpperCase() === '#FFFFFF' ? '#F3ECE2' : '#FFFFFF', v.accent2];

  /** Saves a theme from the builder. Ink and bunting flags follow the prototype's builder. */
  app.post('/api/themes', async (req) => {
    requireAdmin(req);
    const v = parse(ThemeBody, req.body);
    const [{ m }] = (await db.select({ m: max(s.themes.sortOrder) }).from(s.themes)) as [{ m: number | null }];
    const id = `custom-${randomUUID()}`;
    await db.insert(s.themes).values({
      id,
      name: v.name || 'Custom theme',
      paper: v.paper,
      ink: '#3A3026',
      accent: v.accent,
      accent2: v.accent2,
      motif: v.motif,
      flags: flagsOf(v),
      stickerPack: v.stickerPack,
      builtin: false,
      sortOrder: (m ?? 0) + 1,
    });
    return { id };
  });

  /** Edits a custom theme from the builder. Built-in themes stay as they are. */
  app.patch<{ Params: { id: string } }>('/api/themes/:id', async (req) => {
    requireAdmin(req);
    const v = parse(ThemeBody, req.body);
    const [t] = await db.select().from(s.themes).where(and(eq(s.themes.id, req.params.id), isNull(s.themes.deletedAt)));
    if (!t) throw notFound('That theme no longer exists');
    if (t.builtin) throw forbidden("Built-in themes can't be changed. Make your own in the builder.");
    await db
      .update(s.themes)
      .set({ name: v.name || 'Custom theme', paper: v.paper, accent: v.accent, accent2: v.accent2, motif: v.motif, flags: flagsOf(v), stickerPack: v.stickerPack })
      .where(eq(s.themes.id, t.id));
    return { id: t.id };
  });

  /** Custom themes can be removed once no page uses them. */
  app.delete<{ Params: { id: string } }>('/api/themes/:id', async (req) => {
    requireAdmin(req);
    const [t] = await db.select().from(s.themes).where(and(eq(s.themes.id, req.params.id), isNull(s.themes.deletedAt)));
    if (!t) throw notFound('That theme no longer exists');
    if (t.builtin) throw forbidden("Built-in themes can't be deleted");
    const [{ n }] = (await db.select({ n: count() }).from(s.pages).where(eq(s.pages.themeId, t.id))) as [{ n: number }];
    if (n > 0) throw new HttpError(409, `${n} page${n > 1 ? 's use' : ' uses'} this theme. Change ${n > 1 ? 'them' : 'it'} first.`);
    await db.update(s.themes).set({ deletedAt: new Date() }).where(eq(s.themes.id, t.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/themes/:id/restore', async (req) => {
    requireAdmin(req);
    await db.update(s.themes).set({ deletedAt: null }).where(eq(s.themes.id, req.params.id));
    return { ok: true };
  });

  app.patch('/api/settings', async (req) => {
    requireAdmin(req);
    const v = parse(
      z
        .object({
          familyName: z.string().trim().min(1, 'Add a family name').max(60),
          lockNewBooks: z.boolean(),
          // Blank fields fall back to the default copy, so they're kept as ''.
          landing: z.object(Object.fromEntries(LANDING_KEYS.map((k) => [k, z.string().max(400).optional()]))).strict(),
        })
        .partial(),
      req.body,
    );
    await db
      .update(s.settings)
      .set({ ...v, ...(v.landing ? { landing: v.landing as Record<string, string> } : {}), updatedAt: new Date() })
      .where(eq(s.settings.id, 1));
    return { ok: true };
  });
}
