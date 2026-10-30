import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MONTHS, chapterList, chapterStart, moveManyToChapter, movePhoto as placeMove, placeOnSpread, setMonth as placeMonth } from '@memento/shared';
import { ApiError, api, errorMessage } from '../../api/client';
import { qk } from '../../api/hooks';
import type { BookContent, PageDto, PhotoDto } from '../../api/types';
import { useToast } from '../../lib/toast';
import { imageFiles, isVideoFile, mediaFiles, screenFiles, uploadFiles } from '../../lib/upload';

type Saved = 'All changes saved' | 'Saving…' | 'Saved just now';
type LayoutEntry = { id: string; pageId: string | null; position: number; month: number | null };

/** Photo ids that are still uploading or writing a caption, for the loading shimmer. */
export type LoadingSet = Set<string>;

/**
 * Everything the edit panel does to a book. Changes show at once (optimistic),
 * save in the background, and report "Saving… / Saved just now".
 */
export function useBookEditor(bookId: string, opts: { autoCaption: boolean; goTo: (i: number) => void; select: (id: string | null) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = qk.book(bookId);
  const [saved, setSaved] = useState<Saved>('All changes saved');
  const [loading, setLoading] = useState<LoadingSet>(new Set());
  const pending = useRef(0);
  const debounces = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** The debounced saves still waiting, so flush() can send them early. */
  const waiting = useRef(new Map<string, () => void>());
  useEffect(() => () => debounces.current.forEach(clearTimeout), []);
  /**
   * Text typed but not saved yet (captions; page header, journal and title text). A reply from
   * another save, or a reload after a failed one, must not put the old text back on screen.
   */
  const unsaved = useRef({ captions: new Map<string, string>(), pages: new Map<string, PagePatch>() });

  const withUnsaved = (pages: PageDto[]) => {
    const u = unsaved.current;
    if (!u.captions.size && !u.pages.size) return pages;
    const cap = <P extends PhotoDto | null>(p: P): P => (p && u.captions.has(p.id) ? { ...p, caption: u.captions.get(p.id)! } : p);
    return pages.map((pg) => {
      const patch = u.pages.get(pg.id);
      const next = patch ? applyPagePatch(pg, patch) : pg;
      return u.captions.size ? { ...next, hero: cap(next.hero), photos: next.photos.map(cap) } : next;
    });
  };

  const get = () => qc.getQueryData<BookContent>(key);
  const setPages = (fn: (p: PageDto[]) => PageDto[]) => qc.setQueryData<BookContent>(key, (c) => c && { ...c, pages: fn(c.pages) });
  const setContent = (c: Pick<BookContent, 'book' | 'pages'>) => qc.setQueryData<BookContent>(key, { book: c.book, pages: withUnsaved(c.pages) });

  /** Sends every debounced save now. Runs before any other save, so the server sees text first. */
  const flush = () => {
    for (const [k, fn] of [...waiting.current]) {
      clearTimeout(debounces.current.get(k));
      debounces.current.delete(k);
      waiting.current.delete(k);
      fn();
    }
  };
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const setBusy = (ids: string[], on: boolean) =>
    setLoading((cur) => {
      const next = new Set(cur);
      ids.forEach((i) => (on ? next.add(i) : next.delete(i)));
      return next;
    });

  /** Runs a save, tracking the indicator. Failures toast and reload the true state. */
  const save = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      flush();
      pending.current++;
      setSaved('Saving…');
      try {
        return await fn();
      } catch (e) {
        toast(errorMessage(e));
        await refresh();
        // Text that didn't save stays on screen; it's sent again when the connection is back.
        setPages(withUnsaved);
        return undefined;
      } finally {
        pending.current--;
        if (pending.current === 0) {
          // The prototype holds "Saving…" briefly so quick saves still register.
          setTimeout(() => pending.current === 0 && setSaved('Saved just now'), 400);
          void qc.invalidateQueries({ queryKey: qk.library });
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookId],
  );

  const later = (k: string, ms: number, fn: () => void) => {
    clearTimeout(debounces.current.get(k));
    setSaved('Saving…');
    waiting.current.set(k, fn);
    debounces.current.set(
      k,
      setTimeout(() => {
        debounces.current.delete(k);
        waiting.current.delete(k);
        fn();
      }, ms),
    );
  };

  /** Saves a caption after a pause in typing. It counts as unsaved until the server has it. */
  const queueCaption = (photoId: string, caption: string) => {
    unsaved.current.captions.set(photoId, caption);
    later(`cap:${photoId}`, 600, () =>
      void save(() => api(`/photos/${photoId}`, { method: 'PATCH', body: { caption } })).then((ok) => {
        if (ok !== undefined && unsaved.current.captions.get(photoId) === caption) unsaved.current.captions.delete(photoId);
      }),
    );
  };

  // Back online: send again whatever didn't save. Leaving the page with work in flight asks first.
  useEffect(() => {
    const retry = () => {
      for (const [id, caption] of unsaved.current.captions) queueCaption(id, caption);
      for (const [id, patch] of unsaved.current.pages) sendPagePatch(id, patch);
    };
    const warn = (e: BeforeUnloadEvent) => {
      const u = unsaved.current;
      if (pending.current > 0 || waiting.current.size || u.captions.size || u.pages.size) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('online', retry);
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('beforeunload', warn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const findPhoto = (id: string) => {
    for (const pg of get()?.pages ?? []) {
      const p = pg.photos.find((x) => x.id === id) ?? (pg.hero?.id === id ? pg.hero : undefined);
      if (p) return { pg, p };
    }
    return null;
  };

  const updatePhoto = (id: string, patch: Partial<PhotoDto>) =>
    setPages((pages) =>
      pages.map((pg) => ({
        ...pg,
        hero: pg.hero?.id === id ? { ...pg.hero, ...patch } : pg.hero,
        photos: pg.photos.some((p) => p.id === id) ? pg.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)) : pg.photos,
      })),
    );

  /** Sends a page change. Text changes count as unsaved until the server has them. */
  const sendPagePatch = (pageId: string, body: PagePatch) =>
    void save(() => api(`/pages/${pageId}`, { method: 'PATCH', body })).then((ok) => {
      if (ok !== undefined && unsaved.current.pages.get(pageId) === body) unsaved.current.pages.delete(pageId);
    });

  const patchPage = (pageId: string, body: PagePatch, debounceMs = 0) => {
    setPages((pages) => pages.map((pg) => (pg.id === pageId ? applyPagePatch(pg, body) : pg)));
    if (!debounceMs) return sendPagePatch(pageId, body);
    // Typed text waits for a pause. Changes to other fields of the page pile up, so none is lost.
    const merged = mergePagePatch(unsaved.current.pages.get(pageId), body);
    unsaved.current.pages.set(pageId, merged);
    later(`page:${pageId}`, debounceMs, () => sendPagePatch(pageId, merged));
  };

  /** Types text out 2 characters every 24ms, as the prototype does for fresh captions. */
  const typeOut = (text: string, set: (t: string) => void) =>
    new Promise<void>((res) => {
      let i = 0;
      const iv = setInterval(() => {
        i = Math.min(text.length, i + 2);
        set(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(iv);
          res();
        }
      }, 24);
    });

  /** Asks the server to write a caption, then types it into place and saves it. */
  /** Asks the server to write a caption, then types it into place and saves it. True on success. */
  const regen = async (photoId: string): Promise<boolean> => {
    const f = findPhoto(photoId);
    if (!f) return false;
    setBusy([photoId], true);
    const ctx = `${f.pg.label ?? ''} ${f.pg.header?.subtitle ?? ''}`.trim() || (f.pg.type === 'title' ? 'Cover photo of a family year-in-review scrapbook' : '');
    try {
      const { caption } = await api<{ caption: string }>('/ai/caption', { body: { subject: f.p.subject || 'family photo', context: ctx, photoId } });
      setBusy([photoId], false);
      updatePhoto(photoId, { caption: '' });
      await typeOut(caption, (t) => updatePhoto(photoId, { caption: t }));
      await save(() => api(`/photos/${photoId}`, { method: 'PATCH', body: { caption } }));
      return true;
    } catch (e) {
      setBusy([photoId], false);
      toast(errorMessage(e));
      return false;
    }
  };

  /** Rewrites every caption in `ids`, one at a time. Stops at the first failure. Undo restores them all. */
  const regenAll = async (ids: string[]) => {
    const list = ids.filter((id) => !id.startsWith('tmp-'));
    if (!list.length) return;
    const before = list.map((id) => ({ id, caption: findPhoto(id)?.p.caption ?? '' }));
    setBusy(list, true);
    let done = 0;
    for (const [i, id] of list.entries()) {
      if (await regen(id)) done++;
      else {
        setBusy(list.slice(i + 1), false);
        break;
      }
    }
    if (!done) return;
    toast(`${done} caption${done > 1 ? 's' : ''} rewritten`, 'Undo', () =>
      void save(async () => {
        for (const b of before) {
          updatePhoto(b.id, { caption: b.caption });
          await api(`/photos/${b.id}`, { method: 'PATCH', body: { caption: b.caption } });
        }
      }),
    );
  };

  return {
    saved,
    loading,
    regen,
    regenAll,
    patchPage,

    setCaption(photoId: string, caption: string) {
      updatePhoto(photoId, { caption });
      queueCaption(photoId, caption);
    },

    setTitleText(patch: Record<string, string>) {
      const title = get()?.pages.find((p) => p.type === 'title');
      if (title) patchPage(title.id, { text: patch }, 500);
    },

    setSpreadTheme(idxs: number[], themeId: string, themeName: string) {
      const pages = get()?.pages ?? [];
      idxs.forEach((i) => pages[i] && !/paper/.test(pages[i]!.type) && patchPage(pages[i]!.id, { themeId }));
      toast(`Theme set to ${themeName}`);
    },

    setSpreadPack(idxs: number[], stickerPack: string) {
      const pages = get()?.pages ?? [];
      idxs.forEach((i) => pages[i] && !/paper/.test(pages[i]!.type) && patchPage(pages[i]!.id, { stickerPack }));
    },

    async setMonth(photoId: string, month: number | null) {
      const c = get();
      if (!c) return;
      const local = placeMonth(c.pages, photoId, month);
      if (local) setPages(() => local.pages as PageDto[]);
      const res = await save(() => api<BookContent>(`/photos/${photoId}/month`, { body: { month } }));
      if (!res) return;
      setContent(res);
      toast(month == null ? 'Photo no longer tied to a month' : `Moved to ${MONTHS[month]}`);
    },

    /** Rearranges a photo within its spread. Shows at once; month order wins on year spreads. */
    async movePhoto(photoId: string, toIdx: number, position: number) {
      const c = get();
      const target = c?.pages[toIdx];
      if (!c || !target) return;
      const local = placeMove(c.pages, photoId, toIdx, position);
      if (local.kind === 'month-order') return toast("This year stays in month order. Change a photo's month to move it.");
      if (local.kind !== 'moved') return;
      setPages(() => local.pages as PageDto[]);
      const res = await save(() => api<BookContent & { kind: string; before?: LayoutEntry[] }>(`/photos/${photoId}/move`, { body: { pageId: target.id, position } }));
      if (!res) return;
      setContent(res);
      if (res.before) {
        const before = res.before;
        toast('Photo moved', 'Undo', () => void save(async () => setContent(await api<BookContent>(`/books/${bookId}/layout`, { method: 'PUT', body: { photos: before } }))));
      }
    },

    /**
     * Moves photos into a chapter (by its left page index), all or none. A full month grows extra
     * pages on the server, so the instant preview only shows what already fits. Returns true once saved.
     */
    async moveToChapter(photoIds: string[], chapterIdx: number) {
      const c = get();
      const target = c?.pages[chapterIdx];
      if (!c || !target || !photoIds.length) return false;
      const name = chapterList(c.pages).find((x) => x.idx === chapterIdx)?.name ?? 'that chapter';
      const local = moveManyToChapter(c.pages, photoIds, chapterIdx);
      if (local.kind === 'same') {
        toast(`Already in ${name}`);
        return false;
      }
      if (local.kind === 'moved') setPages(() => local.pages as PageDto[]);
      const res = await save(() => api<BookContent & { moved: number; before?: LayoutEntry[] }>(`/books/${bookId}/chapter-moves`, { body: { photoIds, pageId: target.id } }));
      if (!res) return false;
      setContent(res);
      const before = res.before;
      const what = res.moved === 1 ? 'Photo' : `${res.moved} photos`;
      if (before) toast(`${what} moved to ${name}`, 'Undo', () => void save(async () => setContent(await api<BookContent>(`/books/${bookId}/layout`, { method: 'PUT', body: { photos: before } }))));
      return true;
    },

    async removePhoto(photoId: string) {
      setPages((pages) => pages.map((pg) => ({ ...pg, photos: pg.photos.filter((p) => p.id !== photoId) })));
      const ok = await save(() => api(`/photos/${photoId}`, { method: 'DELETE' }));
      if (ok === undefined) return;
      toast('Photo removed', 'Undo', () =>
        void save(async () => {
          await api(`/photos/${photoId}/restore`, { method: 'POST' });
          await refresh();
        }),
      );
    },

    async addYear() {
      const r = await save(() => api<{ year: number; at: number }>(`/books/${bookId}/years`, { method: 'POST' }));
      if (!r) return;
      await refresh();
      setTimeout(() => opts.goTo(r.at), 80);
      toast(`${r.year} added. Drop photos in to start filling it.`);
    },

    async addMonth(year: number, month: number) {
      const r = await save(() => api<{ at: number }>(`/books/${bookId}/months`, { body: { year, month } }));
      if (!r) return;
      await refresh();
      setTimeout(() => opts.goTo(r.at), 80);
      toast(`${MONTHS[month]} ${year} added. Drop photos in to fill it.`);
    },

    /** Uploads dropped files and places them like the prototype's uploadToSpread(). */
    async uploadToSpread(list: FileList | File[], L: number, single: boolean, side?: 'L' | 'R') {
      const picked = mediaFiles(list);
      if (!picked.length) return toast('Only photos and videos can be added.');
      // Files the server would refuse are set aside, so they don't stop the rest of the batch.
      const { ok: files, rejected } = screenFiles(picked);
      if (!files.length) return toast(rejected.map((r) => r.error).join(' '));
      const c = get();
      if (!c) return;
      const start = chapterStart(c.pages, L);
      const chapterName = (start != null && chapterList(c.pages).find((x) => x.idx === start)?.name) || 'This chapter';
      // Show the photos at once, with local previews, while they upload.
      const temp = files.map((f, i) => ({ id: `tmp-${Date.now()}-${i}`, month: null, file: f }));
      const probe = placeOnSpread(c.pages, L, { single, side }, temp);
      if (probe.kind === 'no-slots') return toast('This spread has no photo slots. Turn to a year or month first.');
      if (probe.kind === 'year-full') return toast('This year is full. Remove a photo, or add more to a month chapter.');
      // A browser can't show a video file as an image, so videos wait as a blank tile until their poster arrives.
      const urls = new Map(temp.flatMap((t) => (isVideoFile(t.file) ? [] : [[t.id, URL.createObjectURL(t.file)] as const])));
      const toDto = (p: { id: string; month: number | null }): PhotoDto => {
        const t = temp.find((x) => x.id === p.id);
        if (!t) return p as PhotoDto;
        const u = urls.get(t.id) ?? null;
        return { id: t.id, pageId: null, position: 0, subject: t.file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), caption: '', month: p.month, width: null, height: null, thumbUrl: u, displayUrl: u, videoUrl: null, durationMs: null };
      };
      setPages(() => probe.pages.map((pg) => ({ ...(pg as PageDto), photos: (pg.photos ?? []).map(toDto) })));
      setBusy(temp.map((t) => t.id), true);

      type PhotosRes = BookContent & { kind: 'year' | 'pages'; added: { id: string; month: number | null }[]; left: number; monthFull?: boolean; skipped: { name: string; error: string }[] };
      // Files upload in parallel, then each is processed in its own short request, so a
      // batch never risks a proxy timeout and photos appear one by one.
      const res = await save(async () => {
        const results = await uploadFiles(files);
        const out = { kind: probe.kind as 'year' | 'pages', added: [] as { id: string; month: number | null }[], left: 0, monthFull: false, skipped: [...rejected], content: null as PhotosRes | null };
        for (const [i, up] of results.entries()) {
          if (!up.ok) out.skipped.push({ name: up.name, error: up.error });
          else {
            try {
              const r = await api<PhotosRes>(`/books/${bookId}/photos`, { body: { uploads: [up.ref], L, single, side } });
              out.added.push(...r.added);
              out.left += r.left;
              out.monthFull ||= !!r.monthFull;
              out.skipped.push(...r.skipped);
              out.content = r;
            } catch (e) {
              if (e instanceof ApiError && e.status === 400 && /full|no photo slots/i.test(e.message)) out.left += 1;
              else out.skipped.push({ name: up.ref.name, error: errorMessage(e) });
            }
          }
          // Show what's done so far, with previews for the photos still to come.
          const rest = temp.slice(i + 1);
          const urlsLeft = new Set(rest.map((x) => x.id));
          setBusy([temp[i]!.id], false);
          if (out.content) {
            const base = out.content.pages;
            const again = rest.length ? placeOnSpread(base, L, { single, side }, rest) : null;
            const pages = again && (again.kind === 'year' || again.kind === 'pages') ? again.pages : base;
            setContent({ book: out.content.book, pages: pages.map((pg) => ({ ...(pg as PageDto), photos: (pg.photos ?? []).map((p) => (urlsLeft.has(p.id) ? toDto(p) : (p as PhotoDto))) })) });
          }
        }
        // The totals across every photo must win over the last reply's own added/left/skipped.
        return { ...(out.content ?? { book: get()!.book, pages: get()!.pages }), ...out };
      });
      setBusy(temp.map((t) => t.id), false);
      urls.forEach((u) => URL.revokeObjectURL(u));
      // Previews of files that never made it (offline, refused) go; the server's pages are the truth.
      setPages((pages) => pages.map((pg) => (pg.photos.some((p) => p.id.startsWith('tmp-')) ? { ...pg, photos: pg.photos.filter((p) => !p.id.startsWith('tmp-')) } : pg)));
      if (!res) return;
      if (res.content) setContent(res.content);
      else await refresh();
      const skipped = res.skipped.length ? ` ${res.skipped.length} couldn't be added: ${res.skipped.map((x) => x.error).filter((v, i, a) => a.indexOf(v) === i).join(' ')}` : '';
      const full = res.monthFull ? `${chapterName} holds 50 photos` : 'This spread is full';
      if (!res.added.length) {
        toast(res.left ? `${full}. Remove a photo or turn to another chapter.${skipped}` : skipped.trim() || 'No photos were added.');
        return;
      }
      if (res.kind === 'year') {
        const n = res.added.length;
        toast(
          `Added ${n} photo${n === 1 ? '' : 's'}${res.left ? `. ${res.left} didn't fit` : ''}. Pick ${n === 1 ? 'its month' : 'their months'} in the editor to put the year in order.${skipped}`,
        );
      } else if (res.left) toast(`${res.left} photo${res.left > 1 ? 's' : ''} didn't fit. ${full}.${skipped}`);
      else if (skipped) toast(skipped.trim());
      if (res.added[0]) opts.select(res.added[0].id);
      if (opts.autoCaption) for (const p of res.added) void regen(p.id);
    },

    async replaceHero(list: FileList | File[]) {
      const [file] = imageFiles(list);
      if (!file) return toast('Only image files can be added.');
      const { rejected } = screenFiles([file]);
      if (rejected.length) return toast(rejected[0]!.error);
      const res = await save(async () => {
        const [up] = await uploadFiles([file]);
        if (!up?.ok) throw new Error(up?.error ?? "That photo didn't upload.");
        return api<BookContent & { previous: string | null }>(`/books/${bookId}/hero`, { method: 'PUT', body: { upload: up.ref } });
      });
      if (!res) return;
      setContent(res);
      toast('Cover photo updated', 'Undo', () =>
        void save(async () => setContent(await api<BookContent>(`/books/${bookId}/hero`, { method: 'PUT', body: { photoId: res.previous } }))),
      );
    },

    async removeHero() {
      const prev = get()?.pages.find((p) => p.type === 'title')?.hero?.id ?? null;
      const res = await save(() => api<BookContent>(`/books/${bookId}/hero`, { method: 'PUT', body: { photoId: null } }));
      if (!res) return;
      setContent(res);
      toast('Cover photo removed', 'Undo', () => void save(async () => setContent(await api<BookContent>(`/books/${bookId}/hero`, { method: 'PUT', body: { photoId: prev } }))));
    },
  };
}

export type BookEditor = ReturnType<typeof useBookEditor>;

type PagePatch = Partial<Pick<PageDto, 'themeId' | 'stickerPack' | 'journal'>> & { header?: Partial<NonNullable<PageDto['header']>>; text?: Record<string, string> };

function applyPagePatch(pg: PageDto, body: PagePatch): PageDto {
  return {
    ...pg,
    ...(body.themeId ? { themeId: body.themeId } : {}),
    ...(body.stickerPack ? { stickerPack: body.stickerPack } : {}),
    ...(body.journal !== undefined ? { journal: body.journal } : {}),
    ...(body.header ? { header: { ...(pg.header ?? {}), ...body.header } } : {}),
    ...(body.text ? { text: { ...(pg.text ?? {}), ...body.text } } : {}),
  };
}

function mergePagePatch(a: PagePatch | undefined, b: PagePatch): PagePatch {
  if (!a) return b;
  return { ...a, ...b, ...(a.header || b.header ? { header: { ...a.header, ...b.header } } : {}), ...(a.text || b.text ? { text: { ...a.text, ...b.text } } : {}) };
}
