import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, createTestApp } from '../test/app.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let ip = 0;
const api = (cookie: string | null, method: string, url: string, payload?: object) =>
  t.app.inject({ method: method as 'GET', url, headers: cookie ? { cookie } : {}, payload, remoteAddress: `192.0.2.${++ip % 250}` });
const ask = (email: string, name = 'Ines', note = '') => api(null, 'POST', '/api/auth/request-access', { email, name, note });
const open = async () => (await api(admin, 'GET', '/api/access-requests')).json().requests as { id: string; email: string; name: string; note: string }[];

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.login(ADMIN);
});
afterAll(() => t.close());

describe('requesting access', () => {
  it('saves the request and emails the admin', async () => {
    const before = t.mails.length;
    expect((await ask('Ines@Example.com', 'Cousin Ines', "Nadia's daughter")).json()).toEqual({ ok: true });
    const mail = t.mails.at(-1)!;
    expect(t.mails.length).toBe(before + 1);
    expect(mail).toMatchObject({ to: ADMIN, subject: 'Someone asked to join Memento' });
    expect(mail.text).toContain("They wrote: Nadia's daughter");
    expect(mail.text).toContain('/desk/family');
    expect(await open()).toMatchObject([{ email: 'ines@example.com', name: 'Cousin Ines', note: "Nadia's daughter" }]);
  });

  it('updates an open request instead of duplicating it, without another admin email', async () => {
    const before = t.mails.length;
    await ask('ines@example.com', 'Ines M.');
    expect(t.mails.length).toBe(before);
    expect(await open()).toMatchObject([{ name: 'Ines M.' }]);
  });

  it('just sends existing members a sign-in email, with the same reply', async () => {
    const res = await ask(ADMIN, 'Marco');
    expect(res.json()).toEqual({ ok: true });
    expect(t.mails.at(-1)!.subject).toMatch(/is your Memento sign-in code/);
    expect((await open()).some((r) => r.email === ADMIN)).toBe(false);
  });

  it('is rate-limited per address', async () => {
    const hit = () => t.app.inject({ method: 'POST', url: '/api/auth/request-access', payload: { email: 'spam@example.com', name: 'x' }, remoteAddress: '203.0.113.77' });
    for (let i = 0; i < 5; i++) expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(429);
  });
});

describe('deciding', () => {
  it('approving adds the member and emails an invite that signs them in', async () => {
    const hh = (await api(admin, 'GET', '/api/people')).json().households.find((h: { name: string }) => h.name === 'Nadia & Omar');
    const req = (await open()).find((r) => r.email === 'ines@example.com')!;
    const res = await api(admin, 'POST', `/api/access-requests/${req.id}/approve`, { householdId: hh.id, roleLabel: 'Niece' });
    expect(res.statusCode).toBe(200);
    const invite = t.mails.at(-1)!;
    expect(invite.to).toBe('ines@example.com');
    expect(invite.subject).toMatch(/invited/);
    const person = (await api(admin, 'GET', '/api/people')).json().people.find((p: { email: string }) => p.email === 'ines@example.com');
    expect(person).toMatchObject({ name: 'Ines M.', roleLabel: 'Niece', householdId: hh.id, access: 'member' });
    const cookie = await t.cookieFromLink(invite.text);
    expect((await api(cookie, 'GET', '/api/me')).json().user.name).toBe('Ines M.');
    expect((await open()).some((r) => r.id === req.id)).toBe(false);
  });

  it('declining sends nothing, and Undo reopens it', async () => {
    await ask('stranger@example.com', 'Stranger');
    const req = (await open()).find((r) => r.email === 'stranger@example.com')!;
    const before = t.mails.length;
    await api(admin, 'POST', `/api/access-requests/${req.id}/decline`);
    expect(t.mails.length).toBe(before);
    expect((await open()).some((r) => r.id === req.id)).toBe(false);
    await api(admin, 'POST', `/api/access-requests/${req.id}/reopen`);
    expect((await open()).some((r) => r.id === req.id)).toBe(true);
  });

  it("won't reopen a declined request when the same person has asked again", async () => {
    await ask('twice@example.com', 'Twice');
    const first = (await open()).find((r) => r.email === 'twice@example.com')!;
    await api(admin, 'POST', `/api/access-requests/${first.id}/decline`);
    await ask('Twice@example.com', 'Twice');
    const res = await api(admin, 'POST', `/api/access-requests/${first.id}/reopen`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/asked again/);
    expect((await open()).filter((r) => r.email.toLowerCase() === 'twice@example.com')).toHaveLength(1);
  });

  it('keeps members out and household admins to their own household', async () => {
    const ines = await t.login('ines@example.com');
    expect((await api(ines, 'GET', '/api/access-requests')).statusCode).toBe(403);
    const people = (await api(admin, 'GET', '/api/people')).json();
    const nadia = people.people.find((p: { name: string }) => p.name === 'Nadia');
    await api(admin, 'PATCH', `/api/people/${nadia.id}`, { email: 'nadia@example.com', access: 'household_admin' });
    const hhAdmin = await t.login('nadia@example.com');
    const req = (await open()).find((r) => r.email === 'stranger@example.com')!;
    const sofia = people.households.find((h: { name: string }) => h.name === 'Sofia');
    expect((await api(hhAdmin, 'POST', `/api/access-requests/${req.id}/approve`, { householdId: sofia.id })).statusCode).toBe(403);
    expect((await api(hhAdmin, 'POST', `/api/access-requests/${req.id}/approve`, { householdId: nadia.householdId })).statusCode).toBe(200);
  });
});
