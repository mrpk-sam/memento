import { useEffect, useRef, useState } from 'react';
import { spineBg } from '@memento/shared';
import { ApiError, api } from '../../api/client';
import { useViewport } from '../../lib/useViewport';
import s from './PinModal.module.css';

interface Props {
  book: { id: string; title: string; texture: string; color: string; hasPin: boolean };
  onClose: () => void;
  /** Called once the unlock animation has played, as the modal fades out. */
  onUnlocked: () => void;
}

/** The 4-digit PIN modal. Ported from the prototype's onPin() and modal markup. */
export function PinModal({ book, onClose, onUnlocked }: Props) {
  const { vw } = useViewport();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [success, setSuccess] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !success && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      timers.current.forEach(clearTimeout);
    };
  }, [onClose, success]);

  async function onChange(v: string) {
    const next = v.replace(/\D/g, '').slice(0, 4);
    setPin(next);
    setError(null);
    if (next.length < 4 || busy) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 180));
    try {
      await api(`/books/${book.id}/unlock`, { body: { pin: next } });
      setSuccess(true);
      timers.current.push(
        setTimeout(() => {
          setLeaving(true);
          onUnlocked();
          timers.current.push(setTimeout(onClose, 520));
        }, 620),
      );
    } catch (e) {
      setPin('');
      setShake((n) => n + 1);
      // Say how many tries are left, so the lockout doesn't come as a surprise.
      const left = e instanceof ApiError && typeof e.data.remaining === 'number' ? e.data.remaining : null;
      const base = e instanceof ApiError ? e.message : "That's not it. Try again.";
      setError(left != null && left < 5 ? `${base} ${left} ${left === 1 ? 'try' : 'tries'} left.` : base);
      ref.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const narrow = vw < 600;
  const msg = success ? 'Unlocked. Editing on.' : error ?? 'Ask a family admin if you don’t know it.';
  const msgColor = success ? '#5E8B5A' : error ? '#C0443A' : 'var(--ink2)';

  return (
    <div
      className={s.back}
      onClick={() => !success && onClose()}
      style={{ animation: leaving ? 'kfadeout .5s ease forwards' : 'kfade .25s ease both', pointerEvents: success ? 'none' : 'auto' }}
    >
      <div
        className={s.card}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${book.title}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: narrow ? 22 : 30,
          gridTemplateColumns: narrow ? '52px minmax(0,1fr)' : '78px minmax(0,1fr)',
          gap: narrow ? 16 : 24,
          animation: success || leaving ? 'none' : shake ? `kshake${shake % 2} .42s ease` : 'kpop .3s cubic-bezier(.3,1.4,.5,1) both',
          opacity: leaving ? 0 : 1,
          transform: leaving ? 'translateY(-14px) scale(.94)' : 'none',
        }}
      >
        <div className={s.swatch} style={{ background: spineBg(book, true) }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ overflow: 'visible' }}>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" style={{ transformBox: 'view-box', transformOrigin: '16px 11px', transform: success ? 'translateY(-3px) rotate(28deg)' : 'none', transition: 'transform .38s cubic-bezier(.3,1.5,.5,1)' }} />
          </svg>
        </div>
        <div>
          <div className={s.title}>Edit {book.title}</div>
          {!book.hasPin ? (
            <div className={s.sub}>Anyone can read this book, but no one can edit it yet. Ask the family admin to set a PIN for it.</div>
          ) : (
            <>
              <div className={s.sub}>Anyone can read this book. Enter the 4-digit family PIN to make changes.</div>
              <div className={s.boxes} onClick={() => ref.current?.focus()}>
                {[0, 1, 2, 3].map((i) => {
                  const n = pin.length;
                  const border = success ? '#5E8B5A' : error ? '#C0443A' : i === n ? 'var(--accent)' : 'var(--line)';
                  return (
                    <div key={i} className={s.box} style={{ borderColor: border, transform: `scale(${!success && i === n ? 1.04 : 1})` }}>
                      <span className={s.dot} style={{ opacity: success || i < n ? 1 : 0 }} />
                    </div>
                  );
                })}
                <input
                  ref={ref}
                  value={pin}
                  onChange={(e) => void onChange(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label="PIN"
                  className={s.hidden}
                />
              </div>
              <div className={s.msg} style={{ color: msgColor }}>{msg}</div>
            </>
          )}
          {!success && (
            <button type="button" className={s.cancel} onClick={onClose}>
              {book.hasPin ? 'Cancel' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
