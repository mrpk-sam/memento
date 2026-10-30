import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { chapters, isLight, spineBg } from '@memento/shared';
import { qk, useBook, useThemes } from '../../api/hooks';
import { noteOpenedBook, useOnline } from '../../lib/pwa';
import { useToast } from '../../lib/toast';
import { useViewport } from '../../lib/useViewport';
import { Lightbox, lbFrom, type LbItem, type LbState } from './Lightbox';
import { PinModal } from './PinModal';
import { ScrapbookPage, type Rect } from './ScrapbookPage';
import { blankPage, resolvePage, themeOf, type BookCtx, type RPage } from './resolve';
import s from './Reader.module.css';

interface Flip {
  dir: 'fwd' | 'back';
  to: number;
  deg: number;
  fromDeg: number;
  toDeg: number;
  anim: boolean;
}

const FLIP_MS = 950;

/** Hooks for the edit panel (Phase 5) to plug into the reader. */
export interface EditSlot {
  panel: (args: { L: number; single: boolean; ctx: BookCtx; goTo: (t: number) => void; selPhoto: string | null; setSelPhoto: (id: string | null) => void }) => ReactNode;
  pageDrop?: (side: 'L' | 'R', files: FileList, L: number, single: boolean) => void;
  /** Opens the photo picker for an empty page. */
  pickPhotos?: (side: 'L' | 'R', L: number, single: boolean) => void;
  /** Rearranges a photo by drag and drop. */
  movePhoto?: (photoId: string, toIdx: number, position: number) => void;
  onHero?: () => void;
}

