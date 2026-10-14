/** Possessive as the prototype writes it: "Marco's", "James'". */
export const poss = (n: string) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);

/** Main books belong to the household. Smaller books belong to their owner (e.g. a child). */
export function bookOwnerName(book: { kind: 'main' | 'small'; ownerName: string | null }, household: { name: string } | undefined): string {
  if (book.kind === 'small') return book.ownerName?.trim() || 'Family';
  return household?.name || 'Family';
}

/** "Marco & Elena's Year in Review". The title page's script and title lines override the defaults. */
export function bookName(ownerName: string, titleText?: Record<string, string> | null): string {
  const script = titleText?.script?.trim() || poss(ownerName);
  const title = titleText?.title?.trim() || 'Year in Review';
  return `${script} ${title}`;
}

/** The surname shown on covers: the household's, else the family name from Settings. */
export const familyOf = (household: { surname: string } | undefined, familyName: string) => household?.surname?.trim() || familyName;

/** Relative luminance test the prototype uses to pick spine text colour. */
export function isLight(hex: string): boolean {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

/** Spine or cover background for a texture and colour. Ported from spineBg(). */
export function spineBg(b: { texture: string; color: string }, cover = false): string {
  const c = b.color;
  const shade = cover
    ? 'linear-gradient(90deg, rgba(0,0,0,.4) 0%, rgba(255,255,255,.1) 3%, rgba(0,0,0,.08) 7%, transparent 14%, rgba(0,0,0,.08) 100%)'
    : 'linear-gradient(90deg, rgba(0,0,0,.4) 0%, rgba(255,255,255,.15) 14%, rgba(255,255,255,.04) 42%, rgba(0,0,0,.06) 70%, rgba(0,0,0,.44) 100%)';
  if (b.texture === 'leather')
    return [shade, 'radial-gradient(ellipse at 30% 15%, rgba(255,255,255,.12), transparent 55%)', 'repeating-radial-gradient(circle at 20% 30%, rgba(0,0,0,.08) 0 1px, transparent 1px 4px)', 'repeating-radial-gradient(circle at 70% 60%, rgba(255,255,255,.04) 0 1px, transparent 1px 3px)', c].join(',');
  if (b.texture === 'linen')
    return [shade, 'repeating-linear-gradient(0deg, rgba(255,255,255,.08) 0 1px, transparent 1px 3px)', 'repeating-linear-gradient(90deg, rgba(0,0,0,.09) 0 1px, transparent 1px 3px)', c].join(',');
  return [
    cover ? shade : 'linear-gradient(90deg, rgba(0,0,0,.2), rgba(255,255,255,.07) 20%, transparent 60%, rgba(0,0,0,.22))',
    'radial-gradient(circle at 50% 20%, rgba(255,255,255,.3) 0 13px, transparent 14px)',
    'linear-gradient(160deg, transparent 0 70%, rgba(0,0,0,.14) 70% 100%)',
    'linear-gradient(24deg, rgba(255,255,255,.14) 0 16%, transparent 16%)',
    c,
  ].join(',');
}

/** Size labels from the Books tab. */
export const heightLabel = (h: number) => (h < 372 ? 'Short' : h > 424 ? 'Tall' : 'Standard');
export const widthLabel = (w: number) => (w < 74 ? 'Slim' : w > 92 ? 'Thick' : 'Regular');

export interface Orderable {
  id: string;
  householdId: string;
  kind: 'main' | 'small';
  sortOrder: number;
}

/** Shelf order: each main book, immediately followed by its household's smaller books. */
export function orderBooks<T extends Orderable>(books: T[]): T[] {
  const by = (a: T, b: T) => a.sortOrder - b.sortOrder;
  const mains = books.filter((b) => b.kind === 'main').sort(by);
  const out: T[] = [];
  for (const m of mains) {
    out.push(m);
    out.push(...books.filter((b) => b.kind === 'small' && b.householdId === m.householdId).sort(by));
  }
  // Smaller books whose household has no main book still show, at the end.
  out.push(...books.filter((b) => !out.includes(b)).sort(by));
  return out;
}

/** "2026", "2023 & 2024" (or "2023–2024" with dash), "2022–2026". */
export function yearsLabel(years: number[], dash = false): string {
  if (!years.length) return '';
  if (years.length === 1) return String(years[0]);
  if (years.length === 2 && !dash) return `${years[0]} & ${years[1]}`;
  return `${years[0]}–${years[years.length - 1]}`;
}
