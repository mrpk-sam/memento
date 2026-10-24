import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { makeClip, run } from '../test/video.js';
import { processMedia, processVideo } from './videos.js';

let dir: string;

async function probe(buf: Buffer) {
  const f = join(dir, `probe-${Math.random()}`);
  await writeFile(f, buf);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f]);
  return JSON.parse(stdout) as { format: { format_name: string; tags?: Record<string, string> }; streams: { codec_type: string; codec_name: string; width?: number; height?: number }[] };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memento-video-test-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('processVideo', () => {
  it('converts other formats to H.264 + AAC MP4 with a poster frame', async () => {
    const avi = await makeClip('a.avi', ['-c:v', 'mpeg4', '-c:a', 'mp2']);
    const out = await processVideo(avi);
    const p = await probe(out.video!);
    expect(p.format.format_name).toMatch(/mp4/);
    expect(p.streams.map((s) => s.codec_name).sort()).toEqual(['aac', 'h264']);
    expect([out.width, out.height]).toEqual([640, 360]);
    expect((await sharp(out.thumb).metadata()).format).toBe('jpeg');
    expect(out.durationMs).toBeGreaterThan(2500);
  });

  it('rewraps H.264 + AAC without re-encoding and drops metadata', async () => {
    const mkv = await makeClip('b.mkv', ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', 'location=+48.85+002.35/', '-metadata', 'creation_time=2025-07-04T12:00:00Z']);
    const out = await processVideo(mkv);
    const p = await probe(out.video!);
    expect(p.format.format_name).toMatch(/mp4/);
    expect(p.format.tags?.location).toBeUndefined();
    expect(out.takenAt?.toISOString()).toBe('2025-07-04T12:00:00.000Z');
  });

  it('scales the long edge down to 1920px', async () => {
    const big = join(dir, 'big.webm');
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=2560x1440:rate=5:duration=1', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', big]);
    const out = await processVideo(await readFile(big));
    const v = (await probe(out.video!)).streams.find((s) => s.codec_type === 'video')!;
    expect([v.width, v.height]).toEqual([1920, 1080]);
  });

  it('refuses playlists, which could point ffmpeg at other files', async () => {
    const m3u8 = Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:///etc/hostname\n#EXT-X-ENDLIST\n');
    await expect(processVideo(m3u8)).rejects.toThrow(/isn't a photo or video/);
  });
});

describe('processMedia', () => {
  it('tells photos and videos apart by their contents', async () => {
    const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c87' } }).jpeg().toBuffer();
    expect((await processMedia(jpeg)).video).toBeNull();
    const mp4 = await makeClip('c.mp4', ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac'], 1);
    expect((await processMedia(mp4)).video).not.toBeNull();
    await expect(processMedia(Buffer.from('not media'))).rejects.toThrow(/isn't a photo or video/);
  });
});
