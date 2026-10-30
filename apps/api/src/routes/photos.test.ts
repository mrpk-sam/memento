import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { LIMITS } from '@memento/shared';
import { ADMIN, createTestApp } from '../test/app.js';
import { makeClip } from '../test/video.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let member: string;
let bookId: string;
let jpeg: Buffer;

type Content = { pages: { id: string; type: string; layout: string | null; photos: { id: string; month: number | null; subject: string; caption: string; thumbUrl: string }[]; hero: { id: string } | null }[] };
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
  it('moves a year photo into a month chapter with that month, refuses non-chapters, and Undo puts it back', async () => {
    expect((await api(admin, 'POST', `/api/books/${bookId}/months`, { year: 2026, month: 5 })).statusCode).toBe(200);
    const c = await content();
    const june = c.pages.findIndex((p) => p.layout === 'monthL');
    const before = c.pages.flatMap((p) => p.photos.map((ph) => [ph.id, p.id, ph.month]));
    const photo = c.pages[4]!.photos[0]!;
    const res = await api(admin, 'POST', `/api/photos/${photo.id}/chapter`, { pageId: c.pages[june]!.id });
    expect(res.json().kind).toBe('moved');
    const after = (await content()).pages;
    expect(after[4]!.photos.map((p) => p.id)).not.toContain(photo.id);
    const moved = [...after[june]!.photos, ...after[june + 1]!.photos].find((p) => p.id === photo.id);
    expect(moved?.month).toBe(5);

    expect((await api(admin, 'POST', `/api/photos/${photo.id}/chapter`, { pageId: after[2]!.id })).statusCode).toBe(400);
    await api(admin, 'PUT', `/api/books/${bookId}/layout`, { photos: res.json().before });
    expect((await content()).pages.flatMap((p) => p.photos.map((ph) => [ph.id, p.id, ph.month]))).toEqual(before);
  });
});
