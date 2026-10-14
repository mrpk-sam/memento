// Design constants ported from the prototype (docs/design-handoff/design/Memento.dc.html).
// Caption prompts are NOT here: they live in the database and are edited in the GUI.

export const TEXTURES = {
  leather: { label: 'Leather', colors: ['#6B3F25', '#3E2A20', '#7A2E2A', '#2F3B2E', '#1F2A44', '#4A2C4F', '#8A5A2B', '#2A2A2A', '#5A1F2E', '#1E4040'] },
  linen: { label: 'Linen', colors: ['#5E6B55', '#3F5873', '#8A5A6A', '#B89F7A', '#9C4A3A', '#2E5E5A', '#6B5B8A', '#C9A64A', '#8C8C84', '#3A3F4A'] },
  matte: { label: 'Modern matte', colors: ['#C8765A', '#E0B04A', '#2F4858', '#8FA89A', '#D98BA0', '#6A8CC4', '#9C6BC4', '#4F9A6B', '#E07A3F', '#2B2621'] },
} as const;

export const PHOTO_HUES = [28, 48, 70, 110, 160, 200, 230, 350, 15] as const;

export interface ThemeDef {
  id: string;
  name: string;
  paper: string;
  ink: string;
  accent: string;
  accent2: string;
  motif: string;
  flags?: string[];
}

export const BUILTIN_THEMES: ThemeDef[] = [
  { id: 'cream', name: 'Plain cream', paper: '#FBF7EF', ink: '#3A3026', accent: '#A8643F', accent2: '#6E7F5E', motif: 'none' },
  { id: 'kraft', name: 'Kraft & washi', paper: '#F5EDDF', ink: '#3A3026', accent: '#C0785A', accent2: '#6F968A', motif: 'washi' },
  { id: 'dual', name: 'Canada Day & the Fourth', paper: '#FBF6EF', ink: '#2C2A33', accent: '#B8323A', accent2: '#27406B', motif: 'bunting+stars', flags: ['#B8323A', '#F3ECE2', '#27406B'] },
  { id: 'jamaica', name: 'Jamaica gold', paper: '#FAF4E2', ink: '#2A2A22', accent: '#1F7A4A', accent2: '#D9A620', motif: 'bunting+confetti', flags: ['#1F7A4A', '#E3B22B', '#1E1E1E'] },
  { id: 'winter', name: 'Winter holiday', paper: '#F4F7F4', ink: '#27332F', accent: '#2F5D50', accent2: '#B23A3A', motif: 'snow' },
  { id: 'festive', name: 'Festive', paper: '#FBF3EA', ink: '#3A2A26', accent: '#A8302F', accent2: '#2E6A4B', motif: 'stars' },
  { id: 'summer', name: 'Summer', paper: '#FFF7EA', ink: '#3A3026', accent: '#E07A3F', accent2: '#3E9BB0', motif: 'confetti' },
  { id: 'birthday', name: 'Birthday', paper: '#FDF3F2', ink: '#3A2A2E', accent: '#D2557A', accent2: '#E9A93A', motif: 'bunting+confetti', flags: ['#D2557A', '#E9A93A', '#7FB8B0', '#F3E6EA'] },
];

export interface StickerItem { t: string; k: 'glyph' | 'stamp' | 'word'; s?: number }

export const STICKER_PACKS: Record<string, { name: string; items: StickerItem[] }> = {
  none: { name: 'None', items: [] },
  hearts: { name: 'Hearts & stars', items: [{ t: '♥', k: 'glyph', s: 36 }, { t: '✿', k: 'glyph', s: 32 }, { t: '★', k: 'glyph', s: 30 }, { t: '♥', k: 'glyph', s: 24 }] },
  stamps: { name: 'Stamps', items: [{ t: 'HOME', k: 'stamp' }, { t: 'YAY!', k: 'stamp' }, { t: 'LOVE', k: 'stamp' }, { t: 'JOY', k: 'stamp' }] },
  doodles: { name: 'Doodles', items: [{ t: 'best day!', k: 'word' }, { t: '← us!', k: 'word' }, { t: '♡ ♡ ♡', k: 'word' }, { t: 'lol', k: 'word' }] },
};

export const STICKER_SPOTS = {
  left: [{ x: 14, y: 330 }, { x: 510, y: 66 }, { x: 24, y: 690 }, { x: 490, y: 694 }],
  right: [{ x: 528, y: 300 }, { x: 24, y: 66 }, { x: 504, y: 690 }, { x: 40, y: 694 }],
} as const;

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** Photo slots per page layout. */
export const LAYOUT_CAPACITY = { summaryL: 6, summaryR: 9, monthL: 6, monthR: 8 } as const;

export const PAGE_SIZE = { width: 600, height: 750 } as const;

export const BOOK_SIZE = {
  width: { min: 60, max: 110, default: 80 },
  height: { min: 340, max: 460, default: 400 },
  newMain: { w: 80, h: 392 },
  newSmall: { w: 62, h: 320 },
} as const;

export const LIMITS = {
  maxUploadBytes: 25 * 1024 * 1024,
  thumbPx: 400,
  displayPx: 1600,
  inviteDays: 7,
  unlockHours: 12,
  pinAttempts: 5,
  pinWindowMinutes: 10,
} as const;
