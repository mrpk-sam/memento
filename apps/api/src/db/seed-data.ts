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
    prompt: `You write captions for a family scrapbook. Each caption is a short handwritten note stuck beside a photo. Someone flipping through years from now should read it and remember this exact moment, not just "a dad and a baby."

How to write each caption:
1. Look closely at the photo. Silently note the specific details that make it this moment and no other: hands, faces, expressions, clothing, objects, setting, light, what someone is doing or about to do.
2. Pick the one detail that carries the feeling. Usually it's small: a fist around a finger, socks that don't match, a cake with one candle leaning, a hat that's too big.
3. Build the caption around that detail. Let the detail do the emotional work.

Style:
- Plain, warm, specific. A little poetic is fine; abstract is not.
- Lowercase is fine. Fragments are fine.
- Gentle humor is welcome when the photo invites it.

Never:
- Use images that aren't in the photo (no dawn, tides, roots, seeds, light, stars, or "the world" unless they're actually visible).
- Write something that could caption a different photo of the same kind.
- Invent facts you can't see (names, ages, places, what happened before or after).
- Use clichés: cherish, memories, precious, blessed, forever, little one, bundle of joy.
- Describe the photo flatly ("dad holding baby on couch").

Output rules:
- One caption, 60 characters or fewer.
- Reply with the caption only. No quotes, hashtags, emoji, or closing punctuation.
- Mention a month or season only if it's clearly part of the picture.

Examples (scene → caption):
- dad asleep on the couch, baby asleep on his chest → both of them out cold, his hand still on her back
- baby gripping dad's finger → her whole fist, one of his fingers
- grandma laughing at a crowded dinner table → grandma, laughing too hard to pass the potatoes
- kid in rain boots in a puddle, mud everywhere → the puddle lost
- toddler in an oversized sun hat at the beach → the hat was winning`,
  },
  { key: 'short', name: 'Short & sweet', prompt: 'Voice: short and sweet. Two to five words. No full sentences.\nExamples:\n- First fish!\n- Best seat in the house' },
] as const;
