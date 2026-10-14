import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TEXTURES, yearsLabel } from '@memento/shared';
import { useLibrary, useMe } from '../../api/hooks';
import { landingText, updatedLabel } from '../../lib/landing';
import { useViewport } from '../../lib/useViewport';
import { Spine } from './Spine';
import { InstallPrompt } from '../../components/InstallPrompt';
import s from './Shelf.module.css';

export function Shelf() {
  const { vw } = useViewport();
  const nav = useNavigate();
  const me = useMe().data;
  const lib = useLibrary().data;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hop, setHop] = useState(false);
  const [liftId, setLiftId] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  if (!lib || !me) return <section className={s.section} />;

  const isAdmin = me.user.access === 'admin';
  const canDesk = me.deskTabs.length > 0;
  const L = landingText(lib.settings.familyName, lib.settings.landing);
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  // Every book plays one full hop, 70ms after the one to its left. The wave lasts
  // as long as the shelf needs, so long shelves hop to the end.
  const HOP_MS = 720;
  const hopBooks = () => {
    if (hop || !lib) return;
    setHop(true);
    setHoverId(null);
    later((lib.books.length - 1) * 70 + HOP_MS + 40, () => setHop(false));
  };
  const clickBook = (id: string) => {
    if (liftId) return;
    setLiftId(id);
    later(300, () => {
      setLiftId(null);
      nav(`/book/${id}`);
    });
  };

  // Rows wrap at (vw<600 ? 720 : 900) − 168px. Each book takes w + 5. The last row ends with the "New book" slot.
  const cap = (vw < 600 ? 720 : 900) - 80 - 88;
  type Item = { book?: (typeof lib.books)[number]; w: number; h: number; i: number };
  const items: Item[] = lib.books.map((b, i) => ({ book: b, w: b.width, h: b.height, i }));
  if (isAdmin) items.push({ w: 76, h: 330, i: -1 });
  const rows: Item[][] = [[]];
  let used = 0;
  for (const it of items) {
    const bw = it.w + 5;
    if (used + bw > cap && rows[rows.length - 1]!.length) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1]!.push(it);
    used += bw;
  }
  const zoom = Math.min(1, (vw - 32) / (vw < 600 ? 720 : 900));
  const hov = hoverId ? lib.books.find((b) => b.id === hoverId) : undefined;
  const unlocked = new Set(me.unlocks.map((u) => u.bookId));

  return (
    <section className={s.section} style={{ padding: `${vw < 600 ? 40 : 64}px 16px 90px` }}>
      <div className={s.kicker}>{L.kicker}</div>
      <h1 className={s.h1}>{L.head}</h1>
      <p className={s.intro}>{L.intro}</p>
      <div className={s.ctaRow}>
        <button className={s.cta} onClick={hopBooks}>
          {L.btn1}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
        {canDesk && (
          <button className={s.cta2} onClick={() => nav('/desk')}>
            {L.btn2}
          </button>
        )}
      </div>

      <div className={s.shelfWrap} style={{ marginTop: vw < 600 ? 36 : 64 }}>
        <div className={s.zoom} style={{ zoom }}>
          {rows.map((row, ri) => {
            const isLast = ri === rows.length - 1;
            const books = row.filter((x) => x.book);
            const minH = Math.max(...row.map((x) => x.h)) + 40;
            return (
              <div key={ri}>
                <div className={s.row} style={{ minHeight: minH }}>
                  <div className={s.bookendL} />
                  {books.map(({ book: b, i }) => (
                    <Spine
                      key={b!.id}
                      b={b!}
                      lift={liftId === b!.id ? -48 : 0}
                      hopDelay={hop ? i * 70 : null}
                      showLock={b!.locked && !unlocked.has(b!.id) && !isAdmin}
                      onClick={() => clickBook(b!.id)}
                      onEnter={() => setHoverId(b!.id)}
                      onLeave={() => setHoverId(null)}
                    />
                  ))}
                  {isLast && isAdmin && (
                    <div className={s.newBook} role="button" tabIndex={0} onClick={() => nav('/desk/books?new=1')} onKeyDown={(e) => e.key === 'Enter' && nav('/desk/books?new=1')}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                      <span className={s.newBookLabel}>New book</span>
                    </div>
                  )}
                  <div className={s.bookendR} />
                </div>
                <div className={s.plankTop} />
                <div className={s.plank} />
              </div>
            );
          })}
        </div>
        <div className={s.plate}>
          <div className={s.plateTitle}>{hov ? hov.title : 'Tap a spine to open it'}</div>
          <div className={s.plateSub}>
            <span>
              {hov
                ? `${TEXTURES[hov.texture].label} · ${yearsLabel(hov.years, true)} · ${hov.pageCount} pages · updated ${updatedLabel(hov.updatedAt)}`
                : `${lib.books.length} books on the shelf`}
            </span>
          </div>
        </div>
      </div>

      <InstallPrompt />
      {canDesk && (
        <button className={s.fab} onClick={() => nav('/desk')} title="Editor's Desk" aria-label="Editor's Desk" style={{ right: vw < 600 ? 16 : 28, bottom: vw < 600 ? 16 : 28 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        </button>
      )}
    </section>
  );
}
