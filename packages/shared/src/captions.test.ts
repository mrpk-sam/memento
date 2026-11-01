import { describe, expect, it } from 'vitest';
import { buildCaptionPrompt, cameraName, captionContext, captionDetails, cleanCaption, fillPrompt } from './captions.js';

const settings = {
  basePrompt: 'You write captions for the {family} family scrapbook.\n- At most {maxLen} characters.\n- {emojiRule}',
  stylePrompt: 'Voice: warm. Keep it under {maxLen}.',
  familyName: 'Rivera',
  maxLen: 60,
  emoji: false,
};

describe('caption prompt assembly', () => {
  it('fills every placeholder, including repeats', () => {
    expect(fillPrompt('{family}/{family} {maxLen} {emojiRule}', settings)).toBe('Rivera/Rivera 60 No emoji.');
    expect(fillPrompt('{emojiRule}', { ...settings, emoji: true })).toBe('One fitting emoji is fine.');
  });

  it('joins the filled base and style prompts with a blank line', () => {
    const p = buildCaptionPrompt(settings, 'Grandpa fishing at dawn', 'July · Canada Day & the Fourth');
    expect(p.system).toBe('You write captions for the Rivera family scrapbook.\n- At most 60 characters.\n- No emoji.\n\nVoice: warm. Keep it under 60.');
    expect(p.user).toBe('Photo: Grandpa fishing at dawn\nContext: July · Canada Day & the Fourth');
  });

  it('falls back to the family scrapbook as context', () => {
    expect(buildCaptionPrompt(settings, 'x', '').user).toBe('Photo: x\nContext: the Rivera family scrapbook');
    expect(buildCaptionPrompt(settings, 'x', '   ').user).toBe('Photo: x\nContext: the Rivera family scrapbook');
    expect(buildCaptionPrompt(settings, 'x').user).toContain('the Rivera family scrapbook');
  });

  it('uses whatever prompt text it is given, with nothing built in', () => {
    const p = buildCaptionPrompt({ ...settings, basePrompt: 'B', stylePrompt: 'S' }, 'x');
    expect(p.system).toBe('B\n\nS');
  });

  it('fills {owner} with whose book it is, or the family when there is no book', () => {
    expect(fillPrompt('For {owner}.', { ...settings, owner: 'Nadia & Omar' })).toBe('For Nadia & Omar.');
    expect(fillPrompt('For {owner}.', settings)).toBe('For the Rivera family.');
  });

  it('puts whose book it is at the front of the context', () => {
    expect(captionContext('Luca', 'July · Canada Day')).toBe("Luca's book · July · Canada Day");
    expect(captionContext('Mom & Dad', '')).toBe("Mom & Dad's book");
    expect(captionContext('James', 'x')).toBe("James' book · x");
    expect(captionContext(null, 'July')).toBe('July');
  });

  it('leaves unknown braces alone', () => {
    expect(fillPrompt('{family} {other}', settings)).toBe('Rivera {other}');
  });
});

describe('cleanCaption', () => {
  it('keeps only the first line and strips wrapping quotes', () => {
    expect(cleanCaption('"Salt air, sandy toes"\nHere is another option', 60)).toBe('Salt air, sandy toes');
    expect(cleanCaption('“Best seat in the house”', 60)).toBe('Best seat in the house');
  });

  it('trims long replies at a word boundary with an ellipsis', () => {
    const long = 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen';
    const out = cleanCaption(long, 30);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(30 + 12 + 1);
    expect(out).not.toMatch(/\s…$/);
  });

  it('leaves replies within a small margin untouched', () => {
    const s = 'x'.repeat(70);
    expect(cleanCaption(s, 60)).toBe(s);
  });

  it('matches the old regex version on random replies', () => {
    const old = (raw: string, maxLen: number) => {
      let out = raw.trim().split('\n')[0]!.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
      if (out.length > maxLen + 15) out = out.slice(0, maxLen + 12).replace(/\s+\S*$/, '') + '…';
      return out;
    };
    const chars = ['a', 'b', ' ', ' ', '"', '“', '’', '\n', '\t'];
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let i = 0; i < 2000; i++) {
      const s = Array.from({ length: rand(60) }, () => chars[rand(chars.length)]).join('');
      const max = 5 + rand(30);
      expect(cleanCaption(s, max)).toBe(old(s, max));
    }
  });

  it('stays fast on hostile replies', () => {
    const t0 = performance.now();
    cleanCaption('a' + '"'.repeat(50_000) + 'b', 60);
    cleanCaption('a' + ' '.repeat(50_000) + 'b'.repeat(100), 60);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('photo details for captions', () => {
  it('spots camera file names, and points the model at the image instead', () => {
    for (const n of ['IMG 4641', 'IMG_4641', 'PXL_20260101_123456789', 'DSC01234', 'MVIMG 2026', '20261024 160439', 'Screenshot 2026-10-24']) expect(cameraName(n), n).toBe(true);
    for (const n of ['grandma pearl 80th', 'photo of the lake', 'dock', '']) expect(cameraName(n), n).toBe(false);
    const p = buildCaptionPrompt({ basePrompt: 'b', stylePrompt: 's', familyName: 'Rivera', maxLen: 60, emoji: false }, 'IMG 4641', 'October 2026', ['Taken: x']);
    expect(p.user).toBe('Photo: see the image\nContext: October 2026\nTaken: x');
  });

  it('lists the date, month, notes, video and nearby captions', () => {
    const lines = captionDetails({
      takenAt: '2026-10-24T16:04:39.000Z',
      month: 9,
      notes: ['', 'Leaf season', null, 'First time in the leaves'],
      videoMs: 12_400,
      nearby: ['her whole fist, one of his fingers', ' '],
    });
    expect(lines).toEqual([
      'Taken: Saturday 24 October 2026, in the afternoon',
      'Month in the book: October',
      'What the family wrote in this chapter: Leaf season · First time in the leaves',
      'This is a frame from a 12-second video.',
      'Captions already on nearby photos (use different images and wording): "her whole fist, one of his fingers"',
    ]);
    expect(captionDetails({})).toEqual([]);
  });
});
