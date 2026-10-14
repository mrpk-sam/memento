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
  { key: 'poetic', name: 'Poetic', prompt: 'Voice: quiet and poetic. Concrete images over adjectives. Lowercase is fine.\nExamples:\n- salt air, sticky hands, the long way home\n- three generations, one very long table' },
  { key: 'short', name: 'Short & sweet', prompt: 'Voice: short and sweet. Two to five words. No full sentences.\nExamples:\n- First fish!\n- Best seat in the house' },
] as const;
