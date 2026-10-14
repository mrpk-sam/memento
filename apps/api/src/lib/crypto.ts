import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** URL-safe random token for cookies, invites and magic links. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** AES-256-GCM. Output: iv.tag.ciphertext, each base64. */
export function encrypt(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string, keyB64: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  if (!iv || !tag || !data || iv.length !== 12 || tag.length !== 16) throw new Error('Malformed ciphertext');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv, { authTagLength: 16 });
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

/** Masks a secret as first 8 chars + •••••••• + last 4, as the AI tab shows it. */
export function maskKey(key: string): string {
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 8)}••••••••${key.slice(-4)}`;
}
