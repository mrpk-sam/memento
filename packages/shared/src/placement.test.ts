import { describe, expect, it } from 'vitest';
import { chapterList, chapterSpan, chapterStart, monthInsertAt, nextYear, type ModelPage } from './bookModel.js';
import { MONTH_CAPACITY, YEAR_CAPACITY, chapterIndex, fileToChapter, insertPhotos, moveManyToChapter, moveToChapter, placeOnSpread, reflow, setMonth, spreadsToAdd } from './placement.js';

type Ph = { id: string; month: number | null };
const ph = (id: string, month: number | null = null): Ph => ({ id, month });

/** endpaper, title, index, chapters, [2024 L/R], [July L/R], [2025 L/R], closing, backpaper */
function book(y24: Ph[] = [], jul: Ph[] = [], y25: Ph[] = []): ModelPage[] {
  const pg = (id: string, type: string, layout: string | null = null, year: number | null = null, extra = {}) => ({ id, type, layout, year, ...extra });
  return [
    pg('end', 'endpaper'),
    pg('title', 'title'),
    pg('idx', 'index'),
    pg('ch', 'chapters'),
    pg('24a', 'summary', 'summaryL', 2024, { photos: y24.slice(0, 6) }),
    pg('24b', 'summary', 'summaryR', 2024, { photos: y24.slice(6) }),
    pg('jula', 'month', 'monthL', 2024, { header: { title: 'July' }, photos: jul.slice(0, 6) }),
    pg('julb', 'month', 'monthR', 2024, { photos: jul.slice(6) }),
    pg('25a', 'summary', 'summaryL', 2025, { photos: y25.slice(0, 6) }),
    pg('25b', 'summary', 'summaryR', 2025, { photos: y25.slice(6) }),
    pg('close', 'closing'),
    pg('back', 'backpaper'),
  ];
}
const ids = (pages: ModelPage[], i: number) => (pages[i]!.photos ?? []).map((p) => p.id);
const months = (pages: ModelPage[], i: number) => (pages[i]!.photos ?? []).map((p) => p.month);

describe('reflow', () => {
  it('sorts a year by month, keeps no-month photos last, and splits 6 / 9', () => {
    const all = [ph('x'), ph('dec', 11), ph('jan', 0), ph('y'), ph('jun', 5), ph('feb', 1), ph('mar', 2), ph('apr', 3)];
    const out = reflow(book(), 4, all);
    expect(ids(out, 4)).toEqual(['jan', 'feb', 'mar', 'apr', 'jun', 'dec']);
    expect(ids(out, 5)).toEqual(['x', 'y']);
  });

  it('never keeps more than 15 photos in a year', () => {
    const all = Array.from({ length: 20 }, (_, i) => ph(`p${i}`));
    const out = reflow(book(), 4, all);
    expect(ids(out, 4).length + ids(out, 5).length).toBe(YEAR_CAPACITY);
  });

  it('does not mutate its input', () => {
    const pages = book([ph('a', 3)]);
    reflow(pages, 4, [ph('a', 3), ph('b', 1)]);
    expect(ids(pages, 4)).toEqual(['a']);
  });
});

describe('setMonth', () => {
  it('moves a photo to its month slot and re-sorts the year', () => {
    const pages = book([ph('a', 0), ph('b', 4), ph('c', null)]);
    const r = setMonth(pages, 'c', 2)!;
    expect(ids(r.pages, 4)).toEqual(['a', 'c', 'b']);
    expect(months(r.pages, 4)).toEqual([0, 2, 4]);
  });

  it('adds to a month that already has photos, after them, and removes nothing', () => {
    const pages = book([ph('a', 0), ph('b', 4), ph('c', 4), ph('d', null)]);
    const r = setMonth(pages, 'd', 4)!;
    expect(ids(r.pages, 4)).toEqual(['a', 'b', 'c', 'd']);
    expect(months(r.pages, 4)).toEqual([0, 4, 4, 4]);
  });

  it('puts a photo moved from an earlier month at the end of its new month', () => {
    const r = setMonth(book([ph('a', 0), ph('b', 4), ph('c', 4)]), 'a', 4)!;
    expect(ids(r.pages, 4)).toEqual(['b', 'c', 'a']);
  });

  it('clears the month when set to none, moving the photo to the end', () => {
    const r = setMonth(book([ph('a', 0), ph('b', 4)]), 'a', null)!;
    expect(ids(r.pages, 4)).toEqual(['b', 'a']);
  });

  it('works across both pages of the spread', () => {
    const y = Array.from({ length: 8 }, (_, i) => ph(`m${i}`, i));
    const r = setMonth(book(y), 'm7', null)!;
    expect(ids(r.pages, 5)).toEqual(['m6', 'm7']);
  });

  it('returns null for photos outside a year spread', () => {
    expect(setMonth(book([], [ph('j')]), 'j', 3)).toBeNull();
    expect(setMonth(book(), 'missing', 3)).toBeNull();
  });
});

