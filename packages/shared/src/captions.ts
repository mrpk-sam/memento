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
 * user   = "Photo: {subject}\nContext: {context || 'the {family} family scrapbook'}"
 */
export function buildCaptionPrompt(s: PromptSettings, subject: string, context?: string | null) {
  return {
    system: `${fillPrompt(s.basePrompt, s)}\n\n${fillPrompt(s.stylePrompt, s)}`,
    user: `Photo: ${subject}\nContext: ${context?.trim() || `the ${s.familyName} family scrapbook`}`,
  };
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
