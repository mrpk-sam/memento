import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, createTestApp } from '../test/app.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let member: string;
const api = (cookie: string, method: string, url: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload });

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.login(ADMIN);
  await api(admin, 'POST', '/api/people', { name: 'R', email: 'r@example.com', sendInvite: false });
  member = await t.login('r@example.com');
});
afterAll(() => t.close());

describe('themes', () => {
  it('counts pages per theme', async () => {
    const usage = (await api(admin, 'GET', '/api/themes/usage')).json();
    // 5 books × (6 cream + 2 kraft) pages.
    expect(usage).toEqual({ cream: 30, kraft: 10 });
  });

  it('saves a custom theme from the builder', async () => {
    const res = await api(admin, 'POST', '/api/themes', { name: 'Game night', paper: '#FFF7EA', accent: '#D2557A', accent2: '#3E9BB0', motif: 'confetti', stickerPack: 'hearts' });
    const id = res.json().id;
    const themes = (await api(member, 'GET', '/api/themes')).json();
    expect(themes.at(-1)).toMatchObject({ id, name: 'Game night', ink: '#3A3026', flags: ['#D2557A', '#FFFFFF', '#3E9BB0'], builtin: false });
  });

  it('deletes unused custom themes only', async () => {
    const themes = (await api(admin, 'GET', '/api/themes')).json();
    const custom = themes.at(-1);
    expect((await api(admin, 'DELETE', '/api/themes/cream')).statusCode).toBe(403);
    const lib = (await api(admin, 'GET', '/api/library')).json();
    const page = (await api(admin, 'GET', `/api/books/${lib.books[0].id}`)).json().pages[4];
    await api(admin, 'PATCH', `/api/pages/${page.id}`, { themeId: custom.id });
    expect((await api(admin, 'DELETE', `/api/themes/${custom.id}`)).statusCode).toBe(409);
    await api(admin, 'PATCH', `/api/pages/${page.id}`, { themeId: 'kraft' });
    expect((await api(admin, 'DELETE', `/api/themes/${custom.id}`)).statusCode).toBe(200);
    await api(admin, 'POST', `/api/themes/${custom.id}/restore`);
    expect((await api(admin, 'GET', '/api/themes')).json().at(-1).id).toBe(custom.id);
  });

  it('is admin-only to change', async () => {
    expect((await api(member, 'POST', '/api/themes', { paper: '#FFFFFF', accent: '#000000', accent2: '#000000', motif: 'none' })).statusCode).toBe(403);
  });
});

describe('settings', () => {
  it('updates the family name, lock default and landing copy', async () => {
    await api(admin, 'PATCH', '/api/settings', { familyName: 'Rivera-Brooks', lockNewBooks: false, landing: { head: 'Our books', intro: '' } });
    const lib = (await api(member, 'GET', '/api/library')).json();
    expect(lib.settings).toMatchObject({ familyName: 'Rivera-Brooks', lockNewBooks: false, landing: { head: 'Our books', intro: '' } });
    const content = (await api(member, 'GET', `/api/books/${lib.books[1].id}`)).json();
    // Households without a surname use the family name.
    expect(content.book.family).toBe('Rivera-Brooks');
  });

  it('rejects unknown landing fields and blank family names', async () => {
    expect((await api(admin, 'PATCH', '/api/settings', { landing: { evil: 'x' } })).statusCode).toBe(400);
    expect((await api(admin, 'PATCH', '/api/settings', { familyName: ' ' })).statusCode).toBe(400);
  });

  it('is admin-only', async () => {
    expect((await api(member, 'PATCH', '/api/settings', { familyName: 'X' })).statusCode).toBe(403);
  });
});
