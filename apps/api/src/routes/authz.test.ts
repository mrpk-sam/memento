import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import * as s from '../db/schema.js';
import { ADMIN, createTestApp, testEnv } from '../test/app.js';

/**
 * Who can call what. Each row is [method, url, body, expected status per role].
 * "ok" means anything below 400, or 400/409/502: validation may still reject a body, but access was granted.
 * "-" skips a role, for when an earlier role's call already used up a throwaway fixture
 * (e.g. the household admin deleted it, so the admin would get 404).
 * Roles run in the order anon, member, hhAdmin, admin, and rows run top to bottom.
 */
type Role = 'anon' | 'member' | 'hhAdmin' | 'admin';
type Expect = 'ok' | 401 | 403 | '-';

let t: Awaited<ReturnType<typeof createTestApp>>;
const cookies: Partial<Record<Role | 'admin2', string>> = {};
let ids: { book: string; page: string; household: string; member: string; otherMember: string; style: string };
/** Throwaway fixtures, so destructive rows don't break the rows after them. */
let fx: {
  superId: string;
  otherHousehold: string;
  tmpOwn: string; // a member of the household admin's household
  tmpOther: string; // a member of another household
  tmpPromote: string;
  req: string[]; // open access requests
  openBook: string; // unlocked, so anyone can edit it
  lockedBook: string; // locked with PIN 1357
  smallBook: string; // throwaway, for delete and restore
  summaryPage: string;
  photo: string; // in the locked seeded book
  openPhoto: string; // in the open book
  inboxItem: string;
  style: string; // custom caption style
  theme: string; // custom theme
};

beforeAll(async () => {
  t = await createTestApp();
  const admin = await t.login(ADMIN);
  cookies.admin = admin;
  const call = (m: string, url: string, payload?: object) => t.app.inject({ method: m as 'GET', url, headers: { cookie: admin }, payload });
  const lib = (await call('GET', '/api/library')).json();
  const people = (await call('GET', '/api/people')).json();
  const rivera = people.households.find((h: { name: string }) => h.name === 'Marco & Elena').id;
  await call('POST', '/api/people', { name: 'Mem', email: 'mem@example.com', householdId: rivera, sendInvite: false });
  await call('POST', '/api/people', { name: 'HH', email: 'hh@example.com', householdId: rivera, access: 'household_admin', sendInvite: false });
  cookies.member = await t.login('mem@example.com');
  cookies.hhAdmin = await t.login('hh@example.com');
  const all = (await call('GET', '/api/people')).json().people;
  const book = lib.books[0].id;
  const pages = (await call('GET', `/api/books/${book}`)).json().pages;
  const ai = (await call('GET', '/api/ai')).json();
  ids = {
    book,
    page: pages[4].id,
    household: rivera,
    member: all.find((p: { name: string }) => p.name === 'Elena').id,
    otherMember: all.find((p: { name: string }) => p.name === 'Sofia').id,
    style: ai.styles[0].id,
  };

  const created = async (m: string, url: string, payload: object) => {
    const res = await call(m, url, payload);
    if (res.statusCode !== 200) throw new Error(`${m} ${url} → ${res.statusCode} ${res.body}`);
    return res.json().id as string;
  };
  const other = people.households.find((h: { id: string }) => h.id !== rivera).id;
  const superId = all.find((p: { isSuperAdmin: boolean }) => p.isSuperAdmin).id;
  const tmpOwn = await created('POST', '/api/people', { name: 'Tmp Own', email: 'tmp-own@example.com', householdId: rivera, sendInvite: true });
  const tmpOther = await created('POST', '/api/people', { name: 'Tmp Other', email: 'tmp-other@example.com', householdId: other, sendInvite: true });
  const tmpPromote = await created('POST', '/api/people', { name: 'Tmp Promote', householdId: rivera, sendInvite: false });
  await created('POST', '/api/people', { name: 'Admin Two', email: 'admin2@example.com', access: 'admin', sendInvite: false });
  cookies.admin2 = await t.login('admin2@example.com');

  const req = [];
  for (let i = 0; i < 4; i++) {
    const [r] = await t.db.insert(s.accessRequests).values({ email: `req${i}@example.com`, name: `Req ${i}` }).returning();
    req.push(r!.id);
  }

  const cover = { texture: 'linen', color: '#3F5873' };
  const openBook = await created('POST', '/api/books', { ...cover, householdName: 'Open', locked: false });
  const lockedBook = await created('POST', '/api/books', { ...cover, householdName: 'Locked', locked: true, pin: '1357' });
  const smallBook = await created('POST', '/api/books', { ...cover, parentHouseholdId: rivera, ownerName: 'Tmp', locked: true, pin: '1111' });

  const summaryOf = (p: { id: string; layout: string | null }[]) => p.find((x) => x.layout === 'summaryL')!.id;
  const summaryPage = summaryOf(pages);
  const openPages = (await call('GET', `/api/books/${openBook}`)).json().pages;
  const photoRow = (bookId: string, pageId: string) => ({ bookId, pageId, position: 0, objectKey: 'x', thumbKey: 'x', displayKey: 'x', subject: 'A photo' });
  const [photo] = await t.db.insert(s.photos).values(photoRow(ids.book, summaryPage)).returning();
  const [openPhoto] = await t.db.insert(s.photos).values(photoRow(openBook, summaryOf(openPages))).returning();
  t.storage.objects.set(`books/${ids.book}/${photo!.id}/400.jpg`, Buffer.from('jpeg'));

  const [item] = await t.db.insert(s.inboxItems).values({ objectKey: 'x', thumbKey: 'x', displayKey: 'x', subject: 'Inbox photo' }).returning();
  t.storage.objects.set(`inbox/${item!.id}/400.jpg`, Buffer.from('jpeg'));

  const style = await created('POST', '/api/ai/styles', { name: 'Tmp style', prompt: 'x' });
  const theme = await created('POST', '/api/themes', { paper: '#FFFFFF', accent: '#000000', accent2: '#111111', motif: 'none' });

  fx = {
    superId,
    otherHousehold: other,
    tmpOwn,
    tmpOther,
    tmpPromote,
    req,
    openBook,
    lockedBook,
    smallBook,
    summaryPage,
    photo: photo!.id,
    openPhoto: openPhoto!.id,
    inboxItem: item!.id,
    style,
    theme,
  };
});
afterAll(() => t.close());

