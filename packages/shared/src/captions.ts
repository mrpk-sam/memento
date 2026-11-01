// Caption prompt assembly and clean-up. The prompt TEXT always comes from the
// database (settings.ai_base_prompt, caption_styles.prompt). Never hard-code it.

export interface PromptSettings {
  basePrompt: string;
  stylePrompt: string;
  /** The book's family name (its household surname), else the one in Settings. */
  familyName: string;
  /** Whose book it is, e.g. "Nadia & Omar" or "Luca". Empty when there's no book. */
  owner?: string;
  maxLen: number;
  emoji: boolean;
}

/** Replaces {family}, {owner}, {maxLen} and {emojiRule} in a prompt template. */
export function fillPrompt(template: string, s: Pick<PromptSettings, 'familyName' | 'owner' | 'maxLen' | 'emoji'>): string {
  return String(template ?? '')
    .replace(/\{family\}/g, s.familyName)
    .replace(/\{owner\}/g, s.owner?.trim() || `the ${s.familyName} family`)
    .replace(/\{maxLen\}/g, String(s.maxLen))
    .replace(/\{emojiRule\}/g, s.emoji ? 'One fitting emoji is fine.' : 'No emoji.');
}

/**
 * system = fill(base) + "\n\n" + fill(style)
 * user   = "Photo: {subject}\nContext: {context || 'the {family} family scrapbook'}" + one line per detail
 * A camera file name ("IMG 4641") says nothing, so the model is pointed at the image instead.
 */
export function buildCaptionPrompt(s: PromptSettings, subject: string, context?: string | null, details: string[] = []) {
  const what = cameraName(subject) ? 'see the image' : subject.trim() || 'see the image';
  return {
    system: `${fillPrompt(s.basePrompt, s)}\n\n${fillPrompt(s.stylePrompt, s)}`,
    user: [`Photo: ${what}`, `Context: ${context?.trim() || `the ${s.familyName} family scrapbook`}`, ...details].join('\n'),
  };
}

/** True for names cameras and phones give files ("IMG 4641", "PXL_20260101_123456", "DSC01234"). */
export function cameraName(subject: string): boolean {
  const t = subject.trim();
  if (!t) return false;
  return /^(img|dsc[nf]?|pxl|mvimg|vid|mov|gopr|dji|photo|image|screenshot|whatsapp image|signal|snapchat|fb_img|p)[\s_-]*\d[\d\s_.-]*\w{0,8}$/i.test(t) || /^[\d\s_.-]+$/.test(t) || /^[0-9a-f-]{16,}$/i.test(t);
}

export interface PhotoFacts {
  /** When the camera took it. EXIF has no time zone, so it's stored as UTC wall-clock time. */
  takenAt?: Date | string | null;
  /** The month a year-spread photo is tied to (0-11). */
  month?: number | null;
  /** The chapter's subtitle, header note and journal: what the family wrote about it. */
  notes?: (string | null | undefined)[];
  /** Set for a video: the image is a frame from it. */
  videoMs?: number | null;
  /** Captions already on nearby photos, so a new one doesn't repeat them. */
  nearby?: string[];
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** Extra lines for the caption request: everything known about the photo besides the image. */
export function captionDetails(f: PhotoFacts): string[] {
  const out: string[] = [];
  const d = f.takenAt ? new Date(f.takenAt) : null;
  if (d && !Number.isNaN(d.getTime())) {
    const h = d.getUTCHours();
    const part = h < 5 ? 'at night' : h < 12 ? 'in the morning' : h < 17 ? 'in the afternoon' : h < 21 ? 'in the evening' : 'at night';
    out.push(`Taken: ${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${part}`);
  }
  if (f.month != null && MONTH_NAMES[f.month]) out.push(`Month in the book: ${MONTH_NAMES[f.month]}`);
  const notes = (f.notes ?? []).map((n) => n?.trim() ?? '').filter(Boolean);
  if (notes.length) out.push(`What the family wrote in this chapter: ${clip(notes.join(' · ').replace(/\s+/g, ' '), 400)}`);
  if (f.videoMs) out.push(`This is a frame from a ${Math.max(1, Math.round(f.videoMs / 1000))}-second video.`);
  const nearby = (f.nearby ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 8);
  if (nearby.length) out.push(`Captions already on nearby photos (use different images and wording): ${nearby.map((c) => `"${clip(c, 80)}"`).join(' · ')}`);
  return out;
}

/** "Luca's book · July · Canada Day & the Fourth": whose book first, then where in it. */
export function captionContext(owner: string | null | undefined, where: string | null | undefined): string {
  const w = where?.trim() ?? '';
  if (!owner?.trim()) return w;
  const whose = /s$/i.test(owner.trim()) ? `${owner.trim()}' book` : `${owner.trim()}'s book`;
  return w ? `${whose} · ${w}` : whose;
}

const QUOTES = new Set(['"', "'", '“', '”', '‘', '’']);
const isSpace = (c: string) => /\s/.test(c);

/**
 * Keeps the first line, strips wrapping quotes, and trims overly long replies on a word boundary.
 * Plain loops, not regexes: the reply comes from a model, and anchored-at-end regexes
 * can take quadratic time on long runs of quotes or spaces.
 */
export function cleanCaption(raw: string, maxLen: number): string {
  let out = String(raw ?? '').trim().split('\n')[0]!.trim();
  let a = 0;
  let b = out.length;
  while (a < b && QUOTES.has(out[a]!)) a++;
  while (b > a && QUOTES.has(out[b - 1]!)) b--;
  out = out.slice(a, b).trim();
  if (out.length > maxLen + 15) {
    let cut = out.slice(0, maxLen + 12);
    // Drop the partial last word and the spaces before it, when there's a space to cut at.
    let i = cut.length;
    while (i > 0 && !isSpace(cut[i - 1]!)) i--;
    if (i > 0) {
      while (i > 0 && isSpace(cut[i - 1]!)) i--;
      cut = cut.slice(0, i);
    }
    out = cut + '…';
  }
  return out;
}
