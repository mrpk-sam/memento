import { and, asc, eq, isNull } from 'drizzle-orm';
import { buildCaptionPrompt, cleanCaption } from '@memento/shared';
import type { Db } from '../db/client.js';
import * as s from '../db/schema.js';
import { decrypt } from './crypto.js';
import { HttpError } from './http.js';

export interface AiConfig {
  endpoint: string;
  key: string | null;
  model: string;
  vision: boolean;
  basePrompt: string;
  stylePrompt: string;
  familyName: string;
  owner?: string;
  maxLen: number;
  emoji: boolean;
}

/** Reads caption settings and the active style's prompt from the DB. Decrypts the key server-side only. */
export async function loadAiConfig(db: Db, encKey: string, styleId?: string): Promise<AiConfig> {
  const [st] = await db.select().from(s.settings);
  if (!st) throw new HttpError(500, 'Settings missing. Run the seed.');
  const styles = await db.select().from(s.captionStyles).where(isNull(s.captionStyles.deletedAt)).orderBy(asc(s.captionStyles.sortOrder));
  const style = styles.find((x) => x.id === (styleId ?? st.aiVoiceStyleId)) ?? styles[0];
  return {
    endpoint: st.aiEndpoint.trim().replace(/\/+$/, ''),
    key: st.aiKeyEncrypted ? decrypt(st.aiKeyEncrypted, encKey) : null,
    model: st.aiModel.trim(),
    vision: st.aiVision,
    basePrompt: st.aiBasePrompt,
    stylePrompt: style?.prompt ?? '',
    familyName: st.familyName,
    maxLen: st.aiMaxLen,
    emoji: st.aiEmoji,
  };
}

export const aiReady = (c: Pick<AiConfig, 'endpoint' | 'model'>) => !!c.endpoint && !!c.model;

type Fetch = typeof fetch;

/** POST {endpoint}/chat/completions, OpenAI-compatible. */
/**
 * Local servers such as llama-swap load a model on its first request, which can take a
 * minute or more, so the wait is generous.
 */
export const AI_TIMEOUT_MS = 120_000;
const TOO_SLOW = 'The caption service took over 2 minutes to answer. If it was loading the model, try again.';

export async function chatComplete(c: AiConfig, messages: unknown[], opts: { fetch?: Fetch; timeoutMs?: number; allowEmpty?: boolean } = {}): Promise<string> {
  const f = opts.fetch ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? AI_TIMEOUT_MS);
  try {
    const res = await f(`${c.endpoint}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(c.key ? { authorization: `Bearer ${c.key}` } : {}) },
      // Only model and messages: extra parameters (max_tokens, temperature) are rejected by some models.
      body: JSON.stringify({ model: c.model, messages }),
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(502, `The caption service said ${res.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text) as { choices?: { message?: { content?: string | { type: string; text?: string }[] } }[] };
    const content = data.choices?.[0]?.message?.content;
    const out = Array.isArray(content) ? content.map((p) => p.text ?? '').join('') : content;
    if (!out && !opts.allowEmpty) throw new HttpError(502, 'The caption service sent an empty reply');
    return out ?? '';
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, (e as Error).name === 'AbortError' ? TOO_SLOW : "Couldn't reach the caption service");
  } finally {
    clearTimeout(timer);
  }
}

/** Builds the prompt, calls the model (with the 400px image when vision is on), and cleans the reply. */
export async function writeCaption(c: AiConfig, subject: string, context: string | null, image: Buffer | null, opts: { fetch?: Fetch } = {}) {
  if (!aiReady(c)) throw new HttpError(400, "AI captions aren't set up yet. Add an endpoint and model in Editor's Desk → AI captions.");
  const p = buildCaptionPrompt(c, subject, context);
  const user =
    c.vision && image
      ? [
          { type: 'text', text: p.user },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } },
        ]
      : p.user;
  const raw = await chatComplete(c, [{ role: 'system', content: p.system }, { role: 'user', content: user }], opts);
  return cleanCaption(raw, c.maxLen);
}

export async function styleById(db: Db, id: string) {
  const [x] = await db.select().from(s.captionStyles).where(and(eq(s.captionStyles.id, id), isNull(s.captionStyles.deletedAt)));
  return x;
}

/** GET {endpoint}/models. Handles the OpenAI shape ({data:[{id}]}) and common variants ({models:[{name}]}). */
export async function listModels(c: Pick<AiConfig, 'endpoint' | 'key'>, opts: { fetch?: Fetch; timeoutMs?: number } = {}): Promise<string[]> {
  const f = opts.fetch ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await f(`${c.endpoint}/models`, { signal: ctrl.signal, headers: c.key ? { authorization: `Bearer ${c.key}` } : {} });
    const text = await res.text();
    if (!res.ok) throw new HttpError(502, `The caption service said ${res.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text) as { data?: unknown[]; models?: unknown[] } | unknown[];
    const list = Array.isArray(data) ? data : (data.data ?? data.models ?? []);
    const ids = list
      .map((m) => (typeof m === 'string' ? m : ((m as { id?: string; name?: string; model?: string }).id ?? (m as { name?: string }).name ?? (m as { model?: string }).model)))
      .filter((x): x is string => typeof x === 'string' && !!x);
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof SyntaxError) throw new HttpError(502, "The endpoint's model list wasn't valid JSON. Check the URL ends in /v1.");
    throw new HttpError(502, (e as Error).name === 'AbortError' ? 'The caption service took too long to answer' : "Couldn't reach the caption service");
  } finally {
    clearTimeout(timer);
  }
}
