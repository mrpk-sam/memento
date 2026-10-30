import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { LIMITS } from '@memento/shared';
import { ADMIN, createTestApp } from '../test/app.js';
import { makeClip } from '../test/video.js';
import * as s from '../db/schema.js';
import { runMaintenance } from '../lib/maintenance.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let member: string;
let bookId: string;
let jpeg: Buffer;

type Content = { pages: { id: string; type: string; layout: string | null; position: number; header: { title?: string } | null; photos: { id: string; month: number | null; subject: string; caption: string; thumbUrl: string }[]; hero: { id: string } | null }[] };
const api = (cookie: string, method: string, url: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload });
const content = async () => (await api(admin, 'GET', `/api/books/${bookId}`)).json() as Content;

/** Runs the real two-step upload through the API-signed URL. Returns upload refs. */
async function upload(cookie: string, names: string[], body = jpeg) {
  const res = await api(cookie, 'POST', '/api/uploads', { files: names.map((name) => ({ name, type: 'image/jpeg', size: body.length })) });
  const ups = res.json().uploads as { id: string; url: string }[];
  for (const u of ups) {
    const put = await t.app.inject({ method: 'PUT', url: u.url, payload: body, headers: { cookie, 'content-type': 'image/jpeg' } });
    expect(put.statusCode).toBe(200);
  }
  return ups.map((u, i) => ({ id: u.id, name: names[i]! }));
}

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.login(ADMIN);
  await api(admin, 'POST', '/api/people', { name: 'Reader', email: 'reader@example.com', sendInvite: false });
  member = await t.login('reader@example.com');
  bookId = (await api(admin, 'GET', '/api/library')).json().books[0].id;
  jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#c87' } }).jpeg().toBuffer();
});
afterAll(() => t.close());

describe('uploads', () => {
  it('rejects photos over 25 MB, videos over 50 MB and other files up front', async () => {
    expect((await api(admin, 'POST', '/api/uploads', { files: [{ name: 'a.jpg', type: 'image/jpeg', size: 26 * 1024 * 1024 }] })).statusCode).toBe(400);
    expect((await api(admin, 'POST', '/api/uploads', { files: [{ name: 'a.mov', type: 'video/quicktime', size: 51 * 1024 * 1024 }] })).statusCode).toBe(400);
    expect((await api(admin, 'POST', '/api/uploads', { files: [{ name: 'a.mkv', type: 'video/x-matroska', size: 49 * 1024 * 1024 }] })).statusCode).toBe(200);
    expect((await api(admin, 'POST', '/api/uploads', { files: [{ name: 'a.pdf', type: 'application/pdf', size: 10 }] })).statusCode).toBe(400);
    expect((await api(admin, 'POST', '/api/uploads', { files: [{ name: 'a.svg', type: 'image/svg+xml', size: 10 }] })).statusCode).toBe(400);
  });

  it('checks the stored size, not the declared one, and deletes an oversized upload unread', async () => {
    const [ref] = await upload(admin, ['huge.jpg']);
    const key = [...t.storage.objects.keys()].find((k) => k.endsWith(ref!.id))!;
    // A presigned PUT could store more than the client declared.
    t.storage.objects.set(key, Buffer.alloc(LIMITS.maxUploadBytes + 1));
    const get = vi.spyOn(t.storage, 'get');
    const res = await api(admin, 'PUT', `/api/books/${bookId}/hero`, { upload: ref });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Photos can be up to 25 MB');
    expect(get).not.toHaveBeenCalledWith(key);
    expect(t.storage.objects.has(key)).toBe(false);
    get.mockRestore();
  });

  it('refuses a tampered or someone else’s upload link', async () => {
    const res = await api(admin, 'POST', '/api/uploads', { files: [{ name: 'a.jpg', type: 'image/jpeg', size: 10 }] });
    const url = res.json().uploads[0].url as string;
    const bad = await t.app.inject({ method: 'PUT', url: url.replace(/sig=.*/, 'sig=nope'), payload: jpeg, headers: { cookie: admin, 'content-type': 'image/jpeg' } });
    expect(bad.statusCode).toBe(403);
    const other = await t.app.inject({ method: 'PUT', url, payload: jpeg, headers: { cookie: member, 'content-type': 'image/jpeg' } });
    expect(other.statusCode).toBe(403);
  });
});

