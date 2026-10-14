import { chapters, capacity, yearSpread, type ModelPage, type ModelPhoto } from './bookModel.js';

// Photo placement and reflow, ported from the prototype's reflow(), setMonth(),
// insertPhotos() and uploadToSpread(). Pure: they return new page arrays.
// The API runs them on DB state; the web runs them for instant feedback.

/** A year summary spread holds 6 + 9 photos. Each month owns at most one. */
export const YEAR_CAPACITY = 15;

type P = ModelPage & { photos?: ModelPhoto[] };

const monthKey = (p: ModelPhoto) => (p.month == null ? 99 : p.month);

/** Sorts a year's photos by month (no month last, otherwise stable) and splits them 6 / 9. */
export function reflow<T extends P>(pages: T[], yl: number, all: ModelPhoto[]): T[] {
  const sorted = all.slice().sort((a, b) => monthKey(a) - monthKey(b));
  const next = pages.slice();
  next[yl] = { ...next[yl]!, photos: sorted.slice(0, 6) };
  next[yl + 1] = { ...next[yl + 1]!, photos: sorted.slice(6, YEAR_CAPACITY) };
  return next;
}

export interface SetMonthResult<T> {
  pages: T[];
  /** The photo that already had this month and was removed to make room (Undo brings it back). */
  clash: ModelPhoto | null;
}

/** Ties a photo in a year spread to a month (or none). A month holds one photo, so a clash is replaced. */
export function setMonth<T extends P>(pages: T[], photoId: string, month: number | null): SetMonthResult<T> | null {
  const i = pages.findIndex((pg) => pg.photos?.some((p) => p.id === photoId));
  const yl = yearSpread(pages, i);
  if (yl == null) return null;
  let all = [...(pages[yl]!.photos ?? []), ...(pages[yl + 1]!.photos ?? [])];
  const clash = month != null ? (all.find((p) => p.id !== photoId && p.month === month) ?? null) : null;
  all = all.filter((p) => p !== clash).map((p) => (p.id === photoId ? { ...p, month } : p));
  return { pages: reflow(pages, yl, all), clash };
}

export interface InsertResult<T> {
  pages: T[];
  placed: string[];
  left: number;
}

/** Appends photos to pages in the given order, filling each up to its capacity. */
export function insertPhotos<T extends P>(pages: T[], idxs: number[], photos: ModelPhoto[]): InsertResult<T> {
  const rest = photos.slice();
  const placed: string[] = [];
  const next = pages.slice();
  for (const i of idxs) {
    const pg = next[i];
    if (!pg || !capacity(pg)) continue;
    const have = pg.photos ?? [];
    const room = capacity(pg) - have.length;
    if (room <= 0) continue;
    const add = rest.splice(0, room);
    add.forEach((p) => placed.push(p.id));
    next[i] = { ...pg, photos: [...have, ...add] };
  }
  return { pages: next, placed, left: rest.length };
}

export type SpreadResult<T> =
  | { kind: 'no-slots' }
  | { kind: 'year-full' }
  | { kind: 'year'; pages: T[]; added: ModelPhoto[]; left: number }
  | { kind: 'pages'; pages: T[]; placed: string[]; left: number };

/**
 * Places new photos dropped on the spread starting at page L.
 * On a year spread, new photos join with no month (after the month-tagged ones) until
 * someone picks their month in the editor.
 * Elsewhere they fill the dropped-on page first, then its neighbour.
 */
export function placeOnSpread<T extends P>(pages: T[], L: number, opts: { single: boolean; side?: 'L' | 'R' }, photos: ModelPhoto[]): SpreadResult<T> {
  const idxs = opts.single ? [L] : opts.side === 'L' ? [L, L + 1] : [L + 1, L];
  if (!idxs.some((i) => pages[i] && capacity(pages[i]!))) return { kind: 'no-slots' };
  const yl = yearSpread(pages, L);
  if (yl != null) {
    const all = [...(pages[yl]!.photos ?? []), ...(pages[yl + 1]!.photos ?? [])];
    // New photos start with no month; the editor's month picker places them.
    const added = photos.slice(0, Math.max(0, YEAR_CAPACITY - all.length)).map((p) => ({ ...p, month: null }));
    if (!added.length) return { kind: 'year-full' };
    return { kind: 'year', pages: reflow(pages, yl, [...all, ...added]), added, left: photos.length - added.length };
  }
  const r = insertPhotos(pages, idxs, photos);
  return { kind: 'pages', ...r };
}

/** Where an inbox photo filed to a chapter goes: the chapter's right page first, then its left. */
export function fileToChapter<T extends P>(pages: T[], chapterIdx: number, photo: ModelPhoto): InsertResult<T> {
  return insertPhotos(pages, [chapterIdx + 1, chapterIdx], [photo]);
}