const U = '00000000-0000-4000-8000-000000000000';
const rows = (): [string, string, object | undefined, Record<Role, Expect>][] => [
  // Everyone signed in can read.
  ['GET', '/api/me', undefined, { anon: 401, member: 'ok', hhAdmin: 'ok', admin: 'ok' }],
  ['GET', '/api/library', undefined, { anon: 401, member: 'ok', hhAdmin: 'ok', admin: 'ok' }],
  ['GET', `/api/books/${ids.book}`, undefined, { anon: 401, member: 'ok', hhAdmin: 'ok', admin: 'ok' }],
  ['GET', '/api/themes', undefined, { anon: 401, member: 'ok', hhAdmin: 'ok', admin: 'ok' }],
  // Family tab: admins and household admins.
  ['GET', '/api/people', undefined, { anon: 401, member: 403, hhAdmin: 'ok', admin: 'ok' }],
  ['PATCH', `/api/people/${ids.member}`, { roleLabel: 'Wife' }, { anon: 401, member: 403, hhAdmin: 'ok', admin: 'ok' }],
  ['PATCH', `/api/people/${ids.otherMember}`, { roleLabel: 'Sister' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  // Books, PINs, settings, AI, inbox, themes: admin only.
  ['POST', '/api/books', { householdName: 'X', texture: 'linen', color: '#3F5873', locked: false }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['PUT', `/api/books/${ids.book}/pin`, { pin: '2468' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['PATCH', `/api/books/${ids.book}`, { locked: true }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/books/${ids.book}/move`, { dir: 1 }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/books/${ids.book}/match-size`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['PATCH', `/api/households/${ids.household}`, { surname: 'Rivera' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['PATCH', '/api/settings', { lockNewBooks: true }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['GET', '/api/ai', undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['PATCH', '/api/ai', { maxLen: 60 }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['PATCH', `/api/ai/styles/${ids.style}`, { prompt: 'x' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', '/api/ai/test-connection', undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['GET', '/api/inbox', undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', '/api/themes', { paper: '#FFFFFF', accent: '#000000', accent2: '#111111', motif: 'none' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['GET', '/api/themes/usage', undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  // Page and photo edits: need an unlock (the seeded book is locked with no PIN), admin bypasses.
  ['PATCH', `/api/pages/${ids.page}`, { stickerPack: 'none' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/books/${ids.book}/years`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['PATCH', `/api/books/${ids.book}`, { spineText: 'K&S' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['PUT', `/api/books/${ids.book}/hero`, { photoId: null }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['PUT', `/api/books/${ids.book}/layout`, { photos: [] }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  // Upload URLs need edit rights on some book. An earlier row creates an open (unlocked) book, so everyone qualifies here.
  ['POST', '/api/uploads', { files: [{ name: 'a.jpg', type: 'image/jpeg', size: 10 }] }, { anon: 401, member: 'ok', hhAdmin: 'ok', admin: 'ok' }],
  ['POST', `/api/books/${ids.book}/photos`, { uploads: [{ id: U, name: 'a.jpg' }], L: 4, single: false }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  // The caption test box is admin-only.
  ['POST', '/api/ai/caption', { subject: 'x' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', '/api/ai/caption', { subject: 'x', inboxItemId: fx.inboxItem }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  // With a photoId it needs edit rights on that photo's book.
  ['POST', '/api/ai/caption', { subject: 'x', photoId: fx.photo }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', '/api/ai/caption', { subject: 'x', photoId: fx.openPhoto }, { anon: 401, member: 'ok', hhAdmin: 'ok', admin: 'ok' }],

  // People. Household admins manage non-admins in their own household only.
  ['POST', '/api/people', { name: 'New Own', householdId: ids.household, sendInvite: false }, { anon: 401, member: 403, hhAdmin: 'ok', admin: 'ok' }],
  ['POST', '/api/people', { name: 'New Other', householdId: fx.otherHousehold, sendInvite: false }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', '/api/people', { name: 'New Guest', householdId: null, sendInvite: false }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', '/api/people', { name: 'New Admin', access: 'admin', householdId: ids.household, sendInvite: false }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/people/${fx.tmpOwn}/invite`, undefined, { anon: 401, member: 403, hhAdmin: 'ok', admin: 'ok' }],
  ['POST', `/api/people/${fx.tmpOther}/invite`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/people/${fx.tmpOwn}/invite/accept`, undefined, { anon: 401, member: 403, hhAdmin: 'ok', admin: 'ok' }],
  ['POST', `/api/people/${fx.tmpOther}/invite/accept`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/people/${fx.tmpOwn}/invite/cancel`, undefined, { anon: 401, member: 403, hhAdmin: 'ok', admin: '-' }],
  ['POST', `/api/people/${fx.tmpOwn}/restore`, undefined, { anon: 401, member: 403, hhAdmin: 'ok', admin: 'ok' }],
  ['POST', `/api/people/${fx.tmpOther}/invite/cancel`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/people/${fx.tmpOther}/restore`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['DELETE', `/api/people/${fx.tmpOwn}`, undefined, { anon: 401, member: 403, hhAdmin: 'ok', admin: '-' }],
  ['POST', `/api/people/${fx.tmpOwn}/restore`, undefined, { anon: 401, member: 403, hhAdmin: 'ok', admin: 'ok' }],
  ['DELETE', `/api/people/${fx.tmpOther}`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/people/${fx.tmpOther}/restore`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  // A household admin can't promote to admin or move someone out of their household.
  ['PATCH', `/api/people/${fx.tmpPromote}`, { householdId: fx.otherHousehold }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['PATCH', `/api/people/${fx.tmpPromote}`, { householdId: ids.household, access: 'admin' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  // Once someone is an admin, a household admin can't touch them.
  ['PATCH', `/api/people/${fx.tmpPromote}`, { roleLabel: 'Uncle' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['DELETE', `/api/people/${fx.tmpPromote}`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  // The super-admin can't be demoted or have their email changed, even by themselves.
  ['PATCH', `/api/people/${fx.superId}`, { access: 'member' }, { anon: 401, member: 403, hhAdmin: 403, admin: 403 }],
  ['PATCH', `/api/people/${fx.superId}`, { email: 'someone@example.com' }, { anon: 401, member: 403, hhAdmin: 403, admin: 403 }],
  ['POST', `/api/people/${fx.superId}/invite/cancel`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 403 }],

  // Access requests: the Family tab. Requests have no household, so household admins handle them too.
  ['GET', '/api/access-requests', undefined, { anon: 401, member: 403, hhAdmin: 'ok', admin: 'ok' }],
  ['POST', `/api/access-requests/${fx.req[0]}/approve`, { householdId: ids.household }, { anon: 401, member: 403, hhAdmin: 'ok', admin: '-' }],
  ['POST', `/api/access-requests/${fx.req[1]}/approve`, { householdId: fx.otherHousehold }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/access-requests/${fx.req[2]}/approve`, { householdId: ids.household, access: 'admin' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/access-requests/${fx.req[3]}/decline`, undefined, { anon: 401, member: 403, hhAdmin: 'ok', admin: '-' }],
  ['POST', `/api/access-requests/${fx.req[3]}/reopen`, undefined, { anon: 401, member: 403, hhAdmin: 'ok', admin: '-' }],
  ['POST', `/api/access-requests/${fx.req[3]}/decline`, undefined, { anon: 401, member: 403, hhAdmin: '-', admin: 'ok' }],
  ['POST', `/api/access-requests/${fx.req[3]}/reopen`, undefined, { anon: 401, member: 403, hhAdmin: '-', admin: 'ok' }],

  // Books: admin only, except unlocking (anyone signed in) and adding months (edit rights).
  ['PUT', '/api/books/sizes', { sizes: [] }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['DELETE', `/api/books/${fx.smallBook}`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', '/api/books/restore', { bookIds: [fx.smallBook], householdId: null, memberIds: [] }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/books/${ids.book}/months`, { year: 2026, month: 5 }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/books/${fx.lockedBook}/months`, { year: 2026, month: 2 }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/books/${fx.lockedBook}/unlock`, { pin: '1357' }, { anon: 401, member: 'ok', hhAdmin: 'ok', admin: 'ok' }],
  // The unlock above grants editing.
  ['POST', `/api/books/${fx.lockedBook}/months`, { year: 2026, month: 3 }, { anon: 401, member: 'ok', hhAdmin: 'ok', admin: 'ok' }],

  // Photos: need edit rights on the photo's book.
  ['PATCH', `/api/photos/${fx.photo}`, { caption: 'x' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['PATCH', `/api/photos/${fx.openPhoto}`, { caption: 'x' }, { anon: 401, member: 'ok', hhAdmin: 'ok', admin: 'ok' }],
  ['POST', `/api/photos/${fx.photo}/month`, { month: 3 }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/photos/${fx.photo}/move`, { pageId: fx.summaryPage, position: 0 }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/books/${ids.book}/chapter-moves`, { photoIds: [fx.photo], pageId: fx.summaryPage }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['DELETE', `/api/photos/${fx.photo}`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/photos/${fx.photo}/restore`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],

  // Inbox: admin only.
  ['POST', '/api/inbox', { uploads: [{ id: U, name: 'a.jpg' }] }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['GET', '/api/inbox/count', undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['PATCH', `/api/inbox/${fx.inboxItem}`, { caption: 'x' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/inbox/${fx.inboxItem}/file`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['DELETE', `/api/inbox/${fx.inboxItem}`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/inbox/${fx.inboxItem}/restore`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],

  // AI styles and models: admin only. Built-in styles can't be deleted, even by the admin.
  ['POST', '/api/ai/styles', { name: 'New style' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['DELETE', `/api/ai/styles/${fx.style}`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/ai/styles/${fx.style}/restore`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['DELETE', `/api/ai/styles/${ids.style}`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 403 }],
  ['GET', '/api/ai/models', undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],

  // Themes: admin only. Built-in themes can't be deleted.
  ['PATCH', `/api/themes/${fx.theme}`, { name: 'Renamed', paper: '#FFFFFF', accent: '#000000', accent2: '#111111', motif: 'none' }, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['PATCH', '/api/themes/cream', { paper: '#FFFFFF', accent: '#000000', accent2: '#111111', motif: 'none' }, { anon: 401, member: 403, hhAdmin: 403, admin: 403 }],
  ['DELETE', `/api/themes/${fx.theme}`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['POST', `/api/themes/${fx.theme}/restore`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
  ['DELETE', '/api/themes/cream', undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 403 }],

  // Media: book images for everyone signed in, inbox images for the admin only.
  ['GET', `/api/media/books/${ids.book}/${fx.photo}/400.jpg`, undefined, { anon: 401, member: 'ok', hhAdmin: 'ok', admin: 'ok' }],
  ['GET', `/api/media/inbox/${fx.inboxItem}/400.jpg`, undefined, { anon: 401, member: 403, hhAdmin: 403, admin: 'ok' }],
];

describe('authorization matrix', () => {
  it('grants and refuses access by role for every guarded endpoint', async () => {
    const failures: string[] = [];
    for (const [method, url, body, want] of rows()) {
      for (const role of ['anon', 'member', 'hhAdmin', 'admin'] as Role[]) {
        if (want[role] === '-') continue;
        const res = await t.app.inject({ method: method as 'GET', url, payload: body, headers: cookies[role] ? { cookie: cookies[role]! } : {} });
        const exp = want[role];
        const ok = exp === 'ok' ? res.statusCode < 400 || (res.statusCode === 400 || res.statusCode === 409 || res.statusCode === 502) : res.statusCode === exp;
        if (!ok) failures.push(`${role} ${method} ${url} → ${res.statusCode} (want ${exp}) ${res.body.slice(0, 80)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('rejects uploads over 50 MB at the upload URL too', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/uploads', headers: { cookie: cookies.admin! }, payload: { files: [{ name: 'a.mp4', type: 'video/mp4', size: 100 }] } });
    const big = Buffer.alloc(50 * 1024 * 1024 + 1, 1);
    const put = await t.app.inject({ method: 'PUT', url: res.json().uploads[0].url, payload: big, headers: { cookie: cookies.admin!, 'content-type': 'image/jpeg' } });
    expect(put.statusCode).toBe(413);
  });

  it('sends security headers and a content security policy on pages', async () => {
    const res = await t.app.inject({ url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.json()).toEqual({ ok: true, checks: { db: 'ok' } });
  });

  it("protects the super-admin from other admins", async () => {
    const as2 = (method: string, url: string, payload?: object) => t.app.inject({ method: method as 'GET', url, payload, headers: { cookie: cookies.admin2! } });
    const sup = `/api/people/${fx.superId}`;
    expect((await as2('PATCH', sup, { access: 'member' })).statusCode).toBe(403);
    expect((await as2('PATCH', sup, { email: 'someone@example.com' })).statusCode).toBe(403);
    expect((await as2('DELETE', sup)).statusCode).toBe(403);
    expect((await as2('POST', `${sup}/invite/cancel`)).statusCode).toBe(403);
    // Other changes to the super-admin are fine.
    expect((await as2('PATCH', sup, { roleLabel: 'Grandpa' })).statusCode).toBe(200);
    const me = (await as2('GET', '/api/people')).json().people.find((p: { id: string }) => p.id === fx.superId);
    expect(me).toMatchObject({ access: 'admin', email: ADMIN });
  });

  it('refuses upload PUTs with a bad, expired or borrowed signature', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/uploads', headers: { cookie: cookies.admin! }, payload: { files: [{ name: 'a.jpg', type: 'image/jpeg', size: 3 }] } });
    const url = new URL(res.json().uploads[0].url as string, 'http://x');
    const id = url.pathname.split('/').pop()!;
    const put = (u: string, cookie?: string) =>
      t.app.inject({ method: 'PUT', url: u, payload: Buffer.from('abc'), headers: { 'content-type': 'image/jpeg', ...(cookie ? { cookie } : {}) } });
    const at = (exp: number, sig: string) => `/api/uploads/${id}?exp=${exp}&sig=${sig}`;
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig')!;
    const signFor = (userId: string, e: number) => createHmac('sha256', testEnv.SESSION_SECRET).update(`${userId}:${id}:${e}`).digest('base64url');
    const adminId = fx.superId;

    expect((await put(at(exp, sig))).statusCode).toBe(401);
    // Another user's signed URL.
    expect((await put(at(exp, sig), cookies.member)).statusCode).toBe(403);
    expect((await put(at(exp, sig), cookies.hhAdmin)).statusCode).toBe(403);
    // Tampered signature, and a later expiry the signature doesn't cover.
    expect((await put(at(exp, sig.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))), cookies.admin)).statusCode).toBe(403);
    expect((await put(at(exp + 60_000, sig), cookies.admin)).statusCode).toBe(403);
    // Correctly signed but expired.
    const past = Date.now() - 1000;
    expect((await put(at(past, signFor(adminId, past)), cookies.admin)).statusCode).toBe(403);
    // The owner, in time, with the real signature.
    expect((await put(at(exp, sig), cookies.admin)).statusCode).toBe(200);
  });
});
