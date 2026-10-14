import { api } from '../api/client';

export interface UploadRef { id: string; name: string }

/** Image files only. HEIC often arrives with an empty MIME type, so the extension counts too. */
export const imageFiles = (list: FileList | File[] | null | undefined) =>
  Array.from(list ?? []).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));

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
