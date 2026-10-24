import { isLight, spineBg } from '@memento/shared';
import type { LibraryBook } from '../../api/types';
import s from './Shelf.module.css';

/** One upright book on the shelf, drawn per texture exactly as the prototype does. */
export function Spine({
  b,
  lift,
  hopDelay,
  showLock,
  onClick,
  onEnter,
  onLeave,
}: {
  b: LibraryBook;
  /** Upward shift while the book is being pulled off the shelf. */
  lift: number;
  /** Start delay of the "Open a book" hop, or null when not hopping. */
  hopDelay: number | null;
  showLock: boolean;
  onClick: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const name = b.spineText.trim() || b.owner;
  const fs = name.length > 16 ? 16 : name.length > 10 ? 19 : 22;
  const fsm = name.length > 16 ? 11 : name.length > 10 ? 13 : 15;
  const fg = isLight(b.color) ? '#2B2621' : '#FFF6EA';
  const band = { position: 'absolute', left: 0, right: 0, height: 9, background: 'linear-gradient(rgba(0,0,0,.35), rgba(255,255,255,.18) 45%, rgba(0,0,0,.35))' } as const;

  return (
    <div
      className={hopDelay != null ? `${s.spine} ${s.hopping}` : s.spine}
      role="button"
      tabIndex={0}
      aria-label={`Open ${b.title}`}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      style={{ width: b.width, height: b.height, translate: `0 ${lift}px`, animationDelay: hopDelay != null ? `${hopDelay}ms` : undefined, background: spineBg(b) }}
    >
      {b.texture === 'leather' && (
        <>
          <div style={{ position: 'absolute', inset: 6, border: '1px dashed rgba(240,210,150,.4)', borderRadius: 2, pointerEvents: 'none' }} />
          <div style={{ ...band, top: 40 }} />
          <div style={{ ...band, top: 56 }} />
          <div style={{ ...band, bottom: 74 }} />
          <div className={s.spineText} style={{ top: 84, bottom: 96, font: `500 ${fs}px/1 var(--font-display)`, letterSpacing: '.08em', color: '#E6C77E', textShadow: '0 1px 0 rgba(0,0,0,.5), 0 0 1px rgba(255,230,160,.6)' }}>
            {name}
          </div>
        </>
      )}
      {b.texture === 'linen' && (
        <>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 22, height: 5, background: 'rgba(0,0,0,.18)' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 26, height: 5, background: 'rgba(0,0,0,.18)' }} />
          <div
            className={s.spineText}
            style={{ left: '12%', right: '12%', top: 70, bottom: 100, background: '#F2E9D8', borderRadius: 2, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.25)', font: `italic 500 ${fs}px/1 var(--font-display)`, color: '#3A3026', letterSpacing: '.02em' }}
          >
            {name}
          </div>
        </>
      )}
      {b.texture === 'matte' && (
        <div className={s.spineText} style={{ top: 84, bottom: 96, font: `600 ${fsm}px/1 var(--font-ui)`, letterSpacing: '.24em', textTransform: 'uppercase', color: fg }}>
          {name}
        </div>
      )}
      {showLock && (
        <div className={s.lock} style={{ background: 'linear-gradient(#E9CD8A, #B8914A)', color: '#4A3413' }} title="PIN needed to edit">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        </div>
      )}
    </div>
  );
}
