import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyError, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import type { Env } from './env.js';
import type { Db } from './db/client.js';
import type { Storage } from './lib/s3.js';
import { HttpError } from './lib/http.js';
import { createMailer, type Mailer } from './lib/mail.js';
import { loadUser } from './lib/session.js';
import { authRoutes } from './routes/auth.js';
import { peopleRoutes } from './routes/people.js';
import { bookRoutes } from './routes/books.js';
import { contentRoutes } from './routes/content.js';
import { photoRoutes } from './routes/photos.js';
import { aiRoutes } from './routes/ai.js';
import { inboxRoutes } from './routes/inbox.js';
import { settingsRoutes } from './routes/settings.js';
import { accessRoutes } from './routes/access.js';

export interface AppDeps {
  env: Env;
  db: Db;
  storage: Storage;
  /** Overrides the SMTP mailer (tests capture emails with this). */
  mailer?: Mailer;
  /** Overrides fetch for AI caption calls (tests use a fake model). */
  aiFetch?: typeof fetch;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    mailer: Mailer;
  }
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger:
      deps.env.NODE_ENV === 'test'
        ? false
        : {
            level: deps.env.NODE_ENV === 'production' ? 'info' : 'debug',
            // Query strings can hold sign-in tokens (/auth/verify?token=…), so they stay out of the log.
            serializers: {
              req: (req: { method: string; url: string; ip?: string }) => ({ method: req.method, url: req.url.split('?')[0], ip: req.ip }),
            },
          },
    // A hop count trusts that many proxies, nearest first (Fastify's types only take the function form).
    trustProxy: typeof deps.env.TRUST_PROXY === 'number' ? ((hops) => (_addr: string, i: number) => i < hops)(deps.env.TRUST_PROXY) : deps.env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });
  app.decorate('deps', deps);
  app.decorate('mailer', deps.mailer ?? createMailer(deps.env, app.log));
  app.decorateRequest('user', null);

  await app.register(cookie, { secret: deps.env.SESSION_SECRET });
  // Decide by the matched route, not the raw URL: the router decodes "/%61pi/…" to "/api/…".
  const routeOf = (req: FastifyRequest) => req.routeOptions.url ?? '';
  // A generous per-address ceiling for the whole API. Images are exempt: one book can load dozens.
  // Sign-in, PIN, caption and test-connection routes have their own tighter limits.
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    allowList: (req) => !routeOf(req).startsWith('/api/') || routeOf(req).startsWith('/api/media/'),
  });

  const s3Origin = deps.env.S3_PUBLIC_ENDPOINT ? new URL(deps.env.S3_PUBLIC_ENDPOINT).origin : '';
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: https://flagcdn.com ${s3Origin}`.trim(),
    // The service worker fetches fonts and flag images to keep them for offline reading.
    `connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://flagcdn.com ${s3Origin}`.trim(),
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    if (deps.env.APP_URL.startsWith('https://')) reply.header('strict-transport-security', 'max-age=31536000');
    if (!req.url.startsWith('/api/')) reply.header('content-security-policy', csp);
  });

  // Cookies are SameSite=Lax. As a second guard, browser writes must come from the app's own origin.
  const appOrigin = new URL(deps.env.APP_URL).origin;
  const checkOrigin = deps.env.NODE_ENV !== 'development';
  app.addHook('onRequest', async (req) => {
    if (!routeOf(req).startsWith('/api/')) return;
    if (checkOrigin && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      if ((origin && origin !== appOrigin) || (!origin && site && site !== 'same-origin' && site !== 'none')) {
        throw new HttpError(403, 'This request came from another site.');
      }
    }
    req.user = await loadUser(deps.db, req);
  });

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message, ...err.extra });
    if (err.statusCode === 429) return reply.code(429).send({ error: 'Too many tries. Wait a few minutes and try again.' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ error: 'Something went wrong on our side.' });
  });

  // Public, so it says only ok / error. Details go to the log.
  app.get('/api/health', async (req, reply) => {
    try {
      await deps.db.execute(sql`select 1`);
      return { ok: true, checks: { db: 'ok' } };
    } catch (err) {
      req.log.error({ err }, 'Health check: database unreachable');
      return reply.code(503).send({ ok: false, checks: { db: 'error' } });
    }
  });

  await app.register(authRoutes);
  await app.register(peopleRoutes);
  await app.register(bookRoutes);
  await app.register(contentRoutes);
  await app.register(photoRoutes);
  await app.register(aiRoutes);
  await app.register(inboxRoutes);
  await app.register(settingsRoutes);
  await app.register(accessRoutes);

  // In production the API serves the built web app.
  const webDist = findWebDist();
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      cacheControl: false,
      setHeaders(res, filePath) {
        // The service worker, manifest and HTML must always be fresh; hashed assets never change.
        if (/(sw\.js|index\.html|manifest\.webmanifest|registerSW\.js)$/.test(filePath)) res.header('cache-control', 'no-cache');
        else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.header('cache-control', 'public, max-age=31536000, immutable');
      },
    });
    // Share target without a service worker yet (first launch): go to the inbox.
    app.post('/share-target', async (_req, reply) => reply.redirect('/desk/inbox', 303));
    // SPA fallback: unknown non-API GETs get index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found' }));
  }

  return app;
}

function findWebDist(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../../web/dist', '../web', './web']) {
    const p = path.resolve(here, rel);
    if (existsSync(path.join(p, 'index.html'))) return p;
  }
  return null;
}
