import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { poss } from '@memento/shared';
import { api, errorMessage } from '../../api/client';
import { qk, useInbox, useLibrary } from '../../api/hooks';
import type { InboxData, InboxItem } from '../../api/types';
import { useToast } from '../../lib/toast';
import { typeOut } from '../../lib/typeOut';
import { imageFiles, uploadFiles } from '../../lib/upload';
import d from './Desk.module.css';
import s from './InboxTab.module.css';

type Card = InboxItem & { pending?: boolean };

/** Files shared from the phone's gallery (PWA share target) wait here until the inbox picks them up. */
export const SHARED_CACHE = 'memento-shared';

export function InboxTab() {
  const { data } = useInbox();
  const lib = useLibrary().data;
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [temp, setTemp] = useState<Card[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const setItems = (fn: (items: InboxItem[]) => InboxItem[]) => {
    qc.setQueryData<InboxData>(qk.inbox, (x) => x && { ...x, items: fn(x.items) });
    void qc.invalidateQueries({ queryKey: [...qk.inbox, 'count'] });
  };
  const patchItem = (id: string, patch: Partial<InboxItem>, debounce = 0) => {
    setItems((items) => items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const send = () => api(`/inbox/${id}`, { method: 'PATCH', body: patch }).catch((e) => toast(errorMessage(e)));
    clearTimeout(timers.current.get(id + Object.keys(patch).join()));
    if (debounce) timers.current.set(id + Object.keys(patch).join(), setTimeout(send, debounce));
    else void send();
  };
  const mark = (ids: string[], on: boolean) =>
    setBusy((cur) => {
      const n = new Set(cur);
      ids.forEach((i) => (on ? n.add(i) : n.delete(i)));
      return n;
    });

  async function caption(it: InboxItem) {
    mark([it.id], true);
    try {
      const { caption: text } = await api<{ caption: string }>('/ai/caption', { body: { subject: it.subject, context: 'family photo inbox', inboxItemId: it.id } });
      mark([it.id], false);
      setItems((items) => items.map((x) => (x.id === it.id ? { ...x, caption: '' } : x)));
      await typeOut(text, (t) => setItems((items) => items.map((x) => (x.id === it.id ? { ...x, caption: t } : x))));
      await api(`/inbox/${it.id}`, { method: 'PATCH', body: { caption: text } });
    } catch (e) {
      mark([it.id], false);
      toast(errorMessage(e));
    }
  }

  async function addFiles(list: FileList | File[]) {
    const files = imageFiles(list);
    if (!files.length) return toast('Only image files can be added.');
    const placeholders: Card[] = files.map((f, i) => {
      const u = URL.createObjectURL(f);
      return { id: `tmp-${Date.now()}-${i}`, subject: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), caption: '', thumbUrl: u, displayUrl: u, destBookId: null, destPageId: null, createdAt: '', pending: true };
    });
    setTemp((t) => [...t, ...placeholders]);
    try {
      const refs = await uploadFiles(files);
      // One short request per photo, so a big batch can't hit a proxy timeout.
      const failed: string[] = [];
      for (const [i, ref] of refs.entries()) {
        try {
          const res = await api<{ items: InboxItem[]; skipped: { name: string; error: string }[] }>('/inbox', { body: { uploads: [ref] } });
          setItems((items) => [...items, ...res.items]);
          failed.push(...res.skipped.map((x) => x.error));
          if (lib?.settings.aiAuto) res.items.forEach((it) => void caption(it));
        } catch (e) {
          failed.push(errorMessage(e));
        }
        const done = placeholders[i]!;
        URL.revokeObjectURL(done.thumbUrl!);
        setTemp((tmp) => tmp.filter((x) => x !== done));
      }
      if (failed.length) toast(`${failed.length} photo${failed.length > 1 ? 's' : ''} couldn't be added. ${[...new Set(failed)].join(' ')}`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      placeholders.forEach((p) => URL.revokeObjectURL(p.thumbUrl!));
      setTemp((t) => t.filter((x) => !placeholders.includes(x)));
      void qc.invalidateQueries({ queryKey: qk.inbox });
    }
  }

  // Photos shared into the app from the phone gallery (see the service worker).
  useEffect(() => {
    if (!('caches' in window) || !new URLSearchParams(location.search).has('shared')) return;
    void (async () => {
      const cache = await caches.open(SHARED_CACHE);
      const keys = await cache.keys();
      const files: File[] = [];
      for (const k of keys) {
        const r = await cache.match(k);
        if (!r) continue;
        const blob = await r.blob();
        files.push(new File([blob], decodeURIComponent(r.headers.get('x-filename') ?? 'shared.jpg'), { type: blob.type }));
        await cache.delete(k);
      }
      history.replaceState(null, '', location.pathname);
      if (files.length) await addFiles(files);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return null;
  const cards: Card[] = [...data.items, ...temp];

  return (
    <>
      <div className={d.headRow}>
        <div>
          <h2 className={d.h2}>Photo inbox</h2>
          <p className={d.lead}>Drop in photos, let AI draft the captions, then file each one into a book.</p>
        </div>
      </div>
      <div
        className={s.drop}
        role="button"
        tabIndex={0}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!drag) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void addFiles(e.dataTransfer.files);
        }}
        style={{ borderColor: drag ? 'var(--accent)' : 'var(--tan)', background: drag ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))' : 'var(--surface)', transform: `scale(${drag ? 1.01 : 1})` }}
      >
        <div className={s.dropIcon}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
        </div>
        <div className={s.dropTitle}>Drag photos here</div>
        <div className={s.dropSub}>
          or <span>choose from your computer</span> · JPG, PNG, HEIC
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {cards.length > 0 && (
        <div className={s.grid}>
          {cards.map((it) => {
            const book = data.books.find((b) => b.id === it.destBookId);
            const loading = it.pending || busy.has(it.id);
            return (
              <div key={it.id} className={s.card}>
                <div className={s.img} style={{ background: it.thumbUrl ? `url(${it.thumbUrl}) center/cover` : 'var(--surface2)' }} />
                <div className={s.body}>
                  <input className={s.subject} value={it.subject} disabled={it.pending} aria-label="What's in the photo" title="What's in the photo. The caption is written from this." onChange={(e) => patchItem(it.id, { subject: e.target.value }, 500)} />
                  {loading ? (
                    <div className={s.writing}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
                      {it.pending ? 'Uploading…' : 'Writing a caption…'}
                    </div>
                  ) : (
                    <textarea className={s.caption} rows={2} value={it.caption} placeholder="Write a caption…" onChange={(e) => patchItem(it.id, { caption: e.target.value }, 600)} />
                  )}
                  <div className={s.selects}>
                    <select
                      value={it.destBookId ?? ''}
                      disabled={it.pending}
                      aria-label="Book"
                      onChange={(e) => {
                        const b = data.books.find((x) => x.id === e.target.value);
                        patchItem(it.id, { destBookId: b?.id ?? null, destPageId: b?.chapters.at(-1)?.pageId ?? null });
                      }}
                    >
                      {data.books.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    <select value={it.destPageId ?? ''} disabled={it.pending} aria-label="Chapter" onChange={(e) => patchItem(it.id, { destPageId: e.target.value })}>
                      {(book?.chapters ?? []).map((c) => (
                        <option key={c.pageId} value={c.pageId}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className={s.actions}>
                    <button
                      className={s.file}
                      disabled={it.pending}
                      onClick={async () => {
                        try {
                          const r = await api<{ bookId: string; pageIdx: number; chapter: string; owner: string }>(`/inbox/${it.id}/file`, { method: 'POST' });
                          setItems((items) => items.filter((x) => x.id !== it.id));
                          void qc.invalidateQueries({ queryKey: qk.book(r.bookId) });
                          void qc.invalidateQueries({ queryKey: qk.library });
                          toast(`Added to ${poss(r.owner)} book · ${r.chapter}`, 'Open', () => nav(`/book/${r.bookId}?edit=1&pos=${r.pageIdx}`));
                        } catch (e) {
                          toast(errorMessage(e));
                        }
                      }}
                    >
                      Add to book
                    </button>
                    <button className={s.regen} title="Regenerate caption" disabled={loading} onClick={() => void caption(it)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
                    </button>
                    <button
                      className={s.discard}
                      title="Discard"
                      disabled={it.pending}
                      onClick={async () => {
                        setItems((items) => items.filter((x) => x.id !== it.id));
                        try {
                          await api(`/inbox/${it.id}`, { method: 'DELETE' });
                          toast('Photo discarded', 'Undo', async () => {
                            await api(`/inbox/${it.id}/restore`, { method: 'POST' });
                            await qc.invalidateQueries({ queryKey: qk.inbox });
                          });
                        } catch (e) {
                          toast(errorMessage(e));
                          void qc.invalidateQueries({ queryKey: qk.inbox });
                        }
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
