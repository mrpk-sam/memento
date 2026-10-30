import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Access, LIMITS, bookName, canManagePerson, canUseDesk, checkPersonChange } from '@memento/shared';
import { titleTexts } from '../lib/books.js';
import type { Db } from '../db/client.js';
import * as s from '../db/schema.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { HttpError, badRequest, forbidden, notFound, parse } from '../lib/http.js';
import { sendInvite } from '../lib/signin.js';
import { requireUser, type SessionUser } from '../lib/session.js';

const DAY = 86_400_000;
const EmailOrEmpty = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === '' || z.string().email().safeParse(v).success, 'That email looks incomplete')
  .transform((v) => (v === '' ? null : v));

const CreatePerson = z.object({
  name: z.string().trim().min(1, 'Add a name first').max(80),
  roleLabel: z.string().trim().max(60).optional(),
  email: EmailOrEmpty.default(null),
  access: Access.default('member'),
  householdId: z.string().uuid().nullable().default(null),
  sendInvite: z.boolean().default(true),
});

const UpdatePerson = z
  .object({
    name: z.string().trim().min(1).max(80),
    roleLabel: z.string().trim().max(60),
    email: EmailOrEmpty,
    access: Access,
    householdId: z.string().uuid().nullable(),
  })
  .partial();

type Person = typeof s.users.$inferSelect;

