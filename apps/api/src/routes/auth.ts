import { timingSafeEqual } from 'node:crypto';
import { codeHash, sendSignInEmail } from '../lib/signin.js';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deskTabs } from '@memento/shared';
import * as s from '../db/schema.js';
import { sha256 } from '../lib/crypto.js';
import { badRequest, parse } from '../lib/http.js';
import { createSession, destroySession, requireUser } from '../lib/session.js';

const CODE_TRIES = 5;
const CODE_TRIES_PER_DAY = 20;
const CODE_FAIL = "That code didn't work. Check it, or ask for a new one.";

export async function authRoutes(app: FastifyInstance) {
  const { db, env } = app.deps;
  const secure = env.APP_URL.startsWith('https://');
  const hashCode = (linkId: string, code: string) => codeHash(env.SESSION_SECRET, linkId, code);

  app.post(
    '/api/auth/magic-link',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req) => {
      const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email') }), req.body);
      const [user] = await db
        .select()
        .from(s.users)
        .where(and(sql`lower(${s.users.email}) = ${email}`, isNull(s.users.deletedAt)));
      // Same reply whether or not the email is known, so it can't be used to probe members.
      if (user) {
        await sendSignInEmail(app, user, email);
      } else {
        // Logged for the admin only; the reply stays the same so members can't be probed.
        req.log.info({ email }, 'Sign-in requested for an email with no account. Add it in Family members.');
      }
      return { ok: true };
    },
  );

  // The emailed link opens a web page, which POSTs the token here.
  // A GET would let email link scanners burn single-use tokens.
  app.post(
    '/api/auth/verify',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const { token } = parse(z.object({ token: z.string().min(20).max(200) }), req.body);
      const hash = sha256(token);
      const now = new Date();

      const userId = await db.transaction(async (tx) => {
        const [ml] = await tx
          .update(s.magicLinks)
          .set({ usedAt: now })
          .where(and(eq(s.magicLinks.tokenHash, hash), isNull(s.magicLinks.usedAt), gt(s.magicLinks.expiresAt, now)))
          .returning();
        if (ml) {
          // Signing in by email also settles any open invite.
          await tx.update(s.invites).set({ acceptedAt: now }).where(and(eq(s.invites.userId, ml.userId), isNull(s.invites.acceptedAt)));
          return ml.userId;
        }
        const [inv] = await tx
          .update(s.invites)
          .set({ acceptedAt: now })
          .where(and(eq(s.invites.tokenHash, hash), isNull(s.invites.acceptedAt), isNull(s.invites.cancelledAt), gt(s.invites.expiresAt, now)))
          .returning();
        return inv?.userId ?? null;
      });

      if (!userId) throw badRequest('This link has expired or was already used. Ask for a new one.');
      const [user] = await db.select().from(s.users).where(and(eq(s.users.id, userId), isNull(s.users.deletedAt)));
      if (!user) throw badRequest('This account was removed.');
      await createSession(db, reply, user.id, secure);
      return { ok: true };
    },
  );

  /**
   * The 6-digit code from the sign-in email, typed into the app. Needed on iPhone,
   * where an installed app and Safari keep separate sign-ins, so the link can't reach the app.
   * Only the newest code counts, and it stops working after 5 wrong tries (20 a day per person).
   * Every failure gets the same reply.
   */
  app.post(
    '/api/auth/verify-code',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const v = parse(
        z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email'), code: z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits') }),
        req.body,
      );
      const [user] = await db.select().from(s.users).where(and(sql`lower(${s.users.email}) = ${v.email}`, isNull(s.users.deletedAt)));
      if (!user) {
        hashCode('00000000-0000-0000-0000-000000000000', v.code); // same work as a real check
        throw badRequest(CODE_FAIL);
      }
      const now = new Date();
      // Each email brings a fresh code, so also cap wrong tries per person per day.
      const [{ tries }] = (await db
        .select({ tries: sql<number>`coalesce(sum(${s.magicLinks.codeAttempts}), 0)::int` })
        .from(s.magicLinks)
        .where(and(eq(s.magicLinks.userId, user.id), gt(s.magicLinks.createdAt, new Date(now.getTime() - 86_400_000))))) as [{ tries: number }];
      if (tries >= CODE_TRIES_PER_DAY) throw badRequest(CODE_FAIL);
      const [link] = await db
        .select()
        .from(s.magicLinks)
        .where(and(eq(s.magicLinks.userId, user.id), isNull(s.magicLinks.usedAt), gt(s.magicLinks.expiresAt, now)))
        .orderBy(desc(s.magicLinks.createdAt))
        .limit(1);
      if (!link?.codeHash) throw badRequest(CODE_FAIL);
      // Count the try before checking, so parallel guesses can't beat the limit.
      const [counted] = await db
        .update(s.magicLinks)
        .set({ codeAttempts: sql`${s.magicLinks.codeAttempts} + 1` })
        .where(and(eq(s.magicLinks.id, link.id), lt(s.magicLinks.codeAttempts, CODE_TRIES)))
        .returning({ attempts: s.magicLinks.codeAttempts });
      if (!counted) throw badRequest(CODE_FAIL);
      const want = Buffer.from(link.codeHash, 'hex');
      const got = Buffer.from(hashCode(link.id, v.code), 'hex');
      // One reply for every failure, so it can't tell a member from a stranger.
      if (!timingSafeEqual(want, got)) throw badRequest(CODE_FAIL);
      const [used] = await db.update(s.magicLinks).set({ usedAt: now }).where(and(eq(s.magicLinks.id, link.id), isNull(s.magicLinks.usedAt))).returning();
      if (!used) throw badRequest(CODE_FAIL);
      await db.update(s.invites).set({ acceptedAt: now }).where(and(eq(s.invites.userId, user.id), isNull(s.invites.acceptedAt)));
      await createSession(db, reply, user.id, secure);
      return { ok: true };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(db, req, reply);
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const u = requireUser(req);
    const unlocks = await db
      .select({ bookId: s.bookUnlocks.bookId, expiresAt: s.bookUnlocks.expiresAt })
      .from(s.bookUnlocks)
      .where(and(eq(s.bookUnlocks.userId, u.id), gt(s.bookUnlocks.expiresAt, new Date())));
    const [hh] = u.householdId
      ? await db
          .select({ surname: s.households.surname, color: s.books.color })
          .from(s.households)
          .leftJoin(s.books, and(eq(s.books.householdId, s.households.id), eq(s.books.kind, 'main'), isNull(s.books.deletedAt)))
          .where(eq(s.households.id, u.householdId))
      : [];
    return {
      user: {
        id: u.id,
        name: u.name,
        roleLabel: u.roleLabel,
        email: u.email,
        access: u.access,
        householdId: u.householdId,
        surname: hh?.surname ?? '',
        avatarColor: hh?.color ?? '#8C7A66',
        isSuperAdmin: !!u.email && u.email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase(),
      },
      deskTabs: deskTabs(u),
      unlocks: unlocks.map((x) => ({ bookId: x.bookId, expiresAt: x.expiresAt.toISOString() })),
    };
  });
}
