import { buildApp } from '../app.js';
import type { Env } from '../env.js';
import type { Mail } from '../lib/mail.js';
import type { Storage } from '../lib/s3.js';
import { seed } from '../db/seed.js';
import { createTestDb } from './db.js';

export const ADMIN = 'admin@example.com';

export const testEnv: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  APP_URL: 'http://localhost:5173',
  TRUST_PROXY: false,
  DATABASE_URL: 'postgres://unused',
  DB_POOL_MAX: 1,
  S3_ENDPOINT: 'http://minio.test',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'x',
  S3_SECRET_KEY: 'x',
  S3_BUCKET: 'memento',
  S3_FORCE_PATH_STYLE: true,
  S3_PUBLIC_ENDPOINT: undefined,
  SESSION_SECRET: 'test-secret-test-secret-test-secret-123',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  ADMIN_EMAIL: ADMIN,
  SMTP_HOST: undefined,
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_USER: undefined,
  SMTP_PASS: undefined,
  SMTP_FROM: 'test@example.com',
};

/** In-memory stand-in for MinIO. */
export function memoryStorage(): Storage & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    client: null as never,
    bucket: 'memento',
    ensureBucket: async () => 'exists' as const,
    presignPut: async (key: string) => `http://minio.test/memento/${key}?signed`,
    presignGet: async (key: string) => `http://minio.test/memento/${key}?signed`,
    put: async (key: string, body: Buffer) => void objects.set(key, body),
    get: async (key: string) => {
      const b = objects.get(key);
      if (!b) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
      return b;
    },
    head: async (key: string) => {
      const b = objects.get(key);
      if (!b) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      return { size: b.length };
    },
    stream: async (key: string) => {
      const b = objects.get(key);
      if (!b) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
      return { body: b as unknown as NodeJS.ReadableStream, contentType: 'image/jpeg', length: b.length };
    },
    list: async (prefix: string) => [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, lastModified: new Date(0) })),
    delete: async (key: string) => void objects.delete(key),
    copy: async (from: string, to: string) => void objects.set(to, objects.get(from)!),
  } as Storage & { objects: Map<string, Buffer> };
}

export async function createTestApp(env: Partial<Env> = {}, opts: { aiFetch?: typeof fetch } = {}) {
  const { db, close } = await createTestDb();
  await seed(db, { adminEmail: ADMIN, year: 2026 });
  const mails: Mail[] = [];
  const storage = memoryStorage();
  const app = await buildApp({ env: { ...testEnv, ...env }, db, storage, mailer: async (m) => void mails.push(m), aiFetch: opts.aiFetch });

  let ip = 0;
  // Each sign-in comes from its own address so tests don't trip the auth rate limit.
  const nextIp = () => `10.0.${Math.floor(++ip / 250)}.${ip % 250}`;

  /** Signs in through the real magic-link flow and returns the session cookie header. */
  async function login(email: string): Promise<string> {
    const before = mails.length;
    await app.inject({ method: 'POST', url: '/api/auth/magic-link', payload: { email }, remoteAddress: nextIp() });
    const mail = mails[before];
    if (!mail) throw new Error(`No magic link sent to ${email}`);
    return cookieFromLink(mail.text);
  }

  async function cookieFromLink(text: string): Promise<string> {
    const token = /token=([\w-]+)/.exec(text)![1]!;
    const res = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token }, remoteAddress: nextIp() });
    if (res.statusCode !== 200) throw new Error(`verify failed: ${res.body}`);
    const c = res.cookies.find((x) => x.name === 'memento_session')!;
    return `memento_session=${c.value}`;
  }

  return {
    app,
    db,
    mails,
    storage,
    login,
    cookieFromLink,
    close: async () => {
      await app.close();
      await close();
    },
  };
}