export async function peopleRoutes(app: FastifyInstance) {
  const { db, env } = app.deps;
  const superEmail = env.ADMIN_EMAIL.toLowerCase();
  const isSuper = (u: Pick<Person, 'email'>) => !!u.email && u.email.toLowerCase() === superEmail;

  const deskUser = (req: Parameters<typeof requireUser>[0]) => {
    const u = requireUser(req);
    if (!canUseDesk(u)) throw forbidden();
    return u;
  };

  async function loadPerson(id: string, opts: { withDeleted?: boolean } = {}) {
    const [p] = await db
      .select()
      .from(s.users)
      .where(opts.withDeleted ? eq(s.users.id, id) : and(eq(s.users.id, id), isNull(s.users.deletedAt)));
    if (!p) throw notFound('That person no longer exists');
    return p;
  }

  function assertManage(actor: SessionUser, target: Person) {
    if (!canManagePerson(actor, target)) throw forbidden("You can't change this person");
  }

  async function assertHousehold(id: string | null) {
    if (!id) return;
    const [h] = await db.select({ id: s.households.id }).from(s.households).where(and(eq(s.households.id, id), isNull(s.households.deletedAt)));
    if (!h) throw badRequest('That household no longer exists');
  }

  app.get('/api/people', async (req) => {
    const actor = deskUser(req);
    const list = await listPeople(db, superEmail);
    if (actor.access === 'admin') return list;
    // A household admin manages their own household only, so other people's emails stay hidden.
    return { ...list, people: list.people.map((p) => (p.householdId === actor.householdId ? p : { ...p, email: null })) };
  });

  app.post('/api/people', async (req) => {
    const actor = deskUser(req);
    const body = parse(CreatePerson, req.body);
    const err = checkPersonChange(actor, body);
    if (err) throw forbidden(err);
    if (body.sendInvite && !body.email) throw badRequest('Add an email so the invite has somewhere to go');
    await assertHousehold(body.householdId);
    const [person] = await insertOrConflict(() =>
      db
        .insert(s.users)
        .values({
          name: body.name,
          roleLabel: body.roleLabel || (body.householdId ? 'Family' : 'Guest'),
          email: body.email,
          access: body.access,
          householdId: body.householdId,
        })
        .returning(),
    );
    if (body.sendInvite) await sendInvite(app, person!, { resend: false });
    return { id: person!.id };
  });

  app.patch<{ Params: { id: string } }>('/api/people/:id', async (req) => {
    const actor = deskUser(req);
    const current = await loadPerson(req.params.id);
    const patch = parse(UpdatePerson, req.body);
    const next = { access: patch.access ?? current.access, householdId: patch.householdId !== undefined ? patch.householdId : current.householdId };
    const err = checkPersonChange(actor, next, current);
    if (err) throw forbidden(err);
    if (isSuper(current) && next.access !== 'admin') throw forbidden('The super-admin stays an admin');
    if (isSuper(current) && patch.email !== undefined && patch.email?.toLowerCase() !== superEmail) {
      throw forbidden("The super-admin's email is set by ADMIN_EMAIL on the server");
    }
    await assertHousehold(next.householdId);
    const [updated] = await insertOrConflict(() => db.update(s.users).set(patch).where(eq(s.users.id, current.id)).returning());
    // Links and sessions belong to the old address. Whoever holds it loses access.
    if (patch.email !== undefined && (patch.email ?? '').toLowerCase() !== (current.email ?? '').toLowerCase()) {
      const openInvite = and(eq(s.invites.userId, current.id), isNull(s.invites.acceptedAt), isNull(s.invites.cancelledAt));
      const [open] = await db.select({ id: s.invites.id }).from(s.invites).where(openInvite);
      // A fresh invite replaces the old token, so a typo'd address can't use it.
      if (open && updated!.email) await sendInvite(app, updated!, { resend: true });
      else if (open) await db.update(s.invites).set({ cancelledAt: new Date() }).where(openInvite);
      await db.delete(s.magicLinks).where(and(eq(s.magicLinks.userId, current.id), isNull(s.magicLinks.usedAt)));
      if (current.id !== actor.id) {
        await db.delete(s.sessions).where(eq(s.sessions.userId, current.id));
        await db.delete(s.bookUnlocks).where(eq(s.bookUnlocks.userId, current.id));
      }
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/people/:id', async (req) => {
    const actor = deskUser(req);
    const p = await loadPerson(req.params.id);
    assertManage(actor, p);
    if (p.id === actor.id) throw badRequest("You can't remove yourself");
    if (isSuper(p)) throw forbidden("The super-admin can't be removed");
    await db.update(s.users).set({ deletedAt: new Date() }).where(eq(s.users.id, p.id));
    await db.delete(s.sessions).where(eq(s.sessions.userId, p.id));
    return { ok: true };
  });

  /** Undo for delete and for cancelled invites. */
  app.post<{ Params: { id: string } }>('/api/people/:id/restore', async (req) => {
    const actor = deskUser(req);
    const p = await loadPerson(req.params.id, { withDeleted: true });
    assertManage(actor, p);
    await insertOrConflict(() => db.update(s.users).set({ deletedAt: null }).where(eq(s.users.id, p.id)).returning());
    const [last] = await db.select().from(s.invites).where(eq(s.invites.userId, p.id)).orderBy(desc(s.invites.sentAt)).limit(1);
    if (last?.cancelledAt) await db.update(s.invites).set({ cancelledAt: null }).where(eq(s.invites.id, last.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/people/:id/invite', async (req) => {
    const actor = deskUser(req);
    const p = await loadPerson(req.params.id);
    assertManage(actor, p);
    await sendInvite(app, p, { resend: true });
    return { ok: true, email: p.email };
  });

  /** Cancelling an invite kills the link and removes the pending person (Undo restores both). */
  app.post<{ Params: { id: string } }>('/api/people/:id/invite/cancel', async (req) => {
    const actor = deskUser(req);
    const p = await loadPerson(req.params.id);
    assertManage(actor, p);
    if (isSuper(p)) throw forbidden("The super-admin can't be removed");
    const now = new Date();
    await db.update(s.invites).set({ cancelledAt: now }).where(and(eq(s.invites.userId, p.id), isNull(s.invites.acceptedAt), isNull(s.invites.cancelledAt)));
    await db.update(s.users).set({ deletedAt: now }).where(eq(s.users.id, p.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/people/:id/invite/accept', async (req) => {
    const actor = deskUser(req);
    const p = await loadPerson(req.params.id);
    assertManage(actor, p);
    await db.update(s.invites).set({ acceptedAt: new Date() }).where(and(eq(s.invites.userId, p.id), isNull(s.invites.acceptedAt)));
    return { ok: true };
  });
}

/** Turns the unique-email violation into a friendly 409. */
async function insertOrConflict<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') throw new HttpError(409, 'Someone already uses that email');
    throw e;
  }
}

export async function listPeople(db: Db, superEmail: string) {
  const households = await db.select().from(s.households).where(isNull(s.households.deletedAt)).orderBy(asc(s.households.sortOrder));
  const people = await db.select().from(s.users).where(isNull(s.users.deletedAt)).orderBy(asc(s.users.createdAt));
  const ids = people.map((p) => p.id);
  const invites = ids.length
    ? await db
        .select()
        .from(s.invites)
        .where(and(inArray(s.invites.userId, ids), isNull(s.invites.acceptedAt), isNull(s.invites.cancelledAt)))
        .orderBy(desc(s.invites.sentAt))
    : [];
  const inviteByUser = new Map<string, (typeof invites)[number]>();
  for (const i of invites) if (!inviteByUser.has(i.userId)) inviteByUser.set(i.userId, i);
  const mainBooks = await db
    .select({ id: s.books.id, householdId: s.books.householdId, texture: s.books.texture, color: s.books.color })
    .from(s.books)
    .where(and(eq(s.books.kind, 'main'), isNull(s.books.deletedAt)));
  const titles = await titleTexts(db, mainBooks.map((b) => b.id));

  return {
    households: households.map((h) => {
      const b = mainBooks.find((x) => x.householdId === h.id);
      return {
        id: h.id,
        name: h.name,
        surname: h.surname,
        mainBook: b ? { id: b.id, texture: b.texture, color: b.color, title: bookName(h.name, titles.get(b.id)) } : null,
      };
    }),
    people: people.map((p) => {
      const inv = inviteByUser.get(p.id);
      return {
        id: p.id,
        name: p.name,
        roleLabel: p.roleLabel,
        email: p.email,
        access: p.access,
        householdId: p.householdId,
        isSuperAdmin: !!p.email && p.email.toLowerCase() === superEmail,
        invite: inv ? { sentAt: inv.sentAt.toISOString(), expiresAt: inv.expiresAt.toISOString(), resentCount: inv.resentCount } : null,
      };
    }),
  };
}
