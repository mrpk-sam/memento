import { env } from './env.js';
import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { createStorage } from './lib/s3.js';
import { runMaintenance } from './lib/maintenance.js';

const e = env();
const { db, close } = createDb(e.DATABASE_URL, { max: e.DB_POOL_MAX });
const storage = createStorage(e);

const app = await buildApp({ env: e, db, storage });

if (e.SMTP_HOST) app.log.info(`Email: sending through ${e.SMTP_HOST}:${e.SMTP_PORT} as ${e.SMTP_FROM}`);
else {
  // Sign-in links and codes in the log work as passwords. Fine for a first setup, not for daily use.
  app.log.warn('Email: SMTP_HOST is not set, so sign-in and invite emails are printed in this log instead of sent. Anyone who can read the log can sign in as anyone.');
}

try {
  const bucket = await storage.ensureBucket();
  app.log.info(`Bucket "${storage.bucket}" ${bucket}`);
} catch (err) {
  app.log.error({ err }, 'Storage check failed. Uploads will not work until MinIO is reachable.');
}

// Hourly housekeeping (expired sessions, abandoned uploads, 30-day purge of soft-deleted data).
const maintain = () =>
  runMaintenance(db, storage)
    .then((r) => app.log.info({ maintenance: r }, 'Maintenance done'))
    .catch((err) => app.log.error({ err }, 'Maintenance failed'));
const firstRun = setTimeout(maintain, 60_000);
const hourly = setInterval(maintain, 3_600_000);

const shutdown = async () => {
  clearTimeout(firstRun);
  clearInterval(hourly);
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: e.PORT, host: e.HOST });
