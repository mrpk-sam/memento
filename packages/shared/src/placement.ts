import { chapterSpan, chapterStart, chapters, capacity, yearSpread, type ModelPage, type ModelPhoto } from './bookModel.js';

// Photo placement and reflow, ported from the prototype's reflow(), setMonth(),
// insertPhotos() and uploadToSpread(). Pure: they return new page arrays.
// The API runs them on DB state; the web runs them for instant feedback.

/** A year summary spread holds 6 + 9 photos, in month order. A month can hold any number of them. */
export const YEAR_CAPACITY = 15;

/** A month chapter grows extra 9 + 9 spreads up to this many photos: 6 + 8 + 4 × 9. */
export const MONTH_CAPACITY = 50;

type P = ModelPage & { photos?: ModelPhoto[] };

const isMonth = (pages: P[], start: number) => pages[start]?.layout === 'monthL';
const countIn = (pages: P[], idxs: number[]) => idxs.reduce((n, i) => n + (pages[i]?.photos?.length ?? 0), 0);

/**
 * How many extra spreads a chapter needs before `adding` more photos fit, or null if it
 * would pass its limit (15 for a year, 50 for a month). Years never grow.
 */
export function spreadsToAdd(pages: P[], start: number, adding: number): number | null {
  const span = chapterSpan(pages, start);
  const have = countIn(pages, span);
  if (!isMonth(pages, start)) return have + adding > YEAR_CAPACITY ? null : 0;
  if (have + adding > MONTH_CAPACITY) return null;
  const room = span.reduce((n, i) => n + capacity(pages[i]!), 0) - have;
  return adding <= room ? 0 : Math.ceil((adding - room) / (2 * capacity({ layout: 'monthMore' })));
}

/** Photos a chapter can still take (never below 0). */
export function chapterRoom(pages: P[], start: number) {
  return Math.max(0, (isMonth(pages, start) ? MONTH_CAPACITY : YEAR_CAPACITY) - countIn(pages, chapterSpan(pages, start)));
}

/**
 * Closes the gaps in a month chapter: its photos keep their reading order (title page, journal
 * page, then the extra pages) and refill the pages from the front. Empty extra spreads end up
 * last, where the hourly cleanup removes them.
 */
export function compactMonth<T extends P>(pages: T[], start: number): T[] {
  if (!isMonth(pages, start)) return pages;
  const span = chapterSpan(pages, start);
  const all = span.flatMap((i) => pages[i]!.photos ?? []);
  const next = pages.slice();
  let k = 0;
  for (const i of span) {
    const take = all.slice(k, k + capacity(pages[i]!));
    k += take.length;
    next[i] = { ...pages[i]!, photos: take };
  }
  return next;
}

/** Whether every page holds no more photos than it has slots for. */
export const withinCapacity = (pages: P[]) => pages.every((pg) => (pg.photos?.length ?? 0) <= capacity(pg));

/**
 * Where a removed photo goes when it comes back (Undo of a delete): its old page and position
 * if there's room, otherwise anywhere in its chapter (in month order for a year). Null if the
 * chapter is full now. A month may need to grow first; see spreadsToAdd.
 */
export function placeBack<T extends P>(pages: T[], photo: ModelPhoto, pageIdx: number, position: number): T[] | null {
  const pg = pages[pageIdx];
  if (!pg || !capacity(pg)) return null;
  const yl = yearSpread(pages, pageIdx);
  if (yl != null) {
    const all = [...(pages[yl]!.photos ?? []), ...(pages[yl + 1]!.photos ?? [])];
    if (all.length >= YEAR_CAPACITY) return null;
    const at = Math.min(all.length, (pageIdx === yl ? 0 : (pages[yl]!.photos ?? []).length) + position);
    return reflow(pages, yl, [...all.slice(0, at), photo, ...all.slice(at)]);
  }
  const have = pg.photos ?? [];
  if (have.length < capacity(pg)) {
    const next = pages.slice();
    next[pageIdx] = { ...pg, photos: [...have.slice(0, position), photo, ...have.slice(position)] };
    return next;
  }
  const start = chapterStart(pages, pageIdx);
  if (start == null) return null;
  const r = insertPhotos(pages, chapterSpan(pages, start), [photo]);
  return r.placed.length ? r.pages : null;
}

const monthKey = (p: ModelPhoto) => (p.month == null ? 99 : p.month);

/** Sorts a year's photos by month (no month last, otherwise stable) and splits them 6 / 9. */
export function reflow<T extends P>(pages: T[], yl: number, all: ModelPhoto[]): T[] {
  const sorted = all.slice().sort((a, b) => monthKey(a) - monthKey(b));
  const next = pages.slice();
  next[yl] = { ...next[yl]!, photos: sorted.slice(0, 6) };
  next[yl + 1] = { ...next[yl + 1]!, photos: sorted.slice(6, YEAR_CAPACITY) };
  return next;
}