describe('moveToChapter', () => {
  it('moves a year photo into a month chapter, gives it that month, and closes the gap', () => {
    const r = moveToChapter(book([ph('a', 0), ph('b', 6), ph('c', 8)], [ph('j1', 6)]), 'b', 6);
    if (r.kind !== 'moved') throw new Error(r.kind);
    expect(ids(r.pages, 4)).toEqual(['a', 'c']);
    // Like inbox filing: the chapter's right page first.
    expect(ids(r.pages, 7)).toEqual(['b']);
    expect(months(r.pages, 7)).toEqual([6]);
  });

  it('adds to a month chapter that already has photos', () => {
    const r = moveToChapter(book([ph('a')], [ph('j1', 6), ph('j2', 6)]), 'a', 6);
    if (r.kind !== 'moved') throw new Error(r.kind);
    expect([...ids(r.pages, 6), ...ids(r.pages, 7)]).toEqual(['j1', 'j2', 'a']);
  });

  it('moves a chapter photo back into a year in month order', () => {
    const r = moveToChapter(book([ph('a', 0), ph('c', 8)], [ph('j1', 6)]), 'j1', 4);
    if (r.kind !== 'moved') throw new Error(r.kind);
    expect(ids(r.pages, 4)).toEqual(['a', 'j1', 'c']);
    expect(ids(r.pages, 6)).toEqual([]);
  });

  it('reports a full target, the same chapter, and non-chapters', () => {
    const full = Array.from({ length: YEAR_CAPACITY }, (_, i) => ph(`y${i}`));
    expect(moveToChapter(book(full, [ph('j1', 6)]), 'j1', 4).kind).toBe('full');
    expect(moveToChapter(book([ph('a')]), 'a', 4).kind).toBe('same');
    expect(moveToChapter(book([ph('a')]), 'a', 2).kind).toBe('invalid');
  });
});

describe('insertPhotos', () => {
  it('fills pages in order up to their capacity and reports what did not fit', () => {
    const jul = [ph('j1'), ph('j2'), ph('j3'), ph('j4'), ph('j5')];
    const r = insertPhotos(book([], jul), [6, 7], [ph('n1'), ph('n2'), ph('n3')]);
    // The first month page holds 6.
    expect(ids(r.pages, 6)).toEqual(['j1', 'j2', 'j3', 'j4', 'j5', 'n1']);
    expect(ids(r.pages, 7)).toEqual(['n2', 'n3']);
    expect(r.placed).toEqual(['n1', 'n2', 'n3']);
    expect(r.left).toBe(0);
  });

  it('skips pages with no photo slots', () => {
    const r = insertPhotos(book(), [1, 2], [ph('n')]);
    expect(r.placed).toEqual([]);
    expect(r.left).toBe(1);
  });

  it('counts leftovers when the pages are full', () => {
    const full = Array.from({ length: 14 }, (_, i) => ph(`j${i}`));
    const r = insertPhotos(book([], full), [6, 7], [ph('n')]);
    expect(r.left).toBe(1);
  });
});

describe('placeOnSpread', () => {
  it('adds new photos to a year with no month, after the month-tagged ones', () => {
    const r = placeOnSpread(book([ph('a', 0), ph('b', 2)]), 4, { single: false, side: 'R' }, [ph('n1', 5), ph('n2')]);
    expect(r.kind).toBe('year');
    if (r.kind !== 'year') return;
    expect(r.added.map((p) => p.month)).toEqual([null, null]);
    expect(ids(r.pages, 4)).toEqual(['a', 'b', 'n1', 'n2']);
  });

  it('keeps the 15-photo limit and reports what did not fit', () => {
    const y = Array.from({ length: 12 }, (_, i) => ph(`m${i}`, i));
    const r = placeOnSpread(book(y), 4, { single: false }, [ph('n1'), ph('n2'), ph('n3'), ph('n4')]);
    if (r.kind !== 'year') throw new Error(r.kind);
    expect(r.added.map((p) => p.month)).toEqual([null, null, null]);
    expect(r.left).toBe(1);
  });

  it('reports a full year', () => {
    const y = Array.from({ length: 15 }, (_, i) => ph(`p${i}`, i < 12 ? i : null));
    expect(placeOnSpread(book(y), 4, { single: false }, [ph('n')]).kind).toBe('year-full');
  });

  it('finds the year spread from its right page in single-page view', () => {
    const r = placeOnSpread(book(), 5, { single: true }, [ph('n')]);
    expect(r.kind).toBe('year');
  });

  it('fills the dropped-on page first on month chapters', () => {
    const r = placeOnSpread(book(), 6, { single: false, side: 'R' }, [ph('n')]);
    if (r.kind !== 'pages') throw new Error(r.kind);
    expect(ids(r.pages, 7)).toEqual(['n']);
    expect(ids(r.pages, 6)).toEqual([]);
  });

  it('refuses spreads with no photo slots', () => {
    expect(placeOnSpread(book(), 0, { single: false }, [ph('n')]).kind).toBe('no-slots');
  });
});

