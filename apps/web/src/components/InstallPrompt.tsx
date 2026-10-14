import { useEffect, useState } from 'react';
import s from './InstallPrompt.module.css';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const VISITS = 'memento:visits';
const DISMISSED = 'memento:install-dismissed';
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage blocked */
  }
};

let deferred: BeforeInstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
});

/** Counts one visit per browser session. */
function countVisit(): number {
  let n = Number(read(VISITS) ?? 0);
  try {
    if (!sessionStorage.getItem(VISITS)) {
      sessionStorage.setItem(VISITS, '1');
      n += 1;
      write(VISITS, String(n));
    }
  } catch {
    /* storage blocked */
  }
  return n;
}

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

/** Offers "Add to Home Screen" on the shelf from the second visit on. */
export function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    const visits = countVisit();
    if (visits < 2 || standalone() || read(DISMISSED)) return;
    const t = setTimeout(() => {
      if (deferred) setShow(true);
      else if (isIos()) {
        setIos(true);
        setShow(true);
      }
    }, 1200);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  const dismiss = () => {
    write(DISMISSED, '1');
    setShow(false);
  };
  return (
    <div className={s.card} role="dialog" aria-label="Install Memento">
      <img src="/icons/icon-192.png" alt="" className={s.icon} />
      <div className={s.text}>
        <div className={s.title}>Keep Memento on your home screen</div>
        <div className={s.sub}>{ios ? 'Tap Share, then “Add to Home Screen”.' : 'It opens like an app and reads books offline.'}</div>
      </div>
      {!ios && (
        <button
          className={s.install}
          onClick={async () => {
            if (!deferred) return;
            await deferred.prompt();
            await deferred.userChoice;
            deferred = null;
            dismiss();
          }}
        >
          Install
        </button>
      )}
      <button className={s.close} onClick={dismiss} aria-label="Not now">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}
