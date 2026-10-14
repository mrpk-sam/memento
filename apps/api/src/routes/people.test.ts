import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, createTestApp } from '../test/app.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let households: { id: string; name: string }[];

const api = (cookie: string, method: string, url: string, payload?: object) =>
  t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload });

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.login(ADMIN);
  households = (await api(admin, 'GET', '/api/people')).json().households;
});
afterAll(() => t.close());

const hh = (name: string) => households.find((h) => h.name === name)!.id;

describe('people', () => {
  it('lists the seeded family grouped data', async () => {
    const res = await api(admin, 'GET', '/api/people');
    expect(res.json().people).toHaveLength(11);
    expect(res.json().households).toHaveLength(5);
    expect(res.json().households[0].mainBook.title).toBe("Marco & Elena's Year in Review");
  });

  it('invites by email and lets the invitee in through the link', async () => {
    const res = await api(admin, 'POST', '/api/people', { name: 'Cousin Ines', email: 'Ines@Example.com', householdId: null });
    expect(res.statusCode).toBe(200);
    const mail = t.mails.at(-1)!;
    expect(mail.to).toBe('ines@example.com');
    const list = (await api(admin, 'GET', '/api/people')).json().people;
    const ines = list.find((p: { name: string }) => p.name === 'Cousin Ines');
    expect(ines).toMatchObject({ roleLabel: 'Guest', invite: { resentCount: 0 } });

    const cookie = await t.cookieFromLink(mail.text);
    const me = (await api(cookie, 'GET', '/api/me')).json();
    expect(me.user.name).toBe('Cousin Ines');
    expect(me.deskTabs).toEqual([]);
    const after = (await api(admin, 'GET', '/api/people')).json().people;
    expect(after.find((p: { id: string }) => p.id === ines.id).invite).toBeNull();
  });

  it('needs an email to send an invite, but not to add directly', async () => {
    expect((await api(admin, 'POST', '/api/people', { name: 'Baby Luca', sendInvite: true })).statusCode).toBe(400);
    const res = await api(admin, 'POST', '/api/people', { name: 'Baby Luca', roleLabel: 'Son · 1', sendInvite: false, householdId: hh('Marco & Elena') });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a duplicate email with 409', async () => {
    const res = await api(admin, 'POST', '/api/people', { name: 'Dupe', email: ADMIN, sendInvite: false });
    expect(res.statusCode).toBe(409);
  });

  it('refuses household admin without a household', async () => {
    const res = await api(admin, 'POST', '/api/people', { name: 'X', access: 'household_admin', sendInvite: false });
    expect(res.statusCode).toBe(403);
  });

  it('resends and cancels invites, and Undo restores them', async () => {
    await api(admin, 'POST', '/api/people', { name: 'Uncle Ray', email: 'ray@example.com', householdId: null });
    const ray = (await api(admin, 'GET', '/api/people')).json().people.find((p: { name: string }) => p.name === 'Uncle Ray');
    await api(admin, 'POST', `/api/people/${ray.id}/invite`);
    let list = (await api(admin, 'GET', '/api/people')).json().people;
    expect(list.find((p: { id: string }) => p.id === ray.id).invite.resentCount).toBe(1);

    const link = t.mails.at(-1)!.text;
    await api(admin, 'POST', `/api/people/${ray.id}/invite/cancel`);
    list = (await api(admin, 'GET', '/api/people')).json().people;
    expect(list.some((p: { id: string }) => p.id === ray.id)).toBe(false);
    await expect(t.cookieFromLink(link)).rejects.toThrow();

    await api(admin, 'POST', `/api/people/${ray.id}/restore`);
    list = (await api(admin, 'GET', '/api/people')).json().people;
    expect(list.find((p: { id: string }) => p.id === ray.id).invite).not.toBeNull();
  });

  it('changing an email kills old links and sessions, and re-sends an open invite', async () => {
    await api(admin, 'POST', '/api/people', { name: 'Typo', email: 'typo@exmaple.com', householdId: null });
    const oldInvite = t.mails.at(-1)!.text;
    const typo = (await api(admin, 'GET', '/api/people')).json().people.find((p: { name: string }) => p.name === 'Typo');
    await api(admin, 'PATCH', `/api/people/${typo.id}`, { email: 'typo@example.com' });
    expect(t.mails.at(-1)!.to).toBe('typo@example.com');
    await expect(t.cookieFromLink(oldInvite)).rejects.toThrow();
    const session = await t.cookieFromLink(t.mails.at(-1)!.text);
    expect((await api(session, 'GET', '/api/me')).statusCode).toBe(200);

    await api(admin, 'PATCH', `/api/people/${typo.id}`, { email: 'typo2@example.com' });
    expect((await api(session, 'GET', '/api/me')).statusCode).toBe(401);
  });

  it('protects the super-admin', async () => {
    const me = (await api(admin, 'GET', '/api/me')).json().user;
    expect((await api(admin, 'PATCH', `/api/people/${me.id}`, { access: 'member' })).statusCode).toBe(403);
    expect((await api(admin, 'DELETE', `/api/people/${me.id}`)).statusCode).toBe(400);
  });

  describe('household admins', () => {
    let hhAdmin: string;
    let brooksId: string;
    beforeAll(async () => {
      const people = (await api(admin, 'GET', '/api/people')).json().people;
      const nadia = people.find((p: { name: string }) => p.name === 'Nadia');
      await api(admin, 'PATCH', `/api/people/${nadia.id}`, { email: 'nadia@example.com', access: 'household_admin' });
      hhAdmin = await t.login('nadia@example.com');
      brooksId = hh('Nadia & Omar');
    });

    it('see only the Family tab', async () => {
      expect((await api(hhAdmin, 'GET', '/api/me')).json().deskTabs).toEqual(['family']);
    });

    it('can add and edit people in their own household', async () => {
      const res = await api(hhAdmin, 'POST', '/api/people', { name: 'Junior', householdId: brooksId, sendInvite: false });
      expect(res.statusCode).toBe(200);
      expect((await api(hhAdmin, 'PATCH', `/api/people/${res.json().id}`, { roleLabel: 'Son' })).statusCode).toBe(200);
    });

    it('cannot touch other households or make admins', async () => {
      expect((await api(hhAdmin, 'POST', '/api/people', { name: 'X', householdId: hh('Sofia'), sendInvite: false })).statusCode).toBe(403);
      expect((await api(hhAdmin, 'POST', '/api/people', { name: 'X', householdId: brooksId, access: 'admin', sendInvite: false })).statusCode).toBe(403);
      const people = (await api(admin, 'GET', '/api/people')).json().people;
      const sofia = people.find((p: { name: string }) => p.name === 'Sofia');
      expect((await api(hhAdmin, 'PATCH', `/api/people/${sofia.id}`, { name: 'V' })).statusCode).toBe(403);
      expect((await api(hhAdmin, 'DELETE', `/api/people/${sofia.id}`)).statusCode).toBe(403);
      const omar = people.find((p: { name: string }) => p.name === 'Omar');
      expect((await api(hhAdmin, 'PATCH', `/api/people/${omar.id}`, { householdId: null })).statusCode).toBe(403);
    });
  });

  it('keeps members out of the desk', async () => {
    const ines = await t.login('ines@example.com');
    expect((await api(ines, 'GET', '/api/people')).statusCode).toBe(403);
  });
});
