import { LIMITS } from '@memento/shared';
import { badRequest } from './http.js';
import type { Storage } from './s3.js';

/** Temp objects the browser PUTs before a photo is processed. */
export const uploadKey = (userId: string, id: string) => `uploads/${userId}/${id}`;

/** Unprocessed uploads one person can have open at once. */
export const MAX_OPEN_UPLOADS = 100;

// Upload URLs handed out and not yet expired or used, per user. A URL counts as open before
// its file arrives, so asking for URLs in a loop can't get around the cap.
const issued = new Map<string, Map<string, number>>();

export function noteIssued(userId: string, id: string, expiresAt: number) {
  const mine = issued.get(userId) ?? new Map<string, number>();
  mine.set(id, expiresAt);
  issued.set(userId, mine);
}

/** Live upload URLs plus files waiting in storage. */
export async function openUploads(storage: Storage, userId: string) {
  const now = Date.now();
  const mine = issued.get(userId);
  for (const [id, exp] of mine ?? []) if (exp < now) mine!.delete(id);
  if (mine && !mine.size) issued.delete(userId);
  const ids = new Set(mine?.keys());
  for (const o of await storage.list(uploadKey(userId, ''))) ids.add(o.key.slice(o.key.lastIndexOf('/') + 1));
  return ids.size;
}

/**
 * What the browser may declare. HEIC and some video containers often arrive with no type at all,
 * so empty is allowed; processMedia checks the real format either way. Any video type is allowed,
 * since ffmpeg converts whatever it can read.
 */
const TYPES = new Set(['image/jpeg', 'image/pjpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence', 'image/avif', 'image/tiff', 'image/gif']);
export const isAllowedType = (type: string) => !type || TYPES.has(type.toLowerCase()) || /^video\//i.test(type);

/** The size cap for a declared type. An unknown type might be a video, so it gets the larger cap. */
export const maxBytesFor = (type: string) => (/^image\//i.test(type) ? LIMITS.maxUploadBytes : LIMITS.maxVideoBytes);

/**
 * Reads an upload. The size comes from storage, not from the client: a presigned PUT or a
 * proxy could let a bigger object through, and get() reads the whole thing into memory.
 */
export async function readUpload(storage: Storage, userId: string, id: string, photoOnly = false): Promise<Buffer> {
  issued.get(userId)?.delete(id);
  const key = uploadKey(userId, id);
  const { size } = await storage.head(key);
  // Otherwise photos are held to 25 MB once their format is known (processImage).
  if (size > (photoOnly ? LIMITS.maxUploadBytes : LIMITS.maxVideoBytes)) {
    await storage.delete(key).catch(() => {});
    throw badRequest(photoOnly ? 'Photos can be up to 25 MB' : 'Videos can be up to 50 MB and photos up to 25 MB');
  }
  return storage.get(key);
}

/** A per-file message for a failed upload. */
export const uploadError = (e: unknown) => (e instanceof Error && !/NoSuchKey|NotFound/.test(e.name) ? e.message : 'Upload not found');
