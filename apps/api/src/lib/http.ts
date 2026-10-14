import type { ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, extra?: Record<string, unknown>) => new HttpError(400, msg, extra);
export const unauthorized = (msg = 'Please sign in') => new HttpError(401, msg);
export const forbidden = (msg = "You don't have access to that") => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

/** Validates input with Zod. Throws a 400 with the first issue as the message. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0]!;
    const path = i.path.length ? `${i.path.join('.')}: ` : '';
    throw badRequest(`${path}${i.message}`);
  }
  return r.data;
}
