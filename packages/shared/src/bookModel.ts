import { LAYOUT_CAPACITY, MONTHS } from './constants.js';

/** The minimum a page needs for navigation and placement logic. */
export interface ModelPage {
  id: string;
  type: string;
  layout: string | null;
  year: number | null;
  header?: { kicker?: string; title?: string; subtitle?: string; note?: string } | null;
  photos?: ModelPhoto[];
}

export interface ModelPhoto {
  id: string;
  month: number | null;
}

export interface YearChapter { year: number; idx: number }
export interface MonthChapter { year: number; idx: number; month: number; label: string; short: string }

/** Year blocks (summary spreads) and month chapters, by page index. Ported from chapters(). */
export function chapters(pages: ModelPage[]) {
  const years: YearChapter[] = [];
  const months: MonthChapter[] = [];
  pages.forEach((pg, idx) => {
    if (pg.year == null) return;
    if (pg.layout === 'summaryL') years.push({ year: pg.year, idx });
    else if (pg.layout === 'monthL') {
      const label = pg.header?.title || '';
      const month = MONTHS.findIndex((m) => new RegExp(`^${m}`, 'i').test(label));
      months.push({ year: pg.year, idx, month, label, short: label.length <= 4 ? label : label.slice(0, 3) });
    }
  });
  return { years, months };
}

/** Flat chapter list for jump chips and the inbox's chapter select. */
export function chapterList(pages: ModelPage[]) {
  const c = chapters(pages);
  return [
    ...c.years.map((y) => ({ key: `y-${y.year}`, idx: y.idx, name: `${y.year} in photos` })),
    ...c.months.map((m) => ({ key: `m-${m.year}-${m.label}`, idx: m.idx, name: `${m.label} ${m.year}` })),
  ].sort((a, b) => a.idx - b.idx);
}

export const bookYears = (pages: ModelPage[]) => chapters(pages).years.map((y) => y.year);

export function nextYear(pages: ModelPage[]): number {
  const ys = bookYears(pages);
  return ys.length ? Math.max(...ys) + 1 : new Date().getFullYear();
}

/** Index where a new year block goes: just before the closing page. */
export function yearInsertAt(pages: ModelPage[]): number {
  const at = pages.findIndex((p) => p.type === 'closing');
  return at < 0 ? pages.length : at;
}

/**
 * Index where a month chapter goes: after its year's summary spread and any
 * earlier months of that year, before the next year block.
 */
export function monthInsertAt(pages: ModelPage[], year: number, month: number): number | null {
  const c = chapters(pages);
  const y = c.years.find((x) => x.year === year);
  if (!y) return null;
  let at = y.idx + 2;
  for (const m of c.months) if (m.year === year && m.month < month && m.idx + 2 > at) at = m.idx + 2;
  return at;
}

export function hasMonthChapter(pages: ModelPage[], year: number, month: number) {
  return chapters(pages).months.some((m) => m.year === year && m.month === month);
}

/** Pages for a new year block. Matches the prototype's addYear(). */
export function yearBlockPages(year: number) {
  const label = `${year} in photos`;
  return [
    { type: 'summary', layout: 'summaryL', themeId: 'kraft', stickerPack: 'none', label, year, header: { kicker: 'Year in photos', title: String(year), subtitle: 'A year still being written' }, journal: null },
    { type: 'summary', layout: 'summaryR', themeId: 'kraft', stickerPack: 'none', label, year, header: null, journal: null },
  ];
}

/** Pages for a new month chapter, shaped like the prototype's July/August/December chapters. */
export function monthChapterPages(year: number, month: number) {
  const name = MONTHS[month]!;
  return [
    { type: 'month', layout: 'monthL', themeId: 'cream', stickerPack: 'none', label: name, year, header: { kicker: `Chapter · ${name} ${year}`, title: name, subtitle: '', note: '' }, journal: null },
    { type: 'month', layout: 'monthR', themeId: 'cream', stickerPack: 'none', label: name, year, header: null, journal: '' },
  ];
}

export const capacity = (pg: Pick<ModelPage, 'layout'>) => LAYOUT_CAPACITY[pg.layout as keyof typeof LAYOUT_CAPACITY] ?? 0;
export const hasSlots = (pg: ModelPage | undefined) => !!pg && capacity(pg) > 0;

/** The left index of the year summary spread that page i belongs to, or null. */
export function yearSpread(pages: ModelPage[], i: number): number | null {
  const pg = pages[i];
  if (!pg || pg.type !== 'summary') return null;
  return pg.layout === 'summaryR' ? i - 1 : i;
}
