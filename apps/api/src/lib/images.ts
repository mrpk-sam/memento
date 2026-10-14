import sharp from 'sharp';
import exifReader from 'exif-reader';
import heicConvert from 'heic-convert';
import { LIMITS } from '@memento/shared';
import { badRequest } from './http.js';

export interface Processed {
  orig: Buffer;
  display: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  takenAt: Date | null;
}

const isHeic = (buf: Buffer) => {
  // ISO-BMFF "ftyp" box with a HEIC-family brand.
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  return /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(buf.toString('ascii', 8, 12));
};

function takenAt(exif: Buffer | undefined): Date | null {
  if (!exif) return null;
  try {
    const d = exifReader(exif).Photo?.DateTimeOriginal;
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

/** Bigger photos are refused before decoding: 60 MP is ~180 MB of raw pixels. */
export const MAX_PIXELS = 60_000_000;
/** Formats sharp may decode. SVG, PDF and the like are refused even though libvips reads them. */
const FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'avif', 'tiff', 'gif']);
const TIMEOUT = { seconds: 30 };
const tooBig = () => badRequest('That photo is too large. Photos can be up to 60 megapixels.');

/**
 * Largest size any "ispe" (image spatial extents) box claims. heic-convert decodes in one go,
 * so the size is checked from the file before it runs.
 */
function heicPixels(buf: Buffer) {
  let max = 0;
  for (let i = buf.indexOf('ispe'); i >= 4 && i + 16 <= buf.length; i = buf.indexOf('ispe', i + 4)) {
    max = Math.max(max, buf.readUInt32BE(i + 8) * buf.readUInt32BE(i + 12));
  }
  return max;
}

/** Runs at most `n` tasks at once. The rest wait in order. */
function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    // A finished task hands its slot straight to the next one, so a new caller can't jump in.
    if (active < n) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

// Each job holds a full decode in memory, so only two run at a time.
const queue = limiter(2);

/**
 * Normalises an upload into three JPEGs: the original size, 1600px and 400px.
 * HEIC is converted first. EXIF orientation is applied to the pixels, then all
 * metadata (GPS, camera, …) is dropped: sharp strips it unless asked to keep it.
 */
export const processImage = (input: Buffer) => queue(() => normalise(input));

async function normalise(input: Buffer): Promise<Processed> {
  if (input.length > LIMITS.maxUploadBytes) throw badRequest('Photos can be up to 25 MB');
  let buf = input;
  if (isHeic(buf)) {
    if (heicPixels(buf) > MAX_PIXELS) throw tooBig();
    try {
      buf = Buffer.from(await heicConvert({ buffer: new Uint8Array(buf), format: 'JPEG', quality: 0.92 }));
    } catch {
      throw badRequest("That HEIC photo couldn't be read");
    }
  }
  const opts = { limitInputPixels: MAX_PIXELS };
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(buf, { ...opts, failOn: 'error' }).metadata();
  } catch (e) {
    if (e instanceof Error && /pixel limit/.test(e.message)) throw tooBig();
    throw badRequest("That file isn't a photo we can read");
  }
  if (!FORMATS.has(meta.format ?? '')) throw badRequest("That file isn't a photo we can use. Try JPEG, PNG, HEIC or WebP.");
  if (!meta.width || !meta.height) throw badRequest("That file isn't a photo we can read");
  if (meta.width * meta.height > MAX_PIXELS) throw tooBig();
  const when = takenAt(meta.exif);
  try {
    // Decode and rotate once, then encode the three sizes from that. The large original uses
    // plain libjpeg: mozjpeg is several times slower at 12 megapixels for little gain there.
    const upright = await sharp(buf, { ...opts, failOn: 'none' }).timeout(TIMEOUT).rotate().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    const fromRaw = () => sharp(upright.data, { ...opts, raw: upright.info }).timeout(TIMEOUT);
    const [orig, display, thumb] = await Promise.all([
      fromRaw().jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true }),
      fromRaw().resize({ width: LIMITS.displayPx, height: LIMITS.displayPx, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer(),
      fromRaw().resize({ width: LIMITS.thumbPx, height: LIMITS.thumbPx, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer(),
    ]);
    return { orig: orig.data, display, thumb, width: orig.info.width, height: orig.info.height, takenAt: when };
  } catch {
    throw badRequest("That photo couldn't be processed. Try another file.");
  }
}

/** "IMG_2044-beach_day.jpg" → "IMG 2044 beach day". The prototype's subject rule. */
export const subjectFromName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
