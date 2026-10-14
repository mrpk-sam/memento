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

/** Keeps the first line, strips wrapping quotes, and trims overly long replies on a word boundary. */
export function cleanCaption(raw: string, maxLen: number): string {
  let out = String(raw ?? '').trim().split('\n')[0]!.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (out.length > maxLen + 15) out = out.slice(0, maxLen + 12).replace(/\s+\S*$/, '') + '…';
  return out;
}
