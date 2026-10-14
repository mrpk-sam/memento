import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, createTestApp } from '../test/app.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let member: string;
let bookId: string;

const api = (cookie: string, method: string, url: string, payload?: object) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload });
const layouts = async () => ((await api(admin, 'GET', `/api/books/${bookId}`)).json().pages as { type: string; layout: string | null; year: number | null; position: number }[]).map((p) => `${p.layout ?? p.type}${p.year ? ':' + p.year : ''}`);

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.login(ADMIN);
  await api(admin, 'POST', '/api/people', { name: 'Reader', email: 'reader@example.com', sendInvite: false });
  member = await t.login('reader@example.com');
  bookId = (await api(admin, 'GET', '/api/library')).json().books[0].id;
});
afterAll(() => t.close());

describe('book content', () => {
  it('returns the book and its pages to any signed-in user', async () => {
    const res = await api(member, 'GET', `/api/books/${bookId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().book).toMatchObject({ owner: 'Marco & Elena', family: 'Rivera', canEdit: false });
    expect(res.json().pages).toHaveLength(8);
  });

  it('lists the eight seeded themes', async () => {
    const res = await api(member, 'GET', '/api/themes');
    expect(res.json().map((x: { id: string }) => x.id)).toEqual(['cream', 'kraft', 'dual', 'jamaica', 'winter', 'festive', 'summer', 'birthday']);
  });

  it('adds the next year before the closing page', async () => {
    const res = await api(admin, 'POST', `/api/books/${bookId}/years`);
    expect(res.json()).toEqual({ year: 2027, at: 6 });
    expect(await layouts()).toEqual(['endpaper', 'title', 'index', 'chapters', 'summaryL:2026', 'summaryR:2026', 'summaryL:2027', 'summaryR:2027', 'closing', 'backpaper']);
  });

  it('adds month chapters inside their year in month order', async () => {
    await api(admin, 'POST', `/api/books/${bookId}/months`, { year: 2026, month: 11 });
    await api(admin, 'POST', `/api/books/${bookId}/months`, { year: 2026, month: 6 });
    expect(await layouts()).toEqual([
      'endpaper', 'title', 'index', 'chapters',
      'summaryL:2026', 'summaryR:2026', 'monthL:2026', 'monthR:2026', 'monthL:2026', 'monthR:2026',
      'summaryL:2027', 'summaryR:2027', 'closing', 'backpaper',
    ]);
    const pages = (await api(admin, 'GET', `/api/books/${bookId}`)).json().pages;
    expect(pages[6].header.title).toBe('July');
    expect(pages[8].header.kicker).toBe('Chapter · December 2026');
    expect(pages.map((p: { position: number }) => p.position)).toEqual([...Array(14).keys()]);
  });

  it('refuses a duplicate month and a missing year', async () => {
    expect((await api(admin, 'POST', `/api/books/${bookId}/months`, { year: 2026, month: 6 })).statusCode).toBe(409);
    expect((await api(admin, 'POST', `/api/books/${bookId}/months`, { year: 1990, month: 1 })).statusCode).toBe(400);
  });

  it('needs edit rights to add pages', async () => {
    expect((await api(member, 'POST', `/api/books/${bookId}/years`)).statusCode).toBe(403);
  });
});

describe('media proxy', () => {
  it('serves stored images to signed-in users with long cache headers', async () => {
    t.storage.objects.set('books/b1/p1/400.jpg', Buffer.from('jpeg'));
    const res = await api(member, 'GET', '/api/media/books/b1/p1/400.jpg');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.body).toBe('jpeg');
  });

  it('keeps the inbox to the admin and rejects odd keys', async () => {
    t.storage.objects.set('inbox/i1/400.jpg', Buffer.from('x'));
    expect((await api(member, 'GET', '/api/media/inbox/i1/400.jpg')).statusCode).toBe(403);
    expect((await api(admin, 'GET', '/api/media/inbox/i1/400.jpg')).statusCode).toBe(200);
    expect((await api(member, 'GET', '/api/media/books/../secret')).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/api/media/books/b1/p1/400.jpg' })).statusCode).toBe(401);
  });
});
