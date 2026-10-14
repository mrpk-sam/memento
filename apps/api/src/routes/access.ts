import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Access, canUseDesk, checkPersonChange } from '@memento/shared';
import * as s from '../db/schema.js';
import { HttpError, badRequest, forbidden, notFound, parse } from '../lib/http.js';
import { accessRequestEmail } from '../lib/mail.js';
import { requireUser } from '../lib/session.js';
import { sendInvite, sendSignInEmail } from '../lib/signin.js';

type Req = typeof s.accessRequests.$inferSelect;

export async function accessRoutes(app: FastifyInstance) {
  const { db, env } = app.deps;

  const dto = (r: Req) => ({ id: r.id, email: r.email, name: r.name, note: r.note, createdAt: r.createdAt.toISOString() });

  /**
   * Someone with no account asks to join. The reply is the same whatever happens,
   * so the form can't be used to find out who is a member. Existing members just
   * get a normal sign-in email.
   */
  app.post('/api/auth/request-access', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
    const v = parse(
      z.object({
        email: z.string().trim().toLowerCase().email('Enter a valid email'),
        name: z.string().trim().min(1, 'Add your name').max(80),
        note: z.string().trim().max(300).default(''),
      }),
      req.body,
    );
    const [user] = await db.select().from(s.users).where(and(sql`lower(${s.users.email}) = ${v.email}`, isNull(s.users.deletedAt)));
    if (user) {
      await sendSignInEmail(app, user, v.email);
      return { ok: true };
    }
    const [open] = await db.select().from(s.accessRequests).where(and(sql`lower(${s.accessRequests.email}) = ${v.email}`, isNull(s.accessRequests.decidedAt)));
    if (open) {
      // Asking again updates the request instead of piling up duplicates.
      await db.update(s.accessRequests).set({ name: v.name, note: v.note }).where(eq(s.accessRequests.id, open.id));
      return { ok: true };
    }
    await db.insert(s.accessRequests).values({ email: v.email, name: v.name, note: v.note });
    req.log.info({ email: v.email }, 'Access requested');
    try {
      await app.mailer(accessRequestEmail(env.ADMIN_EMAIL, v.name, v.email, v.note, `${env.APP_URL}/desk/family`));
    } catch (err) {
      // The request is saved and shows in Family members even if the heads-up email fails.
      req.log.error({ err }, 'Could not email the admin about an access request');
    }
    return { ok: true };
  });

  const deskUser = (req: Parameters<typeof requireUser>[0]) => {
    const u = requireUser(req);
    if (!canUseDesk(u)) throw forbidden();
    return u;
  };

  app.get('/api/access-requests', async (req) => {
    deskUser(req);
    const rows = await db.select().from(s.accessRequests).where(isNull(s.accessRequests.decidedAt)).orderBy(desc(s.accessRequests.createdAt));
    return { requests: rows.map(dto) };
  });

  async function openRequest(id: string) {
    const [r] = await db.select().from(s.accessRequests).where(and(eq(s.accessRequests.id, id), isNull(s.accessRequests.decidedAt)));
    if (!r) throw notFound('That request was already handled');
    return r;
  }

  /** Approving adds them as a member and emails an invite link. */
  app.post<{ Params: { id: string } }>('/api/access-requests/:id/approve', async (req) => {
    const actor = deskUser(req);
    const r = await openRequest(req.params.id);
    const v = parse(
      z.object({
        name: z.string().trim().min(1).max(80).optional(),
        roleLabel: z.string().trim().max(60).optional(),
        access: Access.default('member'),
        householdId: z.string().uuid().nullable().default(null),
      }),
      req.body ?? {},
    );
    const err = checkPersonChange(actor, { access: v.access, householdId: v.householdId });
    if (err) throw forbidden(err);
    if (v.householdId) {
      const [h] = await db.select({ id: s.households.id }).from(s.households).where(and(eq(s.households.id, v.householdId), isNull(s.households.deletedAt)));
      if (!h) throw badRequest('That household no longer exists');
    }
    const [existing] = await db.select().from(s.users).where(and(sql`lower(${s.users.email}) = ${r.email.toLowerCase()}`, isNull(s.users.deletedAt)));
    if (existing) throw new HttpError(409, `${r.email} is already a member`);
    const [person] = await db
      .insert(s.users)
      .values({
        name: v.name || r.name,
        roleLabel: v.roleLabel || (v.householdId ? 'Family' : 'Guest'),
        email: r.email,
        access: v.access,
        householdId: v.householdId,
      })
      .returning();
    await db.update(s.accessRequests).set({ decidedAt: new Date(), decision: 'approved', decidedBy: actor.id, userId: person!.id }).where(eq(s.accessRequests.id, r.id));
    await sendInvite(app, person!, { resend: false });
    return { ok: true, personId: person!.id };
  });

  /** Declining sends nothing to the requester. Undo reopens the request. */
  app.post<{ Params: { id: string } }>('/api/access-requests/:id/decline', async (req) => {
    const actor = deskUser(req);
    const r = await openRequest(req.params.id);
    await db.update(s.accessRequests).set({ decidedAt: new Date(), decision: 'declined', decidedBy: actor.id }).where(eq(s.accessRequests.id, r.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/access-requests/:id/reopen', async (req) => {
    deskUser(req);
    const [r] = await db.select().from(s.accessRequests).where(eq(s.accessRequests.id, req.params.id));
    if (!r || r.decision !== 'declined') throw notFound('That request cannot be reopened');
    await db.update(s.accessRequests).set({ decidedAt: null, decision: null, decidedBy: null }).where(eq(s.accessRequests.id, r.id));
    return { ok: true };
  });
}
