import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, createTestApp } from '../test/app.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let member: string;

const api = (cookie: string, method: string, url: string, payload?: object) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload });

type Lib = { books: { id: string; kind: string; title: string; owner: string; householdId: string; width: number; height: number; locked: boolean; hasPin: boolean; canEdit: boolean; years: number[]; pageCount: number }[]; households: { id: string; name: string }[] };
const library = async (c = admin) => (await api(c, 'GET', '/api/library')).json() as Lib;

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.login(ADMIN);
  await api(admin, 'POST', '/api/people', { name: 'Reader', email: 'reader@example.com', sendInvite: false });
  member = await t.login('reader@example.com');
});
afterAll(() => t.close());

describe('library', () => {
  it('lists the five seeded books in shelf order, locked, with no PIN yet', async () => {
    const lib = await library(member);
    expect(lib.books.map((b) => b.owner)).toEqual(['Marco & Elena', 'Daniel & Priya', 'Nadia & Omar', 'Sofia', 'Mom & Dad']);
    expect(lib.books[0]).toMatchObject({ title: "Marco & Elena's Year in Review", locked: true, hasPin: false, canEdit: false, years: [2026], pageCount: 6 });
  });

  it('lets the admin edit any book without a PIN', async () => {
    expect((await library()).books.every((b) => b.canEdit)).toBe(true);
  });
});

describe('creating books', () => {
  it('creates a smaller book right after its household main book', async () => {
    const lib = await library();
    const rivera = lib.households.find((h) => h.name === 'Marco & Elena')!;
    const res = await api(admin, 'POST', '/api/books', { parentHouseholdId: rivera.id, ownerName: 'Luca', texture: 'matte', color: '#6A8CC4', locked: false });
    expect(res.statusCode).toBe(200);
    const after = await library();
    expect(after.books[1]).toMatchObject({ owner: 'Luca', kind: 'small', width: 62, height: 320, title: "Luca's Year in Review" });
  });

  it('creates a new household with its main book at the end', async () => {
    const res = await api(admin, 'POST', '/api/books', { householdName: 'Tasha & Mike', texture: 'linen', color: '#3F5873', locked: true, pin: '2468' });
    expect(res.statusCode).toBe(200);
    const lib = await library();
    expect(lib.books.at(-1)).toMatchObject({ owner: 'Tasha & Mike', kind: 'main', width: 80, height: 392, hasPin: true });
  });

  it('insists on a PIN for locked books and a name for households', async () => {
    expect((await api(admin, 'POST', '/api/books', { householdName: 'X', texture: 'linen', color: '#3F5873', locked: true })).json().error).toMatch(/4-digit PIN/);
    expect((await api(admin, 'POST', '/api/books', { texture: 'linen', color: '#3F5873', locked: false })).json().error).toMatch(/Name the household/);
  });

  it('is admin-only', async () => {
    expect((await api(member, 'POST', '/api/books', { householdName: 'X', texture: 'linen', color: '#3F5873', locked: false })).statusCode).toBe(403);
  });
});

