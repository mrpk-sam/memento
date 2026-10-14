import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import * as s from '../db/schema.js';
import { ADMIN, createTestApp } from '../test/app.js';

type Call = { url: string; auth: string | null; body: { model: string; messages: { role: string; content: unknown }[] } };
const calls: Call[] = [];
let reply = '"Salt air, sandy toes"\nOr maybe this';
let status = 200;
const fakeFetch = (async (url: string, init: RequestInit = {}) => {
  if (url.endsWith('/models')) {
    calls.push({ url, auth: (init.headers as Record<string, string>)?.authorization ?? null, body: { model: '', messages: [] } });
    return new Response(status === 200 ? JSON.stringify({ object: 'list', data: [{ id: 'qwen2.5-7b' }, { id: 'llama-3.1-8b' }, { id: 'qwen2.5-7b' }] }) : 'nope', { status });
  }
  calls.push({ url, auth: (init.headers as Record<string, string>).authorization ?? null, body: JSON.parse(String(init.body)) });
  return new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content: reply } }] }) : 'nope', { status });
}) as unknown as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: string;
let member: string;
const api = (cookie: string, method: string, url: string, payload?: object) => t.app.inject({ method: method as 'GET', url, headers: { cookie }, payload });

beforeAll(async () => {
  t = await createTestApp({}, { aiFetch: fakeFetch });
  admin = await t.login(ADMIN);
  await api(admin, 'POST', '/api/people', { name: 'Reader', email: 'reader@example.com', sendInvite: false });
  member = await t.login('reader@example.com');
});
afterAll(() => t.close());
beforeEach(() => {
  calls.length = 0;
  reply = '"Salt air, sandy toes"\nOr maybe this';
  status = 200;
});

describe('AI settings', () => {
  it('start unconfigured, with the seeded prompts and four styles', async () => {
    const v = (await api(admin, 'GET', '/api/ai')).json();
    expect(v).toMatchObject({ endpoint: '', model: '', hasKey: false, maxLen: 60, emoji: false, auto: true });
    expect(v.styles.map((x: { name: string }) => x.name)).toEqual(['Warm', 'Playful', 'Poetic', 'Short & sweet']);
    expect(v.basePrompt).toContain('{family}');
  });

  it('are admin-only', async () => {
    expect((await api(member, 'GET', '/api/ai')).statusCode).toBe(403);
    expect((await api(member, 'PATCH', '/api/ai', { model: 'x' })).statusCode).toBe(403);
  });

  it('encrypt the key at rest and only ever send it masked', async () => {
    const res = await api(admin, 'PATCH', '/api/ai', { endpoint: 'https://llm.example.com/v1/', key: 'sk-test-example', model: 'gpt-4o-mini' });
    expect(res.json()).toMatchObject({ hasKey: true, keyMasked: 'sk-test-••••••••mple' });
    expect(res.body).not.toContain('test-exam');
    const [row] = await t.db.select().from(s.settings);
    expect(row!.aiKeyEncrypted).toBeTruthy();
    expect(row!.aiKeyEncrypted).not.toContain('sk-live');
  });

  it('rejects a bad endpoint URL', async () => {
    expect((await api(admin, 'PATCH', '/api/ai', { endpoint: 'ftp://nope' })).statusCode).toBe(400);
  });
});