describe('adding photos to a year spread', () => {
  it('stores three JPEG sizes and assigns the next free months', async () => {
    const ups = await upload(admin, ['beach_day.jpg', 'birthday-cake.jpg']);
    const res = await api(admin, 'POST', `/api/books/${bookId}/photos`, { uploads: ups, L: 4, single: false, side: 'L' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'year', left: 0, skipped: [] });
    expect(res.json().added.map((a: { month: number | null }) => a.month)).toEqual([null, null]);
    const c = await content();
    const photos = c.pages[4]!.photos;
    expect(photos.map((p) => p.subject)).toEqual(['beach day', 'birthday cake']);
    for (const v of ['orig', '1600', '400']) expect(t.storage.objects.has(`books/${bookId}/${photos[0]!.id}/${v}.jpg`)).toBe(true);
    expect([...t.storage.objects.keys()].some((k) => k.startsWith('uploads/'))).toBe(false);
    const img = await t.app.inject({ url: photos[0]!.thumbUrl, headers: { cookie: member } });
    expect((await sharp(img.rawPayload).metadata()).width).toBe(400);
  });

  it('refuses a spread with no photo slots', async () => {
    const ups = await upload(admin, ['x.jpg']);
    const res = await api(admin, 'POST', `/api/books/${bookId}/photos`, { uploads: ups, L: 0, single: false });
    expect(res.json().error).toMatch(/no photo slots/);
  });

  it('reports unreadable files and keeps the rest', async () => {
    const good = await upload(admin, ['ok.jpg']);
    const bad = await upload(admin, ['broken.jpg'], Buffer.from('nope'));
    const res = await api(admin, 'POST', `/api/books/${bookId}/photos`, { uploads: [...good, ...bad], L: 4, single: false });
    expect(res.json().added).toHaveLength(1);
    expect(res.json().skipped).toEqual([{ name: 'broken.jpg', error: "That file isn't a photo or video we can use" }]);
  });

  it('needs edit rights', async () => {
    expect((await api(member, 'POST', '/api/uploads', { files: [{ name: 'x.jpg', type: 'image/jpeg', size: 10 }] })).statusCode).toBe(403);
    const ups = await upload(admin, ['x.jpg']);
    expect((await api(member, 'POST', `/api/books/${bookId}/photos`, { uploads: ups, L: 4, single: false })).statusCode).toBe(403);
  });
});

