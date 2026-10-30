import { useEffect, useRef, useState } from 'react';
import { useOnline } from '../../lib/pwa';
import type { Rect } from './ScrapbookPage';
import type { RPhoto } from './resolve';
import s from './Lightbox.module.css';

export interface LbItem extends RPhoto { page: number }

export interface LbState {
  pid: string;
  from: string;
  anim: boolean;
  open: boolean;
  closing?: boolean;
}

/** Card size: min(vw − (vw<600?32:150), 760, (vh−190)/0.9); image is 0.68 of the width. */
export function lbSize(vw: number, vh: number) {
  const W = Math.round(Math.min(vw - (vw < 600 ? 32 : 150), 760, (vh - 190) / 0.9));
  return { W, imgH: Math.round(W * 0.68) };
}

/** Transform that places the centred card over the photo's on-page rect. */
export function lbFrom(rect: Rect | null, vw: number, vh: number, rot = 0) {
  const { W } = lbSize(vw, vh);
  if (!rect) return 'translate(0px, 40px) scale(.85) rotate(0deg)';
  const dx = rect.x + rect.w / 2 - vw / 2;
  const dy = rect.y + rect.h / 2 - vh / 2;
  return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${(rect.w / W).toFixed(3)}) rotate(${rot}deg)`;
}

export function Lightbox({ lb, list, vw, vh, onClose, onStep }: { lb: LbState; list: LbItem[]; vw: number; vh: number; onClose: () => void; onStep: (d: number) => void }) {
  const idx = list.findIndex((p) => p.id === lb.pid);
  const p = list[idx];
  const { W, imgH: frameH } = lbSize(vw, vh);
  const [loaded, setLoaded] = useState<string | null>(null);
  const online = useOnline();
  const swipe = useRef<number | null>(null);
  useEffect(() => setLoaded(null), [lb.pid]);
  if (!p) return null;
  // A portrait video gets a tall frame (as tall as the screen allows), not a letterbox.
  const portrait = !!p.video && !!p.width && !!p.height && p.height > p.width;
  const imgH = portrait ? Math.round(Math.min(vh - 210, (W * p.height!) / p.width!)) : frameH;
  const arrowX = vw < 600 ? 8 : 24;
  const backOp = lb.open ? 1 : 0;
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div className={s.wrap} onClick={onClose} role="dialog" aria-modal="true" aria-label={p.caption || p.subject || (p.video ? 'Video' : 'Photo')}>
      <div className={s.back} style={{ opacity: backOp }} />
      <div
        className={s.card}
        onClick={(e) => e.stopPropagation()}
        // A sideways swipe steps to the next or previous photo, as on a phone's own gallery.
        // Not on the video, where a sideways drag scrubs through it.
        onPointerDown={(e) => (swipe.current = (e.target as HTMLElement).tagName === 'VIDEO' ? null : e.clientX)}
        onPointerUp={(e) => {
          const from = swipe.current;
          swipe.current = null;
          if (from != null && Math.abs(e.clientX - from) > 50 && list.length > 1) onStep(e.clientX < from ? 1 : -1);
        }}
        style={{ width: W, transform: lb.open ? 'translate(0px,0px) scale(1) rotate(-1deg)' : lb.from, transition: lb.anim ? 'transform .46s cubic-bezier(.2,.9,.25,1.05)' : 'none' }}
      >
        <div className={s.tape} />
        <div className={s.img} style={{ height: imgH, background: `repeating-linear-gradient(135deg, rgba(255,255,255,.22) 0 12px, transparent 12px 24px), oklch(0.84 0.055 ${p.hue ?? 60})` }}>
          {p.video ? (
            <>
              <video key={p.id} src={p.video} poster={p.full ?? p.src ?? undefined} controls playsInline preload="metadata" className={s.video} />
              {!online && <div className={s.offline}>Videos need a connection. Photos still work offline.</div>}
            </>
          ) : (
            <>
              {p.src && <img src={p.src} alt="" className={s.cover} />}
              {p.full && p.full !== p.src && <img src={p.full} alt="" className={s.cover} style={{ opacity: loaded === p.id ? 1 : 0 }} onLoad={() => setLoaded(p.id)} />}
              {!p.src && <span className={s.subject}>{p.subject}</span>}
            </>
          )}
        </div>
        <div className={s.foot}>
          <div className={s.caption} style={{ fontSize: W > 600 ? 34 : 28 }}>{p.caption}</div>
          <div className={s.meta}>{p.page != null ? `p. ${p.page}` : ''}</div>
        </div>
      </div>
      <button className={s.btn} onClick={stop(onClose)} aria-label="Close" style={{ top: arrowX, right: arrowX, width: 48, height: 48, opacity: backOp }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      {list.length > 1 && (
        <>
          <button className={`${s.btn} ${s.prev}`} onClick={stop(() => onStep(-1))} aria-label="Previous photo" style={{ left: arrowX, opacity: backOp }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button className={`${s.btn} ${s.next}`} onClick={stop(() => onStep(1))} aria-label="Next photo" style={{ right: arrowX, opacity: backOp }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
          <div className={s.count} style={{ opacity: backOp }}>{idx + 1} / {list.length}</div>
        </>
      )}
    </div>
  );
}
