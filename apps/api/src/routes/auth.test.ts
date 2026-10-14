import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as s from '../db/schema.js';
import { ADMIN, createTestApp } from '../test/app.js';

const CODE_FAIL = "That code didn't work. Check it, or ask for a new one.";

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('magic link sign-in', () => {
  it('signs the admin in and returns their profile', async () => {
    const cookie = await t.login(ADMIN);
    const me = await t.app.inject({ url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ name: 'Marco', access: 'admin', isSuperAdmin: true });
    expect(me.json().deskTabs).toContain('ai');
  });

  it('matches emails case-insensitively', async () => {
    await expect(t.login(ADMIN.toUpperCase())).resolves.toMatch(/memento_session=/);
  });

  it('answers the same for unknown emails and sends nothing', async () => {
    const before = t.mails.length;
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email: 'nobody@example.com' } });
    expect(res.statusCode).toBe(200);
    expect(t.mails.length).toBe(before);
  });

  it('uses each link once', async () => {
    await t.app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email: ADMIN }, remoteAddress: '198.51.100.1' });
    const text = t.mails.at(-1)!.text;
    await t.cookieFromLink(text);
    await expect(t.cookieFromLink(text)).rejects.toThrow(/expired or was already used/);
  });

  it('rate-limits magic link requests per address', async () => {
    const hit = () => t.app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email: 'x@example.com' }, remoteAddress: '203.0.113.9' });
    for (let i = 0; i < 5; i++) expect((await hit()).statusCode).toBe(200);
    const res = await hit();
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toMatch(/Too many tries/);
  });

  describe('6-digit code', () => {
    const request = async (email: string, ip: string) => {
      await t.app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email }, remoteAddress: ip });
      const mail = t.mails.at(-1)!;
      return { mail, code: /code is (\d{3}) (\d{3})/.exec(mail.text)!.slice(1).join('') };
    };
    const verify = (email: string, code: string, ip: string) =>
      t.app.inject({ method: 'POST', url: '/api/auth/verify-code', payload: { email, code }, remoteAddress: ip });

    it('is emailed with the link and signs in when typed', async () => {
      const { mail, code } = await request(ADMIN, '198.51.100.20');
      expect(mail.subject).toBe(`${code} is your Memento sign-in code`);
      expect(mail.text).toContain('/auth/verify?token=');
      const res = await verify(ADMIN.toUpperCase(), code, '198.51.100.20');
      expect(res.statusCode).toBe(200);
      const cookie = `memento_session=${res.cookies.find((c) => c.name === 'memento_session')!.value}`;
      expect((await t.app.inject({ url: '/api/me', headers: { cookie } })).json().user.name).toBe('Marco');
    });

    it('works once, and using it also kills the link', async () => {
      const { mail, code } = await request(ADMIN, '198.51.100.21');
      expect((await verify(ADMIN, code, '198.51.100.21')).statusCode).toBe(200);
      expect((await verify(ADMIN, code, '198.51.100.21')).statusCode).toBe(400);
      await expect(t.cookieFromLink(mail.text)).rejects.toThrow();
    });

    it('only accepts the newest code', async () => {
      const first = await request(ADMIN, '198.51.100.22');
      const second = await request(ADMIN, '198.51.100.22');
      if (first.code !== second.code) expect((await verify(ADMIN, first.code, '198.51.100.22')).statusCode).toBe(400);
      expect((await verify(ADMIN, second.code, '198.51.100.22')).statusCode).toBe(200);
    });

    it('stops working after 5 wrong tries, even with the right code', async () => {
      const { code } = await request(ADMIN, '198.51.100.23');
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) expect((await verify(ADMIN, wrong, '198.51.100.23')).json()).toEqual({ error: CODE_FAIL });
      expect((await verify(ADMIN, code, '198.51.100.24')).json()).toEqual({ error: CODE_FAIL });
    });

    it('sends at most 5 unused sign-in emails an hour', async () => {
      const email = 'cap@example.com';
      await t.db.insert(s.users).values({ name: 'Cap', email, access: 'member' });
      const before = t.mails.length;
      for (let i = 0; i < 7; i++) {
        const res = await t.app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email }, remoteAddress: `198.51.100.${60 + i}` });
        expect(res.json()).toEqual({ ok: true });
      }
      expect(t.mails.length - before).toBe(5);
    });

    it('gives the same answer for unknown emails', async () => {
      const res = await verify('nobody@example.com', '123456', '198.51.100.25');
      expect(res.json()).toEqual({ error: CODE_FAIL });
    });

    it('is rate-limited per address', async () => {
      const codes = Array.from({ length: 11 }, () => verify('nobody@example.com', '123456', '203.0.113.50'));
      const last = await codes.reduce((p, c) => p.then(() => c));
      expect(last.statusCode).toBe(429);
    });
  });

  it('rejects requests with no session', async () => {
    expect((await t.app.inject({ url: '/api/me' })).statusCode).toBe(401);
  });

  it('logs out by deleting the session', async () => {
    const cookie = await t.login(ADMIN);
    await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect((await t.app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('blocks deleted users even with a live session', async () => {
    const admin = await t.login(ADMIN);
    await t.app.inject({ method: 'POST', url: '/api/people', headers: { cookie: admin }, payload: { name: 'Temp', email: 'temp@example.com', sendInvite: false } });
    const cookie = await t.login('temp@example.com');
    const [u] = await t.db.select().from(s.users).where(eq(s.users.email, 'temp@example.com'));
    await t.db.update(s.users).set({ deletedAt: new Date() }).where(eq(s.users.id, u!.id));
    expect((await t.app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });
});
