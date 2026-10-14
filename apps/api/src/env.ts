import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const optional = z.string().optional().transform((v) => (v ? v : undefined));
/**
 * How many proxies (or which proxy addresses) to trust for X-Forwarded-For.
 * "true" means one proxy. Trusting every hop would let clients pick their own address
 * and dodge the rate limits.
 */
const trustProxy = z
  .string()
  .default('false')
  .transform((v): boolean | number | string => {
    const t = v.trim();
    if (t === 'false' || t === '' || t === '0') return false;
    if (t === 'true') return 1;
    if (/^\d+$/.test(t)) return Number(t);
    return t;
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  APP_URL: z.string().url(),
  TRUST_PROXY: trustProxy,

  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(3).default('memento'),
  S3_FORCE_PATH_STYLE: bool.default(true),
  /** Endpoint the browser uses for presigned URLs. Defaults to S3_ENDPOINT. */
  S3_PUBLIC_ENDPOINT: optional,

  SESSION_SECRET: z.string().min(32),
  /** 32 bytes, base64. Encrypts the AI API key at rest. */
  ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64'),

  ADMIN_EMAIL: z.string().email(),

  // SMTP is optional. Without SMTP_HOST, emails are logged to the console.
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  SMTP_FROM: z.string().default('Memento <memento@localhost>'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** `fresh` parses again without touching the cache (tests). */
export function env(opts: { fresh?: boolean } = {}): Env {
  if (cached && !opts.fresh) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment. Check .env against .env.example:\n${lines.join('\n')}`);
  }
  if (opts.fresh) return parsed.data;
  cached = parsed.data;
  return cached;
}
