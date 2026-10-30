import { LIMITS } from '@memento/shared';
import { api } from '../api/client';

export interface UploadRef { id: string; name: string }

type Files = FileList | File[] | null | undefined;

/** HEIC often arrives with an empty MIME type, so the extension counts too. */
const isImageFile = (f: File) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name);

/** Some containers (MKV, MTS, …) arrive with an empty or odd MIME type, so the extension counts too. */
export const isVideoFile = (f: File) => f.type.startsWith('video/') || /\.(mp4|m4v|mov|qt|mkv|webm|avi|wmv|asf|flv|3gp|3g2|mpe?g|mts|m2ts|ogv|mxf|dv)$/i.test(f.name);

export const imageFiles = (list: Files) => Array.from(list ?? []).filter(isImageFile);

/** Photos and videos. The server converts any video format to MP4. */
export const mediaFiles = (list: Files) => Array.from(list ?? []).filter((f) => isImageFile(f) || isVideoFile(f));

/** Accept list for file pickers that take photos and videos. */
export const MEDIA_ACCEPT = 'image/*,video/*,.heic,.heif,.mkv,.mts,.m2ts,.avi,.wmv,.flv';

/** A file that wasn't added, and a sentence saying why. */
export interface Rejected { name: string; error: string }

const MB = 1024 * 1024;

/**
 * Sets aside files the server would refuse (empty, or over 25 MB for a photo and 50 MB for a
 * video), so one bad file in a batch doesn't stop the rest.
 */
export function screenFiles(files: File[]): { ok: File[]; rejected: Rejected[] } {
  const ok: File[] = [];
  const rejected: Rejected[] = [];
  for (const f of files) {
    const max = isVideoFile(f) && !isImageFile(f) ? LIMITS.maxVideoBytes : LIMITS.maxUploadBytes;
    if (!f.size) rejected.push({ name: f.name, error: `${f.name} is empty.` });
    else if (f.size > max) rejected.push({ name: f.name, error: `${f.name} is over ${max / MB} MB.` });
    else ok.push(f);
  }
  return { ok, rejected };
}

/** The most files one request for upload targets may name. */
const PER_REQUEST = 20;

export type UploadResult = { ok: true; ref: UploadRef } | { ok: false; name: string; error: string };

/**
 * Two-step upload: ask the API for PUT targets, then send each file straight there.
 * The target is either a presigned MinIO URL or a signed URL on the API.
 * Targets are asked for 20 files at a time. Each file gets its own result, in the order given.
 */
export async function uploadFiles(files: File[]): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (let at = 0; at < files.length; at += PER_REQUEST) {
    const group = files.slice(at, at + PER_REQUEST);
    const { uploads } = await api<{ uploads: { id: string; url: string; headers: Record<string, string> }[] }>('/uploads', {
      body: { files: group.map((f) => ({ name: f.name, type: f.type, size: f.size })) },
    });
    results.push(
      ...(await Promise.all(
        uploads.map(async (u, i): Promise<UploadResult> => {
          const file = group[i]!;
          try {
            const sameOrigin = u.url.startsWith('/');
            const res = await fetch(u.url, { method: 'PUT', body: file, headers: u.headers, credentials: sameOrigin ? 'same-origin' : 'omit' });
            if (!res.ok) throw new Error();
            return { ok: true, ref: { id: u.id, name: file.name } };
          } catch {
            return { ok: false, name: file.name, error: `${file.name} didn't upload. Check your connection and try again.` };
          }
        }),
      )),
    );
  }
  return results;
}
