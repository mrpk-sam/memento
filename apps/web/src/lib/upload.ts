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

/**
 * Two-step upload: ask the API for PUT targets, then send each file straight there.
 * The target is either a presigned MinIO URL or a signed URL on the API.
 */
export async function uploadFiles(files: File[]): Promise<UploadRef[]> {
  const { uploads } = await api<{ uploads: { id: string; url: string; headers: Record<string, string> }[] }>('/uploads', {
    body: { files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })) },
  });
  await Promise.all(
    uploads.map(async (u, i) => {
      const sameOrigin = u.url.startsWith('/');
      const res = await fetch(u.url, { method: 'PUT', body: files[i], headers: u.headers, credentials: sameOrigin ? 'same-origin' : 'omit' });
      if (!res.ok) throw new Error(`Couldn't upload ${files[i]!.name}`);
    }),
  );
  return uploads.map((u, i) => ({ id: u.id, name: files[i]!.name }));
}
