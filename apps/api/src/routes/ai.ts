import { and, asc, eq, isNull, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bookOwnerName, captionContext, familyOf } from '@memento/shared';
import * as s from '../db/schema.js';
import { SEED_BASE_PROMPT, SEED_CAPTION_STYLES } from '../db/seed-data.js';
import { aiReady, chatComplete, listModels, loadAiConfig, writeCaption } from '../lib/ai.js';
import { encrypt, maskKey, decrypt } from '../lib/crypto.js';
import { HttpError, badRequest, forbidden, notFound, parse } from '../lib/http.js';
import { requireAdmin, requireUser } from '../lib/session.js';
import { requireEdit } from './content.js';

const SettingsPatch = z
  .object({
    endpoint: z
      .string()
      .trim()
      .max(300)
      .refine((v) => v === '' || isHttpUrl(v), 'The endpoint must be a web address starting with http:// or https://'),
    /** Plain key in, encrypted at rest. An empty string removes it. */
    key: z.string().trim().max(500),
    model: z.string().trim().max(120),
    vision: z.boolean(),
    voiceStyleId: z.string().uuid(),
    basePrompt: z.string().trim().min(1, "The base instructions can't be empty. Use Reset to default to start again.").max(8000),
    maxLen: z.number().int().min(30).max(120),
    emoji: z.boolean(),
    auto: z.boolean(),
  })
  .partial();

const originOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
};