export function Reader({ edit: editSlot, loading }: { edit?: EditSlot; loading?: Set<string> }) {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { vw, vh } = useViewport();
  const toast = useToast();
  const bookQ = useBook(id);
  const themes = useThemes().data;
  const data = bookQ.data;
  // One page at a time on narrow screens, and on a phone held sideways (two pages would be unreadable).
  const single = vw < 820 || (vh < 500 && vw < 1000);
  const online = useOnline();
  const startEditing = params.get('edit') === '1';

  const [pos, setPos] = useState(single ? 1 : 0);
  const [flip, setFlip] = useState<Flip | null>(null);
  const [coverOn, setCoverOn] = useState(!startEditing);
  const [coverDeg, setCoverDeg] = useState(0);
  const [coverShift, setCoverShift] = useState(!startEditing);
  const [closed, setClosed] = useState(false);
  const [closing, setClosing] = useState(false);
  const [editing, setEditing] = useState(startEditing);
  const [preview, setPreview] = useState(false);
  const [selPhoto, setSelPhoto] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [lb, setLb] = useState<LbState | null>(null);
  const [pageDrag, setPageDrag] = useState<'L' | 'R' | null>(null);
  const [photoDrag, setPhotoDrag] = useState<{ pid: string; x: number; y: number; w: number; h: number; src: string | null } | null>(null);
  const [dropHint, setDropHint] = useState<{ pid?: string; after?: boolean; pageIdx: number; position: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const later = (k: string, ms: number, fn: () => void) => {
    clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(fn, ms);
  };
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  // Open animation: the cover sits closed, then swings to −180° after 420ms over ~1200ms.
  const opened = useRef(false);
  useEffect(() => {
    if (!data || opened.current) return;
    opened.current = true;
    // A reload (or Back, then Forward) comes back to the page it was on, without the cover opening again.
    const p = Number(params.get('p'));
    if (!startEditing && params.has('p') && Number.isInteger(p) && p > 0 && p < data.pages.length) {
      setPos(single ? p : p - (p % 2));
      setCoverDeg(-180);
      setCoverShift(false);
      setCoverOn(false);
      return;
    }
    if (startEditing) {
      // "Edit pages" from the Desk jumps to the first year; the inbox's "Open" passes ?pos.
      const want = Number(params.get('pos'));
      const y = chapters(data.pages).years[0];
      const at = Number.isFinite(want) && params.has('pos') ? want : y?.idx;
      if (at != null) setPos(single ? at : at - (at % 2));
      return;
    }
    later('c1', 420, () => {
      setCoverDeg(-180);
      setCoverShift(false);
    });
    later('c2', 420 + 1200, () => setCoverOn(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Keep this book's photos for offline reading (the service worker keeps the last three books).
  useEffect(() => {
    if (!data) return;
    const urls = data.pages.flatMap((p) => [...p.photos.map((ph) => ph.thumbUrl), p.hero?.displayUrl ?? null]).filter((u): u is string => !!u);
    noteOpenedBook(data.book.id, urls);
  }, [data]);

  // Edits need the server, so they pause while offline.
  useEffect(() => {
    if (!online && editing) {
      setEditing(false);
      setPreview(false);
      toast("You're offline, so editing is paused. Your saved changes are safe.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const ctx: BookCtx | null = useMemo(
    () => (data && themes ? { pages: data.pages, themes, owner: data.book.owner, color: data.book.color, family: data.book.family, loading } : null),
    [data, themes, loading],
  );
  const n = data?.pages.length ?? 0;
  const L = single ? pos : pos - (pos % 2);
  // The page goes in the address (replaced, not pushed), so a reload comes back to it.
  useEffect(() => {
    if (!data || coverOn) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get('p') === String(pos)) return;
    if (pos > 0) q.set('p', String(pos));
    else q.delete('p');
    const query = q.toString();
    history.replaceState(history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [pos, coverOn, data]);
  const max = single ? n - 1 : n - 2;

  const goTo = useCallback(
    (target: number) => {
      if (flip || coverOn || !n) return;
      let t = target;
      if (!single) t = t - (t % 2);
      if (t < 0 || t > max || t === L) return;
      const fwd = t > L;
      const fromDeg = single ? (fwd ? 0 : -180) : 0;
      const toDeg = single ? (fwd ? -180 : 0) : fwd ? -180 : 180;
      setPos(L);
      setSelPhoto(null);
      setFlip({ dir: fwd ? 'fwd' : 'back', to: t, deg: fromDeg, fromDeg, toDeg, anim: false });
      requestAnimationFrame(() => requestAnimationFrame(() => setFlip((f) => (f ? { ...f, deg: toDeg, anim: true } : f))));
      later('flip', FLIP_MS + 40, () => {
        setPos(t);
        setFlip(null);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flip, coverOn, n, single, max, L],
  );

  const closeCover = () => {
    if (flip || coverOn) return;
    clearTimeout(timers.current.c1);
    clearTimeout(timers.current.c2);
    setCoverOn(true);
    setCoverDeg(-180);
    setCoverShift(false);
    setClosing(true);
    setClosed(true);
    setSelPhoto(null);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setCoverDeg(0);
        setCoverShift(true);
      }),
    );
    later('c1', 1200, () => setClosing(false));
  };
  const reopenCover = () => {
    if (!closed || closing) return;
    clearTimeout(timers.current.c1);
    clearTimeout(timers.current.c2);
    setClosed(false);
    setCoverDeg(-180);
    setCoverShift(false);
    later('c2', 1200, () => setCoverOn(false));
  };
  const next = () => (closed ? reopenCover() : goTo(L + (single ? 1 : 2)));
  const prev = () => {
    if (closed) return;
    if (L <= (single ? 1 : 0)) return closeCover();
    goTo(L - (single ? 1 : 2));
  };

  const panelOn = editing && !preview;
  const idxs = single ? [L] : [L, L + 1];

  // Lightbox: photos on the current spread (or the hero on the title page).
  const lbList: LbItem[] = useMemo(() => {
    if (!ctx) return [];
    return idxs.flatMap((i) => {
      const pg = ctx.pages[i];
      if (!pg) return [];
      if (pg.type === 'title' && pg.hero) {
        const r = resolvePage(ctx, i, single)!.hero!;
        return [{ ...r, page: i }];
      }
      const rp = resolvePage(ctx, i, single);
      return (rp?.photos ?? []).map((p) => ({ ...p, page: i }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, L, single]);

  // An open photo has its own history entry, so the phone's Back button closes it and stays in the book.
  const lbHistory = useRef(false);
  const openLightbox = useCallback(
    (pid: string, rect: Rect) => {
      if (flip || lb) return;
      setLb({ pid, from: lbFrom(rect, vw, vh), anim: false, open: false });
      requestAnimationFrame(() => requestAnimationFrame(() => setLb((x) => (x ? { ...x, anim: true, open: true } : x))));
      if (!lbHistory.current) {
        history.pushState(history.state, '');
        lbHistory.current = true;
      }
    },
    [flip, lb, vw, vh],
  );
  /** Closing by the ✕, Escape or the backdrop takes back the history entry the photo added. */
  const closeLightbox = useCallback(() => {
    if (lbHistory.current) {
      lbHistory.current = false;
      history.back();
    }
    hideLightbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vw, vh]);
  useEffect(() => {
    const onPop = () => {
      if (!lbHistory.current) return;
      lbHistory.current = false;
      hideLightbox();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vw, vh]);
  const hideLightbox = () => {
    setLb((cur) => {
      if (!cur || cur.closing) return cur;
      const el = rootRef.current?.querySelector(`[data-pid="${cur.pid}"]`);
      let from = cur.from;
      if (el) {
        const r = el.getBoundingClientRect();
        from = lbFrom({ x: r.left, y: r.top, w: r.width, h: r.height }, vw, vh);
      }
      return { ...cur, from, open: false, closing: true };
    });
    later('lb', 460, () => setLb(null));
  };
  const stepLightbox = useCallback(
    (d: number) => {
      setLb((cur) => {
        if (!cur || cur.closing || lbList.length < 2) return cur;
        const i = lbList.findIndex((p) => p.id === cur.pid);
        return { ...cur, pid: lbList[(i + d + lbList.length) % lbList.length]!.id };
      });
    },
    [lbList],
  );

  // Keyboard: arrows turn pages (or step the lightbox), Escape closes.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (pinOpen) return;
    if (lb) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') (e.preventDefault(), stepLightbox(1));
      if (e.key === 'ArrowLeft') (e.preventDefault(), stepLightbox(-1));
      return;
    }
    const tag = (e.target as HTMLElement | null)?.tagName ?? '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (e.key === 'ArrowRight') (e.preventDefault(), next());
    if (e.key === 'ArrowLeft') (e.preventDefault(), prev());
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  if (bookQ.error) {
    return (
      <section className={s.missing}>
        <p>That book isn't on the shelf any more.</p>
        <button className={s.pill} onClick={() => nav('/')}>Back to the library</button>
      </section>
    );
  }
  if (!data || !ctx) return <section className={s.stage} />;

  const { book } = data;
  const wide = vw >= 1100;
  const panelW = panelOn && wide ? 440 : 0;
  const availW = vw - panelW - (single ? 32 : 300);
  const mob = vw < 600;
  const availH = vh - 68 - (mob ? 190 : single ? 160 : 170);
  const pscale = Math.max(0.28, Math.min(availW / (single ? 600 : 1200), availH / 750, 1.3));
  const pageW = Math.round(600 * pscale);
  const bookH = Math.round(750 * pscale);
  const bookW = single ? pageW : pageW * 2;

  const P = (i: number): RPage | null => resolvePage(ctx, i, single);
  const BLANK = blankPage();
  let left: RPage | null = null;
  let right: RPage | null = null;
  let front: RPage | null = null;
  let back: RPage | null = null;
  let flipLeft = 0;
  let origin = 'left center';
  const f = flip;
  if (single) {
    right = P(L);
    if (f) {
      if (f.dir === 'fwd') {
        right = P(f.to);
        front = P(L);
      } else {
        right = P(L);
        front = P(f.to);
      }
      back = BLANK;
    }
  } else {
    left = P(L);
    right = P(L + 1);
    if (f) {
      if (f.dir === 'fwd') {
        right = P(f.to + 1);
        front = P(L + 1);
        back = P(f.to);
        flipLeft = pageW;
        origin = 'left center';
      } else {
        left = P(f.to);
        front = P(L);
        back = P(f.to + 1);
        flipLeft = 0;
        origin = 'right center';
      }
    }
  }
  const fromF = f && f.fromDeg !== 0 ? 1 : 0;
  const frontShade = f ? (f.anim ? 1 - fromF : fromF) : 0;
  const nums = idxs.filter((i) => i >= 1 && i <= n - 2);
  const total = n - 2;
  const counter = closed
    ? 'Cover'
    : nums.length === 0
      ? L === 0
        ? 'Inside cover'
        : 'Back cover'
      : nums.length === 1
        ? `Page ${nums[0]} of ${total}`
        : `Pages ${nums[0]}–${nums[1]} of ${total}`;

  // Ribbons: Contents, each year, and the months of the year in view.
  const ch = chapters(data.pages);
  const fy = data.pages[L]?.year ?? data.pages[L + 1]?.year ?? (ch.months.length ? ch.months[ch.months.length - 1]!.year : null);
  const ribDefs: [string, number, string?][] = [['Contents', data.pages.findIndex((p) => p.type === 'index'), '#8C6A4A']];
  ch.years.forEach((y) => {
    ribDefs.push([String(y.year), y.idx]);
    if (y.year === fy) ch.months.filter((m) => m.year === y.year).forEach((m) => ribDefs.push([m.short, m.idx]));
  });
  const ribbons = ribDefs.map(([label, t, c], i) => {
    const active = L === t || (single && L === t + 1);
    return { label, t, top: 30 + i * 50, color: c ?? themeOf(ctx.themes, data.pages[t]?.themeId ?? 'cream').accent, shift: active ? 14 : 0, weight: active ? 700 : 500 };
  });

  const titleText = data.pages.find((p) => p.type === 'title')?.text ?? {};
  const coverFoil = book.texture === 'leather' ? '#E6C77E' : book.texture === 'linen' ? '#3A3026' : isLight(book.color) ? '#2B2621' : '#FFF6EA';
  const coverFam = titleText.family?.trim() || `The ${book.family} family`;
  const coverName = book.spineText.trim() || titleText.plateName?.trim() || book.owner;
  const coverTitle = titleText.title?.trim() || 'Year in Review';
  const editLocked = book.locked && !book.canEdit;

  const setRead = () => {
    setEditing(false);
    setPreview(false);
    setSelPhoto(null);
    if (params.get('edit')) {
      params.delete('edit');
      setParams(params, { replace: true });
    }
  };
  const setEdit = () => {
    if (!online) return toast("You're offline. Editing comes back when you reconnect.");
    if (closed) {
      setClosed(false);
      setClosing(false);
      setCoverOn(false);
      setCoverShift(false);
    }
    if (editLocked) return setPinOpen(true);
    setEditing(true);
    setPreview(false);
    setCoverOn(false);
  };
  const onUnlocked = () => {
    setEditing(true);
    setPreview(false);
    setCoverOn(false);
    void qc.invalidateQueries({ queryKey: qk.book(book.id) });
    void qc.invalidateQueries({ queryKey: qk.library });
    void qc.invalidateQueries({ queryKey: qk.me });
  };

  // Photos dropped straight onto a page (edit mode only).
  const canDrop = panelOn && !!editSlot?.pageDrop;
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const over = (k: 'L' | 'R') => (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canDrop ? 'copy' : 'none';
    if (canDrop && pageDrag !== k) setPageDrag(k);
  };
  const drop = (k: 'L' | 'R') => (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setPageDrag(null);
    if (!canDrop) return toast('Switch to Edit to add photos.');
    editSlot!.pageDrop!(k, e.dataTransfer.files, L, single);
  };
  const leave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setPageDrag(null);
  };
  const dropZone = (
    <div className={s.dropZone}>
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
      <span>Drop to add to this page</span>
    </div>
  );

  /** What's under the pointer while dragging a photo: before/after another photo, or the end of a page. */
  const hitTest = (x: number, y: number, pid: string) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const ph = el.closest<HTMLElement>('[data-pid]');
      if (ph && ph.dataset.pid === pid) return null;
      if (ph?.dataset.pageIdx) {
        const r = ph.getBoundingClientRect();
        const after = x > r.left + r.width / 2;
        return { pid: ph.dataset.pid, after, pageIdx: +ph.dataset.pageIdx, position: +(ph.dataset.pos ?? 0) + (after ? 1 : 0) };
      }
      const frame = el.closest<HTMLElement>('[data-page-idx]');
      if (frame && !frame.dataset.pid) return { pageIdx: +frame.dataset.pageIdx!, position: frame.querySelectorAll('[data-pid]').length };
    }
    return null;
  };

  const startPhotoDrag = (e: React.PointerEvent<HTMLDivElement>, pid: string) => {
    if (!editSlot?.movePhoto || e.button !== 0) return;
    // A mouse drags at once. A finger presses and holds first (like a phone's home screen), so a
    // quick swipe that starts on a photo still turns the page.
    const touch = e.pointerType !== 'mouse';
    if (!touch) e.stopPropagation(); // not a page swipe
    const r = e.currentTarget.getBoundingClientRect();
    const st = { sx: e.clientX, sy: e.clientY, armed: !touch, active: false, hint: null as ReturnType<typeof hitTest> };
    const src = e.currentTarget.querySelector('img')?.getAttribute('src') ?? null;
    const hold = touch
      ? setTimeout(() => {
          st.armed = true;
          swipe.current = null; // this touch is a drag now, not a swipe
          navigator.vibrate?.(10);
        }, 350)
      : undefined;
    const move = (ev: PointerEvent) => {
      if (!st.armed) {
        // Moved before the hold: it's a swipe or a scroll, so let it be.
        if (Math.hypot(ev.clientX - st.sx, ev.clientY - st.sy) > 8) stop();
        return;
      }
      if (!st.active) {
        if (Math.hypot(ev.clientX - st.sx, ev.clientY - st.sy) < 6) return;
        st.active = true;
      }
      ev.preventDefault();
      st.hint = hitTest(ev.clientX, ev.clientY, pid);
      setPhotoDrag({ pid, x: ev.clientX, y: ev.clientY, w: r.width, h: r.height, src });
      setDropHint(st.hint);
    };
    const stop = () => {
      clearTimeout(hold);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    const end = () => {
      stop();
      if (st.active && st.hint) editSlot.movePhoto!(pid, st.hint.pageIdx, st.hint.position);
      setPhotoDrag(null);
      setDropHint(null);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const pageProps = {
    scale: pscale,
    editMode: panelOn,
    selectedId: selPhoto,
    onPhoto: (pid: string) => setSelPhoto(pid),
    onJump: (t: number) => goTo(t),
    onOpen: panelOn ? null : openLightbox,
    onHero: editSlot?.onHero,
    onPhotoPointerDown: panelOn && editSlot?.movePhoto ? startPhotoDrag : undefined,
    dragId: photoDrag?.pid ?? null,
    dropHint,
  };
  // Clicking an empty photo area: pick photos while editing, or start editing while reading.
  const emptyFor = (side: 'L' | 'R') =>
    panelOn ? (editSlot?.pickPhotos ? () => editSlot.pickPhotos!(side, L, single) : undefined) : editing ? undefined : setEdit;
  const leftShown = !single && !(coverOn && coverShift) && !(coverOn && coverDeg === 0);

  return (
    <section
      ref={rootRef}
      className={s.section}
      style={{ gridTemplateColumns: panelOn && wide ? 'minmax(0,1fr) 440px' : 'minmax(0,1fr)' }}
    >
      <div className={s.stageCol} style={{ height: wide || !panelOn ? 'calc(100dvh - 68px)' : 'auto', minHeight: bookH + 170 }}>
        <div className={s.toolbar} style={{ padding: mob ? '12px 12px 0' : '18px 24px 0' }}>
          <button className={s.back} onClick={() => nav('/')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            Library
          </button>
          <div className={s.bookTitle} style={{ flexBasis: mob ? '100%' : '0%', order: mob ? -1 : 0 }}>{book.title}</div>
          {editing && (
            <button className={s.previewBtn} onClick={() => (setPreview(!preview), setSelPhoto(null))}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
              Preview
              <span className={s.previewTrack} style={{ background: preview ? 'var(--accent)' : 'var(--tan)' }}>
                <span className={s.previewKnob} style={{ transform: `translateX(${preview ? 18 : 0}px)` }} />
              </span>
            </button>
          )}
          <div className={s.seg}>
            <button onClick={setRead} style={{ background: editing ? 'transparent' : 'var(--surface)', color: editing ? 'var(--ink2)' : 'var(--ink)' }}>Read</button>
            <button onClick={setEdit} style={{ background: editing ? 'var(--surface)' : 'transparent', color: editing ? 'var(--ink)' : 'var(--ink2)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
              Edit
              {editLocked && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-label="PIN needed"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
              )}
            </button>
          </div>
        </div>

        <div className={s.bookArea}>
          <button className={`${s.sideArrow} ${s.sidePrev}`} onClick={prev} aria-label="Previous page" style={{ display: mob ? 'none' : 'flex', opacity: closed ? 0.3 : 1 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button className={`${s.sideArrow} ${s.sideNext}`} onClick={next} aria-label="Next page" style={{ display: mob ? 'none' : 'flex', opacity: !closed && L >= max ? 0.3 : 1 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>

          <div
            className={s.book}
            onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
            onPointerUp={(e) => {
              const st = swipe.current;
              swipe.current = null;
              if (!st) return;
              const dx = e.clientX - st.x;
              const dy = e.clientY - st.y;
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)();
            }}
            style={{ width: bookW, height: bookH, transform: `translateX(${coverShift && !single ? -Math.round(pageW / 2) : 0}px)` }}
          >
            <div className={s.board} style={{ background: spineBg(book, true), opacity: coverShift ? 0 : 1 }} />
            <div className={s.edgeR} style={{ opacity: coverShift ? 0 : 1 }} />
            {!single && <div className={s.edgeL} style={{ opacity: coverShift ? 0 : 1 }} />}

            {leftShown && (
              <div className={s.pageL} onDragOver={over('L')} onDragLeave={leave} onDrop={drop('L')} style={{ width: pageW, height: bookH }}>
                {pageDrag === 'L' && canDrop && dropZone}
                <ScrapbookPage page={left} {...pageProps} onEmpty={emptyFor('L')} />
              </div>
            )}
            <div className={s.pageR} onDragOver={over('R')} onDragLeave={leave} onDrop={drop('R')} style={{ left: single ? 0 : pageW, width: pageW, height: bookH }}>
              {pageDrag === 'R' && canDrop && dropZone}
              <ScrapbookPage page={right} {...pageProps} onEmpty={emptyFor('R')} />
            </div>

            {!panelOn && (
              <>
                <div className={`${s.corner} ${s.cornerR}`} onClick={next} title="Next page" />
                {!single && <div className={`${s.corner} ${s.cornerL}`} onClick={prev} title="Previous page" />}
              </>
            )}

            {f && (
              <div
                className={s.flip}
                style={{ left: flipLeft, width: pageW, height: bookH, transformOrigin: origin, transform: `rotateY(${f.deg}deg)`, transition: f.anim ? `transform ${FLIP_MS}ms cubic-bezier(.6,.04,.26,1)` : 'none' }}
              >
                <div className={s.face}>
                  <ScrapbookPage page={front} scale={pscale} />
                  <div className={s.shade} style={{ background: 'linear-gradient(90deg, rgba(40,25,10,.28), rgba(40,25,10,.06) 55%, rgba(255,255,255,.12))', opacity: frontShade, transition: f.anim ? `opacity ${FLIP_MS}ms ease-in-out` : 'none' }} />
                </div>
                <div className={s.face} style={{ transform: 'rotateY(180deg)' }}>
                  <ScrapbookPage page={back} scale={pscale} />
                  <div className={s.shade} style={{ background: 'linear-gradient(270deg, rgba(40,25,10,.28), rgba(40,25,10,.06) 55%, rgba(255,255,255,.12))', opacity: 1 - frontShade, transition: f.anim ? `opacity ${FLIP_MS}ms ease-in-out` : 'none' }} />
                </div>
              </div>
            )}

            {coverOn && (
              <div
                className={s.cover}
                onClick={reopenCover}
                style={{ left: single ? 0 : pageW, width: pageW, height: `calc(${bookH}px + 20px)`, transform: `rotateY(${coverDeg}deg)`, transition: coverDeg || closing ? 'transform 1150ms cubic-bezier(.55,.04,.25,1)' : 'none' }}
              >
                <div className={s.coverFront} style={{ background: spineBg(book, true) }}>
                  <div className={s.coverInner} style={{ transform: `scale(${pscale})` }}>
                    <div className={s.coverFrame} style={{ border: `1.5px solid ${coverFoil}` }} />
                    <div className={s.coverLabel} style={{ color: coverFoil, background: book.texture === 'linen' ? '#F2E9D8' : 'transparent' }}>
                      <div className={s.coverFam}>{coverFam}</div>
                      <div className={s.coverName}>{coverName}</div>
                      <div className={s.coverRule} />
                      <div className={s.coverTitle}>{coverTitle}</div>
                    </div>
                  </div>
                </div>
                <div className={s.coverBack}>
                  <ScrapbookPage page={single ? BLANK : P(0)} scale={pscale} />
                </div>
              </div>
            )}

            {!single && bookH > 360 &&
              ribbons.map((r) => (
                <button
                  key={`${r.label}-${r.t}`}
                  className={s.ribbon}
                  onClick={(e) => (e.stopPropagation(), goTo(r.t))}
                  style={{ left: bookW + 6, top: r.top, background: r.color, fontWeight: r.weight, transform: `translateX(${r.shift}px)`, opacity: coverShift ? 0 : 1 }}
                >
                  {r.label}
                </button>
              ))}
          </div>
        </div>

        <div className={s.footer} style={{ padding: mob ? '0 16px 16px' : '0 28px 22px' }}>
          <span style={{ display: mob ? 'none' : 'inline' }}>Swipe, tap a corner, or use ← → to turn pages</span>
          <button className={s.footArrow} onClick={prev} aria-label="Previous page" style={{ display: mob ? 'flex' : 'none', opacity: closed ? 0.3 : 1 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className={s.counter}>{counter}</span>
          <button className={s.footArrow} onClick={next} aria-label="Next page" style={{ display: mob ? 'flex' : 'none', opacity: !closed && L >= max ? 0.3 : 1 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
      </div>

      {panelOn && editSlot?.panel({ L, single, ctx, goTo, selPhoto, setSelPhoto })}

      {photoDrag && (
        <div
          className={s.ghost}
          style={{
            left: photoDrag.x - photoDrag.w / 2,
            top: photoDrag.y - photoDrag.h / 2,
            width: photoDrag.w,
            height: photoDrag.h,
            backgroundImage: photoDrag.src ? `url(${photoDrag.src})` : undefined,
          }}
        />
      )}
      {pinOpen && <PinModal book={book} onClose={() => setPinOpen(false)} onUnlocked={onUnlocked} />}
      {lb && <Lightbox lb={lb} list={lbList} vw={vw} vh={vh} onClose={closeLightbox} onStep={stepLightbox} />}
    </section>
  );
}
