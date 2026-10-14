import { describe, expect, it } from 'vitest';
import { canEditBook, canManagePerson, checkPersonChange, deskTabs, type Actor } from './permissions.js';

const admin: Actor = { id: 'a', access: 'admin', householdId: 'h1' };
const hhAdmin: Actor = { id: 'b', access: 'household_admin', householdId: 'h1' };
const member: Actor = { id: 'c', access: 'member', householdId: 'h1' };

describe('desk access', () => {
  it('gives admins every tab, household admins only Family, members nothing', () => {
    expect(deskTabs(admin)).toHaveLength(6);
    expect(deskTabs(hhAdmin)).toEqual(['family']);
    expect(deskTabs(member)).toEqual([]);
    expect(deskTabs(null)).toEqual([]);
  });
});

describe('canManagePerson', () => {
  it('lets admins manage anyone', () => {
    expect(canManagePerson(admin, { id: 'x', access: 'admin', householdId: 'h2' })).toBe(true);
  });
  it('limits household admins to non-admins in their own household', () => {
    expect(canManagePerson(hhAdmin, { id: 'x', access: 'member', householdId: 'h1' })).toBe(true);
    expect(canManagePerson(hhAdmin, { id: 'x', access: 'member', householdId: 'h2' })).toBe(false);
    expect(canManagePerson(hhAdmin, { id: 'x', access: 'member', householdId: null })).toBe(false);
    expect(canManagePerson(hhAdmin, { id: 'x', access: 'admin', householdId: 'h1' })).toBe(false);
  });
  it('never lets members manage people', () => {
    expect(canManagePerson(member, { id: 'x', access: 'member', householdId: 'h1' })).toBe(false);
  });
});

describe('checkPersonChange', () => {
  it('requires a household for household admins', () => {
    expect(checkPersonChange(admin, { access: 'household_admin', householdId: null })).toMatch(/household first/);
    expect(checkPersonChange(admin, { access: 'household_admin', householdId: 'h2' })).toBeNull();
  });
  it('stops household admins from promoting to admin or moving people out', () => {
    expect(checkPersonChange(hhAdmin, { access: 'admin', householdId: 'h1' })).toMatch(/Only an admin/);
    expect(checkPersonChange(hhAdmin, { access: 'member', householdId: 'h2' })).toMatch(/own household/);
    expect(checkPersonChange(hhAdmin, { access: 'member', householdId: null })).toMatch(/own household/);
    expect(checkPersonChange(hhAdmin, { access: 'household_admin', householdId: 'h1' })).toBeNull();
  });
  it('checks the current state as well as the next one', () => {
    const outsider = { id: 'x', access: 'member' as const, householdId: 'h2' };
    expect(checkPersonChange(hhAdmin, { access: 'member', householdId: 'h1' }, outsider)).toMatch(/can't change/);
  });
  it('rejects members outright', () => {
    expect(checkPersonChange(member, { access: 'member', householdId: 'h1' })).not.toBeNull();
  });
});

describe('canEditBook', () => {
  it('needs an unlock for locked books, except for admins', () => {
    expect(canEditBook(member, { locked: true }, false)).toBe(false);
    expect(canEditBook(member, { locked: true }, true)).toBe(true);
    expect(canEditBook(member, { locked: false }, false)).toBe(true);
    expect(canEditBook(admin, { locked: true }, false)).toBe(true);
  });
});
