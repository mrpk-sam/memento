import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { LIMITS } from '@memento/shared';
import * as s from '../db/schema.js';
import { randomToken, sha256 } from './crypto.js';
import { badRequest } from './http.js';
import { inviteEmail, magicLinkEmail } from './mail.js';

export const MAGIC_MINUTES = 15;
const DAY = 86_400_000;

/** Codes are 6 digits, so they're keyed to their link and the server secret before hashing. */
export const codeHash = (secret: string, linkId: string, code: string) => createHmac('sha256', secret).update(`${linkId}:${code}`).digest('hex');

type Person = { id: string; name: string; email: string | null };

/** Unused sign-in emails per person per hour. Each one carries a fresh code with its own tries. */
export const SIGNIN_EMAILS_PER_HOUR = 5;

/**
 * Emails a sign-in link and 6-digit code (15 minutes, single use).
 * It doesn't wait for the mail server, so the reply takes the same time for members
 * and strangers, and past the hourly cap it quietly sends nothing.
 */
export async function sendSignInEmail(app: FastifyInstance, user: Person, email: string) {
  const { db, env } = app.deps;
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.magicLinks)
    .where(and(eq(s.magicLinks.userId, user.id), isNull(s.magicLinks.usedAt), gt(s.magicLinks.createdAt, new Date(Date.now() - 3_600_000))))) as [{ n: number }];
  if (n >= SIGNIN_EMAILS_PER_HOUR) {
    app.log.warn({ userId: user.id }, 'Sign-in email skipped: hourly limit reached');
    return;
  }
  const token = randomToken();
  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.insert(s.magicLinks).values({
    id,
    userId: user.id,
    tokenHash: sha256(token),
    codeHash: codeHash(env.SESSION_SECRET, id, code),
    expiresAt: new Date(Date.now() + MAGIC_MINUTES * 60_000),
  });
  app.mailer(magicLinkEmail(email, user.name, `${env.APP_URL}/auth/verify?token=${token}`, code)).catch((err) => app.log.error({ err }, 'Sign-in email failed'));
}

/** Creates a fresh invite token (replacing any open invite) and emails it. */
export async function sendInvite(app: FastifyInstance, person: Person, opts: { resend: boolean }) {
  const { db, env } = app.deps;
  if (!person.email) throw badRequest('Add an email so the invite has somewhere to go');
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LIMITS.inviteDays * DAY);
  const [open] = await db
    .select()
    .from(s.invites)
    .where(and(eq(s.invites.userId, person.id), isNull(s.invites.acceptedAt), isNull(s.invites.cancelledAt)))
    .orderBy(desc(s.invites.sentAt))
    .limit(1);
  if (open) {
    await db
      .update(s.invites)
      .set({ tokenHash: sha256(token), sentAt: now, expiresAt, resentCount: open.resentCount + (opts.resend ? 1 : 0) })
      .where(eq(s.invites.id, open.id));
  } else {
    await db.insert(s.invites).values({ userId: person.id, tokenHash: sha256(token), sentAt: now, expiresAt });
  }
  const [st] = await db.select({ f: s.settings.familyName }).from(s.settings);
  await app.mailer(inviteEmail(person.email, person.name, st?.f ?? 'our', `${env.APP_URL}/auth/verify?token=${token}`));
}