describe('writing captions', () => {
  it('builds the prompt from the database and cleans the reply', async () => {
    const res = await api(admin, 'POST', '/api/ai/caption', { subject: 'grandpa fishing at dawn', context: 'July · Canada Day' });
    expect(res.json()).toEqual({ caption: 'Salt air, sandy toes' });
    const c = calls[0]!;
    expect(c.url).toBe('https://llm.example.com/v1/chat/completions');
    expect(c.auth).toBe('Bearer sk-test-example');
    expect(c.body.model).toBe('gpt-4o-mini');
    const [sys, user] = c.body.messages;
    expect(sys!.content).toContain('You write captions for the Rivera family scrapbook.');
    expect(sys!.content).toContain('at most 60 characters');
    expect(sys!.content).toContain('No emoji.');
    expect(sys!.content).toContain('Voice: warm and affectionate');
    expect(user!.content).toBe('Photo: grandpa fishing at dawn\nContext: July · Canada Day');
  });

  it('uses edited prompts, the chosen style, length and emoji settings', async () => {
    const v = (await api(admin, 'GET', '/api/ai')).json();
    const playful = v.styles.find((x: { name: string }) => x.name === 'Playful');
    await api(admin, 'PATCH', '/api/ai', { basePrompt: 'Captions for {family}. Max {maxLen}. {emojiRule}', voiceStyleId: playful.id, maxLen: 40, emoji: true });
    await api(admin, 'PATCH', `/api/ai/styles/${playful.id}`, { prompt: 'Be silly.' });
    await api(admin, 'POST', '/api/ai/caption', { subject: 'x' });
    expect(calls[0]!.body.messages[0]!.content).toBe('Captions for Rivera. Max 40. One fitting emoji is fine.\n\nBe silly.');
  });

  it('sends the 400px image when vision is on', async () => {
    await api(admin, 'PATCH', '/api/ai', { vision: true });
    const lib = (await api(admin, 'GET', '/api/library')).json();
    const bookId = lib.books[0].id;
    const jpeg = await sharp({ create: { width: 500, height: 400, channels: 3, background: '#88a' } }).jpeg().toBuffer();
    const up = (await api(admin, 'POST', '/api/uploads', { files: [{ name: 'dock.jpg', type: 'image/jpeg', size: jpeg.length }] })).json().uploads[0];
    await t.app.inject({ method: 'PUT', url: up.url, payload: jpeg, headers: { cookie: admin, 'content-type': 'image/jpeg' } });
    const added = (await api(admin, 'POST', `/api/books/${bookId}/photos`, { uploads: [{ id: up.id, name: 'dock.jpg' }], L: 4, single: false })).json().added[0];
    calls.length = 0;
    await api(admin, 'POST', '/api/ai/caption', { subject: 'dock', photoId: added.id });
    const parts = calls[0]!.body.messages[1]!.content as { type: string; image_url?: { url: string } }[];
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect(parts[1]!.image_url!.url).toMatch(/^data:image\/jpeg;base64,/);
    await api(admin, 'PATCH', '/api/ai', { vision: false });
  });

  it('lets book editors caption their photos but keeps the test box to the admin', async () => {
    expect((await api(member, 'POST', '/api/ai/caption', { subject: 'x' })).statusCode).toBe(403);
  });

  it('reports a failing endpoint without leaking the key', async () => {
    status = 401;
    const res = await api(admin, 'POST', '/api/ai/caption', { subject: 'x' });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('sk-live');
  });

  it('says clearly when captions are not set up', async () => {
    await api(admin, 'PATCH', '/api/ai', { endpoint: '' });
    const res = await api(admin, 'POST', '/api/ai/caption', { subject: 'x' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/aren't set up yet/);
    expect((await api(admin, 'POST', '/api/ai/test-connection')).json()).toMatchObject({ ok: false });
    await api(admin, 'PATCH', '/api/ai', { endpoint: 'https://llm.example.com/v1' });
    expect((await api(admin, 'POST', '/api/ai/test-connection')).json()).toMatchObject({ ok: true, message: 'Connected' });
    // Newer OpenAI models reject max_tokens, so no request sends a token limit.
    expect(Object.keys(calls.at(-1)!.body).sort()).toEqual(['messages', 'model']);
  });
});

describe('captions know which book the photo is in', () => {
  const jpegOnce = () => sharp({ create: { width: 300, height: 200, channels: 3, background: '#7a9' } }).jpeg().toBuffer();
  async function upload(name: string) {
    const jpeg = await jpegOnce();
    const up = (await api(admin, 'POST', '/api/uploads', { files: [{ name, type: 'image/jpeg', size: jpeg.length }] })).json().uploads[0];
    await t.app.inject({ method: 'PUT', url: up.url, payload: jpeg, headers: { cookie: admin, 'content-type': 'image/jpeg' } });
    return { id: up.id as string, name };
  }
  const book = async (owner: string) => (await api(admin, 'GET', '/api/library')).json().books.find((b: { owner: string }) => b.owner === owner);

  it("uses the book's family, owner and chapter for a photo in it", async () => {
    await api(admin, 'PATCH', '/api/ai', { basePrompt: 'For the {family} family, in {owner}. {emojiRule}', model: 'gpt-4o-mini', endpoint: 'https://llm.example.com/v1' });
    const brooks = await book('Nadia & Omar');
    const photo = (await api(admin, 'POST', `/api/books/${brooks.id}/photos`, { uploads: [await upload('lake.jpg')], L: 4, single: false })).json().added[0];
    calls.length = 0;
    await api(admin, 'POST', '/api/ai/caption', { subject: 'lake', photoId: photo.id, context: '2026 in photos A year still being written' });
    const [sys, user] = calls[0]!.body.messages;
    expect(sys!.content).toMatch(/^For the Brooks family, in Nadia & Omar\./);
    expect(user!.content).toBe("Photo: lake\nContext: Nadia & Omar's book · 2026 in photos A year still being written");
  });

  it('falls back to the Settings family name for households without a surname', async () => {
    const daniel = await book('Daniel & Priya');
    calls.length = 0;
    await api(admin, 'POST', '/api/ai/caption', { subject: 'x', bookId: daniel.id });
    expect(calls[0]!.body.messages[0]!.content).toMatch(/^For the Rivera family, in Daniel & Priya\./);
    expect(calls[0]!.body.messages[1]!.content).toBe("Photo: x\nContext: Daniel & Priya's book");
  });

  it('uses the inbox photo\u2019s chosen book and chapter', async () => {
    const up = await upload('dock.jpg');
    const item = (await api(admin, 'POST', '/api/inbox', { uploads: [up] })).json().items[0];
    const { books } = (await api(admin, 'GET', '/api/inbox')).json();
    const brooks = books.find((b: { name: string }) => b.name === 'Nadia & Omar');
    await api(admin, 'PATCH', `/api/inbox/${item.id}`, { destBookId: brooks.id, destPageId: brooks.chapters[0].pageId });
    calls.length = 0;
    await api(admin, 'POST', '/api/ai/caption', { subject: 'dock', inboxItemId: item.id, context: 'family photo inbox' });
    expect(calls[0]!.body.messages[1]!.content).toBe("Photo: dock\nContext: Nadia & Omar's book · 2026 in photos · A year still being written");
  });

  it('keeps the Settings family for the test box with no book', async () => {
    calls.length = 0;
    await api(admin, 'POST', '/api/ai/caption', { subject: 'x' });
    expect(calls[0]!.body.messages[0]!.content).toMatch(/^For the Rivera family, in the Rivera family\./);
    expect(calls[0]!.body.messages[1]!.content).toBe('Photo: x\nContext: the Rivera family scrapbook');
  });
});

describe('slow and thinking models', () => {
  it('counts an empty reply from a thinking model as connected', async () => {
    reply = '';
    expect((await api(admin, 'POST', '/api/ai/test-connection')).json()).toMatchObject({ ok: true, message: 'Connected' });
    expect((await api(admin, 'POST', '/api/ai/caption', { subject: 'x' })).statusCode).toBe(502);
  });
});

describe('model list', () => {
  it('lists the endpoint models, sorted and de-duplicated, with the key', async () => {
    await api(admin, 'PATCH', '/api/ai', { endpoint: 'https://llm.example.com/v1', key: 'sk-models-123456789' });
    const res = await api(admin, 'GET', '/api/ai/models');
    expect(res.json()).toEqual({ models: ['llama-3.1-8b', 'qwen2.5-7b'] });
    expect(calls.at(-1)).toMatchObject({ url: 'https://llm.example.com/v1/models', auth: 'Bearer sk-models-123456789' });
  });

  it('tests the connection through the model list when no model is picked', async () => {
    await api(admin, 'PATCH', '/api/ai', { model: '' });
    const res = await api(admin, 'POST', '/api/ai/test-connection');
    expect(res.json()).toMatchObject({ ok: true, models: ['llama-3.1-8b', 'qwen2.5-7b'] });
    status = 404;
    expect((await api(admin, 'GET', '/api/ai/models')).statusCode).toBe(502);
    await api(admin, 'PATCH', '/api/ai', { model: 'gpt-4o-mini' });
  });

  it('is admin-only', async () => {
    expect((await api(member, 'GET', '/api/ai/models')).statusCode).toBe(403);
  });
});

describe('caption styles', () => {
  it('lets custom styles be added, renamed and deleted, but not built-ins', async () => {
    const id = (await api(admin, 'POST', '/api/ai/styles', { name: 'Dad jokes', prompt: 'Puns only.' })).json().id;
    await api(admin, 'PATCH', `/api/ai/styles/${id}`, { name: 'Groaners' });
    let v = (await api(admin, 'GET', '/api/ai')).json();
    expect(v.styles.at(-1)).toMatchObject({ name: 'Groaners', prompt: 'Puns only.', builtin: false });
    await api(admin, 'PATCH', '/api/ai', { voiceStyleId: id });
    await api(admin, 'DELETE', `/api/ai/styles/${id}`);
    v = (await api(admin, 'GET', '/api/ai')).json();
    expect(v.styles.some((x: { id: string }) => x.id === id)).toBe(false);
    expect(v.voiceStyleId).toBe(v.styles[0].id);
    await api(admin, 'POST', `/api/ai/styles/${id}/restore`);
    expect((await api(admin, 'GET', '/api/ai')).json().styles.some((x: { id: string }) => x.id === id)).toBe(true);
    const warm = v.styles.find((x: { builtin: boolean }) => x.builtin);
    expect((await api(admin, 'DELETE', `/api/ai/styles/${warm.id}`)).statusCode).toBe(403);
  });
});