export async function aiRoutes(app: FastifyInstance) {
  const { db, env, storage } = app.deps;
  const aiFetch = app.deps.aiFetch;

  async function view() {
    const [st] = await db.select().from(s.settings);
    const styles = await db.select().from(s.captionStyles).where(isNull(s.captionStyles.deletedAt)).orderBy(asc(s.captionStyles.sortOrder));
    const key = st?.aiKeyEncrypted ? decrypt(st.aiKeyEncrypted, env.ENCRYPTION_KEY) : null;
    return {
      endpoint: st?.aiEndpoint ?? '',
      keyMasked: key ? maskKey(key) : '',
      hasKey: !!key,
      model: st?.aiModel ?? '',
      vision: st?.aiVision ?? false,
      voiceStyleId: st?.aiVoiceStyleId ?? styles[0]?.id ?? null,
      basePrompt: st?.aiBasePrompt ?? '',
      maxLen: st?.aiMaxLen ?? 60,
      emoji: st?.aiEmoji ?? false,
      auto: st?.aiAuto ?? true,
      familyName: st?.familyName ?? '',
      styles: styles.map((x) => ({ id: x.id, key: x.key, name: x.name, prompt: x.prompt, builtin: x.builtin })),
      // First-run text, so the GUI can show "Reset to default". Never used to build a prompt.
      defaults: { basePrompt: SEED_BASE_PROMPT, styles: Object.fromEntries(SEED_CAPTION_STYLES.map((x) => [x.key, x.prompt])) },
    };
  }

  app.get('/api/ai', async (req) => {
    requireAdmin(req);
    return view();
  });

  app.patch('/api/ai', async (req) => {
    requireAdmin(req);
    const v = parse(SettingsPatch, req.body);
    const patch: Partial<typeof s.settings.$inferInsert> = { updatedAt: new Date() };
    if (v.endpoint !== undefined) {
      patch.aiEndpoint = v.endpoint;
      // The key belongs to its host. A new host needs the key typed again, so a stolen
      // session can't point the endpoint elsewhere and have the server send it the key.
      const [cur] = await db.select({ endpoint: s.settings.aiEndpoint }).from(s.settings);
      if (v.key === undefined && originOf(cur?.endpoint) !== originOf(v.endpoint)) patch.aiKeyEncrypted = null;
    }
    if (v.key !== undefined) patch.aiKeyEncrypted = v.key ? encrypt(v.key, env.ENCRYPTION_KEY) : null;
    if (v.model !== undefined) patch.aiModel = v.model;
    if (v.vision !== undefined) patch.aiVision = v.vision;
    if (v.basePrompt !== undefined) patch.aiBasePrompt = v.basePrompt;
    if (v.maxLen !== undefined) patch.aiMaxLen = v.maxLen;
    if (v.emoji !== undefined) patch.aiEmoji = v.emoji;
    if (v.auto !== undefined) patch.aiAuto = v.auto;
    if (v.voiceStyleId !== undefined) {
      const [st] = await db.select({ id: s.captionStyles.id }).from(s.captionStyles).where(and(eq(s.captionStyles.id, v.voiceStyleId), isNull(s.captionStyles.deletedAt)));
      if (!st) throw badRequest('That style no longer exists');
      patch.aiVoiceStyleId = v.voiceStyleId;
    }
    await db.update(s.settings).set(patch).where(eq(s.settings.id, 1));
    return view();
  });

  app.post('/api/ai/styles', async (req) => {
    requireAdmin(req);
    const v = parse(z.object({ name: z.string().trim().max(60).default('Custom'), prompt: z.string().max(8000).default('') }), req.body ?? {});
    const [{ m }] = (await db.select({ m: max(s.captionStyles.sortOrder) }).from(s.captionStyles)) as [{ m: number | null }];
    const [row] = await db.insert(s.captionStyles).values({ name: v.name || 'Custom', prompt: v.prompt, builtin: false, sortOrder: (m ?? 0) + 1 }).returning();
    return { id: row!.id };
  });

  app.patch<{ Params: { id: string } }>('/api/ai/styles/:id', async (req) => {
    requireAdmin(req);
    const v = parse(z.object({ name: z.string().trim().max(60), prompt: z.string().trim().min(1, "A style's prompt can't be empty.").max(8000) }).partial(), req.body);
    const [row] = await db.select().from(s.captionStyles).where(eq(s.captionStyles.id, req.params.id));
    if (!row) throw notFound('That style no longer exists');
    // Built-ins keep their name; their prompt is editable.
    await db.update(s.captionStyles).set(row.builtin ? { prompt: v.prompt ?? row.prompt } : v).where(eq(s.captionStyles.id, row.id));
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/ai/styles/:id', async (req) => {
    requireAdmin(req);
    const [row] = await db.select().from(s.captionStyles).where(and(eq(s.captionStyles.id, req.params.id), isNull(s.captionStyles.deletedAt)));
    if (!row) throw notFound('That style no longer exists');
    if (row.builtin) throw forbidden("Built-in styles can be edited but not deleted");
    await db.update(s.captionStyles).set({ deletedAt: new Date() }).where(eq(s.captionStyles.id, row.id));
    // If it was the active voice, fall back to the first built-in.
    const [st] = await db.select().from(s.settings);
    if (st?.aiVoiceStyleId === row.id) {
      const [first] = await db.select().from(s.captionStyles).where(isNull(s.captionStyles.deletedAt)).orderBy(asc(s.captionStyles.sortOrder)).limit(1);
      await db.update(s.settings).set({ aiVoiceStyleId: first?.id ?? null }).where(eq(s.settings.id, 1));
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/ai/styles/:id/restore', async (req) => {
    requireAdmin(req);
    await db.update(s.captionStyles).set({ deletedAt: null }).where(eq(s.captionStyles.id, req.params.id));
    return { ok: true };
  });

  /** The endpoint's models, for the Model picker. */
  app.get('/api/ai/models', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    requireAdmin(req);
    const c = await loadAiConfig(db, env.ENCRYPTION_KEY);
    if (!c.endpoint) throw badRequest('Add an endpoint URL first.');
    return { models: await listModels(c, { fetch: aiFetch }) };
  });

  /**
   * Tries the endpoint so the admin sees Connected or Couldn't connect.
   * With a model picked it asks for a tiny reply; without one it checks the model list loads.
   */
  app.post('/api/ai/test-connection', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    requireAdmin(req);
    const c = await loadAiConfig(db, env.ENCRYPTION_KEY);
    if (!c.endpoint) return { ok: false, message: 'Add an endpoint URL first.' };
    try {
      if (!c.model) {
        const models = await listModels(c, { fetch: aiFetch });
        return { ok: true, message: `Connected. ${models.length} model${models.length === 1 ? '' : 's'} available; pick one.`, models };
      }
      // Any successful reply counts, even empty text. No token limit is sent: newer OpenAI
      // models reject max_tokens (they want max_completion_tokens) and many local servers
      // only know max_tokens, so leaving it out works everywhere.
      await chatComplete(c, [{ role: 'user', content: 'Reply with the word ok.' }], { fetch: aiFetch, allowEmpty: true });
      return { ok: true, message: 'Connected' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Couldn't connect" };
    }
  });

  /**
   * Writes one caption. With photoId it needs edit rights on that book; with
   * inboxItemId or neither (the AI tab's test box) it's admin-only.
   */
  app.post('/api/ai/caption', { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async (req) => {
    const user = requireUser(req);
    const v = parse(
      z.object({
        subject: z.string().trim().max(300).default(''),
        context: z.string().trim().max(300).optional(),
        photoId: z.string().uuid().optional(),
        inboxItemId: z.string().uuid().optional(),
        /** Test box only: write as if for this book. */
        bookId: z.string().uuid().optional(),
        styleId: z.string().uuid().optional(),
      }),
      req.body,
    );
    let imageKey: string | null = null;
    let bookId: string | null = null;
    let where = v.context ?? null;
    if (v.photoId) {
      const [p] = await db.select().from(s.photos).where(and(eq(s.photos.id, v.photoId), isNull(s.photos.deletedAt)));
      if (!p) throw notFound('That photo no longer exists');
      await requireEdit(db, user, p.bookId);
      imageKey = p.thumbKey;
      bookId = p.bookId;
    } else {
      if (user.access !== 'admin') throw forbidden('Only the admin can do that');
      if (v.inboxItemId) {
        const [it] = await db.select().from(s.inboxItems).where(eq(s.inboxItems.id, v.inboxItemId));
        imageKey = it?.thumbKey ?? null;
        bookId = it?.destBookId ?? null;
        // The chapter picked for it says more than "family photo inbox".
        if (it?.destPageId) {
          const [pg] = await db.select().from(s.pages).where(eq(s.pages.id, it.destPageId));
          if (pg) where = [pg.label, pg.header?.subtitle].filter(Boolean).join(' · ') || where;
        }
      } else if (v.bookId) {
        bookId = v.bookId;
      }
    }
    const c = await loadAiConfig(db, env.ENCRYPTION_KEY, v.styleId);
    // Write in the voice of the book the photo is in: its family and whose book it is.
    if (bookId) {
      const [b] = await db.select().from(s.books).where(eq(s.books.id, bookId));
      const [hh] = b ? await db.select().from(s.households).where(eq(s.households.id, b.householdId)) : [];
      if (b) {
        c.familyName = familyOf(hh, c.familyName);
        c.owner = bookOwnerName(b, hh);
        where = captionContext(c.owner, where);
      }
    }
    let image: Buffer | null = null;
    if (c.vision && imageKey) image = await storage.get(imageKey).catch(() => null);
    if (!v.subject && !image) throw badRequest('Describe the photo first');
    try {
      return { caption: await writeCaption(c, v.subject || 'a family photo', where, image, { fetch: aiFetch }) };
    } catch (e) {
      // Only the admin can set captions up, so others are pointed to them, not to the Desk.
      if (e instanceof HttpError && e.statusCode === 400 && user.access !== 'admin' && !aiReady(c)) {
        throw new HttpError(400, "AI captions aren't turned on yet. Ask the family admin to set them up.");
      }
      // The upstream reply can name hosts or accounts, so only the admin sees it.
      if (e instanceof HttpError && (user.access === 'admin' || e.statusCode !== 502)) throw e;
      req.log.warn({ err: e }, 'Caption failed');
      throw new HttpError(502, "Couldn't write a caption. Try again in a moment.");
    }
  });
}

function isHttpUrl(v: string) {
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}