describe('PIN unlock', () => {
  let bookId: string;
  beforeAll(async () => {
    bookId = (await library()).books.find((b) => b.owner === 'Sofia')!.id;
  });

  it('refuses while no PIN is set', async () => {
    const res = await api(member, 'POST', `/api/books/${bookId}/unlock`, { pin: '1234' });
    expect(res.statusCode).toBe(409);
  });

  it('only lets the admin set a PIN', async () => {
    expect((await api(member, 'PUT', `/api/books/${bookId}/pin`, { pin: '1357' })).statusCode).toBe(403);
    expect((await api(admin, 'PUT', `/api/books/${bookId}/pin`, { pin: '13a7' })).statusCode).toBe(400);
    expect((await api(admin, 'PUT', `/api/books/${bookId}/pin`, { pin: '1357' })).statusCode).toBe(200);
  });

  it('rejects a wrong PIN and says how many tries are left', async () => {
    const res = await api(member, 'POST', `/api/books/${bookId}/unlock`, { pin: '0000' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "That's not it. Try again.", remaining: 4 });
  });

  it('unlocks for 12 hours with the right PIN, and then allows cover edits', async () => {
    expect((await api(member, 'PATCH', `/api/books/${bookId}`, { spineText: 'V' })).statusCode).toBe(403);
    const res = await api(member, 'POST', `/api/books/${bookId}/unlock`, { pin: '1357' });
    expect(res.statusCode).toBe(200);
    const hours = (new Date(res.json().expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect((await library(member)).books.find((b) => b.id === bookId)!.canEdit).toBe(true);
    expect((await api(member, 'PATCH', `/api/books/${bookId}`, { spineText: 'Sofia' })).statusCode).toBe(200);
    const me = (await api(member, 'GET', '/api/me')).json();
    expect(me.unlocks.map((u: { bookId: string }) => u.bookId)).toContain(bookId);
  });

  it('still keeps admin-only fields for the admin', async () => {
    expect((await api(member, 'PATCH', `/api/books/${bookId}`, { locked: false })).statusCode).toBe(403);
  });

  it('signs everyone out of the book when the PIN changes', async () => {
    await api(admin, 'PUT', `/api/books/${bookId}/pin`, { pin: '2468' });
    expect((await library(member)).books.find((b) => b.id === bookId)!.canEdit).toBe(false);
  });

  it('allows 5 wrong tries per 10 minutes per user per book', async () => {
    const other = (await library()).books.find((b) => b.owner === 'Mom & Dad')!.id;
    await api(admin, 'PUT', `/api/books/${other}/pin`, { pin: '1111' });
    for (let i = 0; i < 5; i++) expect((await api(member, 'POST', `/api/books/${other}/unlock`, { pin: '9999' })).statusCode).toBe(401);
    const blocked = await api(member, 'POST', `/api/books/${other}/unlock`, { pin: '1111' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toMatch(/Try again in 10 minutes/);
    // Another user is not affected.
    expect((await api(admin, 'POST', `/api/books/${other}/unlock`, { pin: '1111' })).statusCode).toBe(200);
  });

  it('needs no PIN when the book is not locked', async () => {
    await api(admin, 'PATCH', `/api/books/${bookId}`, { locked: false });
    expect((await api(member, 'POST', `/api/books/${bookId}/unlock`, { pin: '' })).json()).toMatchObject({ ok: true, expiresAt: null });
    expect((await library(member)).books.find((b) => b.id === bookId)!.canEdit).toBe(true);
  });
});

describe('ordering and sizes', () => {
  it('moves main books among main books', async () => {
    const before = (await library()).books.filter((b) => b.kind === 'main').map((b) => b.owner);
    await api(admin, 'POST', `/api/books/${(await library()).books.find((b) => b.owner === 'Sofia')!.id}/move`, { dir: -1 });
    const after = (await library()).books.filter((b) => b.kind === 'main').map((b) => b.owner);
    expect(after.indexOf('Sofia')).toBe(before.indexOf('Sofia') - 1);
  });

  it('matches all main books to one size, and Undo restores them', async () => {
    const lib = await library();
    const src = lib.books.find((b) => b.owner === 'Mom & Dad')!;
    const res = await api(admin, 'POST', `/api/books/${src.id}/match-size`);
    const mains = (await library()).books.filter((b) => b.kind === 'main');
    expect(mains.every((b) => b.width === 98 && b.height === 440)).toBe(true);
    expect((await library()).books.find((b) => b.kind === 'small')!.width).toBe(62);
    await api(admin, 'PUT', '/api/books/sizes', { sizes: res.json().previous });
    expect((await library()).books.find((b) => b.owner === 'Sofia')!.width).toBe(72);
  });
});

describe('deleting books', () => {
  it('removes a main book with its household and smaller books, and Undo restores everything', async () => {
    const lib = await library();
    const rivera = lib.books.find((b) => b.owner === 'Marco & Elena')!;
    const res = await api(admin, 'DELETE', `/api/books/${rivera.id}`);
    expect(res.json().bookIds).toHaveLength(2);
    expect(res.json().memberIds).toHaveLength(2);
    const after = await library();
    expect(after.books.some((b) => b.householdId === rivera.householdId)).toBe(false);
    const people = (await api(admin, 'GET', '/api/people')).json().people;
    expect(people.find((p: { name: string }) => p.name === 'Elena').householdId).toBeNull();

    await api(admin, 'POST', '/api/books/restore', res.json());
    const back = await library();
    expect(back.books.filter((b) => b.householdId === rivera.householdId)).toHaveLength(2);
    const people2 = (await api(admin, 'GET', '/api/people')).json().people;
    expect(people2.find((p: { name: string }) => p.name === 'Elena').householdId).toBe(rivera.householdId);
  });
});
