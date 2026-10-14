import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import * as s from '../db/schema.js';
import { ADMIN, createTestApp } from '../test/app.js';
import { runMaintenance } from './maintenance.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
const api = (method: string, url: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: { cookie: admin }, payload });
const DAY = 86_400_000;

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.login(ADMIN);
});
afterAll(() => t.close());

describe('maintenance', () => {
  it('keeps recent soft-deletes restorable and purges old ones with their files', async () => {
    const bookId = (await api('GET', '/api/library')).json().books[0].id;
    const jpeg = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#abc' } }).jpeg().toBuffer();
    const up = (await api('POST', '/api/uploads', { files: [{ name: 'a.jpg', type: 'image/jpeg', size: jpeg.length }] })).json().uploads[0];
    await t.app.inject({ method: 'PUT', url: up.url, payload: jpeg, headers: { cookie: admin, 'content-type': 'image/jpeg' } });
    const photoId = (await api('POST', `/api/books/${bookId}/photos`, { uploads: [{ id: up.id, name: 'a.jpg' }], L: 4, single: false })).json().added[0].id;
    await api('DELETE', `/api/photos/${photoId}`);

    // A day later: still restorable.
    await runMaintenance(t.db, t.storage, new Date(Date.now() + DAY));
    expect(await t.db.select().from(s.photos).where(eq(s.photos.id, photoId))).toHaveLength(1);

    // A month later: gone, files too.
    const r = await runMaintenance(t.db, t.storage, new Date(Date.now() + 31 * DAY));
    expect(r.photos).toBe(1);
    expect(await t.db.select().from(s.photos).where(eq(s.photos.id, photoId))).toHaveLength(0);
    expect([...t.storage.objects.keys()].some((k) => k.includes(photoId))).toBe(false);
  });

  it('removes abandoned uploads and expired sessions', async () => {
    admin = await t.login(ADMIN);
    t.storage.objects.set('uploads/u/abandoned', Buffer.from('x'));
    const r = await runMaintenance(t.db, t.storage, new Date(Date.now() + 31 * DAY));
    expect(r.staleUploads).toBe(1);
    expect(r.sessions).toBeGreaterThan(0);
    expect((await t.app.inject({ url: '/api/me', headers: { cookie: admin } })).statusCode).toBe(401);
  });
});
