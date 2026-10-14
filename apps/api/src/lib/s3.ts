import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../env.js';

export type ObjectVariant = 'orig' | '1600' | '400';

/** books/{bookId}/{photoId}/{orig|1600|400}.jpg */
export const photoKey = (bookId: string, photoId: string, v: ObjectVariant) => `books/${bookId}/${photoId}/${v}.jpg`;
export const inboxKey = (itemId: string, v: ObjectVariant) => `inbox/${itemId}/${v}.jpg`;

export function createStorage(e: Env) {
  const base = { region: e.S3_REGION, forcePathStyle: e.S3_FORCE_PATH_STYLE, credentials: { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY } };
  const client = new S3Client({ ...base, endpoint: e.S3_ENDPOINT });
  // Presigned URLs must be signed for the host the browser will call. Without WHEN_REQUIRED the
  // SDK adds a checksum of the (empty) presign-time body, which the real upload can't match.
  const signer = new S3Client({ ...base, endpoint: e.S3_PUBLIC_ENDPOINT ?? e.S3_ENDPOINT, requestChecksumCalculation: 'WHEN_REQUIRED' });
  const Bucket = e.S3_BUCKET;

  return {
    client,
    bucket: Bucket,
    /** Creates the bucket if missing. The bucket stays private (no policy is attached). */
    async ensureBucket(): Promise<'exists' | 'created'> {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
        return 'exists';
      } catch (err: unknown) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status !== 404) throw err;
        await client.send(new CreateBucketCommand({ Bucket }));
        return 'created';
      }
    },
    /** A PUT URL bound to one exact size: Content-Length is a signed header, so a bigger body fails. */
    presignPut: (Key: string, contentType: string, size: number, expiresIn = 600) =>
      getSignedUrl(signer, new PutObjectCommand({ Bucket, Key, ContentType: contentType, ContentLength: size }), { expiresIn }),
    presignGet: (Key: string, expiresIn = 3600) => getSignedUrl(signer, new GetObjectCommand({ Bucket, Key }), { expiresIn }),
    async put(Key: string, Body: Buffer, ContentType = 'image/jpeg') {
      await client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType }));
    },
    async get(Key: string): Promise<Buffer> {
      const res = await client.send(new GetObjectCommand({ Bucket, Key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    /** An object's size without reading it. A missing object throws (name NotFound). */
    async head(Key: string): Promise<{ size: number }> {
      const res = await client.send(new HeadObjectCommand({ Bucket, Key }));
      return { size: res.ContentLength ?? 0 };
    },
    /** Streams an object for the media proxy. */
    async stream(Key: string) {
      const res = await client.send(new GetObjectCommand({ Bucket, Key }));
      return { body: res.Body as NodeJS.ReadableStream, contentType: res.ContentType ?? 'image/jpeg', length: res.ContentLength };
    },
    /** Every object under a prefix, with its last-modified time. */
    async list(Prefix: string) {
      const out: { key: string; lastModified: Date }[] = [];
      let ContinuationToken: string | undefined;
      do {
        const res = await client.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
        for (const o of res.Contents ?? []) if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified ?? new Date(0) });
        ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return out;
    },
    async delete(Key: string) {
      await client.send(new DeleteObjectCommand({ Bucket, Key }));
    },
    async copy(from: string, to: string) {
      await client.send(new CopyObjectCommand({ Bucket, Key: to, CopySource: `${Bucket}/${from}` }));
    },
  };
}

export type Storage = ReturnType<typeof createStorage>;