/** Resolves a chapter key ("y-2026", "m-2026-July") to its page index. */
export function chapterIndex(pages: ModelPage[], key: string): number | null {
  const c = chapters(pages);
  const y = /^y-(\d+)$/.exec(key);
  if (y) return c.years.find((x) => x.year === +y[1]!)?.idx ?? null;
  const m = /^m-(\d+)-(.+)$/.exec(key);
  if (m) return c.months.find((x) => x.year === +m[1]! && x.label === m[2])?.idx ?? null;
  return null;
}

export type MoveResult<T> = { kind: 'moved'; pages: T[] } | { kind: 'unchanged' } | { kind: 'month-order' } | { kind: 'invalid' };

/**
 * Moves a photo to `position` on page `toIdx` (both pages of a spread are allowed).
 * - On a full target page the photo swaps with the one it was dropped on.
 * - On a year spread the year is re-sorted by month afterwards, so only photos with no
 *   month (or the same month) can really change places; anything else reports 'month-order'.
 */
export function movePhoto<T extends P>(pages: T[], photoId: string, toIdx: number, position: number): MoveResult<T> {
  const fromIdx = pages.findIndex((pg) => pg.photos?.some((p) => p.id === photoId));
  const from = pages[fromIdx];
  const to = pages[toIdx];
  if (!from || !to || !capacity(to)) return { kind: 'invalid' };
  const fromPhotos = from.photos ?? [];
  const i = fromPhotos.findIndex((p) => p.id === photoId);
  const photo = fromPhotos[i]!;
  const next = pages.slice();
  const yl = yearSpread(pages, fromIdx);

  if (yl != null) {
    // A year spread is one sequence across its two pages.
    if (yearSpread(pages, toIdx) !== yl) return { kind: 'invalid' };
    const all = [...(pages[yl]!.photos ?? []), ...(pages[yl + 1]!.photos ?? [])];
    const flatTo = (toIdx === yl ? 0 : (pages[yl]!.photos ?? []).length) + position;
    const without = all.filter((p) => p.id !== photoId);
    const at = Math.max(0, Math.min(without.length, flatTo > all.indexOf(photo) ? flatTo - 1 : flatTo));
    without.splice(at, 0, photo);
    const moved = reflow(next, yl, without);
    const before = all.map((p) => p.id).join();
    const after = [...(moved[yl]!.photos ?? []), ...(moved[yl + 1]!.photos ?? [])].map((p) => p.id).join();
    if (before === after) return { kind: photo.month != null || at !== all.indexOf(photo) ? 'month-order' : 'unchanged' };
    return { kind: 'moved', pages: moved };
  }

  if (fromIdx === toIdx) {
    const list = fromPhotos.filter((p) => p.id !== photoId);
    const at = Math.max(0, Math.min(list.length, position > i ? position - 1 : position));
    if (at === i) return { kind: 'unchanged' };
    list.splice(at, 0, photo);
    next[fromIdx] = { ...from, photos: list };
    return { kind: 'moved', pages: next };
  }

  const toPhotos = to.photos ?? [];
  const at = Math.max(0, Math.min(toPhotos.length, position));
  if (toPhotos.length < capacity(to)) {
    next[fromIdx] = { ...from, photos: fromPhotos.filter((p) => p.id !== photoId) };
    next[toIdx] = { ...to, photos: [...toPhotos.slice(0, at), photo, ...toPhotos.slice(at)] };
    return { kind: 'moved', pages: next };
  }
  // Full page: swap with the photo it landed on.
  const j = Math.min(at, toPhotos.length - 1);
  const other = toPhotos[j]!;
  next[fromIdx] = { ...from, photos: fromPhotos.map((p) => (p.id === photoId ? other : p)) };
  next[toIdx] = { ...to, photos: toPhotos.map((p, k) => (k === j ? photo : p)) };
  return { kind: 'moved', pages: next };
}

/** Where "move earlier/later" by one step lands, reading across the spread's pages in order. */
export function stepTarget(pages: P[], idxs: number[], photoId: string, delta: -1 | 1): { toIdx: number; position: number } | null {
  const seq = idxs.flatMap((pi) => (pages[pi]?.photos ?? []).map((p, k) => ({ pi, k, id: p.id })));
  const n = seq.findIndex((x) => x.id === photoId);
  const m = n + delta;
  if (n < 0 || m < 0 || m >= seq.length) return null;
  const target = seq[m]!;
  const here = seq[n]!;
  // Across the fold: the end of the left page and the start of the right page meet,
  // so a later/earlier pair of steps always undo each other.
  if (target.pi !== here.pi) return { toIdx: target.pi, position: delta > 0 ? 0 : (pages[target.pi]?.photos ?? []).length };
  return { toIdx: target.pi, position: delta > 0 ? target.k + 1 : target.k };
}