/**
 * Ties a photo in a year spread to a month (or none). It joins the end of that month's
 * photos, so a month fills in the order photos are added. Nothing is ever removed.
 */
export function setMonth<T extends P>(pages: T[], photoId: string, month: number | null): { pages: T[] } | null {
  const i = pages.findIndex((pg) => pg.photos?.some((p) => p.id === photoId));
  const yl = yearSpread(pages, i);
  if (yl == null) return null;
  const all = [...(pages[yl]!.photos ?? []), ...(pages[yl + 1]!.photos ?? [])];
  const photo = all.find((p) => p.id === photoId)!;
  // Moved to the end first: the sort is stable, so this puts it after the month's other photos.
  return { pages: reflow(pages, yl, [...all.filter((p) => p.id !== photoId), { ...photo, month }]) };
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
  // In a month chapter, what doesn't fit the dropped-on spread carries on into the chapter's other pages.
  const start = chapterStart(pages, L);
  const rest = start != null && isMonth(pages, start) ? chapterSpan(pages, start).filter((i) => !idxs.includes(i)) : [];
  const r = insertPhotos(pages, [...idxs, ...rest], photos);
  return { kind: 'pages', ...r };
}

/** Where an inbox photo filed to a chapter goes: the chapter's right page first, then its left, then any extra pages. */
export function fileToChapter<T extends P>(pages: T[], chapterIdx: number, photo: ModelPhoto): InsertResult<T> {
  return insertPhotos(pages, [chapterIdx + 1, chapterIdx, ...chapterSpan(pages, chapterIdx).slice(2)], [photo]);
}

export type ChapterMoveResult<T> = { kind: 'moved'; pages: T[] } | { kind: 'same' } | { kind: 'full' } | { kind: 'invalid' };

/**
 * Moves a photo into another chapter: a year's summary or a month chapter, named by the
 * chapter's left page index. The year it leaves closes the gap in month order.
 * - Into a year: it joins in month order, keeping its month. A year holds 15.
 * - Into a month chapter: it takes that month and fills the chapter like an inbox photo
 *   (right page first, then left).
 */
export function moveToChapter<T extends P>(pages: T[], photoId: string, chapterIdx: number): ChapterMoveResult<T> {
  const fromIdx = pages.findIndex((pg) => pg.photos?.some((p) => p.id === photoId));
  const target = pages[chapterIdx];
  if (fromIdx < 0 || !target || (target.layout !== 'summaryL' && target.layout !== 'monthL')) return { kind: 'invalid' };
  if (chapterSpan(pages, chapterIdx).includes(fromIdx)) return { kind: 'same' };
  const from = pages[fromIdx]!;
  const photo = from.photos!.find((p) => p.id === photoId)!;
  let next = pages.slice();
  const yl = yearSpread(pages, fromIdx);
  if (yl != null) next = reflow(next, yl, [...(pages[yl]!.photos ?? []), ...(pages[yl + 1]!.photos ?? [])].filter((p) => p.id !== photoId));
  else {
    next[fromIdx] = { ...from, photos: from.photos!.filter((p) => p.id !== photoId) };
    // A month it leaves closes up, so no empty pages are left inside it.
    const src = chapterStart(pages, fromIdx);
    if (src != null) next = compactMonth(next, src);
  }

  if (target.layout === 'summaryL') {
    const all = [...(next[chapterIdx]!.photos ?? []), ...(next[chapterIdx + 1]!.photos ?? [])];
    if (all.length >= YEAR_CAPACITY) return { kind: 'full' };
    return { kind: 'moved', pages: reflow(next, chapterIdx, [...all, photo]) };
  }
  // A chapter whose title isn't a month name (-1) leaves the photo's month as it was.
  const month = chapters(pages).months.find((m) => m.idx === chapterIdx)?.month ?? -1;
  const r = fileToChapter(next, chapterIdx, { ...photo, month: month >= 0 ? month : photo.month });
  return r.placed.length ? { kind: 'moved', pages: r.pages } : { kind: 'full' };
}

export type ChapterMovesResult<T> = { kind: 'moved'; pages: T[]; moved: number } | { kind: 'same' } | { kind: 'full' } | { kind: 'invalid' };

/** Moves several photos into one chapter, in order. All or nothing: a full chapter moves none. */
export function moveManyToChapter<T extends P>(pages: T[], photoIds: string[], chapterIdx: number): ChapterMovesResult<T> {
  let next = pages;
  let moved = 0;
  for (const id of photoIds) {
    const r = moveToChapter(next, id, chapterIdx);
    if (r.kind === 'full' || r.kind === 'invalid') return { kind: r.kind };
    if (r.kind === 'moved') {
      next = r.pages;
      moved++;
    }
  }
  return moved ? { kind: 'moved', pages: next, moved } : { kind: 'same' };
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
