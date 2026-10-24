import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LIMITS } from '@memento/shared';
import { badRequest } from './http.js';
import { MAX_PIXELS, isImage, limiter, processImage, type Processed } from './images.js';

const run = promisify(execFile);

/** A processed upload. Videos also carry their MP4; the JPEGs are then the poster frame. */
export interface Media extends Processed {
  video: Buffer | null;
  durationMs: number | null;
}

/**
 * Containers ffmpeg may open. Playlists (HLS, concat) and the like can point at other files,
 * so they are refused before anything is decoded.
 */
const DEMUXERS = 'mov,matroska,avi,mpegts,mpeg,flv,asf,ogg,mxf,dv,rm';
/** Longest edge of the MP4 that is stored and played. */
const MAX_EDGE = 1920;
const PROBE_TIMEOUT = 20_000;
const TRANSCODE_TIMEOUT = 5 * 60_000;

interface Probe {
  format?: { format_name?: string; duration?: string; tags?: Record<string, string> };
  streams?: { codec_type?: string; codec_name?: string; pix_fmt?: string; width?: number; height?: number; disposition?: { attached_pic?: number }; tags?: Record<string, string> }[];
}

const ffmpeg = (args: string[], timeout: number) => run('ffmpeg', ['-v', 'error', '-nostdin', ...args], { timeout, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });

async function probe(file: string): Promise<Probe> {
  try {
    const { stdout } = await run(
      'ffprobe',
      ['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', DEMUXERS, '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: PROBE_TIMEOUT, killSignal: 'SIGKILL' },
    );
    return JSON.parse(stdout) as Probe;
  } catch {
    throw badRequest("That file isn't a photo or video we can use");
  }
}

/** The recording date most phones write. Zero dates (1904, 1970) count as missing. */
function recordedAt(p: Probe): Date | null {
  const raw = p.format?.tags?.creation_time ?? p.streams?.find((s) => s.tags?.creation_time)?.tags?.creation_time;
  const d = raw ? new Date(raw) : null;
  return d && !isNaN(d.getTime()) && d.getUTCFullYear() > 1971 ? d : null;
}

// A transcode uses every core, so only one runs at a time.
const queue = limiter(1);

/**
 * Turns any video ffmpeg can read into an MP4 every browser plays (H.264 + AAC, at most
 * 1920px on the long edge, moov atom first so playback starts before the download ends).
 * Files that are already H.264 + AAC at that size are only rewrapped, which takes a moment.
 * All metadata (GPS, device, …) is dropped. The poster frame becomes the usual three JPEGs.
 */
export const processVideo = (input: Buffer) => queue(() => normalise(input));

async function normalise(input: Buffer): Promise<Media> {
  if (input.length > LIMITS.maxVideoBytes) throw badRequest('Videos can be up to 50 MB');
  const dir = await mkdtemp(join(tmpdir(), 'memento-video-'));
  try {
    const src = join(dir, 'in');
    const out = join(dir, 'out.mp4');
    const poster = join(dir, 'poster.png');
    await writeFile(src, input);
    const info = await probe(src);
    const v = info.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
    const a = info.streams?.find((s) => s.codec_type === 'audio');
    if (!v?.width || !v.height) throw badRequest("That file isn't a photo or video we can use");
    if (v.width * v.height > MAX_PIXELS) throw badRequest('That video is too large to play');
    const durationMs = Math.round(Number(info.format?.duration ?? 0) * 1000) || null;

    const fits = Math.max(v.width, v.height) <= MAX_EDGE;
    const copy = v.codec_name === 'h264' && v.pix_fmt === 'yuv420p' && fits && (!a || a.codec_name === 'aac');
    // Scale after ffmpeg's auto-rotate, so the long edge is measured upright. Sizes stay even for yuv420p.
    const scale = `scale='if(gte(iw,ih),trunc(min(${MAX_EDGE},iw)/2)*2,-2)':'if(gte(iw,ih),-2,trunc(min(${MAX_EDGE},ih)/2)*2)',format=yuv420p`;
    const codecs = copy
      ? ['-c', 'copy']
      : ['-vf', scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-ac', '2'];
    try {
      await ffmpeg(
        ['-protocol_whitelist', 'file', '-format_whitelist', DEMUXERS, '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn', ...codecs, '-movflags', '+faststart', '-f', 'mp4', out],
        TRANSCODE_TIMEOUT,
      );
    } catch (e) {
      if ((e as { killed?: boolean }).killed) throw badRequest('That video took too long to process. Try a shorter clip.');
      throw badRequest("That video couldn't be processed. Try another file.");
    }

    // Poster: a frame a second in, past any fade from black. Very short clips use the first frame.
    const at = durationMs && durationMs > 2000 ? '1' : '0';
    try {
      await ffmpeg(['-protocol_whitelist', 'file', '-ss', at, '-i', out, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', poster], PROBE_TIMEOUT);
    } catch {
      throw badRequest("That video couldn't be processed. Try another file.");
    }
    const frame = await processImage(await readFile(poster));
    return { ...frame, takenAt: recordedAt(info), video: await readFile(out), durationMs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A photo or a video, told apart by the file's contents rather than its name or declared type. */
export async function processMedia(input: Buffer): Promise<Media> {
  if (await isImage(input)) return { ...(await processImage(input)), video: null, durationMs: null };
  return processVideo(input);
}
