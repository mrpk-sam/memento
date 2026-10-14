import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import s from './toast.module.css';

type Action = () => void;
interface ToastState { id: number; msg: string; actionLabel?: string; action?: Action }
type ToastFn = (msg: string, actionLabel?: string, action?: Action) => void;

const Ctx = createContext<ToastFn>(() => {});

/** One toast at a time, auto-dismissed after 3.6s, with an optional action (usually Undo). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback<ToastFn>((msg, actionLabel, action) => {
    clearTimeout(timer.current);
    setT({ id: Date.now(), msg, actionLabel, action });
    timer.current = setTimeout(() => setT(null), 3600);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      {t && (
        <div className={s.wrap} role="status" aria-live="polite">
          <div key={t.id} className={s.toast}>
            <span>{t.msg}</span>
            {t.action && (
              <button
                className={s.action}
                onClick={() => {
                  const a = t.action;
                  setT(null);
                  a?.();
                }}
              >
                {t.actionLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
