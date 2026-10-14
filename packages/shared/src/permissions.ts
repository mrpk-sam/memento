import type { Access } from './schemas.js';

/** The subset of a user that permission checks need. */
export interface Actor {
  id: string;
  access: Access;
  householdId: string | null;
}

export interface PersonRef {
  id: string;
  access: Access;
  householdId: string | null;
}

export const ACCESS_LABELS: Record<Access, string> = {
  member: 'Member',
  household_admin: 'Household admin',
  admin: 'Admin',
};

export const isAdmin = (a: Actor | null | undefined) => a?.access === 'admin';

/** Admins, and household admins (their own household only), can use the Family tab. */
export const canUseDesk = (a: Actor | null | undefined) => a?.access === 'admin' || a?.access === 'household_admin';

/** Which Desk tabs an actor sees. Household admins only get Family members. */
export function deskTabs(a: Actor | null | undefined): string[] {
  if (isAdmin(a)) return ['family', 'books', 'themes', 'inbox', 'ai', 'settings'];
  if (a?.access === 'household_admin') return ['family'];
  return [];
}

/** Can the actor edit or remove this existing person? */
export function canManagePerson(actor: Actor, target: PersonRef): boolean {
  if (actor.access === 'admin') return true;
  if (actor.access !== 'household_admin' || !actor.householdId) return false;
  // Household admins manage non-admins in their own household.
  return target.householdId === actor.householdId && target.access !== 'admin';
}

export interface PersonDraft {
  access: Access;
  householdId: string | null;
}

/**
 * Checks the state a person would end up in after a create or update.
 * Returns an error message, or null when allowed.
 */
export function checkPersonChange(actor: Actor, next: PersonDraft, current?: PersonRef): string | null {
  if (current && !canManagePerson(actor, current)) return "You can't change this person.";
  if (next.access === 'household_admin' && !next.householdId) return 'Move them into a household first';
  if (actor.access === 'admin') return null;
  if (actor.access !== 'household_admin' || !actor.householdId) return "You can't manage people.";
  if (next.access === 'admin') return 'Only an admin can make someone an admin.';
  if (next.householdId !== actor.householdId) return 'You can only manage people in your own household.';
  return null;
}

/**
 * Can the actor edit a book's pages and photos?
 * Admins always can. Others need the book unlocked (no lock, or a live PIN unlock).
 */
export function canEditBook(actor: Actor, book: { locked: boolean }, hasLiveUnlock: boolean): boolean {
  if (actor.access === 'admin') return true;
  return !book.locked || hasLiveUnlock;
}
