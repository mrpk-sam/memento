import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { MAX_PIXELS, processImage, subjectFromName } from './images.js';

async function jpegWithExif(width: number, height: number, orientation: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 80 } } })
    .jpeg()
    .withMetadata({ orientation, exif: { IFD0: { Make: 'TestCam', Model: 'X1' } } })
    .toBuffer();
}

describe('processImage', () => {
  it('makes 1600px and 400px sizes without enlarging', async () => {
    const out = await processImage(await jpegWithExif(3000, 2000, 1));
    const d = await sharp(out.display).metadata();
    const t = await sharp(out.thumb).metadata();
    expect([d.width, d.height]).toEqual([1600, 1067]);
    expect([t.width, t.height]).toEqual([400, 267]);
    expect([out.width, out.height]).toEqual([3000, 2000]);
    const small = await processImage(await jpegWithExif(300, 200, 1));
    expect((await sharp(small.display).metadata()).width).toBe(300);
  });

  it('applies EXIF orientation to the pixels, then strips all metadata', async () => {
    // Orientation 6 = rotate 90° clockwise, so a landscape file displays as portrait.
    const out = await processImage(await jpegWithExif(400, 200, 6));
    const m = await sharp(out.orig).metadata();
    expect([m.width, m.height]).toEqual([200, 400]);
    expect(m.orientation).toBeUndefined();
    expect(m.exif).toBeUndefined();
  });

  it('converts PNG to JPEG', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#fff' } }).png().toBuffer();
    expect((await sharp((await processImage(png)).thumb).metadata()).format).toBe('jpeg');
  });

  it('rejects files that are not images', async () => {
    await expect(processImage(Buffer.from('not an image'))).rejects.toThrow(/isn't a photo/);
  });

  it('refuses SVG even though sharp could read it', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    await expect(processImage(svg)).rejects.toThrow(/isn't a photo we can use/);
  });

  it('still reads GIF', async () => {
    const gif = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#09f' } }).gif().toBuffer();
    expect((await processImage(gif)).width).toBe(20);
  });

  it('refuses photos over the pixel cap before decoding them', async () => {
    // 64 MP of one colour compresses to a small file, which is the attack this stops.
    const png = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: '#fff' } }).png({ compressionLevel: 1 }).toBuffer();
    expect(8000 * 8000).toBeGreaterThan(MAX_PIXELS);
    await expect(processImage(png)).rejects.toThrow(/too large/);
  });

  it('checks HEIC dimensions before converting', async () => {
    // ftyp "heic" box, then an ispe box claiming 10000 × 10000.
    const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypheic'), Buffer.alloc(4)]);
    const ispe = Buffer.alloc(20);
    ispe.writeUInt32BE(20, 0);
    ispe.write('ispe', 4, 'ascii');
    ispe.writeUInt32BE(10_000, 12);
    ispe.writeUInt32BE(10_000, 16);
    await expect(processImage(Buffer.concat([ftyp, ispe]))).rejects.toThrow(/too large/);
  });
});

describe('subjectFromName', () => {
  it('drops the extension and turns dashes and underscores into spaces', () => {
    expect(subjectFromName('grandpa_fishing-at-dawn.HEIC')).toBe('grandpa fishing at dawn');
  });
});
