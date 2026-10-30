import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, createTestApp } from './test/app.js';
import { env } from './env.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('request guards', () => {
  it('rate-limits an encoded path like the plain one', async () => {
    const hit = () => t.app.inject({ method: 'POST', url: '/%61pi/auth/magic-link', payload: { email: 'x@example.com' }, remoteAddress: '203.0.113.77' });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await hit()).statusCode);
    expect(codes.at(-1)).toBe(429);
  });

  it('refuses writes from another site', async () => {
    const admin = await t.login(ADMIN);
    const patch = (headers: Record<string, string>) =>
      t.app.inject({ method: 'PATCH', url: '/api/settings', headers: { cookie: admin, ...headers }, payload: { lockNewBooks: true } });
    expect((await patch({ origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await patch({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    expect((await patch({ origin: 'http://localhost:5173' })).statusCode).toBe(200);
    expect((await patch({ 'sec-fetch-site': 'same-origin' })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/api/me', headers: { cookie: admin, origin: 'https://evil.example' } })).statusCode).toBe(200);
  });
});

describe('TRUST_PROXY', () => {
  const parse = (v: string | undefined) => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, {
        APP_URL: 'http://localhost',
        DATABASE_URL: 'postgres://x@localhost/x',
        S3_ENDPOINT: 'http://localhost:9000',
        S3_ACCESS_KEY: 'a',
        S3_SECRET_KEY: 'b',
        SESSION_SECRET: 'x'.repeat(32),
        ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
        ADMIN_EMAIL: 'admin@example.com',
      });
      if (v === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = v;
      return env({ fresh: true }).TRUST_PROXY;
    } finally {
      process.env = saved;
    }
  };

  it('never trusts every hop', () => {
    expect(parse(undefined)).toBe(false);
    expect(parse('false')).toBe(false);
    expect(parse('true')).toBe(1);
    expect(parse('2')).toBe(2);
    expect(parse('10.0.0.0/8')).toBe('10.0.0.0/8');
  });
});

describe('errors people can read', () => {
  it('gives 404 for an id that is not a UUID, and plain sentences for bad input', async () => {
    const t = await createTestApp();
    try {
      const admin = await t.login(ADMIN);
      const call = (method: string, url: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload });
      for (const url of ['/api/photos/abc', '/api/people/abc', '/api/books/abc', '/api/inbox/abc']) expect((await call('PATCH', url, { caption: 'x', name: 'x' })).statusCode).toBe(404);
      const [household] = (await call('GET', '/api/library')).json().households;
      const empty = await call('PATCH', `/api/households/${household.id}`, {});
      expect([empty.statusCode, empty.json().error]).toEqual([400, 'There was nothing to change.']);
      const long = await call('PATCH', '/api/settings', { familyName: 'x'.repeat(61) });
      expect(long.json().error).toBe('The family name can be up to 60 characters.');
    } finally {
      await t.close();
    }
  });
});
