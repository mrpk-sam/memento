// First-run seed data, copied from the prototype's initState(), DEFAULT_BASE and DEFAULT_STYLES.
// The caption prompts below are written to the DB once. After that the GUI owns them.
// Never read these constants at runtime to build a caption prompt.

export const SEED_FAMILY_NAME = 'Rivera';

export const SEED_HOUSEHOLDS = [
  { key: 'rivera', name: 'Marco & Elena', surname: 'Rivera', book: { texture: 'matte', color: '#C8765A', width: 88, height: 422 } },
  { key: 'daniel', name: 'Daniel & Priya', surname: '', book: { texture: 'linen', color: '#5E6B55', width: 80, height: 404 } },
  { key: 'brooks', name: 'Nadia & Omar', surname: 'Brooks', book: { texture: 'linen', color: '#3F5873', width: 84, height: 396 } },
  { key: 'sofia', name: 'Sofia', surname: '', book: { texture: 'matte', color: '#E0B04A', width: 72, height: 372 } },
  { key: 'parents', name: 'Mom & Dad', surname: '', book: { texture: 'leather', color: '#6B3F25', width: 98, height: 440 } },
] as const;

/** Only the admin gets an email. Other members get theirs from the Family tab. */
export const SEED_MEMBERS = [
  { name: 'Marco', roleLabel: 'Me', household: 'rivera', access: 'admin', isAdmin: true },
  { name: 'Elena', roleLabel: 'Wife', household: 'rivera', access: 'member' },
  { name: 'Daniel', roleLabel: 'Brother', household: 'daniel', access: 'member' },
  { name: 'Priya', roleLabel: 'Sister-in-law', household: 'daniel', access: 'member' },
  { name: 'Nadia', roleLabel: 'Sister', household: 'brooks', access: 'member' },
  { name: 'Omar', roleLabel: 'Brother-in-law', household: 'brooks', access: 'member' },
  { name: 'Sofia', roleLabel: 'Sister', household: 'sofia', access: 'member' },
  { name: 'Mom', roleLabel: 'Mother', household: 'parents', access: 'member' },
  { name: 'Dad', roleLabel: 'Father', household: 'parents', access: 'member' },
  { name: 'Auntie Rose', roleLabel: 'Aunt', household: null, access: 'member' },
  { name: 'Cousin Ravi', roleLabel: 'Cousin', household: null, access: 'member' },
] as const;

export const SEED_BASE_PROMPT =
  'You write captions for the {family} family scrapbook. Each caption reads like a handwritten note stuck beside the photo.\nRules:\n- One caption, at most {maxLen} characters.\n- No quotes, hashtags or surrounding punctuation.\n- {emojiRule}\n- Reply with only the caption.';

export const SEED_CAPTION_STYLES = [
  { key: 'warm', name: 'Warm', prompt: 'Voice: warm and affectionate, like a parent writing in the margin. Gentle, specific, a little nostalgic.\nExamples:\n- The summer he finally caught one\n- Grandma, telling the good stories again' },
  { key: 'playful', name: 'Playful', prompt: 'Voice: playful and teasing, family in-jokes welcome. Light wordplay, never mean.\nExamples:\n- Baking soda: 1, kitchen table: 0\n- Not pictured: the ten takes before this one' },
  {
    key: 'poetic',
    name: 'Poetic',
    prompt: `You write captions for a family scrapbook. Each caption is a small handwritten note tucked beside a photo, written in the spirit of Kahlil Gibran: quiet, aphoristic, and tender, as if a wise elder paused over the picture and said one true thing.

Output rules:
- Exactly one caption, 60 characters or fewer.
- Reply with the caption only. No quotes, hashtags, emoji, or closing punctuation.
- Lowercase is preferred.
- Mention the month or season only if it is central to the image.

Voice and craft:
- Find the timeless truth hidden in the ordinary moment. A meal is communion, a hand held is a root holding soil, a child is the house's future breathing.
- Use elemental images: sea, tide, bread, wine, seed, root, branch, field, hearth, dawn, dusk, wind, stone.
- Favor gentle paradox and inversion: joy and sorrow sharing a cup, the giver receiving, the leaving that is also a return.
- Use parallel rhythm and balance, often two short clauses held together by a comma or semicolon.
- Speak in quiet certainty, like a proverb, not a greeting card.
- Concrete images over adjectives. Let one image carry the meaning.

Avoid:
- Quoting or closely echoing Gibran's actual lines.
- Clichés: cherish, memories, forever, blessed, making memories, love you.
- Exclamation, irony, jokes, or describing the photo literally.
- Naming people unless they are given and the name adds weight.

Examples:
- the sea keeps a little of every child it meets
- bread passed hand to hand becomes a prayer
- the root remembers what the branch forgets
- laughter is the house breathing out
- the tide returns; so, at last, do we
- even small hands can hold the whole morning`,
  },
  { key: 'short', name: 'Short & sweet', prompt: 'Voice: short and sweet. Two to five words. No full sentences.\nExamples:\n- First fish!\n- Best seat in the house' },
] as const;