describe('chapters and filing', () => {
  it('lists years and months in book order', () => {
    expect(chapterList(book()).map((c) => c.key)).toEqual(['y-2024', 'm-2024-July', 'y-2025']);
  });

  it('files an inbox photo to the chapter right page first', () => {
    const pages = book();
    const idx = chapterIndex(pages, 'm-2024-July')!;
    const r = fileToChapter(pages, idx, ph('n'));
    expect(ids(r.pages, 7)).toEqual(['n']);
  });

  it('puts new month chapters in month order inside their year', () => {
    expect(monthInsertAt(book(), 2024, 2)).toBe(6);
    expect(monthInsertAt(book(), 2024, 11)).toBe(8);
    expect(monthInsertAt(book(), 2025, 0)).toBe(10);
    expect(monthInsertAt(book(), 1999, 0)).toBeNull();
  });

  it('adds the year after the latest one', () => {
    expect(nextYear(book())).toBe(2026);
  });
});

/** The test book with `n` extra 9 + 9 spreads after July (pages 8 onwards), holding `more`. */
function grown(n: number, jul: Ph[] = [], more: Ph[] = [], y24: Ph[] = []): ModelPage[] {
  const pages = book(y24, jul);
  const extra = Array.from({ length: n * 2 }, (_, k) => ({ id: `more${k}`, type: 'month', layout: 'monthMore', year: 2024, photos: more.slice(k * 9, k * 9 + 9) }));
  return [...pages.slice(0, 8), ...extra, ...pages.slice(8)];
}
const many = (prefix: string, n: number, month: number | null = null) => Array.from({ length: n }, (_, i) => ph(`${prefix}${i}`, month));

describe('growing month chapters', () => {
  it('finds a chapter from any of its pages, extra spreads included', () => {
    const pages = grown(1);
    expect(chapterSpan(pages, 6)).toEqual([6, 7, 8, 9]);
    expect([6, 7, 8, 9].map((i) => chapterStart(pages, i))).toEqual([6, 6, 6, 6]);
    expect(chapterStart(pages, 4)).toBe(4);
    expect(chapterStart(pages, 10)).toBe(10);
    expect(chapterStart(pages, 2)).toBeNull();
  });

  it('says how many 9 + 9 spreads a month needs, and refuses past 50 or a full year', () => {
    expect(spreadsToAdd(book([], many('j', 13)), 6, 1)).toBe(0);
    expect(spreadsToAdd(book([], many('j', 14)), 6, 1)).toBe(1);
    expect(spreadsToAdd(book([], many('j', 14)), 6, 19)).toBe(2);
    expect(spreadsToAdd(grown(2, many('j', 14), many('m', 36)), 6, 1)).toBeNull();
    expect(spreadsToAdd(book([], many('j', 14)), 6, MONTH_CAPACITY - 14)).toBe(2);
    expect(spreadsToAdd(book(many('y', YEAR_CAPACITY)), 4, 1)).toBeNull();
  });

  it("carries uploads past the dropped-on spread into the month's extra pages", () => {
    const r = placeOnSpread(grown(1, many('j', 13)), 6, { single: false, side: 'L' }, many('n', 3));
    if (r.kind !== 'pages') throw new Error(r.kind);
    expect(r.placed).toHaveLength(3);
    expect(ids(r.pages, 8)).toEqual(['n1', 'n2']);
  });

  it('files inbox photos into extra pages once the first spread is full', () => {
    const r = fileToChapter(grown(1, many('j', 14)), 6, ph('n'));
    expect(ids(r.pages, 8)).toEqual(['n']);
  });

  it("moves several photos at once, and moves none if they don't all fit", () => {
    const pages = grown(1, many('j', 2, 6), [], [ph('a'), ph('b'), ph('c')]);
    const r = moveManyToChapter(pages, ['a', 'c'], 6);
    if (r.kind !== 'moved') throw new Error(r.kind);
    expect(r.moved).toBe(2);
    expect(ids(r.pages, 4)).toEqual(['b']);
    expect(months(r.pages, 7)).toEqual([6, 6]);
    expect(moveManyToChapter(grown(0, many('j', 13)), ['a', 'b'], 6).kind).toBe('invalid');
    expect(moveManyToChapter(book([ph('a'), ph('b')], many('j', 13)), ['a', 'b'], 6).kind).toBe('full');
    expect(moveManyToChapter(pages, ['j0'], 6).kind).toBe('same');
  });

  it('puts a new month chapter after a grown month', () => {
    // July spans pages 6-9, so August goes at 10.
    expect(monthInsertAt(grown(1), 2024, 7)).toBe(10);
  });
});
