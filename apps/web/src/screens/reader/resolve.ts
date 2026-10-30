import { MONTHS, PHOTO_HUES, STICKER_PACKS, STICKER_SPOTS, chapters, hash, nextYear, poss, yearsLabel, bookYears } from '@memento/shared';
import type { PageDto, PhotoDto, Theme } from '../../api/types';

export const CREAM: Theme = { id: 'cream', name: 'Plain cream', paper: '#FBF7EF', ink: '#3A3026', accent: '#A8643F', accent2: '#6E7F5E', motif: 'none', flags: [], stickerPack: 'none', builtin: true };

export interface RPhoto {
  id: string;
  subject: string;
  caption: string;
  src: string | null;
  full: string | null;
  hue: number;
  month: number | null;
  monthTag?: string;
  loading?: boolean;
  /** Set for a video: its MP4. src and full are then its poster frame. */
  video?: string | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface Sticker {
  text: string;
  left: number;
  top: number;
  rot: number;
  color: string;
  w: string;
  h: string;
  border: string;
  radius: string;
  bg: string;
  ls: string;
  font: string;
  size: number;
  weight: number;
}

export interface Entry {
  kicker?: string;
  title: string;
  sub: string;
  pageLabel: string;
  target: number;
  thumbs?: { hue: number; src: string | null }[];
  flagImgs?: { src: string; alt: string; w: number; left: number; top: number; rot: number }[];
  iconClass?: string;
  iconLabel?: string;
  iconColor?: string;
  tileBg?: string;
}

/** Everything ScrapbookPage needs to draw one page. */
export interface RPage {
  id: string;
  /** Position in the book, for drag and drop. */
  idx?: number;
  type: string;
  layout: string | null;
  side: 'left' | 'right';
  num: number | null;
  theme: Theme;
  owner: { name: string; poss: string; color: string; family: string };
  stickers: Sticker[];
  header: PageDto['header'];
  journal: string | null;
  text: Record<string, string>;
  photos?: RPhoto[];
  hero?: RPhoto | null;
  entries?: Entry[];
  chaptersTitle?: string;
  yearsLabel?: string;
  nextYear?: number;
}

export interface BookCtx {
  pages: PageDto[];
  themes: Theme[];
  owner: string;
  color: string;
  family: string;
  /** Photo ids uploading or getting a caption. */
  loading?: Set<string>;
}

export const blankPage = (): RPage => ({
  id: 'blank',
  type: 'blank',
  layout: null,
  side: 'right',
  num: null,
  theme: CREAM,
  owner: { name: '', poss: '', color: '#8C6A4A', family: '' },
  stickers: [],
  header: null,
  journal: null,
  text: {},
});

export const hueOf = (id: string) => PHOTO_HUES[hash(id) % PHOTO_HUES.length]!;

export function toRPhoto(p: PhotoDto): RPhoto {
  return { id: p.id, subject: p.subject, caption: p.caption, src: p.thumbUrl, full: p.displayUrl ?? p.thumbUrl, hue: hueOf(p.id), month: p.month, video: p.videoUrl, durationMs: p.durationMs, width: p.width, height: p.height };
}

export const themeOf = (themes: Theme[], id: string) => themes.find((t) => t.id === id) ?? themes[0] ?? CREAM;

/** Sticker placement, ported from stickersFor(). */
export function stickersFor(pageId: string, pack: string, side: 'left' | 'right', th: Theme): Sticker[] {
  const items = (STICKER_PACKS[pack] ?? STICKER_PACKS.none!).items;
  const spots = STICKER_SPOTS[side];
  return items.map((it, i) => {
    const r = (hash(pageId + i) % 100) / 100;
    const c = i % 2 ? th.accent2 : th.accent;
    const sp = spots[i % spots.length]!;
    const base = { text: it.t, left: sp.x, top: sp.y, rot: Math.round(r * 30 - 15), color: c, w: 'auto', h: 'auto', border: 'none', radius: '0', bg: 'transparent', ls: 'normal' };
    if (it.k === 'glyph') return { ...base, font: 'var(--font-display)', size: it.s ?? 30, weight: 400 };
    if (it.k === 'stamp') return { ...base, font: 'var(--font-ui)', size: 11, weight: 700, ls: '.14em', w: '60px', h: '60px', border: `2px solid ${c}`, radius: '50%', bg: 'rgba(255,255,255,.4)', left: sp.x - 14, top: sp.y - 16 };
    return { ...base, font: 'var(--font-script)', size: 28, weight: 700, left: sp.x - 18 };
  });
}

const MONTH_ICONS = ['snowflake', 'heart', 'clover', 'flower-tulip', 'plant', 'sun', 'fire', 'umbrella-simple', 'backpack', 'ghost', 'leaf', 'tree-evergreen'];
const FLAG_CODES: Record<string, string[]> = { dual: ['ca', 'us'], jamaica: ['jm'] };

/** Turns a stored page into renderer props. Ported from resolvePage(). */
export function resolvePage(ctx: BookCtx, idx: number, single: boolean): RPage | null {
  const pg = ctx.pages[idx];
  if (!pg) return null;
  const raw = ctx.pages;
  const th = themeOf(ctx.themes, pg.themeId);
  const side: 'left' | 'right' = single ? 'right' : idx % 2 === 0 ? 'left' : 'right';
  const titlePage = raw.find((p) => p.type === 'title');
  const out: RPage = {
    id: pg.id,
    idx,
    type: pg.type,
    layout: pg.layout,
    side,
    num: idx >= 1 && idx <= raw.length - 2 ? idx : null,
    theme: th,
    owner: { name: ctx.owner, poss: poss(ctx.owner), color: ctx.color, family: ctx.family },
    stickers: stickersFor(pg.id, pg.stickerPack, side, th),
    header: pg.header,
    journal: pg.journal,
    text: {},
  };
  const years = bookYears(raw);
  const ch = chapters(raw);
  const spreadPhotos = (a: number) => [...(raw[a]?.photos ?? []), ...(raw[a + 1]?.photos ?? [])];

  if (pg.layout) {
    out.photos = pg.photos.map((p) => {
      const r = { ...toRPhoto(p), loading: ctx.loading?.has(p.id) };
      return pg.type === 'summary' && p.month != null ? { ...r, monthTag: MONTHS[p.month]!.slice(0, 3) } : r;
    });
  }
  if (pg.type === 'title' || pg.type === 'endpaper') out.text = titlePage?.text ?? {};
  if (pg.type === 'title') {
    out.yearsLabel = yearsLabel(years);
    out.hero = pg.hero ? toRPhoto(pg.hero) : null;
  }
  if (pg.type === 'closing') out.nextYear = nextYear(raw);
  if (pg.type === 'index') {
    out.entries = ch.years.map((y) => {
      const all = spreadPhotos(y.idx);
      const n = all.length;
      return {
        kicker: String(y.year),
        title: raw[y.idx]!.header?.subtitle ?? '',
        sub: n ? `${n} photo${n > 1 ? 's' : ''}` : 'No photos yet',
        pageLabel: `p. ${y.idx}`,
        target: y.idx,
        thumbs: all.slice(0, 3).map((p) => ({ hue: hueOf(p.id), src: p.thumbUrl })),
      };
    });
  }
  if (pg.type === 'chapters') {
    // The prototype pointed at fixed pages for its demo book. Here the list is the
    // latest year's highlights plus that year's month chapters.
    const latest = years.length ? Math.max(...years) : null;
    const yc = ch.years.find((y) => y.year === latest);
    out.chaptersTitle = latest ? `${latest}, month by month` : 'Month by month';
    const list: { idx: number; t?: string; s?: string }[] = [];
    if (yc) list.push({ idx: yc.idx, t: 'The year in photos', s: 'the highlights reel' });
    for (const m of ch.months) if (m.year === latest) list.push({ idx: m.idx });
    out.entries = list.map(({ idx: i, t, s }) => {
      const p = raw[i]!;
      const pt = themeOf(ctx.themes, p.themeId);
      const fl = FLAG_CODES[pt.id] ?? [];
      const mo = MONTHS.findIndex((mn) => new RegExp(`^${mn}`, 'i').test(p.header?.title ?? ''));
      const icon = t ? 'users-three' : mo >= 0 ? MONTH_ICONS[mo]! : 'calendar-blank';
      const title = t ?? p.header?.title ?? '';
      return {
        title,
        sub: s ?? p.header?.subtitle ?? '',
        pageLabel: `p. ${i}`,
        target: i,
        flagImgs: fl.map((c, j) => ({ src: `https://flagcdn.com/w160/${c}.png`, alt: `${c.toUpperCase()} flag`, w: fl.length > 1 ? 40 : 54, left: fl.length > 1 ? j * 14 : 0, top: fl.length > 1 ? j * 14 - 4 : 5, rot: fl.length > 1 ? (j ? 5 : -6) : -4 })),
        iconClass: `ph-duotone ph-${icon}`,
        iconLabel: title,
        iconColor: pt.accent,
        tileBg: `color-mix(in srgb, ${pt.accent} 14%, #fff)`,
      };
    });
  }
  return out;
}

/** A theme preview page for the Theme library, ported from sample(). */
export function samplePage(theme: Theme, id: string, pack = 'none', family = ''): RPage {
  const caps = ['Best seat in the house', 'Round two, nobody surprised', 'Sunhats & sticky fingers', 'Mid-laugh, as usual'];
  return {
    id: `sample-${id}`,
    type: 'month',
    layout: 'monthL',
    side: 'right',
    num: null,
    theme,
    owner: { name: '', poss: '', color: '#8C6A4A', family },
    stickers: stickersFor(`sample-${id}`, pack, 'right', theme),
    header: { kicker: 'Chapter', title: 'June', subtitle: theme.name, note: '' },
    journal: null,
    text: {},
    photos: caps.map((c, i) => ({ id: `smp-${id}${i}`, subject: '', caption: c, src: null, full: null, hue: PHOTO_HUES[(i * 3 + hash(id)) % 9]!, month: null })),
  };
}
