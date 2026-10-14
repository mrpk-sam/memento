import { describe, expect, it } from 'vitest';
import type { ModelPage } from './bookModel.js';
import { movePhoto, stepTarget } from './placement.js';

type Ph = { id: string; month: number | null };
const ph = (id: string, month: number | null = null): Ph => ({ id, month });
const pg = (id: string, type: string, layout: string | null, photos?: Ph[]): ModelPage => ({ id, type, layout, year: 2026, header: null, photos });
const ids = (pages: ModelPage[], i: number) => (pages[i]!.photos ?? []).map((p) => p.id);

/** 0 title, 1 index, [2 summaryL, 3 summaryR], [4 monthL (cap 6), 5 monthR (cap 8)] */
function book(y: Ph[], mL: Ph[], mR: Ph[]) {
  return [pg('t', 'title', null), pg('i', 'index', null), pg('yl', 'summary', 'summaryL', y.slice(0, 6)), pg('yr', 'summary', 'summaryR', y.slice(6)), pg('ml', 'month', 'monthL', mL), pg('mr', 'month', 'monthR', mR)];
}

describe('movePhoto on month chapters', () => {
  it('reorders within a page', () => {
    const r = movePhoto(book([], [ph('a'), ph('b'), ph('c')], []), 'a', 4, 3);
    if (r.kind !== 'moved') throw new Error(r.kind);
    expect(ids(r.pages, 4)).toEqual(['b', 'c', 'a']);
  });

  it('moves to the other page of the spread', () => {
    const r = movePhoto(book([], [ph('a'), ph('b')], [ph('x')]), 'b', 5, 0);
    if (r.kind !== 'moved') throw new Error(r.kind);
    expect(ids(r.pages, 4)).toEqual(['a']);
    expect(ids(r.pages, 5)).toEqual(['b', 'x']);
  });

  it('swaps when the target page is full', () => {
    const r = movePhoto(book([], [ph('a'), ph('b'), ph('c'), ph('d'), ph('e'), ph('f')], [ph('x')]), 'x', 4, 1);
    if (r.kind !== 'moved') throw new Error(r.kind);
    expect(ids(r.pages, 4)).toEqual(['a', 'x', 'c', 'd', 'e', 'f']);
    expect(ids(r.pages, 5)).toEqual(['b']);
  });

  it('reports no change and refuses pages without slots', () => {
    expect(movePhoto(book([], [ph('a'), ph('b')], []), 'a', 4, 0).kind).toBe('unchanged');
    expect(movePhoto(book([], [ph('a')], []), 'a', 1, 0).kind).toBe('invalid');
  });
});

describe('movePhoto on a year spread', () => {
  it('rearranges photos with no month freely, across both pages', () => {
    const y = [ph('jan', 0), ph('n1'), ph('n2'), ph('n3'), ph('n4'), ph('n5'), ph('n6'), ph('n7')];
    const r = movePhoto(book(y, [], []), 'n7', 2, 1);
    if (r.kind !== 'moved') throw new Error(r.kind);
    // The January photo stays first; n7 now leads the no-month photos.
    expect(ids(r.pages, 2)).toEqual(['jan', 'n7', 'n1', 'n2', 'n3', 'n4']);
    expect(ids(r.pages, 3)).toEqual(['n5', 'n6']);
  });

  it('keeps month order, and says so when a dated photo is dragged out of it', () => {
    const y = [ph('jan', 0), ph('mar', 2), ph('n1')];
    expect(movePhoto(book(y, [], []), 'mar', 2, 0).kind).toBe('month-order');
    expect(movePhoto(book(y, [], []), 'n1', 2, 0).kind).toBe('month-order');
  });
});

describe('stepTarget', () => {
  const pages = book([], [ph('a'), ph('b')], [ph('x'), ph('y')]);
  it('steps within a page and across to the other page', () => {
    expect(stepTarget(pages, [4, 5], 'b', -1)).toEqual({ toIdx: 4, position: 0 });
    expect(stepTarget(pages, [4, 5], 'x', 1)).toEqual({ toIdx: 5, position: 2 });
    expect(stepTarget(pages, [4, 5], 'a', 1)).toEqual({ toIdx: 4, position: 2 });
    expect(stepTarget(pages, [4, 5], 'b', 1)).toEqual({ toIdx: 5, position: 0 });
    expect(stepTarget(pages, [4, 5], 'x', -1)).toEqual({ toIdx: 4, position: 2 });
    expect(stepTarget(pages, [4, 5], 'a', -1)).toBeNull();
    expect(stepTarget(pages, [4, 5], 'y', 1)).toBeNull();
  });

  it('turns into a real move', () => {
    const t = stepTarget(pages, [4, 5], 'b', 1)!;
    const r = movePhoto(pages, 'b', t.toIdx, t.position);
    if (r.kind !== 'moved') throw new Error(r.kind);
    expect(ids(r.pages, 4)).toEqual(['a']);
    expect(ids(r.pages, 5)).toEqual(['b', 'x', 'y']);
    const back = stepTarget(r.pages, [4, 5], 'b', -1)!;
    const r2 = movePhoto(r.pages, 'b', back.toIdx, back.position);
    if (r2.kind !== 'moved') throw new Error(r2.kind);
    expect(ids(r2.pages, 4)).toEqual(['a', 'b']);
  });
});