describe('adding videos', () => {
  it('stores a playable MP4 with a poster, and serves it in byte ranges', async () => {
    const avi = await makeClip('party.avi', ['-c:v', 'mpeg4', '-c:a', 'mp2'], 2);
    const ups = await upload(admin, ['party.avi'], avi);
    const res = await api(admin, 'POST', `/api/books/${bookId}/photos`, { uploads: ups, L: 4, single: false, side: 'L' });
    expect(res.json()).toMatchObject({ skipped: [] });
    const id = res.json().added[0].id as string;
    const v = res.json().pages.flatMap((p: Content['pages'][number]) => p.photos).find((p: { id: string }) => p.id === id);
    expect(v).toMatchObject({ subject: 'party', videoUrl: `/api/media/books/${bookId}/${id}/video.mp4` });
    expect(v.durationMs).toBeGreaterThan(1500);
    expect((await sharp((await t.app.inject({ url: v.thumbUrl, headers: { cookie: member } })).rawPayload).metadata()).format).toBe('jpeg');

    const whole = await t.app.inject({ url: v.videoUrl, headers: { cookie: member } });
    expect(whole.statusCode).toBe(200);
    expect(whole.headers['content-type']).toBe('video/mp4');
    expect(whole.headers['accept-ranges']).toBe('bytes');
    const part = await t.app.inject({ url: v.videoUrl, headers: { cookie: member, range: 'bytes=0-99' } });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-99/${whole.rawPayload.length}`);
    expect(part.rawPayload).toEqual(whole.rawPayload.subarray(0, 100));
    expect((await t.app.inject({ url: v.videoUrl, headers: { cookie: member, range: 'bytes=99999999-' } })).statusCode).toBe(416);
  });

  it('keeps the cover a still photo', async () => {
    const mp4 = await makeClip('clip.mp4', ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'], 1);
    const [ref] = await upload(admin, ['clip.mp4'], mp4);
    const res = await api(admin, 'PUT', `/api/books/${bookId}/hero`, { upload: ref });
    expect(res.statusCode).toBe(400);
  });
});

describe('upload access', () => {
  it('needs a book this person can edit, and caps open uploads', async () => {
    const t2 = await createTestApp();
    try {
      const call = (cookie: string, method: string, url: string, payload?: object) => t2.app.inject({ method: method as 'GET', url, headers: { cookie }, payload });
      const boss = await t2.login(ADMIN);
      await call(boss, 'POST', '/api/people', { name: 'Kid', email: 'kid@example.com', sendInvite: false });
      const kid = await t2.login('kid@example.com');
      const twenty = { files: Array.from({ length: 20 }, (_, i) => ({ name: `${i}.jpg`, type: 'image/jpeg', size: 10 })) };
      // Seeded books are locked with no PIN, so only the admin can edit them.
      expect((await call(kid, 'POST', '/api/uploads', twenty)).statusCode).toBe(403);
      const book = (await call(boss, 'GET', '/api/library')).json().books[0].id;
      await call(boss, 'PATCH', `/api/books/${book}`, { locked: false });
      // URLs count as open before their files arrive.
      for (let i = 0; i < 5; i++) expect((await call(kid, 'POST', '/api/uploads', twenty)).statusCode).toBe(200);
      const over = await call(kid, 'POST', '/api/uploads', { files: [{ name: 'one.jpg', type: 'image/jpeg', size: 10 }] });
      expect(over.statusCode).toBe(400);
      expect(over.json().error).toMatch(/Too many uploads/);
    } finally {
      await t2.close();
    }
  });
});

describe('editing photos', () => {
  it('saves captions', async () => {
    const id = (await content()).pages[4]!.photos[0]!.id;
    await api(admin, 'PATCH', `/api/photos/${id}`, { caption: 'Salt air, sandy toes' });
    expect((await content()).pages[4]!.photos[0]!.caption).toBe('Salt air, sandy toes');
  });

  it('adds photos to a month that already has one, keeps them all, and Undo restores the old layout', async () => {
    // Uploads start with no month, so give the first photo January.
    const first = (await content()).pages[4]!.photos[0]!;
    await api(admin, 'POST', `/api/photos/${first.id}/month`, { month: 0 });
    const before = (await content()).pages[4]!.photos.map((p) => [p.id, p.month]);
    const [a, b] = (await content()).pages[4]!.photos;
    expect(a!.month).toBe(0);
    const res = await api(admin, 'POST', `/api/photos/${b!.id}/month`, { month: 0 });
    const after = res.json().pages[4].photos as { id: string; month: number | null }[];
    expect(after.slice(0, 2).map((p) => [p.id, p.month])).toEqual([[a!.id, 0], [b!.id, 0]]);
    expect(after).toHaveLength(before.length);
    await api(admin, 'PUT', `/api/books/${bookId}/layout`, { photos: res.json().before });
    expect((await content()).pages[4]!.photos.map((p) => [p.id, p.month])).toEqual(before);
  });

  it('rearranges photos with no month on a year spread, and keeps month order', async () => {
    const pg = (await content()).pages[4]!;
    const noMonth = pg.photos.filter((p) => p.month == null);
    expect(noMonth.length).toBeGreaterThanOrEqual(2);
    const last = noMonth.at(-1)!;
    const firstNoMonthAt = pg.photos.indexOf(noMonth[0]!);
    const res = await api(admin, 'POST', `/api/photos/${last.id}/move`, { pageId: pg.id, position: firstNoMonthAt });
    expect(res.json().kind).toBe('moved');
    expect((await content()).pages[4]!.photos[firstNoMonthAt]!.id).toBe(last.id);
    const dated = pg.photos.find((p) => p.month != null)!;
    expect((await api(admin, 'POST', `/api/photos/${dated.id}/move`, { pageId: pg.id, position: pg.photos.length })).json().kind).toBe('month-order');
    // Undo puts the old order back.
    await api(admin, 'PUT', `/api/books/${bookId}/layout`, { photos: res.json().before });
    expect((await content()).pages[4]!.photos.map((p) => p.id)).toEqual(pg.photos.map((p) => p.id));
  });

  it('refuses moves outside the spread and needs edit rights', async () => {
    const pg = (await content()).pages[4]!;
    const title = (await content()).pages[1]!;
    expect((await api(admin, 'POST', `/api/photos/${pg.photos[0]!.id}/move`, { pageId: title.id, position: 0 })).statusCode).toBe(400);
    expect((await api(member, 'POST', `/api/photos/${pg.photos[0]!.id}/move`, { pageId: pg.id, position: 1 })).statusCode).toBe(403);
  });

  it('removes a photo and Undo brings it back', async () => {
    const id = (await content()).pages[4]!.photos[0]!.id;
    await api(admin, 'DELETE', `/api/photos/${id}`);
    expect((await content()).pages[4]!.photos.some((p) => p.id === id)).toBe(false);
    await api(admin, 'POST', `/api/photos/${id}/restore`);
    expect((await content()).pages[4]!.photos[0]!.id).toBe(id);
  });

  it('replaces and removes the cover photo', async () => {
    const [up] = await upload(admin, ['porch_family.jpg']);
    const res = await api(admin, 'PUT', `/api/books/${bookId}/hero`, { upload: up });
    expect(res.json().previous).toBeNull();
    const hero = (await content()).pages[1]!.hero!;
    expect(hero).toMatchObject({ subject: 'porch family' });
    await api(admin, 'PUT', `/api/books/${bookId}/hero`, { photoId: null });
    expect((await content()).pages[1]!.hero).toBeNull();
    await api(admin, 'PUT', `/api/books/${bookId}/hero`, { photoId: hero.id });
    expect((await content()).pages[1]!.hero!.id).toBe(hero.id);
  });

  it('edits page theme, stickers, header and journal, merging header fields', async () => {
    const pg = (await content()).pages[4]!;
    expect((await api(admin, 'PATCH', `/api/pages/${pg.id}`, { themeId: 'summer', stickerPack: 'hearts', header: { subtitle: 'Sun all year' } })).statusCode).toBe(200);
    const after = (await api(admin, 'GET', `/api/books/${bookId}`)).json().pages[4];
    expect(after).toMatchObject({ themeId: 'summer', stickerPack: 'hearts', header: { kicker: 'Year in photos', title: '2026', subtitle: 'Sun all year' } });
    expect((await api(admin, 'PATCH', `/api/pages/${pg.id}`, { themeId: 'nope' })).statusCode).toBe(400);
    expect((await api(member, 'PATCH', `/api/pages/${pg.id}`, { journal: 'hi' })).statusCode).toBe(403);
  });
});

describe('moving photos between chapters', () => {
  const pageIds = async () => (await content()).pages.map((p) => p.id);
  /** Puts `n` stored photo rows straight onto a page (faster than uploading). */
  const fill = async (pageId: string, n: number) => {
    const rows = Array.from({ length: n }, (_, i) => ({ bookId, pageId, position: i, objectKey: 'x', thumbKey: 'x', displayKey: 'x', subject: `fill ${i}` }));
    if (n) await t.db.insert(s.photos).values(rows);
  };

  it('moves year photos into a month chapter with that month, refuses non-chapters, and Undo puts them back', async () => {
    expect((await api(admin, 'POST', `/api/books/${bookId}/months`, { year: 2026, month: 5 })).statusCode).toBe(200);
    const c = await content();
    const june = c.pages.findIndex((p) => p.layout === 'monthL');
    const before = c.pages.flatMap((p) => p.photos.map((ph) => [ph.id, p.id, ph.month]));
    const [a, b] = c.pages[4]!.photos;
    const res = await api(admin, 'POST', `/api/books/${bookId}/chapter-moves`, { photoIds: [a!.id, b!.id], pageId: c.pages[june]!.id });
    expect(res.json()).toMatchObject({ kind: 'moved', moved: 2 });
    const after = (await content()).pages;
    expect(after[4]!.photos.map((p) => p.id)).not.toContain(a!.id);
    const there = [...after[june]!.photos, ...after[june + 1]!.photos];
    expect(there.filter((p) => p.id === a!.id || p.id === b!.id).map((p) => p.month)).toEqual([5, 5]);

    expect((await api(admin, 'POST', `/api/books/${bookId}/chapter-moves`, { photoIds: [a!.id], pageId: after[2]!.id })).statusCode).toBe(400);
    await api(admin, 'PUT', `/api/books/${bookId}/layout`, { photos: res.json().before });
    expect((await content()).pages.flatMap((p) => p.photos.map((ph) => [ph.id, p.id, ph.month]))).toEqual(before);
  });

  it('grows a full month by a 9 + 9 spread, stops at 50, and cleanup drops the spread once it is empty', async () => {
    expect((await api(admin, 'POST', `/api/books/${bookId}/months`, { year: 2026, month: 6 })).statusCode).toBe(200);
    let c = await content();
    const july = c.pages.findIndex((p) => p.layout === 'monthL' && p.header?.title === 'July');
    await fill(c.pages[july]!.id, 6);
    await fill(c.pages[july + 1]!.id, 8);
    const pagesBefore = (await pageIds()).length;
    const photo = (await content()).pages[4]!.photos[0]!;
    const res = await api(admin, 'POST', `/api/books/${bookId}/chapter-moves`, { photoIds: [photo.id], pageId: c.pages[july]!.id });
    expect(res.json()).toMatchObject({ kind: 'moved', moved: 1 });
    c = await content();
    expect(c.pages).toHaveLength(pagesBefore + 2);
    expect([c.pages[july + 2]!.layout, c.pages[july + 3]!.layout]).toEqual(['monthMore', 'monthMore']);
    expect(c.pages[july + 2]!.photos.map((p) => p.id)).toEqual([photo.id]);

    // Fill July to exactly 50 (15 + 17 here, 18 more stored on its first page); one more is refused.
    await fill(c.pages[july + 2]!.id, 8);
    await fill(c.pages[july + 3]!.id, 9);
    await fill(c.pages[july]!.id, 18);
    c = await content();
    expect(c.pages.slice(july, july + 4).reduce((n, p) => n + p.photos.length, 0)).toBe(50);
    const add = await api(admin, 'POST', `/api/books/${bookId}/chapter-moves`, { photoIds: [c.pages[4]!.photos[0]!.id], pageId: c.pages[july]!.id });
    expect(add.statusCode).toBe(400);
    expect(add.json().error).toBe('July 2026 is full.');

    // Moving the photo back leaves the extra spread holding only the stored fill rows; delete those
    // for good, and the hourly cleanup removes the now-empty spread and closes up the book.
    await api(admin, 'PUT', `/api/books/${bookId}/layout`, { photos: res.json().before });
    const extra = c.pages.slice(july + 2).filter((p) => p.layout === 'monthMore').map((p) => p.id);
    const { inArray } = await import('drizzle-orm');
    await t.db.delete(s.photos).where(inArray(s.photos.pageId, extra));
    const report = await runMaintenance(t.db, t.storage);
    expect(report.emptySpreads).toBe(extra.length / 2);
    const end = await content();
    expect(end.pages.some((p) => p.layout === 'monthMore')).toBe(false);
    expect(end.pages.map((p) => p.position)).toEqual(end.pages.map((_, i) => i));
  });
});

describe('keeping pages within their slots', () => {
  const monthPages = async (title: string) => {
    const c = await content();
    const i = c.pages.findIndex((p) => p.layout === 'monthL' && p.header?.title === title);
    return { c, i };
  };

  it('never overfills a page when two uploads land at once', async () => {
    await api(admin, 'POST', `/api/books/${bookId}/months`, { year: 2026, month: 8 });
    const { i } = await monthPages('September');
    const a = await upload(admin, ['a1.jpg', 'a2.jpg', 'a3.jpg', 'a4.jpg', 'a5.jpg', 'a6.jpg', 'a7.jpg', 'a8.jpg']);
    const b = await upload(admin, ['b1.jpg', 'b2.jpg', 'b3.jpg', 'b4.jpg', 'b5.jpg', 'b6.jpg', 'b7.jpg', 'b8.jpg']);
    const both = await Promise.all([a, b].map((ups) => api(admin, 'POST', `/api/books/${bookId}/photos`, { uploads: ups, L: i, single: false, side: 'R' })));
    expect(both.map((r) => r.statusCode)).toEqual([200, 200]);
    const after = (await content()).pages;
    for (const pg of after.slice(i, i + 4)) expect(pg.photos.length).toBeLessThanOrEqual(pg.layout === 'monthL' ? 6 : pg.layout === 'monthR' ? 8 : 9);
    expect(after.slice(i, i + 4).reduce((n, p) => n + p.photos.length, 0)).toBe(16);
  });

  it('refuses an Undo that would overfill a page someone has filled since', async () => {
    const { c, i } = await monthPages('September');
    // Move a year photo into September, then fill the year to its 15.
    const out = await api(admin, 'POST', `/api/books/${bookId}/chapter-moves`, { photoIds: [c.pages[4]!.photos[0]!.id], pageId: c.pages[i]!.id });
    expect(out.statusCode).toBe(200);
    const year = (await content()).pages;
    const free = 15 - year[4]!.photos.length - year[5]!.photos.length;
    if (free > 0) {
      const ups = await upload(admin, Array.from({ length: free }, (_, k) => `fill${k}.jpg`));
      expect((await api(admin, 'POST', `/api/books/${bookId}/photos`, { uploads: ups, L: 4, single: false, side: 'L' })).json().left).toBe(0);
    }
    const undo = await api(admin, 'PUT', `/api/books/${bookId}/layout`, { photos: out.json().before });
    expect(undo.statusCode).toBe(409);
    expect(undo.json().error).toBe("Too much has changed since then, so that can't be undone.");
    const after = (await content()).pages;
    expect(after[4]!.photos.length + after[5]!.photos.length).toBe(15);
  });

  it('brings a deleted photo back elsewhere in its chapter when its page filled up, and closes up months', async () => {
    const { c, i } = await monthPages('September');
    const left = c.pages[i]!;
    const victim = left.photos[0]!;
    const before = [...left.photos, ...c.pages[i + 1]!.photos].length;
    await api(admin, 'DELETE', `/api/photos/${victim.id}`);
    // The month closed up: the title page is still full if there are photos after it.
    const closed = (await content()).pages;
    expect(closed[i]!.photos).toHaveLength(Math.min(6, before - 1));
    const res = await api(admin, 'POST', `/api/photos/${victim.id}/restore`);
    expect(res.statusCode).toBe(200);
    const all = (await content()).pages.flatMap((p) => p.photos.map((ph) => ph.id));
    expect(all).toContain(victim.id);
    const sept = (await monthPages('September'));
    for (const pg of sept.c.pages.slice(sept.i, sept.i + 4)) expect(pg.photos.length).toBeLessThanOrEqual(pg.layout === 'monthL' ? 6 : pg.layout === 'monthR' ? 8 : 9);
  });
});
