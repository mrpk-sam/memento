import type { ZodType, z } from 'zod';

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

/** What a field is called in a message, by its key. Anything else is "This". */
const FIELD: Record<string, string> = {
  caption: 'A caption',
  subject: 'The description',
  journal: 'The journal',
  name: 'The name',
  roleLabel: 'The role',
  familyName: 'The family name',
  surname: 'The surname',
  note: 'The note',
  spineText: 'The spine text',
  ownerName: 'The name',
  title: 'The title',
  kicker: 'The heading',
  subtitle: 'The subtitle',
  basePrompt: 'The base instructions',
  prompt: 'The prompt',
  email: 'The email',
};

/** A sentence for a person, from a Zod issue. Messages written in the schemas are kept as they are. */
function message(i: z.core.$ZodIssue) {
  if (!/^(Too big|Too small|Invalid)/.test(i.message)) return i.message;
  const key = [...i.path].reverse().find((k) => typeof k === 'string') as string | undefined;
  const what = (key && FIELD[key]) || 'This';
  const n = 'maximum' in i ? Number(i.maximum) : 'minimum' in i ? Number(i.minimum) : 0;
  if (i.code === 'too_big' && i.origin === 'string') return `${what} can be up to ${n} characters.`;
  if (i.code === 'too_big' && i.origin === 'array') return `That's too many at once. The most is ${n}.`;
  if (i.code === 'too_small' && i.origin === 'string') return n <= 1 ? `${what} can't be empty.` : `${what} needs at least ${n} characters.`;
  if (i.code === 'invalid_format' && 'format' in i && i.format === 'email') return 'Enter a valid email address.';
  return `${what} isn't valid.`;
}

/** Validates input with Zod. Throws a 400 with the first issue, as a plain sentence, as the message. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest(message(r.error.issues[0]!));
  return r.data;
}
