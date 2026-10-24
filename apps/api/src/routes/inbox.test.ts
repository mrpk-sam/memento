import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ADMIN, createTestApp } from '../test/app.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let jpeg: Buffer;
const api = (cookie: string, method: string, url: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload });

async function toInbox(names: string[]) {
  const ups = (await api(admin, 'POST', '/api/uploads', { files: names.map((name) => ({ name, type: 'image/jpeg', size: jpeg.length })) })).json().uploads;
  for (const u of ups) await t.app.inject({ method: 'PUT', url: u.url, payload: jpeg, headers: { cookie: admin, 'content-type': 'image/jpeg' } });
  return (await api(admin, 'POST', '/api/inbox', { uploads: ups.map((u: { id: string }, i: number) => ({ id: u.id, name: names[i] })) })).json();
}

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.login(ADMIN);
  jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#9b7' } }).jpeg().toBuffer();
});
afterAll(() => t.close());

describe('photo inbox', () => {
  it('turns uploads into inbox cards aimed at the first book', async () => {
    const res = await toInbox(['grandma_pearl-80th.jpg']);
    expect(res.items[0]).toMatchObject({ subject: 'grandma pearl 80th', caption: '' });
    const list = (await api(admin, 'GET', '/api/inbox')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].destBookId).toBe(list.books[0].id);
    expect(list.books[0].chapters.map((c: { name: string }) => c.name)).toEqual(['2026 in photos']);
    expect(t.storage.objects.has(`inbox/${res.items[0].id}/400.jpg`)).toBe(true);
  });

  it('files a photo into its chapter with its caption, then leaves the inbox', async () => {
    const { items, books } = (await api(admin, 'GET', '/api/inbox')).json();
    await api(admin, 'PATCH', `/api/inbox/${items[0].id}`, { caption: 'Eighty candles, one big breath' });
    const res = await api(admin, 'POST', `/api/inbox/${items[0].id}/file`);
    expect(res.json()).toMatchObject({ bookId: books[0].id, pageIdx: 4, chapter: '2026 in photos', owner: 'Marco & Elena' });
    const pages = (await api(admin, 'GET', `/api/books/${books[0].id}`)).json().pages;
    // Right page of the chapter first.
    expect(pages[5].photos[0]).toMatchObject({ caption: 'Eighty candles, one big breath', subject: 'grandma pearl 80th' });
    expect((await api(admin, 'GET', '/api/inbox')).json().items).toHaveLength(0);
  });

  it('discards with Undo', async () => {
    const { items } = await toInbox(['x.jpg']);
    await api(admin, 'DELETE', `/api/inbox/${items[0].id}`);
    expect((await api(admin, 'GET', '/api/inbox')).json().items).toHaveLength(0);
    await api(admin, 'POST', `/api/inbox/${items[0].id}/restore`);
    expect((await api(admin, 'GET', '/api/inbox')).json().items).toHaveLength(1);
  });

  it('says when the chapter is full', async () => {
    const { items, books } = (await api(admin, 'GET', '/api/inbox')).json();
    const bookId = books[0].id;
    // Fill the year (15 slots): one is already there.
    const ups = (await api(admin, 'POST', '/api/uploads', { files: Array.from({ length: 14 }, (_, i) => ({ name: `f${i}.jpg`, type: 'image/jpeg', size: jpeg.length })) })).json().uploads;
    for (const u of ups) await t.app.inject({ method: 'PUT', url: u.url, payload: jpeg, headers: { cookie: admin, 'content-type': 'image/jpeg' } });
    await api(admin, 'POST', `/api/books/${bookId}/photos`, { uploads: ups.map((u: { id: string }) => ({ id: u.id, name: 'f.jpg' })), L: 4, single: false });
    const res = await api(admin, 'POST', `/api/inbox/${items[0].id}/file`);
    expect(res.json().error).toBe('2026 in photos is full in that book. Pick another chapter.');
  });

  it('refuses an upload over 50 MB by its stored size and deletes it', async () => {
    const [u] = (await api(admin, 'POST', '/api/uploads', { files: [{ name: 'huge.jpg', type: 'image/jpeg', size: jpeg.length }] })).json().uploads;
    await t.app.inject({ method: 'PUT', url: u.url, payload: jpeg, headers: { cookie: admin, 'content-type': 'image/jpeg' } });
    const key = [...t.storage.objects.keys()].find((k) => k.endsWith(u.id))!;
    t.storage.objects.set(key, Buffer.alloc(50 * 1024 * 1024 + 1));
    const res = (await api(admin, 'POST', '/api/inbox', { uploads: [{ id: u.id, name: 'huge.jpg' }] })).json();
    expect(res).toEqual({ items: [], skipped: [{ name: 'huge.jpg', error: 'Videos can be up to 50 MB and photos up to 25 MB' }] });
    expect(t.storage.objects.has(key)).toBe(false);
  });

  it('is admin-only', async () => {
    await api(admin, 'POST', '/api/people', { name: 'R', email: 'r@example.com', sendInvite: false });
    const member = await t.login('r@example.com');
    expect((await api(member, 'GET', '/api/inbox')).statusCode).toBe(403);
  });
});
