import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import * as s from '../db/schema.js';
import { randomToken, sha256 } from './crypto.js';
import { forbidden, unauthorized } from './http.js';

export const SESSION_COOKIE = 'memento_session';
const SESSION_DAYS = 30;
const DAY = 86_400_000;

export type SessionUser = typeof s.users.$inferSelect;

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export async function createSession(db: Db, reply: FastifyReply, userId: string, secure: boolean) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
  await db.insert(s.sessions).values({ id: sha256(token), userId, expiresAt });
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, expires: expiresAt });
}

export async function destroySession(db: Db, req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.delete(s.sessions).where(eq(s.sessions.id, sha256(token)));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Resolves the cookie to a live, non-deleted user. Slides the expiry when it is past halfway. */
export async function loadUser(db: Db, req: FastifyRequest): Promise<SessionUser | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const id = sha256(token);
  const [row] = await db
    .select({ user: s.users, expiresAt: s.sessions.expiresAt })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(and(eq(s.sessions.id, id), gt(s.sessions.expiresAt, new Date()), isNull(s.users.deletedAt)));
  if (!row) return null;
  if (row.expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * DAY) {
    await db.update(s.sessions).set({ expiresAt: new Date(Date.now() + SESSION_DAYS * DAY) }).where(eq(s.sessions.id, id));
  }
  return row.user;
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireAdmin(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (u.access !== 'admin') throw forbidden('Only the admin can do that');
  return u;
}
