import { ApiError } from '../api/client';

// Long runs (uploads, caption rewrites) must survive the phone locking. A locked phone freezes
// the page and drops its open requests, so: keep the screen on while working, and when a
// request dies anyway, wait for the screen to come back and try it again.

/**
 * True when a request failed on the way, not because the server said no: no connection, the
 * phone locked mid-request, or a proxy answering while the app restarts.
 */
export function retryable(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 502 || e.status === 503 || e.status === 504;
  // fetch() rejects with a TypeError ("Load failed", "Failed to fetch"); a proxy's HTML error
  // page fails to parse as JSON.
  return e instanceof TypeError || e instanceof SyntaxError || (e instanceof DOMException && e.name === 'AbortError');
}

/** Resolves once the page is on screen and online, after a short pause so the network can settle. */
export function whenAwake(): Promise<void> {
  const ready = () => document.visibilityState === 'visible' && navigator.onLine;
  if (ready()) return new Promise((r) => setTimeout(r, 1500));
  return new Promise((resolve) => {
    const check = () => {
      if (!ready()) return;
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
      setTimeout(resolve, 800);
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
  });
}

/** Runs `fn`, and when it fails on the way (see `retryable`), waits for `whenAwake` and tries again. */
export async function retrying<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries || !retryable(e)) throw e;
      await whenAwake();
    }
  }
}

/**
 * Asks the browser to keep the screen on until the returned function is called. The lock is
 * dropped whenever the page is hidden, so it's asked for again when the page comes back.
 * Does nothing where the Screen Wake Lock API is missing.
 */
export function keepAwake(): () => void {
  let lock: WakeLockSentinel | null = null;
  let on = true;
  const take = async () => {
    if (!on || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
    try {
      lock = await navigator.wakeLock.request('screen');
      if (!on) void lock.release().catch(() => {});
    } catch {
      // Refused (battery saver, no permission): carry on without it.
    }
  };
  const onVisible = () => document.visibilityState === 'visible' && void take();
  void take();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    on = false;
    document.removeEventListener('visibilitychange', onVisible);
    void lock?.release().catch(() => {});
    lock = null;
  };
}
